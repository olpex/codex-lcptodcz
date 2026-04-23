from fastapi import APIRouter, HTTPException, status

from app.api.deps import CurrentUser, DbSession
from app.models import ExportJob, ImportJob
from app.schemas.api import JobResponse, JobStatusResponse

router = APIRouter()


@router.get("/{job_id}", response_model=JobStatusResponse)
def get_job_status(job_id: int, db: DbSession, _: CurrentUser) -> JobStatusResponse:
    import_job = db.get(ImportJob, job_id)
    if import_job:
        return JobStatusResponse(job_type="import", job=JobResponse.model_validate(import_job))

    export_job = db.get(ExportJob, job_id)
    if export_job:
        return JobStatusResponse(job_type="export", job=JobResponse.model_validate(export_job))

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job не знайдено")

