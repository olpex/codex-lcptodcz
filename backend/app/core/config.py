from functools import lru_cache
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = Field(default="СУПТЦ")
    api_v1_prefix: str = Field(default="/api/v1")

    secret_key: str = Field(default="change-this-secret")
    access_token_expire_minutes: int = Field(default=60)
    refresh_token_expire_minutes: int = Field(default=60 * 24 * 7)
    jwt_algorithm: str = Field(default="HS256")

    database_url: str = Field(default="postgresql+psycopg2://suptc:suptc@postgres:5432/suptc")
    redis_url: str = Field(default="redis://redis:6379/0")

    data_encryption_key: str = Field(default="replace-with-fernet-key")
    file_storage_path: str = Field(default="/data/documents")

    imap_host: str = Field(default="")
    imap_port: int = Field(default=993)
    imap_user: str = Field(default="")
    imap_password: str = Field(default="")
    imap_mailbox: str = Field(default="INBOX")
    imap_branch_id: str = Field(default="main")
    imap_auto_poll_enabled: bool = Field(default=False)
    imap_poll_interval_seconds: int = Field(default=300)
    imap_allowed_senders: str = Field(default="")
    imap_contract_sender_name: str = Field(default="Львівський центр ПТО ДСЗ")
    imap_contract_sender_email: str = Field(default="lcptodcz@gmail.com")
    imap_contract_attachment_prefix: str = Field(default="Договори")
    imap_contract_update_mode: str = Field(default="overwrite")
    cron_secret: str = Field(default="")
    mail_webhook_secret: str = Field(default="")

    smtp_host: str = Field(default="")
    smtp_port: int = Field(default=587)
    smtp_user: str = Field(default="")
    smtp_password: str = Field(default="")

    ocr_language: str = Field(default="ukr+eng")
    tesseract_cmd: str = Field(default="")
    openai_api_key: str = Field(default="")
    openai_model: str = Field(default="gpt-4o-mini")
    openai_ocr_enabled: bool = Field(default=False)
    google_drive_api_key: str = Field(default="")
    google_drive_service_account_json: str = Field(default="")

    cors_origins: str = Field(default="http://localhost:5173,http://127.0.0.1:5173")

    initial_admin_username: str = Field(default="admin")
    initial_admin_password: str = Field(default="Admin123!")
    initial_admin_full_name: str = Field(default="Системний адміністратор")
    admin_password_reset_token: str = Field(default="")

    @property
    def cors_origins_list(self) -> List[str]:
        return [part.strip() for part in self.cors_origins.split(",") if part.strip()]

    @property
    def imap_allowed_senders_list(self) -> List[str]:
        return [part.strip().lower() for part in self.imap_allowed_senders.split(",") if part.strip()]

    @property
    def imap_contract_sender_name_normalized(self) -> str:
        return self.imap_contract_sender_name.strip().lower()

    @property
    def imap_contract_sender_email_normalized(self) -> str:
        return self.imap_contract_sender_email.strip().lower()


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
