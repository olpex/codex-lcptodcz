from app.services.cache import cache_delete

SCHEDULE_LIST_CACHE_TTL_SECONDS = 60


def schedule_list_cache_key(branch_id: str) -> str:
    return f"schedule:list:{branch_id}:v1"


def invalidate_schedule_list_cache(branch_id: str) -> None:
    cache_delete(schedule_list_cache_key(branch_id))
