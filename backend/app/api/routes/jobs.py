from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, or_
from sqlalchemy.orm import joinedload

from app.api.deps import CurrentUser, DbSession, apply_branch_scope, require_roles
from app.celery_app import celery_app
from app.core.config import settings
from app.models import Document, ExportJob, GroupMembership, ImportJob, JobStatus, Performance, RoleName, Trainee
from app.schemas.api import JobListItemResponse, JobResponse, JobStatusResponse
from app.services.audit import write_audit
from app.services.dashboard_cache import invalidate_attention_cache
from app.services.import_export import mark_job_failed
from app.tasks.worker import process_export_job_task, process_import_job_task

router = APIRouter()

STALE_RUNNING_MINUTES = 60
STALE_QUEUED_HOURS = 6


def _invalidate_dashboard_attention_cache(branch_id: str) -> None:
    invalidate_attention_cache(branch_id)


def _dispatch_with_fallback(task, job_id: int) -> str:
    try:
        task.delay(job_id)
        return "queued"
    except Exception:
        try:
            task.run(job_id)
            return "inline"
        except Exception:
            return "inline_failed"


def _schedule_seconds(value) -> float | None:
    if hasattr(value, "total_seconds"):
        return float(value.total_seconds())
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _mark_stale_jobs_as_failed(db: DbSession, branch_id: str) -> int:
    now = datetime.now(timezone.utc)
    running_cutoff = now - timedelta(minutes=STALE_RUNNING_MINUTES)
    queued_cutoff = now - timedelta(hours=STALE_QUEUED_HOURS)
    changed = 0

    stale_import_running = (
        db.query(ImportJob)
        .filter(
            ImportJob.branch_id == branch_id,
            ImportJob.status == JobStatus.RUNNING,
            or_(
                and_(ImportJob.started_at.isnot(None), ImportJob.started_at <= running_cutoff),
                and_(ImportJob.started_at.is_(None), ImportJob.updated_at <= running_cutoff),
            ),
        )
        .all()
    )
    stale_export_running = (
        db.query(ExportJob)
        .filter(
            ExportJob.branch_id == branch_id,
            ExportJob.status == JobStatus.RUNNING,
            or_(
                and_(ExportJob.started_at.isnot(None), ExportJob.started_at <= running_cutoff),
                and_(ExportJob.started_at.is_(None), ExportJob.updated_at <= running_cutoff),
            ),
        )
        .all()
    )
    stale_import_queued = (
        db.query(ImportJob)
        .filter(
            ImportJob.branch_id == branch_id,
            ImportJob.status == JobStatus.QUEUED,
            ImportJob.created_at <= queued_cutoff,
        )
        .all()
    )
    stale_export_queued = (
        db.query(ExportJob)
        .filter(
            ExportJob.branch_id == branch_id,
            ExportJob.status == JobStatus.QUEUED,
            ExportJob.created_at <= queued_cutoff,
        )
        .all()
    )

    for job in [*stale_import_running, *stale_export_running]:
        mark_job_failed(job, "Автоматично зупинено: задача довго була у статусі running")
        db.add(job)
        changed += 1
    for job in [*stale_import_queued, *stale_export_queued]:
        mark_job_failed(job, "Автоматично зупинено: задача довго була у черзі")
        db.add(job)
        changed += 1

    if changed:
        db.commit()
    return changed


def _resolve_job(job_id: int, db: DbSession, branch_id: str) -> tuple[str | None, ImportJob | ExportJob | None]:
    import_job = (
        apply_branch_scope(db.query(ImportJob), ImportJob, branch_id)
        .filter(ImportJob.id == job_id)
        .first()
    )
    if import_job:
        return "import", import_job
    export_job = (
        apply_branch_scope(db.query(ExportJob), ExportJob, branch_id)
        .filter(ExportJob.id == job_id)
        .first()
    )
    if export_job:
        return "export", export_job
    return None, None


@router.get("", response_model=list[JobListItemResponse])
def list_jobs(
    db: DbSession,
    current_user: CurrentUser,
    job_type: str | None = Query(default=None, pattern="^(import|export)$"),
    status_filter: JobStatus | None = Query(default=None, alias="status"),
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[JobListItemResponse]:
    _mark_stale_jobs_as_failed(db, current_user.branch_id)

    items: list[JobListItemResponse] = []

    if job_type in (None, "import"):
        import_query = apply_branch_scope(db.query(ImportJob), ImportJob, current_user.branch_id)
        if status_filter:
            import_query = import_query.filter(ImportJob.status == status_filter)
        if date_from:
            import_query = import_query.filter(ImportJob.created_at >= date_from)
        if date_to:
            import_query = import_query.filter(ImportJob.created_at <= date_to)

        import_jobs = import_query.options(joinedload(ImportJob.document)).order_by(ImportJob.created_at.desc()).limit(limit).all()
        items.extend(
            JobListItemResponse(
                job_type="import",
                job=JobResponse.model_validate(job),
                import_source=job.document.source if job.document else None,
                document_id=job.document_id,
                document_file_name=job.document.file_name if job.document else None,
            )
            for job in import_jobs
        )

    if job_type in (None, "export"):
        export_query = apply_branch_scope(db.query(ExportJob), ExportJob, current_user.branch_id)
        if status_filter:
            export_query = export_query.filter(ExportJob.status == status_filter)
        if date_from:
            export_query = export_query.filter(ExportJob.created_at >= date_from)
        if date_to:
            export_query = export_query.filter(ExportJob.created_at <= date_to)

        export_jobs = export_query.options(joinedload(ExportJob.output_document)).order_by(ExportJob.created_at.desc()).limit(limit).all()
        items.extend(
            JobListItemResponse(
                job_type="export",
                job=JobResponse.model_validate(job),
                report_type=job.report_type,
                export_format=job.export_format,
                output_document_id=job.output_document_id,
                output_file_name=job.output_document.file_name if job.output_document else None,
            )
            for job in export_jobs
        )

    items.sort(key=lambda item: item.job.created_at, reverse=True)
    return items[:limit]


@router.get("/statuses", response_model=list[JobStatusResponse])
def list_job_statuses(
    db: DbSession,
    current_user: CurrentUser,
    job_id: list[int] | None = Query(default=None),
    include_active: bool = Query(default=True),
    limit: int = Query(default=100, ge=1, le=200),
) -> list[JobStatusResponse]:
    ids = set(job_id or [])
    active_statuses = {JobStatus.QUEUED, JobStatus.RUNNING}

    import_query = apply_branch_scope(db.query(ImportJob), ImportJob, current_user.branch_id)
    export_query = apply_branch_scope(db.query(ExportJob), ExportJob, current_user.branch_id)
    if ids:
        import_filters = [ImportJob.id.in_(ids)]
        export_filters = [ExportJob.id.in_(ids)]
        if include_active:
            import_filters.append(ImportJob.status.in_(active_statuses))
            export_filters.append(ExportJob.status.in_(active_statuses))
        import_query = import_query.filter(or_(*import_filters))
        export_query = export_query.filter(or_(*export_filters))
    else:
        import_query = import_query.filter(ImportJob.status.in_(active_statuses))
        export_query = export_query.filter(ExportJob.status.in_(active_statuses))

    items = [
        *(
            JobStatusResponse(job_type="import", job=JobResponse.model_validate(job))
            for job in import_query.order_by(ImportJob.updated_at.desc()).limit(limit).all()
        ),
        *(
            JobStatusResponse(job_type="export", job=JobResponse.model_validate(job))
            for job in export_query.order_by(ExportJob.updated_at.desc()).limit(limit).all()
        ),
    ]
    items.sort(key=lambda item: item.job.updated_at, reverse=True)
    return items[:limit]


@router.get("/drive-intake", response_model=list[JobListItemResponse])
def list_drive_intake_jobs(
    db: DbSession,
    current_user: CurrentUser,
    limit: int = Query(default=10, ge=1, le=50),
) -> list[JobListItemResponse]:
    jobs = (
        apply_branch_scope(db.query(ImportJob), ImportJob, current_user.branch_id)
        .join(ImportJob.document)
        .filter(Document.source == "drive_intake")
        .options(joinedload(ImportJob.document))
        .order_by(ImportJob.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        JobListItemResponse(
            job_type="import",
            job=JobResponse.model_validate(job),
            import_source=job.document.source if job.document else None,
            document_id=job.document_id,
            document_file_name=job.document.file_name if job.document else None,
        )
        for job in jobs
    ]


@router.get("/email-intake", response_model=list[JobListItemResponse])
def list_email_intake_jobs(
    db: DbSession,
    current_user: CurrentUser,
    limit: int = Query(default=10, ge=1, le=50),
) -> list[JobListItemResponse]:
    mail_sources = {"mail", "mail_gmail_api", "mail_google_script"}
    jobs = (
        apply_branch_scope(db.query(ImportJob), ImportJob, current_user.branch_id)
        .join(ImportJob.document)
        .filter(Document.source.in_(mail_sources))
        .options(joinedload(ImportJob.document))
        .order_by(ImportJob.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        JobListItemResponse(
            job_type="import",
            job=JobResponse.model_validate(job),
            import_source=(
                job.result_payload.get("source") if isinstance(job.result_payload, dict) and job.result_payload.get("source") else job.document.source
            ),
            document_id=job.document_id,
            document_file_name=job.document.file_name if job.document else None,
        )
        for job in jobs
    ]


@router.get("/worker-health")
def get_worker_health(db: DbSession, current_user: CurrentUser) -> dict:
    ping_error: str | None = None
    workers: list[str] = []
    try:
        inspector = celery_app.control.inspect(timeout=0.5)
        ping_payload = inspector.ping() if inspector else None
        if isinstance(ping_payload, dict):
            workers = sorted(str(name) for name in ping_payload.keys())
    except Exception as exc:
        ping_error = str(exc)

    import_queued = (
        apply_branch_scope(db.query(ImportJob), ImportJob, current_user.branch_id)
        .filter(ImportJob.status == JobStatus.QUEUED)
        .count()
    )
    import_running = (
        apply_branch_scope(db.query(ImportJob), ImportJob, current_user.branch_id)
        .filter(ImportJob.status == JobStatus.RUNNING)
        .count()
    )
    export_queued = (
        apply_branch_scope(db.query(ExportJob), ExportJob, current_user.branch_id)
        .filter(ExportJob.status == JobStatus.QUEUED)
        .count()
    )
    export_running = (
        apply_branch_scope(db.query(ExportJob), ExportJob, current_user.branch_id)
        .filter(ExportJob.status == JobStatus.RUNNING)
        .count()
    )

    task_routes = getattr(celery_app.conf, "task_routes", {}) or {}
    beat_schedule = getattr(celery_app.conf, "beat_schedule", {}) or {}
    queues = [
        {"task": task_name, "queue": route.get("queue")}
        for task_name, route in sorted(task_routes.items())
        if isinstance(route, dict)
    ]
    schedule = [
        {
            "name": name,
            "task": entry.get("task") if isinstance(entry, dict) else None,
            "schedule_seconds": _schedule_seconds(entry.get("schedule")) if isinstance(entry, dict) else None,
        }
        for name, entry in sorted(beat_schedule.items())
    ]

    ping_ok = bool(workers)
    return {
        "status": "ok" if ping_ok else "degraded",
        "celery": {
            "broker_configured": bool(settings.redis_url),
            "ping_ok": ping_ok,
            "workers": workers,
            "error": ping_error,
        },
        "backlog": {
            "import": {"queued": import_queued, "running": import_running},
            "export": {"queued": export_queued, "running": export_running},
            "total_active": import_queued + import_running + export_queued + export_running,
        },
        "queues": queues,
        "beat_schedule": schedule,
        "settings": {
            "drive_intake_auto_enabled": settings.google_drive_intake_auto_enabled,
            "drive_intake_interval_seconds": settings.google_drive_intake_interval_seconds,
            "journal_auto_interval_seconds": settings.journal_workload_auto_interval_seconds,
            "imap_fallback_enabled": settings.imap_fallback_enabled,
            "imap_auto_poll_enabled": settings.imap_auto_poll_enabled,
            "mail_primary_channel": settings.mail_primary_channel,
        },
    }


@router.get("/{job_id}", response_model=JobStatusResponse)
def get_job_status(job_id: int, db: DbSession, current_user: CurrentUser) -> JobStatusResponse:
    job_type, job = _resolve_job(job_id, db, current_user.branch_id)
    if not job_type or not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job не знайдено")
    return JobStatusResponse(job_type=job_type, job=JobResponse.model_validate(job))


@router.post(
    "/{job_id}/cancel",
    response_model=JobStatusResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def cancel_job(job_id: int, db: DbSession, current_user: CurrentUser) -> JobStatusResponse:
    job_type, job = _resolve_job(job_id, db, current_user.branch_id)
    if not job_type or not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job не знайдено")
    if job.status in {JobStatus.SUCCEEDED, JobStatus.FAILED}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Скасувати можна лише queued/running задачу")

    mark_job_failed(job, "Скасовано користувачем")
    db.add(job)
    db.commit()
    _invalidate_dashboard_attention_cache(current_user.branch_id)
    db.refresh(job)
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="jobs.cancel",
        entity_type=f"{job_type}_job",
        entity_id=str(job.id),
    )
    return JobStatusResponse(job_type=job_type, job=JobResponse.model_validate(job))


@router.post(
    "/{job_id}/retry",
    response_model=JobStatusResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def retry_job(job_id: int, db: DbSession, current_user: CurrentUser) -> JobStatusResponse:
    job_type, job = _resolve_job(job_id, db, current_user.branch_id)
    if not job_type or not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job не знайдено")
    if job.status == JobStatus.RUNNING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Задача вже виконується")
    if job.status == JobStatus.SUCCEEDED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Успішну задачу не потрібно перезапускати")

    job.status = JobStatus.QUEUED
    job.message = "Повторний запуск задачі"
    job.started_at = None
    job.finished_at = None
    db.add(job)
    db.commit()
    _invalidate_dashboard_attention_cache(current_user.branch_id)
    db.refresh(job)

    dispatch_mode = _dispatch_with_fallback(
        process_import_job_task if job_type == "import" else process_export_job_task,
        job.id,
    )
    db.refresh(job)
    if dispatch_mode == "inline":
        job.message = f"Черга недоступна. Виконано inline. {job.message or ''}".strip()
    elif dispatch_mode == "inline_failed":
        mark_job_failed(job, "Черга недоступна, inline-перезапуск завершився помилкою")
    db.add(job)
    db.commit()
    db.refresh(job)

    write_audit(
        db,
        actor_user_id=current_user.id,
        action="jobs.retry",
        entity_type=f"{job_type}_job",
        entity_id=str(job.id),
        details={"dispatch_mode": dispatch_mode},
    )
    return JobStatusResponse(job_type=job_type, job=JobResponse.model_validate(job))


@router.post(
    "/{job_id}/reprocess-import",
    response_model=JobStatusResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def reprocess_import_job(job_id: int, db: DbSession, current_user: CurrentUser) -> JobStatusResponse:
    job_type, source_job = _resolve_job(job_id, db, current_user.branch_id)
    if job_type != "import" or not isinstance(source_job, ImportJob):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import job не знайдено")
    if not source_job.document:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="У цієї задачі немає документа для повторного імпорту")

    previous_payload = source_job.result_payload if isinstance(source_job.result_payload, dict) else {}
    previous_request = source_job.request_payload if isinstance(source_job.request_payload, dict) else {}
    import_mode = previous_payload.get("import_mode") or previous_request.get("import_mode") or "skip_existing"
    new_payload = {
        "import_mode": import_mode,
        "source": "manual_reprocess",
        "reprocess_of_job_id": source_job.id,
    }
    new_job = ImportJob(
        branch_id=current_user.branch_id,
        idempotency_key=f"{current_user.branch_id}:reprocess-{source_job.id}-{uuid4().hex}",
        document_id=source_job.document_id,
        status=JobStatus.QUEUED,
        message=f"Повторний імпорт із задачі #{source_job.id}",
        request_payload={"reprocess_of_job_id": source_job.id},
        result_payload=new_payload,
    )
    db.add(new_job)
    db.commit()
    _invalidate_dashboard_attention_cache(current_user.branch_id)
    db.refresh(new_job)

    dispatch_mode = _dispatch_with_fallback(process_import_job_task, new_job.id)
    db.refresh(new_job)
    if dispatch_mode == "inline":
        new_job.message = f"Черга недоступна. Повторний імпорт виконано inline. {new_job.message or ''}".strip()
    elif dispatch_mode == "inline_failed":
        mark_job_failed(new_job, new_job.message or "Черга недоступна, inline-повторний імпорт завершився помилкою")
    db.add(new_job)
    db.commit()
    db.refresh(new_job)

    write_audit(
        db,
        actor_user_id=current_user.id,
        action="jobs.reprocess_import",
        entity_type="import_job",
        entity_id=str(new_job.id),
        details={
            "source_job_id": source_job.id,
            "document_id": source_job.document_id,
            "dispatch_mode": dispatch_mode,
            "import_mode": import_mode,
        },
    )
    return JobStatusResponse(job_type="import", job=JobResponse.model_validate(new_job))


@router.post(
    "/{job_id}/rollback-import",
    response_model=JobStatusResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def rollback_import_job(job_id: int, db: DbSession, current_user: CurrentUser) -> JobStatusResponse:
    job_type, job = _resolve_job(job_id, db, current_user.branch_id)
    if job_type != "import" or not isinstance(job, ImportJob):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import job не знайдено")

    if not job.result_payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Немає даних для відклику імпорту")
    import_result = job.result_payload.get("import_result") if isinstance(job.result_payload, dict) else None
    inserted_ids_raw = import_result.get("inserted_ids") if isinstance(import_result, dict) else None
    if not isinstance(inserted_ids_raw, list):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Цей імпорт не містить rollback-даних")

    inserted_ids = [int(item) for item in inserted_ids_raw if isinstance(item, int)]
    if not inserted_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="У цьому імпорті немає нових рядків для відклику")

    db.query(GroupMembership).filter(GroupMembership.trainee_id.in_(inserted_ids)).delete(synchronize_session=False)
    db.query(Performance).filter(Performance.trainee_id.in_(inserted_ids)).delete(synchronize_session=False)
    deleted_trainees = (
        db.query(Trainee)
        .filter(Trainee.branch_id == current_user.branch_id, Trainee.id.in_(inserted_ids))
        .delete(synchronize_session=False)
    )

    current_payload = dict(job.result_payload or {})
    current_payload["rollback"] = {
        "performed_at": datetime.now(timezone.utc).isoformat(),
        "deleted_trainees": deleted_trainees,
        "requested_count": len(inserted_ids),
    }
    job.result_payload = current_payload
    mark_job_failed(job, f"Імпорт відкликано. Видалено слухачів: {deleted_trainees}")
    db.add(job)
    db.commit()
    _invalidate_dashboard_attention_cache(current_user.branch_id)
    db.refresh(job)

    write_audit(
        db,
        actor_user_id=current_user.id,
        action="jobs.rollback_import",
        entity_type="import_job",
        entity_id=str(job.id),
        details={"deleted_trainees": deleted_trainees},
    )
    return JobStatusResponse(job_type="import", job=JobResponse.model_validate(job))
