from app.api.routes import mail as mail_routes


def test_poll_cron_requires_valid_token(client, monkeypatch):
    monkeypatch.setattr(mail_routes.settings, "cron_secret", "cron-secret")

    response = client.post("/api/v1/mail/poll-cron")
    assert response.status_code == 401


def test_poll_cron_runs_inline_when_queue_unavailable(client, monkeypatch):
    monkeypatch.setattr(mail_routes.settings, "cron_secret", "cron-secret")
    monkeypatch.setattr(mail_routes.settings, "imap_auto_poll_enabled", True)

    def fail_delay():
        raise RuntimeError("broker unavailable")

    monkeypatch.setattr(mail_routes.poll_mailbox_task, "delay", fail_delay)
    monkeypatch.setattr(mail_routes.poll_mailbox_task, "run", lambda: {"processed": 2})

    response = client.post(
        "/api/v1/mail/poll-cron",
        headers={"Authorization": "Bearer cron-secret"},
    )
    assert response.status_code == 202
    payload = response.json()
    assert payload["dispatch_mode"] == "inline"
    assert payload["result"]["processed"] == 2


def test_poll_cron_is_disabled_by_default(client, monkeypatch):
    monkeypatch.setattr(mail_routes.settings, "cron_secret", "cron-secret")
    monkeypatch.setattr(mail_routes.settings, "imap_auto_poll_enabled", False)

    response = client.post(
        "/api/v1/mail/poll-cron",
        headers={"Authorization": "Bearer cron-secret"},
    )
    assert response.status_code == 202
    payload = response.json()
    assert payload["dispatch_mode"] == "disabled"
    assert payload["result"]["disabled"] is True
