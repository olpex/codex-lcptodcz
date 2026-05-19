from app.api.routes import mail as mail_routes
from app.celery_app import celery_app


def test_poll_cron_requires_valid_token(client, monkeypatch):
    monkeypatch.setattr(mail_routes.settings, "cron_secret", "cron-secret")

    response = client.post("/api/v1/mail/poll-cron")
    assert response.status_code == 401


def test_poll_cron_is_disabled(client, monkeypatch):
    monkeypatch.setattr(mail_routes.settings, "cron_secret", "cron-secret")
    monkeypatch.setattr(mail_routes.settings, "imap_auto_poll_enabled", True)

    def fail_if_called(*args, **kwargs):
        raise AssertionError("poll_mailbox_task must not be called by cron")

    monkeypatch.setattr(mail_routes.poll_mailbox_task, "delay", fail_if_called)
    monkeypatch.setattr(mail_routes.poll_mailbox_task, "run", fail_if_called)

    response = client.post(
        "/api/v1/mail/poll-cron",
        headers={"Authorization": "Bearer cron-secret"},
    )
    assert response.status_code == 202
    payload = response.json()
    assert payload["dispatch_mode"] == "disabled"
    assert payload["result"]["disabled"] is True


def test_imap_poll_is_scheduled_by_celery_beat():
    schedule = celery_app.conf.beat_schedule

    assert schedule["mail-imap-auto"]["task"] == "app.tasks.worker.poll_mailbox_task"
    assert schedule["mail-imap-auto"]["schedule"] == mail_routes.settings.imap_poll_interval_seconds
