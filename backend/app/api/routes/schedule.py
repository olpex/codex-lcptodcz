from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import CurrentUser, DbSession, require_roles
from app.models import Group, GroupStatus, RoleName, Room, ScheduleSlot, Subject, Teacher
from app.schemas.api import ScheduleGenerateRequest, ScheduleSlotResponse
from app.services.audit import write_audit

router = APIRouter()


@router.post(
    "/generate",
    response_model=list[ScheduleSlotResponse],
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def generate_schedule(payload: ScheduleGenerateRequest, db: DbSession, current_user: CurrentUser) -> list[ScheduleSlotResponse]:
    groups = db.query(Group).filter(Group.status.in_([GroupStatus.ACTIVE, GroupStatus.PLANNED])).all()
    teachers = db.query(Teacher).filter(Teacher.is_active.is_(True)).all()
    rooms = db.query(Room).all()
    subjects = db.query(Subject).all()
    if not groups or not teachers or not rooms or not subjects:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Недостатньо даних для генерації (групи/викладачі/аудиторії/предмети)",
        )

    created: list[ScheduleSlot] = []
    for idx_group, group in enumerate(groups):
        for day in range(payload.days):
            base_day = payload.start_date + timedelta(days=day)
            slot_start = datetime.combine(base_day, time(hour=9 + (idx_group % 4) * 2), tzinfo=timezone.utc)
            slot_end = slot_start + timedelta(hours=2)
            teacher = teachers[(idx_group + day) % len(teachers)]
            room = rooms[(idx_group + day) % len(rooms)]
            subject = subjects[(idx_group + day) % len(subjects)]
            slot = ScheduleSlot(
                group_id=group.id,
                teacher_id=teacher.id,
                subject_id=subject.id,
                room_id=room.id,
                starts_at=slot_start,
                ends_at=slot_end,
                generated_by=current_user.id,
            )
            db.add(slot)
            created.append(slot)
    db.commit()
    for slot in created:
        db.refresh(slot)

    write_audit(
        db,
        actor_user_id=current_user.id,
        action="schedule.generate",
        entity_type="schedule",
        entity_id=f"{len(created)}",
        details={"start_date": payload.start_date.isoformat(), "days": payload.days},
    )
    return [ScheduleSlotResponse.model_validate(slot) for slot in created]


@router.get("", response_model=list[ScheduleSlotResponse])
def list_schedule(
    db: DbSession,
    _: CurrentUser,
    group_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
) -> list[ScheduleSlotResponse]:
    query = db.query(ScheduleSlot)
    if group_id:
        query = query.filter(ScheduleSlot.group_id == group_id)
    if date_from:
        query = query.filter(ScheduleSlot.starts_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
    if date_to:
        query = query.filter(ScheduleSlot.starts_at <= datetime.combine(date_to, time.max, tzinfo=timezone.utc))

    slots = query.order_by(ScheduleSlot.starts_at.asc()).all()
    return [ScheduleSlotResponse.model_validate(slot) for slot in slots]

