import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, DbSession, apply_branch_scope, ensure_same_branch, require_roles
from app.core.crypto import cipher
from app.models import JournalMonitorEntry, JournalMonitorSection, RoleName
from app.schemas.api import (
    JournalMonitorEntryBulkDeleteRequest,
    JournalMonitorEntryBulkDeleteResponse,
    JournalMonitorDetailResponse,
    JournalMonitorSectionCreate,
    JournalMonitorSectionResponse,
    JournalMonitorSectionUpdate,
)
from app.services.audit import write_audit
from app.services.journal_monitor import (
    EXPORT_FORMATS,
    archive_trainees_for_deleted_journal_entries,
    extract_drive_folder_id,
    hide_groups_for_deleted_journal_entries,
    list_drive_child_folders,
    requeue_journal_trainees_for_year,
    requeue_journal_workload_for_year,
    save_journal_monitor_export,
    section_to_response_payload,
    process_journal_monitor_section_step,
    process_journal_monitor_background_step,
    process_next_journal_workload,
    sync_journal_monitor_section,
)

router = APIRouter()
logger = logging.getLogger(__name__)


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
    "/{section_id}/entries/bulk-delete",
    response_model=JournalMonitorEntryBulkDeleteResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def bulk_delete_entries(
    section_id: int,
    payload: JournalMonitorEntryBulkDeleteRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> JournalMonitorEntryBulkDeleteResponse:
    section = _get_section_or_404(db, current_user, section_id)
    requested_ids = list(dict.fromkeys(payload.entry_ids))
    entries = (
        db.query(JournalMonitorEntry)
        .filter(
            JournalMonitorEntry.section_id == section.id,
            JournalMonitorEntry.id.in_(requested_ids),
        )
        .all()
    )
    entries_by_id = {entry.id: entry for entry in entries}
    target_entries = [entries_by_id[entry_id] for entry_id in requested_ids if entry_id in entries_by_id]
    if not target_entries:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Журнали для видалення не знайдено")

    hidden_group_count = hide_groups_for_deleted_journal_entries(db, target_entries)
    archived_trainee_count = archive_trainees_for_deleted_journal_entries(db, target_entries)
    deleted_ids = [entry.id for entry in target_entries]
    details = [
        {"id": entry.id, "journal_name": entry.journal_name, "group_code": entry.group_code}
        for entry in target_entries
    ]
    for entry in target_entries:
        db.delete(entry)
    missing_ids = [entry_id for entry_id in requested_ids if entry_id not in entries_by_id]
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="journal_monitor.entry_bulk_delete",
        entity_type="journal_monitor_entry_batch",
        entity_id=",".join(str(item) for item in deleted_ids[:20]),
        details={
            "section_id": section_id,
            "deleted_count": len(deleted_ids),
            "deleted_ids": deleted_ids,
            "missing_ids": missing_ids,
            "hidden_group_count": hidden_group_count,
            "archived_trainee_count": archived_trainee_count,
            "entries": details,
        },
    )
    db.commit()
    return JournalMonitorEntryBulkDeleteResponse(
        deleted_count=len(deleted_ids),
        deleted_ids=deleted_ids,
        missing_ids=missing_ids,
        hidden_group_count=hidden_group_count,
    )


@router.delete(
    "/{section_id}/entries/{entry_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def delete_entry(section_id: int, entry_id: int, db: DbSession, current_user: CurrentUser) -> None:
    section = _get_section_or_404(db, current_user, section_id)
    entry = db.get(JournalMonitorEntry, entry_id)
    if not entry or entry.section_id != section.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Журнал не знайдено")
    details = {"section_id": section_id, "journal_name": entry.journal_name, "group_code": entry.group_code}
    hidden_group_count = hide_groups_for_deleted_journal_entries(db, [entry])
    archived_trainee_count = archive_trainees_for_deleted_journal_entries(db, [entry])
    db.delete(entry)
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="journal_monitor.entry_delete",
        entity_type="journal_monitor_entry",
        entity_id=str(entry_id),
        details={**details, "hidden_group_count": hidden_group_count, "archived_trainee_count": archived_trainee_count},
    )
    db.commit()


@router.post(
    "/{section_id}/sync",
    response_model=JournalMonitorDetailResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def sync_section(section_id: int, db: DbSession, current_user: CurrentUser) -> JournalMonitorDetailResponse:
    section = _get_section_or_404(db, current_user, section_id)
    try:
        section = sync_journal_monitor_section(
            db,
            section,
            folder_lister=list_drive_child_folders,
            process_workload=False,
            process_trainees=False,
        )
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


def _start_section_processing(
    section: JournalMonitorSection,
    db: DbSession,
    year: int,
    *,
    error_prefix: str,
) -> JournalMonitorDetailResponse:
    section.workload_auto_enabled = True
    section.workload_auto_year = year
    section.last_sync_message = "Опрацювання журналів запущено"
    db.add(section)
    requeue_journal_workload_for_year(db, section, year)
    requeue_journal_trainees_for_year(db, section, year)
    db.commit()

    db.refresh(section)
    return JournalMonitorDetailResponse(**section_to_response_payload(section, include_entries=True))


def _reprocess_section_all(
    section: JournalMonitorSection,
    db: DbSession,
    year: int,
    *,
    error_prefix: str,
) -> JournalMonitorDetailResponse:
    section.workload_auto_enabled = True
    section.workload_auto_year = year
    db.add(section)
    db.flush()
    try:
        section = sync_journal_monitor_section(
            db,
            section,
            folder_lister=list_drive_child_folders,
            process_workload=False,
            process_trainees=False,
        )
        workload_count = requeue_journal_workload_for_year(db, section, year, force=True)
        trainees_count = requeue_journal_trainees_for_year(db, section, year, force=True)
        section.last_sync_message = (
            f"Повна переобробка {year}: у черзі педнавантаження {workload_count}, слухачі {trainees_count}"
        )
        db.add(section)
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"{error_prefix}: {exc}") from exc
    db.refresh(section)
    return JournalMonitorDetailResponse(**section_to_response_payload(section, include_entries=True))


def _process_section_once(
    section: JournalMonitorSection,
    db: DbSession,
    *,
    error_prefix: str,
) -> JournalMonitorDetailResponse:
    section_id = section.id
    try:
        process_journal_monitor_section_step(db, section, process_workload=True, process_trainees=True)
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("Journal processing tick failed for section %s", section_id)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"{error_prefix}: {exc}") from exc
    db.refresh(section)
    return JournalMonitorDetailResponse(**section_to_response_payload(section, include_entries=True))


def _start_section_workload_inline(
    section: JournalMonitorSection,
    db: DbSession,
    year: int,
    *,
    error_prefix: str,
) -> JournalMonitorDetailResponse:
    section.workload_auto_enabled = True
    section.workload_auto_year = year
    db.add(section)
    db.flush()
    try:
        section = sync_journal_monitor_section(
            db,
            section,
            folder_lister=list_drive_child_folders,
            process_workload=False,
            process_trainees=False,
        )
        requeue_journal_workload_for_year(db, section, year)
        process_next_journal_workload(db, section, limit=1, target_year=year, retry_failed=True)
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"{error_prefix}: {exc}") from exc
    db.refresh(section)
    return JournalMonitorDetailResponse(**section_to_response_payload(section, include_entries=True))


def _stop_section_processing(section: JournalMonitorSection, db: DbSession) -> JournalMonitorDetailResponse:
    section.workload_auto_enabled = False
    db.add(section)
    db.commit()
    db.refresh(section)
    return JournalMonitorDetailResponse(**section_to_response_payload(section, include_entries=True))


@router.post(
    "/{section_id}/processing/start",
    response_model=JournalMonitorDetailResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def start_section_processing(
    section_id: int,
    db: DbSession,
    current_user: CurrentUser,
    year: int = Query(default=2026, ge=2025, le=2100),
) -> JournalMonitorDetailResponse:
    section = _get_section_or_404(db, current_user, section_id)
    return _start_section_processing(section, db, year, error_prefix="Не вдалося запустити опрацювання журналів")


@router.post(
    "/{section_id}/processing/reprocess-all",
    response_model=JournalMonitorDetailResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def reprocess_all_section_journals(
    section_id: int,
    db: DbSession,
    current_user: CurrentUser,
    year: int = Query(default=2026, ge=2025, le=2100),
) -> JournalMonitorDetailResponse:
    section = _get_section_or_404(db, current_user, section_id)
    return _reprocess_section_all(section, db, year, error_prefix="Не вдалося запустити повну переобробку журналів")


@router.post(
    "/{section_id}/processing/stop",
    response_model=JournalMonitorDetailResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def stop_section_processing(
    section_id: int,
    db: DbSession,
    current_user: CurrentUser,
) -> JournalMonitorDetailResponse:
    section = _get_section_or_404(db, current_user, section_id)
    return _stop_section_processing(section, db)


@router.post(
    "/{section_id}/processing/tick",
    response_model=JournalMonitorDetailResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def tick_section_processing(
    section_id: int,
    db: DbSession,
    current_user: CurrentUser,
) -> JournalMonitorDetailResponse:
    section = _get_section_or_404(db, current_user, section_id)
    if not section.workload_auto_enabled:
        return JournalMonitorDetailResponse(**section_to_response_payload(section, include_entries=True))
    return _process_section_once(section, db, error_prefix="Не вдалося продовжити опрацювання журналів")


@router.post(
    "/{section_id}/processing/background-tick",
    response_model=JournalMonitorDetailResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def background_tick_section_processing(
    section_id: int,
    db: DbSession,
    current_user: CurrentUser,
    year: int | None = Query(default=None, ge=2025, le=2100),
) -> JournalMonitorDetailResponse:
    section = _get_section_or_404(db, current_user, section_id)
    try:
        process_journal_monitor_background_step(
            db,
            section,
            folder_lister=list_drive_child_folders,
            target_year=year,
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("Journal background processing failed for section %s", section_id)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Не вдалося виконати фонове опрацювання журналів: {exc}") from exc
    db.refresh(section)
    return JournalMonitorDetailResponse(**section_to_response_payload(section, include_entries=True))


@router.post(
    "/{section_id}/workload-auto/start",
    response_model=JournalMonitorDetailResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def start_section_workload_auto(
    section_id: int,
    db: DbSession,
    current_user: CurrentUser,
    year: int = Query(default=2026, ge=2025, le=2100),
) -> JournalMonitorDetailResponse:
    section = _get_section_or_404(db, current_user, section_id)
    return _start_section_workload_inline(section, db, year, error_prefix="Не вдалося запустити обробку педнавантаження")


@router.post(
    "/{section_id}/workload-auto/stop",
    response_model=JournalMonitorDetailResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def stop_section_workload_auto(
    section_id: int,
    db: DbSession,
    current_user: CurrentUser,
) -> JournalMonitorDetailResponse:
    section = _get_section_or_404(db, current_user, section_id)
    return _stop_section_processing(section, db)


@router.post(
    "/{section_id}/process-workload",
    response_model=JournalMonitorDetailResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def process_section_workload(
    section_id: int,
    db: DbSession,
    current_user: CurrentUser,
    year: int | None = Query(default=None, ge=2025, le=2100),
    limit: int = Query(default=1, ge=1, le=20),
) -> JournalMonitorDetailResponse:
    section = _get_section_or_404(db, current_user, section_id)
    if year is not None:
        requeue_journal_workload_for_year(db, section, year)
    process_next_journal_workload(db, section, limit=limit, target_year=year, retry_failed=True)
    db.commit()
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
    workload: str | None = Query(default=None, pattern="^(workload_only|with_workload|without_workload)$"),
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
        workload=workload,
        has_schedule=has_schedule,
        has_trainees=has_trainees,
    )
    return FileResponse(path=path, filename=filename, media_type=media_type)
