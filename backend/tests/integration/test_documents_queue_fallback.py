import io

from docx import Document as DocxDocument

from app.api.routes import documents as documents_route


def _docx_bytes(text: str) -> bytes:
    stream = io.BytesIO()
    doc = DocxDocument()
    doc.add_paragraph(text)
    doc.save(stream)
    stream.seek(0)
    return stream.read()


def test_import_works_when_queue_is_unavailable(client, auth_headers, monkeypatch):
    def _raise_queue_error(job_id: int):
        raise RuntimeError("redis unavailable")

    monkeypatch.setattr(documents_route.process_import_job_task, "delay", _raise_queue_error)

    file_bytes = _docx_bytes("Тестовий DOCX документ")
    response = client.post(
        "/api/v1/documents/import",
        headers=auth_headers,
        files={
            "file": (
                "167-25 Організація трудових відносин – копія.docx",
                file_bytes,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert response.status_code == 202
    payload = response.json()
    assert payload["status"] in {"running", "succeeded", "failed"}
    assert payload["status"] != "queued"


def test_export_works_when_queue_is_unavailable(client, auth_headers, monkeypatch):
    def _raise_queue_error(job_id: int):
        raise RuntimeError("redis unavailable")

    monkeypatch.setattr(documents_route.process_export_job_task, "delay", _raise_queue_error)

    response = client.post(
        "/api/v1/documents/export",
        headers=auth_headers,
        json={"report_type": "kpi", "export_format": "xlsx"},
    )
    assert response.status_code == 202
    payload = response.json()
    assert payload["status"] in {"running", "succeeded", "failed"}
    assert payload["status"] != "queued"
