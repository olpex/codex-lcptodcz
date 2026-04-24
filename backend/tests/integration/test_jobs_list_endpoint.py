from datetime import datetime, timezone

from app.models import Document, DocumentType, ExportJob, ImportJob, JobStatus


def test_jobs_list_returns_import_and_export(client, auth_headers, db_session):
    now = datetime.now(timezone.utc)
    document = Document(
        branch_id="main",
        file_name="sample.docx",
        file_path="/tmp/sample.docx",
        file_type=DocumentType.DOCX,
        source="upload",
    )
    db_session.add(document)
    db_session.commit()
    db_session.refresh(document)

    import_job = ImportJob(
        branch_id="main",
        idempotency_key="import-list-test-1",
        document_id=document.id,
        status=JobStatus.QUEUED,
        message="queued import",
        created_at=now,
        updated_at=now,
    )
    export_job = ExportJob(
        branch_id="main",
        idempotency_key="export-list-test-1",
        report_type="kpi",
        export_format="xlsx",
        status=JobStatus.SUCCEEDED,
        message="done export",
        output_document_id=document.id,
        created_at=now,
        updated_at=now,
    )
    db_session.add(import_job)
    db_session.add(export_job)
    db_session.commit()

    response = client.get("/api/v1/jobs?limit=10", headers=auth_headers)
    assert response.status_code == 200
    payload = response.json()
    assert len(payload) >= 2

    job_types = {item["job_type"] for item in payload}
    assert "import" in job_types
    assert "export" in job_types


def test_jobs_list_supports_filters(client, auth_headers, db_session):
    now = datetime.now(timezone.utc)
    document = Document(
        branch_id="main",
        file_name="sample-filter.docx",
        file_path="/tmp/sample-filter.docx",
        file_type=DocumentType.DOCX,
        source="upload",
    )
    db_session.add(document)
    db_session.commit()
    db_session.refresh(document)

    failed_job = ImportJob(
        branch_id="main",
        idempotency_key="import-list-test-2",
        document_id=document.id,
        status=JobStatus.FAILED,
        message="failed import",
        created_at=now,
        updated_at=now,
    )
    queued_job = ImportJob(
        branch_id="main",
        idempotency_key="import-list-test-3",
        document_id=document.id,
        status=JobStatus.QUEUED,
        message="queued import",
        created_at=now,
        updated_at=now,
    )
    db_session.add(failed_job)
    db_session.add(queued_job)
    db_session.commit()

    response = client.get("/api/v1/jobs?job_type=import&status=failed&limit=10", headers=auth_headers)
    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["job_type"] == "import"
    assert payload[0]["job"]["status"] == "failed"
