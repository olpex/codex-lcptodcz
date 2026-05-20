from pathlib import Path

from app.celery_app import build_celery_connection_config


def test_sqlite_uses_filesystem_broker(tmp_path: Path):
    config = build_celery_connection_config(
        "sqlite:///suptc_local.db",
        "redis://127.0.0.1:6379/0",
        base_dir=tmp_path,
    )

    assert config["broker_url"] == "filesystem://"
    assert str(config["result_backend"]).startswith("db+sqlite:///")
    options = config["broker_transport_options"]
    assert options["data_folder_in"] == options["data_folder_out"]
    assert Path(options["data_folder_in"]).exists()
    assert Path(options["processed_folder"]).exists()
    assert Path(options["control_folder"]).exists()


def test_non_sqlite_keeps_redis_broker():
    config = build_celery_connection_config(
        "postgresql+psycopg2://user:pass@example.com/db",
        "redis://127.0.0.1:6379/0",
    )

    assert config == {
        "broker_url": "redis://127.0.0.1:6379/0",
        "result_backend": "redis://127.0.0.1:6379/0",
        "broker_transport_options": {},
    }
