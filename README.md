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
