from datetime import datetime, timezone

from sqlalchemy import event

from app.db.session import engine
from app.models import Document, DocumentType, ExportJob, ImportJob, JobStatus
from app.api.routes import jobs as jobs_route


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


def test_reprocess_import_job_creates_new_job_from_existing_document(client, auth_headers, db_session, monkeypatch):
    dispatched: list[int] = []

    def fake_dispatch(task, job_id: int) -> str:
        dispatched.append(job_id)
        return "queued"

    monkeypatch.setattr(jobs_route, "_dispatch_with_fallback", fake_dispatch)

    document = Document(
        branch_id="main",
        file_name="reprocess.xlsx",
        file_path="/tmp/reprocess.xlsx",
        file_type=DocumentType.XLSX,
        source="upload",
    )
    db_session.add(document)
    db_session.commit()
    db_session.refresh(document)

    source_job = ImportJob(
        branch_id="main",
        idempotency_key="import-reprocess-source",
        document_id=document.id,
        status=JobStatus.SUCCEEDED,
        message="done",
        result_payload={"import_mode": "overwrite", "import_result": {"inserted": 1}},
    )
    db_session.add(source_job)
    db_session.commit()
    db_session.refresh(source_job)

    response = client.post(f"/api/v1/jobs/{source_job.id}/reprocess-import", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["job_type"] == "import"
    assert payload["job"]["id"] != source_job.id
    assert payload["job"]["status"] == "queued"
    assert payload["job"]["result_payload"]["import_mode"] == "overwrite"
    assert payload["job"]["result_payload"]["reprocess_of_job_id"] == source_job.id
    assert dispatched == [payload["job"]["id"]]

    new_job = db_session.get(ImportJob, payload["job"]["id"])
    assert new_job is not None
    assert new_job.document_id == document.id


def test_retry_job_invalidates_dashboard_attention_cache(client, auth_headers, db_session, monkeypatch):
    deleted_keys: list[str] = []

    def fake_dispatch(task, job_id: int) -> str:
        return "queued"

    monkeypatch.setattr(jobs_route, "_dispatch_with_fallback", fake_dispatch)
    monkeypatch.setattr(jobs_route, "invalidate_attention_cache", lambda branch_id: deleted_keys.append(f"dashboard:attention:{branch_id}"))

    document = Document(
        branch_id="main",
        file_name="retry.xlsx",
        file_path="/tmp/retry.xlsx",
        file_type=DocumentType.XLSX,
        source="upload",
    )
    db_session.add(document)
    db_session.commit()
    db_session.refresh(document)

    failed_job = ImportJob(
        branch_id="main",
        idempotency_key="import-retry-cache",
        document_id=document.id,
        status=JobStatus.FAILED,
        message="failed",
    )
    db_session.add(failed_job)
    db_session.commit()
    db_session.refresh(failed_job)

    response = client.post(f"/api/v1/jobs/{failed_job.id}/retry", headers=auth_headers)

    assert response.status_code == 200
    assert deleted_keys == ["dashboard:attention:main"]


def test_jobs_list_eager_loads_documents(client, auth_headers, db_session):
    now = datetime.now(timezone.utc)
    documents = []
    for index in range(6):
        document = Document(
            branch_id="main",
            file_name=f"sample-{index}.xlsx",
            file_path=f"/tmp/sample-{index}.xlsx",
            file_type=DocumentType.XLSX,
            source="upload",
        )
        db_session.add(document)
        documents.append(document)
    db_session.commit()
    for document in documents:
        db_session.refresh(document)

    for index, document in enumerate(documents[:3]):
        db_session.add(
            ImportJob(
                branch_id="main",
                idempotency_key=f"import-eager-{index}",
                document_id=document.id,
                status=JobStatus.QUEUED,
                message="queued import",
                created_at=now,
                updated_at=now,
            )
        )
    for index, document in enumerate(documents[3:]):
        db_session.add(
            ExportJob(
                branch_id="main",
                idempotency_key=f"export-eager-{index}",
                report_type="kpi",
                export_format="xlsx",
                status=JobStatus.SUCCEEDED,
                message="done export",
                output_document_id=document.id,
                created_at=now,
                updated_at=now,
            )
        )
    db_session.commit()

    document_lazy_loads = 0

    def count_document_lazy_loads(conn, cursor, statement, parameters, context, executemany):
        nonlocal document_lazy_loads
        normalized = " ".join(statement.lower().split())
        if "from documents" in normalized and "where documents.id = ?" in normalized:
            document_lazy_loads += 1

    event.listen(engine, "before_cursor_execute", count_document_lazy_loads)
    try:
        response = client.get("/api/v1/jobs?limit=20", headers=auth_headers)
    finally:
        event.remove(engine, "before_cursor_execute", count_document_lazy_loads)

    assert response.status_code == 200
    assert document_lazy_loads == 0
