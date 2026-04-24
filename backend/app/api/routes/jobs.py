from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import CurrentUser, DbSession, apply_branch_scope
from app.models import ExportJob, ImportJob, JobStatus
from app.schemas.api import JobListItemResponse, JobResponse, JobStatusResponse

router = APIRouter()


@router.get("", response_model=list[JobListItemResponse])
def list_jobs(
    db: DbSession,
    current_user: CurrentUser,
    job_type: str | None = Query(default=None, pattern="^(import|export)$"),
    status_filter: JobStatus | None = Query(default=None, alias="status"),
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[JobListItemResponse]:
    items: list[JobListItemResponse] = []

    if job_type in (None, "import"):
        import_query = apply_branch_scope(db.query(ImportJob), ImportJob, current_user.branch_id)
        if status_filter:
            import_query = import_query.filter(ImportJob.status == status_filter)
        if date_from:
            import_query = import_query.filter(ImportJob.created_at >= date_from)
        if date_to:
            import_query = import_query.filter(ImportJob.created_at <= date_to)

        import_jobs = import_query.order_by(ImportJob.created_at.desc()).limit(limit).all()
        items.extend(
            JobListItemResponse(
                job_type="import",
                job=JobResponse.model_validate(job),
                document_id=job.document_id,
            )
            for job in import_jobs
        )

    if job_type in (None, "export"):
        export_query = apply_branch_scope(db.query(ExportJob), ExportJob, current_user.branch_id)
        if status_filter:
            export_query = export_query.filter(ExportJob.status == status_filter)
        if date_from:
            export_query = export_query.filter(ExportJob.created_at >= date_from)
        if date_to:
            export_query = export_query.filter(ExportJob.created_at <= date_to)

        export_jobs = export_query.order_by(ExportJob.created_at.desc()).limit(limit).all()
        items.extend(
            JobListItemResponse(
                job_type="export",
                job=JobResponse.model_validate(job),
                report_type=job.report_type,
                export_format=job.export_format,
                output_document_id=job.output_document_id,
            )
            for job in export_jobs
        )

    items.sort(key=lambda item: item.job.created_at, reverse=True)
    return items[:limit]


@router.get("/{job_id}", response_model=JobStatusResponse)
def get_job_status(job_id: int, db: DbSession, current_user: CurrentUser) -> JobStatusResponse:
    import_job = (
        apply_branch_scope(db.query(ImportJob), ImportJob, current_user.branch_id)
        .filter(ImportJob.id == job_id)
        .first()
    )
    if import_job:
        return JobStatusResponse(job_type="import", job=JobResponse.model_validate(import_job))

    export_job = (
        apply_branch_scope(db.query(ExportJob), ExportJob, current_user.branch_id)
        .filter(ExportJob.id == job_id)
        .first()
    )
    if export_job:
        return JobStatusResponse(job_type="export", job=JobResponse.model_validate(export_job))

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job не знайдено")
