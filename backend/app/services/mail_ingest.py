import email
import imaplib
from datetime import datetime, timezone
from email.header import decode_header
from pathlib import Path
from uuid import uuid4

from docx import Document as DocxDocument
from pypdf import PdfReader
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Document, DocumentType, DraftStatus, MailMessage, MailStatus, OCRResult
from app.services.ocr import guess_draft_from_text, ocr_image_file
from app.services.storage import detect_document_type, storage_path


def _decode_header(value: str | None) -> str:
    if not value:
        return ""
    fragments = decode_header(value)
    decoded: list[str] = []
    for fragment, encoding in fragments:
        if isinstance(fragment, bytes):
            decoded.append(fragment.decode(encoding or "utf-8", errors="ignore"))
        else:
            decoded.append(fragment)
    return "".join(decoded)


def _extract_text_from_file(path: str, doc_type: DocumentType) -> str:
    if doc_type == DocumentType.DOCX:
        document = DocxDocument(path)
        return "\n".join(para.text for para in document.paragraphs if para.text.strip())
    if doc_type == DocumentType.PDF:
        reader = PdfReader(path)
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    return ocr_image_file(path)


def ingest_mailbox(db: Session) -> dict:
    if not settings.imap_host or not settings.imap_user or not settings.imap_password:
        return {"processed": 0, "message": "IMAP не налаштовано"}

    processed = 0
    mailbox = imaplib.IMAP4_SSL(settings.imap_host, settings.imap_port)
    mailbox.login(settings.imap_user, settings.imap_password)
    mailbox.select(settings.imap_mailbox)
    status, data = mailbox.search(None, "UNSEEN")
    if status != "OK":
        mailbox.logout()
        return {"processed": 0, "message": "Не вдалося отримати список листів"}

    ids = data[0].split()
    for msg_id in ids:
        status, message_data = mailbox.fetch(msg_id, "(RFC822)")
        if status != "OK" or not message_data:
            continue

        raw = message_data[0][1]
        parsed = email.message_from_bytes(raw)
        message_id = parsed.get("Message-ID", f"local-{uuid4().hex}")

        existing = db.query(MailMessage).filter(MailMessage.message_id == message_id).first()
        if existing:
            continue

        subject = _decode_header(parsed.get("Subject"))
        sender = _decode_header(parsed.get("From"))
        received_at = datetime.now(timezone.utc)

        snippet = ""
        for part in parsed.walk():
            content_type = part.get_content_type()
            content_disposition = str(part.get("Content-Disposition", ""))
            if content_type == "text/plain" and "attachment" not in content_disposition:
                payload = part.get_payload(decode=True)
                if payload:
                    snippet = payload.decode(errors="ignore")[:500]
                    break

        record = MailMessage(
            message_id=message_id,
            sender=sender,
            subject=subject or "(без теми)",
            received_at=received_at,
            snippet=snippet,
            status=MailStatus.NEW,
        )
        db.add(record)
        db.flush()

        for part in parsed.walk():
            content_disposition = str(part.get("Content-Disposition", ""))
            if "attachment" not in content_disposition:
                continue

            filename = _decode_header(part.get_filename()) or f"attachment_{uuid4().hex}.bin"
            payload = part.get_payload(decode=True)
            if not payload:
                continue

            doc_type = detect_document_type(filename)
            out_path = storage_path() / f"{uuid4().hex}_{filename}"
            with Path(out_path).open("wb") as handle:
                handle.write(payload)

            document = Document(
                file_name=filename,
                file_path=str(out_path),
                file_type=doc_type,
                source="mail",
                mime_type=part.get_content_type(),
            )
            db.add(document)
            db.flush()

            text = _extract_text_from_file(str(out_path), doc_type)
            draft_type, payload_guess = guess_draft_from_text(text)
            ocr_result = OCRResult(
                document_id=document.id,
                extracted_text=text,
                structured_payload=payload_guess,
                draft_type=draft_type,
                status=DraftStatus.PENDING,
                confidence=0.75 if text else 0.1,
            )
            db.add(ocr_result)

        record.status = MailStatus.PROCESSED
        processed += 1

    db.commit()
    mailbox.logout()
    return {"processed": processed}

