# API versioning and deprecation policy

This project currently exposes one stable API namespace: `/api/v1`.

The goal of this policy is to keep existing frontend flows, imports, exports, journal processing, and external integrations working while still allowing future API changes.

## Current contract

- All product API routes are mounted under `/api/v1`.
- Frontend requests send `X-API-Version: 1`.
- Backend responses for versioned routes include `X-API-Version: 1`.
- Unsupported `X-API-Version` values are rejected before route handling.

## Backward-compatible changes

The following changes stay inside `/api/v1`:

- Adding optional response fields.
- Adding optional request fields with safe defaults.
- Adding new endpoints.
- Adding new enum values when old values keep working.
- Tightening UI permission states without removing backend behavior.
- Adding cache, pagination, observability, or status endpoints that do not change existing responses.

These changes should be covered by focused tests and can ship without a new API namespace.

## Breaking change rules

A breaking change needs a new namespace, for example `/api/v2`, when it:

- Removes or renames a response field used by the frontend or integrations.
- Changes the meaning or type of an existing field.
- Requires a previously optional request field.
- Changes authentication, branch scoping, import/export semantics, or external webhook payloads.
- Removes a route that external systems may still call.

Do not introduce a breaking change into `/api/v1` unless the old route is explicitly deprecated and still behaves safely.

## Deprecation process

1. Keep the old `/api/v1` route working.
2. Add the replacement route or behavior first.
3. Document the old route as deprecated in the runbook or integration doc that references it.
4. Add a test proving the old route returns a safe response.
5. If useful, add response headers such as `Deprecation: true` and a `Link` header to the replacement documentation.
6. Remove the old route only in a future major API namespace or after an explicit cleanup task.

For example, `/api/v1/journal-monitors/auto-tick` is deprecated but intentionally returns `410 Gone` instead of running background processing from the browser.

## Frontend expectations

- The frontend should keep sending `X-API-Version: 1`.
- UI code should not branch on undocumented response shapes.
- Admin-only or methodist-only data should be requested only by pages and roles that can use it.
- User-facing text should not expose raw `/api/v1/...` strings unless the page is explicitly technical/admin documentation.

## External integrations

Webhook and automation docs must name the exact versioned endpoint they use, for example:

- `POST /api/v1/mail/gmail-api-webhook/contracts`
- `GET|POST /api/v1/journal-monitors/auto-cron`

If an external payload changes in a breaking way, keep the `/api/v1` webhook working and introduce the new contract under `/api/v2`.
