from datetime import datetime, timedelta, timezone
from io import BytesIO

from docx import Document as DocxDocument
from openpyxl import Workbook

from app.core.crypto import cipher
from app.models import (
    Group,
    GroupStatus,
    ImportJob,
    JournalMonitorEntry,
    JournalMonitorSection,
    JournalWorkloadEntry,
    Room,
    ScheduleSlot,
    Subject,
    Teacher,
    Trainee,
)
from app.services import drive_intake
from app.services.import_export import collect_teacher_workload_summary
from app.tasks.worker import process_import_job_task


def _contracts_workbook_bytes() -> bytes:
    stream = BytesIO()
    workbook = Workbook()
    workbook.active.title = "Архів"
    workbook.active.append(["Службова вкладка"])
    sheet = workbook.create_sheet("Додаток")
    sheet.append(["Група 184-25 Цифровий світ"])
    sheet.append([])
    sheet.append(
        [
            "№",
            "ПІБ безробітного",
            "Дата народження",
            "№ Договору",
            "Ідентифікаційний номер",
            "Адреса",
            "Телефон",
        ]
    )
    sheet.append(
        [
            1,
            "Петренко Іван Іванович",
            "01.02.1990",
            "184-25/001",
            "1234567890",
            "м. Львів, вул. Зелена 1",
            "+380501112233",
        ]
    )
    workbook.save(stream)
    stream.seek(0)
    return stream.read()


def _schedule_docx_bytes(group_code: str = "46-26") -> bytes:
    stream = BytesIO()
    document = DocxDocument()
    document.add_paragraph("1 пара - 9.30 - 11.05")
    document.add_paragraph("за напрямом")
    document.add_paragraph("Цифрові навички")
    document.add_paragraph(f"Група № {group_code}")
    document.add_paragraph("з 12 травня 2026 року до 12 травня 2026 року")
    table = document.add_table(rows=3, cols=6)
    for idx, value in enumerate(
        [
            "№п/п",
            "Назва предмета",
            "К-сть год.",
            "12.05",
            "Прізвище, ім'я, по-батькові викладача",
            "Примітка",
        ]
    ):
        table.cell(0, idx).text = value
    for idx, value in enumerate(["1", "Цифрова грамотність", "2", "1п/2год", "Коваль Олена Петрівна", ""]):
        table.cell(1, idx).text = value
    for idx, value in enumerate(["", "Загальний обсяг навчального часу:", "2", "", "", ""]):
        table.cell(2, idx).text = value
    document.save(stream)
    stream.seek(0)
    return stream.read()


def _run_import_job(job_id: int) -> dict:
    return process_import_job_task.run(job_id)


def test_drive_intake_processes_one_contract_file_and_updates_existing_trainee(db_session):
    db_session.add(
        Trainee(
            branch_id="main",
            first_name="Іван Іванович",
            last_name="Петренко",
            status="active",
            group_code="184-25",
        )
    )
    db_session.commit()

    files = [
        {
            "id": "contracts-184-25",
            "name": "184-25 Договори Цифровий світ.xlsx",
            "mimeType": drive_intake.GOOGLE_DRIVE_XLSX_MIME,
            "modifiedTime": "2026-05-12T07:00:00Z",
            "webViewLink": "https://drive.google.com/file/d/contracts-184-25/view",
        },
        {
            "id": "schedule-46-26",
            "name": "46-26 Розклад.docx",
            "mimeType": drive_intake.GOOGLE_DRIVE_DOCX_MIME,
            "modifiedTime": "2026-05-12T07:01:00Z",
            "webViewLink": "https://drive.google.com/file/d/schedule-46-26/view",
        },
    ]

    result = drive_intake.process_next_drive_intake_file(
        db_session,
        folder_url="https://drive.google.com/drive/folders/intake-folder",
        branch_id="main",
        file_lister=lambda folder_id, service_account_json=None: files,
        downloader=lambda file_id, mime_type=None, service_account_json=None: _contracts_workbook_bytes(),
        import_job_runner=_run_import_job,
    )

    assert result["processed"] == 1
    assert result["skipped_already_processed"] == 0
    assert result["job_id"] is not None
    db_session.expire_all()

    assert db_session.query(ImportJob).count() == 1
    trainee = db_session.query(Trainee).filter(Trainee.last_name == "Петренко").one()
    assert trainee.contract_number == "184-25/001"
    assert cipher.decrypt(trainee.tax_id_encrypted) == "1234567890"
    assert cipher.decrypt(trainee.phone_encrypted) == "+380501112233"
    assert db_session.query(ScheduleSlot).count() == 0


def test_drive_intake_schedule_creates_calendar_without_duplicating_journal_workload(db_session):
    group = Group(branch_id="main", code="46-26", name="Група 46-26", status=GroupStatus.ACTIVE)
    teacher = Teacher(branch_id="main", first_name="Олена Петрівна", last_name="Коваль", is_active=True)
    subject = Subject(branch_id="main", name="Цифрова грамотність", hours_total=2)
    room = Room(branch_id="main", name="Журнал 46-26", capacity=20)
    section = JournalMonitorSection(
        branch_id="main",
        name="Журнали 2026",
        folder_url="https://drive.google.com/drive/folders/journals",
        folder_id="journals",
    )
    db_session.add_all([group, teacher, subject, room, section])
    db_session.flush()
    entry = JournalMonitorEntry(
        section_id=section.id,
        branch_id="main",
        drive_file_id="journal-46-26",
        journal_name="46-26 Журнал",
        group_code="46-26",
        workload_status="processed",
        workload_year=2026,
        workload_hours=2,
    )
    db_session.add(entry)
    db_session.flush()
    db_session.add(
        JournalWorkloadEntry(
            journal_monitor_entry_id=entry.id,
            branch_id="main",
            teacher_id=teacher.id,
            subject_name="Цифрова грамотність",
            hours=2,
        )
    )
    db_session.commit()

    result = drive_intake.process_next_drive_intake_file(
        db_session,
        folder_url="https://drive.google.com/drive/folders/intake-folder",
        branch_id="main",
        file_lister=lambda folder_id, service_account_json=None: [
            {
                "id": "schedule-46-26",
                "name": "46-26 Розклад.docx",
                "mimeType": drive_intake.GOOGLE_DRIVE_DOCX_MIME,
                "modifiedTime": "2026-05-12T07:00:00Z",
                "webViewLink": "https://drive.google.com/file/d/schedule-46-26/view",
            }
        ],
        downloader=lambda file_id, mime_type=None, service_account_json=None: _schedule_docx_bytes(),
        import_job_runner=_run_import_job,
    )

    assert result["processed"] == 1
    db_session.expire_all()

    assert db_session.query(ScheduleSlot).count() == 1
    assert db_session.query(JournalWorkloadEntry).count() == 1
    workload_rows = collect_teacher_workload_summary(db_session, "main")
    assert workload_rows[0]["total_hours"] == 2
    assert workload_rows[0]["groups"][0]["group_code"] == "46-26"
    assert workload_rows[0]["groups"][0]["hours"] == 2.0


def test_drive_intake_skips_files_that_were_already_processed(db_session):
    file_payload = {
        "id": "contracts-184-25",
        "name": "184-25 Договори.xlsx",
        "mimeType": drive_intake.GOOGLE_DRIVE_XLSX_MIME,
        "modifiedTime": "2026-05-12T07:00:00Z",
    }

    first = drive_intake.process_next_drive_intake_file(
        db_session,
        folder_url="https://drive.google.com/drive/folders/intake-folder",
        branch_id="main",
        file_lister=lambda folder_id, service_account_json=None: [file_payload],
        downloader=lambda file_id, mime_type=None, service_account_json=None: _contracts_workbook_bytes(),
        import_job_runner=_run_import_job,
    )
    second = drive_intake.process_next_drive_intake_file(
        db_session,
        folder_url="https://drive.google.com/drive/folders/intake-folder",
        branch_id="main",
        file_lister=lambda folder_id, service_account_json=None: [file_payload],
        downloader=lambda file_id, mime_type=None, service_account_json=None: _contracts_workbook_bytes(),
        import_job_runner=_run_import_job,
    )

    assert first["processed"] == 1
    assert second == {"processed": 0, "skipped_already_processed": 1, "skipped_unsupported": 0}
    assert db_session.query(ImportJob).count() == 1
