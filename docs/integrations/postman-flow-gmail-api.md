# Postman Flow: автоімпорт договорів через Gmail REST API

Цей workflow є альтернативою до Google Apps Script — використовує **Gmail REST API** безпосередньо через OAuth 2.0 Bearer Token у Postman Flow.

## Поштові скриньки

| Роль | Акаунт |
|------|--------|
| **Отримувач** (скринька, яку читає Flow) | `lcptodcz.audyt@gmail.com` |
| **Відправник** (від кого приходять договори) | `lcptodcz@gmail.com` |

OAuth 2.0 токен (`gmailAccessToken`) має бути виданий для акаунту **`lcptodcz.audyt@gmail.com`**.  
Flow читає вхідні листи цієї скриньки та шукає листи **від `lcptodcz@gmail.com`** з вкладеннями `Договори*.xlsx`.

## Архітектура workflow

```
[Start]
  │ gmailAccessToken (для lcptodcz.audyt@gmail.com), appEndpoint
  ▼
[GET] List messages (Договори)
  https://gmail.googleapis.com/gmail/v1/users/me/messages
  ?q=from:lcptodcz@gmail.com has:attachment
  │  (читає скриньку lcptodcz.audyt@gmail.com)
  ├─ Has messages? ──[ELSE]──► "No messages found" (кінець)
  │
  ▼ [THEN]
[For] — ітерація по кожному messageId
  │
  ▼
[GET] Get message by ID
  https://gmail.googleapis.com/gmail/v1/users/me/messages/{{messageId}}?format=full
  │
  ▼
[Evaluate] Find Договори attachment
  — шукає у body.payload.parts файл з "договори" у назві (.xlsx/.xls)
  │
  ├─ Match found? ──[ELSE]──► наступний message у циклі
  │
  ▼ [THEN]
[GET] Get attachment by ID
  https://gmail.googleapis.com/gmail/v1/users/me/messages/{{messageId}}/attachments/{{attachmentId}}
  │
  ▼
[Evaluate] Build payload
  → { filename, messageId, fileBase64 }
  │
  ▼
[POST] Send file to application endpoint
  {{appEndpoint}} — backend endpoint
  Authorization: Bearer <MAIL_WEBHOOK_SECRET>
  Body: { "filename": "...", "messageId": "...", "fileBase64": "..." }
  │
  ▼
[Collect] Processed attachments
```

## Backend endpoint

**Endpoint** реалізований у `backend/app/api/routes/mail.py`:

```
POST /api/v1/mail/gmail-api-webhook/contracts
Authorization: Bearer <MAIL_WEBHOOK_SECRET>
Content-Type: application/json

{
  "filename": "Договори 73-26 ....xlsx",
  "messageId": "<Gmail message ID>",
  "fileBase64": "<URL-safe Base64 від Gmail API>"
}
```

**Відповідь** (202 Accepted):
```json
{
  "id": 42,
  "status": "queued",
  "message": "Заявку на імпорт з Gmail API (Postman Flow) створено",
  "result_payload": {
    "source": "mail_gmail_api",
    "channel": "postman_flow_gmail_api",
    "group_code_hint": "73-26",
    "import_mode": "overwrite"
  }
}
```

### Особливості декодування Base64

Gmail API повертає **URL-safe Base64** (RFC 4648 §5):
- символ `-` замість `+`
- символ `_` замість `/`
- без padding символів `=`

Backend автоматично виконує нормалізацію перед декодуванням.

## Налаштування змінних середовища (Vercel)

| Змінна | Значення |
|--------|---------|
| `MAIL_WEBHOOK_SECRET` | Секрет для авторизації запитів від Postman Flow |
| `IMAP_CONTRACT_SENDER_EMAIL` | `lcptodcz@gmail.com` |
| `IMAP_CONTRACT_SENDER_NAME` | `Львівський центр ПТО ДСЗ` |
| `IMAP_CONTRACT_ATTACHMENT_PREFIX` | `Договори` |
| `IMAP_CONTRACT_UPDATE_MODE` | `overwrite` або `skip` |
| `IMAP_BRANCH_ID` | `main` |

## Налаштування Postman Flow

У Postman Flow задайте початкові змінні (вузол **Start**):

| Змінна | Значення |
|--------|---------|
| `gmailAccessToken` | OAuth 2.0 Bearer Token для **`lcptodcz.audyt@gmail.com`** |
| `appEndpoint` | `https://<your-domain>/api/api/v1/mail/gmail-api-webhook/contracts` |

> **Увага:** У вузлі **Send file to application endpoint** обов'язково додайте header:
> `Authorization: Bearer <MAIL_WEBHOOK_SECRET>`

### Як отримати gmailAccessToken

1. Відкрийте [Google OAuth Playground](https://developers.google.com/oauthplayground/).
2. Увійдіть як `lcptodcz.audyt@gmail.com`.
3. Scope: `https://www.googleapis.com/auth/gmail.readonly`.
4. Скопіюйте **Access Token** (дійсний 1 годину).

Або налаштуйте OAuth 2.0 клієнт у Postman:
- **Auth URL:** `https://accounts.google.com/o/oauth2/auth`
- **Token URL:** `https://oauth2.googleapis.com/token`
- **Scope:** `https://www.googleapis.com/auth/gmail.readonly`

## Як перевірити

1. Надішліть лист **від** `lcptodcz@gmail.com` **на** `lcptodcz.audyt@gmail.com` з вкладенням `Договори*.xlsx`.
2. Запустіть Postman Flow кнопкою **Run**.
3. Flow знайде листи від `lcptodcz@gmail.com` у скриньці `lcptodcz.audyt@gmail.com`.
4. Перевірте `/jobs` у додатку — має з'явитись новий імпорт з джерелом `mail_gmail_api`.
5. Перевірте `/trainees` на нових/оновлених слухачів.

## Порівняння каналів

| Канал | Читає скриньку | Endpoint | Формат |
|-------|---------------|----------|--------|
| Google Apps Script | `lcptodcz.audyt@gmail.com` | `POST /mail/google-webhook/contracts` | `multipart/form-data` |
| **Postman Flow / Gmail API** | **`lcptodcz.audyt@gmail.com`** | `POST /mail/gmail-api-webhook/contracts` | `application/json` + Base64 |
| IMAP (автоматично) | `lcptodcz.audyt@gmail.com` | внутрішній poll | прямо з поштової скриньки |
