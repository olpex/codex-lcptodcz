from datetime import datetime, timedelta, timezone

from app.models import (
    Group,
    GroupStatus,
    JournalMonitorEntry,
    JournalMonitorSection,
    JournalWorkloadEntry,
    Room,
    ScheduleSlot,
    Subject,
    Teacher,
)
from app.api.routes import schedule as schedule_route
from app.services.import_export import collect_teacher_workload_summary


def _seed_schedule_group(db_session, code: str = "73-26", hours: float = 8.0):
    teacher = Teacher(branch_id="main", first_name="Олег Леонідович", last_name="Паращук", is_active=True)
    group = Group(branch_id="main", code=code, name=f"Група {code}", status=GroupStatus.ACTIVE)
    subject = Subject(branch_id="main", name=f"Предмет {code}", hours_total=int(hours))
    room = Room(branch_id="main", name=f"Аудиторія {code}", capacity=20)
    db_session.add_all([teacher, group, subject, room])
    db_session.flush()

    starts_at = datetime(2026, 3, 1, 9, 30, tzinfo=timezone.utc)
    db_session.add(
        ScheduleSlot(
            group_id=group.id,
            teacher_id=teacher.id,
            subject_id=subject.id,
            room_id=room.id,
            starts_at=starts_at,
            ends_at=starts_at + timedelta(minutes=95),
            academic_hours=hours,
            pair_number=1,
        )
    )
    db_session.commit()
    return group, teacher


def _seed_processed_journal_workload(db_session, group: Group, teacher: Teacher, hours: float) -> None:
    section = JournalMonitorSection(
        branch_id="main",
        name="Журнали 2026",
        folder_url="https://drive.google.com/drive/folders/root",
        folder_id="root",
    )
    db_session.add(section)
    db_session.flush()
    journal = JournalMonitorEntry(
        section_id=section.id,
        branch_id="main",
        drive_file_id=f"journal-{group.code}",
        journal_name=f"{group.code} Журнал",
        group_code=group.code,
        matched_group_id=group.id,
        workload_status="processed",
        workload_year=2026,
        workload_hours=hours,
    )
    db_session.add(journal)
    db_session.flush()
    db_session.add(
        JournalWorkloadEntry(
            journal_monitor_entry_id=journal.id,
            branch_id="main",
            teacher_id=teacher.id,
            subject_name=f"Предмет {group.code}",
            hours=hours,
        )
    )
    db_session.commit()


def test_delete_group_schedule_removes_schedule_only_teacher_hours(client, auth_headers, db_session):
    group, teacher = _seed_schedule_group(db_session, hours=8)
    before = {row["teacher_id"]: row for row in collect_teacher_workload_summary(db_session, "main")}
    assert before[teacher.id]["total_hours"] == 8

    response = client.delete(f"/api/v1/schedule/groups/{group.id}", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["deleted_slots"] == 1
    assert db_session.query(ScheduleSlot).filter(ScheduleSlot.group_id == group.id).count() == 0
    after = {row["teacher_id"]: row for row in collect_teacher_workload_summary(db_session, "main")}
    assert after[teacher.id]["total_hours"] == 0
    assert after[teacher.id]["groups"] == []


def test_delete_group_schedule_keeps_teacher_hours_when_group_journal_is_processed(client, auth_headers, db_session):
    group, teacher = _seed_schedule_group(db_session, code="46-26", hours=8)
    _seed_processed_journal_workload(db_session, group, teacher, hours=8)
    before = {row["teacher_id"]: row for row in collect_teacher_workload_summary(db_session, "main")}
    assert before[teacher.id]["total_hours"] == 8
    assert before[teacher.id]["groups"] == [{"group_code": "46-26", "group_name": "Група 46-26", "hours": 8.0}]

    response = client.delete(f"/api/v1/schedule/groups/{group.id}", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["deleted_slots"] == 1
    assert response.json()["journal_workload_present"] is True
    assert db_session.query(ScheduleSlot).filter(ScheduleSlot.group_id == group.id).count() == 0
    after = {row["teacher_id"]: row for row in collect_teacher_workload_summary(db_session, "main")}
    assert after[teacher.id]["total_hours"] == 8
    assert after[teacher.id]["groups"] == [{"group_code": "46-26", "group_name": "46-26 Журнал", "hours": 8.0}]


def test_schedule_list_uses_unfiltered_branch_cache(client, auth_headers, monkeypatch):
    cached_payload = [
        {
            "id": 123,
            "group_id": 10,
            "teacher_id": 20,
            "subject_id": 30,
            "room_id": 40,
            "starts_at": "2026-05-20T09:00:00Z",
            "ends_at": "2026-05-20T11:00:00Z",
            "pair_number": 1,
            "academic_hours": 2,
            "group_code": "CACHE-26",
            "group_name": "Кешований розклад",
            "group_start_date": None,
            "group_end_date": None,
            "teacher_name": "Кеш Викладач",
            "subject_name": "Кешований предмет",
            "room_name": "101",
            "generated_by": None,
        }
    ]
    requested_keys: list[str] = []

    def fake_cache_get_json(key: str):
        requested_keys.append(key)
        return cached_payload

    monkeypatch.setattr(schedule_route, "cache_get_json", fake_cache_get_json)

    response = client.get("/api/v1/schedule", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()[0]["id"] == 123
    assert requested_keys == ["schedule:list:main:v1"]


def test_schedule_mutations_invalidate_unfiltered_branch_cache(client, auth_headers, db_session, monkeypatch):
    group, _teacher = _seed_schedule_group(db_session, code="INV-26", hours=4)
    deleted_keys: list[str] = []

    monkeypatch.setattr(schedule_route, "cache_delete", lambda key: deleted_keys.append(key))

    response = client.delete(f"/api/v1/schedule/groups/{group.id}", headers=auth_headers)

    assert response.status_code == 200
    assert "schedule:list:main:v1" in deleted_keys
