# СУПТЦ MVP

Монорепозиторій MVP-системи управління професійно-технічним центром:

- `backend`: FastAPI + PostgreSQL + Celery + Redis
- `frontend`: React + Tailwind CSS
- `infra`: допоміжна інфраструктура

## Швидкий старт

1. Скопіюйте `.env.example` у `.env` і заповніть значення.
2. Згенеруйте ключ для `DATA_ENCRYPTION_KEY`:
   - `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
3. Запустіть:
   - `docker compose up --build`
4. Відкрийте:
   - API: `http://localhost:8000/docs`
   - Frontend: `http://localhost:5173`

## Початкові облікові дані

- Логін: `INITIAL_ADMIN_USERNAME`
- Пароль: `INITIAL_ADMIN_PASSWORD`

Користувач створюється автоматично при першому старті.

## Аварійне скидання пароля адміністратора

1. У `.env` задайте `ADMIN_PASSWORD_RESET_TOKEN` (довгий випадковий токен).
2. На сторінці логіну скористайтесь формою "Скинути пароль адміністратора".
3. Введіть:
   - логін адміністратора (`admin` за замовчуванням),
   - `ADMIN_PASSWORD_RESET_TOKEN`,
   - новий пароль.

Backend endpoint: `POST /api/v1/auth/admin-reset-password`.

## Тестування

- Backend unit/integration/contracts:
  - `pytest backend/tests -q`
- Frontend e2e (Playwright):
  - `cd frontend && npm run test:e2e`
- Frontend Lighthouse accessibility audit:
  - `cd frontend && npm run test:a11y:lighthouse`
- Інтеграційний стек із реальними PostgreSQL + Redis:
  - `docker compose -f infra/tests/docker-compose.integration.yml up --build --abort-on-container-exit`

Покриття включає:
- RBAC/Auth/JWT/refresh,
- OCR-чернетки та їх підтвердження,
- контракти імпорту `.xlsx/.pdf/.docx` і структури експорту `.xlsx/.pdf/.csv`,
- базовий perf-test KPI endpoint.
- UX/UI accessibility baseline: `docs/product/accessibility-baseline.md`.

## Production на Vercel

Для черг Celery (`worker`, `beat`) потрібен окремий хостинг процесів поза Vercel.

- Інструкція: `infra/vercel/README.md`
- Compose-файл: `infra/vercel/docker-compose.workers.yml`

### Автообробка вхідної пошти (контракти/договори)

Реалізовано автоматичний імпорт вкладень з IMAP-скриньки за правилами:

- відправник: `IMAP_CONTRACT_SENDER_NAME` + `IMAP_CONTRACT_SENDER_EMAIL`,
- назва вкладення: починається з `IMAP_CONTRACT_ATTACHMENT_PREFIX` і містить номер групи (наприклад `73-26`),
- формат вкладення: `.xls/.xlsx`.

Такі вкладення обробляються як імпорт слухачів (аналогічно ручному імпорту), а в задачах мають джерело `mail_auto_contracts`.

Для Vercel додано cron (`vercel.json`), який викликає `GET /api/api/v1/mail/poll-cron` кожні 5 хвилин.
Потрібно обов'язково задати `CRON_SECRET` у Vercel Environment Variables.

## Kubernetes

Додатково доступні маніфести для розгортання у Kubernetes:

- `infra/k8s/README.md`
