from io import BytesIO

from app.api.routes import mail as mail_routes
from app.models import Document, DocumentType, DraftStatus, OCRResult, ScheduleSlot


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


def test_upload_ocr_image_creates_editable_draft(client, auth_headers, monkeypatch):
    monkeypatch.setattr(
        mail_routes,
        "ocr_image_file",
        lambda path: "Іван Петренко\nДоговір № 77\nГрупа 46-26",
    )

    response = client.post(
        "/api/v1/drafts/upload-image",
        headers=auth_headers,
        data={"draft_type": "trainee_card"},
        files={"file": ("scan.png", BytesIO(b"fake image bytes"), "image/png")},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["draft_type"] == "trainee_card"
    assert body["status"] == "pending"
    assert body["structured_payload"]["group_code"] == "46-26"
    assert body["structured_payload"]["contract_number"] == "77"


def test_upload_ocr_image_uses_browser_extracted_text(client, auth_headers, monkeypatch):
    monkeypatch.setattr(
        mail_routes,
        "ocr_image_file",
        lambda path: (_ for _ in ()).throw(AssertionError("server OCR should not be called")),
    )

    response = client.post(
        "/api/v1/drafts/upload-image",
        headers=auth_headers,
        data={
            "draft_type": "schedule",
            "extracted_text": "Розклад занять\n21.10\nКар'єрний розвиток\n1п/1год\nПаращук Світлана Зеновіївна",
        },
        files={"file": ("162-25.png", BytesIO(b"fake image bytes"), "image/png")},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["draft_type"] == "schedule"
    assert "Розклад занять" in body["extracted_text"]
    assert body["structured_payload"]["group_code"] == "162-25"
    assert len(body["structured_payload"]["entries"]) == 1


def test_approve_schedule_draft_creates_schedule_slots(client, auth_headers, db_session):
    document = Document(
        file_name="schedule.png",
        file_path="/tmp/schedule.png",
        file_type=DocumentType.OTHER,
        source="ocr_upload",
    )
    db_session.add(document)
    db_session.flush()

    draft = OCRResult(
        document_id=document.id,
        extracted_text="Розклад групи 46-26",
        structured_payload={
            "group_code": "46-26",
            "group_name": "Група 46-26",
            "entries": [
                {
                    "date": "2026-04-30",
                    "pair_number": 1,
                    "teacher_name": "Петренко Іван",
                    "subject_name": "Охорона праці",
                    "room_name": "12",
                    "academic_hours": 2,
                }
            ],
        },
        draft_type="schedule",
        confidence=0.8,
        status=DraftStatus.PENDING,
    )
    db_session.add(draft)
    db_session.commit()

    response = client.post(f"/api/v1/drafts/{draft.id}/approve", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "approved"
    assert body["created_entity"]["type"] == "schedule"
    assert body["created_entity"]["created_slots"] == 1
    assert db_session.query(ScheduleSlot).count() == 1
