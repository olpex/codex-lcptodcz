from app.services.cache import cache_delete

ATTENTION_CACHE_TTL_SECONDS = 15


def attention_cache_key(branch_id: str) -> str:
    return f"dashboard:attention:{branch_id}"


def invalidate_attention_cache(branch_id: str) -> None:
    cache_delete(attention_cache_key(branch_id))
