from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.entities import DraftStatus, GroupStatus, JobStatus, MailStatus, MembershipStatus, OrderType


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class LoginRequest(BaseModel):
    username: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=72)
    new_password: str = Field(min_length=8, max_length=72)


class AdminResetPasswordRequest(BaseModel):
    username: str = Field(min_length=1, max_length=100, default="admin")
    reset_token: str = Field(min_length=1, max_length=255)
    new_password: str = Field(min_length=8, max_length=72)


class MessageResponse(BaseModel):
    message: str


class TokenPairResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RoleResponse(ORMModel):
    id: int
    name: str


class UserResponse(ORMModel):
    id: int
    username: str
    full_name: str
    branch_id: str
    roles: list[RoleResponse]


class TraineeBase(BaseModel):
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(min_length=1, max_length=120)
    source_row_number: int | None = Field(default=None, ge=1)
    employment_center: str | None = None
    birth_date: date | None = None
    contract_number: str | None = None
    certificate_number: str | None = None
    certificate_issue_date: date | None = None
    postal_index: str | None = None
    address: str | None = None
    passport_series: str | None = None
    passport_number: str | None = None
    passport_issued_by: str | None = None
    passport_issued_date: date | None = None
    tax_id: str | None = None
    group_code: str | None = None
    phone: str | None = None
    email: EmailStr | None = None
    id_document: str | None = None
    status: str = "active"


class TraineeCreate(TraineeBase):
    pass


class TraineeUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    source_row_number: int | None = Field(default=None, ge=1)
    employment_center: str | None = None
    birth_date: date | None = None
    contract_number: str | None = None
    certificate_number: str | None = None
    certificate_issue_date: date | None = None
    postal_index: str | None = None
    address: str | None = None
    passport_series: str | None = None
    passport_number: str | None = None
    passport_issued_by: str | None = None
    passport_issued_date: date | None = None
    tax_id: str | None = None
    group_code: str | None = None
    phone: str | None = None
    email: EmailStr | None = None
    id_document: str | None = None
    status: str | None = None


class TraineeResponse(ORMModel):
    id: int
    branch_id: str
    source_row_number: int | None
    first_name: str
    last_name: str
    employment_center: str | None
    birth_date: date | None
    contract_number: str | None
    certificate_number: str | None
    certificate_issue_date: date | None
    postal_index: str | None
    address: str | None
    passport_series: str | None
    passport_number: str | None
    passport_issued_by: str | None
    passport_issued_date: date | None
    tax_id: str | None
    group_code: str | None
    status: str
    is_deleted: bool = False
    deleted_at: datetime | None = None
    phone: str | None
    email: str | None
    id_document: str | None
    created_at: datetime
    updated_at: datetime


class TraineeBulkGroupUpdateRequest(BaseModel):
    trainee_ids: list[int] = Field(min_length=1, max_length=500)
    group_code: str | None = Field(default=None, max_length=50)


class TraineeBulkGroupUpdateResponse(BaseModel):
    updated_count: int
    updated_ids: list[int]
    group_code: str | None


class TraineeBulkStatusUpdateRequest(BaseModel):
    trainee_ids: list[int] = Field(min_length=1, max_length=500)
    status: str = Field(pattern="^(active|completed|expelled)$")


class TraineeBulkStatusUpdateResponse(BaseModel):
    updated_count: int
    updated_ids: list[int]
    status: str


class TraineeBulkDeleteRequest(BaseModel):
    trainee_ids: list[int] = Field(min_length=1, max_length=500)


class TraineeBulkDeleteResponse(BaseModel):
    deleted_count: int
    deleted_ids: list[int]


class TraineeBulkRestoreRequest(BaseModel):
    trainee_ids: list[int] = Field(min_length=1, max_length=500)


class TraineeBulkRestoreResponse(BaseModel):
    restored_count: int
    restored_ids: list[int]


class TraineeClearOrphanGroupsResponse(BaseModel):
    cleared_count: int
    cleared_ids: list[int]


class GroupBase(BaseModel):
    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=255)
    capacity: int = Field(default=25, ge=1, le=200)
    status: GroupStatus = GroupStatus.PLANNED
    start_date: date | None = None
    end_date: date | None = None


class GroupCreate(GroupBase):
    pass


class GroupUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    capacity: int | None = Field(default=None, ge=1, le=200)
    status: GroupStatus | None = None
    start_date: date | None = None
    end_date: date | None = None


class GroupResponse(ORMModel):
    id: int
    branch_id: str
    code: str
    name: str
    capacity: int
    status: GroupStatus
    start_date: date | None
    end_date: date | None
    created_at: datetime


class GroupTeacherHoursResponse(BaseModel):
    teacher_id: int
    teacher_name: str
    hours: float


class ActiveGroupBetweenDatesResponse(BaseModel):
    group_id: int
    code: str
    name: str
    training_start_date: date | None = None
    training_end_date: date | None = None
    period_start_date: date
    period_end_date: date
    total_hours: float
    teachers: list[GroupTeacherHoursResponse]


class EnrollRequest(BaseModel):
    trainee_id: int


class ExpelRequest(BaseModel):
    reason: str | None = None


class MembershipResponse(ORMModel):
    id: int
    group_id: int
    trainee_id: int
    status: MembershipStatus
    enrolled_at: datetime
    expelled_at: datetime | None
    expulsion_reason: str | None


class TeacherBase(BaseModel):
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(min_length=1, max_length=120)
    hourly_rate: float = Field(default=0.0, ge=0)
    annual_load_hours: float = Field(default=0.0, ge=0)
    is_active: bool = True


class TeacherCreate(TeacherBase):
    pass


class TeacherUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    hourly_rate: float | None = Field(default=None, ge=0)
    annual_load_hours: float | None = Field(default=None, ge=0)
    is_active: bool | None = None


class TeacherResponse(ORMModel):
    id: int
    branch_id: str
    first_name: str
    last_name: str
    hourly_rate: float
    annual_load_hours: float
    is_active: bool
    created_at: datetime


class OrderBase(BaseModel):
    order_number: str
    order_type: OrderType
    order_date: date
    status: str = "draft"
    payload_json: dict[str, Any] | None = None


class OrderCreate(OrderBase):
    pass


class OrderUpdate(BaseModel):
    order_number: str | None = None
    order_type: OrderType | None = None
    order_date: date | None = None
    status: str | None = None
    payload_json: dict[str, Any] | None = None


class OrderResponse(ORMModel):
    id: int
    branch_id: str
    order_number: str
    order_type: OrderType
    order_date: date
    status: str
    payload_json: dict[str, Any] | None
    created_by: int | None
    created_at: datetime


class ScheduleGenerateRequest(BaseModel):
    start_date: date
    days: int = Field(default=5, ge=1, le=30)


class ScheduleSlotResponse(ORMModel):
    id: int
    group_id: int
    teacher_id: int
    subject_id: int
    room_id: int
    starts_at: datetime
    ends_at: datetime
    pair_number: int | None = None
    academic_hours: float = 0.0
    group_code: str | None = None
    group_name: str | None = None
    group_start_date: date | None = None
    group_end_date: date | None = None
    teacher_name: str | None = None
    subject_name: str | None = None
    room_name: str | None = None
    generated_by: int | None


class ScheduleSlotUpdate(BaseModel):
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    pair_number: int | None = None
    teacher_id: int | None = None
    room_id: int | None = None


class WorkloadResponse(BaseModel):
    teacher_id: int
    row_number: int
    teacher_name: str
    total_hours: float
    annual_load_hours: float
    remaining_hours: float


class DashboardKPIResponse(BaseModel):
    active_groups: int
    active_trainees: int
    facility_load_pct: float
    training_plan_progress_pct: float
    forecast_graduation: int
    forecast_employment: int


class DashboardAttentionItem(BaseModel):
    key: str
    title: str
    count: int
    severity: str
    description: str
    action_href: str


class DashboardAttentionResponse(BaseModel):
    generated_at: datetime
    total_count: int
    items: list[DashboardAttentionItem] = Field(default_factory=list)


class PerformanceBase(BaseModel):
    trainee_id: int
    group_id: int
    progress_pct: float = Field(ge=0, le=100)
    attendance_pct: float = Field(ge=0, le=100)
    employment_flag: bool = False


class PerformanceCreate(PerformanceBase):
    pass


class PerformanceUpdate(BaseModel):
    progress_pct: float | None = Field(default=None, ge=0, le=100)
    attendance_pct: float | None = Field(default=None, ge=0, le=100)
    employment_flag: bool | None = None


class PerformanceResponse(ORMModel):
    id: int
    branch_id: str
    trainee_id: int
    group_id: int
    progress_pct: float
    attendance_pct: float
    employment_flag: bool
    created_at: datetime
    updated_at: datetime


class ExportRequest(BaseModel):
    report_type: str = Field(pattern="^(trainees|teacher_workload|kpi|form_1pa|employment|financial)$")
    export_format: str = Field(pattern="^(xlsx|pdf|csv)$")
    teacher_ids: list[int] | None = None
    start_date: date | None = None
    end_date: date | None = None


class ImportPreviewGroup(BaseModel):
    code: str
    name: str
    start_date: str | None = None
    end_date: str | None = None
    lessons: int = 0
    teachers: int = 0
    subjects: int = 0
    total_hours: float = 0
    already_exists: bool = False
    existing_lessons: int = 0


class ImportDuplicatePreview(BaseModel):
    row_number: int | None = None
    incoming_name: str
    contract_number: str | None = None
    group_code: str | None = None
    existing_id: int
    existing_name: str
    match_reason: str | None = None


class ImportPreviewResponse(BaseModel):
    filename: str
    file_type: str
    import_kind: str
    rows: int = 0
    sheet_name: str | None = None
    headers: list[str] = Field(default_factory=list)
    default_group_code: str | None = None
    default_group_name: str | None = None
    new_count: int = 0
    duplicate_count: int = 0
    invalid_count: int = 0
    groups: list[ImportPreviewGroup] = Field(default_factory=list)
    duplicate_preview: list[ImportDuplicatePreview] = Field(default_factory=list)
    preview: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class JobResponse(ORMModel):
    id: int
    status: JobStatus
    message: str | None
    result_payload: dict[str, Any] | None
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime
    updated_at: datetime


class JobStatusResponse(BaseModel):
    job_type: str
    job: JobResponse


class JobListItemResponse(BaseModel):
    job_type: str
    job: JobResponse
    import_source: str | None = None
    report_type: str | None = None
    export_format: str | None = None
    output_document_id: int | None = None
    document_id: int | None = None
    document_file_name: str | None = None
    output_file_name: str | None = None


class MailMessageResponse(ORMModel):
    id: int
    message_id: str
    sender: str
    subject: str
    received_at: datetime
    snippet: str | None
    status: MailStatus
    raw_document_id: int | None


class DraftResponse(ORMModel):
    id: int
    document_id: int
    draft_type: str
    status: DraftStatus
    confidence: float
    extracted_text: str
    structured_payload: dict[str, Any] | None
    created_at: datetime


class DraftUpdateRequest(BaseModel):
    draft_type: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    structured_payload: dict[str, Any]


class DraftApproveResponse(BaseModel):
    draft_id: int
    status: DraftStatus
    created_entity: dict[str, Any] | None = None
