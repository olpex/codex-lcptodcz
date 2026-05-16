import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from celery.utils.log import get_task_logger
from sqlalchemy.orm import Session

from app.celery_app import celery_app
from app.core.config import settings
from app.db.session import SessionLocal
from app.models import Document, ExportJob, ImportJob, JobStatus, JournalMonitorSection, OCRResult
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
from app.services.drive_intake import (
    download_drive_file_bytes,
    process_next_drive_intake_file,
    resolve_drive_intake_service_account_json,
)
from app.services.mail_ingest import ingest_mailbox
from app.services.journal_monitor import list_drive_child_folders, process_journal_monitor_background_step
from app.services.ocr import extract_group_code_hint, guess_draft_from_text
from app.services.schedule_import import import_schedule_docx
from app.services.storage import storage_path

logger = get_task_logger(__name__)
_runtime_schema_checked = False


def _ensure_runtime_schema_once() -> None:
    global _runtime_schema_checked
    if _runtime_schema_checked:
        return
    from app.main import ensure_runtime_schema

    ensure_runtime_schema()
    _runtime_schema_checked = True


def _get_db() -> Session:
    _ensure_runtime_schema_once()
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


def _apply_group_hint(parsed: dict, payload: dict) -> dict:
    group_code_hint = str(payload.get("group_code_hint") or "").strip()
    if not group_code_hint or parsed.get("default_group_code"):
        return parsed

    return {
        **parsed,
        "default_group_code": group_code_hint,
        "default_group_name": parsed.get("default_group_name") or f"Група {group_code_hint}",
        "group_context_source": parsed.get("group_context_source") or "filename",
    }


def _safe_storage_filename(filename: str | None) -> str:
    cleaned = re.sub(r"[\\/]+", "_", (filename or "drive-file").strip()) or "drive-file"
    return cleaned[:240]


def _source_drive_payload(db: Session, job: ImportJob, payload: dict) -> dict:
    if payload.get("drive_file_id"):
        return payload

    source_job_id = payload.get("reprocess_of_job_id")
    if not source_job_id and isinstance(job.request_payload, dict):
        source_job_id = job.request_payload.get("reprocess_of_job_id")
    if not source_job_id:
        return payload

    try:
        source_job = db.get(ImportJob, int(source_job_id))
    except (TypeError, ValueError):
        return payload
    source_payload = source_job.result_payload if source_job and isinstance(source_job.result_payload, dict) else {}
    if not source_payload.get("drive_file_id"):
        return payload

    merged = {**source_payload, **payload}
    merged.setdefault("original_source", source_payload.get("source"))
    return merged


def _restore_missing_drive_document(db: Session, job: ImportJob, payload: dict) -> dict:
    document = job.document
    if not document or Path(document.file_path).exists():
        return payload
    if document.source != "drive_intake":
        return payload

    drive_payload = _source_drive_payload(db, job, payload)
    drive_file_id = str(drive_payload.get("drive_file_id") or "").strip()
    if not drive_file_id:
        return payload

    mime_type = str(drive_payload.get("drive_mime_type") or document.mime_type or "").strip() or None
    service_account_json = resolve_drive_intake_service_account_json(db, job.branch_id)
    file_bytes = download_drive_file_bytes(drive_file_id, mime_type, service_account_json)
    if not file_bytes:
        raise ValueError("Не вдалося повторно завантажити файл з Google Drive для імпорту")

    previous_path = document.file_path
    filename = _safe_storage_filename(str(drive_payload.get("drive_file_name") or document.file_name or "drive-file"))
    out_path = storage_path() / f"{uuid4().hex}_{filename}"
    with out_path.open("wb") as handle:
        handle.write(file_bytes)

    document.file_name = filename
    document.file_path = str(out_path)
    document.mime_type = mime_type or document.mime_type
    document.hash_sha256 = hashlib.sha256(file_bytes).hexdigest()

    restored_payload = {
        **drive_payload,
        "drive_restored_from_missing_path": previous_path,
        "drive_restored_at": datetime.now(timezone.utc).isoformat(),
    }
    job.result_payload = restored_payload
    db.add(document)
    db.add(job)
    db.commit()
    db.refresh(job)
    return restored_payload


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

        initial_payload = job.result_payload if isinstance(job.result_payload, dict) else {}
        initial_payload = _restore_missing_drive_document(db, job, initial_payload)
        raw_import_mode = initial_payload.get("import_mode")
        import_mode = raw_import_mode if raw_import_mode in IMPORT_UPDATE_MODES else "skip_existing"
        parsed = parse_document_content(job.document.file_path, job.document.file_type)
        import_result = {}
        if job.document.file_type.value in {"xlsx", "csv"}:
            parsed = _apply_group_hint(parsed, initial_payload)
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
        else:
            raise ValueError("Автоматичний імпорт підтримує лише .xls/.xlsx, .csv та .docx")

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
    if not settings.imap_fallback_enabled:
        return {
            "processed": 0,
            "disabled": True,
            "primary_channel": settings.mail_primary_channel.strip().lower() or "google_apps_script",
        }
    if not force and not settings.imap_auto_poll_enabled:
        return {"processed": 0, "disabled": True}
    db = _get_db()
    try:
        return ingest_mailbox(db)
    finally:
        db.close()


@celery_app.task(
    bind=True,
    name="app.tasks.worker.process_journal_monitor_auto_task",
)
def process_journal_monitor_auto_task(self) -> dict:
    db = _get_db()
    processed_sections = 0
    failed_sections = 0
    try:
        sections = (
            db.query(JournalMonitorSection)
            .filter(
                JournalMonitorSection.is_active.is_(True),
            )
            .all()
        )
        for section in sections:
            try:
                target_year = section.workload_auto_year or datetime.now(timezone.utc).year
                process_journal_monitor_background_step(
                    db,
                    section,
                    folder_lister=list_drive_child_folders,
                    target_year=target_year,
                )
                db.commit()
                processed_sections += 1
            except Exception as exc:
                logger.exception("Journal monitor auto processing failed for section %s: %s", section.id, exc)
                db.rollback()
                failed_sections += 1
        return {"processed_sections": processed_sections, "failed_sections": failed_sections}
    finally:
        db.close()


@celery_app.task(
    bind=True,
    name="app.tasks.worker.process_drive_intake_auto_task",
)
def process_drive_intake_auto_task(self) -> dict:
    if not settings.google_drive_intake_auto_enabled:
        return {"processed": 0, "disabled": True}
    db = _get_db()
    try:
        branch_id = settings.imap_branch_id or "main"
        result = process_next_drive_intake_file(
            db,
            branch_id=branch_id,
            service_account_json=resolve_drive_intake_service_account_json(db, branch_id),
            import_job_runner=process_import_job_task.run,
        )
        db.commit()
        return result
    except Exception as exc:
        logger.exception("Google Drive intake auto processing failed: %s", exc)
        db.rollback()
        return {"processed": 0, "failed": 1, "message": str(exc)}
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
