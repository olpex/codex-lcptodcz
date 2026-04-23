from collections.abc import Callable
from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.db.session import get_db
from app.models import RefreshToken, RoleName, User

security = HTTPBearer(auto_error=False)

DbSession = Annotated[Session, Depends(get_db)]


def get_current_user(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
) -> User:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Відсутній токен доступу")
    try:
        payload = decode_token(credentials.credentials)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Недійсний токен") from exc

    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Некоректний тип токена")
    user_id = payload.get("sub")
    user = db.get(User, int(user_id)) if user_id else None
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Користувач не знайдений або неактивний")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*allowed_roles: RoleName) -> Callable:
    allowed = {role.value if isinstance(role, RoleName) else str(role) for role in allowed_roles}

    def _checker(current_user: CurrentUser) -> User:
        current_roles = {role.name.value for role in current_user.roles}
        if not current_roles.intersection(allowed):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостатньо прав доступу")
        return current_user

    return _checker


def revoke_refresh_token(db: Session, token_value: str) -> None:
    payload = decode_token(token_value)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Некоректний refresh token")
    jti = payload.get("jti")
    if not jti:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Немає jti у refresh token")
    refresh = db.query(RefreshToken).filter(RefreshToken.jti == jti).first()
    if not refresh:
        return
    refresh.revoked_at = datetime.now(timezone.utc)
    db.add(refresh)


def request_meta(request: Request) -> tuple[str | None, str | None]:
    user_agent = request.headers.get("user-agent")
    forwarded_for = request.headers.get("x-forwarded-for")
    ip = forwarded_for.split(",")[0].strip() if forwarded_for else request.client.host if request.client else None
    return user_agent, ip

