from fastapi import APIRouter, HTTPException, status

from app.api.deps import CurrentUser, DbSession, apply_branch_scope
from app.models import ExportJob, ImportJob
from app.schemas.api import JobResponse, JobStatusResponse

router = APIRouter()


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
