from app.models import Document, DocumentType, DraftStatus, OCRResult


def test_update_and_approve_draft_flow(client, auth_headers, db_session):
    document = Document(
        file_name="scan.png",
        file_path="/tmp/scan.png",
        file_type=DocumentType.OTHER,
        source="mail",
    )
    db_session.add(document)
    db_session.flush()

    draft = OCRResult(
        document_id=document.id,
        extracted_text="Іван Петренко",
        structured_payload={"first_name": "Іван", "last_name": "Петренко", "status": "active"},
        draft_type="trainee_card",
        confidence=0.7,
        status=DraftStatus.PENDING,
    )
    db_session.add(draft)
    db_session.commit()

    patch_response = client.patch(
        f"/api/v1/drafts/{draft.id}",
        headers=auth_headers,
        json={
            "draft_type": "order",
            "confidence": 0.95,
            "structured_payload": {"order_number": "AUTO-99", "status": "draft"},
        },
    )
    assert patch_response.status_code == 200
    assert patch_response.json()["draft_type"] == "order"
    assert patch_response.json()["confidence"] == 0.95

    approve_response = client.post(f"/api/v1/drafts/{draft.id}/approve", headers=auth_headers)
    assert approve_response.status_code == 200
    body = approve_response.json()
    assert body["status"] == "approved"
    assert body["created_entity"]["type"] == "order"

