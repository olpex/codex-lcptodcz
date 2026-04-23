from uuid import uuid4

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile, status

from app.api.deps import CurrentUser, DbSession, require_roles
from app.models import Document, ExportJob, ImportJob, JobStatus, RoleName
from app.schemas.api import ExportRequest, JobResponse
from app.services.audit import write_audit
from app.services.storage import detect_document_type, persist_upload
from app.tasks.worker import process_export_job_task, process_import_job_task

router = APIRouter()


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
    x_idempotency_key: str | None = Header(default=None),
) -> JobResponse:
    doc_type = detect_document_type(file.filename)
    if doc_type.value not in {"xlsx", "pdf", "docx"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Підтримуються лише .xlsx, .pdf, .docx")

    idem_key = x_idempotency_key or f"import-{uuid4().hex}"
    existing = db.query(ImportJob).filter(ImportJob.idempotency_key == idem_key).first()
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
    )
    db.add(document)
    db.flush()

    job = ImportJob(
        idempotency_key=idem_key,
        document_id=document.id,
        status=JobStatus.QUEUED,
        message="Заявку на імпорт створено",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    process_import_job_task.delay(job.id)
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="documents.import.create_job",
        entity_type="import_job",
        entity_id=str(job.id),
        details={"document_id": document.id, "file_name": document.file_name},
    )
    return JobResponse.model_validate(job)


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
    idem_key = x_idempotency_key or f"export-{payload.report_type}-{payload.export_format}-{uuid4().hex}"
    existing = db.query(ExportJob).filter(ExportJob.idempotency_key == idem_key).first()
    if existing:
        return JobResponse.model_validate(existing)

    job = ExportJob(
        idempotency_key=idem_key,
        report_type=payload.report_type,
        export_format=payload.export_format,
        status=JobStatus.QUEUED,
        message="Заявку на експорт створено",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    process_export_job_task.delay(job.id)
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="documents.export.create_job",
        entity_type="export_job",
        entity_id=str(job.id),
        details={"report_type": payload.report_type, "format": payload.export_format},
    )
    return JobResponse.model_validate(job)

