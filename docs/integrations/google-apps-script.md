# Google Apps Script: автоімпорт договорів та розкладів з Gmail

Цей сценарій обробляє **одразу два типи** вкладень з одного листа:

| Тип файлу | Ключове слово в назві | Endpoint |
|---|---|---|
| Договори (`.xlsx`) | `договори` | `/mail/gmail-api-webhook/contracts` |
| Розклади (`.docx`) | *Будь-який .docx файл* | `/mail/gmail-api-webhook/contracts` |

> Один запит = один файл. Якщо в листі 3 вкладення — скрипт надсилає 3 окремих HTTP-запити.

## 1) Налаштуйте backend (Vercel)

| Змінна | Значення |
|---|---|
| `MAIL_WEBHOOK_SECRET` | довгий випадковий секрет |
| `IMAP_CONTRACT_SENDER_NAME` | `Львівський центр ПТО ДСЗ` |
| `IMAP_CONTRACT_SENDER_EMAIL` | `lcptodcz@gmail.com` |
| `IMAP_CONTRACT_ATTACHMENT_PREFIX` | `Договори` |
| `IMAP_CONTRACT_UPDATE_MODE` | `overwrite` |

## 2) Apps Script (повна версія)

1. В акаунті `lcptodcz.audyt@gmail.com` відкрийте [script.new](https://script.new).
2. Замініть весь вміст на код нижче.
3. Вкажіть свої значення у `PROJECT_BASE_URL` та `WEBHOOK_SECRET`.
4. Збережіть проект.
5. Запустіть `processIncomingEmails()` вручну 1 раз (надайте дозволи Gmail та UrlFetch).
6. Створіть тригер: `processIncomingEmails`, time-driven, кожні 5 хвилин.

```javascript
// ─── Налаштування ───────────────────────────────────────────────────────────
const PROJECT_BASE_URL  = "https://codex-lcptodcz.vercel.app";
const WEBHOOK_SECRET    = "olppara13091972olppara13091972"; // ← ваш секрет
const SENDER_EMAIL      = "lcptodcz@gmail.com";
const LABEL_PROCESSED   = "suptc/processed";
const LABEL_FAILED      = "suptc/failed";
// ────────────────────────────────────────────────────────────────────────────

function processIncomingEmails() {
  const query = 'in:inbox is:unread has:attachment from:' + SENDER_EMAIL;
  const threads = GmailApp.search(query, 0, 10);
  const okLabel   = getOrCreateLabel_(LABEL_PROCESSED);
  const failLabel = getOrCreateLabel_(LABEL_FAILED);

  for (const thread of threads) {
    const messages = thread.getMessages();
    const message = messages.find(function(item) {
      return item.isUnread();
    });

    if (!message) {
      continue;
    }

    const result = processOneMessage_(message);

    if (!result.hasMatchedAttachment) {
      Logger.log("Лист пропущено (немає відповідних вкладень): " + message.getSubject());
      return; // один запуск = максимум один лист
    }

    if (result.ok) {
      message.markRead();
      if (!threadHasUnreadMessages_(thread)) {
        thread.addLabel(okLabel);
      }
      Logger.log("✅ Лист оброблено: " + message.getSubject());
    } else {
      if (thread.getMessageCount() === 1) {
        thread.addLabel(failLabel);
      }
      Logger.log("❌ Лист позначено як помилковий: " + message.getSubject());
    }

    return; // один запуск = рівно один непрочитаний лист
  }

  Logger.log("Немає нових листів для обробки.");
}

// ─── Допоміжні функції ───────────────────────────────────────────────────────

function processOneMessage_(message) {
  let ok = true;
  let hasMatchedAttachment = false;

  const attachments = message.getAttachments({
    includeInlineImages: false,
    includeAttachments: true,
  });

  attachments.forEach(function(att) {
    const fileName = (att.getName() || "").trim();
    const ext      = getExtension_(fileName);
    const nameLow  = fileName.toLowerCase();

    const subjectLow = message.getSubject().toLowerCase();

    // Договори: .xlsx з "договор" в назві або в темі
    const isContract = (ext === "xlsx" || ext === "xls") &&
                       (nameLow.includes("договор") || subjectLow.includes("договор"));

    // Розклади: будь-який .docx
    const isSchedule = ext === "docx";

    if (!isContract && !isSchedule) {
      Logger.log("Пропущено (не підходить): " + fileName);
      return;
    }

    hasMatchedAttachment = true;

    const bytes = att.getBytes();
    const b64   = Utilities.base64EncodeWebSafe(bytes);

    const payload = JSON.stringify({
      filename:   fileName,
      messageId:  message.getId(),
      fileBase64: b64,
    });

    const options = {
      method:             "post",
      contentType:        "application/json",
      headers:            { Authorization: "Bearer " + WEBHOOK_SECRET },
      payload:            payload,
      muteHttpExceptions: true,
    };

    const url  = PROJECT_BASE_URL + "/api/api/v1/mail/gmail-api-webhook/contracts";
    const resp = UrlFetchApp.fetch(url, options);
    const code = resp.getResponseCode();

    let body = {};
    try { body = JSON.parse(resp.getContentText() || "{}"); }
    catch(e) { body = { raw: resp.getContentText() }; }

    const jobFailed = body && body.status === "failed";
    if (code < 200 || code >= 300 || jobFailed) {
      ok = false;
      Logger.log("❌ Помилка %s для '%s': %s", code, fileName, resp.getContentText());
    } else {
      Logger.log("✅ Успіх %s для '%s': job_id=%s", code, fileName, body.id || "?");
    }
  });

  return {
    ok: ok,
    hasMatchedAttachment: hasMatchedAttachment,
  };
}

function getExtension_(name) {
  const parts = (name || "").toLowerCase().split(".");
  return parts.length < 2 ? "" : parts[parts.length - 1];
}

function threadHasUnreadMessages_(thread) {
  return thread.getMessages().some(function(message) {
    return message.isUnread();
  });
}

function getOrCreateLabel_(labelName) {
  return GmailApp.getUserLabelByName(labelName) || GmailApp.createLabel(labelName);
}
```

## 3) Як перевірити

1. Надішліть тестовий лист на `lcptodcz.audyt@gmail.com`:
   - від `lcptodcz@gmail.com`,
   - **кілька вкладень**: наприклад `Розклад_46-26.docx` + `Розклад_47-26.docx`.
2. Запустіть `processIncomingEmails()` вручну або зачекайте тригер (5 хв).
3. В Google Apps Script → **Виконання** перевірте логи — має бути рядок `✅ Успіх` для **кожного** файлу.
4. Перевірте `/schedule` — обидві групи мають з'явитися в календарі.

## 4) Типові помилки

| HTTP-код | Причина | Рішення |
|---|---|---|
| `401` | Невірний `WEBHOOK_SECRET` | Порівняйте з `MAIL_WEBHOOK_SECRET` у Vercel |
| `400` | Назва Excel файлу без "договор" | Перейменуйте файл |
| `400` | Неправильний Base64 | Перевірте, що скрипт використовує `base64EncodeWebSafe` |
| `503` | `MAIL_WEBHOOK_SECRET` не задано у Vercel | Додайте змінну у Vercel Dashboard |
