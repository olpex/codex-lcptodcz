# Google Apps Script: автоімпорт договорів та розкладів з Gmail

Цей сценарій обробляє **два типи** вкладень з Gmail:

| Тип файлу | Правило | Endpoint |
|---|---|---|
| Договори (`.xls/.xlsx`) | *Будь-який Excel-файл від `lcptodcz@gmail.com`* | `/mail/gmail-api-webhook/contracts` |
| Розклади (`.docx`) | *Будь-який Word-файл від `lcptodcz@gmail.com`* | `/mail/gmail-api-webhook/contracts` |

> Один запуск Apps Script = один файл. Якщо в листі 3 придатні вкладення, скрипт ставить у внутрішню чергу 3 файли й обробляє їх по одному в наступних сесіях.

## 1) Налаштуйте backend (Vercel)

| Змінна | Значення |
|---|---|
| `MAIL_WEBHOOK_SECRET` | довгий випадковий секрет |
| `IMAP_CONTRACT_SENDER_NAME` | `Львівський центр ПТО ДСЗ` |
| `IMAP_CONTRACT_SENDER_EMAIL` | `lcptodcz@gmail.com` |
| `IMAP_CONTRACT_ATTACHMENT_PREFIX` | не використовується для Apps Script |
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
const PENDING_QUEUE_KEY = "suptc_pending_attachment_queue";
const LEGACY_QUEUE_KEY  = "suptc_pending_message_queue";
const MAX_QUEUE_ITEMS   = 300;
const MAX_ATTACHMENT_ATTEMPTS = 3;
const ALLOW_THREAD_ATTACHMENT_FALLBACK = false;
// ────────────────────────────────────────────────────────────────────────────

function processIncomingEmails() {
  Logger.log("Версія скрипта: 2026-05-02 attachment-queue-v8");
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
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(PENDING_QUEUE_KEY);
  props.deleteProperty(LEGACY_QUEUE_KEY);
  Logger.log("Внутрішню чергу файлів очищено.");
}

function clearImportState() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(PENDING_QUEUE_KEY);
  props.deleteProperty(LEGACY_QUEUE_KEY);
  Logger.log("Внутрішню чергу файлів очищено.");
}

function processIncomingEmailsLocked_() {
  const okLabel   = getOrCreateLabel_(LABEL_PROCESSED);
  const failLabel = getOrCreateLabel_(LABEL_FAILED);
  const target = findNextAttachmentTarget_();

  if (!target) {
    Logger.log("Немає нових файлів для обробки.");
    return;
  }

  const thread = target.thread;
  const message = target.message;
  const result = processOneAttachment_(target);

  if (result.ok) {
    const pendingState = removePendingAttachment_(target.item.attachmentKey, message.getId());
    Logger.log("Черга після обробки файла: залишилось=" + pendingState.remaining);
    finalizeMessageIfDone_(thread, message, okLabel);
    Logger.log("✅ Файл оброблено: " + target.fileName);
  } else {
    const pendingState = recordAttachmentFailure_(target.item, message.getId());
    Logger.log("Черга після помилки файла: залишилось=" + pendingState.remaining);
    if (pendingState.dropped) {
      thread.addLabel(failLabel);
      finalizeMessageIfDone_(thread, message, null);
      Logger.log("❌ Файл знято з черги після " + MAX_ATTACHMENT_ATTEMPTS + " спроб: " + target.fileName);
    } else {
      Logger.log("❌ Файл залишено в черзі для повторної спроби: " + target.fileName);
    }
  }
}

// ─── Допоміжні функції ───────────────────────────────────────────────────────

function findNextAttachmentTarget_() {
  const queuedTarget = getNextQueuedAttachmentTarget_();
  if (queuedTarget) {
    Logger.log("Беремо один файл із внутрішньої черги: " + queuedTarget.fileName);
    return queuedTarget;
  }

  const queued = scanUnreadMessagesIntoAttachmentQueue_();
  if (queued > 0) {
    const target = getNextQueuedAttachmentTarget_();
    if (target) {
      Logger.log("Беремо перший файл зі знімка черги: " + target.fileName);
      return target;
    }
  }

  return null;
}

function scanUnreadMessagesIntoAttachmentQueue_() {
  const stats = {
    threads: 0,
    unread: 0,
    expectedSenderUnread: 0,
    expectedSenderUnreadWithAttachments: 0,
    fallbackUnreadWithAttachments: 0,
    queuedAttachments: 0,
  };

  for (let start = 0; start < SCAN_THREAD_LIMIT; start += SCAN_PAGE_SIZE) {
    const threads = GmailApp.getInboxThreads(start, SCAN_PAGE_SIZE);
    if (!threads.length) {
      break;
    }

    for (const thread of threads) {
      stats.threads += 1;
      const messages = thread.getMessages();
      const expectedUnreadMessages = [];
      const fallbackUnreadMessages = [];

      for (const message of messages) {
        const matchedAttachments = getMatchedAttachments_(message);
        const hasMatchedAttachment = matchedAttachments.length > 0;
        const expectedSender = isExpectedSender_(message);

        if (!message.isUnread()) {
          continue;
        }

        stats.unread += 1;
        if (!isExpectedSender_(message)) {
          Logger.log("Unread-marker не від цільового відправника: " + describeMessage_(message));
          if (ALLOW_THREAD_ATTACHMENT_FALLBACK && hasMatchedAttachment) {
            stats.fallbackUnreadWithAttachments += 1;
            fallbackUnreadMessages.push(message);
          }
          continue;
        }

        stats.expectedSenderUnread += 1;
        if (hasMatchedAttachment) {
          stats.expectedSenderUnreadWithAttachments += matchedAttachments.length;
          expectedUnreadMessages.push(message);
        } else {
          Logger.log("Непрочитаний лист від цільового відправника без придатних вкладень: " + describeMessage_(message));
        }
      }

      if (expectedUnreadMessages.length > 0) {
        const added = enqueueAttachmentItems_(thread, expectedUnreadMessages);
        stats.queuedAttachments += added;
        Logger.log("Поставлено в чергу файлів від цільового відправника: " + added);
      } else if (fallbackUnreadMessages.length > 0) {
        const added = enqueueAttachmentItems_(thread, fallbackUnreadMessages);
        stats.queuedAttachments += added;
        Logger.log("Поставлено в fallback-чергу файлів: " + added);
      }
    }
  }

  Logger.log(
    "Діагностика пошуку: тредів=" + stats.threads +
    ", непрочитаних=" + stats.unread +
    ", від потрібного відправника=" + stats.expectedSenderUnread +
    ", придатних файлів=" + stats.expectedSenderUnreadWithAttachments +
    ", fallback-непрочитаних з вкладеннями=" + stats.fallbackUnreadWithAttachments +
    ", поставлено в чергу=" + stats.queuedAttachments
  );
  return stats.queuedAttachments;
}

function processOneAttachment_(target) {
  const bytes = target.attachment.getBytes();
  const b64   = Utilities.base64EncodeWebSafe(bytes);

  const payload = JSON.stringify({
    filename:      target.fileName,
    messageId:     target.message.getId(),
    attachmentKey: target.item.attachmentKey,
    subject:       target.message.getSubject() || "",
    fileBase64:    b64,
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
    Logger.log("❌ Помилка %s для '%s': %s", code, target.fileName, resp.getContentText());
    return { ok: false };
  }

  Logger.log("✅ Успіх %s для '%s': job_id=%s, status=%s", code, target.fileName, body.id || "?", body.status || "?");
  logImportResult_(body, target.fileName);
  return { ok: true };
}

function logImportResult_(body, fileName) {
  const payload = body && body.result_payload ? body.result_payload : {};
  const result = payload.import_result || {};
  if (!result || Object.keys(result).length === 0) {
    return;
  }
  Logger.log(
    "📊 Результат імпорту '%s': inserted=%s, updated=%s, restored=%s, memberships=%s, skipped_existing=%s, skipped_invalid=%s, sheet=%s, note=%s",
    fileName,
    result.inserted || 0,
    result.updated_existing || 0,
    result.restored_deleted || 0,
    result.memberships_created || 0,
    result.skipped_existing || 0,
    result.skipped_invalid || 0,
    result.sheet_name || "?",
    result.note || ""
  );
}

function getNextQueuedAttachmentTarget_() {
  let queue = loadPendingQueue_();
  let changed = false;

  while (queue.length > 0) {
    const item = queue[0];
    try {
      const thread = GmailApp.getThreadById(item.threadId);
      const message = GmailApp.getMessageById(item.messageId);
      const matched = message ? findMatchedAttachmentByItem_(message, item) : null;
      if (message && matched) {
        if (changed) {
          savePendingQueue_(queue);
        }
        return {
          thread: thread,
          message: message,
          attachment: matched.attachment,
          fileName: matched.fileName,
          item: item,
        };
      }
      Logger.log("Видаляю з черги недоступний файл: " + item.attachmentKey);
      queue.shift();
      changed = true;
    } catch (e) {
      Logger.log("Видаляю з черги недоступний файл " + item.attachmentKey + ": " + e);
      queue.shift();
      changed = true;
    }
  }

  if (changed) {
    savePendingQueue_(queue);
  }
  return null;
}

function enqueueAttachmentItems_(thread, messages) {
  let queue = loadPendingQueue_();
  const seen = {};
  let added = 0;

  queue.forEach(function(item) {
    seen[item.attachmentKey] = true;
  });

  messages.forEach(function(message) {
    const attachments = getMatchedAttachments_(message);
    attachments.forEach(function(item) {
      if (seen[item.attachmentKey]) {
        return;
      }
      queue.push({
        threadId: thread.getId(),
        messageId: message.getId(),
        attachmentIndex: item.index,
        attachmentKey: item.attachmentKey,
        fileName: item.fileName,
        attempts: 0,
        queuedAt: new Date().toISOString(),
      });
      seen[item.attachmentKey] = true;
      added += 1;
    });
  });

  if (queue.length > MAX_QUEUE_ITEMS) {
    queue = queue.slice(queue.length - MAX_QUEUE_ITEMS);
  }
  savePendingQueue_(queue);
  return added;
}

function removePendingAttachment_(attachmentKey, messageId) {
  const queue = loadPendingQueue_();
  const next = queue.filter(function(item) {
    return item.attachmentKey !== attachmentKey;
  });
  if (next.length !== queue.length) {
    savePendingQueue_(next);
  }
  return {
    hasMoreInMessage: next.some(function(item) {
      return item.messageId === messageId;
    }),
    remaining: next.length,
  };
}

function recordAttachmentFailure_(failedItem, messageId) {
  let queue = loadPendingQueue_();
  let dropped = false;

  queue = queue.filter(function(item) {
    return item.attachmentKey !== failedItem.attachmentKey;
  });

  const nextAttempts = (failedItem.attempts || 0) + 1;
  if (nextAttempts >= MAX_ATTACHMENT_ATTEMPTS) {
    dropped = true;
  } else {
    failedItem.attempts = nextAttempts;
    failedItem.lastErrorAt = new Date().toISOString();
    queue.push(failedItem);
  }

  savePendingQueue_(queue);
  return {
    dropped: dropped,
    hasMoreInMessage: queue.some(function(item) {
      return item.messageId === messageId;
    }),
    remaining: queue.length,
  };
}

function loadPendingQueue_() {
  const raw = PropertiesService.getScriptProperties().getProperty(PENDING_QUEUE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    Logger.log("Чергу листів пошкоджено, очищаю: " + e);
    return [];
  }
}

function savePendingQueue_(queue) {
  PropertiesService.getScriptProperties().setProperty(PENDING_QUEUE_KEY, JSON.stringify(queue));
}

function getMatchedAttachments_(message) {
  const attachments = message.getAttachments({
    includeInlineImages: false,
    includeAttachments: true,
  });
  const matched = [];

  attachments.forEach(function(att, index) {
    const fileName = (att.getName() || "").trim();
    const ext = getExtension_(fileName);
    const isContract = ext === "xlsx" || ext === "xls";
    const isSchedule = ext === "docx";
    if (!isContract && !isSchedule) {
      return;
    }
    matched.push({
      attachment: att,
      index: index,
      fileName: fileName,
      attachmentKey: makeAttachmentKey_(message, index, fileName),
    });
  });

  return matched;
}

function findMatchedAttachmentByItem_(message, item) {
  const attachments = getMatchedAttachments_(message);
  for (let i = 0; i < attachments.length; i += 1) {
    if (attachments[i].attachmentKey === item.attachmentKey) {
      return attachments[i];
    }
  }
  for (let j = 0; j < attachments.length; j += 1) {
    if (attachments[j].fileName === item.fileName && attachments[j].index === item.attachmentIndex) {
      return attachments[j];
    }
  }
  return null;
}

function makeAttachmentKey_(message, index, fileName) {
  return message.getId() + ":" + index + ":" + fileName;
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
  return getMatchedAttachments_(message).length > 0;
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

function finalizeMessageIfDone_(thread, message, okLabel) {
  const queue = loadPendingQueue_();
  const hasMoreForMessage = queue.some(function(item) {
    return item.messageId === message.getId();
  });
  if (hasMoreForMessage) {
    return;
  }

  markMessageReadOnly_(message);
  thread.refresh();
  if (okLabel && !threadHasUnreadMessages_(thread) && !threadHasLabel_(thread, LABEL_FAILED)) {
    thread.addLabel(okLabel);
  }
}

function threadHasLabel_(thread, labelName) {
  return thread.getLabels().some(function(label) {
    return label.getName() === labelName;
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
| `400` | Неправильний Base64 | Перевірте, що скрипт використовує `base64EncodeWebSafe` |
| `503` | `MAIL_WEBHOOK_SECRET` не задано у Vercel | Додайте змінну у Vercel Dashboard |
