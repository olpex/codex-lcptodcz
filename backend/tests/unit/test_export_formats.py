from app.models import DocumentType
from app.services.import_export import save_report_file
from pypdf import PdfReader


def test_save_report_in_all_formats():
    rows = [
        {"metric": "Активні групи", "value": 3},
        {"metric": "Активні слухачі", "value": 54},
    ]

    csv_path, csv_type = save_report_file(rows, "kpi", "csv")
    xlsx_path, xlsx_type = save_report_file(rows, "kpi", "xlsx")
    pdf_path, pdf_type = save_report_file(rows, "kpi", "pdf")

    assert csv_type == DocumentType.CSV and csv_path.endswith(".csv")
    assert xlsx_type == DocumentType.XLSX and xlsx_path.endswith(".xlsx")
    assert pdf_type == DocumentType.PDF and pdf_path.endswith(".pdf")

    pdf_text = "\n".join((page.extract_text() or "") for page in PdfReader(pdf_path).pages)
    assert "Звіт: Показники" in pdf_text
    assert "Активні групи" in pdf_text
    assert "?" not in pdf_text
