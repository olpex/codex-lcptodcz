from pathlib import Path

from openpyxl import Workbook

from app.models import Trainee
from app.models import DocumentType
from app.services.import_export import parse_document_content, try_import_trainees


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
