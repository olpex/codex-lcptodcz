from datetime import date

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, DbSession
from app.schemas.api import WorkloadResponse
from app.services.import_export import collect_teacher_workload_summary

router = APIRouter()


@router.get("", response_model=list[WorkloadResponse])
def get_workload(
    db: DbSession,
    current_user: CurrentUser,
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
) -> list[WorkloadResponse]:
    summary = collect_teacher_workload_summary(db, current_user.branch_id, date_from=date_from, date_to=date_to)
    return [
        WorkloadResponse(
            teacher_id=row["teacher_id"],
            row_number=row["row_number"],
            teacher_name=row["teacher_name"],
            total_hours=row["total_hours"],
            annual_load_hours=row["annual_load_hours"],
            remaining_hours=row["remaining_hours"],
        )
        for row in summary
    ]
