from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import CurrentUser, DbSession, apply_branch_scope, ensure_same_branch, require_roles
from app.models import Group, GroupStatus, RoleName, Room, ScheduleSlot, Subject, Teacher
from app.schemas.api import ScheduleGenerateRequest, ScheduleSlotResponse, ScheduleSlotUpdate
from app.services.audit import write_audit

router = APIRouter()


def _get_or_create_schedule_placeholder_room(db: DbSession, branch_id: str) -> Room:
    room = db.query(Room).filter(Room.branch_id == branch_id).order_by(Room.id.asc()).first()
    if room:
        return room
    room = Room(branch_id=branch_id, name="Службова аудиторія", capacity=1)
    db.add(room)
    db.flush()
    return room


def _to_schedule_responses(db: DbSession, slots: list[ScheduleSlot]) -> list[ScheduleSlotResponse]:
    if not slots:
        return []

    group_ids = sorted({slot.group_id for slot in slots})
    teacher_ids = sorted({slot.teacher_id for slot in slots})
    subject_ids = sorted({slot.subject_id for slot in slots})
    room_ids = sorted({slot.room_id for slot in slots})

    groups = {item.id: item for item in db.query(Group).filter(Group.id.in_(group_ids)).all()}
    teachers = {item.id: item for item in db.query(Teacher).filter(Teacher.id.in_(teacher_ids)).all()}
    subjects = {item.id: item for item in db.query(Subject).filter(Subject.id.in_(subject_ids)).all()}
    rooms = {item.id: item for item in db.query(Room).filter(Room.id.in_(room_ids)).all()}

    responses: list[ScheduleSlotResponse] = []
    for slot in slots:
        group = groups.get(slot.group_id)
        teacher = teachers.get(slot.teacher_id)
        subject = subjects.get(slot.subject_id)
        room = rooms.get(slot.room_id)
        responses.append(
            ScheduleSlotResponse(
                id=slot.id,
                group_id=slot.group_id,
                teacher_id=slot.teacher_id,
                subject_id=slot.subject_id,
                room_id=slot.room_id,
                starts_at=slot.starts_at,
                ends_at=slot.ends_at,
                pair_number=slot.pair_number,
                academic_hours=float(slot.academic_hours or 0.0),
                group_code=group.code if group else None,
                group_name=group.name if group else None,
                group_start_date=group.start_date if group else None,
                group_end_date=group.end_date if group else None,
                teacher_name=f"{teacher.last_name} {teacher.first_name}" if teacher else None,
                subject_name=subject.name if subject else None,
                room_name=room.name if room else None,
                generated_by=slot.generated_by,
            )
        )
    return responses


@router.post(
    "/generate",
    response_model=list[ScheduleSlotResponse],
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def generate_schedule(payload: ScheduleGenerateRequest, db: DbSession, current_user: CurrentUser) -> list[ScheduleSlotResponse]:
    groups = (
        apply_branch_scope(db.query(Group), Group, current_user.branch_id)
        .filter(Group.status.in_([GroupStatus.ACTIVE, GroupStatus.PLANNED]))
        .order_by(Group.id.asc())
        .all()
    )
    teachers = (
        apply_branch_scope(db.query(Teacher), Teacher, current_user.branch_id)
        .filter(Teacher.is_active.is_(True))
        .order_by(Teacher.id.asc())
        .all()
    )
    subjects = apply_branch_scope(db.query(Subject), Subject, current_user.branch_id).order_by(Subject.id.asc()).all()
    if not groups or not teachers or not subjects:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Недостатньо даних для генерації (групи/викладачі/предмети)",
        )
    placeholder_room = _get_or_create_schedule_placeholder_room(db, current_user.branch_id)

    window_start = datetime.combine(payload.start_date, time.min, tzinfo=timezone.utc)
    window_end = datetime.combine(payload.start_date + timedelta(days=payload.days), time.max, tzinfo=timezone.utc)
    existing_slots = (
        db.query(ScheduleSlot)
        .join(Group, Group.id == ScheduleSlot.group_id)
        .filter(
            Group.branch_id == current_user.branch_id,
            ScheduleSlot.starts_at >= window_start,
            ScheduleSlot.starts_at <= window_end,
        )
        .all()
    )

    teacher_busy = {(slot.teacher_id, slot.starts_at) for slot in existing_slots}
    teacher_hours: dict[int, float] = {teacher.id: 0.0 for teacher in teachers}
    for slot in existing_slots:
        teacher_hours[slot.teacher_id] = teacher_hours.get(slot.teacher_id, 0.0) + max(
            0.0, (slot.ends_at - slot.starts_at).total_seconds() / 3600
        )

    day_hours = [(1, 9), (2, 11), (3, 13), (4, 15)]
    created: list[ScheduleSlot] = []
    for idx_group, group in enumerate(groups):
        for day in range(payload.days):
            base_day = payload.start_date + timedelta(days=day)
            subject = subjects[(idx_group + day) % len(subjects)]

            assigned = False
            for pair_number, hour in day_hours:
                slot_start = datetime.combine(base_day, time(hour=hour), tzinfo=timezone.utc)
                slot_end = slot_start + timedelta(hours=2)

                ordered_teachers = sorted(teachers, key=lambda teacher: (teacher_hours.get(teacher.id, 0.0), teacher.id))
                teacher = next((candidate for candidate in ordered_teachers if (candidate.id, slot_start) not in teacher_busy), None)

                if not teacher:
                    continue

                slot = ScheduleSlot(
                    group_id=group.id,
                    teacher_id=teacher.id,
                    subject_id=subject.id,
                    room_id=placeholder_room.id,
                    starts_at=slot_start,
                    ends_at=slot_end,
                    pair_number=pair_number,
                    academic_hours=2.0,
                    generated_by=current_user.id,
                )
                db.add(slot)
                created.append(slot)
                teacher_busy.add((teacher.id, slot_start))
                teacher_hours[teacher.id] = teacher_hours.get(teacher.id, 0.0) + 2.0
                assigned = True
                break

            if not assigned:
                # If no slot is available for this group/day, continue generation for others.
                continue
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
    return _to_schedule_responses(db, created)


@router.get("", response_model=list[ScheduleSlotResponse])
def list_schedule(
    db: DbSession,
    current_user: CurrentUser,
    group_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
) -> list[ScheduleSlotResponse]:
    query = db.query(ScheduleSlot).join(Group, Group.id == ScheduleSlot.group_id).filter(Group.branch_id == current_user.branch_id)
    if group_id:
        group = db.get(Group, group_id)
        if not group:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Групу не знайдено")
        ensure_same_branch(current_user, group, "Групу")
        query = query.filter(ScheduleSlot.group_id == group_id)
    if date_from:
        query = query.filter(ScheduleSlot.starts_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
    if date_to:
        query = query.filter(ScheduleSlot.starts_at <= datetime.combine(date_to, time.max, tzinfo=timezone.utc))

    slots = query.order_by(ScheduleSlot.starts_at.asc()).all()
    return _to_schedule_responses(db, slots)

@router.patch(
    "/{slot_id}",
    response_model=ScheduleSlotResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def update_schedule_slot(
    slot_id: int,
    payload: ScheduleSlotUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> ScheduleSlotResponse:
    slot = db.get(ScheduleSlot, slot_id)
    if not slot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заняття не знайдено")
    
    group = db.get(Group, slot.group_id)
    if not group or group.branch_id != current_user.branch_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Немає доступу до цієї групи")

    if payload.starts_at is not None:
        slot.starts_at = payload.starts_at
    if payload.ends_at is not None:
        slot.ends_at = payload.ends_at
    if payload.pair_number is not None:
        slot.pair_number = payload.pair_number
    if payload.teacher_id is not None:
        slot.teacher_id = payload.teacher_id
    if payload.room_id is not None:
        slot.room_id = payload.room_id

    db.add(slot)
    db.commit()
    db.refresh(slot)

    write_audit(
        db,
        actor_user_id=current_user.id,
        action="schedule.update",
        entity_type="schedule",
        entity_id=str(slot.id),
        details={"payload": payload.model_dump(mode="json", exclude_unset=True)},
    )
    return _to_schedule_responses(db, [slot])[0]
