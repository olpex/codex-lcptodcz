from uuid import uuid4
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from celery.utils.log import get_task_logger

from app.api.deps import CurrentUser, DbSession, apply_branch_scope, ensure_same_branch, require_roles
from app.models import Document, ExportJob, ImportJob, JobStatus, RoleName
from app.schemas.api import ExportRequest, JobResponse
from app.services.audit import write_audit
from app.services.import_export import IMPORT_UPDATE_MODES
from app.services.storage import detect_document_type, persist_upload
from app.tasks.worker import process_export_job_task, process_import_job_task

router = APIRouter()
logger = get_task_logger(__name__)


def _dispatch_with_fallback(task, job_id: int, job_kind: str) -> str:
    """
    Try queue-first dispatch. If broker is unavailable (common in serverless),
    run synchronously in-process to avoid API 500 on import/export actions.
    """
    try:
        task.delay(job_id)
        return "queued"
    except Exception as queue_exc:
        logger.warning("Queue dispatch failed for %s job %s: %s", job_kind, job_id, queue_exc)
        try:
            task.run(job_id)
            return "inline"
        except Exception as inline_exc:
            logger.exception("Inline execution failed for %s job %s: %s", job_kind, job_id, inline_exc)
            return "inline_failed"


def _with_dispatch_notice(job: JobResponse, dispatch_mode: str) -> JobResponse:
    if dispatch_mode == "inline":
        suffix = f" {job.message}" if job.message else ""
        job.message = f"Черга тимчасово недоступна. Операцію виконано одразу в API.{suffix}"
    elif dispatch_mode == "inline_failed":
        suffix = f" {job.message}" if job.message else ""
        job.message = f"Черга недоступна, а inline-виконання завершилось помилкою.{suffix}"
    return job


@router.post(
    "/import",
    response_model=JobResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def import_document(
    db: DbSession,
    current_user: CurrentUser,
    file: UploadFile = File(...),
    update_existing_mode: str = Form(default="missing_only"),
    x_idempotency_key: str | None = Header(default=None),
) -> JobResponse:
    doc_type = detect_document_type(file.filename)
    if doc_type.value not in {"xlsx", "pdf", "docx", "csv"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Підтримуються .xls/.xlsx, .pdf, .docx, .csv")
    if update_existing_mode not in IMPORT_UPDATE_MODES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Некоректний режим імпорту")

    raw_idem_key = x_idempotency_key or f"import-{uuid4().hex}"
    idem_key = f"{current_user.branch_id}:{raw_idem_key}"
    existing = (
        apply_branch_scope(db.query(ImportJob), ImportJob, current_user.branch_id)
        .filter(ImportJob.idempotency_key == idem_key)
        .first()
    )
    if existing:
        return JobResponse.model_validate(existing)

    path, sha256 = persist_upload(file)
    document = Document(
        file_name=file.filename or "uploaded_file",
        file_path=path,
        file_type=doc_type,
        mime_type=file.content_type,
        hash_sha256=sha256,
        source="upload",
        created_by=current_user.id,
        branch_id=current_user.branch_id,
    )
    db.add(document)
    db.flush()

    job = ImportJob(
        branch_id=current_user.branch_id,
        idempotency_key=idem_key,
        document_id=document.id,
        status=JobStatus.QUEUED,
        message="Заявку на імпорт створено",
        result_payload={"import_mode": update_existing_mode},
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    dispatch_mode = _dispatch_with_fallback(process_import_job_task, job.id, "import")
    db.refresh(job)
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="documents.import.create_job",
        entity_type="import_job",
        entity_id=str(job.id),
        details={
            "document_id": document.id,
            "file_name": document.file_name,
            "dispatch_mode": dispatch_mode,
            "import_mode": update_existing_mode,
        },
    )
    return _with_dispatch_notice(JobResponse.model_validate(job), dispatch_mode)


@router.post(
    "/export",
    response_model=JobResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def export_report(
    payload: ExportRequest,
    db: DbSession,
    current_user: CurrentUser,
    x_idempotency_key: str | None = Header(default=None),
) -> JobResponse:
    raw_idem_key = x_idempotency_key or f"export-{payload.report_type}-{payload.export_format}-{uuid4().hex}"
    idem_key = f"{current_user.branch_id}:{raw_idem_key}"
    existing = apply_branch_scope(db.query(ExportJob), ExportJob, current_user.branch_id).filter(ExportJob.idempotency_key == idem_key).first()
    if existing:
        return JobResponse.model_validate(existing)

    job = ExportJob(
        idempotency_key=idem_key,
        report_type=payload.report_type,
        export_format=payload.export_format,
        branch_id=current_user.branch_id,
        status=JobStatus.QUEUED,
        message="Заявку на експорт створено",
        request_payload={
            "teacher_ids": payload.teacher_ids,
            "start_date": payload.start_date.isoformat() if payload.start_date else None,
            "end_date": payload.end_date.isoformat() if payload.end_date else None,
        },
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    dispatch_mode = _dispatch_with_fallback(process_export_job_task, job.id, "export")
    db.refresh(job)
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="documents.export.create_job",
        entity_type="export_job",
        entity_id=str(job.id),
        details={"report_type": payload.report_type, "format": payload.export_format, "dispatch_mode": dispatch_mode},
    )
    return _with_dispatch_notice(JobResponse.model_validate(job), dispatch_mode)


@router.get("/{document_id}/download")
def download_document(document_id: int, db: DbSession, current_user: CurrentUser) -> FileResponse:
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Документ не знайдено")
    ensure_same_branch(current_user, document, "Документ")
    if not Path(document.file_path).exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Файл документа відсутній у сховищі")
    return FileResponse(
        path=document.file_path,
        filename=document.file_name,
        media_type=document.mime_type or "application/octet-stream",
    )
