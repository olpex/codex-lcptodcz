from app.services.cache import cache_delete

GROUP_LIST_CACHE_TTL_SECONDS = 60


def group_list_cache_key(branch_id: str) -> str:
    return f"groups:list:{branch_id}:v1"


def invalidate_group_list_cache(branch_id: str) -> None:
    cache_delete(group_list_cache_key(branch_id))
