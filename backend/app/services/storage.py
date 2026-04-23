import hashlib
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from app.core.config import settings
from app.models import DocumentType


def detect_document_type(filename: str | None) -> DocumentType:
    if not filename or "." not in filename:
        return DocumentType.OTHER
    ext = filename.rsplit(".", 1)[1].lower()
    if ext == "xlsx":
        return DocumentType.XLSX
    if ext == "pdf":
        return DocumentType.PDF
    if ext == "docx":
        return DocumentType.DOCX
    if ext == "csv":
        return DocumentType.CSV
    return DocumentType.OTHER


def storage_path() -> Path:
    root = Path(settings.file_storage_path)
    root.mkdir(parents=True, exist_ok=True)
    return root


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

