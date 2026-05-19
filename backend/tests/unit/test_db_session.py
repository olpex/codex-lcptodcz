from sqlalchemy.pool import NullPool

from app.db.session import build_engine_kwargs


def test_vercel_postgres_uses_null_pool_to_release_serverless_connections():
    kwargs = build_engine_kwargs("postgresql+psycopg2://user:pass@example.com/db", is_vercel=True)

    assert kwargs["poolclass"] is NullPool
    assert kwargs["pool_pre_ping"] is True


def test_non_vercel_postgres_keeps_default_sqlalchemy_pool():
    kwargs = build_engine_kwargs("postgresql+psycopg2://user:pass@example.com/db", is_vercel=False)

    assert "poolclass" not in kwargs


def test_sqlite_keeps_thread_check_disabled_for_tests():
    kwargs = build_engine_kwargs("sqlite:///tmp/test.db", is_vercel=True)

    assert kwargs["connect_args"] == {"check_same_thread": False}
    assert "poolclass" not in kwargs
