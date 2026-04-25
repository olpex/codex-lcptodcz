# Accessibility Baseline (UX-012)

Дата фіксації: 25 квітня 2026

## Що покрито у baseline

- Глобальні `focus-visible` стилі для інтерактивних елементів (`a`, `button`, `input`, `select`, `textarea`).
- Єдина логіка `label + helper + error` через `FormField` з `aria-describedby` та `aria-invalid`.
- Таблиці мають базові a11y-атрибути:
  - `caption` (sr-only),
  - `aria-label`,
  - `scope="col"`,
  - `aria-sort`.
- Toast-сповіщення мають `aria-live="polite"`.
- Адаптація до `prefers-reduced-motion: reduce`.

## Мінімальний ручний чекліст (keyboard-only)

1. `/login`: перейти `Tab`-клавішею через логін, пароль, кнопку входу, посилання аварійного відновлення.
2. `/schedule`: перевірити керування згортками по датах клавіатурою.
3. `/documents`: пройти import/export/status дії без миші.
4. `/jobs`: фільтри та пагінація доступні з клавіатури.

## Автоматизовані перевірки

- Frontend build: `cd frontend && npm run build`
- Lighthouse accessibility audit: `cd frontend && npm run test:a11y:lighthouse`
- E2E (критичні): `cd frontend && npx playwright test tests/e2e/smoke.spec.ts tests/e2e/mvp-admin-flow.spec.ts tests/e2e/schedule-conflicts.spec.ts tests/e2e/a11y-keyboard.spec.ts`
- Full nightly regression: `cd frontend && npm run test:e2e`

## Обмеження поточного baseline

- Не всі сторінки мають окремі цільові e2e-сценарії keyboard-only (пріоритетні маршрути вже покриті).
