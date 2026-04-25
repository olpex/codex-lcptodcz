from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, status

from app.api.deps import CurrentUser, DbSession, apply_branch_scope, ensure_same_branch, require_roles
from app.core.config import settings
from app.models import DraftStatus, MailMessage, OCRResult, Order, OrderType, RoleName, Trainee
from app.schemas.api import DraftApproveResponse, DraftResponse, DraftUpdateRequest, MailMessageResponse
from app.services.audit import write_audit
from app.tasks.worker import poll_mailbox_task, process_ocr_task

router = APIRouter()


@router.post(
    "/mail/poll-now",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def poll_now(current_user: CurrentUser, db: DbSession) -> dict:
    dispatch_mode = "queued"
    task_id: str | None = None
    inline_result: dict | None = None
    try:
        task = poll_mailbox_task.delay()
        task_id = task.id
    except Exception:
        dispatch_mode = "inline"
        inline_result = poll_mailbox_task.run()

    write_audit(
        db,
        actor_user_id=current_user.id,
        action="mail.poll_now",
        entity_type="task",
        entity_id=task_id or "inline",
        details={"dispatch_mode": dispatch_mode},
    )
    if dispatch_mode == "inline":
        return {
            "message": "Черга недоступна, опитування виконано одразу",
            "dispatch_mode": dispatch_mode,
            "result": inline_result or {},
        }
    return {
        "message": "Завдання опитування поштової скриньки поставлено в чергу",
        "task_id": task_id,
        "dispatch_mode": dispatch_mode,
    }


@router.get("/mail/poll-cron", status_code=status.HTTP_202_ACCEPTED)
@router.post("/mail/poll-cron", status_code=status.HTTP_202_ACCEPTED)
def poll_mailbox_cron(authorization: str | None = Header(default=None)) -> dict:
    expected_secret = settings.cron_secret.strip()
    if not expected_secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="CRON_SECRET не налаштовано")
    expected_header = f"Bearer {expected_secret}"
    if authorization != expected_header:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Некоректний cron-токен")

    dispatch_mode = "queued"
    task_id: str | None = None
    inline_result: dict | None = None
    try:
        task = poll_mailbox_task.delay()
        task_id = task.id
    except Exception:
        dispatch_mode = "inline"
        inline_result = poll_mailbox_task.run()

    payload: dict[str, object] = {
        "message": "Опитування поштової скриньки запущено",
        "dispatch_mode": dispatch_mode,
    }
    if task_id:
        payload["task_id"] = task_id
    if inline_result is not None:
        payload["result"] = inline_result
    return payload


@router.get("/mail/messages", response_model=list[MailMessageResponse])
def list_mail_messages(db: DbSession, current_user: CurrentUser) -> list[MailMessageResponse]:
    rows = (
        apply_branch_scope(db.query(MailMessage), MailMessage, current_user.branch_id)
        .order_by(MailMessage.received_at.desc())
        .all()
    )
    return [MailMessageResponse.model_validate(row) for row in rows]


@router.get("/drafts", response_model=list[DraftResponse])
def list_drafts(db: DbSession, current_user: CurrentUser) -> list[DraftResponse]:
    rows = (
        apply_branch_scope(db.query(OCRResult), OCRResult, current_user.branch_id)
        .order_by(OCRResult.created_at.desc())
        .all()
    )
    return [DraftResponse.model_validate(row) for row in rows]


@router.get("/drafts/{draft_id}", response_model=DraftResponse)
def get_draft(draft_id: int, db: DbSession, current_user: CurrentUser) -> DraftResponse:
    row = db.get(OCRResult, draft_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Чернетку не знайдено")
    ensure_same_branch(current_user, row, "Чернетку")
    return DraftResponse.model_validate(row)


@router.patch(
    "/drafts/{draft_id}",
    response_model=DraftResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def update_draft(
    draft_id: int,
    payload: DraftUpdateRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> DraftResponse:
    draft = db.get(OCRResult, draft_id)
    if not draft:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Чернетку не знайдено")
    ensure_same_branch(current_user, draft, "Чернетку")
    if draft.status == DraftStatus.APPROVED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Підтверджену чернетку не можна редагувати")

    draft.structured_payload = payload.structured_payload
    if payload.draft_type:
        draft.draft_type = payload.draft_type
    if payload.confidence is not None:
        draft.confidence = payload.confidence
    db.add(draft)
    db.commit()
    db.refresh(draft)

    write_audit(
        db,
        actor_user_id=current_user.id,
        action="draft.update",
        entity_type="ocr_result",
        entity_id=str(draft.id),
    )
    return DraftResponse.model_validate(draft)


@router.post(
    "/drafts/{draft_id}/reprocess",
    response_model=DraftResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def reprocess_draft(draft_id: int, db: DbSession, current_user: CurrentUser) -> DraftResponse:
    row = db.get(OCRResult, draft_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Чернетку не знайдено")
    ensure_same_branch(current_user, row, "Чернетку")
    task = process_ocr_task.delay(draft_id)
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="draft.reprocess",
        entity_type="ocr_result",
        entity_id=str(draft_id),
        details={"task_id": task.id},
    )
    db.refresh(row)
    return DraftResponse.model_validate(row)


@router.post(
    "/drafts/{draft_id}/approve",
    response_model=DraftApproveResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def approve_draft(draft_id: int, db: DbSession, current_user: CurrentUser) -> DraftApproveResponse:
    draft = db.get(OCRResult, draft_id)
    if not draft:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Чернетку не знайдено")
    ensure_same_branch(current_user, draft, "Чернетку")
    if draft.status == DraftStatus.APPROVED:
        return DraftApproveResponse(draft_id=draft.id, status=draft.status, created_entity=None)

    payload = draft.structured_payload or {}
    created_entity: dict | None = None
    if draft.draft_type == "order":
        order = Order(
            branch_id=current_user.branch_id,
            order_number=str(payload.get("order_number") or f"AUTO-{draft.id}"),
            order_type=OrderType.INTERNAL,
            order_date=date.today(),
            status=str(payload.get("status") or "draft"),
            payload_json=payload,
            created_by=current_user.id,
        )
        db.add(order)
        db.flush()
        created_entity = {"type": "order", "id": order.id}
    else:
        trainee = Trainee(
            branch_id=current_user.branch_id,
            first_name=str(payload.get("first_name") or "Невідомо"),
            last_name=str(payload.get("last_name") or "Невідомо"),
            status=str(payload.get("status") or "active"),
        )
        db.add(trainee)
        db.flush()
        created_entity = {"type": "trainee", "id": trainee.id}

    draft.status = DraftStatus.APPROVED
    draft.reviewed_by = current_user.id
    draft.reviewed_at = datetime.now(timezone.utc)
    db.add(draft)
    db.commit()

    write_audit(
        db,
        actor_user_id=current_user.id,
        action="draft.approve",
        entity_type="ocr_result",
        entity_id=str(draft.id),
        details={"created_entity": created_entity},
    )
    return DraftApproveResponse(draft_id=draft.id, status=draft.status, created_entity=created_entity)
