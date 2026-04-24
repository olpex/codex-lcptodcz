from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, DbSession
from app.models import Group, ScheduleSlot, Teacher
from app.schemas.api import WorkloadResponse

router = APIRouter()


@router.get("", response_model=list[WorkloadResponse])
def get_workload(
    db: DbSession,
    current_user: CurrentUser,
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
) -> list[WorkloadResponse]:
    query = (
        db.query(ScheduleSlot)
        .join(Group, Group.id == ScheduleSlot.group_id)
        .filter(Group.branch_id == current_user.branch_id)
    )
    if date_from:
        query = query.filter(ScheduleSlot.starts_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
    if date_to:
        query = query.filter(ScheduleSlot.starts_at <= datetime.combine(date_to, time.max, tzinfo=timezone.utc))
    slots = query.all()

    teachers = {
        teacher.id: teacher
        for teacher in db.query(Teacher).filter(Teacher.branch_id == current_user.branch_id).all()
    }
    totals: dict[int, float] = {}
    for slot in slots:
        totals.setdefault(slot.teacher_id, 0.0)
        if slot.academic_hours is not None:
            totals[slot.teacher_id] += float(slot.academic_hours)
        else:
            totals[slot.teacher_id] += max(0.0, (slot.ends_at - slot.starts_at).total_seconds() / 3600)

    result = []
    for teacher_id, total_hours in totals.items():
        teacher = teachers.get(teacher_id)
        if not teacher:
            continue
        result.append(
            WorkloadResponse(
                teacher_id=teacher.id,
                teacher_name=f"{teacher.last_name} {teacher.first_name}",
                total_hours=round(total_hours, 2),
                amount_uah=round(total_hours * teacher.hourly_rate, 2),
            )
        )
    result.sort(key=lambda item: item.teacher_name)
    return result
