from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_

from app.api.deps import CurrentUser, DbSession, apply_branch_scope, ensure_same_branch, require_roles
from app.core.crypto import cipher
from app.models import RoleName, Trainee
from app.schemas.api import (
    TraineeBulkGroupUpdateRequest,
    TraineeBulkGroupUpdateResponse,
    TraineeBulkStatusUpdateRequest,
    TraineeBulkStatusUpdateResponse,
    TraineeCreate,
    TraineeResponse,
    TraineeUpdate,
)
from app.services.audit import write_audit

router = APIRouter()


def _to_response(trainee: Trainee) -> TraineeResponse:
    return TraineeResponse(
        id=trainee.id,
        branch_id=trainee.branch_id,
        source_row_number=trainee.source_row_number,
        first_name=trainee.first_name,
        last_name=trainee.last_name,
        employment_center=cipher.decrypt(trainee.employment_center_encrypted),
        birth_date=trainee.birth_date,
        contract_number=trainee.contract_number,
        certificate_number=trainee.certificate_number,
        certificate_issue_date=trainee.certificate_issue_date,
        postal_index=trainee.postal_index,
        address=cipher.decrypt(trainee.address_encrypted),
        passport_series=cipher.decrypt(trainee.passport_series_encrypted),
        passport_number=cipher.decrypt(trainee.passport_number_encrypted),
        passport_issued_by=cipher.decrypt(trainee.passport_issued_by_encrypted),
        passport_issued_date=trainee.passport_issued_date,
        tax_id=cipher.decrypt(trainee.tax_id_encrypted),
        group_code=trainee.group_code,
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
                Trainee.group_code.ilike(f"%{search}%"),
                Trainee.contract_number.ilike(f"%{search}%"),
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
        source_row_number=payload.source_row_number,
        employment_center_encrypted=cipher.encrypt(payload.employment_center),
        birth_date=payload.birth_date,
        contract_number=payload.contract_number,
        certificate_number=payload.certificate_number,
        certificate_issue_date=payload.certificate_issue_date,
        postal_index=payload.postal_index,
        address_encrypted=cipher.encrypt(payload.address),
        passport_series_encrypted=cipher.encrypt(payload.passport_series),
        passport_number_encrypted=cipher.encrypt(payload.passport_number),
        passport_issued_by_encrypted=cipher.encrypt(payload.passport_issued_by),
        passport_issued_date=payload.passport_issued_date,
        tax_id_encrypted=cipher.encrypt(payload.tax_id),
        group_code=payload.group_code,
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


@router.post(
    "/bulk/group-code",
    response_model=TraineeBulkGroupUpdateResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def bulk_update_group_code(
    payload: TraineeBulkGroupUpdateRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> TraineeBulkGroupUpdateResponse:
    target_rows = (
        apply_branch_scope(db.query(Trainee), Trainee, current_user.branch_id)
        .filter(Trainee.id.in_(payload.trainee_ids))
        .all()
    )
    if not target_rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Слухачів для оновлення не знайдено")

    normalized_group_code = payload.group_code.strip() if payload.group_code else None
    updated_ids: list[int] = []
    for trainee in target_rows:
        trainee.group_code = normalized_group_code
        db.add(trainee)
        updated_ids.append(trainee.id)
    db.commit()

    write_audit(
        db,
        actor_user_id=current_user.id,
        action="trainee.bulk_update_group_code",
        entity_type="trainee_batch",
        entity_id=",".join(str(item) for item in updated_ids[:20]),
        details={"updated_count": len(updated_ids), "group_code": normalized_group_code},
    )
    return TraineeBulkGroupUpdateResponse(
        updated_count=len(updated_ids),
        updated_ids=updated_ids,
        group_code=normalized_group_code,
    )


@router.post(
    "/bulk/status",
    response_model=TraineeBulkStatusUpdateResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def bulk_update_status(
    payload: TraineeBulkStatusUpdateRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> TraineeBulkStatusUpdateResponse:
    target_rows = (
        apply_branch_scope(db.query(Trainee), Trainee, current_user.branch_id)
        .filter(Trainee.id.in_(payload.trainee_ids))
        .all()
    )
    if not target_rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Слухачів для оновлення не знайдено")

    updated_ids: list[int] = []
    for trainee in target_rows:
        trainee.status = payload.status
        db.add(trainee)
        updated_ids.append(trainee.id)
    db.commit()

    write_audit(
        db,
        actor_user_id=current_user.id,
        action="trainee.bulk_update_status",
        entity_type="trainee_batch",
        entity_id=",".join(str(item) for item in updated_ids[:20]),
        details={"updated_count": len(updated_ids), "status": payload.status},
    )
    return TraineeBulkStatusUpdateResponse(
        updated_count=len(updated_ids),
        updated_ids=updated_ids,
        status=payload.status,
    )


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
    for field in (
        "first_name",
        "last_name",
        "source_row_number",
        "birth_date",
        "contract_number",
        "certificate_number",
        "certificate_issue_date",
        "postal_index",
        "passport_issued_date",
        "group_code",
        "status",
    ):
        if field in data:
            setattr(trainee, field, data[field])
    if "employment_center" in data:
        trainee.employment_center_encrypted = cipher.encrypt(data["employment_center"])
    if "address" in data:
        trainee.address_encrypted = cipher.encrypt(data["address"])
    if "passport_series" in data:
        trainee.passport_series_encrypted = cipher.encrypt(data["passport_series"])
    if "passport_number" in data:
        trainee.passport_number_encrypted = cipher.encrypt(data["passport_number"])
    if "passport_issued_by" in data:
        trainee.passport_issued_by_encrypted = cipher.encrypt(data["passport_issued_by"])
    if "tax_id" in data:
        trainee.tax_id_encrypted = cipher.encrypt(data["tax_id"])
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
