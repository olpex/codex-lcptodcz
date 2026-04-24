from datetime import datetime
from typing import Iterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.api.deps import CurrentUser, DbSession
from app.models import Group, GroupMembership, GroupStatus, MembershipStatus, Performance, Room, ScheduleSlot
from app.schemas.api import DashboardKPIResponse

router = APIRouter()


@router.get("/kpi", response_model=DashboardKPIResponse)
def get_kpi(db: DbSession, current_user: CurrentUser) -> DashboardKPIResponse:
    active_groups = (
        db.query(Group)
        .filter(Group.branch_id == current_user.branch_id, Group.status == GroupStatus.ACTIVE)
        .count()
    )
    active_trainees = (
        db.query(GroupMembership)
        .join(Group, Group.id == GroupMembership.group_id)
        .filter(GroupMembership.status == MembershipStatus.ACTIVE)
        .filter(Group.branch_id == current_user.branch_id)
        .count()
    )

    rooms_count = max(db.query(Room).filter(Room.branch_id == current_user.branch_id).count(), 1)
    slots_count = (
        db.query(ScheduleSlot)
        .join(Group, Group.id == ScheduleSlot.group_id)
        .filter(Group.branch_id == current_user.branch_id)
        .count()
    )
    max_slots_month = rooms_count * 22 * 4
    facility_load_pct = round(min((slots_count / max_slots_month) * 100, 100), 2)

    performance_rows = (
        db.query(Performance)
        .join(Group, Group.id == Performance.group_id)
        .filter(Group.branch_id == current_user.branch_id)
        .all()
    )
    if performance_rows:
        training_plan_progress_pct = round(
            sum(row.progress_pct for row in performance_rows) / len(performance_rows),
            2,
        )
        employment_rate = sum(1 for row in performance_rows if row.employment_flag) / len(performance_rows)
    else:
        training_plan_progress_pct = 0.0
        employment_rate = 0.76

    forecast_graduation = int(active_trainees * 0.92)
    forecast_employment = int(forecast_graduation * employment_rate)

    return DashboardKPIResponse(
        active_groups=active_groups,
        active_trainees=active_trainees,
        facility_load_pct=facility_load_pct,
        training_plan_progress_pct=training_plan_progress_pct,
        forecast_graduation=forecast_graduation,
        forecast_employment=forecast_employment,
    )


@router.get("/kpi/stream")
def stream_kpi(db: DbSession, current_user: CurrentUser) -> StreamingResponse:
    def event_stream() -> Iterator[str]:
        for _ in range(20):
            snapshot = get_kpi(db, current_user)
            payload = snapshot.model_dump_json()
            yield f"event: kpi\ndata: {payload}\n\n"
            yield "event: heartbeat\ndata: {}\n\n"
            import time

            time.sleep(5)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
