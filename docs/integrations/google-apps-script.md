# Google Apps Script: автоімпорт договорів з Gmail

Цей сценарій потрібен, якщо IMAP для Gmail недоступний (немає `App Password`).

## 1) Підготуйте backend

У Vercel задайте:

- `MAIL_WEBHOOK_SECRET=<довгий випадковий секрет>`
- `IMAP_CONTRACT_SENDER_NAME=Львівський центр ПТО ДСЗ`
- `IMAP_CONTRACT_SENDER_EMAIL=lcptodcz@gmail.com`
- `IMAP_CONTRACT_ATTACHMENT_PREFIX=Договори`
- `IMAP_CONTRACT_UPDATE_MODE=overwrite`

Endpoint:

- `POST https://<your-domain>/api/api/v1/mail/google-webhook/contracts`

## 2) Додайте Apps Script

1. В акаунті `lcptodcz.audyt@gmail.com` відкрийте [script.new](https://script.new).
2. Вставте код нижче.
3. У `PROJECT_BASE_URL` та `WEBHOOK_SECRET` вкажіть ваші значення.
4. Збережіть проект.
5. Запустіть `processContractsEmails()` вручну 1 раз (надайте дозволи).
6. Створіть тригер: `processContractsEmails`, time-driven, кожні 5 хвилин.

```javascript
const PROJECT_BASE_URL = "https://codex-lcptodcz.vercel.app";
const WEBHOOK_SECRET = "REPLACE_WITH_MAIL_WEBHOOK_SECRET";
const SENDER_EMAIL = "lcptodcz@gmail.com";
const SENDER_NAME = "Львівський центр ПТО ДСЗ";
const LABEL_PROCESSED = "suptc/processed";
const LABEL_FAILED = "suptc/failed";

function processContractsEmails() {
  const query = 'in:inbox is:unread has:attachment from:' + SENDER_EMAIL;
  const threads = GmailApp.search(query, 0, 30);
  const okLabel = getOrCreateLabel_(LABEL_PROCESSED);
  const failLabel = getOrCreateLabel_(LABEL_FAILED);

  threads.forEach((thread) => {
    const messages = thread.getMessages();
    let threadOk = true;

    messages.forEach((message) => {
      const from = message.getFrom() || "";
      const attachments = message.getAttachments({ includeInlineImages: false, includeAttachments: true });
      attachments.forEach((att) => {
        const fileName = att.getName() || "";
        if (!isContractsFilename_(fileName)) return;

        const ext = getExtension_(fileName);
        if (ext !== "xlsx" && ext !== "xls") return;

        const payload = {
          sender_email: SENDER_EMAIL,
          sender_name: SENDER_NAME,
          subject: message.getSubject() || "",
          message_id: message.getId(),
          update_existing_mode: "overwrite",
        };

        const options = {
          method: "post",
          headers: { Authorization: "Bearer " + WEBHOOK_SECRET },
          payload: {
            ...payload,
            file: att.copyBlob().setName(fileName),
          },
          muteHttpExceptions: true,
        };

        const url = PROJECT_BASE_URL + "/api/api/v1/mail/google-webhook/contracts";
        const resp = UrlFetchApp.fetch(url, options);
        const code = resp.getResponseCode();
        if (code < 200 || code >= 300) {
          threadOk = false;
          Logger.log("Webhook error %s: %s", code, resp.getContentText());
        }
      });
    });

    if (threadOk) {
      thread.addLabel(okLabel);
      thread.markRead();
    } else {
      thread.addLabel(failLabel);
    }
  });
}

function isContractsFilename_(name) {
  const normalized = (name || "").toLowerCase().replace(/_/g, " ");
  if (!normalized.includes("договор")) return false;
  // Matches 73-26, 73/26, 73–26, 73—26
  return /\\d{1,4}\\s*[-/–—]\\s*\\d{1,4}/.test(normalized);
}

function getExtension_(name) {
  const parts = (name || "").toLowerCase().split(".");
  if (parts.length < 2) return "";
  return parts[parts.length - 1];
}

function getOrCreateLabel_(labelName) {
  return GmailApp.getUserLabelByName(labelName) || GmailApp.createLabel(labelName);
}
```

## 3) Як перевірити

1. Надішліть тестовий лист на `lcptodcz.audyt@gmail.com`:
   - від `lcptodcz@gmail.com`,
   - вкладення `.xls/.xlsx`,
   - у назві файлу є `договори` та номер групи (до/після слова).
2. Через 1-5 хв перевірте `/jobs`:
   - імпорт з джерелом `Пошта: Google Script`.
3. Перевірте `/trainees` на нових/оновлених слухачів.
