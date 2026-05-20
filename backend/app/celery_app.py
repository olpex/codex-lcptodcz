from pathlib import Path
from typing import Any

from celery import Celery

from app.core.config import settings


def build_celery_connection_config(
    database_url: str,
    redis_url: str,
    *,
    base_dir: Path | None = None,
) -> dict[str, Any]:
    if not database_url.startswith("sqlite"):
        return {
            "broker_url": redis_url,
            "result_backend": redis_url,
            "broker_transport_options": {},
        }

    root_dir = base_dir or Path(__file__).resolve().parents[2]
    broker_dir = root_dir / "tmp" / "celery-fs"
    queue_dir = broker_dir / "queue"
    processed_dir = broker_dir / "processed"
    control_dir = broker_dir / "control"
    for directory in (queue_dir, processed_dir, control_dir):
        directory.mkdir(parents=True, exist_ok=True)
    result_db = root_dir / "tmp" / "celery-results.sqlite"

    return {
        "broker_url": "filesystem://",
        "result_backend": f"db+sqlite:///{result_db.as_posix()}",
        "broker_transport_options": {
            "data_folder_in": queue_dir.as_posix(),
            "data_folder_out": queue_dir.as_posix(),
            "processed_folder": processed_dir.as_posix(),
            "control_folder": control_dir.as_posix(),
            "store_processed": True,
        },
    }


_celery_connection = build_celery_connection_config(
    settings.database_url,
    settings.resolved_redis_url,
)

celery_app = Celery(
    "suptc",
    broker=_celery_connection["broker_url"],
    backend=_celery_connection["result_backend"],
)
celery_app.conf.broker_transport_options = _celery_connection["broker_transport_options"]

celery_app.conf.task_routes = {
    "app.tasks.worker.poll_mailbox_task": {"queue": "mail_ingest"},
    "app.tasks.worker.process_ocr_task": {"queue": "ocr_parse"},
    "app.tasks.worker.process_import_job_task": {"queue": "import_parse"},
    "app.tasks.worker.process_export_job_task": {"queue": "report_export"},
    "app.tasks.worker.process_journal_monitor_auto_task": {"queue": "journal_monitor"},
    "app.tasks.worker.process_drive_intake_auto_task": {"queue": "drive_intake"},
}

celery_app.conf.beat_schedule = {
    "journal-monitor-workload-auto": {
        "task": "app.tasks.worker.process_journal_monitor_auto_task",
        "schedule": settings.journal_workload_auto_interval_seconds,
    },
    "mail-imap-auto": {
        "task": "app.tasks.worker.poll_mailbox_task",
        "schedule": settings.imap_poll_interval_seconds,
    },
    "google-drive-intake-auto": {
        "task": "app.tasks.worker.process_drive_intake_auto_task",
        "schedule": settings.google_drive_intake_interval_seconds,
    },
}

celery_app.conf.timezone = "UTC"
celery_app.autodiscover_tasks(["app.tasks"])
