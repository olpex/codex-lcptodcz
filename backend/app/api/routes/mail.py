import base64
import hashlib
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser, DbSession, apply_branch_scope, ensure_same_branch, require_roles
from app.core.config import settings
from app.core.crypto import cipher
from app.models import (
    Document,
    DraftStatus,
    GroupStatus,
    ImportJob,
    JobStatus,
    MailMessage,
    MailStatus,
    OCRResult,
    Order,
    OrderType,
    RoleName,
    Room,
    ScheduleSlot,
    Subject,
    Teacher,
    Trainee,
    Group,
)
from app.schemas.api import DraftApproveResponse, DraftResponse, DraftUpdateRequest, JobResponse, MailMessageResponse
from app.services.audit import write_audit
from app.services.import_export import IMPORT_UPDATE_MODES
from app.services.mail_ingest import is_contract_sender
from app.services.ocr import guess_draft_from_text, ocr_image_file
from app.services.storage import detect_document_type, persist_upload, storage_path
from app.tasks.worker import poll_mailbox_task, process_import_job_task, process_ocr_task

router = APIRouter()
GROUP_CODE_PATTERN = re.compile(r"(\d{1,4}\s*[-/]\s*\d{1,4})")
ALLOWED_OCR_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"}


def _extract_group_code_from_filename(filename: str) -> str | None:
    match = GROUP_CODE_PATTERN.search(filename)
    if not match:
        return None
    return "".join(match.group(1).split()).replace("–", "-").replace("—", "-")


def _is_contracts_filename(filename: str) -> bool:
    # Тимчасово вимкнено жорстку перевірку за проханням користувача
    return True


def _dispatch_import_with_fallback(import_job_id: int) -> str:
    try:
        process_import_job_task.delay(import_job_id)
        return "queued"
    except Exception:
        try:
            process_import_job_task.run(import_job_id)
            return "inline"
        except Exception:
            return "inline_failed"


def _run_import_inline_or_raise(import_job_id: int, db: DbSession) -> str:
    try:
        process_import_job_task.run(import_job_id)
    except Exception as exc:
        db.rollback()
        db.expire_all()
        job = db.get(ImportJob, import_job_id)
        exc_detail = str(exc).strip()
        job_detail = (job.message or "").strip() if job else ""
        detail = exc_detail or job_detail or "невідома помилка"
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Імпорт не виконано: {detail}") from exc
    return "inline"


def _parse_optional_date(value: object) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _split_teacher_name(full_name: str) -> tuple[str, str]:
    parts = [part for part in full_name.strip().split() if part]
    if not parts:
        return "Викладач", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def _get_or_create_teacher(db: DbSession, branch_id: str, teacher_name: str) -> Teacher:
    last_name, first_name = _split_teacher_name(teacher_name or "Невідомий викладач")
    teacher = (
        db.query(Teacher)
        .filter(Teacher.branch_id == branch_id, Teacher.last_name == last_name, Teacher.first_name == first_name)
        .first()
    )
    if teacher:
        return teacher
    teacher = Teacher(branch_id=branch_id, last_name=last_name, first_name=first_name, hourly_rate=0, annual_load_hours=0, is_active=True)
    db.add(teacher)
    db.flush()
    return teacher


def _get_or_create_subject(db: DbSession, branch_id: str, subject_name: str) -> Subject:
    name = (subject_name or "Заняття з OCR").strip() or "Заняття з OCR"
    subject = db.query(Subject).filter(Subject.branch_id == branch_id, Subject.name == name).first()
    if subject:
        return subject
    subject = Subject(branch_id=branch_id, name=name, hours_total=0)
    db.add(subject)
    db.flush()
    return subject


def _get_or_create_room(db: DbSession, branch_id: str, room_name: str) -> Room:
    name = (room_name or "OCR").strip() or "OCR"
    room = db.query(Room).filter(Room.branch_id == branch_id, Room.name == name).first()
    if room:
        return room
    room = Room(branch_id=branch_id, name=name, capacity=20)
    db.add(room)
    db.flush()
    return room


def _create_schedule_from_payload(db: DbSession, current_user: CurrentUser, draft_id: int, payload: dict) -> dict:
    group_code = str(payload.get("group_code") or "").strip()
    entries = payload.get("entries") if isinstance(payload.get("entries"), list) else []
    if not group_code or not entries:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Для підтвердження розкладу потрібні group_code та entries у структурованих даних OCR-чернетки",
        )

    group = db.query(Group).filter(Group.branch_id == current_user.branch_id, Group.code == group_code).first()
    if not group:
        group = Group(
            branch_id=current_user.branch_id,
            code=group_code,
            name=str(payload.get("group_name") or f"Група {group_code}"),
            capacity=25,
            status=GroupStatus.ACTIVE,
        )
        db.add(group)
        db.flush()

    created_slots = 0
    skipped_slots = 0
    for raw_entry in entries:
        if not isinstance(raw_entry, dict):
            continue
        entry_date = _parse_optional_date(raw_entry.get("date") or raw_entry.get("starts_at"))
        if not entry_date:
            skipped_slots += 1
            continue
        try:
            pair_number = int(raw_entry.get("pair_number") or 1)
        except (TypeError, ValueError):
            pair_number = 1
        starts_at_raw = raw_entry.get("starts_at")
        if starts_at_raw:
            try:
                starts_at = datetime.fromisoformat(str(starts_at_raw).replace("Z", "+00:00"))
            except ValueError:
                starts_at = datetime.combine(entry_date, datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=9 + (pair_number - 1) * 2)
        else:
            starts_at = datetime.combine(entry_date, datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=9 + (pair_number - 1) * 2)
        ends_at = starts_at + timedelta(minutes=95)
        try:
            academic_hours = float(raw_entry.get("academic_hours") or 2)
        except (TypeError, ValueError):
            academic_hours = 2
        teacher = _get_or_create_teacher(db, current_user.branch_id, str(raw_entry.get("teacher_name") or "Невідомий викладач"))
        subject = _get_or_create_subject(db, current_user.branch_id, str(raw_entry.get("subject_name") or "Заняття з OCR"))
        room = _get_or_create_room(db, current_user.branch_id, str(raw_entry.get("room_name") or "OCR"))
        existing = (
            db.query(ScheduleSlot)
            .filter(
                ScheduleSlot.group_id == group.id,
                ScheduleSlot.starts_at == starts_at,
                ScheduleSlot.pair_number == pair_number,
                ScheduleSlot.teacher_id == teacher.id,
                ScheduleSlot.subject_id == subject.id,
            )
            .first()
        )
        if existing:
            skipped_slots += 1
            continue
        db.add(
            ScheduleSlot(
                group_id=group.id,
                teacher_id=teacher.id,
                subject_id=subject.id,
                room_id=room.id,
                starts_at=starts_at,
                ends_at=ends_at,
                pair_number=pair_number,
                academic_hours=academic_hours,
            )
        )
        created_slots += 1

    if created_slots == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OCR-розклад не містить нових занять для створення")
    return {"type": "schedule", "group_id": group.id, "created_slots": created_slots, "skipped_slots": skipped_slots, "draft_id": draft_id}


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
        task = poll_mailbox_task.delay(True)
        task_id = task.id
    except Exception:
        dispatch_mode = "inline"
        inline_result = poll_mailbox_task.run(True)

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

    payload: dict[str, object] = {
        "message": "Автоматичне IMAP-опитування вимкнено; пошту обробляє Apps Script",
        "dispatch_mode": "disabled",
        "result": {"processed": 0, "disabled": True},
    }
    return payload


class GmailApiContractWebhookRequest(BaseModel):
    """Payload надісланий Postman Flow після отримання вкладення через Gmail REST API."""

    filename: str = Field(min_length=1, max_length=512)
    messageId: str = Field(min_length=1, max_length=255)
    fileBase64: str = Field(min_length=1, description="URL-safe Base64 даних файлу (формат Gmail API)")
    subject: str | None = Field(default=None, description="Тема листа")


@router.post("/mail/gmail-api-webhook/contracts", response_model=JobResponse, status_code=status.HTTP_202_ACCEPTED)
def gmail_api_contracts_webhook(
    body: GmailApiContractWebhookRequest,
    db: DbSession,
    authorization: str | None = Header(default=None),
) -> JobResponse:
    """Endpoint для Postman Flow: приймає вкладення договорів з Gmail REST API (Base64 JSON)."""
    expected_secret = settings.mail_webhook_secret.strip()
    if not expected_secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="MAIL_WEBHOOK_SECRET не налаштовано")
    expected_header = f"Bearer {expected_secret}"
    if authorization != expected_header:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Некоректний webhook-токен")

    filename = body.filename.strip()
    safe_message_id = body.messageId.strip()[:255]

    # Gmail API повертає URL-safe Base64 (символи - та _ замість + та /), відновлюємо стандартний padding
    b64_data = body.fileBase64.replace("-", "+").replace("_", "/")
    padding_needed = len(b64_data) % 4
    if padding_needed:
        b64_data += "=" * (4 - padding_needed)
    try:
        file_bytes = base64.b64decode(b64_data)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Помилка декодування Base64: {exc}") from exc

    if not file_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Файл порожній")

    doc_type = detect_document_type(filename)
    if doc_type.value not in {"xlsx", "docx"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Підтримуються тільки .xls/.xlsx (договори) або .docx (розклади)")

    group_code_hint = None
    mime_type = "application/octet-stream"

    if doc_type.value == "xlsx":
        group_code_hint = _extract_group_code_from_filename(filename)
        mime_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    elif doc_type.value == "docx":
        mime_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

    sender_email = settings.imap_contract_sender_email
    sender_name = settings.imap_contract_sender_name

    branch_id = settings.imap_branch_id or "main"

    idem_digest = hashlib.sha1(f"{branch_id}:{safe_message_id}:{filename}".encode("utf-8")).hexdigest()[:24]
    idempotency_key = f"{branch_id}:mail-gmail-api:{idem_digest}"

    out_path: Path | None = None
    sha256 = hashlib.sha256(file_bytes).hexdigest()
    if doc_type.value == "docx":
        out_path = storage_path() / f"{uuid4().hex}_{filename}"
        with Path(out_path).open("wb") as fh:
            fh.write(file_bytes)

    existing = db.query(ImportJob).filter(ImportJob.idempotency_key == idempotency_key).first()
    if existing:
        idempotency_key = f"{idempotency_key}:re:{uuid4().hex[:8]}"
    if out_path is None:
        out_path = storage_path() / f"{uuid4().hex}_{filename}"
        with Path(out_path).open("wb") as fh:
            fh.write(file_bytes)

    document = Document(
        branch_id=branch_id,
        file_name=filename,
        file_path=str(out_path),
        file_type=doc_type,
        source="mail_gmail_api",
        mime_type=mime_type,
        hash_sha256=sha256,
    )
    db.add(document)
    db.flush()

    message_row = (
        db.query(MailMessage)
        .filter(MailMessage.branch_id == branch_id, MailMessage.message_id == safe_message_id)
        .first()
    )
    if not message_row:
        message_row = MailMessage(
            branch_id=branch_id,
            message_id=safe_message_id,
            sender=f"{sender_name} <{sender_email}>".strip(),
            subject=f"Gmail API webhook: {filename}",
            received_at=datetime.now(timezone.utc),
            snippet=f"Postman Flow / Gmail API webhook: {filename}",
            status=MailStatus.PROCESSED,
            raw_document_id=document.id,
        )
        db.add(message_row)
    else:
        message_row.raw_document_id = document.id
        db.add(message_row)

    import_mode = settings.imap_contract_update_mode if settings.imap_contract_update_mode in IMPORT_UPDATE_MODES else "overwrite"
    job = ImportJob(
        branch_id=branch_id,
        idempotency_key=idempotency_key,
        document_id=document.id,
        status=JobStatus.QUEUED,
        message="Заявку на імпорт з Gmail API (Postman Flow) створено",
        result_payload={
            "source": "mail_gmail_api",
            "message_id": safe_message_id,
            "sender_name": sender_name,
            "sender_email": sender_email,
            "group_code_hint": group_code_hint,
            "import_mode": import_mode,
            "channel": "postman_flow_gmail_api",
        },
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    if doc_type.value == "docx":
        dispatch_mode = _run_import_inline_or_raise(job.id, db)
    else:
        dispatch_mode = _dispatch_import_with_fallback(job.id)
    db.refresh(job)
    if dispatch_mode == "inline":
        suffix = f" {job.message}" if job.message else ""
        job.message = f"Імпорт виконано одразу.{suffix}"
        db.add(job)
        db.commit()
        db.refresh(job)
    elif dispatch_mode == "inline_failed":
        suffix = f" {job.message}" if job.message else ""
        job.message = f"Черга недоступна, а inline-імпорт завершився помилкою.{suffix}"
        db.add(job)
        db.commit()
        db.refresh(job)

    return JobResponse.model_validate(job)


@router.post("/mail/google-webhook/contracts", response_model=JobResponse, status_code=status.HTTP_202_ACCEPTED)
def google_mail_contracts_webhook(
    db: DbSession,
    file: UploadFile = File(...),
    sender_email: str = Form(...),
    sender_name: str = Form(default=""),
    subject: str = Form(default=""),
    message_id: str | None = Form(default=None),
    update_existing_mode: str = Form(default="overwrite"),
    authorization: str | None = Header(default=None),
) -> JobResponse:
    expected_secret = settings.mail_webhook_secret.strip()
    if not expected_secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="MAIL_WEBHOOK_SECRET не налаштовано")
    expected_header = f"Bearer {expected_secret}"
    if authorization != expected_header:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Некоректний webhook-токен")

    if update_existing_mode not in IMPORT_UPDATE_MODES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Некоректний режим імпорту")

    if not is_contract_sender(sender_name, sender_email):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Відправник не відповідає правилу автообробки")

    filename = file.filename or "attachment.xlsx"
    doc_type = detect_document_type(filename)
    if doc_type.value not in {"xlsx", "docx"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Підтримуються тільки .xls/.xlsx (договори) або .docx (розклади)")

    group_code_hint = None
    mime_type = "application/octet-stream"

    if doc_type.value == "xlsx":
        group_code_hint = _extract_group_code_from_filename(filename)
        mime_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    elif doc_type.value == "docx":
        mime_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

    branch_id = settings.imap_branch_id or "main"
    safe_message_id = (message_id or f"google-script-{uuid4().hex}").strip()[:255]
    idem_digest = hashlib.sha1(f"{branch_id}:{safe_message_id}:{filename}".encode("utf-8")).hexdigest()[:24]
    idempotency_key = f"{branch_id}:mail-webhook:{idem_digest}"

    path: str | None = None
    sha256: str | None = None
    if doc_type.value == "docx":
        path, sha256 = persist_upload(file)

    existing = db.query(ImportJob).filter(ImportJob.idempotency_key == idempotency_key).first()
    if existing:
        idempotency_key = f"{idempotency_key}:re:{uuid4().hex[:8]}"

    if not path or not sha256:
        path, sha256 = persist_upload(file)
    document = Document(
        branch_id=branch_id,
        file_name=filename,
        file_path=path,
        file_type=doc_type,
        source="mail_google_script",
        mime_type=file.content_type,
        hash_sha256=sha256,
    )
    db.add(document)
    db.flush()

    message_row = (
        db.query(MailMessage)
        .filter(MailMessage.branch_id == branch_id, MailMessage.message_id == safe_message_id)
        .first()
    )
    if not message_row:
        message_row = MailMessage(
            branch_id=branch_id,
            message_id=safe_message_id,
            sender=f"{sender_name} <{sender_email}>".strip(),
            subject=subject or "(без теми)",
            received_at=datetime.now(timezone.utc),
            snippet=f"Apps Script webhook: {filename}",
            status=MailStatus.PROCESSED,
            raw_document_id=document.id,
        )
        db.add(message_row)
    else:
        message_row.raw_document_id = document.id
        db.add(message_row)

    job = ImportJob(
        branch_id=branch_id,
        idempotency_key=idempotency_key,
        document_id=document.id,
        status=JobStatus.QUEUED,
        message="Заявку на імпорт з Google Apps Script створено",
        result_payload={
            "source": "mail_google_script",
            "message_id": safe_message_id,
            "sender_name": sender_name,
            "sender_email": sender_email,
            "group_code_hint": group_code_hint,
            "import_mode": update_existing_mode,
            "channel": "google_apps_script",
        },
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    if doc_type.value == "docx":
        dispatch_mode = _run_import_inline_or_raise(job.id, db)
    else:
        dispatch_mode = _dispatch_import_with_fallback(job.id)
    db.refresh(job)
    if dispatch_mode == "inline":
        suffix = f" {job.message}" if job.message else ""
        job.message = f"Імпорт виконано одразу.{suffix}"
        db.add(job)
        db.commit()
        db.refresh(job)
    elif dispatch_mode == "inline_failed":
        suffix = f" {job.message}" if job.message else ""
        job.message = f"Черга недоступна, а inline-імпорт завершився помилкою.{suffix}"
        db.add(job)
        db.commit()
        db.refresh(job)

    return JobResponse.model_validate(job)


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
    "/drafts/upload-image",
    response_model=DraftResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def upload_ocr_image(
    db: DbSession,
    current_user: CurrentUser,
    file: UploadFile = File(...),
    draft_type: str = Form(default="auto"),
    extracted_text: str = Form(default=""),
) -> DraftResponse:
    extension = file.filename.rsplit(".", 1)[1].lower() if file.filename and "." in file.filename else ""
    if extension not in ALLOWED_OCR_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Підтримуються зображення PNG, JPG, WEBP, BMP, TIFF",
        )
    if draft_type not in {"auto", "trainee_card", "order", "schedule"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Некоректний тип OCR-чернетки")

    path, sha256 = persist_upload(file)
    client_extracted_text = extracted_text.strip()
    extracted_text = client_extracted_text or ocr_image_file(path)
    if not extracted_text.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Не вдалося розпізнати текст на зображенні. "
                "Спробуйте чіткіший скріншот або перевірте OCR: браузерний OCR не передав текст, "
                "а серверний Tesseract недоступний чи не має української мови."
            ),
        )

    guessed_type, payload = guess_draft_from_text(extracted_text)
    final_type = guessed_type if draft_type == "auto" else draft_type
    if final_type != guessed_type:
        payload = {
            **payload,
            "raw_text": extracted_text[:12000],
            "source": "ocr_upload",
        }
        if final_type == "schedule":
            payload = {
                "group_code": str(payload.get("group_code") or ""),
                "group_name": str(payload.get("group_name") or ""),
                "entries": payload.get("entries") if isinstance(payload.get("entries"), list) else [],
                "raw_text": extracted_text[:12000],
                "source": "ocr_upload",
            }
        elif final_type == "order":
            payload = {
                "order_number": str(payload.get("order_number") or "AUTO"),
                "status": str(payload.get("status") or "draft"),
                "raw_text": extracted_text[:12000],
                "source": "ocr_upload",
            }
        else:
            payload = {
                "first_name": str(payload.get("first_name") or "Невідомо"),
                "last_name": str(payload.get("last_name") or "Невідомо"),
                "status": str(payload.get("status") or "active"),
                "group_code": str(payload.get("group_code") or ""),
                "contract_number": str(payload.get("contract_number") or ""),
                "raw_text": extracted_text[:12000],
                "source": "ocr_upload",
            }

    document = Document(
        file_name=file.filename or "ocr_image",
        file_path=path,
        file_type=detect_document_type(file.filename),
        mime_type=file.content_type,
        hash_sha256=sha256,
        source="ocr_upload",
        created_by=current_user.id,
        branch_id=current_user.branch_id,
    )
    db.add(document)
    db.flush()
    draft = OCRResult(
        branch_id=current_user.branch_id,
        document_id=document.id,
        extracted_text=extracted_text,
        structured_payload=payload,
        draft_type=final_type,
        confidence=0.55 if final_type == "schedule" else 0.7,
        status=DraftStatus.PENDING,
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)

    write_audit(
        db,
        actor_user_id=current_user.id,
        action="draft.upload_image",
        entity_type="ocr_result",
        entity_id=str(draft.id),
        details={
            "document_id": document.id,
            "file_name": document.file_name,
            "draft_type": final_type,
            "ocr_source": "browser" if client_extracted_text else "server",
        },
    )
    return DraftResponse.model_validate(draft)


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
    if draft.draft_type == "schedule":
        created_entity = _create_schedule_from_payload(db, current_user, draft.id, payload)
    elif draft.draft_type == "order":
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
        trainee.birth_date = _parse_optional_date(payload.get("birth_date"))
        trainee.contract_number = str(payload.get("contract_number") or "") or None
        trainee.group_code = str(payload.get("group_code") or "") or None
        trainee.phone_encrypted = cipher.encrypt(str(payload.get("phone") or "") or None)
        trainee.email_encrypted = cipher.encrypt(str(payload.get("email") or "") or None)
        db.add(trainee)
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
