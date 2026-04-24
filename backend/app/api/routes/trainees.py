from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_

from app.api.deps import CurrentUser, DbSession, apply_branch_scope, ensure_same_branch, require_roles
from app.core.crypto import cipher
from app.models import RoleName, Trainee
from app.schemas.api import TraineeCreate, TraineeResponse, TraineeUpdate
from app.services.audit import write_audit

router = APIRouter()


def _to_response(trainee: Trainee) -> TraineeResponse:
    return TraineeResponse(
        id=trainee.id,
        branch_id=trainee.branch_id,
        first_name=trainee.first_name,
        last_name=trainee.last_name,
        birth_date=trainee.birth_date,
        status=trainee.status,
        phone=cipher.decrypt(trainee.phone_encrypted),
        email=cipher.decrypt(trainee.email_encrypted),
        id_document=cipher.decrypt(trainee.id_document_encrypted),
        created_at=trainee.created_at,
        updated_at=trainee.updated_at,
    )


@router.get("", response_model=list[TraineeResponse])
def list_trainees(
    db: DbSession,
    current_user: CurrentUser,
    search: str | None = Query(default=None),
) -> list[TraineeResponse]:
    query = apply_branch_scope(db.query(Trainee), Trainee, current_user.branch_id)
    if search:
        query = query.filter(
            or_(
                Trainee.first_name.ilike(f"%{search}%"),
                Trainee.last_name.ilike(f"%{search}%"),
            )
        )
    trainees = query.order_by(Trainee.created_at.desc()).all()
    return [_to_response(trainee) for trainee in trainees]


@router.post(
    "",
    response_model=TraineeResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def create_trainee(payload: TraineeCreate, db: DbSession, current_user: CurrentUser) -> TraineeResponse:
    trainee = Trainee(
        branch_id=current_user.branch_id,
        first_name=payload.first_name.strip(),
        last_name=payload.last_name.strip(),
        birth_date=payload.birth_date,
        status=payload.status,
        phone_encrypted=cipher.encrypt(payload.phone),
        email_encrypted=cipher.encrypt(payload.email),
        id_document_encrypted=cipher.encrypt(payload.id_document),
    )
    db.add(trainee)
    db.commit()
    db.refresh(trainee)

    write_audit(
        db,
        actor_user_id=current_user.id,
        action="trainee.create",
        entity_type="trainee",
        entity_id=str(trainee.id),
    )
    return _to_response(trainee)


@router.get("/{trainee_id}", response_model=TraineeResponse)
def get_trainee(trainee_id: int, db: DbSession, current_user: CurrentUser) -> TraineeResponse:
    trainee = db.get(Trainee, trainee_id)
    if not trainee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Слухача не знайдено")
    ensure_same_branch(current_user, trainee, "Слухача")
    return _to_response(trainee)


@router.put(
    "/{trainee_id}",
    response_model=TraineeResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def update_trainee(
    trainee_id: int,
    payload: TraineeUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> TraineeResponse:
    trainee = db.get(Trainee, trainee_id)
    if not trainee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Слухача не знайдено")
    ensure_same_branch(current_user, trainee, "Слухача")

    data = payload.model_dump(exclude_unset=True)
    for field in ("first_name", "last_name", "birth_date", "status"):
        if field in data:
            setattr(trainee, field, data[field])
    if "phone" in data:
        trainee.phone_encrypted = cipher.encrypt(data["phone"])
    if "email" in data:
        trainee.email_encrypted = cipher.encrypt(data["email"])
    if "id_document" in data:
        trainee.id_document_encrypted = cipher.encrypt(data["id_document"])

    db.add(trainee)
    db.commit()
    db.refresh(trainee)

    write_audit(
        db,
        actor_user_id=current_user.id,
        action="trainee.update",
        entity_type="trainee",
        entity_id=str(trainee.id),
    )
    return _to_response(trainee)


@router.delete(
    "/{trainee_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def delete_trainee(trainee_id: int, db: DbSession, current_user: CurrentUser) -> None:
    trainee = db.get(Trainee, trainee_id)
    if not trainee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Слухача не знайдено")
    ensure_same_branch(current_user, trainee, "Слухача")
    db.delete(trainee)
    db.commit()
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="trainee.delete",
        entity_type="trainee",
        entity_id=str(trainee_id),
    )
