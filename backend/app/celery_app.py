from celery import Celery
from celery.schedules import schedule

from app.core.config import settings

celery_app = Celery("suptc", broker=settings.redis_url, backend=settings.redis_url)

celery_app.conf.task_routes = {
    "app.tasks.worker.poll_mailbox_task": {"queue": "mail_ingest"},
    "app.tasks.worker.process_ocr_task": {"queue": "ocr_parse"},
    "app.tasks.worker.process_import_job_task": {"queue": "import_parse"},
    "app.tasks.worker.process_export_job_task": {"queue": "report_export"},
}

celery_app.conf.beat_schedule = {
    "poll-imap-mailbox": {
        "task": "app.tasks.worker.poll_mailbox_task",
        "schedule": schedule(run_every=settings.imap_poll_interval_seconds),
    }
}

celery_app.conf.timezone = "UTC"
celery_app.autodiscover_tasks(["app.tasks"])
