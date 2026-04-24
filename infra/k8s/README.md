# Kubernetes manifests (MVP)

Цей каталог містить базові маніфести для запуску СУПТЦ в Kubernetes.

## Що є

- `namespace.yaml` — namespace `suptc`
- `configmap.yaml` — не-секретні змінні середовища
- `secrets.example.yaml` — приклад Secret (не комітити реальні значення)
- `postgres.yaml` — PostgreSQL (StatefulSet + Service + PVC)
- `redis.yaml` — Redis (Deployment + Service)
- `api.yaml` — FastAPI API (Deployment + Service)
- `worker.yaml` — Celery worker
- `beat.yaml` — Celery beat
- `frontend.yaml` — React frontend (Deployment + Service)
- `ingress.yaml` — приклад Ingress для `app.example.com` та `api.example.com`

## Швидкий запуск

1. Створити namespace/configmap/secret:

```bash
kubectl apply -f infra/k8s/namespace.yaml
kubectl apply -f infra/k8s/configmap.yaml
kubectl apply -f infra/k8s/secrets.example.yaml
```

2. Підняти базові сервіси:

```bash
kubectl apply -f infra/k8s/postgres.yaml
kubectl apply -f infra/k8s/redis.yaml
```

3. Підняти застосунок:

```bash
kubectl apply -f infra/k8s/api.yaml
kubectl apply -f infra/k8s/worker.yaml
kubectl apply -f infra/k8s/beat.yaml
kubectl apply -f infra/k8s/frontend.yaml
kubectl apply -f infra/k8s/ingress.yaml
```

## Примітки

- Для production бажано винести PostgreSQL/Redis у керовані сервіси.
- Для `SECRET_KEY`, `DATA_ENCRYPTION_KEY`, `OPENAI_API_KEY`, `DATABASE_URL` використовуйте реальні значення у Secret.
- `FILE_STORAGE_PATH` вказано як `/tmp/documents`; для production додайте PVC або S3-сумісне сховище.
