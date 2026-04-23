import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


class DataCipher:
    def __init__(self) -> None:
        self._fernet = Fernet(self._resolve_key(settings.data_encryption_key))

    @staticmethod
    def _resolve_key(raw_key: str) -> bytes:
        if raw_key:
            try:
                candidate = raw_key.encode()
                Fernet(candidate)
                return candidate
            except Exception:
                pass
        # Fallback keeps app bootable in dev/test without manual key generation.
        digest = hashlib.sha256(settings.secret_key.encode()).digest()
        return base64.urlsafe_b64encode(digest)

    def encrypt(self, value: str | None) -> str | None:
        if not value:
            return None
        try:
            return self._fernet.encrypt(value.encode()).decode()
        except Exception:
            return None

    def decrypt(self, value: str | None) -> str | None:
        if not value:
            return None
        try:
            return self._fernet.decrypt(value.encode()).decode()
        except (InvalidToken, Exception):
            return None


cipher = DataCipher()
