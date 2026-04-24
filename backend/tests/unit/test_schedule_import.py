from pathlib import Path

import pytest
from docx import Document as DocxDocument

from app.models import ScheduleSlot
from app.services.schedule_import import import_schedule_docx, parse_schedule_docx


def _build_schedule_docx(path: Path) -> None:
    doc = DocxDocument()
    doc.add_paragraph("1 пара - 9.30 – 11.05")
    doc.add_paragraph("2 пара – 11.10 – 12.45")
    doc.add_paragraph("3 пара – 13.05 – 14.40")
    doc.add_paragraph("4 пара – 14.45– 16.20")
    doc.add_paragraph("за напрямом")
    doc.add_paragraph("Організація трудових відносин")
    doc.add_paragraph("Група № 167-25")
    doc.add_paragraph("з    21 жовтня – 24 жовтня 2025 р.")

    table = doc.add_table(rows=4, cols=8)
    headers = [
        "№п/п",
        "Назва предмета",
        "К-сть год.",
        "21.10",
        "22.10",
        "23.10",
        "24.10",
        "Прізвище, ім'я, по-батькові викладача",
    ]
    for idx, value in enumerate(headers):
        table.cell(0, idx).text = value

    row1 = ["1", "Трудовий договір", "3", "", "1п/2год", "", "2п/1год", "Штогрин Лілія Володимирівна"]
    row2 = ["2", "Охорона праці", "2", "3п/2год", "", "", "", "Костів Артур Романович"]
    total = ["", "Загальний обсяг навчального часу:", "5", "2", "2", "0", "1", ""]

    for idx, value in enumerate(row1):
        table.cell(1, idx).text = value
    for idx, value in enumerate(row2):
        table.cell(2, idx).text = value
    for idx, value in enumerate(total):
        table.cell(3, idx).text = value

    doc.save(path)


def test_parse_schedule_docx(tmp_path: Path):
    file_path = tmp_path / "schedule.docx"
    _build_schedule_docx(file_path)

    payload = parse_schedule_docx(str(file_path))
    assert payload["group_code"] == "167-25"
    assert payload["group_total_hours"] == 5
    assert payload["entries"]
    assert any(item["pair_number"] == 1 for item in payload["entries"])


def test_import_schedule_docx_with_conflict_detection(db_session, tmp_path: Path):
    file_path = tmp_path / "schedule.docx"
    _build_schedule_docx(file_path)

    summary = import_schedule_docx(db_session, str(file_path), branch_id="main", actor_user_id=1)
    db_session.commit()
    assert summary["created_slots"] == 3

    slots = db_session.query(ScheduleSlot).all()
    assert slots
    assert all(slot.pair_number is not None for slot in slots)
    assert all(slot.academic_hours > 0 for slot in slots)

    with pytest.raises(ValueError, match="Ставити заняття не можна"):
        import_schedule_docx(db_session, str(file_path), branch_id="main", actor_user_id=1)
    db_session.rollback()
