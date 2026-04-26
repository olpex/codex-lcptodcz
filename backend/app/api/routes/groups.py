from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import CurrentUser, DbSession, apply_branch_scope, ensure_same_branch, require_roles
from app.models import Group, GroupMembership, MembershipStatus, Performance, RoleName, ScheduleSlot, Trainee
from app.schemas.api import (
    EnrollRequest,
    ExpelRequest,
    GroupCreate,
    GroupResponse,
    GroupUpdate,
    MembershipResponse,
)
from app.services.audit import write_audit

router = APIRouter()


@router.get("", response_model=list[GroupResponse])
def list_groups(db: DbSession, current_user: CurrentUser) -> list[GroupResponse]:
    groups = apply_branch_scope(db.query(Group), Group, current_user.branch_id).order_by(Group.created_at.desc()).all()
    return [GroupResponse.model_validate(group) for group in groups]


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


@router.get("/{group_id}", response_model=GroupResponse)
def get_group(group_id: int, db: DbSession, current_user: CurrentUser) -> GroupResponse:
    group = db.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Групу не знайдено")
    ensure_same_branch(current_user, group, "Групу")
    return GroupResponse.model_validate(group)


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

    # Explicitly clean related rows to avoid FK violations in production DBs.
    deleted_schedule_slots = (
        db.query(ScheduleSlot)
        .filter(ScheduleSlot.group_id == group_id)
        .delete(synchronize_session=False)
    )
    deleted_memberships = (
        db.query(GroupMembership)
        .filter(GroupMembership.group_id == group_id)
        .delete(synchronize_session=False)
    )
    deleted_performances = (
        db.query(Performance)
        .filter(Performance.group_id == group_id)
        .delete(synchronize_session=False)
    )

    db.delete(group)
    db.commit()
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="group.delete",
        entity_type="group",
        entity_id=str(group_id),
        details={
            "delete_trainees": delete_trainees,
            "deleted_trainees_count": deleted_trainees_count,
            "cleared_trainee_group_codes": cleared_trainee_group_codes,
            "deleted_schedule_slots": deleted_schedule_slots,
            "deleted_memberships": deleted_memberships,
            "deleted_performances": deleted_performances,
        },
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
        details={"reason": payload.reason},
    )
    return MembershipResponse.model_validate(membership)
