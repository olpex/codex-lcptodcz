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
6. Запустіть `installSingleTrigger()` вручну 1 раз. Вона видалить дублікати тригерів у цьому проєкті й створить рівно один time-driven тригер кожні 5 хвилин.

> Скрипт використовує тільки вбудований `GmailApp`; окремо вмикати Gmail REST API у Google Cloud не потрібно.

```javascript
// ─── Налаштування ───────────────────────────────────────────────────────────
const PROJECT_BASE_URL  = "https://codex-lcptodcz.vercel.app";
const WEBHOOK_SECRET    = "olppara13091972olppara13091972"; // ← ваш секрет
const SENDER_EMAIL      = "lcptodcz@gmail.com";
const LABEL_PROCESSED   = "suptc/processed";
const LABEL_FAILED      = "suptc/failed";
const SCAN_THREAD_LIMIT = 300;
const SCAN_PAGE_SIZE    = 50;
const PENDING_QUEUE_KEY = "suptc_pending_message_queue";
const ALLOW_THREAD_ATTACHMENT_FALLBACK = true;
// ────────────────────────────────────────────────────────────────────────────

function processIncomingEmails() {
  Logger.log("Версія скрипта: 2026-04-29 one-unread-v1");
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    Logger.log("Інший запуск ще працює. Пропускаємо цю сесію.");
    return;
  }

  try {
    processIncomingEmailsLocked_();
  } finally {
    lock.releaseLock();
  }
}

function installSingleTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;

  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === "processIncomingEmails") {
      ScriptApp.deleteTrigger(trigger);
      removed += 1;
    }
  });

  ScriptApp.newTrigger("processIncomingEmails")
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log("Готово: видалено старих тригерів processIncomingEmails=" + removed + ", створено 1 новий тригер.");
}

function clearPendingQueue() {
  PropertiesService.getScriptProperties().deleteProperty(PENDING_QUEUE_KEY);
  Logger.log("Внутрішню чергу очищено.");
}

function processIncomingEmailsLocked_() {
  const okLabel   = getOrCreateLabel_(LABEL_PROCESSED);
  const failLabel = getOrCreateLabel_(LABEL_FAILED);
  const target = findNextUnreadMessage_();

  if (!target) {
    Logger.log("Немає нових листів для обробки.");
    return;
  }

  const thread = target.thread;
  const message = target.message;
  const result = processOneMessage_(message);

  if (!result.hasMatchedAttachment) {
    Logger.log("Лист пропущено (немає відповідних вкладень): " + message.getSubject());
    return; // один запуск = максимум один лист
  }

  if (result.ok) {
    markMessageReadOnly_(message);
    thread.refresh();
    if (!threadHasUnreadMessages_(thread)) {
      thread.addLabel(okLabel);
    }
    Logger.log("✅ Лист оброблено: " + message.getSubject());
  } else {
    markMessageReadOnly_(message);
    thread.addLabel(failLabel);
    Logger.log("❌ Лист позначено як помилковий: " + message.getSubject());
  }
}

// ─── Допоміжні функції ───────────────────────────────────────────────────────

function findNextUnreadMessage_() {
  const stats = {
    threads: 0,
    unread: 0,
    expectedSenderUnread: 0,
    expectedSenderUnreadWithAttachments: 0,
    fallbackUnreadWithAttachments: 0,
  };
  let fallbackTarget = null;

  for (let start = 0; start < SCAN_THREAD_LIMIT; start += SCAN_PAGE_SIZE) {
    const threads = GmailApp.getInboxThreads(start, SCAN_PAGE_SIZE);
    if (!threads.length) {
      break;
    }

    for (const thread of threads) {
      stats.threads += 1;
      const messages = thread.getMessages();

      for (const message of messages) {
        if (!message.isUnread()) {
          continue;
        }

        stats.unread += 1;
        const hasMatchedAttachment = messageHasMatchedAttachments_(message);
        if (!isExpectedSender_(message)) {
          Logger.log("Unread-marker не від цільового відправника: " + describeMessage_(message));
          if (ALLOW_THREAD_ATTACHMENT_FALLBACK && hasMatchedAttachment && !fallbackTarget) {
            stats.fallbackUnreadWithAttachments += 1;
            fallbackTarget = {
              thread: thread,
              message: message,
            };
          }
          continue;
        }

        stats.expectedSenderUnread += 1;
        if (hasMatchedAttachment) {
          stats.expectedSenderUnreadWithAttachments += 1;
          Logger.log("Беремо один непрочитаний лист до обробки: " + describeMessage_(message));
          return {
            thread: thread,
            message: message,
          };
        } else {
          Logger.log("Непрочитаний лист від цільового відправника без придатних вкладень: " + describeMessage_(message));
        }
      }
    }
  }

  if (fallbackTarget) {
    Logger.log("Беремо один fallback-непрочитаний лист до обробки: " + describeMessage_(fallbackTarget.message));
    return fallbackTarget;
  }

  Logger.log(
    "Діагностика пошуку: тредів=" + stats.threads +
    ", непрочитаних=" + stats.unread +
    ", від потрібного відправника=" + stats.expectedSenderUnread +
    ", з вкладеннями=" + stats.expectedSenderUnreadWithAttachments +
    ", fallback-непрочитаних з вкладеннями=" + stats.fallbackUnreadWithAttachments
  );
  return null;
}

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
      subject:    message.getSubject() || "",
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

function isExpectedSender_(message) {
  const from = (message.getFrom() || "").toLowerCase();
  return from.indexOf(SENDER_EMAIL.toLowerCase()) !== -1;
}

function messageHasAttachments_(message) {
  const attachments = message.getAttachments({
    includeInlineImages: false,
    includeAttachments: true,
  });
  return attachments.length > 0;
}

function messageHasMatchedAttachments_(message) {
  const subjectLow = (message.getSubject() || "").toLowerCase();
  const attachments = message.getAttachments({
    includeInlineImages: false,
    includeAttachments: true,
  });

  return attachments.some(function(att) {
    const fileName = (att.getName() || "").trim();
    const ext = getExtension_(fileName);
    const nameLow = fileName.toLowerCase();
    const isContract = (ext === "xlsx" || ext === "xls") &&
                       (nameLow.includes("договор") || subjectLow.includes("договор"));
    const isSchedule = ext === "docx";
    return isContract || isSchedule;
  });
}

function findExpectedSenderMessagesWithMatchedAttachments_(messages) {
  const expectedSenderMessages = [];
  const fallbackMessages = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!messageHasMatchedAttachments_(message)) {
      continue;
    }
    if (isExpectedSender_(message)) {
      expectedSenderMessages.push(message);
    } else {
      fallbackMessages.push(message);
    }
  }

  if (expectedSenderMessages.length > 0) {
    return expectedSenderMessages;
  }

  if (ALLOW_THREAD_ATTACHMENT_FALLBACK && fallbackMessages.length > 0) {
    Logger.log("Не знайдено вкладень від точного SENDER_EMAIL; беру придатні вкладення з unread-треду як fallback: " + fallbackMessages.length);
    fallbackMessages.forEach(function(message) {
      Logger.log("Fallback-кандидат: " + describeMessage_(message));
    });
    return fallbackMessages;
  }

  return [];
}

function describeMessage_(message) {
  const attachments = message.getAttachments({
    includeInlineImages: false,
    includeAttachments: true,
  });
  const names = attachments.map(function(att) {
    return att.getName();
  }).join(", ");
  return "from='" + message.getFrom() + "', subject='" + message.getSubject() + "', files=[" + names + "]";
}

function threadHasUnreadMessages_(thread) {
  return thread.getMessages().some(function(message) {
    return message.isUnread();
  });
}

function markMessageReadOnly_(message) {
  try {
    GmailApp.markMessagesRead([message]);
  } catch (e) {
    message.markRead();
  }
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
