# Deployment topology and runbook

Цей документ фіксує поточну робочу схему СУПТЦ MVP. Його мета - допомогти перевіряти production/dev запуск без зміни наявної логіки імпорту, обробки даних і зовнішніх інтеграцій.

## 1. Поточна топологія

### Local Docker Compose

`docker-compose.yml` запускає повний локальний стек:

| Сервіс | Роль | Основні залежності |
|---|---|---|
| `frontend` | React/Vite UI на `:5173` | `api` |
| `api` | FastAPI на `:8000`, `/docs`, `/health`, `/api/v1/*` | PostgreSQL, Redis, `docs_data` |
| `worker` | Celery worker для import/OCR/export/mail/journal/drive черг | PostgreSQL, Redis, `docs_data` |
| `beat` | Celery scheduler для періодичних задач | PostgreSQL, Redis |
| `flower` | Опційний Celery monitoring UI на `127.0.0.1:5555` | Redis, profile `observability` |
| `redis` | Celery broker/result backend і короткий cache | немає |
| `postgres` | Основна база даних | `pg_data` |

### Production split deployment

Поточна production-схема не потребує міграції платформ:

| Частина | Де працює | Примітка |
|---|---|---|
| Frontend | Vercel або Docker/K8s | Має вказувати на backend API через `VITE_API_URL` |
| Backend API | Vercel або Docker/K8s | Не повинен виконувати довгоживучі Celery worker/beat процеси |
| Celery worker | Окремий Docker/K8s/worker host | Виконує імпорт, OCR, export, mail, journal monitor, Drive intake |
| Celery beat | Окремий Docker/K8s/worker host | Запускає періодичні задачі |
| PostgreSQL | Поточний PostgreSQL | Усі сервіси мають використовувати один `DATABASE_URL` |
| Redis | Поточний Redis | Усі Celery процеси мають використовувати один `REDIS_URL` |

Якщо `beat` недоступний, fallback для журналів і Drive intake - зовнішній cron на `GET` або `POST /api/v1/journal-monitors/auto-cron` з `Authorization: Bearer <CRON_SECRET>`.

## 2. Межі відповідальності

### Frontend

- Показує дані, статуси, форми й дії користувача.
- Не має бути основним orchestrator для фонових задач.
- Може запускати явні користувацькі дії, наприклад ручний імпорт або повторну обробку job.

### Backend API

- Приймає HTTP-запити, створює jobs, повертає статуси.
- Має endpoint `/health` для базової перевірки.
- Має `/api/v1/jobs` і `/api/v1/jobs/{id}` для перевірки import/export jobs.

### Celery worker/beat

- Worker виконує довгі задачі: імпорт файлів, OCR, export, mail ingest, journal monitor, Drive intake.
- Beat запускає періодичні задачі.
- Drive intake за замовчуванням обробляє `GOOGLE_DRIVE_INTAKE_BATCH_SIZE=1`, щоб зберегти стару поведінку. Для bulk-імпорту значення можна обережно збільшувати після перевірки.

## 3. Email channels

Основний канал для email-імпорту договорів і розкладів - Google Apps Script:

- Документація: `docs/integrations/google-apps-script.md`
- Endpoint: `POST /api/v1/mail/gmail-api-webhook/contracts`
- Обов'язкова змінна: `MAIL_WEBHOOK_SECRET`

IMAP лишається контрольованим fallback:

- `IMAP_AUTO_POLL_ENABLED=false` за замовчуванням.
- `IMAP_FALLBACK_ENABLED=false` за замовчуванням.
- Ручний запуск можливий через admin action `POST /api/v1/mail/poll-now`.
- Не вмикайте автоматичне IMAP-опитування паралельно з Apps Script без окремої перевірки дедуплікації.

## 4. Google Drive intake

Основні змінні:

| Змінна | Призначення | Безпечний дефолт |
|---|---|---|
| `GOOGLE_DRIVE_INTAKE_AUTO_ENABLED` | Вмикає server-side автообробку intake-папки | `true` |
| `GOOGLE_DRIVE_INTAKE_FOLDER_URL` | URL intake-папки | поточна production папка |
| `GOOGLE_DRIVE_INTAKE_INTERVAL_SECONDS` | Інтервал beat-задачі | `45` |
| `GOOGLE_DRIVE_INTAKE_BATCH_SIZE` | Скільки файлів worker може обробити за один tick | `1` |
| `GOOGLE_DRIVE_INTAKE_UPDATE_MODE` | Режим оновлення XLS/XLSX даних | `overwrite` |
| `GOOGLE_DRIVE_INTAKE_PROCESSED_MARKER` | Маркер обробленого Drive-файлу | `[processed]` |

Безпечне збільшення batch:

1. Залиште `GOOGLE_DRIVE_INTAKE_BATCH_SIZE=1` після деплою.
2. Перевірте, що worker/beat стабільні, а jobs завершуються.
3. Підніміть до `3`.
4. Перевірте logs worker, `GET /api/v1/jobs`, кількість failed jobs і стан файлів у Drive.
5. Піднімайте далі тільки якщо немає таймаутів Drive API або помилок імпорту.

## 5. Мінімальна перевірка після деплою

### API

```bash
curl -fsS https://<api-host>/health
```

Очікування: `{"status":"ok"}`.

### Redis/PostgreSQL для Docker

```bash
docker compose ps
docker compose logs --tail=100 api
docker compose logs --tail=100 worker
docker compose logs --tail=100 beat
```

Очікування:

- `postgres` і `redis` healthy.
- `api` стартує без schema/runtime помилок.
- `worker` бачить черги `mail_ingest,ocr_parse,import_parse,report_export,journal_monitor,drive_intake`.
- `beat` стартує і не падає циклічно.

### Celery worker

```bash
docker compose exec worker celery -A app.celery_app.celery_app inspect ping
```

Очікування: відповідь від worker node. Якщо відповіді немає, перевірте `REDIS_URL`, мережу Docker і logs worker.

### Celery observability через Flower

Flower не стартує за замовчуванням і не змінює роботу worker/beat. Для тимчасового перегляду черг, retry і failed tasks:

```bash
docker compose --profile observability up flower
```

Для split worker compose:

```bash
docker compose -f infra/vercel/docker-compose.workers.yml --profile observability up flower
```

Очікування: Flower доступний локально на `http://127.0.0.1:5555`. Не публікуйте цей порт назовні без окремої автентифікації або VPN/tunnel policy.

### Jobs API

1. Запустіть тестовий імпорт або export через UI.
2. Перевірте `GET /api/v1/jobs?limit=10`.
3. Перевірте конкретний job через `GET /api/v1/jobs/{id}`.

Очікування: job переходить `queued -> running -> succeeded` або повертає зрозумілий `failed` message.

### Google Apps Script

1. У Apps Script запустіть `processIncomingEmails()` вручну.
2. Перевірте logs Apps Script.
3. Перевірте `GET /api/v1/jobs?job_type=import&limit=10`.

Очікування: створюється import job з email/webhook source.

### Google Drive intake

1. Переконайтесь, що service account має доступ до intake-папки.
2. Покладіть один тестовий `.xlsx` або `.docx` файл.
3. Дочекайтесь tick Celery beat або викличте cron endpoint із `CRON_SECRET`.
4. Перевірте jobs API і назву Drive-файлу.

Очікування:

- Створено import job.
- Після успішної обробки файл отримує `[processed]`, якщо service account має `Editor`.
- Якщо rename недоступний, job не має ламати імпорт, але має показати marking error у результаті.

## 6. Типові проблеми

| Симптом | Що перевірити |
|---|---|
| API працює, але import/export зависає в `queued` | `worker` запущений, `REDIS_URL` однаковий для API і worker |
| Періодичний Drive intake не стартує | `beat` запущений або налаштовано зовнішній cron на `/api/v1/journal-monitors/auto-cron` |
| Apps Script відправляє, але job не створюється | `MAIL_WEBHOOK_SECRET`, URL endpoint, logs API |
| IMAP забирає листи неочікувано | `IMAP_AUTO_POLL_ENABLED=false`, `IMAP_FALLBACK_ENABLED=false` |
| Drive файл імпортується, але не маркується | service account має бути `Editor` для папки або файла |
| Багато Drive файлів обробляються повільно | Після стабільної перевірки підніміть `GOOGLE_DRIVE_INTAKE_BATCH_SIZE` |

## 7. Правило безпечних змін

Для змін у фоновій обробці дотримуємось такого порядку:

1. Спершу додати спостережуваність, статус або документацію.
2. Потім додати backward-compatible параметр з безпечним дефолтом.
3. Покрити поведінку тестом.
4. Увімкнути нову поведінку через env, а не через видалення старої логіки.
5. Видаляти старий шлях тільки після окремої перевірки, що він більше не потрібен.

Для змін у HTTP API застосовуйте `docs/architecture/api-versioning.md`: backward-compatible зміни залишаються в `/api/v1`, breaking change потребує нового namespace або явного deprecation path.
