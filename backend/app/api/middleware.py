from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.security import decode_token


class RBACContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request.state.user_id = None
        request.state.user_roles = []
        header = request.headers.get("authorization")
        if header and header.lower().startswith("bearer "):
            token = header.split(" ", 1)[1]
            try:
                payload = decode_token(token)
                if payload.get("type") == "access":
                    request.state.user_id = payload.get("sub")
                    request.state.user_roles = payload.get("roles", [])
            except Exception:
                pass
        return await call_next(request)

