import csv
import io
from datetime import date, datetime, timezone
from pathlib import Path
from uuid import uuid4

from docx import Document as DocxDocument
from fpdf import FPDF
from openpyxl import Workbook, load_workbook
from pypdf import PdfReader
from sqlalchemy.orm import Session

from app.models import (
    Document,
    DocumentType,
    ExportJob,
    GroupMembership,
    ImportJob,
    JobStatus,
    MembershipStatus,
    Performance,
    ScheduleSlot,
    Teacher,
    Trainee,
)
from app.services.storage import storage_path


def parse_document_content(file_path: str, doc_type: DocumentType) -> dict:
    if doc_type == DocumentType.XLSX:
        workbook = load_workbook(file_path, data_only=True)
        sheet = workbook.active
        rows = list(sheet.iter_rows(values_only=True))
        if not rows:
            return {"rows": 0, "data": []}
        headers = [str(v).strip() if v is not None else "" for v in rows[0]]
        data = []
        for row in rows[1:]:
            payload = {}
            for idx, header in enumerate(headers):
                key = header if header else f"column_{idx + 1}"
                payload[key] = row[idx] if idx < len(row) else None
            data.append(payload)
        return {"rows": len(data), "headers": headers, "data": data[:100]}

    if doc_type == DocumentType.DOCX:
        doc = DocxDocument(file_path)
        text = "\n".join(paragraph.text for paragraph in doc.paragraphs if paragraph.text.strip())
        return {"rows": 1, "text_preview": text[:3000]}

    if doc_type == DocumentType.PDF:
        reader = PdfReader(file_path)
        text = "\n".join((page.extract_text() or "") for page in reader.pages)
        return {"rows": len(reader.pages), "text_preview": text[:3000]}

    if doc_type == DocumentType.CSV:
        with open(file_path, "r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            data = list(reader)
        return {"rows": len(data), "headers": reader.fieldnames or [], "data": data[:100]}

    return {"rows": 0, "data": []}


def try_import_trainees(db: Session, parsed: dict) -> dict:
    headers = [str(h).lower() for h in parsed.get("headers", [])]
    required = {"first_name", "last_name"}
    if not required.issubset(set(headers)):
        return {"inserted": 0, "note": "Структура не схожа на реєстр слухачів"}

    inserted = 0
    for row in parsed.get("data", []):
        keymap = {str(k).lower(): v for k, v in row.items()}
        first_name = str(keymap.get("first_name") or "").strip()
        last_name = str(keymap.get("last_name") or "").strip()
        if not first_name or not last_name:
            continue
        trainee = Trainee(
            first_name=first_name,
            last_name=last_name,
            status=str(keymap.get("status") or "active"),
        )
        db.add(trainee)
        inserted += 1
    db.commit()
    return {"inserted": inserted}


def collect_report_rows(db: Session, report_type: str) -> list[dict]:
    if report_type == "trainees":
        trainees = db.query(Trainee).all()
        return [
            {
                "id": trainee.id,
                "first_name": trainee.first_name,
                "last_name": trainee.last_name,
                "status": trainee.status,
                "created_at": trainee.created_at.isoformat(),
            }
            for trainee in trainees
        ]

    if report_type == "teacher_workload":
        teachers = db.query(Teacher).all()
        slots = db.query(ScheduleSlot).all()
        rows = []
        for teacher in teachers:
            total_hours = 0.0
            for slot in slots:
                if slot.teacher_id == teacher.id:
                    total_hours += (slot.ends_at - slot.starts_at).total_seconds() / 3600
            rows.append(
                {
                    "teacher_id": teacher.id,
                    "teacher_name": f"{teacher.last_name} {teacher.first_name}",
                    "total_hours": round(total_hours, 2),
                    "amount_uah": round(total_hours * teacher.hourly_rate, 2),
                }
            )
        return rows

    if report_type == "kpi":
        active_groups = (
            db.query(GroupMembership)
            .filter(GroupMembership.status == MembershipStatus.ACTIVE)
            .count()
        )
        progress = db.query(Performance).all()
        avg_progress = round(sum(record.progress_pct for record in progress) / len(progress), 2) if progress else 0.0
        return [
            {"metric": "active_memberships", "value": active_groups},
            {"metric": "avg_training_progress_pct", "value": avg_progress},
            {"metric": "generated_at", "value": datetime.now(timezone.utc).isoformat()},
        ]

    if report_type == "form_1pa":
        trainees_total = db.query(Trainee).count()
        completed = db.query(Trainee).filter(Trainee.status == "completed").count()
        return [
            {"field": "period", "value": date.today().isoformat()},
            {"field": "trainees_total", "value": trainees_total},
            {"field": "trainees_completed", "value": completed},
            {"field": "employment_rate_estimate", "value": 0.76},
        ]

    return []


def save_report_file(report_rows: list[dict], report_type: str, export_format: str) -> tuple[str, DocumentType]:
    out_dir = storage_path()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    base_name = f"{report_type}_{stamp}_{uuid4().hex[:8]}"

    if export_format == "csv":
        out_file = out_dir / f"{base_name}.csv"
        fieldnames = list(report_rows[0].keys()) if report_rows else ["empty"]
        with out_file.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            for row in report_rows:
                writer.writerow(row)
        return str(out_file), DocumentType.CSV

    if export_format == "xlsx":
        workbook = Workbook()
        sheet = workbook.active
        if report_rows:
            headers = list(report_rows[0].keys())
            sheet.append(headers)
            for row in report_rows:
                sheet.append([row.get(col) for col in headers])
        else:
            sheet.append(["empty"])
        out_file = out_dir / f"{base_name}.xlsx"
        workbook.save(out_file)
        return str(out_file), DocumentType.XLSX

    out_file = out_dir / f"{base_name}.pdf"
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=11)
    pdf.multi_cell(0, 8, f"Звіт: {report_type}")
    pdf.ln(2)
    for row in report_rows[:200]:
        pdf.multi_cell(0, 7, "; ".join(f"{k}: {v}" for k, v in row.items()))
    pdf.output(str(out_file))
    return str(out_file), DocumentType.PDF


def mark_job_running(job: ImportJob | ExportJob) -> None:
    job.status = JobStatus.RUNNING
    job.started_at = datetime.now(timezone.utc)


def mark_job_success(job: ImportJob | ExportJob, result_payload: dict, message: str | None = None) -> None:
    job.status = JobStatus.SUCCEEDED
    job.result_payload = result_payload
    job.message = message
    job.finished_at = datetime.now(timezone.utc)


def mark_job_failed(job: ImportJob | ExportJob, message: str) -> None:
    job.status = JobStatus.FAILED
    job.message = message
    job.finished_at = datetime.now(timezone.utc)
    job.retries = (job.retries or 0) + 1
