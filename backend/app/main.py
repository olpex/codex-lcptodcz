from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.api.middleware import RBACContextMiddleware
from app.api.router import api_router
from app.core.config import settings
from app.core.security import hash_password
from app.db.session import Base, SessionLocal, engine
from app.models import Role, RoleName, Room, Subject, User
from app.services.storage import storage_path


def ensure_runtime_schema() -> None:
    """
    Minimal runtime schema alignment for already-deployed databases
    when Alembic migrations are not available in MVP.
    """
    with engine.begin() as conn:
        inspector = inspect(conn)
        existing_tables = set(inspector.get_table_names())
        column_plan = [
            ("import_jobs", "branch_id", "VARCHAR(50) NOT NULL DEFAULT 'main'"),
            ("export_jobs", "branch_id", "VARCHAR(50) NOT NULL DEFAULT 'main'"),
            ("mail_messages", "branch_id", "VARCHAR(50) NOT NULL DEFAULT 'main'"),
            ("ocr_results", "branch_id", "VARCHAR(50) NOT NULL DEFAULT 'main'"),
            ("performances", "branch_id", "VARCHAR(50) NOT NULL DEFAULT 'main'"),
            ("teachers", "annual_load_hours", "FLOAT NOT NULL DEFAULT 0.0"),
            ("schedule_slots", "pair_number", "INTEGER NULL"),
            ("schedule_slots", "academic_hours", "FLOAT NOT NULL DEFAULT 2.0"),
            ("trainees", "source_row_number", "INTEGER NULL"),
            ("trainees", "employment_center_encrypted", "TEXT NULL"),
            ("trainees", "contract_number", "VARCHAR(120) NULL"),
            ("trainees", "certificate_number", "VARCHAR(120) NULL"),
            ("trainees", "certificate_issue_date", "DATE NULL"),
            ("trainees", "postal_index", "VARCHAR(20) NULL"),
            ("trainees", "address_encrypted", "TEXT NULL"),
            ("trainees", "passport_series_encrypted", "TEXT NULL"),
            ("trainees", "passport_number_encrypted", "TEXT NULL"),
            ("trainees", "passport_issued_by_encrypted", "TEXT NULL"),
            ("trainees", "passport_issued_date", "DATE NULL"),
            ("trainees", "tax_id_encrypted", "TEXT NULL"),
            ("trainees", "group_code", "VARCHAR(50) NULL"),
        ]
        for table_name, column_name, ddl in column_plan:
            if table_name not in existing_tables:
                continue
            current_columns = {column["name"] for column in inspector.get_columns(table_name)}
            if column_name in current_columns:
                continue
            conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl}"))


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
        ensure_runtime_schema()
        storage_path()
        db = SessionLocal()
        try:
            seed_reference_data(db)
        finally:
            db.close()

    return app


app = create_app()
