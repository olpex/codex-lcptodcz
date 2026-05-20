from app.core.config import Settings


def test_drive_intake_batch_size_defaults_to_sync_all_supported_files(monkeypatch):
    monkeypatch.delenv("GOOGLE_DRIVE_INTAKE_BATCH_SIZE", raising=False)

    settings = Settings(_env_file=None)

    assert settings.google_drive_intake_batch_size == 50


def test_windows_host_falls_back_to_localhost_for_unresolved_docker_redis(monkeypatch):
    monkeypatch.setattr("app.core.config.os.name", "nt", raising=False)
    monkeypatch.setattr(
        "app.core.config.socket.getaddrinfo",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("unresolved")),
        raising=False,
    )

    settings = Settings(_env_file=None, REDIS_URL="redis://redis:6379/0")

    assert settings.resolved_redis_url == "redis://127.0.0.1:6379/0"


def test_non_windows_keeps_original_redis_url(monkeypatch):
    monkeypatch.setattr("app.core.config.os.name", "posix", raising=False)

    settings = Settings(_env_file=None, REDIS_URL="redis://redis:6379/0")

    assert settings.resolved_redis_url == "redis://redis:6379/0"
