import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote
from urllib.request import urlopen
from uuid import uuid4

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.crypto import cipher
from app.models import Document, DocumentType, ImportJob, JobStatus, JournalMonitorSection
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
        )
        if page_token:
            url += f"&pageToken={quote(page_token)}"
        with urlopen(_drive_request_url(url, service_account_json), timeout=GOOGLE_DRIVE_REQUEST_TIMEOUT_SECONDS) as response:
            payload = response.read().decode("utf-8")

        data = json.loads(payload)
        files.extend(data.get("files", []))
        page_token = data.get("nextPageToken") or ""
        if not page_token:
            return files


def _normalize_drive_filename(name: str, mime_type: str | None) -> str:
    filename = re.sub(r"[\\/]+", "_", (name or "drive-file").strip()) or "drive-file"
    extension = _MIME_EXTENSIONS.get(mime_type or "")
    if extension and not filename.lower().endswith(extension):
        filename = f"{filename}{extension}"
    return filename[:240]


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


def _idempotency_key(branch_id: str, file_id: str, modified_time: str | None) -> str:
    digest = hashlib.sha1(f"{file_id}:{modified_time or ''}".encode("utf-8")).hexdigest()[:32]
    return f"{branch_id}:drive-intake:{digest}"


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
        return configured if configured in IMPORT_UPDATE_MODES else "missing_only"
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
) -> dict[str, Any]:
    effective_folder_url = (folder_url if folder_url is not None else settings.google_drive_intake_folder_url).strip()
    effective_folder_id = (folder_id or "").strip() or (extract_drive_folder_id(effective_folder_url) if effective_folder_url else "")
    if not effective_folder_id:
        return {"processed": 0, "disabled": True, "message": "Google Drive intake folder is not configured"}

    effective_branch_id = branch_id or settings.imap_branch_id or "main"
    skipped_already_processed = 0
    skipped_unsupported = 0
    files = _sort_drive_files(file_lister(effective_folder_id, service_account_json))
    for item in files:
        file_id = str(item.get("id") or "").strip()
        if not file_id:
            skipped_unsupported += 1
            continue
        mime_type = str(item.get("mimeType") or "")
        filename = _normalize_drive_filename(str(item.get("name") or file_id), mime_type)
        doc_type = _document_type_for_drive_file(filename, mime_type)
        if doc_type not in {DocumentType.XLSX, DocumentType.DOCX}:
            skipped_unsupported += 1
            continue

        modified_time = str(item.get("modifiedTime") or "")
        idempotency_key = _idempotency_key(effective_branch_id, file_id, modified_time)
        if db.query(ImportJob).filter(ImportJob.idempotency_key == idempotency_key).first():
            skipped_already_processed += 1
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

        return {
            "processed": 1,
            "skipped_already_processed": skipped_already_processed,
            "skipped_unsupported": skipped_unsupported,
            "job_id": job.id,
            "status": job.status.value if hasattr(job.status, "value") else str(job.status),
            "filename": filename,
            "drive_file_id": file_id,
            "runner_result": runner_result,
        }

    return {
        "processed": 0,
        "skipped_already_processed": skipped_already_processed,
        "skipped_unsupported": skipped_unsupported,
    }
