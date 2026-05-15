# Celery Worker Topology Runbook

This runbook documents the current safe production topology for background work. It does not introduce a platform migration. The goal is to keep FastAPI API request handling, Celery worker execution, Celery beat scheduling, Redis, and optional Flower monitoring understandable and independently verifiable.

## Service Topology

| Service | Responsibility | Must share |
|---|---|---|
| FastAPI API | HTTP API, auth, upload/download endpoints, job creation, `/api/v1/jobs/worker-health` | `DATABASE_URL`, `REDIS_URL`, `FILE_STORAGE_PATH` |
| Celery worker | Executes queued import, export, OCR, mail, journal, and Drive intake tasks | Same database, Redis, and document storage as API |
| Celery beat | Schedules periodic background tasks such as journal monitor and Drive intake | Same Redis and settings as worker |
| Redis | Celery broker/result backend and short lived API cache | One shared `REDIS_URL` for API, worker, and beat |
| PostgreSQL | Source of truth for users, documents, jobs, groups, trainees, schedules, journals | One shared `DATABASE_URL` |
| Flower | Optional read only Celery visibility for queues, retry, failed tasks | Redis; keep bound to `127.0.0.1` or behind private access |

Vercel or another request based host can run the FastAPI API, but it must not run long lived Celery worker or Celery beat processes. Worker and beat belong on Docker, K8s, or a worker host that supports persistent processes.

## Queue Map

The worker command must subscribe to all current queues:

```bash
celery -A app.celery_app.celery_app worker --loglevel=info --queues=mail_ingest,ocr_parse,import_parse,report_export,journal_monitor,drive_intake
```

| Queue | Task examples | Purpose |
|---|---|---|
| `mail_ingest` | `poll_mailbox_task` | Controlled IMAP fallback polling when explicitly enabled |
| `ocr_parse` | `process_ocr_task` | OCR draft parsing and structured draft generation |
| `import_parse` | `process_import_job_task` | XLS/XLSX/CSV/DOCX import jobs |
| `report_export` | `process_export_job_task` | XLSX/PDF/CSV export jobs |
| `journal_monitor` | `process_journal_monitor_auto_task` | Journal monitor background processing |
| `drive_intake` | `process_drive_intake_auto_task` | Google Drive intake batch processing |

## Beat Schedule

Celery beat owns server side periodic work. The browser must not trigger background processing by calling the deprecated `/api/v1/journal-monitors/auto-tick` endpoint.

Expected scheduled tasks:

| Task | Setting | Notes |
|---|---|---|
| `process_journal_monitor_auto_task` | `JOURNAL_WORKLOAD_AUTO_INTERVAL_SECONDS` | Processes active journal sections only |
| `process_drive_intake_auto_task` | `GOOGLE_DRIVE_INTAKE_INTERVAL_SECONDS` | Processes up to `GOOGLE_DRIVE_INTAKE_BATCH_SIZE` files per tick |

If beat is unavailable, use the guarded cron fallback:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<api-host>/api/v1/journal-monitors/auto-cron
```

The fallback requires `CRON_SECRET`. Do not expose this endpoint without that header.

## Required Environment

The following values must be consistent across API, Celery worker, and Celery beat unless noted otherwise:

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | API, worker, beat | Shared application database |
| `REDIS_URL` | API, worker, beat, Flower | Celery broker/result backend and cache |
| `FILE_STORAGE_PATH` | API, worker | Shared path or mounted volume for uploaded and generated documents |
| `DATA_ENCRYPTION_KEY` | API, worker | Decrypts stored integration credentials |
| `CRON_SECRET` | API, external cron only | Protects `/api/v1/journal-monitors/auto-cron` fallback |
| `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` | API, worker | Optional global Drive service account; section credentials can override |
| `GOOGLE_DRIVE_INTAKE_BATCH_SIZE` | worker, beat visibility | Recommended default is `5`; reduce to `1` for cautious rollout |
| `GOOGLE_DRIVE_INTAKE_INTERVAL_SECONDS` | beat | Drive intake schedule interval |
| `MAIL_PRIMARY_CHANNEL` | API, worker | Current primary mail channel, usually `google_apps_script` |
| `IMAP_FALLBACK_ENABLED` | API, worker | Keep `false` unless controlled fallback is needed |
| `IMAP_AUTO_POLL_ENABLED` | worker | Keep `false` unless IMAP is deliberately the active channel |

## Docker Commands

Main compose:

```bash
docker compose up -d --build api worker beat redis
```

Split worker compose for Vercel style deployments:

```bash
docker compose -f infra/vercel/docker-compose.workers.yml up -d --build
```

Optional Flower:

```bash
docker compose -f infra/vercel/docker-compose.workers.yml --profile observability up flower
```

Flower must stay local or private. Do not publish it directly to the internet.

## Health Checks

Run these after deploy and after any worker host restart:

```bash
curl https://<api-host>/health
curl -H "Authorization: Bearer <access-token>" https://<api-host>/api/v1/jobs/worker-health
```

From the worker host:

```bash
celery -A app.celery_app.celery_app inspect ping
docker compose logs --tail=100 worker
docker compose logs --tail=100 beat
```

Expected results:

- API `/health` returns success.
- `/api/v1/jobs/worker-health` shows `broker_configured=true`, worker names when online, backlog counts, queues, beat schedule, mail channel, IMAP fallback, and Drive batch size.
- `celery -A app.celery_app.celery_app inspect ping` returns at least one worker.
- Worker logs show imports, OCR, exports, journal monitor, and Drive intake without repeated crash loops.
- Beat logs show scheduled task ticks without repeated crash loops.

## Failure Triage

| Symptom | First checks | Safe action |
|---|---|---|
| Jobs stay `queued` | Worker running, `REDIS_URL` identical, queue list includes `import_parse` or `report_export` | Restart worker only; do not alter job rows manually |
| Periodic Drive intake does not run | Beat running, `GOOGLE_DRIVE_INTAKE_AUTO_ENABLED=true`, beat schedule present | Restart beat or call `/api/v1/journal-monitors/auto-cron` with `CRON_SECRET` |
| Drive files process slowly | Worker Health Drive batch size, worker logs, Drive API errors | Keep `GOOGLE_DRIVE_INTAKE_BATCH_SIZE=5`; raise only after logs are stable |
| Drive files fail marking | Service account permission to folder/file | Give service account Editor access; then retry from Job Center |
| IMAP unexpectedly processes mail | `MAIL_PRIMARY_CHANNEL`, `IMAP_FALLBACK_ENABLED`, `IMAP_AUTO_POLL_ENABLED` | Keep fallback disabled while Apps Script is primary |
| Flower unavailable | Profile not started, bind address, Redis connection | Start observability profile locally only |

## Safe Change Policy

- Change scheduling and batch parameters through environment variables first.
- Keep API version and external webhook payloads backward compatible.
- Prefer adding status/observability before changing worker behavior.
- Never remove Google Apps Script, IMAP fallback, Drive intake, or document storage behavior as part of worker topology changes.
- Avoid platform migrations in this runbook; record migration proposals separately.
