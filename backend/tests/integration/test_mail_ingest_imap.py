from email.message import EmailMessage
from pathlib import Path

from docx import Document as DocxDocument

from app.models import DraftStatus, ImportJob, JobStatus, MailMessage, MailStatus, OCRResult
from app.services import mail_ingest


class FakeIMAP4SSL:
    def __init__(self, raw_message: bytes):
        self.raw_message = raw_message
        self.logged_out = False

    def login(self, user: str, password: str):
        return "OK", [b"LOGIN"]

    def select(self, mailbox: str):
        return "OK", [b"1"]

    def search(self, charset, criteria):
        return "OK", [b"1"]

    def fetch(self, msg_id: bytes, payload: str):
        return "OK", [(b"1 (RFC822 {256})", self.raw_message)]

    def logout(self):
        self.logged_out = True
        return "BYE", [b"LOGOUT"]


def _build_message_with_docx_attachment(tmp_path: Path) -> bytes:
    docx_path = tmp_path / "attachment.docx"
    document = DocxDocument()
    document.add_paragraph("Іван Петренко")
    document.add_paragraph("Заява на навчання")
    document.save(docx_path)

    msg = EmailMessage()
    msg["Subject"] = "Тестовий лист"
    msg["From"] = "sender@example.com"
    msg["To"] = "inbox@example.com"
    msg["Message-ID"] = "<test-message-1@example.com>"
    msg.set_content("Вітаю, дивіться вкладення")

    msg.add_attachment(
        docx_path.read_bytes(),
        maintype="application",
        subtype="vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename="trainee.docx",
    )
    return msg.as_bytes()


def test_ingest_mailbox_creates_message_document_and_draft_or_import_job(db_session, monkeypatch, tmp_path: Path):
    raw_message = _build_message_with_docx_attachment(tmp_path)
    fake_client = FakeIMAP4SSL(raw_message)

    monkeypatch.setattr(mail_ingest.settings, "imap_host", "imap.example.com")
    monkeypatch.setattr(mail_ingest.settings, "imap_port", 993)
    monkeypatch.setattr(mail_ingest.settings, "imap_user", "inbox@example.com")
    monkeypatch.setattr(mail_ingest.settings, "imap_password", "secret")
    monkeypatch.setattr(mail_ingest.settings, "imap_mailbox", "INBOX")
    monkeypatch.setattr(mail_ingest.imaplib, "IMAP4_SSL", lambda host, port: fake_client)

    result = mail_ingest.ingest_mailbox(db_session)
    assert result["processed"] == 1

    message = db_session.query(MailMessage).filter(MailMessage.message_id == "<test-message-1@example.com>").one()
    assert message.status == MailStatus.PROCESSED
    assert message.subject == "Тестовий лист"

    import_job = db_session.query(ImportJob).order_by(ImportJob.id.desc()).first()
    if import_job is not None:
        assert import_job.status == JobStatus.SUCCEEDED
        assert import_job.result_payload is not None
        assert import_job.result_payload.get("source") == "mail"
        return

    draft = db_session.query(OCRResult).order_by(OCRResult.id.desc()).first()
    assert draft is not None
    assert draft.status == DraftStatus.PENDING
    assert draft.confidence > 0.5
    assert "Іван" in draft.extracted_text
