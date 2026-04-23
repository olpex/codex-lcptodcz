import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", f"sqlite:///{(Path(__file__).parent / 'test.db').as_posix()}")
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATA_ENCRYPTION_KEY", "")
os.environ.setdefault("FILE_STORAGE_PATH", (Path(__file__).parent / "_storage").as_posix())
os.environ.setdefault("INITIAL_ADMIN_USERNAME", "admin")
os.environ.setdefault("INITIAL_ADMIN_PASSWORD", "Admin123!")

from app.db.session import Base, SessionLocal, engine  # noqa: E402
from app.main import app, seed_reference_data  # noqa: E402


@pytest.fixture
def db_session():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    seed_reference_data(session)
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db_session):
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def auth_headers(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "Admin123!"},
    )
    assert response.status_code == 200
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
