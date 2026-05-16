# Kubernetes manifests (MVP)

Цей каталог містить базові маніфести для запуску СУПТЦ в Kubernetes.

## Що є

- `namespace.yaml` — namespace `suptc`
- `configmap.yaml` — не-секретні змінні середовища
- `secrets.example.yaml` — приклад Secret (не комітити реальні значення)
- `postgres.yaml` — PostgreSQL (StatefulSet + Service + PVC)
- `redis.yaml` — Redis (Deployment + Service)
- `documents-pvc.yaml` — спільне файлове сховище для API, worker і beat
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
kubectl apply -f infra/k8s/documents-pvc.yaml
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
- `FILE_STORAGE_PATH` вказано як `/tmp/documents`; цей шлях має бути спільним для API, worker і beat, інакше queued/manual import та export не бачитимуть файли між pod-ами.
- `documents-pvc.yaml` використовує `ReadWriteMany`. Якщо ваш Kubernetes storage class не підтримує RWX, використайте сумісне спільне сховище або тримайте API/worker на deployment-профілі зі спільним volume.
