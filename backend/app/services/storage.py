import hashlib
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from app.core.config import settings
from app.models import DocumentType

_resolved_storage_root: Path | None = None


def detect_document_type(filename: str | None) -> DocumentType:
    if not filename or "." not in filename:
        return DocumentType.OTHER
    ext = filename.rsplit(".", 1)[1].lower()
    if ext in {"xlsx", "xls"}:
        return DocumentType.XLSX
    if ext == "pdf":
        return DocumentType.PDF
    if ext == "docx":
        return DocumentType.DOCX
    if ext == "csv":
        return DocumentType.CSV
    return DocumentType.OTHER


def storage_path() -> Path:
    global _resolved_storage_root
    if _resolved_storage_root is not None:
        return _resolved_storage_root

    primary = Path(settings.file_storage_path)
    candidates = [primary, Path("/tmp/documents"), Path("./tmp/documents")]

    for candidate in candidates:
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            _resolved_storage_root = candidate
            return candidate
        except OSError:
            continue

    raise OSError("Не вдалося ініціалізувати файлове сховище документів")


def persist_upload(upload: UploadFile) -> tuple[str, str]:
    root = storage_path()
    suffix = f".{upload.filename.rsplit('.', 1)[1].lower()}" if upload.filename and "." in upload.filename else ""
    out_name = f"{uuid4().hex}{suffix}"
    out_path = root / out_name

    sha = hashlib.sha256()
    with out_path.open("wb") as destination:
        while True:
            chunk = upload.file.read(1024 * 1024)
            if not chunk:
                break
            sha.update(chunk)
            destination.write(chunk)
    return str(out_path), sha.hexdigest()
