from dataclasses import dataclass

from app.models import DocumentType
from app.services.storage import detect_document_type


@dataclass(frozen=True)
class ImportFormat:
    extensions: tuple[str, ...]
    document_type: DocumentType
    import_kind: str
    description: str


BATCH_IMPORT_FORMATS: tuple[ImportFormat, ...] = (
    ImportFormat(
        extensions=("xls", "xlsx"),
        document_type=DocumentType.XLSX,
        import_kind="contracts",
        description="Договори та списки слухачів",
    ),
    ImportFormat(
        extensions=("csv",),
        document_type=DocumentType.CSV,
        import_kind="contracts",
        description="Договори та списки слухачів",
    ),
    ImportFormat(
        extensions=("docx",),
        document_type=DocumentType.DOCX,
        import_kind="schedule",
        description="Розклади занять",
    ),
)


def get_batch_import_format(filename: str | None) -> ImportFormat | None:
    if not filename or "." not in filename:
        return None
    ext = filename.rsplit(".", 1)[1].lower()
    for import_format in BATCH_IMPORT_FORMATS:
        if ext in import_format.extensions and detect_document_type(filename) == import_format.document_type:
            return import_format
    return None


def supported_batch_import_extensions() -> list[str]:
    return sorted({ext for import_format in BATCH_IMPORT_FORMATS for ext in import_format.extensions})
