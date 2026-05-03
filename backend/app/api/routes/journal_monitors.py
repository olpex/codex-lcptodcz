from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, DbSession, apply_branch_scope, ensure_same_branch, require_roles
from app.core.crypto import cipher
from app.models import JournalMonitorSection, RoleName
from app.schemas.api import (
    JournalMonitorDetailResponse,
    JournalMonitorSectionCreate,
    JournalMonitorSectionResponse,
    JournalMonitorSectionUpdate,
)
from app.services.audit import write_audit
from app.services.journal_monitor import (
    EXPORT_FORMATS,
    extract_drive_folder_id,
    list_drive_child_folders,
    save_journal_monitor_export,
    section_to_response_payload,
    sync_journal_monitor_section,
)

router = APIRouter()


def _get_section_or_404(db: DbSession, current_user: CurrentUser, section_id: int) -> JournalMonitorSection:
    section = db.get(JournalMonitorSection, section_id)
    if not section:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Розділ журналів не знайдено")
    ensure_same_branch(current_user, section, "Розділ журналів")
    return section


@router.get("", response_model=list[JournalMonitorSectionResponse])
def list_sections(db: DbSession, current_user: CurrentUser) -> list[JournalMonitorSectionResponse]:
    sections = (
        apply_branch_scope(db.query(JournalMonitorSection), JournalMonitorSection, current_user.branch_id)
        .order_by(JournalMonitorSection.created_at.desc())
        .all()
    )
    return [JournalMonitorSectionResponse(**section_to_response_payload(section)) for section in sections]


@router.post(
    "",
    response_model=JournalMonitorSectionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def create_section(
    payload: JournalMonitorSectionCreate,
    db: DbSession,
    current_user: CurrentUser,
) -> JournalMonitorSectionResponse:
    try:
        folder_id = extract_drive_folder_id(payload.folder_url)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    section = JournalMonitorSection(
        branch_id=current_user.branch_id,
        name=payload.name.strip(),
        folder_url=payload.folder_url.strip(),
        folder_id=folder_id,
        service_account_json_encrypted=cipher.encrypt(payload.service_account_json.strip()) if payload.service_account_json else None,
    )
    db.add(section)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Розділ з такою назвою вже існує") from exc
    db.refresh(section)
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="journal_monitor.create",
        entity_type="journal_monitor_section",
        entity_id=str(section.id),
        details={"name": section.name, "folder_id": section.folder_id},
    )
    return JournalMonitorSectionResponse(**section_to_response_payload(section))


@router.get("/{section_id}", response_model=JournalMonitorDetailResponse)
def get_section(section_id: int, db: DbSession, current_user: CurrentUser) -> JournalMonitorDetailResponse:
    section = _get_section_or_404(db, current_user, section_id)
    return JournalMonitorDetailResponse(**section_to_response_payload(section, include_entries=True))


@router.patch(
    "/{section_id}",
    response_model=JournalMonitorSectionResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def update_section(
    section_id: int,
    payload: JournalMonitorSectionUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> JournalMonitorSectionResponse:
    section = _get_section_or_404(db, current_user, section_id)
    if payload.name is not None:
        section.name = payload.name.strip()
    if payload.folder_url is not None:
        try:
            section.folder_id = extract_drive_folder_id(payload.folder_url)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        section.folder_url = payload.folder_url.strip()
        section.last_sync_status = "never"
        section.last_sync_message = None
    if payload.clear_service_account_json:
        section.service_account_json_encrypted = None
    if payload.service_account_json is not None:
        section.service_account_json_encrypted = cipher.encrypt(payload.service_account_json.strip())
    if payload.is_active is not None:
        section.is_active = payload.is_active
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Розділ з такою назвою вже існує") from exc
    db.refresh(section)
    return JournalMonitorSectionResponse(**section_to_response_payload(section))


@router.delete(
    "/{section_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def delete_section(section_id: int, db: DbSession, current_user: CurrentUser) -> None:
    section = _get_section_or_404(db, current_user, section_id)
    db.delete(section)
    db.commit()


@router.post(
    "/{section_id}/sync",
    response_model=JournalMonitorDetailResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def sync_section(section_id: int, db: DbSession, current_user: CurrentUser) -> JournalMonitorDetailResponse:
    section = _get_section_or_404(db, current_user, section_id)
    try:
        section = sync_journal_monitor_section(db, section, folder_lister=list_drive_child_folders)
        db.commit()
    except Exception as exc:
        db.rollback()
        section = _get_section_or_404(db, current_user, section_id)
        section.last_sync_status = "failed"
        section.last_sync_message = str(exc)[:500]
        db.add(section)
        db.commit()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Не вдалося оновити Google Drive: {exc}") from exc
    db.refresh(section)
    return JournalMonitorDetailResponse(**section_to_response_payload(section, include_entries=True))


@router.get("/{section_id}/export")
def export_section(
    section_id: int,
    db: DbSession,
    current_user: CurrentUser,
    format: str = Query(default="xlsx", pattern="^(xlsx|pdf|docx|csv)$"),
    q: str | None = Query(default=None),
    processing_status: str | None = Query(
        default=None,
        alias="status",
        pattern="^(complete|schedule_only|trainees_only|not_processed|unknown_code)$",
    ),
    has_schedule: bool | None = Query(default=None),
    has_trainees: bool | None = Query(default=None),
) -> FileResponse:
    section = _get_section_or_404(db, current_user, section_id)
    if format not in EXPORT_FORMATS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Підтримуються формати xlsx, pdf, docx, csv")
    path, filename, media_type = save_journal_monitor_export(
        section,
        format,
        query=q,
        status=processing_status,
        has_schedule=has_schedule,
        has_trainees=has_trainees,
    )
    return FileResponse(path=path, filename=filename, media_type=media_type)
