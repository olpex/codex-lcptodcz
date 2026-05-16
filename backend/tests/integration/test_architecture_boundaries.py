from app.api.routes import mail as mail_routes


def test_runtime_schema_adds_drive_modified_at_for_legacy_journal_entries(tmp_path, monkeypatch):
    from sqlalchemy import create_engine, inspect, text

    from app import main as app_main

    legacy_engine = create_engine(f"sqlite:///{(tmp_path / 'legacy.db').as_posix()}")
    with legacy_engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE journal_monitor_entries (
                    id INTEGER PRIMARY KEY
                )
                """
            )
        )

    monkeypatch.setattr(app_main, "engine", legacy_engine)

    app_main.ensure_runtime_schema()

    columns = {column["name"] for column in inspect(legacy_engine).get_columns("journal_monitor_entries")}
    assert "drive_modified_at" in columns


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
