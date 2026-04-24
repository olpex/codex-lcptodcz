import csv
from datetime import date, datetime, timezone
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
    Group,
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


def _safe_pdf_text(value: str) -> str:
    # Built-in FPDF fonts only support latin-1; replace unsupported chars to avoid runtime crash.
    return value.encode("latin-1", errors="replace").decode("latin-1")


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


def try_import_trainees(db: Session, parsed: dict, branch_id: str) -> dict:
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
            branch_id=branch_id,
            first_name=first_name,
            last_name=last_name,
            status=str(keymap.get("status") or "active"),
        )
        db.add(trainee)
        inserted += 1
    db.commit()
    return {"inserted": inserted}


def collect_teacher_workload_summary(
    db: Session,
    branch_id: str,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[dict]:
    teachers = (
        db.query(Teacher)
        .filter(Teacher.branch_id == branch_id, Teacher.is_active.is_(True))
        .all()
    )
    query = (
        db.query(ScheduleSlot)
        .join(Group, Group.id == ScheduleSlot.group_id)
        .filter(Group.branch_id == branch_id)
    )
    if date_from:
        query = query.filter(ScheduleSlot.starts_at >= datetime.combine(date_from, datetime.min.time(), tzinfo=timezone.utc))
    if date_to:
        query = query.filter(ScheduleSlot.starts_at <= datetime.combine(date_to, datetime.max.time(), tzinfo=timezone.utc))
    slots = query.all()

    totals: dict[int, float] = {}
    for slot in slots:
        totals.setdefault(slot.teacher_id, 0.0)
        if slot.academic_hours is not None:
            totals[slot.teacher_id] += float(slot.academic_hours)
        else:
            totals[slot.teacher_id] += (slot.ends_at - slot.starts_at).total_seconds() / 3600

    rows: list[dict] = []
    for teacher in teachers:
        total_hours = round(totals.get(teacher.id, 0.0), 2)
        annual_load = round(float(teacher.annual_load_hours or 0.0), 2)
        # For report visibility include teachers who already teach or have planned annual load.
        if total_hours <= 0 and annual_load <= 0:
            continue
        remaining = round(max(annual_load - total_hours, 0.0), 2)
        rows.append(
            {
                "teacher_id": teacher.id,
                "teacher_name": f"{teacher.last_name} {teacher.first_name}",
                "total_hours": total_hours,
                "annual_load_hours": annual_load,
                "remaining_hours": remaining,
            }
        )
    rows.sort(key=lambda item: item["teacher_name"].lower())
    for idx, row in enumerate(rows, start=1):
        row["row_number"] = idx
    return rows


def collect_report_rows(db: Session, report_type: str, branch_id: str) -> list[dict]:
    if report_type == "trainees":
        trainees = db.query(Trainee).filter(Trainee.branch_id == branch_id).all()
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
        summary = collect_teacher_workload_summary(db, branch_id)
        return [
            {
                "Номер за порядком": row["row_number"],
                "Прізвище, ім'я та по батькові викладача": row["teacher_name"],
                "Загальна кількість годин": row["total_hours"],
                "Річне педнавантаження": row["annual_load_hours"],
                "Залишок годин": row["remaining_hours"],
            }
            for row in summary
        ]

    if report_type == "kpi":
        active_groups = (
            db.query(GroupMembership)
            .join(Group, Group.id == GroupMembership.group_id)
            .filter(GroupMembership.status == MembershipStatus.ACTIVE)
            .filter(Group.branch_id == branch_id)
            .count()
        )
        progress = db.query(Performance).filter(Performance.branch_id == branch_id).all()
        avg_progress = round(sum(record.progress_pct for record in progress) / len(progress), 2) if progress else 0.0
        return [
            {"metric": "active_memberships", "value": active_groups},
            {"metric": "avg_training_progress_pct", "value": avg_progress},
            {"metric": "generated_at", "value": datetime.now(timezone.utc).isoformat()},
        ]

    if report_type == "form_1pa":
        trainees_total = db.query(Trainee).filter(Trainee.branch_id == branch_id).count()
        completed = (
            db.query(Trainee)
            .filter(Trainee.branch_id == branch_id, Trainee.status == "completed")
            .count()
        )
        employed = (
            db.query(Performance)
            .filter(Performance.branch_id == branch_id, Performance.employment_flag.is_(True))
            .count()
        )
        return [
            {"field": "period", "value": date.today().isoformat()},
            {"field": "trainees_total", "value": trainees_total},
            {"field": "trainees_completed", "value": completed},
            {"field": "employed_after_training", "value": employed},
            {"field": "employment_rate_estimate", "value": round((employed / max(completed, 1)) * 100, 2)},
        ]

    if report_type == "employment":
        rows = (
            db.query(Performance, Trainee, Group)
            .join(Trainee, Trainee.id == Performance.trainee_id)
            .join(Group, Group.id == Performance.group_id)
            .filter(Performance.branch_id == branch_id, Group.branch_id == branch_id, Trainee.branch_id == branch_id)
            .all()
        )
        return [
            {
                "trainee_id": performance.trainee_id,
                "trainee_name": f"{trainee.last_name} {trainee.first_name}",
                "group_code": group.code,
                "progress_pct": performance.progress_pct,
                "attendance_pct": performance.attendance_pct,
                "employment_flag": performance.employment_flag,
            }
            for performance, trainee, group in rows
        ]

    if report_type == "financial":
        teachers = db.query(Teacher).filter(Teacher.branch_id == branch_id).all()
        slots = (
            db.query(ScheduleSlot)
            .join(Group, Group.id == ScheduleSlot.group_id)
            .filter(Group.branch_id == branch_id)
            .all()
        )
        rows: list[dict] = []
        total_amount = 0.0
        for teacher in teachers:
            total_hours = 0.0
            for slot in slots:
                if slot.teacher_id == teacher.id:
                    if slot.academic_hours is not None:
                        total_hours += float(slot.academic_hours)
                    else:
                        total_hours += (slot.ends_at - slot.starts_at).total_seconds() / 3600
            amount = round(total_hours * teacher.hourly_rate, 2)
            total_amount += amount
            rows.append(
                {
                    "teacher_id": teacher.id,
                    "teacher_name": f"{teacher.last_name} {teacher.first_name}",
                    "hourly_rate": teacher.hourly_rate,
                    "total_hours": round(total_hours, 2),
                    "amount_uah": amount,
                }
            )
        rows.append(
            {
                "teacher_id": "",
                "teacher_name": "TOTAL",
                "hourly_rate": "",
                "total_hours": "",
                "amount_uah": round(total_amount, 2),
            }
        )
        return rows

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
    pdf.cell(0, 8, _safe_pdf_text(f"Report: {report_type}"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)
    for row in report_rows[:200]:
        line = "; ".join(f"{k}: {v}" for k, v in row.items()).replace("_", " ")
        pdf.cell(0, 7, _safe_pdf_text(line[:120]), new_x="LMARGIN", new_y="NEXT")
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
