from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import CurrentUser, DbSession, apply_branch_scope, ensure_same_branch, require_roles
from app.models import Group, Performance, RoleName, Trainee
from app.schemas.api import PerformanceCreate, PerformanceResponse, PerformanceUpdate
from app.services.audit import write_audit
from app.services.cache import cache_delete, cache_get_json, cache_set_json

router = APIRouter()
PERFORMANCE_LIST_CACHE_TTL_SECONDS = 60


def _performance_list_cache_key(branch_id: str) -> str:
    return f"performance:list:{branch_id}:v1"


def _dashboard_kpi_cache_key(branch_id: str, year: int) -> str:
    return f"dashboard:kpi:{branch_id}:{year}"


def _current_plan_year() -> int:
    return datetime.now(timezone.utc).year


def _invalidate_performance_caches(branch_id: str) -> None:
    cache_delete(_performance_list_cache_key(branch_id))
    cache_delete(_dashboard_kpi_cache_key(branch_id, _current_plan_year()))


@router.get("", response_model=list[PerformanceResponse])
def list_performance(
    db: DbSession,
    current_user: CurrentUser,
    group_id: int | None = Query(default=None),
    trainee_id: int | None = Query(default=None),
) -> list[PerformanceResponse]:
    can_use_cache = group_id is None and trainee_id is None
    cache_key = _performance_list_cache_key(current_user.branch_id)
    if can_use_cache:
        cached = cache_get_json(cache_key)
        if isinstance(cached, list):
            return [PerformanceResponse.model_validate(item) for item in cached]

    query = apply_branch_scope(db.query(Performance), Performance, current_user.branch_id)

    if group_id is not None:
        group = db.get(Group, group_id)
        if not group:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Групу не знайдено")
        ensure_same_branch(current_user, group, "Групу")
        query = query.filter(Performance.group_id == group_id)

    if trainee_id is not None:
        trainee = db.get(Trainee, trainee_id)
        if not trainee:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Слухача не знайдено")
        ensure_same_branch(current_user, trainee, "Слухача")
        query = query.filter(Performance.trainee_id == trainee_id)

    rows = query.order_by(Performance.updated_at.desc()).all()
    response = [PerformanceResponse.model_validate(item) for item in rows]
    if can_use_cache:
        cache_set_json(cache_key, [item.model_dump(mode="json") for item in response], PERFORMANCE_LIST_CACHE_TTL_SECONDS)
    return response


@router.post(
    "",
    response_model=PerformanceResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST, RoleName.TEACHER))],
)
def create_performance(payload: PerformanceCreate, db: DbSession, current_user: CurrentUser) -> PerformanceResponse:
    trainee = db.get(Trainee, payload.trainee_id)
    group = db.get(Group, payload.group_id)
    if not trainee or not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Слухача або групу не знайдено")
    ensure_same_branch(current_user, trainee, "Слухача")
    ensure_same_branch(current_user, group, "Групу")

    existing = (
        apply_branch_scope(db.query(Performance), Performance, current_user.branch_id)
        .filter(Performance.trainee_id == payload.trainee_id, Performance.group_id == payload.group_id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Запис успішності для цієї пари вже існує")

    entity = Performance(
        branch_id=current_user.branch_id,
        trainee_id=payload.trainee_id,
        group_id=payload.group_id,
        progress_pct=payload.progress_pct,
        attendance_pct=payload.attendance_pct,
        employment_flag=payload.employment_flag,
    )
    db.add(entity)
    db.commit()
    db.refresh(entity)
    _invalidate_performance_caches(current_user.branch_id)

    write_audit(
        db,
        actor_user_id=current_user.id,
        action="performance.create",
        entity_type="performance",
        entity_id=str(entity.id),
    )
    return PerformanceResponse.model_validate(entity)


@router.put(
    "/{performance_id}",
    response_model=PerformanceResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST, RoleName.TEACHER))],
)
def update_performance(
    performance_id: int,
    payload: PerformanceUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> PerformanceResponse:
    entity = db.get(Performance, performance_id)
    if not entity:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запис успішності не знайдено")
    ensure_same_branch(current_user, entity, "Запис успішності")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(entity, field, value)
    db.add(entity)
    db.commit()
    db.refresh(entity)
    _invalidate_performance_caches(current_user.branch_id)

    write_audit(
        db,
        actor_user_id=current_user.id,
        action="performance.update",
        entity_type="performance",
        entity_id=str(entity.id),
    )
    return PerformanceResponse.model_validate(entity)


@router.delete(
    "/{performance_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def delete_performance(performance_id: int, db: DbSession, current_user: CurrentUser) -> None:
    entity = db.get(Performance, performance_id)
    if not entity:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запис успішності не знайдено")
    ensure_same_branch(current_user, entity, "Запис успішності")
    branch_id = entity.branch_id
    db.delete(entity)
    db.commit()
    _invalidate_performance_caches(branch_id)
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="performance.delete",
        entity_type="performance",
        entity_id=str(performance_id),
    )
