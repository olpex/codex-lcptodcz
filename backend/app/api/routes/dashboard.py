from app.api.deps import CurrentUser, DbSession
from app.models import Group, GroupMembership, GroupStatus, MembershipStatus, Performance, Room, ScheduleSlot
from app.schemas.api import DashboardKPIResponse
from fastapi import APIRouter

router = APIRouter()


@router.get("/kpi", response_model=DashboardKPIResponse)
def get_kpi(db: DbSession, _: CurrentUser) -> DashboardKPIResponse:
    active_groups = db.query(Group).filter(Group.status == GroupStatus.ACTIVE).count()
    active_trainees = (
        db.query(GroupMembership)
        .filter(GroupMembership.status == MembershipStatus.ACTIVE)
        .count()
    )

    rooms_count = max(db.query(Room).count(), 1)
    slots_count = db.query(ScheduleSlot).count()
    max_slots_month = rooms_count * 22 * 4
    facility_load_pct = round(min((slots_count / max_slots_month) * 100, 100), 2)

    performance_rows = db.query(Performance).all()
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

