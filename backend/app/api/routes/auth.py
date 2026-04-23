from datetime import datetime, timezone
from hmac import compare_digest

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy.exc import SQLAlchemyError

from app.api.deps import CurrentUser, DbSession, request_meta, revoke_refresh_token
from app.core.config import settings
from app.core.security import create_access_token, create_refresh_token, decode_token, hash_password, verify_password
from app.models import RefreshToken, User
from app.schemas.api import (
    AdminResetPasswordRequest,
    ChangePasswordRequest,
    LoginRequest,
    MessageResponse,
    RefreshRequest,
    TokenPairResponse,
    UserResponse,
)
from app.services.audit import write_audit

router = APIRouter()


@router.post("/login", response_model=TokenPairResponse)
def login(payload: LoginRequest, request: Request, db: DbSession) -> TokenPairResponse:
    try:
        user = db.query(User).filter(User.username == payload.username).first()
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="База даних недоступна. Перевірте DATABASE_URL.",
        ) from exc
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Невірний логін або пароль")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Користувач деактивований")

    role_names = [role.name.value for role in user.roles]
    access_token, _, = create_access_token(str(user.id), {"roles": role_names})
    refresh_token, refresh_expires_at, jti = create_refresh_token(str(user.id))
    user_agent, ip = request_meta(request)
    token_row = RefreshToken(
        user_id=user.id,
        jti=jti,
        expires_at=refresh_expires_at,
        user_agent=user_agent,
        ip_address=ip,
    )
    db.add(token_row)
    db.commit()

    write_audit(
        db,
        actor_user_id=user.id,
        action="auth.login",
        entity_type="user",
        entity_id=str(user.id),
        details={"ip": ip},
    )
    return TokenPairResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", response_model=TokenPairResponse)
def refresh(payload: RefreshRequest, request: Request, db: DbSession) -> TokenPairResponse:
    try:
        token_payload = decode_token(payload.refresh_token)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Недійсний refresh token") from exc

    if token_payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Очікується refresh token")

    jti = token_payload.get("jti")
    user_id = token_payload.get("sub")
    if not jti or not user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Refresh token без jti/sub")

    token_row = db.query(RefreshToken).filter(RefreshToken.jti == jti).first()
    if not token_row or token_row.revoked_at is not None or token_row.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token відкликано або прострочено")

    user = db.get(User, int(user_id))
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Користувач неактивний")

    token_row.revoked_at = datetime.now(timezone.utc)
    db.add(token_row)

    role_names = [role.name.value for role in user.roles]
    access_token, _ = create_access_token(str(user.id), {"roles": role_names})
    refresh_token, refresh_expires_at, new_jti = create_refresh_token(str(user.id))
    user_agent, ip = request_meta(request)
    db.add(
        RefreshToken(
            user_id=user.id,
            jti=new_jti,
            expires_at=refresh_expires_at,
            user_agent=user_agent,
            ip_address=ip,
        )
    )
    db.commit()

    write_audit(
        db,
        actor_user_id=user.id,
        action="auth.refresh",
        entity_type="user",
        entity_id=str(user.id),
    )
    return TokenPairResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(payload: RefreshRequest, current_user: CurrentUser, db: DbSession) -> None:
    revoke_refresh_token(db, payload.refresh_token)
    db.commit()
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="auth.logout",
        entity_type="user",
        entity_id=str(current_user.id),
    )


@router.get("/me", response_model=UserResponse)
def me(current_user: CurrentUser) -> UserResponse:
    return UserResponse.model_validate(current_user)


@router.post("/admin-reset-password", response_model=MessageResponse)
def admin_reset_password(payload: AdminResetPasswordRequest, request: Request, db: DbSession) -> MessageResponse:
    configured_reset_token = settings.admin_password_reset_token.strip()
    if not configured_reset_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Скидання пароля не налаштовано. Вкажіть ADMIN_PASSWORD_RESET_TOKEN.",
        )

    if not compare_digest(payload.reset_token, configured_reset_token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Невірний токен скидання")

    target_username = payload.username.strip()
    if target_username != settings.initial_admin_username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Дозволено скидання лише для користувача {settings.initial_admin_username}",
        )

    target_user = db.query(User).filter(User.username == target_username).first()
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Користувач не знайдений")

    target_user.password_hash = hash_password(payload.new_password)
    db.add(target_user)

    active_refresh_tokens = (
        db.query(RefreshToken)
        .filter(RefreshToken.user_id == target_user.id, RefreshToken.revoked_at.is_(None))
        .all()
    )
    for token in active_refresh_tokens:
        token.revoked_at = datetime.now(timezone.utc)
        db.add(token)

    db.commit()
    user_agent, ip = request_meta(request)
    write_audit(
        db,
        actor_user_id=None,
        action="auth.admin_reset_password",
        entity_type="user",
        entity_id=str(target_user.id),
        details={"username": target_username, "ip": ip, "user_agent": user_agent},
    )
    return MessageResponse(message="Пароль адміністратора скинуто. Увійдіть з новим паролем.")


@router.post("/change-password", response_model=MessageResponse)
def change_password(payload: ChangePasswordRequest, current_user: CurrentUser, db: DbSession) -> MessageResponse:
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Поточний пароль невірний")
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Новий пароль має відрізнятися від поточного")

    current_user.password_hash = hash_password(payload.new_password)
    db.add(current_user)

    active_refresh_tokens = (
        db.query(RefreshToken)
        .filter(RefreshToken.user_id == current_user.id, RefreshToken.revoked_at.is_(None))
        .all()
    )
    for token in active_refresh_tokens:
        token.revoked_at = datetime.now(timezone.utc)
        db.add(token)

    db.commit()
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="auth.change_password",
        entity_type="user",
        entity_id=str(current_user.id),
    )
    return MessageResponse(message="Пароль успішно змінено")
