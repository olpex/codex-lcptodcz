from app.core.config import Settings


def test_google_drive_intake_interval_defaults_to_thirty_seconds():
    settings = Settings(_env_file=None)

    assert settings.google_drive_intake_interval_seconds == 30
