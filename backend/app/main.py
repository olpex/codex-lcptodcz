from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.api.middleware import RBACContextMiddleware
from app.api.router import api_router
from app.core.config import settings
from app.core.security import hash_password
from app.db.session import Base, SessionLocal, engine
from app.models import Role, RoleName, Room, Subject, Teacher, User


def seed_reference_data(db: Session) -> None:
    role_names = [RoleName.ADMIN, RoleName.METHODIST, RoleName.TEACHER]
    existing_roles = {role.name for role in db.query(Role).all()}
    for role_name in role_names:
        if role_name not in existing_roles:
            db.add(Role(name=role_name))
    db.commit()

    admin = db.query(User).filter(User.username == settings.initial_admin_username).first()
    if not admin:
        admin_role = db.query(Role).filter(Role.name == RoleName.ADMIN).one()
        methodist_role = db.query(Role).filter(Role.name == RoleName.METHODIST).one()
        admin = User(
            username=settings.initial_admin_username,
            password_hash=hash_password(settings.initial_admin_password),
            full_name=settings.initial_admin_full_name,
            is_active=True,
            branch_id="main",
            roles=[admin_role, methodist_role],
        )
        db.add(admin)
        db.commit()

    if not db.query(Teacher).first():
        db.add_all(
            [
                Teacher(first_name="Олена", last_name="Коваль", hourly_rate=240),
                Teacher(first_name="Іван", last_name="Сидоренко", hourly_rate=220),
            ]
        )
    if not db.query(Subject).first():
        db.add_all(
            [
                Subject(name="Охорона праці", hours_total=40),
                Subject(name="Професійні компетентності", hours_total=120),
            ]
        )
    if not db.query(Room).first():
        db.add_all(
            [
                Room(name="Аудиторія 101", capacity=30),
                Room(name="Лабораторія 1", capacity=20),
            ]
        )
    db.commit()


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        docs_url="/docs",
        redoc_url="/redoc",
    )
    app.add_middleware(RBACContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_router, prefix=settings.api_v1_prefix)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.on_event("startup")
    def startup() -> None:
        Base.metadata.create_all(bind=engine)
        Path(settings.file_storage_path).mkdir(parents=True, exist_ok=True)
        db = SessionLocal()
        try:
            seed_reference_data(db)
        finally:
            db.close()

    return app


app = create_app()
