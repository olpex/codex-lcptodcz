from app.core.config import Settings


def test_drive_intake_batch_size_defaults_to_recommended_bulk_value(monkeypatch):
    monkeypatch.delenv("GOOGLE_DRIVE_INTAKE_BATCH_SIZE", raising=False)

    settings = Settings(_env_file=None)

    assert settings.google_drive_intake_batch_size == 5
