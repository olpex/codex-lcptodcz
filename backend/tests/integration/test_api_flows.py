from datetime import date, datetime, timedelta, timezone

from app.models import Group, GroupMembership, GroupStatus, Performance, Room, ScheduleSlot, Subject, Teacher, Trainee


def test_auth_login_and_me(client):
    login_response = client.post("/api/v1/auth/login", json={"username": "admin", "password": "Admin123!"})
    assert login_response.status_code == 200
    payload = login_response.json()
    assert payload["access_token"]
    assert payload["refresh_token"]

    me_response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {payload['access_token']}"},
    )
    assert me_response.status_code == 200
    me_payload = me_response.json()
    role_names = [role["name"] for role in me_payload["roles"]]
    assert "admin" in role_names


def test_group_trainee_enrollment_flow(client, auth_headers):
    trainee_response = client.post(
        "/api/v1/trainees",
        json={"first_name": "Марина", "last_name": "Іваненко", "status": "active"},
        headers=auth_headers,
    )
    assert trainee_response.status_code == 201
    trainee_id = trainee_response.json()["id"]

    group_response = client.post(
        "/api/v1/groups",
        json={"code": "GRP-001", "name": "Тестова група", "capacity": 25, "status": "planned"},
        headers=auth_headers,
    )
    assert group_response.status_code == 201
    group_id = group_response.json()["id"]

    enroll_response = client.post(
        f"/api/v1/groups/{group_id}/enroll",
        json={"trainee_id": trainee_id},
        headers=auth_headers,
    )
    assert enroll_response.status_code == 201
    assert enroll_response.json()["status"] == "active"


def test_schedule_workload_and_kpi_flow(client, auth_headers):
    teacher_response = client.post(
        "/api/v1/teachers",
        json={"first_name": "Тест", "last_name": "Викладач", "hourly_rate": 0, "annual_load_hours": 100, "is_active": True},
        headers=auth_headers,
    )
    assert teacher_response.status_code == 201

    group_response = client.post(
        "/api/v1/groups",
        json={"code": "GRP-002", "name": "Група для розкладу", "capacity": 20, "status": "active"},
        headers=auth_headers,
    )
    assert group_response.status_code == 201

    schedule_response = client.post(
        "/api/v1/schedule/generate",
        json={"start_date": date.today().isoformat(), "days": 3},
        headers=auth_headers,
    )
    assert schedule_response.status_code == 200
    assert len(schedule_response.json()) > 0

    workload_response = client.get("/api/v1/teacher-workload", headers=auth_headers)
    assert workload_response.status_code == 200
    assert isinstance(workload_response.json(), list)

    kpi_response = client.get("/api/v1/dashboard/kpi", headers=auth_headers)
    assert kpi_response.status_code == 200
    kpi_payload = kpi_response.json()
    assert kpi_payload["active_groups"] >= 1


def test_active_groups_between_dates_and_excel_export(client, auth_headers, db_session):
    group = Group(
        branch_id="main",
        code="167-25",
        name="Організація трудових відносин",
        capacity=25,
        status=GroupStatus.ACTIVE,
        start_date=date(2025, 10, 21),
        end_date=date(2025, 10, 24),
    )
    other_group = Group(branch_id="main", code="999-25", name="Поза періодом", capacity=25, status=GroupStatus.ACTIVE)
    teacher_one = Teacher(branch_id="main", first_name="Лілія", last_name="Штогрин", hourly_rate=0, is_active=True)
    teacher_two = Teacher(branch_id="main", first_name="Артур", last_name="Костів", hourly_rate=0, is_active=True)
    subject = Subject(branch_id="main", name="Трудовий договір", hours_total=10)
    room = Room(branch_id="main", name="Імпорт: 167-25", capacity=25)
    db_session.add_all([group, other_group, teacher_one, teacher_two, subject, room])
    db_session.flush()
    db_session.add_all(
        [
            ScheduleSlot(
                group_id=group.id,
                teacher_id=teacher_one.id,
                subject_id=subject.id,
                room_id=room.id,
                starts_at=datetime(2025, 10, 21, 9, 30, tzinfo=timezone.utc),
                ends_at=datetime(2025, 10, 21, 11, 5, tzinfo=timezone.utc),
                pair_number=1,
                academic_hours=2,
            ),
            ScheduleSlot(
                group_id=group.id,
                teacher_id=teacher_two.id,
                subject_id=subject.id,
                room_id=room.id,
                starts_at=datetime(2025, 10, 22, 11, 10, tzinfo=timezone.utc),
                ends_at=datetime(2025, 10, 22, 12, 45, tzinfo=timezone.utc),
                pair_number=2,
                academic_hours=1.5,
            ),
            ScheduleSlot(
                group_id=other_group.id,
                teacher_id=teacher_one.id,
                subject_id=subject.id,
                room_id=room.id,
                starts_at=datetime(2025, 11, 1, 9, 30, tzinfo=timezone.utc),
                ends_at=datetime(2025, 11, 1, 11, 5, tzinfo=timezone.utc),
                pair_number=1,
                academic_hours=2,
            ),
        ]
    )
    db_session.commit()

    response = client.get(
        "/api/v1/groups/active-between?date_from=2025-10-20&date_to=2025-10-25",
        headers=auth_headers,
    )
    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["code"] == "167-25"
    assert payload[0]["total_hours"] == 3.5
    assert {item["teacher_name"] for item in payload[0]["teachers"]} == {"Штогрин Лілія", "Костів Артур"}

    export_response = client.get(
        "/api/v1/groups/active-between/export?date_from=2025-10-20&date_to=2025-10-25",
        headers=auth_headers,
    )
    assert export_response.status_code == 200
    assert export_response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert export_response.content


def test_bulk_group_code_update_flow(client, auth_headers):
    first = client.post(
        "/api/v1/trainees",
        json={"first_name": "Іван", "last_name": "Перший", "status": "active"},
        headers=auth_headers,
    )
    second = client.post(
        "/api/v1/trainees",
        json={"first_name": "Олена", "last_name": "Друга", "status": "active"},
        headers=auth_headers,
    )
    assert first.status_code == 201
    assert second.status_code == 201
    trainee_ids = [first.json()["id"], second.json()["id"]]

    bulk_response = client.post(
        "/api/v1/trainees/bulk/group-code",
        json={"trainee_ids": trainee_ids, "group_code": "73-26"},
        headers=auth_headers,
    )
    assert bulk_response.status_code == 200
    assert bulk_response.json()["updated_count"] == 2
    assert bulk_response.json()["group_code"] == "73-26"

    trainees_response = client.get("/api/v1/trainees", headers=auth_headers)
    assert trainees_response.status_code == 200
    rows = trainees_response.json()
    updated = [item for item in rows if item["id"] in trainee_ids]
    assert len(updated) == 2
    assert all(item["group_code"] == "73-26" for item in updated)


def test_bulk_status_update_flow(client, auth_headers):
    first = client.post(
        "/api/v1/trainees",
        json={"first_name": "Степан", "last_name": "Перший", "status": "active"},
        headers=auth_headers,
    )
    second = client.post(
        "/api/v1/trainees",
        json={"first_name": "Марія", "last_name": "Друга", "status": "active"},
        headers=auth_headers,
    )
    assert first.status_code == 201
    assert second.status_code == 201
    trainee_ids = [first.json()["id"], second.json()["id"]]

    bulk_response = client.post(
        "/api/v1/trainees/bulk/status",
        json={"trainee_ids": trainee_ids, "status": "completed"},
        headers=auth_headers,
    )
    assert bulk_response.status_code == 200
    assert bulk_response.json()["updated_count"] == 2
    assert bulk_response.json()["status"] == "completed"

    trainees_response = client.get("/api/v1/trainees", headers=auth_headers)
    assert trainees_response.status_code == 200
    rows = trainees_response.json()
    updated = [item for item in rows if item["id"] in trainee_ids]
    assert len(updated) == 2
    assert all(item["status"] == "completed" for item in updated)


def test_bulk_archive_restore_flow(client, auth_headers):
    first = client.post(
        "/api/v1/trainees",
        json={"first_name": "Анна", "last_name": "Видалити1", "status": "active"},
        headers=auth_headers,
    )
    second = client.post(
        "/api/v1/trainees",
        json={"first_name": "Петро", "last_name": "Видалити2", "status": "active"},
        headers=auth_headers,
    )
    assert first.status_code == 201
    assert second.status_code == 201
    trainee_ids = [first.json()["id"], second.json()["id"]]

    bulk_response = client.post(
        "/api/v1/trainees/bulk/delete",
        json={"trainee_ids": trainee_ids},
        headers=auth_headers,
    )
    assert bulk_response.status_code == 200
    assert bulk_response.json()["deleted_count"] == 2
    assert set(bulk_response.json()["deleted_ids"]) == set(trainee_ids)

    active_response = client.get("/api/v1/trainees", headers=auth_headers)
    assert active_response.status_code == 200
    active_rows = active_response.json()
    active_ids = {item["id"] for item in active_rows}
    assert all(trainee_id not in active_ids for trainee_id in trainee_ids)

    archived_response = client.get("/api/v1/trainees?include_deleted=true", headers=auth_headers)
    assert archived_response.status_code == 200
    archived_rows = archived_response.json()
    archived_by_id = {item["id"]: item for item in archived_rows if item["id"] in trainee_ids}
    assert len(archived_by_id) == 2
    assert all(row["is_deleted"] is True for row in archived_by_id.values())
    assert all(row["deleted_at"] is not None for row in archived_by_id.values())

    restore_response = client.post(
        "/api/v1/trainees/bulk/restore",
        json={"trainee_ids": trainee_ids},
        headers=auth_headers,
    )
    assert restore_response.status_code == 200
    assert restore_response.json()["restored_count"] == 2
    assert set(restore_response.json()["restored_ids"]) == set(trainee_ids)

    final_response = client.get("/api/v1/trainees", headers=auth_headers)
    assert final_response.status_code == 200
    final_rows = final_response.json()
    restored_by_id = {item["id"]: item for item in final_rows if item["id"] in trainee_ids}
    assert len(restored_by_id) == 2
    assert all(row["is_deleted"] is False for row in restored_by_id.values())
    assert all(row["deleted_at"] is None for row in restored_by_id.values())


def test_delete_group_cleans_related_rows(client, auth_headers, db_session):
    trainee_response = client.post(
        "/api/v1/trainees",
        json={"first_name": "Оксана", "last_name": "Тест", "status": "active"},
        headers=auth_headers,
    )
    assert trainee_response.status_code == 201
    trainee_id = trainee_response.json()["id"]

    group_response = client.post(
        "/api/v1/groups",
        json={"code": "GRP-DEL-001", "name": "Група на видалення", "capacity": 20, "status": "active"},
        headers=auth_headers,
    )
    assert group_response.status_code == 201
    group_id = group_response.json()["id"]

    enroll_response = client.post(
        f"/api/v1/groups/{group_id}/enroll",
        json={"trainee_id": trainee_id},
        headers=auth_headers,
    )
    assert enroll_response.status_code == 201

    teacher = Teacher(branch_id="main", first_name="Тест", last_name="Викладач", hourly_rate=0.0, annual_load_hours=10.0)
    subject = Subject(branch_id="main", name="Тестовий предмет", hours_total=12)
    room = Room(branch_id="main", name="Аудиторія 999", capacity=20)
    db_session.add_all([teacher, subject, room])
    db_session.flush()

    slot_start = datetime.now(timezone.utc).replace(microsecond=0)
    db_session.add(
        ScheduleSlot(
            group_id=group_id,
            teacher_id=teacher.id,
            subject_id=subject.id,
            room_id=room.id,
            starts_at=slot_start,
            ends_at=slot_start + timedelta(hours=2),
            pair_number=1,
            academic_hours=2.0,
        )
    )
    db_session.add(
        Performance(
            branch_id="main",
            trainee_id=trainee_id,
            group_id=group_id,
            progress_pct=10.0,
            attendance_pct=90.0,
            employment_flag=False,
        )
    )
    db_session.commit()

    delete_response = client.delete(f"/api/v1/groups/{group_id}?delete_trainees=true", headers=auth_headers)
    assert delete_response.status_code == 204

    assert db_session.get(Group, group_id) is None
    assert db_session.query(GroupMembership).filter(GroupMembership.group_id == group_id).count() == 0
    assert db_session.query(ScheduleSlot).filter(ScheduleSlot.group_id == group_id).count() == 0
    assert db_session.query(Performance).filter(Performance.group_id == group_id).count() == 0


def test_delete_group_clears_trainee_group_code_when_trainees_kept(client, auth_headers, db_session):
    trainee_response = client.post(
        "/api/v1/trainees",
        json={"first_name": "Іван", "last_name": "Код", "status": "active", "group_code": "GRP-ORPH-001"},
        headers=auth_headers,
    )
    assert trainee_response.status_code == 201
    trainee_id = trainee_response.json()["id"]

    group_response = client.post(
        "/api/v1/groups",
        json={"code": "GRP-ORPH-001", "name": "Група для очищення коду", "capacity": 20, "status": "active"},
        headers=auth_headers,
    )
    assert group_response.status_code == 201
    group_id = group_response.json()["id"]

    delete_response = client.delete(f"/api/v1/groups/{group_id}", headers=auth_headers)
    assert delete_response.status_code == 204

    trainee = db_session.get(Trainee, trainee_id)
    assert trainee is not None
    assert trainee.is_deleted is False
    assert trainee.group_code is None


def test_clear_orphan_group_codes_endpoint(client, auth_headers):
    valid_group_response = client.post(
        "/api/v1/groups",
        json={"code": "GRP-VALID-001", "name": "Валідна група", "capacity": 20, "status": "active"},
        headers=auth_headers,
    )
    assert valid_group_response.status_code == 201

    orphan_trainee = client.post(
        "/api/v1/trainees",
        json={"first_name": "Олена", "last_name": "Сирота", "status": "active", "group_code": "NO-SUCH-GROUP"},
        headers=auth_headers,
    )
    valid_trainee = client.post(
        "/api/v1/trainees",
        json={"first_name": "Марія", "last_name": "Валідна", "status": "active", "group_code": "GRP-VALID-001"},
        headers=auth_headers,
    )
    assert orphan_trainee.status_code == 201
    assert valid_trainee.status_code == 201

    cleanup_response = client.post("/api/v1/trainees/bulk/clear-orphan-group-codes", headers=auth_headers)
    assert cleanup_response.status_code == 200
    payload = cleanup_response.json()
    assert payload["cleared_count"] == 1

    trainees_response = client.get("/api/v1/trainees", headers=auth_headers)
    assert trainees_response.status_code == 200
    rows = trainees_response.json()
    orphan_row = next(item for item in rows if item["id"] == orphan_trainee.json()["id"])
    valid_row = next(item for item in rows if item["id"] == valid_trainee.json()["id"])
    assert orphan_row["group_code"] is None
    assert valid_row["group_code"] == "GRP-VALID-001"


def test_archive_unassigned_group_trainees_endpoint(client, auth_headers):
    no_group_one = client.post(
        "/api/v1/trainees",
        json={"first_name": "А", "last_name": "БезГрупи1", "status": "active"},
        headers=auth_headers,
    )
    no_group_two = client.post(
        "/api/v1/trainees",
        json={"first_name": "Б", "last_name": "БезГрупи2", "status": "active", "group_code": ""},
        headers=auth_headers,
    )
    with_group = client.post(
        "/api/v1/trainees",
        json={"first_name": "В", "last_name": "ЗГрупою", "status": "active", "group_code": "73-26"},
        headers=auth_headers,
    )
    assert no_group_one.status_code == 201
    assert no_group_two.status_code == 201
    assert with_group.status_code == 201

    archive_response = client.post("/api/v1/trainees/bulk/archive-unassigned-group", headers=auth_headers)
    assert archive_response.status_code == 200
    payload = archive_response.json()
    assert payload["deleted_count"] == 2

    active_rows = client.get("/api/v1/trainees", headers=auth_headers)
    assert active_rows.status_code == 200
    active_ids = {item["id"] for item in active_rows.json()}
    assert no_group_one.json()["id"] not in active_ids
    assert no_group_two.json()["id"] not in active_ids
    assert with_group.json()["id"] in active_ids
