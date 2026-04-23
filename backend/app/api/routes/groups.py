from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import CurrentUser, DbSession, require_roles
from app.models import Group, GroupMembership, MembershipStatus, RoleName, Trainee
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
def list_groups(db: DbSession, _: CurrentUser) -> list[GroupResponse]:
    groups = db.query(Group).order_by(Group.created_at.desc()).all()
    return [GroupResponse.model_validate(group) for group in groups]


@router.post(
    "",
    response_model=GroupResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def create_group(payload: GroupCreate, db: DbSession, current_user: CurrentUser) -> GroupResponse:
    existing = db.query(Group).filter(Group.code == payload.code).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Група з таким кодом вже існує")
    group = Group(**payload.model_dump())
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
def get_group(group_id: int, db: DbSession, _: CurrentUser) -> GroupResponse:
    group = db.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Групу не знайдено")
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
def delete_group(group_id: int, db: DbSession, current_user: CurrentUser) -> None:
    group = db.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Групу не знайдено")
    db.delete(group)
    db.commit()
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="group.delete",
        entity_type="group",
        entity_id=str(group_id),
    )


@router.get("/{group_id}/members", response_model=list[MembershipResponse])
def list_group_members(group_id: int, db: DbSession, _: CurrentUser) -> list[MembershipResponse]:
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

