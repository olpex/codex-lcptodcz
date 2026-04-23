# Інтеграційний стек тестів

Запуск тестів з реальними PostgreSQL + Redis у контейнерах:

```bash
docker compose -f infra/tests/docker-compose.integration.yml up --build --abort-on-container-exit
```

Покриває:
- integration (API flows, RBAC, OCR drafts, jobs lifecycle, IMAP ingest mock),
- contracts (golden-файли імпорту/експорту),
- perf (базовий load-test KPI endpoint).
