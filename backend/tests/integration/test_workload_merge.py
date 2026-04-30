from datetime import datetime, timedelta, timezone

from app.models import Group, GroupStatus, Room, ScheduleSlot, Subject, Teacher


def test_merge_teachers_reassigns_schedule_slots_and_annual_load(client, auth_headers, db_session):
    target = Teacher(branch_id="main", last_name="Седура", first_name="Андрій Сергійович", hourly_rate=0, annual_load_hours=180)
    duplicate = Teacher(branch_id="main", last_name="Слегура", first_name="Андрій Сергійович", hourly_rate=0, annual_load_hours=20)
    group = Group(branch_id="main", code="162-25", name="Група 162-25", status=GroupStatus.ACTIVE)
    subject = Subject(branch_id="main", name="OCR merge test subject", hours_total=10)
    room = Room(branch_id="main", name="12", capacity=20)
    db_session.add_all([target, duplicate, group, subject, room])
    db_session.flush()
    target_id = target.id
    duplicate_id = duplicate.id

    starts_at = datetime(2026, 4, 30, 9, tzinfo=timezone.utc)
    db_session.add(
        ScheduleSlot(
            group_id=group.id,
            teacher_id=duplicate.id,
            subject_id=subject.id,
            room_id=room.id,
            starts_at=starts_at,
            ends_at=starts_at + timedelta(minutes=95),
            pair_number=1,
            academic_hours=2,
        )
    )
    db_session.commit()

    response = client.post(
        "/api/v1/teacher-workload/merge-teachers",
        headers=auth_headers,
        json={"target_teacher_id": target_id, "source_teacher_ids": [duplicate_id]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["target_teacher_id"] == target_id
    assert body["merged_teacher_ids"] == [duplicate_id]
    assert body["reassigned_slots"] == 1
    assert body["annual_load_hours"] == 200
    db_session.expire_all()
    assert db_session.get(Teacher, duplicate_id) is None
    assert db_session.query(ScheduleSlot).one().teacher_id == target_id
