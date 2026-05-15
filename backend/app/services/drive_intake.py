import hashlib
import json
import re
from datetime import datetime, timezone
from http import HTTPStatus
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.crypto import cipher
from app.models import Document, DocumentType, Group, ImportJob, JobStatus, JournalMonitorSection, ScheduleSlot
from app.services.cache import cache_get_json, cache_set_json, hashed_cache_part
from app.services.import_export import IMPORT_UPDATE_MODES
from app.services.journal_monitor import (
    GOOGLE_DRIVE_DOCS_MIME,
    GOOGLE_DRIVE_DOCX_MIME,
    GOOGLE_DRIVE_REQUEST_TIMEOUT_SECONDS,
    GOOGLE_DRIVE_SHEETS_MIME,
    GOOGLE_DRIVE_XLS_MIME,
    GOOGLE_DRIVE_XLSX_MIME,
    _drive_request_url,
    download_drive_file_bytes,
    extract_drive_folder_id,
)
from app.services.mail_ingest import GROUP_CODE_PATTERN
from app.services.schedule_import import parse_schedule_docx
from app.services.storage import detect_document_type, storage_path

SUPPORTED_INTAKE_MIME_TYPES = {
    GOOGLE_DRIVE_DOCS_MIME,
    GOOGLE_DRIVE_DOCX_MIME,
    GOOGLE_DRIVE_SHEETS_MIME,
    GOOGLE_DRIVE_XLSX_MIME,
    GOOGLE_DRIVE_XLS_MIME,
}

_MIME_EXTENSIONS = {
    GOOGLE_DRIVE_DOCS_MIME: ".docx",
    GOOGLE_DRIVE_DOCX_MIME: ".docx",
    GOOGLE_DRIVE_SHEETS_MIME: ".xlsx",
    GOOGLE_DRIVE_XLSX_MIME: ".xlsx",
    GOOGLE_DRIVE_XLS_MIME: ".xls",
}

FileLister = Callable[[str, str | None], list[dict[str, Any]]]
Downloader = Callable[[str, str | None, str | None], bytes]
ImportJobRunner = Callable[[int], Any]
ProcessedFileMarker = Callable[[str, str, str | None], Any]

DEFAULT_PROCESSED_MARKER = "[processed]"
GOOGLE_DRIVE_LIST_CACHE_TTL_SECONDS = 45


def resolve_drive_intake_service_account_json(db: Session, branch_id: str | None = None) -> str | None:
    configured = settings.google_drive_service_account_json.strip()
    if configured:
        return configured

    query = db.query(JournalMonitorSection).filter(
        JournalMonitorSection.is_active.is_(True),
        JournalMonitorSection.service_account_json_encrypted.is_not(None),
    )
    if branch_id:
        query = query.filter(JournalMonitorSection.branch_id == branch_id)

    sections = query.order_by(JournalMonitorSection.updated_at.desc(), JournalMonitorSection.id.desc()).all()
    for section in sections:
        decrypted = cipher.decrypt(section.service_account_json_encrypted)
        if decrypted and decrypted.strip():
            return decrypted
    return None


def list_drive_intake_files(folder_id: str, service_account_json: str | None = None) -> list[dict[str, Any]]:
    credentials = service_account_json or settings.google_drive_service_account_json or settings.google_drive_api_key
    cache_key = f"drive:list:intake:{folder_id}:{hashed_cache_part(credentials)}"
    cached = cache_get_json(cache_key)
    if isinstance(cached, list):
        return cached

    mime_filter = " or ".join(f"mimeType = '{mime_type}'" for mime_type in sorted(SUPPORTED_INTAKE_MIME_TYPES))
    query = f"'{folder_id}' in parents and ({mime_filter}) and trashed = false"
    fields = "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink)"
    page_token = ""
    files: list[dict[str, Any]] = []
    while True:
        url = (
            "https://www.googleapis.com/drive/v3/files"
            f"?q={quote(query)}"
            f"&fields={quote(fields)}"
            "&pageSize=100"
            "&orderBy=modifiedTime"
            "&supportsAllDrives=true"
            "&includeItemsFromAllDrives=true"
        )
        if page_token:
            url += f"&pageToken={quote(page_token)}"
        with urlopen(_drive_request_url(url, service_account_json), timeout=GOOGLE_DRIVE_REQUEST_TIMEOUT_SECONDS) as response:
            payload = response.read().decode("utf-8")

        data = json.loads(payload)
        files.extend(data.get("files", []))
        page_token = data.get("nextPageToken") or ""
        if not page_token:
            cache_set_json(cache_key, files, GOOGLE_DRIVE_LIST_CACHE_TTL_SECONDS)
            return files


def _normalize_drive_filename(name: str, mime_type: str | None) -> str:
    filename = re.sub(r"[\\/]+", "_", (name or "drive-file").strip()) or "drive-file"
    extension = _MIME_EXTENSIONS.get(mime_type or "")
    if extension and not filename.lower().endswith(extension):
        filename = f"{filename}{extension}"
    return filename[:240]


def _processed_marker() -> str:
    marker = settings.google_drive_intake_processed_marker.strip()
    return marker or DEFAULT_PROCESSED_MARKER


def _drive_filename_has_processed_marker(name: str | None, marker: str | None = None) -> bool:
    effective_marker = (marker or _processed_marker()).strip()
    if not effective_marker:
        return False
    return effective_marker.casefold() in (name or "").casefold()


def _processed_drive_filename(name: str | None, marker: str | None = None) -> str:
    effective_marker = (marker or _processed_marker()).strip() or DEFAULT_PROCESSED_MARKER
    filename = (name or "drive-file").strip() or "drive-file"
    if _drive_filename_has_processed_marker(filename, effective_marker):
        return filename

    for extension in sorted(set(_MIME_EXTENSIONS.values()), key=len, reverse=True):
        if filename.casefold().endswith(extension.casefold()):
            base = filename[: -len(extension)].rstrip()
            return f"{base} {effective_marker}{filename[-len(extension):]}"
    return f"{filename.rstrip()} {effective_marker}"


def _unprocessed_drive_filename(name: str | None, marker: str | None = None) -> str:
    effective_marker = (marker or _processed_marker()).strip()
    filename = (name or "drive-file").strip() or "drive-file"
    if not effective_marker:
        return filename

    marker_pattern = re.compile(rf"\s*{re.escape(effective_marker)}\s*", re.IGNORECASE)
    for extension in sorted(set(_MIME_EXTENSIONS.values()), key=len, reverse=True):
        if filename.casefold().endswith(extension.casefold()):
            base = filename[: -len(extension)]
            cleaned_base = marker_pattern.sub(" ", base).strip()
            return f"{cleaned_base or base.strip()}{filename[-len(extension):]}"
    cleaned = marker_pattern.sub(" ", filename).strip()
    return cleaned or filename


def _document_type_for_drive_file(filename: str, mime_type: str | None) -> DocumentType:
    if mime_type in {GOOGLE_DRIVE_DOCS_MIME, GOOGLE_DRIVE_DOCX_MIME}:
        return DocumentType.DOCX
    if mime_type in {GOOGLE_DRIVE_SHEETS_MIME, GOOGLE_DRIVE_XLSX_MIME, GOOGLE_DRIVE_XLS_MIME}:
        return DocumentType.XLSX
    return detect_document_type(filename)


def _extract_group_code_from_filename(filename: str) -> str | None:
    match = GROUP_CODE_PATTERN.search(filename)
    if not match:
        return None
    return "".join(match.group(1).split()).replace("–", "-").replace("—", "-")


def _parse_drive_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _idempotency_key(branch_id: str, file_id: str, modified_time: str | None, filename: str | None = None) -> str:
    name_part = f":{filename.casefold()}" if filename is not None else ""
    digest = hashlib.sha1(f"{file_id}:{modified_time or ''}{name_part}".encode("utf-8")).hexdigest()[:32]
    return f"{branch_id}:drive-intake:{digest}"


def _find_drive_intake_job(
    db: Session,
    *,
    branch_id: str,
    file_id: str,
    modified_time: str | None,
    filename: str,
) -> ImportJob | None:
    keys = [
        _idempotency_key(branch_id, file_id, modified_time, filename),
        _idempotency_key(branch_id, file_id, modified_time, _unprocessed_drive_filename(filename)),
        _idempotency_key(branch_id, file_id, modified_time),
    ]
    seen_keys: set[str] = set()
    for key in keys:
        if key in seen_keys:
            continue
        seen_keys.add(key)
        job = db.query(ImportJob).filter(ImportJob.idempotency_key == key).first()
        if job:
            return job
    return None


def _remember_processed_drive_name(
    db: Session,
    job: ImportJob,
    *,
    branch_id: str,
    file_id: str,
    modified_time: str | None,
    processed_name: str | None,
) -> None:
    if not processed_name:
        return
    next_key = _idempotency_key(branch_id, file_id, modified_time, processed_name)
    if job.idempotency_key != next_key:
        key_owner = (
            db.query(ImportJob)
            .filter(ImportJob.idempotency_key == next_key, ImportJob.id != job.id)
            .first()
        )
        if not key_owner:
            job.idempotency_key = next_key

    payload = dict(job.result_payload or {})
    payload["drive_file_name"] = processed_name
    job.result_payload = payload
    db.add(job)


def _schedule_docx_payload_has_slots(db: Session, job: ImportJob, branch_id: str) -> bool | None:
    payload = job.result_payload if isinstance(job.result_payload, dict) else {}
    import_result = payload.get("import_result") if isinstance(payload.get("import_result"), dict) else {}
    group_code = str(import_result.get("group_code") or payload.get("group_code_hint") or "").strip()
    if not group_code:
        return None

    expected_slots = int(import_result.get("created_slots") or 0) + int(
        import_result.get("skipped_existing_slots") or 0
    )
    expected_group_skip = int(import_result.get("skipped_existing_groups") or 0)
    group = db.query(Group).filter(Group.branch_id == branch_id, Group.code == group_code).first()
    if not group:
        return False if expected_slots > 0 or expected_group_skip > 0 else None

    slot_count = db.query(ScheduleSlot).filter(ScheduleSlot.group_id == group.id).count()
    if slot_count > 0:
        return True
    if expected_slots > 0 or expected_group_skip > 0:
        return False
    return None


def _schedule_docx_resync_reason(db: Session, job: ImportJob, branch_id: str) -> str | None:
    document = job.document
    if not document or document.file_type != DocumentType.DOCX:
        return None
    try:
        parsed_list = parse_schedule_docx(document.file_path)
    except Exception:
        if _schedule_docx_payload_has_slots(db, job, branch_id) is True:
            return None
        return "unreadable_document"

    for parsed in parsed_list:
        entries = parsed.get("entries") or []
        if not entries:
            continue

        group_code = str(parsed.get("group_code") or "").strip()
        group = db.query(Group).filter(Group.branch_id == branch_id, Group.code == group_code).first()
        if not group:
            return "missing_slots"

        min_start = min(item["starts_at"] for item in entries)
        max_end = max(item["ends_at"] for item in entries)
        existing_count = (
            db.query(ScheduleSlot)
            .filter(
                ScheduleSlot.group_id == group.id,
                ScheduleSlot.starts_at >= min_start,
                ScheduleSlot.starts_at <= max_end,
            )
            .count()
        )
        if existing_count < len(entries):
            return "missing_slots"
    return None


def _schedule_docx_needs_resync(db: Session, job: ImportJob, branch_id: str) -> bool:
    return _schedule_docx_resync_reason(db, job, branch_id) is not None


def _replace_existing_job_document_from_drive(
    db: Session,
    job: ImportJob,
    *,
    branch_id: str,
    file_id: str,
    filename: str,
    mime_type: str | None,
    doc_type: DocumentType,
    modified_time: str | None,
    web_view_link: str | None,
    service_account_json: str | None,
    downloader: Downloader,
) -> ImportJob:
    payload = downloader(file_id, mime_type, service_account_json)
    if not payload:
        raise ValueError("Не вдалося повторно завантажити DOCX розклад з Google Drive")

    file_path, sha256 = _store_drive_file(filename, payload)
    document = Document(
        branch_id=branch_id,
        file_name=filename,
        file_path=file_path,
        file_type=doc_type,
        source="drive_intake",
        mime_type=mime_type or "application/octet-stream",
        hash_sha256=sha256,
    )
    db.add(document)
    db.flush()

    result_payload = dict(job.result_payload or {})
    result_payload.update(
        {
            "source": result_payload.get("source") or "drive_intake",
            "channel": result_payload.get("channel") or "google_drive_folder",
            "drive_file_id": file_id,
            "drive_file_name": filename,
            "drive_modified_time": modified_time or None,
            "drive_url": web_view_link or result_payload.get("drive_url"),
            "group_code_hint": _extract_group_code_from_filename(filename),
            "import_mode": _default_import_mode(doc_type),
        }
    )
    job.document_id = document.id
    job.result_payload = result_payload
    db.add(job)
    db.flush()
    return job


def _rerun_existing_import_job(
    db: Session,
    job: ImportJob,
    import_job_runner: ImportJobRunner | None,
    *,
    import_mode: str | None = None,
) -> tuple[Any, ImportJob]:
    if import_job_runner is None:
        return None, job

    if import_mode:
        payload = dict(job.result_payload or {})
        if payload.get("import_mode") not in IMPORT_UPDATE_MODES:
            payload["import_mode"] = import_mode
            job.result_payload = payload

    job.status = JobStatus.QUEUED
    job.message = "Повторна синхронізація розкладу з Google Drive"
    job.started_at = None
    job.finished_at = None
    db.add(job)
    db.commit()

    runner_result = import_job_runner(job.id)
    db.expire_all()
    return runner_result, db.get(ImportJob, job.id) or job


def mark_drive_intake_file_processed(
    file_id: str,
    processed_name: str,
    service_account_json: str | None = None,
) -> dict[str, Any]:
    effective_service_account_json = service_account_json or settings.google_drive_service_account_json
    if not effective_service_account_json.strip():
        raise RuntimeError("Google Drive file marking requires service account write access")

    url = f"https://www.googleapis.com/drive/v3/files/{quote(file_id)}?fields=id,name,modifiedTime&supportsAllDrives=true"
    request_or_url = _drive_request_url(url, effective_service_account_json)
    full_url = request_or_url.full_url if isinstance(request_or_url, Request) else request_or_url
    headers = dict(request_or_url.header_items()) if isinstance(request_or_url, Request) else {}
    headers.update({"Accept": "application/json", "Content-Type": "application/json; charset=utf-8"})
    body = json.dumps({"name": processed_name}).encode("utf-8")
    request = Request(full_url, data=body, headers=headers, method="PATCH")
    try:
        with urlopen(request, timeout=GOOGLE_DRIVE_REQUEST_TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        if exc.code in {HTTPStatus.FORBIDDEN, HTTPStatus.UNAUTHORIZED}:
            raise RuntimeError(
                "Google Drive не дозволив перейменувати файл. "
                "Надайте service account доступ Editor до intake-папки або самого файлу."
            ) from exc
        raise RuntimeError(f"Google Drive file marking failed ({exc.code}): {detail[:300]}") from exc


def _job_status_value(job: ImportJob) -> str:
    return job.status.value if hasattr(job.status, "value") else str(job.status)


def _mark_processed_after_success(
    job: ImportJob,
    *,
    file_id: str,
    original_name: str,
    service_account_json: str | None,
    processed_file_marker: ProcessedFileMarker | None,
) -> tuple[bool, str | None, str | None]:
    if job.status != JobStatus.SUCCEEDED or processed_file_marker is None:
        return False, None, None

    processed_name = _processed_drive_filename(original_name)
    if processed_name == original_name:
        return False, processed_name, None

    try:
        processed_file_marker(file_id, processed_name, service_account_json)
    except Exception as exc:
        return False, processed_name, str(exc)
    return True, processed_name, None


def _store_drive_file(filename: str, payload: bytes) -> tuple[str, str]:
    root = storage_path()
    out_path = root / f"{uuid4().hex}_{filename}"
    sha = hashlib.sha256(payload).hexdigest()
    with Path(out_path).open("wb") as handle:
        handle.write(payload)
    return str(out_path), sha


def _default_import_mode(doc_type: DocumentType) -> str:
    if doc_type == DocumentType.XLSX:
        configured = settings.google_drive_intake_update_mode
        return configured if configured in IMPORT_UPDATE_MODES else "overwrite"
    return "overwrite"


def _sort_drive_files(files: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        files,
        key=lambda item: (
            _parse_drive_datetime(str(item.get("modifiedTime") or "")) or datetime.min.replace(tzinfo=timezone.utc),
            str(item.get("name") or "").casefold(),
        ),
    )


def process_next_drive_intake_file(
    db: Session,
    *,
    folder_url: str | None = None,
    folder_id: str | None = None,
    branch_id: str | None = None,
    service_account_json: str | None = None,
    file_lister: FileLister = list_drive_intake_files,
    downloader: Downloader = download_drive_file_bytes,
    import_job_runner: ImportJobRunner | None = None,
    processed_file_marker: ProcessedFileMarker | None = mark_drive_intake_file_processed,
) -> dict[str, Any]:
    effective_folder_url = (folder_url if folder_url is not None else settings.google_drive_intake_folder_url).strip()
    effective_folder_id = (folder_id or "").strip() or (extract_drive_folder_id(effective_folder_url) if effective_folder_url else "")
    if not effective_folder_id:
        return {"processed": 0, "disabled": True, "message": "Google Drive intake folder is not configured"}

    effective_branch_id = branch_id or settings.imap_branch_id or "main"
    skipped_already_processed = 0
    skipped_marked_processed = 0
    skipped_unsupported = 0
    last_existing_mark_result: dict[str, Any] = {}
    files = _sort_drive_files(file_lister(effective_folder_id, service_account_json))
    for item in files:
        file_id = str(item.get("id") or "").strip()
        if not file_id:
            skipped_unsupported += 1
            continue
        mime_type = str(item.get("mimeType") or "")
        raw_name = str(item.get("name") or file_id)
        filename = _normalize_drive_filename(raw_name, mime_type)
        doc_type = _document_type_for_drive_file(filename, mime_type)
        if doc_type not in {DocumentType.XLSX, DocumentType.DOCX}:
            skipped_unsupported += 1
            continue

        modified_time = str(item.get("modifiedTime") or "")
        idempotency_key = _idempotency_key(effective_branch_id, file_id, modified_time, raw_name)
        legacy_idempotency_key = _idempotency_key(effective_branch_id, file_id, modified_time)
        is_marked_processed = _drive_filename_has_processed_marker(raw_name)
        existing_job = _find_drive_intake_job(
            db,
            branch_id=effective_branch_id,
            file_id=file_id,
            modified_time=modified_time,
            filename=raw_name,
        )
        reprocesses_legacy_success_job = False
        if existing_job and existing_job.idempotency_key == legacy_idempotency_key:
            if existing_job.status == JobStatus.SUCCEEDED:
                reprocesses_legacy_success_job = True
                if not is_marked_processed:
                    existing_job = None

        if is_marked_processed:
            resync_reason = (
                _schedule_docx_resync_reason(db, existing_job, effective_branch_id)
                if existing_job and existing_job.status == JobStatus.SUCCEEDED and doc_type == DocumentType.DOCX
                else None
            )
            if existing_job and resync_reason:
                if resync_reason == "unreadable_document":
                    existing_job = _replace_existing_job_document_from_drive(
                        db,
                        existing_job,
                        branch_id=effective_branch_id,
                        file_id=file_id,
                        filename=filename,
                        mime_type=mime_type,
                        doc_type=doc_type,
                        modified_time=modified_time,
                        web_view_link=item.get("webViewLink"),
                        service_account_json=service_account_json,
                        downloader=downloader,
                    )
                runner_result, existing_job = _rerun_existing_import_job(
                    db,
                    existing_job,
                    import_job_runner,
                    import_mode=_default_import_mode(doc_type),
                )
                return {
                    "processed": 1,
                    "skipped_already_processed": skipped_already_processed,
                    "skipped_unsupported": skipped_unsupported,
                    "job_id": existing_job.id,
                    "status": _job_status_value(existing_job),
                    "filename": filename,
                    "drive_file_id": file_id,
                    "runner_result": runner_result,
                    "resynced_schedule": True,
                }
            skipped_marked_processed += 1
            continue

        if existing_job:
            if existing_job.status == JobStatus.FAILED:
                runner_result = None
                if import_job_runner is not None:
                    runner_result = import_job_runner(existing_job.id)
                    db.expire_all()
                    existing_job = db.get(ImportJob, existing_job.id) or existing_job
                marked_processed, processed_name, marking_error = _mark_processed_after_success(
                    existing_job,
                    file_id=file_id,
                    original_name=raw_name,
                    service_account_json=service_account_json,
                    processed_file_marker=processed_file_marker,
                )
                return {
                    "processed": 1,
                    "skipped_already_processed": skipped_already_processed,
                    "skipped_unsupported": skipped_unsupported,
                    "job_id": existing_job.id,
                    "status": _job_status_value(existing_job),
                    "filename": filename,
                    "drive_file_id": file_id,
                    "runner_result": runner_result,
                    "retried_failed_job": True,
                    **({"marked_processed": True, "processed_drive_file_name": processed_name} if marked_processed else {}),
                    **({"processed_drive_file_name": processed_name, "marking_error": marking_error} if marking_error else {}),
                }
            if (
                existing_job.status == JobStatus.SUCCEEDED
                and doc_type == DocumentType.DOCX
            ):
                resync_reason = _schedule_docx_resync_reason(db, existing_job, effective_branch_id)
            else:
                resync_reason = None
            if resync_reason:
                if resync_reason == "unreadable_document":
                    existing_job = _replace_existing_job_document_from_drive(
                        db,
                        existing_job,
                        branch_id=effective_branch_id,
                        file_id=file_id,
                        filename=filename,
                        mime_type=mime_type,
                        doc_type=doc_type,
                        modified_time=modified_time,
                        web_view_link=item.get("webViewLink"),
                        service_account_json=service_account_json,
                        downloader=downloader,
                    )
                runner_result, existing_job = _rerun_existing_import_job(
                    db,
                    existing_job,
                    import_job_runner,
                    import_mode=_default_import_mode(doc_type),
                )
                marked_processed, processed_name, marking_error = _mark_processed_after_success(
                    existing_job,
                    file_id=file_id,
                    original_name=raw_name,
                    service_account_json=service_account_json,
                    processed_file_marker=processed_file_marker,
                )
                if marked_processed:
                    _remember_processed_drive_name(
                        db,
                        existing_job,
                        branch_id=effective_branch_id,
                        file_id=file_id,
                        modified_time=modified_time,
                        processed_name=processed_name,
                    )
                return {
                    "processed": 1,
                    "skipped_already_processed": skipped_already_processed,
                    "skipped_unsupported": skipped_unsupported,
                    "job_id": existing_job.id,
                    "status": _job_status_value(existing_job),
                    "filename": filename,
                    "drive_file_id": file_id,
                    "runner_result": runner_result,
                    "resynced_schedule": True,
                    **({"marked_processed": True, "processed_drive_file_name": processed_name} if marked_processed else {}),
                    **({"processed_drive_file_name": processed_name, "marking_error": marking_error} if marking_error else {}),
                }
            marked_processed, processed_name, marking_error = _mark_processed_after_success(
                existing_job,
                file_id=file_id,
                original_name=raw_name,
                service_account_json=service_account_json,
                processed_file_marker=processed_file_marker,
            )
            if marked_processed:
                _remember_processed_drive_name(
                    db,
                    existing_job,
                    branch_id=effective_branch_id,
                    file_id=file_id,
                    modified_time=modified_time,
                    processed_name=processed_name,
                )
            skipped_already_processed += 1
            if marked_processed or marking_error:
                last_existing_mark_result = {
                    "job_id": existing_job.id,
                    "status": _job_status_value(existing_job),
                    "filename": filename,
                    "drive_file_id": file_id,
                    **({"marked_processed": True, "processed_drive_file_name": processed_name} if marked_processed else {}),
                    **({"processed_drive_file_name": processed_name, "marking_error": marking_error} if marking_error else {}),
                }
            continue

        payload = downloader(file_id, mime_type, service_account_json)
        if not payload:
            skipped_unsupported += 1
            continue
        file_path, sha256 = _store_drive_file(filename, payload)
        document = Document(
            branch_id=effective_branch_id,
            file_name=filename,
            file_path=file_path,
            file_type=doc_type,
            source="drive_intake",
            mime_type=mime_type or "application/octet-stream",
            hash_sha256=sha256,
        )
        db.add(document)
        db.flush()

        import_mode = _default_import_mode(doc_type)
        job = ImportJob(
            branch_id=effective_branch_id,
            idempotency_key=idempotency_key,
            document_id=document.id,
            status=JobStatus.QUEUED,
            message="Заявку на імпорт з Google Drive створено",
            result_payload={
                "source": "drive_intake",
                "channel": "google_drive_folder",
                "drive_file_id": file_id,
                "drive_file_name": filename,
                "drive_modified_time": modified_time or None,
                "drive_url": item.get("webViewLink"),
                "group_code_hint": _extract_group_code_from_filename(filename),
                "import_mode": import_mode,
            },
        )
        db.add(job)
        db.commit()
        db.refresh(job)

        runner_result = None
        if import_job_runner is not None:
            runner_result = import_job_runner(job.id)
            db.expire_all()
            job = db.get(ImportJob, job.id) or job
        marked_processed, processed_name, marking_error = _mark_processed_after_success(
            job,
            file_id=file_id,
            original_name=raw_name,
            service_account_json=service_account_json,
            processed_file_marker=processed_file_marker,
        )
        if marked_processed:
            _remember_processed_drive_name(
                db,
                job,
                branch_id=effective_branch_id,
                file_id=file_id,
                modified_time=modified_time,
                processed_name=processed_name,
            )

        return {
            "processed": 1,
            "skipped_already_processed": skipped_already_processed,
            "skipped_unsupported": skipped_unsupported,
            "job_id": job.id,
            "status": _job_status_value(job),
            "filename": filename,
            "drive_file_id": file_id,
            "runner_result": runner_result,
            **({"marked_processed": True, "processed_drive_file_name": processed_name} if marked_processed else {}),
            **({"processed_drive_file_name": processed_name, "marking_error": marking_error} if marking_error else {}),
            **({"reprocessed_legacy_success_job": True} if reprocesses_legacy_success_job else {}),
        }

    result = {
        "processed": 0,
        "skipped_already_processed": skipped_already_processed,
        "skipped_unsupported": skipped_unsupported,
    }
    if skipped_marked_processed:
        result["skipped_marked_processed"] = skipped_marked_processed
    result.update(last_existing_mark_result)
    return result
