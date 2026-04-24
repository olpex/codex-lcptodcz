from pathlib import Path

from openpyxl import Workbook

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
