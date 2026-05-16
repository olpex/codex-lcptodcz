from datetime import datetime, timedelta, timezone

from sqlalchemy import event

from app.db.session import engine
from app.models import Document, DocumentType, ExportJob, ImportJob, JobStatus
from app.api.routes import jobs as jobs_route


def _count_select_queries(callback) -> tuple[int, object]:
    query_count = 0

    def count_queries(conn, cursor, statement, parameters, context, executemany):
        nonlocal query_count
        if statement.strip().lower().startswith("select"):
            query_count += 1

    event.listen(engine, "before_cursor_execute", count_queries)
    try:
        result = callback()
    finally:
        event.remove(engine, "before_cursor_execute", count_queries)
    return query_count, result


def _fake_celery_for_worker_health(monkeypatch) -> None:
    class FakeInspect:
        def ping(self):
            return {"celery@worker-1": {"ok": "pong"}}

    class FakeControl:
        def inspect(self, timeout=None):
            return FakeInspect()

    fake_conf = type(
        "FakeConf",
        (),
        {
            "task_routes": {
                "app.tasks.worker.process_import_job_task": {"queue": "import_parse"},
                "app.tasks.worker.process_drive_intake_auto_task": {"queue": "drive_intake"},
            },
            "beat_schedule": {
                "google-drive-intake-auto": {
                    "task": "app.tasks.worker.process_drive_intake_auto_task",
                    "schedule": 45,
                },
                "mail-imap-auto": {
                    "task": "app.tasks.worker.poll_mailbox_task",
                    "schedule": 300,
                },
            },
        },
    )()
    monkeypatch.setattr(jobs_route, "celery_app", type("FakeCeleryApp", (), {"control": FakeControl(), "conf": fake_conf})(), raising=False)


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


def test_job_statuses_returns_lightweight_branch_scoped_updates(client, auth_headers, db_session):
    now = datetime.now(timezone.utc)
    document = Document(
        branch_id="main",
        file_name="status.xlsx",
        file_path="/tmp/status.xlsx",
        file_type=DocumentType.XLSX,
        source="upload",
    )
    other_document = Document(
        branch_id="other",
        file_name="hidden.xlsx",
        file_path="/tmp/hidden.xlsx",
        file_type=DocumentType.XLSX,
        source="upload",
    )
    db_session.add_all([document, other_document])
    db_session.commit()
    db_session.refresh(document)
    db_session.refresh(other_document)

    queued_import = ImportJob(
        branch_id="main",
        idempotency_key="status-import-queued",
        document_id=document.id,
        status=JobStatus.QUEUED,
        message="queued",
        created_at=now,
        updated_at=now,
    )
    succeeded_import = ImportJob(
        branch_id="main",
        idempotency_key="status-import-succeeded",
        document_id=document.id,
        status=JobStatus.SUCCEEDED,
        message="done",
        created_at=now,
        updated_at=now,
    )
    other_branch_import = ImportJob(
        branch_id="other",
        idempotency_key="status-import-other-branch",
        document_id=other_document.id,
        status=JobStatus.RUNNING,
        message="hidden",
        created_at=now,
        updated_at=now,
    )
    running_export = ExportJob(
        branch_id="main",
        idempotency_key="status-export-running",
        report_type="kpi",
        export_format="xlsx",
        status=JobStatus.RUNNING,
        message="running",
        created_at=now,
        updated_at=now,
    )
    db_session.add_all([queued_import, succeeded_import, other_branch_import, running_export])
    db_session.commit()
    for job in [queued_import, succeeded_import, other_branch_import, running_export]:
        db_session.refresh(job)

    response = client.get(
        (
            "/api/v1/jobs/statuses"
            f"?job_id={queued_import.id}"
            f"&job_id={succeeded_import.id}"
            f"&job_id={other_branch_import.id}"
            f"&job_id={running_export.id}"
        ),
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    status_by_key = {(item["job_type"], item["job"]["id"]): item["job"]["status"] for item in payload}
    assert status_by_key[("import", queued_import.id)] == "queued"
    assert status_by_key[("import", succeeded_import.id)] == "succeeded"
    assert status_by_key[("export", running_export.id)] == "running"
    assert ("import", other_branch_import.id) not in status_by_key


def test_drive_intake_jobs_returns_recent_branch_scoped_drive_history(client, auth_headers, db_session):
    now = datetime.now(timezone.utc)
    drive_document = Document(
        branch_id="main",
        file_name="46-26 Schedule.docx",
        file_path="/tmp/46-26 Schedule.docx",
        file_type=DocumentType.DOCX,
        source="drive_intake",
    )
    upload_document = Document(
        branch_id="main",
        file_name="manual.xlsx",
        file_path="/tmp/manual.xlsx",
        file_type=DocumentType.XLSX,
        source="upload",
    )
    other_branch_document = Document(
        branch_id="other",
        file_name="hidden-drive.xlsx",
        file_path="/tmp/hidden-drive.xlsx",
        file_type=DocumentType.XLSX,
        source="drive_intake",
    )
    db_session.add_all([drive_document, upload_document, other_branch_document])
    db_session.commit()
    for document in [drive_document, upload_document, other_branch_document]:
        db_session.refresh(document)

    drive_job = ImportJob(
        branch_id="main",
        idempotency_key="drive-history-main",
        document_id=drive_document.id,
        status=JobStatus.FAILED,
        message="Google Drive denied rename",
        result_payload={
            "source": "drive_intake",
            "drive_file_name": "46-26 Schedule.docx",
            "marking_error": "Google Drive denied rename",
        },
        created_at=now,
        updated_at=now,
    )
    upload_job = ImportJob(
        branch_id="main",
        idempotency_key="drive-history-upload",
        document_id=upload_document.id,
        status=JobStatus.SUCCEEDED,
        message="manual",
        created_at=now,
        updated_at=now,
    )
    hidden_job = ImportJob(
        branch_id="other",
        idempotency_key="drive-history-other",
        document_id=other_branch_document.id,
        status=JobStatus.RUNNING,
        message="hidden",
        created_at=now,
        updated_at=now,
    )
    db_session.add_all([drive_job, upload_job, hidden_job])
    db_session.commit()
    for job in [drive_job, upload_job, hidden_job]:
        db_session.refresh(job)

    response = client.get("/api/v1/jobs/drive-intake?limit=10", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert [item["job"]["id"] for item in payload] == [drive_job.id]
    assert payload[0]["job_type"] == "import"
    assert payload[0]["import_source"] == "drive_intake"
    assert payload[0]["document_id"] == drive_document.id
    assert payload[0]["document_file_name"] == "46-26 Schedule.docx"
    assert payload[0]["job"]["result_payload"]["marking_error"] == "Google Drive denied rename"


def test_email_intake_jobs_returns_recent_branch_scoped_mail_history(client, auth_headers, db_session):
    now = datetime.now(timezone.utc)
    gmail_document = Document(
        branch_id="main",
        file_name="gmail-contracts.xlsx",
        file_path="/tmp/gmail-contracts.xlsx",
        file_type=DocumentType.XLSX,
        source="mail_gmail_api",
    )
    script_document = Document(
        branch_id="main",
        file_name="apps-script-schedule.docx",
        file_path="/tmp/apps-script-schedule.docx",
        file_type=DocumentType.DOCX,
        source="mail_google_script",
    )
    imap_document = Document(
        branch_id="main",
        file_name="imap-contracts.xlsx",
        file_path="/tmp/imap-contracts.xlsx",
        file_type=DocumentType.XLSX,
        source="mail",
    )
    upload_document = Document(
        branch_id="main",
        file_name="manual.xlsx",
        file_path="/tmp/manual.xlsx",
        file_type=DocumentType.XLSX,
        source="upload",
    )
    other_branch_document = Document(
        branch_id="other",
        file_name="hidden-mail.xlsx",
        file_path="/tmp/hidden-mail.xlsx",
        file_type=DocumentType.XLSX,
        source="mail_gmail_api",
    )
    db_session.add_all([gmail_document, script_document, imap_document, upload_document, other_branch_document])
    db_session.commit()
    for document in [gmail_document, script_document, imap_document, upload_document, other_branch_document]:
        db_session.refresh(document)

    gmail_job = ImportJob(
        branch_id="main",
        idempotency_key="email-history-gmail",
        document_id=gmail_document.id,
        status=JobStatus.FAILED,
        message="MAIL_WEBHOOK_SECRET is missing or invalid",
        result_payload={"source": "mail_gmail_api", "message_id": "gmail-1"},
        created_at=now,
        updated_at=now,
    )
    script_job = ImportJob(
        branch_id="main",
        idempotency_key="email-history-script",
        document_id=script_document.id,
        status=JobStatus.SUCCEEDED,
        message="script done",
        result_payload={"source": "mail_google_script", "message_id": "script-1"},
        created_at=now - timedelta(minutes=1),
        updated_at=now - timedelta(minutes=1),
    )
    imap_job = ImportJob(
        branch_id="main",
        idempotency_key="email-history-imap",
        document_id=imap_document.id,
        status=JobStatus.RUNNING,
        message="imap running",
        result_payload={"source": "mail_auto_contracts", "message_id": "imap-1"},
        created_at=now - timedelta(minutes=2),
        updated_at=now - timedelta(minutes=2),
    )
    upload_job = ImportJob(
        branch_id="main",
        idempotency_key="email-history-upload",
        document_id=upload_document.id,
        status=JobStatus.SUCCEEDED,
        message="manual",
        created_at=now,
        updated_at=now,
    )
    hidden_job = ImportJob(
        branch_id="other",
        idempotency_key="email-history-other",
        document_id=other_branch_document.id,
        status=JobStatus.RUNNING,
        message="hidden",
        result_payload={"source": "mail_gmail_api"},
        created_at=now,
        updated_at=now,
    )
    db_session.add_all([gmail_job, script_job, imap_job, upload_job, hidden_job])
    db_session.commit()
    for job in [gmail_job, script_job, imap_job, upload_job, hidden_job]:
        db_session.refresh(job)

    response = client.get("/api/v1/jobs/email-intake?limit=10", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert [item["job"]["id"] for item in payload] == [gmail_job.id, script_job.id, imap_job.id]
    assert [item["import_source"] for item in payload] == ["mail_gmail_api", "mail_google_script", "mail_auto_contracts"]
    assert payload[0]["document_file_name"] == "gmail-contracts.xlsx"
    assert payload[0]["job"]["result_payload"]["message_id"] == "gmail-1"


def test_worker_health_reports_celery_and_branch_job_backlog(client, auth_headers, db_session, monkeypatch):
    _fake_celery_for_worker_health(monkeypatch)
    monkeypatch.setattr(jobs_route.settings, "google_drive_intake_batch_size", 5)

    document = Document(
        branch_id="main",
        file_name="queued.xlsx",
        file_path="/tmp/queued.xlsx",
        file_type=DocumentType.XLSX,
        source="upload",
    )
    other_document = Document(
        branch_id="other",
        file_name="hidden.xlsx",
        file_path="/tmp/hidden.xlsx",
        file_type=DocumentType.XLSX,
        source="upload",
    )
    db_session.add_all([document, other_document])
    db_session.commit()
    db_session.refresh(document)
    db_session.refresh(other_document)

    db_session.add_all(
        [
            ImportJob(
                branch_id="main",
                idempotency_key="worker-health-import-queued",
                document_id=document.id,
                status=JobStatus.QUEUED,
                message="queued",
            ),
            ImportJob(
                branch_id="main",
                idempotency_key="worker-health-import-running",
                document_id=document.id,
                status=JobStatus.RUNNING,
                message="running",
            ),
            ExportJob(
                branch_id="main",
                idempotency_key="worker-health-export-queued",
                report_type="kpi",
                export_format="xlsx",
                status=JobStatus.QUEUED,
                message="queued",
            ),
            ImportJob(
                branch_id="other",
                idempotency_key="worker-health-other-queued",
                document_id=other_document.id,
                status=JobStatus.QUEUED,
                message="hidden",
            ),
        ]
    )
    db_session.commit()

    response = client.get("/api/v1/jobs/worker-health", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["celery"]["ping_ok"] is True
    assert payload["celery"]["workers"] == ["celery@worker-1"]
    assert payload["backlog"]["import"]["queued"] == 1
    assert payload["backlog"]["import"]["running"] == 1
    assert payload["backlog"]["export"]["queued"] == 1
    assert payload["backlog"]["total_active"] == 3
    assert "import_parse" in {queue["queue"] for queue in payload["queues"]}
    assert "google-drive-intake-auto" in {item["name"] for item in payload["beat_schedule"]}
    assert "mail-imap-auto" in {item["name"] for item in payload["beat_schedule"]}
    assert payload["settings"]["drive_intake_batch_size"] == 5


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


def test_job_center_status_endpoints_keep_bounded_select_queries(client, auth_headers, db_session, monkeypatch):
    _fake_celery_for_worker_health(monkeypatch)
    now = datetime.now(timezone.utc)
    documents = []
    for index in range(24):
        source = "drive_intake" if index % 3 == 0 else "mail_gmail_api" if index % 3 == 1 else "upload"
        document = Document(
            branch_id="main",
            file_name=f"job-center-{index}.xlsx",
            file_path=f"/tmp/job-center-{index}.xlsx",
            file_type=DocumentType.XLSX,
            source=source,
        )
        db_session.add(document)
        documents.append(document)
    db_session.commit()

    import_ids: list[int] = []
    for index, document in enumerate(documents):
        status = JobStatus.QUEUED if index % 2 == 0 else JobStatus.RUNNING
        job = ImportJob(
            branch_id="main",
            idempotency_key=f"job-center-perf-import-{index}",
            document_id=document.id,
            status=status,
            message="active import",
            result_payload={"source": document.source},
            created_at=now - timedelta(seconds=index),
            updated_at=now - timedelta(seconds=index),
        )
        db_session.add(job)
        db_session.flush()
        import_ids.append(job.id)

    for index in range(8):
        db_session.add(
            ExportJob(
                branch_id="main",
                idempotency_key=f"job-center-perf-export-{index}",
                report_type="kpi",
                export_format="xlsx",
                status=JobStatus.QUEUED if index % 2 == 0 else JobStatus.RUNNING,
                message="active export",
                created_at=now - timedelta(seconds=index),
                updated_at=now - timedelta(seconds=index),
            )
        )
    db_session.commit()

    id_query = "&".join(f"job_id={job_id}" for job_id in import_ids[:20])
    list_queries, list_response = _count_select_queries(
        lambda: client.get("/api/v1/jobs?limit=50", headers=auth_headers)
    )
    status_queries, status_response = _count_select_queries(
        lambda: client.get(f"/api/v1/jobs/statuses?limit=50&{id_query}", headers=auth_headers)
    )
    drive_queries, drive_response = _count_select_queries(
        lambda: client.get("/api/v1/jobs/drive-intake?limit=20", headers=auth_headers)
    )
    email_queries, email_response = _count_select_queries(
        lambda: client.get("/api/v1/jobs/email-intake?limit=20", headers=auth_headers)
    )
    worker_queries, worker_response = _count_select_queries(
        lambda: client.get("/api/v1/jobs/worker-health", headers=auth_headers)
    )

    assert list_response.status_code == 200
    assert status_response.status_code == 200
    assert drive_response.status_code == 200
    assert email_response.status_code == 200
    assert worker_response.status_code == 200
    assert list_queries <= 8
    assert status_queries <= 5
    assert drive_queries <= 4
    assert email_queries <= 4
    assert worker_queries <= 8
