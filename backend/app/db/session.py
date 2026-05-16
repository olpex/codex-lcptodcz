import os
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import NullPool

from app.core.config import settings


def build_engine_kwargs(database_url: str, *, is_vercel: bool | None = None) -> dict[str, object]:
    engine_kwargs: dict[str, object] = {"pool_pre_ping": True}
    running_on_vercel = os.getenv("VERCEL") == "1" if is_vercel is None else is_vercel
    if database_url.startswith("sqlite"):
        engine_kwargs["connect_args"] = {"check_same_thread": False}
    elif running_on_vercel:
        engine_kwargs["poolclass"] = NullPool
    return engine_kwargs


engine_kwargs = build_engine_kwargs(settings.database_url)

engine = create_engine(settings.database_url, **engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
