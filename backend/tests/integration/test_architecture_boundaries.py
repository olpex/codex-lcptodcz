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
