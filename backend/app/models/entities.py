from datetime import date, datetime, timezone
from enum import Enum

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class RoleName(str, Enum):
    ADMIN = "admin"
    METHODIST = "methodist"
    TEACHER = "teacher"


class GroupStatus(str, Enum):
    PLANNED = "planned"
    ACTIVE = "active"
    COMPLETED = "completed"


class MembershipStatus(str, Enum):
    ACTIVE = "active"
    EXPELLED = "expelled"


class OrderType(str, Enum):
    ENROLLMENT = "enrollment"
    EXPULSION = "expulsion"
    INTERNAL = "internal"


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class DocumentType(str, Enum):
    XLSX = "xlsx"
    PDF = "pdf"
    DOCX = "docx"
    CSV = "csv"
    OTHER = "other"


class DraftStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class MailStatus(str, Enum):
    NEW = "new"
    PROCESSED = "processed"


class UserRole(Base):
    __tablename__ = "user_roles"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"), primary_key=True)


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[RoleName] = mapped_column(SAEnum(RoleName, native_enum=False), unique=True, nullable=False)

    users: Mapped[list["User"]] = relationship(
        secondary="user_roles",
        back_populates="roles",
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    branch_id: Mapped[str] = mapped_column(String(50), default="main", nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    roles: Mapped[list[Role]] = relationship(secondary="user_roles", back_populates="users")
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(back_populates="user")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    jti: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    user: Mapped[User] = relationship(back_populates="refresh_tokens")


class Trainee(Base):
    __tablename__ = "trainees"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    branch_id: Mapped[str] = mapped_column(String(50), default="main", nullable=False, index=True)
    first_name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    last_name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="active", nullable=False)
    phone_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    email_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    id_document_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    memberships: Mapped[list["GroupMembership"]] = relationship(back_populates="trainee")
    performances: Mapped[list["Performance"]] = relationship(back_populates="trainee")


class Group(Base):
    __tablename__ = "groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    branch_id: Mapped[str] = mapped_column(String(50), default="main", nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, default=25, nullable=False)
    status: Mapped[GroupStatus] = mapped_column(
        SAEnum(GroupStatus, native_enum=False),
        default=GroupStatus.PLANNED,
        nullable=False,
    )
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    memberships: Mapped[list["GroupMembership"]] = relationship(back_populates="group")
    schedule_slots: Mapped[list["ScheduleSlot"]] = relationship(back_populates="group")
    performances: Mapped[list["Performance"]] = relationship(back_populates="group")


class GroupMembership(Base):
    __tablename__ = "group_memberships"
    __table_args__ = (
        UniqueConstraint("group_id", "trainee_id", name="uq_group_trainee"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id"), nullable=False, index=True)
    trainee_id: Mapped[int] = mapped_column(ForeignKey("trainees.id"), nullable=False, index=True)
    status: Mapped[MembershipStatus] = mapped_column(
        SAEnum(MembershipStatus, native_enum=False),
        default=MembershipStatus.ACTIVE,
        nullable=False,
    )
    enrolled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    expelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expulsion_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    group: Mapped[Group] = relationship(back_populates="memberships")
    trainee: Mapped[Trainee] = relationship(back_populates="memberships")


class Teacher(Base):
    __tablename__ = "teachers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    branch_id: Mapped[str] = mapped_column(String(50), default="main", nullable=False, index=True)
    first_name: Mapped[str] = mapped_column(String(120), nullable=False)
    last_name: Mapped[str] = mapped_column(String(120), nullable=False)
    hourly_rate: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    schedule_slots: Mapped[list["ScheduleSlot"]] = relationship(back_populates="teacher")


class Subject(Base):
    __tablename__ = "subjects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    branch_id: Mapped[str] = mapped_column(String(50), default="main", nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    hours_total: Mapped[int] = mapped_column(Integer, default=72, nullable=False)

    schedule_slots: Mapped[list["ScheduleSlot"]] = relationship(back_populates="subject")


class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    branch_id: Mapped[str] = mapped_column(String(50), default="main", nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    capacity: Mapped[int] = mapped_column(Integer, default=30, nullable=False)

    schedule_slots: Mapped[list["ScheduleSlot"]] = relationship(back_populates="room")


class ScheduleSlot(Base):
    __tablename__ = "schedule_slots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id"), nullable=False, index=True)
    teacher_id: Mapped[int] = mapped_column(ForeignKey("teachers.id"), nullable=False, index=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"), nullable=False, index=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"), nullable=False, index=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    generated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    group: Mapped[Group] = relationship(back_populates="schedule_slots")
    teacher: Mapped[Teacher] = relationship(back_populates="schedule_slots")
    subject: Mapped[Subject] = relationship(back_populates="schedule_slots")
    room: Mapped[Room] = relationship(back_populates="schedule_slots")


class Performance(Base):
    __tablename__ = "performances"
    __table_args__ = (
        UniqueConstraint("trainee_id", "group_id", name="uq_performance_trainee_group"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trainee_id: Mapped[int] = mapped_column(ForeignKey("trainees.id"), nullable=False, index=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id"), nullable=False, index=True)
    progress_pct: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    attendance_pct: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    employment_flag: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    trainee: Mapped[Trainee] = relationship(back_populates="performances")
    group: Mapped[Group] = relationship(back_populates="performances")


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    branch_id: Mapped[str] = mapped_column(String(50), default="main", nullable=False, index=True)
    order_number: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    order_type: Mapped[OrderType] = mapped_column(
        SAEnum(OrderType, native_enum=False),
        default=OrderType.INTERNAL,
        nullable=False,
    )
    order_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="draft", nullable=False)
    payload_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    branch_id: Mapped[str] = mapped_column(String(50), default="main", nullable=False, index=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    file_type: Mapped[DocumentType] = mapped_column(
        SAEnum(DocumentType, native_enum=False),
        default=DocumentType.OTHER,
        nullable=False,
    )
    source: Mapped[str] = mapped_column(String(50), default="upload", nullable=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    hash_sha256: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class ImportJob(Base):
    __tablename__ = "import_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    idempotency_key: Mapped[str] = mapped_column(String(150), unique=True, nullable=False, index=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"), nullable=False, index=True)
    status: Mapped[JobStatus] = mapped_column(
        SAEnum(JobStatus, native_enum=False),
        default=JobStatus.QUEUED,
        nullable=False,
    )
    message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    result_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    retries: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    document: Mapped[Document] = relationship()


class ExportJob(Base):
    __tablename__ = "export_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    idempotency_key: Mapped[str] = mapped_column(String(150), unique=True, nullable=False, index=True)
    report_type: Mapped[str] = mapped_column(String(100), nullable=False)
    export_format: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[JobStatus] = mapped_column(
        SAEnum(JobStatus, native_enum=False),
        default=JobStatus.QUEUED,
        nullable=False,
    )
    message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    result_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    output_document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id"), nullable=True)
    retries: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    output_document: Mapped[Document | None] = relationship()


class MailMessage(Base):
    __tablename__ = "mail_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    message_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    sender: Mapped[str] = mapped_column(String(255), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    snippet: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[MailStatus] = mapped_column(
        SAEnum(MailStatus, native_enum=False),
        default=MailStatus.NEW,
        nullable=False,
    )
    raw_document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class OCRResult(Base):
    __tablename__ = "ocr_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"), nullable=False, index=True)
    extracted_text: Mapped[str] = mapped_column(Text, nullable=False)
    structured_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    draft_type: Mapped[str] = mapped_column(String(50), default="trainee_card", nullable=False)
    status: Mapped[DraftStatus] = mapped_column(
        SAEnum(DraftStatus, native_enum=False),
        default=DraftStatus.PENDING,
        nullable=False,
    )
    confidence: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(100), nullable=False)
    details_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

