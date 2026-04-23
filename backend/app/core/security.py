from datetime import datetime, timedelta, timezone
from typing import Any, Dict
from uuid import uuid4

from jose import jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_access_token(subject: str, extra_claims: Dict[str, Any] | None = None) -> tuple[str, datetime]:
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload: Dict[str, Any] = {
        "sub": subject,
        "type": "access",
        "exp": expires_at,
        "iat": datetime.now(timezone.utc),
    }
    if extra_claims:
        payload.update(extra_claims)
    token = jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)
    return token, expires_at


def create_refresh_token(subject: str, jti: str | None = None) -> tuple[str, datetime, str]:
    token_id = jti or str(uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.refresh_token_expire_minutes)
    payload = {
        "sub": subject,
        "type": "refresh",
        "jti": token_id,
        "exp": expires_at,
        "iat": datetime.now(timezone.utc),
    }
    token = jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)
    return token, expires_at, token_id


def decode_token(token: str) -> Dict[str, Any]:
    return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])

