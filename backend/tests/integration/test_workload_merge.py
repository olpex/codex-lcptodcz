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
        json={
            "target_teacher_id": target_id,
            "source_teacher_ids": [duplicate_id],
            "last_name": "Слегура",
            "first_name": "Андрій Сергійович",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["target_teacher_id"] == target_id
    assert body["teacher_name"] == "Слегура Андрій Сергійович"
    assert body["merged_teacher_ids"] == [duplicate_id]
    assert body["reassigned_slots"] == 1
    assert body["annual_load_hours"] == 200
    db_session.expire_all()
    target_after = db_session.get(Teacher, target_id)
    assert target_after is not None
    assert target_after.last_name == "Слегура"
    assert target_after.first_name == "Андрій Сергійович"
    assert db_session.get(Teacher, duplicate_id) is None
    assert db_session.query(ScheduleSlot).one().teacher_id == target_id


def test_merge_teachers_merges_duplicate_journal_workload_entries(client, auth_headers, db_session):
    target = Teacher(branch_id="main", last_name="Полович", first_name="В.І.", hourly_rate=0, annual_load_hours=0)
    duplicate = Teacher(
        branch_id="main",
        last_name="Полович",
        first_name="Валентина Іванівна",
        hourly_rate=0,
        annual_load_hours=0,
    )
    section = JournalMonitorSection(
        branch_id="main",
        name="Журнали 2026",
        folder_url="https://drive.google.com/drive/folders/root",
        folder_id="root",
    )
    journal = JournalMonitorEntry(
        section=section,
        branch_id="main",
        drive_file_id="journal-1",
        journal_name="1-26 Журнал",
        group_code="1-26",
        workload_status="processed",
    )
    db_session.add_all([target, duplicate, section, journal])
    db_session.flush()
    target_id = target.id
    duplicate_id = duplicate.id
    journal_id = journal.id
    db_session.add_all(
        [
            JournalWorkloadEntry(
                journal_monitor_entry_id=journal.id,
                branch_id="main",
                teacher_id=target.id,
                subject_name="Охорона праці",
                hours=10,
                pages="1-2",
            ),
            JournalWorkloadEntry(
                journal_monitor_entry_id=journal.id,
                branch_id="main",
                teacher_id=duplicate.id,
                subject_name="Охорона праці",
                hours=4,
                pages="3",
            ),
        ]
    )
    db_session.commit()

    response = client.post(
        "/api/v1/teacher-workload/merge-teachers",
        headers=auth_headers,
        json={
            "target_teacher_id": target_id,
            "source_teacher_ids": [duplicate_id],
            "last_name": "Полович",
            "first_name": "Валентина Іванівна",
        },
    )

    assert response.status_code == 200
    db_session.expire_all()
    workload_entries = db_session.query(JournalWorkloadEntry).filter_by(journal_monitor_entry_id=journal_id).all()
    assert len(workload_entries) == 1
    assert workload_entries[0].teacher_id == target_id
    assert workload_entries[0].hours == 14
    assert workload_entries[0].pages == "1-2; 3"
    assert db_session.get(Teacher, duplicate_id) is None
