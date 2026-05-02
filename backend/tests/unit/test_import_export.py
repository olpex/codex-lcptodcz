from datetime import datetime, timedelta, timezone
from pathlib import Path

from openpyxl import Workbook, load_workbook

from app.models import Group, Room, ScheduleSlot, Subject, Teacher, Trainee
from app.models import DocumentType
from app.services.import_export import (
    analyze_trainee_import_duplicates,
    collect_group_export_rows,
    collect_teacher_workload_summary,
    parse_document_content,
    try_import_trainees,
)


def test_parse_xlsx_and_import_trainees(tmp_path: Path, db_session):
    file_path = tmp_path / "trainees.xlsx"
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["first_name", "last_name", "status"])
    sheet.append(["Олена", "Коваль", "active"])
    sheet.append(["Іван", "Сидоренко", "active"])
    workbook.save(file_path)

    parsed = parse_document_content(str(file_path), doc_type=DocumentType.XLSX)
    assert parsed["rows"] == 2
    assert "first_name" in [h.lower() for h in parsed["headers"]]

    result = try_import_trainees(db_session, parsed, "main")
    assert result["inserted"] == 2


def test_teacher_workload_summary_includes_all_active_teachers_with_negative_remaining(db_session):
    no_plan_with_hours = Teacher(
        branch_id="main",
        first_name="Петро Іванович",
        last_name="Бойко",
        annual_load_hours=0,
        is_active=True,
    )
    no_plan_without_hours = Teacher(
        branch_id="main",
        first_name="Олена Петрівна",
        last_name="Андрук",
        annual_load_hours=0,
        is_active=True,
    )
    planned_without_hours = Teacher(
        branch_id="main",
        first_name="Ірина Миколаївна",
        last_name="Шевченко",
        annual_load_hours=12,
        is_active=True,
    )
    inactive_teacher = Teacher(
        branch_id="main",
        first_name="Ігор Петрович",
        last_name="Ярема",
        annual_load_hours=12,
        is_active=False,
    )
    group = Group(branch_id="main", code="WG-001", name="Група навантаження", status="active")
    subject = Subject(branch_id="main", name="Предмет навантаження", hours_total=20)
    room = Room(branch_id="main", name="Аудиторія навантаження", capacity=20)
    db_session.add_all([no_plan_with_hours, no_plan_without_hours, planned_without_hours, inactive_teacher, group, subject, room])
    db_session.flush()

    starts_at = datetime(2026, 4, 1, 9, 30, tzinfo=timezone.utc)
    db_session.add(
        ScheduleSlot(
            group_id=group.id,
            teacher_id=no_plan_with_hours.id,
            subject_id=subject.id,
            room_id=room.id,
            starts_at=starts_at,
            ends_at=starts_at + timedelta(minutes=95),
            academic_hours=2.0,
            pair_number=1,
        )
    )
    db_session.commit()

    rows = collect_teacher_workload_summary(db_session, "main")

    assert [row["teacher_name"] for row in rows] == [
        "Андрук Олена Петрівна",
        "Бойко Петро Іванович",
        "Шевченко Ірина Миколаївна",
    ]
    assert [row["row_number"] for row in rows] == [1, 2, 3]
    assert rows[0]["remaining_hours"] == 0
    assert rows[1]["remaining_hours"] == -2
    assert rows[2]["remaining_hours"] == 12


def test_group_export_rows_include_existing_groups_and_teacher_hours(db_session):
    scheduled_group = Group(branch_id="main", code="72-26", name="Група з розкладом", status="active")
    empty_group = Group(branch_id="main", code="73-26", name="Група без розкладу", status="active")
    first_teacher = Teacher(branch_id="main", first_name="Ірина Петрівна", last_name="Коваль", is_active=True)
    second_teacher = Teacher(branch_id="main", first_name="Марія Іванівна", last_name="Бондар", is_active=True)
    subject = Subject(branch_id="main", name="Предмет груп", hours_total=20)
    room = Room(branch_id="main", name="Аудиторія груп", capacity=20)
    db_session.add_all([scheduled_group, empty_group, first_teacher, second_teacher, subject, room])
    db_session.flush()

    starts_at = datetime(2026, 4, 1, 9, 30, tzinfo=timezone.utc)
    db_session.add_all(
        [
            ScheduleSlot(
                group_id=scheduled_group.id,
                teacher_id=first_teacher.id,
                subject_id=subject.id,
                room_id=room.id,
                starts_at=starts_at,
                ends_at=starts_at + timedelta(minutes=95),
                academic_hours=2.0,
                pair_number=1,
            ),
            ScheduleSlot(
                group_id=scheduled_group.id,
                teacher_id=second_teacher.id,
                subject_id=subject.id,
                room_id=room.id,
                starts_at=starts_at + timedelta(days=1),
                ends_at=starts_at + timedelta(days=1, minutes=95),
                academic_hours=3.0,
                pair_number=2,
            ),
        ]
    )
    db_session.commit()

    rows = collect_group_export_rows(db_session, "main")

    assert rows == [
        {
            "Номер групи": "72-26",
            "Назва групи": "Група з розкладом",
            "Кількість годин": 5,
            "Викладач": "Бондар Марія Іванівна",
            "Кількість годин викладача в групі": 3,
        },
        {
            "Номер групи": "72-26",
            "Назва групи": "Група з розкладом",
            "Кількість годин": 5,
            "Викладач": "Коваль Ірина Петрівна",
            "Кількість годин викладача в групі": 2,
        },
        {
            "Номер групи": "73-26",
            "Назва групи": "Група без розкладу",
            "Кількість годин": 0,
            "Викладач": "",
            "Кількість годин викладача в групі": 0,
        },
    ]


def _create_contract_like_workbook(file_path: Path) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Додаток"
    sheet.append(["", "", "Список безробітних", "", "", "", "", "", "", "", "", "", "", "", ""])
    sheet.append(["", "", "Група 73-26  «Штучний інтелект»", "", "", "", "", "", "", "", "", "", "", "", ""])
    sheet.append(
        [
            "№",
            "Центр зайнятості, який направив безробітного  на професійне навчання",
            "ПІБ безробітного ",
            "Дата народження",
            "№ Договору",
            "Сертифікат",
            "Дата видачі сертифікату",
            "Індекс",
            "Адреса",
            "Паспорт: СЕРІЯ",
            "Паспорт: №",
            "Ким виданий",
            "Коли виданий",
            "Ідентифікаційний код",
            "Телефон",
        ]
    )
    sheet.append(
        [
            1,
            "Луцька філія",
            "Бортнік Тетяна Анатоліївна",
            "12.04.1984",
            "1499",
            "03032604210004401Н",
            "27.04.2026",
            "44500",
            "м. Луцьк, вул. Шевченка 1",
            "АЮ",
            "276684",
            "Луцьким РВ УДМС",
            "17.12.2015",
            "3079204140",
            "0978319450",
        ]
    )
    workbook.save(file_path)


def test_import_uses_dodatok_sheet_group_context_and_populates_fields(tmp_path: Path, db_session):
    file_path = tmp_path / "contracts.xlsx"
    _create_contract_like_workbook(file_path)

    parsed = parse_document_content(str(file_path), doc_type=DocumentType.XLSX)
    assert parsed["sheet_name"] == "Додаток"
    assert parsed["default_group_code"] == "73-26"

    result = try_import_trainees(db_session, parsed, "main")
    assert result["inserted"] == 1
    assert result["default_group_code"] == "73-26"

    trainee = db_session.query(Trainee).filter(Trainee.contract_number == "1499").first()
    assert trainee is not None
    assert trainee.group_code == "73-26"
    assert trainee.birth_date is not None
    assert trainee.employment_center_encrypted is not None
    assert trainee.address_encrypted is not None
    assert trainee.passport_series_encrypted is not None
    assert trainee.phone_encrypted is not None


def test_import_selects_first_sheet_when_it_contains_trainee_registry(tmp_path: Path, db_session):
    file_path = tmp_path / "contracts_first_sheet.xlsx"
    _create_contract_like_workbook(file_path)

    workbook = Workbook()
    first_sheet = workbook.active
    first_sheet.title = "Перший аркуш"
    for row in load_workbook(file_path).active.iter_rows(values_only=True):
        first_sheet.append(list(row))
    dodatok = workbook.create_sheet("Додаток")
    dodatok.append(["Службовий аркуш без реєстру слухачів"])
    workbook.save(file_path)

    parsed = parse_document_content(str(file_path), doc_type=DocumentType.XLSX)
    assert parsed["sheet_name"] == "Перший аркуш"

    result = try_import_trainees(db_session, parsed, "main")
    assert result["inserted"] == 1
    trainee = db_session.query(Trainee).filter(Trainee.contract_number == "1499").first()
    assert trainee is not None


def test_import_updates_existing_missing_fields_instead_of_skipping(tmp_path: Path, db_session):
    db_session.add(
        Trainee(
            branch_id="main",
            first_name="Тетяна Анатоліївна",
            last_name="Бортнік",
            status="active",
        )
    )
    db_session.commit()

    file_path = tmp_path / "contracts_update.xlsx"
    _create_contract_like_workbook(file_path)
    parsed = parse_document_content(str(file_path), doc_type=DocumentType.XLSX)

    result = try_import_trainees(db_session, parsed, "main")
    assert result["inserted"] == 0
    assert result["updated_existing"] == 1

    trainees = db_session.query(Trainee).filter(Trainee.last_name == "Бортнік").all()
    assert len(trainees) == 1
    trainee = trainees[0]
    assert trainee.contract_number == "1499"
    assert trainee.group_code == "73-26"
    assert trainee.employment_center_encrypted is not None


def test_import_restores_archived_existing_trainee(tmp_path: Path, db_session):
    db_session.add(
        Trainee(
            branch_id="main",
            first_name="Тетяна Анатоліївна",
            last_name="Бортнік",
            contract_number="1499",
            status="active",
            is_deleted=True,
            deleted_at=datetime.now(timezone.utc),
        )
    )
    db_session.commit()

    file_path = tmp_path / "contracts_restore.xlsx"
    _create_contract_like_workbook(file_path)
    parsed = parse_document_content(str(file_path), doc_type=DocumentType.XLSX)

    result = try_import_trainees(db_session, parsed, "main")
    assert result["inserted"] == 0
    assert result["updated_existing"] == 1
    assert result["restored_deleted"] == 1

    trainee = db_session.query(Trainee).filter(Trainee.contract_number == "1499").one()
    assert trainee.is_deleted is False
    assert trainee.deleted_at is None
    assert trainee.group_code == "73-26"


def test_import_overwrite_mode_updates_existing_non_empty_fields(tmp_path: Path, db_session):
    db_session.add(
        Trainee(
            branch_id="main",
            first_name="Тетяна Анатоліївна",
            last_name="Бортнік",
            contract_number="OLD-1499",
            status="completed",
            group_code="OLD-GROUP",
        )
    )
    db_session.commit()

    file_path = tmp_path / "contracts_overwrite.xlsx"
    _create_contract_like_workbook(file_path)
    parsed = parse_document_content(str(file_path), doc_type=DocumentType.XLSX)

    result = try_import_trainees(db_session, parsed, "main", update_existing_mode="overwrite")
    assert result["inserted"] == 0
    assert result["updated_existing"] == 1
    assert result["update_existing_mode"] == "overwrite"

    trainee = db_session.query(Trainee).filter(Trainee.last_name == "Бортнік").first()
    assert trainee is not None
    assert trainee.contract_number == "1499"
    assert trainee.group_code == "73-26"
    assert trainee.status == "active"


def test_import_skip_existing_mode_does_not_update_duplicate(tmp_path: Path, db_session):
    db_session.add(
        Trainee(
            branch_id="main",
            first_name="Тетяна Анатоліївна",
            last_name="Бортнік",
            contract_number="1499",
            status="completed",
            group_code="OLD-GROUP",
        )
    )
    db_session.commit()

    file_path = tmp_path / "contracts_skip_existing.xlsx"
    _create_contract_like_workbook(file_path)
    parsed = parse_document_content(str(file_path), doc_type=DocumentType.XLSX)

    result = try_import_trainees(db_session, parsed, "main", update_existing_mode="skip_existing")
    assert result["inserted"] == 0
    assert result["updated_existing"] == 0
    assert result["skipped_existing"] == 1
    assert result["update_existing_mode"] == "skip_existing"

    trainee = db_session.query(Trainee).filter(Trainee.contract_number == "1499").first()
    assert trainee is not None
    assert trainee.group_code == "OLD-GROUP"
    assert trainee.status == "completed"


def test_analyze_trainee_import_duplicates_reports_existing_rows(tmp_path: Path, db_session):
    db_session.add(
        Trainee(
            branch_id="main",
            first_name="Тетяна Анатоліївна",
            last_name="Бортнік",
            contract_number="1499",
            status="active",
        )
    )
    db_session.commit()

    file_path = tmp_path / "contracts_duplicate_preview.xlsx"
    _create_contract_like_workbook(file_path)
    parsed = parse_document_content(str(file_path), doc_type=DocumentType.XLSX)

    result = analyze_trainee_import_duplicates(db_session, parsed, "main")
    assert result["duplicate_count"] == 1
    assert result["new_count"] == 0
    assert result["invalid_count"] == 0
    assert result["duplicate_preview"][0]["incoming_name"] == "Бортнік Тетяна Анатоліївна"
    assert result["duplicate_preview"][0]["match_reason"] == "contract_number"
