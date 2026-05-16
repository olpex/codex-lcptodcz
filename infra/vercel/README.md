# Vercel + Workers (Production)

Vercel не запускає довгоживучі процеси `celery worker` та `celery beat`, тому production-схема для MVP така:

1. `frontend` + `backend API` деплоїмо у Vercel.
2. `worker` + `beat` запускаємо окремо (наприклад, на VPS/Render/Railway/Fly) через `infra/vercel/docker-compose.workers.yml`.
3. Усі сервіси використовують спільні:
   - `DATABASE_URL` (Supabase/PostgreSQL),
   - `REDIS_URL`,
   - `SECRET_KEY`, `DATA_ENCRYPTION_KEY`,
   - IMAP/OCR змінні.
4. Автоматичний IMAP Cron вимкнено, щоб він не конкурував із Google Apps Script за непрочитані листи.
5. Для інтеграції з Google Apps Script задайте `MAIL_WEBHOOK_SECRET` і використовуйте endpoint `POST /api/v1/mail/gmail-api-webhook/contracts`.
6. Для синхронізації журналів і intake-папки Google Drive без окремого `celery beat` задайте `CRON_SECRET` і викликайте `GET /api/v1/journal-monitors/auto-cron` із заголовком `Authorization: Bearer <CRON_SECRET>` через зовнішній cron. На Vercel Hobby часті cron-запуски недоступні, тому для режиму 24/7 потрібен зовнішній cron або окремий worker/beat.

Детальніша схема сервісів і runbook перевірки: `../DEPLOY.md`.

## Запуск worker/beat

```bash
docker compose -f infra/vercel/docker-compose.workers.yml up -d --build
```

## Запуск worker/beat через GitHub Actions

Workflow `.github/workflows/deploy-workers.yml` дозволяє вручну оновити окремий worker-host з GitHub UI:

1. На сервері має бути клон репозиторію, Docker і Docker Compose plugin.
2. У файлі `.env` на сервері мають бути production змінні: `DATABASE_URL`, `REDIS_URL`, `SECRET_KEY`, `DATA_ENCRYPTION_KEY`, `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`, `GOOGLE_DRIVE_INTAKE_FOLDER_URL` та інші інтеграційні ключі.
3. У GitHub `Settings -> Secrets and variables -> Actions` додайте secrets:
   - `WORKER_HOST` - IP або домен worker-сервера.
   - `WORKER_USER` - SSH-користувач.
   - `WORKER_SSH_KEY` - приватний SSH-ключ для доступу.
   - `WORKER_PORT` - опційно, якщо SSH не на `22`.
   - `WORKER_APP_DIR` - опційно, шлях до репозиторію на сервері, дефолт `~/codex-lcptodcz`.
4. Запустіть workflow `Deploy Worker Beat` вручну через вкладку GitHub Actions.

Цей workflow не змінює дані і не запускається автоматично на кожен commit. Він лише оновлює код на worker-host і виконує:

```bash
docker compose -f infra/vercel/docker-compose.workers.yml up -d --build redis worker beat
```

## Опційний моніторинг Flower

```bash
docker compose -f infra/vercel/docker-compose.workers.yml --profile observability up flower
```

Flower відкривається тільки на `127.0.0.1:5555`. Не публікуйте порт назовні без окремого захисту.

## Мінімальна перевірка

1. В API викликати `POST /api/v1/mail/poll-now`.
2. Перевірити `GET /api/v1/mail/messages` та `GET /api/v1/drafts`.
3. Запустити імпорт/експорт у UI та перевірити `GET /api/v1/jobs/{id}`.
