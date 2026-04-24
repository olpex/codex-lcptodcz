from pathlib import Path

from app.models import Document, DocumentType, User


def test_download_document_endpoint(client, auth_headers):
    storage_root = Path("tmp/pytest/storage")
    storage_root.mkdir(parents=True, exist_ok=True)
    sample_file = storage_root / "download_test.txt"
    sample_file.write_text("sample-export-content", encoding="utf-8")

    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        actor = db.query(User).filter(User.username == "admin").first()
        document = Document(
            branch_id="main",
            file_name="download_test.txt",
            file_path=str(sample_file),
            file_type=DocumentType.OTHER,
            source="export",
            mime_type="text/plain",
            created_by=actor.id if actor else None,
        )
        db.add(document)
        db.commit()
        db.refresh(document)
        document_id = document.id
    finally:
        db.close()

    response = client.get(f"/api/v1/documents/{document_id}/download", headers=auth_headers)
    assert response.status_code == 200
    assert response.text == "sample-export-content"
