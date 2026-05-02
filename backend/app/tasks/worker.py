from datetime import datetime, timezone

from celery.utils.log import get_task_logger
from sqlalchemy.orm import Session

from app.celery_app import celery_app
from app.core.config import settings
from app.db.session import SessionLocal
from app.models import Document, ExportJob, ImportJob, JobStatus, OCRResult
from app.services.import_export import (
    IMPORT_UPDATE_MODES,
    collect_report_rows,
    mark_job_failed,
    mark_job_running,
    mark_job_success,
    parse_document_content,
    save_report_file,
    try_import_trainees,
)
from app.services.mail_ingest import ingest_mailbox
from app.services.ocr import extract_group_code_hint, guess_draft_from_text
from app.services.schedule_import import import_schedule_docx

logger = get_task_logger(__name__)


def _get_db() -> Session:
    return SessionLocal()


def _parsed_snapshot(parsed: dict) -> dict:
    snapshot = {key: value for key, value in parsed.items() if key != "data"}
    data = parsed.get("data")
    if isinstance(data, list):
        preview: list[dict] = []
        for row in data[:20]:
            if isinstance(row, dict):
                preview.append({str(key): str(value) if value is not None else "" for key, value in row.items()})
        snapshot["preview"] = preview
    return snapshot


@celery_app.task(
    bind=True,
    name="app.tasks.worker.process_import_job_task",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def process_import_job_task(self, import_job_id: int) -> dict:
    db = _get_db()
    try:
        job = db.get(ImportJob, import_job_id)
        if not job:
            return {"error": "job_not_found"}
        if job.status == JobStatus.SUCCEEDED:
            return {"status": "already_done"}
        if job.status == JobStatus.FAILED and (job.message or "").lower().startswith("скасовано"):
            return {"status": "canceled"}

        mark_job_running(job)
        db.add(job)
        db.commit()

        raw_import_mode = (job.result_payload or {}).get("import_mode") if isinstance(job.result_payload, dict) else None
        import_mode = raw_import_mode if raw_import_mode in IMPORT_UPDATE_MODES else "skip_existing"
        parsed = parse_document_content(job.document.file_path, job.document.file_type)
        import_result = {}
        if job.document.file_type.value in {"xlsx", "csv"}:
            import_result = try_import_trainees(db, parsed, job.branch_id, update_existing_mode=import_mode)
            touched_rows = (
                int(import_result.get("inserted") or 0)
                + int(import_result.get("updated_existing") or 0)
                + int(import_result.get("memberships_created") or 0)
                + int(import_result.get("skipped_existing") or 0)
            )
            if touched_rows <= 0:
                note = str(import_result.get("note") or "").strip()
                suffix = f" {note}" if note else ""
                raise ValueError(f"Excel-файл оброблено, але не імпортовано жодного слухача.{suffix}")
        elif job.document.file_type.value == "docx":
            import_result = import_schedule_docx(
                db,
                job.document.file_path,
                branch_id=job.branch_id,
                actor_user_id=job.document.created_by,
                update_existing_mode=import_mode,
            )
            created_slots = int(import_result.get("created_slots") or 0)
            skipped_groups = int(import_result.get("skipped_existing_groups") or 0)
            skipped_slots = int(import_result.get("skipped_existing_slots") or 0)
            if created_slots <= 0 and skipped_groups <= 0 and skipped_slots <= 0:
                raise ValueError("DOCX розклад оброблено, але жодного заняття не створено")

        initial_payload = job.result_payload if isinstance(job.result_payload, dict) else {}
        payload = {
            **initial_payload,
            "parsed": _parsed_snapshot(parsed),
            "import_mode": import_mode,
            "import_result": import_result,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }
        mark_job_success(job, payload, "Імпорт виконано")
        db.add(job)
        db.commit()
        return {"status": "ok", "job_id": import_job_id}
    except Exception as exc:
        logger.exception("Import job failed: %s", exc)
        db.rollback()
        job = db.get(ImportJob, import_job_id)
        if job:
            mark_job_failed(job, str(exc))
            db.add(job)
            db.commit()
        raise
    finally:
        db.close()


@celery_app.task(
    bind=True,
    name="app.tasks.worker.process_export_job_task",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def process_export_job_task(self, export_job_id: int) -> dict:
    db = _get_db()
    try:
        job = db.get(ExportJob, export_job_id)
        if not job:
            return {"error": "job_not_found"}
        if job.status == JobStatus.SUCCEEDED:
            return {"status": "already_done"}

        mark_job_running(job)
        db.add(job)
        db.commit()

        rows = collect_report_rows(db, job.report_type, job.branch_id, job.request_payload)
        file_path, doc_type = save_report_file(rows, job.report_type, job.export_format, job.request_payload)

        document = Document(
            file_name=file_path.rsplit("/", 1)[-1].rsplit("\\", 1)[-1],
            file_path=file_path,
            file_type=doc_type,
            source="export",
            mime_type=f"application/{job.export_format}",
            branch_id=job.branch_id,
        )
        db.add(document)
        db.flush()

        job.output_document_id = document.id
        mark_job_success(
            job,
            result_payload={"rows": len(rows), "output_document_id": document.id},
            message="Експорт виконано",
        )
        db.add(job)
        db.commit()
        return {"status": "ok", "job_id": export_job_id}
    except Exception as exc:
        logger.exception("Export job failed: %s", exc)
        db.rollback()
        job = db.get(ExportJob, export_job_id)
        if job:
            mark_job_failed(job, str(exc))
            db.add(job)
            db.commit()
        raise
    finally:
        db.close()


@celery_app.task(
    bind=True,
    name="app.tasks.worker.poll_mailbox_task",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 5},
)
def poll_mailbox_task(self, force: bool = False) -> dict:
    if not force and not settings.imap_auto_poll_enabled:
        return {"processed": 0, "disabled": True}
    db = _get_db()
    try:
        return ingest_mailbox(db)
    finally:
        db.close()


@celery_app.task(
    bind=True,
    name="app.tasks.worker.process_ocr_task",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def process_ocr_task(self, ocr_result_id: int) -> dict:
    db = _get_db()
    try:
        result = db.get(OCRResult, ocr_result_id)
        if not result:
            return {"error": "ocr_result_not_found"}
        document = db.get(Document, result.document_id) if result.document_id else None
        group_code_hint = extract_group_code_hint(document.file_name if document else "")
        draft_type, payload = guess_draft_from_text(result.extracted_text or "", group_code_hint)
        result.draft_type = draft_type
        result.structured_payload = payload
        db.add(result)
        db.commit()
        return {"status": "ok", "ocr_result_id": ocr_result_id}
    finally:
        db.close()
