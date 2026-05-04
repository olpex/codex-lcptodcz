from collections import defaultdict
from datetime import date, datetime, time, timezone
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Font
from sqlalchemy import func, or_

from app.api.deps import CurrentUser, DbSession, apply_branch_scope, ensure_same_branch, require_roles
from app.models import (
    AuditLog,
    Group,
    GroupMembership,
    JournalMonitorEntry,
    MembershipStatus,
    Performance,
    RoleName,
    ScheduleSlot,
    Teacher,
    Trainee,
    User,
)
from app.schemas.api import (
    ActiveGroupBetweenDatesResponse,
    EnrollRequest,
    GroupBulkDeleteRequest,
    GroupBulkDeleteResponse,
    ExpelRequest,
    GroupAuditLogResponse,
    GroupCreate,
    GroupResponse,
    GroupTeacherHoursResponse,
    GroupUpdate,
    MembershipResponse,
)
from app.services.audit import write_audit

router = APIRouter()


def _schedule_date_ranges(db: DbSession, group_ids: list[int]) -> dict[int, tuple[date, date]]:
    if not group_ids:
        return {}
    rows = (
        db.query(
            ScheduleSlot.group_id,
            func.min(ScheduleSlot.starts_at),
            func.max(ScheduleSlot.starts_at),
        )
        .filter(ScheduleSlot.group_id.in_(group_ids))
        .group_by(ScheduleSlot.group_id)
        .all()
    )
    return {
        group_id: (min_starts_at.date(), max_starts_at.date())
        for group_id, min_starts_at, max_starts_at in rows
        if min_starts_at and max_starts_at
    }


def _group_response(group: Group, schedule_ranges: dict[int, tuple[date, date]]) -> GroupResponse:
    response = GroupResponse.model_validate(group)
    schedule_range = schedule_ranges.get(group.id)
    if not schedule_range:
        return response
    start_date, end_date = schedule_range
    return response.model_copy(
        update={
            "start_date": response.start_date or start_date,
            "end_date": response.end_date or end_date,
        }
    )


def _delete_group_rows(db: DbSession, group: Group, delete_trainees: bool) -> dict[str, int | bool]:
    deleted_trainees_count = 0
    cleared_trainee_group_codes = 0
    if delete_trainees and group.code:
        now = datetime.now(timezone.utc)
        trainees_to_delete = (
            db.query(Trainee)
            .filter(
                Trainee.branch_id == group.branch_id,
                Trainee.group_code == group.code,
                Trainee.is_deleted.is_(False),
            )
            .all()
        )
        for trainee in trainees_to_delete:
            trainee.is_deleted = True
            trainee.deleted_at = now
            db.add(trainee)
        deleted_trainees_count = len(trainees_to_delete)
    if group.code:
        cleared_trainee_group_codes = (
            db.query(Trainee)
            .filter(
                Trainee.branch_id == group.branch_id,
                Trainee.group_code == group.code,
            )
            .update({"group_code": None}, synchronize_session=False)
        )

    deleted_schedule_slots = (
        db.query(ScheduleSlot)
        .filter(ScheduleSlot.group_id == group.id)
        .delete(synchronize_session=False)
    )
    deleted_memberships = (
        db.query(GroupMembership)
        .filter(GroupMembership.group_id == group.id)
        .delete(synchronize_session=False)
    )
    deleted_performances = (
        db.query(Performance)
        .filter(Performance.group_id == group.id)
        .delete(synchronize_session=False)
    )
    cleared_journal_monitor_matches = (
        db.query(JournalMonitorEntry)
        .filter(
            JournalMonitorEntry.branch_id == group.branch_id,
            JournalMonitorEntry.matched_group_id == group.id,
        )
        .update(
            {
                "matched_group_id": None,
                "has_group": False,
            },
            synchronize_session=False,
        )
    )

    db.delete(group)
    return {
        "delete_trainees": delete_trainees,
        "deleted_trainees_count": deleted_trainees_count,
        "cleared_trainee_group_codes": cleared_trainee_group_codes,
        "deleted_schedule_slots": deleted_schedule_slots,
        "deleted_memberships": deleted_memberships,
        "deleted_performances": deleted_performances,
        "cleared_journal_monitor_matches": cleared_journal_monitor_matches,
    }


@router.get("", response_model=list[GroupResponse])
def list_groups(db: DbSession, current_user: CurrentUser) -> list[GroupResponse]:
    groups = apply_branch_scope(db.query(Group), Group, current_user.branch_id).order_by(Group.created_at.desc()).all()
    schedule_ranges = _schedule_date_ranges(db, [group.id for group in groups])
    return [_group_response(group, schedule_ranges) for group in groups]


def _validate_period(date_from: date | None, date_to: date | None) -> None:
    if date_from and date_to and date_to < date_from:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Дата завершення має бути не раніше дати початку")


def _matches_group_search(group: Group, search: str | None) -> bool:
    tokens = [token.casefold() for token in (search or "").split() if token.strip()]
    if not tokens:
        return True

    haystack = f"{group.code} {group.name}".casefold()
    return all(token in haystack for token in tokens)


def _active_groups_between_dates(
    db: DbSession,
    branch_id: str,
    date_from: date | None,
    date_to: date | None,
    search: str | None = None,
) -> list[ActiveGroupBetweenDatesResponse]:
    _validate_period(date_from, date_to)
    filters = [Group.branch_id == branch_id]
    if date_from:
        window_start = datetime.combine(date_from, time.min, tzinfo=timezone.utc)
        filters.append(ScheduleSlot.starts_at >= window_start)
    if date_to:
        window_end = datetime.combine(date_to, time.max, tzinfo=timezone.utc)
        filters.append(ScheduleSlot.starts_at <= window_end)

    rows = (
        db.query(ScheduleSlot, Group, Teacher)
        .join(Group, Group.id == ScheduleSlot.group_id)
        .join(Teacher, Teacher.id == ScheduleSlot.teacher_id)
        .filter(*filters)
        .order_by(Group.code.asc(), ScheduleSlot.starts_at.asc())
        .all()
    )

    grouped: dict[int, dict] = {}
    for slot, group, teacher in rows:
        if not _matches_group_search(group, search):
            continue
        bucket = grouped.setdefault(
            group.id,
            {
                "group": group,
                "period_start_date": slot.starts_at.date(),
                "period_end_date": slot.starts_at.date(),
                "total_hours": 0.0,
                "teacher_hours": defaultdict(float),
                "teacher_names": {},
            },
        )
        slot_date = slot.starts_at.date()
        bucket["period_start_date"] = min(bucket["period_start_date"], slot_date)
        bucket["period_end_date"] = max(bucket["period_end_date"], slot_date)
        hours = float(slot.academic_hours or 0)
        bucket["total_hours"] += hours
        bucket["teacher_hours"][teacher.id] += hours
        display_name = " ".join(part for part in [teacher.last_name, teacher.first_name] if part).strip()
        bucket["teacher_names"][teacher.id] = display_name or f"Викладач #{teacher.id}"

    result: list[ActiveGroupBetweenDatesResponse] = []
    for bucket in grouped.values():
        group = bucket["group"]
        teachers = [
            GroupTeacherHoursResponse(
                teacher_id=teacher_id,
                teacher_name=bucket["teacher_names"][teacher_id],
                hours=round(hours, 2),
            )
            for teacher_id, hours in sorted(
                bucket["teacher_hours"].items(),
                key=lambda item: bucket["teacher_names"][item[0]].lower(),
            )
        ]
        result.append(
            ActiveGroupBetweenDatesResponse(
                group_id=group.id,
                code=group.code,
                name=group.name,
                training_start_date=group.start_date or bucket["period_start_date"],
                training_end_date=group.end_date or bucket["period_end_date"],
                period_start_date=bucket["period_start_date"],
                period_end_date=bucket["period_end_date"],
                total_hours=round(bucket["total_hours"], 2),
                teachers=teachers,
            )
        )

    return sorted(result, key=lambda item: item.code.lower())


@router.get("/active-between", response_model=list[ActiveGroupBetweenDatesResponse])
def list_active_groups_between_dates(
    db: DbSession,
    current_user: CurrentUser,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = Query(default=None),
) -> list[ActiveGroupBetweenDatesResponse]:
    return _active_groups_between_dates(db, current_user.branch_id, date_from, date_to, search)


@router.get("/active-between/export")
def export_active_groups_between_dates(
    db: DbSession,
    current_user: CurrentUser,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = Query(default=None),
) -> StreamingResponse:
    report = _active_groups_between_dates(db, current_user.branch_id, date_from, date_to, search)
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Групи за період"
    headers = [
        "Код групи",
        "Назва групи",
        "Початок навчання",
        "Завершення навчання",
        "Початок у вибраному періоді",
        "Кінець у вибраному періоді",
        "Викладач",
        "Години викладача",
        "Усього годин групи",
    ]
    sheet.append(headers)
    for cell in sheet[1]:
        cell.font = Font(bold=True)

    for item in report:
        if item.teachers:
            for teacher in item.teachers:
                sheet.append(
                    [
                        item.code,
                        item.name,
                        item.training_start_date.isoformat() if item.training_start_date else "",
                        item.training_end_date.isoformat() if item.training_end_date else "",
                        item.period_start_date.isoformat(),
                        item.period_end_date.isoformat(),
                        teacher.teacher_name,
                        teacher.hours,
                        item.total_hours,
                    ]
                )
        else:
            sheet.append(
                [
                    item.code,
                    item.name,
                    item.training_start_date.isoformat() if item.training_start_date else "",
                    item.training_end_date.isoformat() if item.training_end_date else "",
                    item.period_start_date.isoformat(),
                    item.period_end_date.isoformat(),
                    "",
                    0,
                    item.total_hours,
                ]
            )

    for column_cells in sheet.columns:
        max_length = max(len(str(cell.value or "")) for cell in column_cells)
        sheet.column_dimensions[column_cells[0].column_letter].width = min(max(max_length + 2, 12), 55)

    stream = BytesIO()
    workbook.save(stream)
    stream.seek(0)
    date_from_part = date_from.isoformat() if date_from else "all"
    date_to_part = date_to.isoformat() if date_to else "all"
    filename = f"active_groups_{date_from_part}_{date_to_part}.xlsx"
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post(
    "",
    response_model=GroupResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def create_group(payload: GroupCreate, db: DbSession, current_user: CurrentUser) -> GroupResponse:
    existing = (
        apply_branch_scope(db.query(Group), Group, current_user.branch_id)
        .filter(Group.code == payload.code)
        .first()
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Група з таким кодом вже існує")
    group = Group(**payload.model_dump(), branch_id=current_user.branch_id)
    db.add(group)
    db.commit()
    db.refresh(group)
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="group.create",
        entity_type="group",
        entity_id=str(group.id),
    )
    return GroupResponse.model_validate(group)


@router.post(
    "/bulk/delete",
    response_model=GroupBulkDeleteResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def bulk_delete_groups(
    payload: GroupBulkDeleteRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> GroupBulkDeleteResponse:
    requested_ids = list(dict.fromkeys(payload.group_ids))
    groups = (
        apply_branch_scope(db.query(Group), Group, current_user.branch_id)
        .filter(Group.id.in_(requested_ids))
        .all()
    )
    groups_by_id = {group.id: group for group in groups}
    target_groups = [groups_by_id[group_id] for group_id in requested_ids if group_id in groups_by_id]
    if not target_groups:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Групи для видалення не знайдено")

    deleted_ids: list[int] = []
    details_by_group: dict[str, dict[str, int | bool]] = {}
    deleted_trainees_count = 0
    for group in target_groups:
        details = _delete_group_rows(db, group, payload.delete_trainees)
        deleted_ids.append(group.id)
        details_by_group[str(group.id)] = details
        deleted_trainees_count += int(details["deleted_trainees_count"])

    db.commit()
    missing_ids = [group_id for group_id in requested_ids if group_id not in groups_by_id]
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="group.bulk_delete",
        entity_type="group_batch",
        entity_id=",".join(str(item) for item in deleted_ids[:20]),
        details={
            "deleted_count": len(deleted_ids),
            "deleted_ids": deleted_ids,
            "missing_ids": missing_ids,
            "delete_trainees": payload.delete_trainees,
            "deleted_trainees_count": deleted_trainees_count,
            "groups": details_by_group,
        },
    )
    return GroupBulkDeleteResponse(
        deleted_count=len(deleted_ids),
        deleted_ids=deleted_ids,
        missing_ids=missing_ids,
        deleted_trainees_count=deleted_trainees_count,
    )


@router.get("/{group_id}", response_model=GroupResponse)
def get_group(group_id: int, db: DbSession, current_user: CurrentUser) -> GroupResponse:
    group = db.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Групу не знайдено")
    ensure_same_branch(current_user, group, "Групу")
    return _group_response(group, _schedule_date_ranges(db, [group.id]))


@router.get("/{group_id}/audit", response_model=list[GroupAuditLogResponse])
def list_group_audit(
    group_id: int,
    db: DbSession,
    current_user: CurrentUser,
    limit: int = Query(default=20, ge=1, le=100),
) -> list[GroupAuditLogResponse]:
    group = db.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Групу не знайдено")
    ensure_same_branch(current_user, group, "Групу")

    membership_ids = [
        str(item.id)
        for item in db.query(GroupMembership.id).filter(GroupMembership.group_id == group_id).all()
    ]
    filters = [
        (AuditLog.entity_type == "group") & (AuditLog.entity_id == str(group_id)),
        (AuditLog.entity_type == "group_membership") & (AuditLog.details_json["group_id"].as_integer() == group_id),
    ]
    if membership_ids:
        filters.append((AuditLog.entity_type == "group_membership") & (AuditLog.entity_id.in_(membership_ids)))

    rows = (
        db.query(AuditLog, User.full_name)
        .outerjoin(User, User.id == AuditLog.actor_user_id)
        .filter(or_(*filters))
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        GroupAuditLogResponse(
            id=audit.id,
            actor_user_id=audit.actor_user_id,
            actor_name=actor_name,
            action=audit.action,
            entity_type=audit.entity_type,
            entity_id=audit.entity_id,
            details=audit.details_json,
            created_at=audit.created_at,
        )
        for audit, actor_name in rows
    ]


@router.put(
    "/{group_id}",
    response_model=GroupResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def update_group(group_id: int, payload: GroupUpdate, db: DbSession, current_user: CurrentUser) -> GroupResponse:
    group = db.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Групу не знайдено")
    ensure_same_branch(current_user, group, "Групу")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(group, key, value)
    db.add(group)
    db.commit()
    db.refresh(group)
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="group.update",
        entity_type="group",
        entity_id=str(group.id),
    )
    return GroupResponse.model_validate(group)


@router.delete(
    "/{group_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def delete_group(
    group_id: int,
    db: DbSession,
    current_user: CurrentUser,
    delete_trainees: bool = Query(default=False, description="Також soft-delete усіх слухачів цієї групи"),
) -> None:
    group = db.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Групу не знайдено")
    ensure_same_branch(current_user, group, "Групу")

    details = _delete_group_rows(db, group, delete_trainees)
    db.commit()
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="group.delete",
        entity_type="group",
        entity_id=str(group_id),
        details=details,
    )



@router.get("/{group_id}/members", response_model=list[MembershipResponse])
def list_group_members(group_id: int, db: DbSession, current_user: CurrentUser) -> list[MembershipResponse]:
    group = db.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Групу не знайдено")
    ensure_same_branch(current_user, group, "Групу")
    memberships = db.query(GroupMembership).filter(GroupMembership.group_id == group_id).all()
    return [MembershipResponse.model_validate(membership) for membership in memberships]


@router.post(
    "/{group_id}/enroll",
    response_model=MembershipResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def enroll_trainee(
    group_id: int,
    payload: EnrollRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> MembershipResponse:
    group = db.get(Group, group_id)
    trainee = db.get(Trainee, payload.trainee_id)
    if not group or not trainee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Група або слухач не знайдені")
    ensure_same_branch(current_user, group, "Групу")
    ensure_same_branch(current_user, trainee, "Слухача")

    active_count = (
        db.query(GroupMembership)
        .filter(GroupMembership.group_id == group_id, GroupMembership.status == MembershipStatus.ACTIVE)
        .count()
    )
    if active_count >= group.capacity:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Група вже заповнена")

    existing = (
        db.query(GroupMembership)
        .filter(GroupMembership.group_id == group_id, GroupMembership.trainee_id == payload.trainee_id)
        .first()
    )
    if existing:
        existing.status = MembershipStatus.ACTIVE
        existing.expelled_at = None
        existing.expulsion_reason = None
        membership = existing
    else:
        membership = GroupMembership(group_id=group_id, trainee_id=payload.trainee_id, status=MembershipStatus.ACTIVE)
        db.add(membership)

    db.commit()
    db.refresh(membership)
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="group.enroll",
        entity_type="group_membership",
        entity_id=str(membership.id),
        details={"group_id": group_id, "trainee_id": payload.trainee_id},
    )
    return MembershipResponse.model_validate(membership)


@router.post(
    "/{group_id}/members/{trainee_id}/expel",
    response_model=MembershipResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def expel_trainee(
    group_id: int,
    trainee_id: int,
    payload: ExpelRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> MembershipResponse:
    group = db.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Групу не знайдено")
    ensure_same_branch(current_user, group, "Групу")
    membership = (
        db.query(GroupMembership)
        .filter(GroupMembership.group_id == group_id, GroupMembership.trainee_id == trainee_id)
        .first()
    )
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Членство не знайдено")
    membership.status = MembershipStatus.EXPELLED
    membership.expelled_at = datetime.now(timezone.utc)
    membership.expulsion_reason = payload.reason
    db.add(membership)
    db.commit()
    db.refresh(membership)
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="group.expel",
        entity_type="group_membership",
        entity_id=str(membership.id),
        details={"group_id": group_id, "trainee_id": trainee_id, "reason": payload.reason},
    )
    return MembershipResponse.model_validate(membership)
