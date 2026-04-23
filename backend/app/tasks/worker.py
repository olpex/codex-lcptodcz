from datetime import datetime, timezone

from celery.utils.log import get_task_logger
from sqlalchemy.orm import Session

from app.celery_app import celery_app
from app.db.session import SessionLocal
from app.models import Document, ExportJob, ImportJob, JobStatus, OCRResult
from app.services.import_export import (
    collect_report_rows,
    mark_job_failed,
    mark_job_running,
    mark_job_success,
    parse_document_content,
    save_report_file,
    try_import_trainees,
)
from app.services.mail_ingest import ingest_mailbox
from app.services.ocr import guess_draft_from_text

logger = get_task_logger(__name__)


def _get_db() -> Session:
    return SessionLocal()


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

        mark_job_running(job)
        db.add(job)
        db.commit()

        parsed = parse_document_content(job.document.file_path, job.document.file_type)
        import_result = {}
        if job.document.file_type.value in {"xlsx", "csv"}:
            import_result = try_import_trainees(db, parsed)

        payload = {
            "parsed": parsed,
            "import_result": import_result,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }
        mark_job_success(job, payload, "Імпорт виконано")
        db.add(job)
        db.commit()
        return {"status": "ok", "job_id": import_job_id}
    except Exception as exc:
        logger.exception("Import job failed: %s", exc)
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

        rows = collect_report_rows(db, job.report_type)
        file_path, doc_type = save_report_file(rows, job.report_type, job.export_format)

        document = Document(
            file_name=file_path.rsplit("/", 1)[-1].rsplit("\\", 1)[-1],
            file_path=file_path,
            file_type=doc_type,
            source="export",
            mime_type=f"application/{job.export_format}",
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
def poll_mailbox_task(self) -> dict:
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
        draft_type, payload = guess_draft_from_text(result.extracted_text or "")
        result.draft_type = draft_type
        result.structured_payload = payload
        db.add(result)
        db.commit()
        return {"status": "ok", "ocr_result_id": ocr_result_id}
    finally:
        db.close()

