from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import CurrentUser, DbSession, require_roles
from app.models import Order, RoleName
from app.schemas.api import OrderCreate, OrderResponse, OrderUpdate
from app.services.audit import write_audit

router = APIRouter()


@router.get("", response_model=list[OrderResponse])
def list_orders(db: DbSession, _: CurrentUser) -> list[OrderResponse]:
    orders = db.query(Order).order_by(Order.created_at.desc()).all()
    return [OrderResponse.model_validate(order) for order in orders]


@router.post(
    "",
    response_model=OrderResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def create_order(payload: OrderCreate, db: DbSession, current_user: CurrentUser) -> OrderResponse:
    order = Order(**payload.model_dump(), created_by=current_user.id)
    db.add(order)
    db.commit()
    db.refresh(order)
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="order.create",
        entity_type="order",
        entity_id=str(order.id),
    )
    return OrderResponse.model_validate(order)


@router.put(
    "/{order_id}",
    response_model=OrderResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def update_order(order_id: int, payload: OrderUpdate, db: DbSession, current_user: CurrentUser) -> OrderResponse:
    order = db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Наказ не знайдено")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(order, key, value)
    db.add(order)
    db.commit()
    db.refresh(order)
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="order.update",
        entity_type="order",
        entity_id=str(order.id),
    )
    return OrderResponse.model_validate(order)


@router.delete(
    "/{order_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def delete_order(order_id: int, db: DbSession, current_user: CurrentUser) -> None:
    order = db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Наказ не знайдено")
    db.delete(order)
    db.commit()
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="order.delete",
        entity_type="order",
        entity_id=str(order_id),
    )

