from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


class DataCipher:
    def __init__(self) -> None:
        self._fernet = Fernet(settings.data_encryption_key.encode())

    def encrypt(self, value: str | None) -> str | None:
        if not value:
            return None
        return self._fernet.encrypt(value.encode()).decode()

    def decrypt(self, value: str | None) -> str | None:
        if not value:
            return None
        try:
            return self._fernet.decrypt(value.encode()).decode()
        except InvalidToken:
            return None


cipher = DataCipher()

