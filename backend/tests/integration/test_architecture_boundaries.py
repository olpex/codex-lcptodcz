from pathlib import Path

from app.api.routes import mail as mail_routes


def test_frontend_source_does_not_reference_browser_auto_tick():
    frontend_src = Path(__file__).resolve().parents[3] / "frontend" / "src"
    offenders: list[str] = []

    for path in frontend_src.rglob("*"):
        if path.suffix not in {".js", ".jsx", ".ts", ".tsx"}:
            continue
        text = path.read_text(encoding="utf-8")
        if "journal-monitors/auto-tick" in text or "/auto-tick" in text:
            offenders.append(str(path.relative_to(frontend_src)))

    assert offenders == []


def test_root_directory_has_no_legacy_patch_scripts():
    repo_root = Path(__file__).resolve().parents[3]
    legacy_patch_scripts = {"modify_schedule.py", "patch_trainees.py"}

    offenders = sorted(path.name for path in repo_root.glob("*.py") if path.name in legacy_patch_scripts)

    assert offenders == []


def test_celery_observability_is_optional_in_compose():
    repo_root = Path(__file__).resolve().parents[3]
    root_compose = (repo_root / "docker-compose.yml").read_text(encoding="utf-8")
    worker_compose = (repo_root / "infra" / "vercel" / "docker-compose.workers.yml").read_text(encoding="utf-8")
    requirements = (repo_root / "backend" / "requirements.txt").read_text(encoding="utf-8")

    for compose_text in (root_compose, worker_compose):
        assert "flower:" in compose_text
        assert "observability" in compose_text
        assert "celery -A app.celery_app.celery_app flower" in compose_text

    assert "flower==" in requirements


def test_k8s_document_storage_is_shared_between_api_worker_and_beat():
    repo_root = Path(__file__).resolve().parents[3]
    k8s_dir = repo_root / "infra" / "k8s"

    pvc = (k8s_dir / "documents-pvc.yaml").read_text(encoding="utf-8")
    assert "kind: PersistentVolumeClaim" in pvc
    assert "name: suptc-documents" in pvc

    for filename in ["api.yaml", "worker.yaml", "beat.yaml"]:
        manifest = (k8s_dir / filename).read_text(encoding="utf-8")
        assert "emptyDir" not in manifest
        assert "claimName: suptc-documents" in manifest
        assert "mountPath: /tmp/documents" in manifest


def test_api_versioning_policy_is_documented():
    repo_root = Path(__file__).resolve().parents[3]
    policy_path = repo_root / "docs" / "architecture" / "api-versioning.md"

    assert policy_path.exists()
    policy = policy_path.read_text(encoding="utf-8").lower()
    for required_text in [
        "/api/v1",
        "x-api-version",
        "deprecation",
        "backward-compatible",
        "breaking change",
    ]:
        assert required_text in policy


def test_frontend_lazy_routes_keep_layout_during_page_loads():
    repo_root = Path(__file__).resolve().parents[3]
    app_source = (repo_root / "frontend" / "src" / "App.tsx").read_text(encoding="utf-8")

    assert "function PageFallback()" in app_source
    assert "function withPageSuspense(" in app_source
    assert "<Suspense fallback={<PageFallback />}>{children}</Suspense>" in app_source
    assert "<Suspense fallback={<div className=\"p-6\">Завантаження...</div>}>" not in app_source


def test_browser_auto_tick_endpoint_no_longer_runs_processing(client, auth_headers, monkeypatch):
    def fail_if_called(*args, **kwargs):
        raise AssertionError("browser auto-tick must not trigger background processing")

    monkeypatch.setattr("app.api.routes.journal_monitors._process_journal_monitor_auto_sections", fail_if_called)
    monkeypatch.setattr("app.api.routes.journal_monitors._process_drive_intake_auto_file", fail_if_called)

    response = client.post("/api/v1/journal-monitors/auto-tick", headers=auth_headers)

    assert response.status_code == 410
    assert response.json()["detail"] == "Journal intake is triggered by Celery beat"


def test_manual_imap_poll_is_disabled_when_apps_script_is_primary(client, auth_headers, monkeypatch):
    monkeypatch.setattr(mail_routes.settings, "mail_primary_channel", "google_apps_script")
    monkeypatch.setattr(mail_routes.settings, "imap_fallback_enabled", False)

    def fail_if_called(*args, **kwargs):
        raise AssertionError("IMAP poller must not run while fallback is disabled")

    monkeypatch.setattr(mail_routes.poll_mailbox_task, "delay", fail_if_called)
    monkeypatch.setattr(mail_routes.poll_mailbox_task, "run", fail_if_called)

    response = client.post("/api/v1/mail/poll-now", headers=auth_headers)

    assert response.status_code == 202
    payload = response.json()
    assert payload["dispatch_mode"] == "disabled"
    assert payload["primary_channel"] == "google_apps_script"
    assert payload["disabled_reason"] == "primary_channel_google_apps_script"
    assert "IMAP_FALLBACK_ENABLED=true" in payload["operator_hint"]
    assert payload["runbook"] == "docs/architecture/celery-worker-topology.md#mail-channel-and-imap-fallback"
    assert payload["result"]["disabled"] is True


def test_forced_imap_worker_poll_is_disabled_without_fallback(monkeypatch):
    from app.tasks.worker import poll_mailbox_task

    monkeypatch.setattr("app.tasks.worker.settings.mail_primary_channel", "google_apps_script")
    monkeypatch.setattr("app.tasks.worker.settings.imap_fallback_enabled", False)

    def fail_if_called(*args, **kwargs):
        raise AssertionError("IMAP ingestion must not run while fallback is disabled")

    monkeypatch.setattr("app.tasks.worker.ingest_mailbox", fail_if_called)

    result = poll_mailbox_task.run(True)

    assert result["disabled"] is True
    assert result["primary_channel"] == "google_apps_script"


def test_imap_fallback_runbook_is_documented():
    repo_root = Path(__file__).resolve().parents[3]
    runbook = (repo_root / "docs" / "architecture" / "celery-worker-topology.md").read_text(encoding="utf-8")

    for required_text in [
        "## Mail Channel And IMAP Fallback",
        "`MAIL_PRIMARY_CHANNEL=google_apps_script`",
        "`IMAP_FALLBACK_ENABLED=false`",
        "`IMAP_FALLBACK_ENABLED=true`",
        "`IMAP_AUTO_POLL_ENABLED=true`",
        "`POST /api/v1/mail/poll-now`",
        "`/api/v1/jobs/worker-health`",
    ]:
        assert required_text in runbook


def test_drive_intake_batch_size_is_documented_as_recommended_default():
    repo_root = Path(__file__).resolve().parents[3]
    env_example = (repo_root / ".env.example").read_text(encoding="utf-8")
    readme = (repo_root / "README.md").read_text(encoding="utf-8")
    deploy = (repo_root / "infra" / "DEPLOY.md").read_text(encoding="utf-8")

    assert "GOOGLE_DRIVE_INTAKE_BATCH_SIZE=50" in env_example
    assert "`GOOGLE_DRIVE_INTAKE_BATCH_SIZE=50`" in readme
    assert "`GOOGLE_DRIVE_INTAKE_BATCH_SIZE` | Скільки файлів worker може обробити за один tick | `50` |" in deploy


def test_worker_deploy_runs_automatically_after_main_pushes():
    repo_root = Path(__file__).resolve().parents[3]
    workflow = (repo_root / ".github" / "workflows" / "deploy-workers.yml").read_text(encoding="utf-8")
    vercel_readme = (repo_root / "infra" / "vercel" / "README.md").read_text(encoding="utf-8")

    assert "push:" in workflow
    assert "branches: [main]" in workflow
    assert ".github/workflows/deploy-workers.yml" in workflow
    assert "автоматично запускається після push у `main`" in vercel_readme


def test_vercel_config_does_not_define_unsupported_hobby_crons():
    repo_root = Path(__file__).resolve().parents[3]
    vercel_config = (repo_root / "vercel.json").read_text(encoding="utf-8")
    vercel_readme = (repo_root / "infra" / "vercel" / "README.md").read_text(encoding="utf-8")

    assert '"crons"' not in vercel_config
    assert "Vercel Hobby не має project cron" in vercel_readme


def test_perf_suite_covers_critical_background_routes():
    repo_root = Path(__file__).resolve().parents[3]
    perf_source = (repo_root / "backend" / "tests" / "perf" / "test_critical_routes.py").read_text(encoding="utf-8")

    for route in [
        "/api/v1/documents/import/preview",
        "/api/v1/drafts/upload-image",
        "/api/v1/journal-monitors/{section_id}/sync",
        "/api/v1/jobs/statuses",
    ]:
        assert route in perf_source
    assert "test_drive_intake_batch_worker_keeps_bounded_p95_latency" in perf_source
    assert "@pytest.mark.perf" in perf_source


def test_celery_worker_topology_runbook_is_documented():
    repo_root = Path(__file__).resolve().parents[3]
    runbook_path = repo_root / "docs" / "architecture" / "celery-worker-topology.md"
    runbook = runbook_path.read_text(encoding="utf-8")
    readme = (repo_root / "README.md").read_text(encoding="utf-8")

    required_terms = [
        "FastAPI API",
        "Celery worker",
        "Celery beat",
        "Redis",
        "Flower",
        "mail_ingest",
        "ocr_parse",
        "import_parse",
        "report_export",
        "journal_monitor",
        "drive_intake",
        "process_import_job_task",
        "process_export_job_task",
        "poll_mailbox_task",
        "mail-imap-auto",
        "process_ocr_task",
        "process_journal_monitor_auto_task",
        "process_drive_intake_auto_task",
        "DATABASE_URL",
        "REDIS_URL",
        "FILE_STORAGE_PATH",
        "CRON_SECRET",
        "GOOGLE_DRIVE_INTAKE_BATCH_SIZE",
        "MAIL_PRIMARY_CHANNEL",
        "/api/v1/jobs/worker-health",
        "/api/v1/journal-monitors/auto-cron",
        "celery -A app.celery_app.celery_app inspect ping",
        "docker compose -f infra/vercel/docker-compose.workers.yml up -d --build",
    ]
    for term in required_terms:
        assert term in runbook

    assert "docs/architecture/celery-worker-topology.md" in readme
