# Accessibility Baseline (UX-012)

Дата фіксації: 25 квітня 2026

## Що покрито у baseline

- Глобальні `focus-visible` стилі для інтерактивних елементів (`a`, `button`, `input`, `select`, `textarea`).
- Додано `skip-link` для швидкого переходу до основного контенту (`#main-content`).
- Єдина логіка `label + helper + error` через `FormField` з `aria-describedby` та `aria-invalid`.
- Таблиці мають базові a11y-атрибути:
  - `caption` (sr-only),
  - `aria-label`,
  - `scope="col"`,
  - `aria-sort`.
- Toast-сповіщення:
  - `success/info`: `role="status"` + `aria-live="polite"`,
  - `error`: `role="alert"` + `aria-live="assertive"`.
- Confirm-діалоги переведені на `role="alertdialog"` з:
  - `aria-labelledby`/`aria-describedby`,
  - фокусом у модалі,
  - закриттям по `Esc`,
  - базовим focus trap.
- Блоки помилок у таблицях мають `role="alert"` для негайного озвучення screen reader.
- Адаптація до `prefers-reduced-motion: reduce`.

## Мінімальний ручний чекліст (keyboard-only)

1. `/login`: перейти `Tab`-клавішею через логін, пароль, кнопку входу, посилання аварійного відновлення.
2. На будь-якій внутрішній сторінці: перевірити `skip-link` (`Tab` одразу після відкриття сторінки).
3. `/schedule`: перевірити керування згортками по датах клавіатурою.
4. `/documents`: пройти import/export/status дії без миші.
5. `/orders` або `/profile`: відкрити confirm-діалог, перевірити `Esc` та фокус-цикл.
6. `/jobs`: фільтри та пагінація доступні з клавіатури.

## Автоматизовані перевірки

- Frontend build: `cd frontend && npm run build`
- Lighthouse accessibility audit: `cd frontend && npm run test:a11y:lighthouse`
- E2E (критичні): `cd frontend && npx playwright test tests/e2e/smoke.spec.ts tests/e2e/mvp-admin-flow.spec.ts tests/e2e/schedule-conflicts.spec.ts tests/e2e/a11y-keyboard.spec.ts`
- Full nightly regression: `cd frontend && npm run test:e2e`

## Підтвердження (останній прогін)

Дата прогону: 25 квітня 2026

- `npm run lint` — успішно.
- `npm run build` — успішно.
- `npm run test:a11y:lighthouse` — успішно.
- Lighthouse accessibility score:
  - `http://127.0.0.1:4173/` — `1.00`
  - `http://127.0.0.1:4173/login` — `1.00`
- Артефакти звітів: `frontend/lighthouseci/*.report.{html,json}`

Примітка для Windows середовища:
- Для стабільної локальної інсталяції optional binary-залежностей Rollup використовувати:
  - `npm ci --os=win32 --include=optional`

## Обмеження поточного baseline

- Не всі сторінки мають окремі цільові e2e-сценарії keyboard-only (пріоритетні маршрути вже покриті).
