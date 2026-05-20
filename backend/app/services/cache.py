import hashlib
import json
import time
from typing import Any

from redis import Redis

from app.core.config import settings

_redis_client: Redis | None = None
_redis_disabled_until = 0.0


def _get_redis_client() -> Redis | None:
    global _redis_client, _redis_disabled_until
    if settings.database_url.startswith("sqlite"):
        return None
    if time.monotonic() < _redis_disabled_until:
        return None
    if _redis_client is None:
        _redis_client = Redis.from_url(
            settings.resolved_redis_url,
            decode_responses=True,
            socket_connect_timeout=0.2,
            socket_timeout=0.2,
        )
    return _redis_client


def _disable_temporarily() -> None:
    global _redis_disabled_until
    _redis_disabled_until = time.monotonic() + 30


def cache_get_json(key: str) -> Any | None:
    client = _get_redis_client()
    if client is None:
        return None
    try:
        raw = client.get(key)
    except Exception:
        _disable_temporarily()
        return None
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def cache_set_json(key: str, payload: Any, ttl_seconds: int) -> None:
    client = _get_redis_client()
    if client is None:
        return
    try:
        client.setex(key, ttl_seconds, json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    except Exception:
        _disable_temporarily()


def cache_set_json_if_absent(key: str, payload: Any, ttl_seconds: int) -> bool | None:
    client = _get_redis_client()
    if client is None:
        return None
    try:
        raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        return bool(client.set(key, raw, ex=ttl_seconds, nx=True))
    except Exception:
        _disable_temporarily()
        return None


def cache_delete(key: str) -> None:
    client = _get_redis_client()
    if client is None:
        return
    try:
        client.delete(key)
    except Exception:
        _disable_temporarily()


def hashed_cache_part(value: str | None) -> str:
    return hashlib.sha256((value or "").encode("utf-8")).hexdigest()[:16]
