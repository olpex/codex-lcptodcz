import csv
import base64
import json
import re
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlencode, urlparse, parse_qs
from urllib.request import Request, urlopen

from docx import Document as DocxDocument
from jose import jwt
from openpyxl import Workbook
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Group, JournalMonitorEntry, JournalMonitorSection, ScheduleSlot, Trainee
from app.services.import_export import save_report_file

GOOGLE_DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder"
GOOGLE_DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly"
GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token"
SERVICE_ACCOUNT_SETUP_MESSAGE = (
    "Для приватної Google Drive папки залиште в доступі папки email service account "
    "suptc-drive-journal-monitor@gen-lang-client-0242013668.iam.gserviceaccount.com "
    "і задайте на backend змінну GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON з JSON-ключем цього service account. "
    "GOOGLE_DRIVE_API_KEY потрібен тільки для публічних папок."
)
GROUP_CODE_PATTERN = re.compile(r"^\s*([0-9]{1,4}\s*[A-Za-zА-Яа-яІіЇїЄєҐґ]?\s*[-–—]\s*[0-9]{2,4})")
EXPORT_FORMATS = {"xlsx", "pdf", "docx", "csv"}
_service_account_token_cache: dict[str, Any] = {"access_token": None, "expires_at": 0.0}


def normalize_group_code(value: str | None) -> str:
    raw = (value or "").strip()
    raw = raw.replace("–", "-").replace("—", "-")
    raw = re.sub(r"\s*-\s*", "-", raw)
    return raw.casefold()


def display_group_code(value: str | None) -> str | None:
    raw = (value or "").strip()
    if not raw:
        return None
    raw = raw.replace("–", "-").replace("—", "-")
    return re.sub(r"\s*-\s*", "-", raw)


def extract_group_code(folder_name: str) -> str | None:
    match = GROUP_CODE_PATTERN.search(folder_name or "")
    if not match:
        return None
    return display_group_code(match.group(1))


def extract_drive_folder_id(folder_url: str) -> str:
    value = (folder_url or "").strip()
    if not value:
        raise ValueError("Вкажіть URL папки Google Drive")

    parsed = urlparse(value)
    query_id = parse_qs(parsed.query).get("id")
    if query_id and query_id[0]:
        return query_id[0]

    match = re.search(r"/folders/([^/?#]+)", parsed.path)
    if match:
        return unquote(match.group(1))

    if re.fullmatch(r"[A-Za-z0-9_-]{10,}", value):
        return value

    raise ValueError("Не вдалося визначити ID папки Google Drive з посилання")


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _decode_service_account_json() -> dict[str, Any]:
    raw_value = settings.google_drive_service_account_json.strip()
    if not raw_value:
        raise RuntimeError(SERVICE_ACCOUNT_SETUP_MESSAGE)

    try:
        if raw_value.startswith("{"):
            payload = json.loads(raw_value)
        else:
            try:
                payload = json.loads(base64.b64decode(raw_value).decode("utf-8"))
            except Exception:
                with Path(raw_value).open("r", encoding="utf-8") as handle:
                    payload = json.load(handle)
    except Exception as exc:
        raise RuntimeError("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON має бути JSON, base64(JSON) або шляхом до JSON-файлу") from exc

    if not payload.get("client_email") or not payload.get("private_key"):
        raise RuntimeError("JSON service account має містити client_email і private_key")
    return payload


def _get_service_account_access_token() -> str:
    now = time.time()
    cached_token = _service_account_token_cache.get("access_token")
    if cached_token and float(_service_account_token_cache.get("expires_at") or 0) > now + 60:
        return str(cached_token)

    account = _decode_service_account_json()
    token_uri = account.get("token_uri") or GOOGLE_TOKEN_URI
    issued_at = int(now)
    claims = {
        "iss": account["client_email"],
        "scope": GOOGLE_DRIVE_READONLY_SCOPE,
        "aud": token_uri,
        "iat": issued_at,
        "exp": issued_at + 3600,
    }
    assertion = jwt.encode(claims, account["private_key"], algorithm="RS256")
    body = urlencode(
        {
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": assertion,
        }
    ).encode("utf-8")
    request = Request(
        token_uri,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=20) as response:
        payload = json.loads(response.read().decode("utf-8"))
    access_token = payload.get("access_token")
    if not access_token:
        raise RuntimeError("Google OAuth не повернув access_token для service account")
    _service_account_token_cache["access_token"] = access_token
    _service_account_token_cache["expires_at"] = now + int(payload.get("expires_in") or 3600)
    return str(access_token)


def list_drive_child_folders(folder_id: str) -> list[dict[str, Any]]:
    use_service_account = bool(settings.google_drive_service_account_json.strip())
    if not use_service_account and not settings.google_drive_api_key:
        raise RuntimeError(SERVICE_ACCOUNT_SETUP_MESSAGE)

    query = f"'{folder_id}' in parents and mimeType = '{GOOGLE_DRIVE_FOLDER_MIME}' and trashed = false"
    fields = "nextPageToken,files(id,name,mimeType,webViewLink,modifiedTime)"
    page_token = ""
    folders: list[dict[str, Any]] = []
    access_token = _get_service_account_access_token() if use_service_account else None
    while True:
        url = (
            "https://www.googleapis.com/drive/v3/files"
            f"?q={quote(query)}"
            f"&fields={quote(fields)}"
            "&pageSize=1000"
        )
        if not use_service_account:
            url += f"&key={quote(settings.google_drive_api_key)}"
        if page_token:
            url += f"&pageToken={quote(page_token)}"
        request_or_url: str | Request = url
        if access_token:
            request_or_url = Request(url, headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"})
        with urlopen(request_or_url, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
        for item in payload.get("files", []):
            folders.append(
                {
                    "id": item.get("id") or "",
                    "name": item.get("name") or "",
                    "url": item.get("webViewLink") or f"https://drive.google.com/drive/folders/{item.get('id')}",
                    "modified_time": item.get("modifiedTime"),
                }
            )
        page_token = payload.get("nextPageToken") or ""
        if not page_token:
            return folders


def collect_monitor_stats(entries: list[JournalMonitorEntry]) -> dict[str, int]:
    stats = {
        "total": len(entries),
        "complete": 0,
        "schedule_only": 0,
        "trainees_only": 0,
        "not_processed": 0,
        "unknown_code": 0,
    }
    for entry in entries:
        if entry.processing_status in stats:
            stats[entry.processing_status] += 1
    return stats


def section_to_response_payload(section: JournalMonitorSection, include_entries: bool = False) -> dict[str, Any]:
    entries = sorted(section.entries, key=lambda item: ((item.group_code or "~~~~").casefold(), item.journal_name.casefold()))
    payload = {
        "id": section.id,
        "name": section.name,
        "folder_url": section.folder_url,
        "folder_id": section.folder_id,
        "is_active": section.is_active,
        "last_synced_at": section.last_synced_at,
        "last_sync_status": section.last_sync_status,
        "last_sync_message": section.last_sync_message,
        "stats": collect_monitor_stats(entries),
    }
    if include_entries:
        payload["entries"] = [entry_to_response_payload(entry) for entry in entries]
    return payload


def entry_to_response_payload(entry: JournalMonitorEntry) -> dict[str, Any]:
    return {
        "id": entry.id,
        "drive_file_id": entry.drive_file_id,
        "drive_url": entry.drive_url,
        "journal_name": entry.journal_name,
        "group_code": entry.group_code,
        "matched_group_id": entry.matched_group_id,
        "has_group": entry.has_group,
        "has_schedule": entry.has_schedule,
        "has_trainees": entry.has_trainees,
        "schedule_lessons": entry.schedule_lessons,
        "trainee_count": entry.trainee_count,
        "processing_status": entry.processing_status,
        "drive_modified_at": entry.drive_modified_at,
        "last_seen_at": entry.last_seen_at,
    }


def _status(has_schedule: bool, has_trainees: bool, group_code: str | None) -> str:
    if not group_code:
        return "unknown_code"
    if has_schedule and has_trainees:
        return "complete"
    if has_schedule:
        return "schedule_only"
    if has_trainees:
        return "trainees_only"
    return "not_processed"


def _group_maps(db: Session, branch_id: str) -> tuple[dict[str, Group], dict[str, int], dict[str, int]]:
    groups = db.query(Group).filter(Group.branch_id == branch_id).all()
    groups_by_code = {normalize_group_code(group.code): group for group in groups}

    schedule_counts: dict[str, int] = {}
    schedule_rows = (
        db.query(Group.code, func.count(ScheduleSlot.id))
        .join(ScheduleSlot, ScheduleSlot.group_id == Group.id)
        .filter(Group.branch_id == branch_id)
        .group_by(Group.code)
        .all()
    )
    for code, count in schedule_rows:
        schedule_counts[normalize_group_code(code)] = int(count or 0)

    trainee_counts: dict[str, int] = {}
    trainee_rows = (
        db.query(Trainee.group_code, func.count(Trainee.id))
        .filter(
            Trainee.branch_id == branch_id,
            Trainee.is_deleted.is_(False),
            Trainee.group_code.is_not(None),
            Trainee.group_code != "",
        )
        .group_by(Trainee.group_code)
        .all()
    )
    for code, count in trainee_rows:
        trainee_counts[normalize_group_code(code)] = trainee_counts.get(normalize_group_code(code), 0) + int(count or 0)

    return groups_by_code, schedule_counts, trainee_counts


def sync_journal_monitor_section(
    db: Session,
    section: JournalMonitorSection,
    folder_lister=list_drive_child_folders,
) -> JournalMonitorSection:
    now = datetime.now(timezone.utc)
    folders = folder_lister(section.folder_id)
    groups_by_code, schedule_counts, trainee_counts = _group_maps(db, section.branch_id)
    seen_drive_ids: set[str] = set()

    entries_by_drive_id = {entry.drive_file_id: entry for entry in section.entries}
    for folder in folders:
        drive_id = str(folder.get("id") or "").strip()
        name = str(folder.get("name") or "").strip() or drive_id
        if not drive_id:
            continue
        seen_drive_ids.add(drive_id)
        group_code = extract_group_code(name)
        normalized_code = normalize_group_code(group_code)
        matched_group = groups_by_code.get(normalized_code) if normalized_code else None
        schedule_lessons = schedule_counts.get(normalized_code, 0)
        trainee_count = trainee_counts.get(normalized_code, 0)
        has_schedule = schedule_lessons > 0
        has_trainees = trainee_count > 0

        entry = entries_by_drive_id.get(drive_id)
        if not entry:
            entry = JournalMonitorEntry(
                section_id=section.id,
                branch_id=section.branch_id,
                drive_file_id=drive_id,
                journal_name=name,
            )
            db.add(entry)

        entry.drive_url = str(folder.get("url") or f"https://drive.google.com/drive/folders/{drive_id}")
        entry.journal_name = name
        entry.group_code = group_code
        entry.matched_group_id = matched_group.id if matched_group else None
        entry.has_group = matched_group is not None
        entry.has_schedule = has_schedule
        entry.has_trainees = has_trainees
        entry.schedule_lessons = schedule_lessons
        entry.trainee_count = trainee_count
        entry.processing_status = _status(has_schedule, has_trainees, group_code)
        entry.drive_modified_at = _parse_datetime(folder.get("modified_time"))
        entry.last_seen_at = now

    for entry in section.entries:
        if entry.drive_file_id not in seen_drive_ids:
            db.delete(entry)

    section.last_synced_at = now
    section.last_sync_status = "success"
    section.last_sync_message = f"Оновлено папок журналів: {len(seen_drive_ids)}"
    db.flush()
    db.refresh(section)
    return section


def collect_export_rows(section: JournalMonitorSection) -> list[dict[str, Any]]:
    entries = sorted(section.entries, key=lambda item: ((item.group_code or "~~~~").casefold(), item.journal_name.casefold()))
    return [
        {
            "Розділ": section.name,
            "Номер групи": entry.group_code or "",
            "Назва папки журналу": entry.journal_name,
            "Статус опрацювання": format_processing_status(entry.processing_status),
            "Є група в системі": "Так" if entry.has_group else "Ні",
            "Є розклад": "Так" if entry.has_schedule else "Ні",
            "Занять у розкладі": entry.schedule_lessons,
            "Є слухачі": "Так" if entry.has_trainees else "Ні",
            "Кількість слухачів": entry.trainee_count,
            "Посилання Drive": entry.drive_url or "",
            "Остання синхронізація": section.last_synced_at.isoformat() if section.last_synced_at else "",
        }
        for entry in entries
    ]


def format_processing_status(value: str) -> str:
    return {
        "complete": "Опрацьовано: розклад і слухачі",
        "schedule_only": "Опрацьовано тільки розклад",
        "trainees_only": "Опрацьовано тільки слухачі",
        "not_processed": "Не опрацьовано",
        "unknown_code": "Не визначено номер групи",
    }.get(value, value)


def save_journal_monitor_export(section: JournalMonitorSection, export_format: str) -> tuple[str, str, str]:
    if export_format not in EXPORT_FORMATS:
        raise ValueError("Підтримуються формати xlsx, pdf, docx, csv")

    rows = collect_export_rows(section)
    safe_name = re.sub(r"[^0-9A-Za-zА-Яа-яІіЇїЄєҐґ_-]+", "_", section.name).strip("_") or "journals"
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")

    if export_format == "pdf":
        path, _doc_type = save_report_file(rows, "journal_monitor", "pdf")
        return path, f"{safe_name}_{timestamp}.pdf", "application/pdf"

    temp_dir = Path(tempfile.gettempdir()) / "suptc_exports"
    temp_dir.mkdir(parents=True, exist_ok=True)
    out_file = temp_dir / f"{safe_name}_{timestamp}.{export_format}"
    headers = list(rows[0].keys()) if rows else ["Дані"]

    if export_format == "csv":
        with out_file.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=headers)
            writer.writeheader()
            for row in rows:
                writer.writerow(row)
        return str(out_file), out_file.name, "text/csv; charset=utf-8"

    if export_format == "xlsx":
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Журнали"
        sheet.append(headers)
        for row in rows:
            sheet.append([row.get(header) for header in headers])
        workbook.save(out_file)
        return str(out_file), out_file.name, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    document = DocxDocument()
    document.add_heading(f"Моніторинг журналів: {section.name}", level=1)
    table = document.add_table(rows=1, cols=len(headers))
    header_cells = table.rows[0].cells
    for index, header in enumerate(headers):
        header_cells[index].text = header
    for row in rows:
        cells = table.add_row().cells
        for index, header in enumerate(headers):
            cells[index].text = str(row.get(header, ""))
    document.save(out_file)
    return str(out_file), out_file.name, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
