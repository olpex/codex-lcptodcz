from celery import Celery

from app.core.config import settings

celery_app = Celery("suptc", broker=settings.redis_url, backend=settings.redis_url)

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
    }
}

celery_app.conf.timezone = "UTC"
celery_app.autodiscover_tasks(["app.tasks"])
