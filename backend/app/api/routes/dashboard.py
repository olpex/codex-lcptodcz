from datetime import datetime, timezone
from typing import Iterator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import or_

from app.api.deps import CurrentUser, DbSession, require_roles
from app.models import (
    DraftStatus,
    ExportJob,
    Group,
    GroupStatus,
    ImportJob,
    JobStatus,
    OCRResult,
    Performance,
    RoleName,
    ScheduleSlot,
    StudentPlan,
    Trainee,
)
from app.schemas.api import (
    DashboardAttentionItem,
    DashboardAttentionResponse,
    DashboardKPIResponse,
    StudentPlanResponse,
    StudentPlanUpdateRequest,
)

router = APIRouter()


def _current_plan_year() -> int:
    return datetime.now(timezone.utc).year


def _processed_group_trainees_count(db: DbSession, branch_id: str) -> int:
    return (
        db.query(Trainee)
        .filter(
            Trainee.branch_id == branch_id,
            Trainee.is_deleted.is_(False),
            Trainee.group_code.is_not(None),
            Trainee.group_code != "",
        )
        .count()
    )


def _student_plan_response(db: DbSession, branch_id: str, year: int) -> StudentPlanResponse:
    plan = db.query(StudentPlan).filter(StudentPlan.branch_id == branch_id, StudentPlan.year == year).first()
    target = plan.target_trainees if plan else 0
    processed = _processed_group_trainees_count(db, branch_id)
    progress = round((processed / target) * 100, 2) if target > 0 else 0.0
    return StudentPlanResponse(
        year=year,
        target_trainees=target,
        processed_trainees=processed,
        progress_pct=progress,
    )


@router.get("/kpi", response_model=DashboardKPIResponse)
def get_kpi(db: DbSession, current_user: CurrentUser, year: int | None = None) -> DashboardKPIResponse:
    plan_year = year or _current_plan_year()
    student_plan = _student_plan_response(db, current_user.branch_id, plan_year)
    active_groups = (
        db.query(Group)
        .filter(Group.branch_id == current_user.branch_id, Group.status == GroupStatus.ACTIVE)
        .count()
    )
    active_trainees = (
        db.query(Trainee)
        .filter(Trainee.branch_id == current_user.branch_id, Trainee.is_deleted.is_(False))
        .count()
    )

    performance_rows = (
        db.query(Performance)
        .join(Group, Group.id == Performance.group_id)
        .filter(Group.branch_id == current_user.branch_id)
        .all()
    )
    if performance_rows:
        employment_rate = sum(1 for row in performance_rows if row.employment_flag) / len(performance_rows)
    else:
        employment_rate = 0.76

    forecast_graduation = int(active_trainees * 0.92)
    forecast_employment = int(forecast_graduation * employment_rate)

    return DashboardKPIResponse(
        active_groups=active_groups,
        active_trainees=active_trainees,
        training_plan_progress_pct=student_plan.progress_pct,
        student_plan_year=student_plan.year,
        student_plan_target=student_plan.target_trainees,
        student_plan_processed=student_plan.processed_trainees,
        forecast_graduation=forecast_graduation,
        forecast_employment=forecast_employment,
    )


@router.put(
    "/student-plan",
    response_model=StudentPlanResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def update_student_plan(
    payload: StudentPlanUpdateRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> StudentPlanResponse:
    plan = (
        db.query(StudentPlan)
        .filter(StudentPlan.branch_id == current_user.branch_id, StudentPlan.year == payload.year)
        .first()
    )
    if not plan:
        plan = StudentPlan(
            branch_id=current_user.branch_id,
            year=payload.year,
            target_trainees=payload.target_trainees,
        )
    else:
        plan.target_trainees = payload.target_trainees
    db.add(plan)
    db.commit()
    return _student_plan_response(db, current_user.branch_id, payload.year)


def _attention_item(
    key: str,
    title: str,
    count: int,
    severity: str,
    description: str,
    action_href: str,
) -> DashboardAttentionItem | None:
    if count <= 0:
        return None
    return DashboardAttentionItem(
        key=key,
        title=title,
        count=count,
        severity=severity,
        description=description,
        action_href=action_href,
    )


@router.get("/attention", response_model=DashboardAttentionResponse)
def get_attention(db: DbSession, current_user: CurrentUser) -> DashboardAttentionResponse:
    branch_id = current_user.branch_id
    failed_jobs = (
        db.query(ImportJob).filter(ImportJob.branch_id == branch_id, ImportJob.status == JobStatus.FAILED).count()
        + db.query(ExportJob).filter(ExportJob.branch_id == branch_id, ExportJob.status == JobStatus.FAILED).count()
    )
    pending_drafts = (
        db.query(OCRResult)
        .filter(OCRResult.branch_id == branch_id, OCRResult.status == DraftStatus.PENDING)
        .count()
    )
    unassigned_trainees = (
        db.query(Trainee)
        .filter(
            Trainee.branch_id == branch_id,
            Trainee.is_deleted.is_(False),
            or_(Trainee.group_code.is_(None), Trainee.group_code == ""),
        )
        .count()
    )

    valid_group_codes = {
        code
        for (code,) in db.query(Group.code).filter(Group.branch_id == branch_id).all()
        if (code or "").strip()
    }
    trainee_group_codes = [
        code.strip()
        for (code,) in db.query(Trainee.group_code)
        .filter(
            Trainee.branch_id == branch_id,
            Trainee.is_deleted.is_(False),
            Trainee.group_code.is_not(None),
            Trainee.group_code != "",
        )
        .all()
        if (code or "").strip()
    ]
    orphan_group_codes = len({code for code in trainee_group_codes if code not in valid_group_codes})

    active_groups = db.query(Group).filter(Group.branch_id == branch_id, Group.status == GroupStatus.ACTIVE).all()
    scheduled_group_ids = {
        group_id
        for (group_id,) in db.query(ScheduleSlot.group_id)
        .join(Group, Group.id == ScheduleSlot.group_id)
        .filter(Group.branch_id == branch_id)
        .distinct()
        .all()
    }
    groups_without_schedule = sum(1 for group in active_groups if group.id not in scheduled_group_ids)

    raw_items = [
        _attention_item(
            "failed_jobs",
            "Помилки імпорту або експорту",
            failed_jobs,
            "error",
            "Є задачі, які завершилися помилкою і потребують повтору або перевірки файлу.",
            "/jobs",
        ),
        _attention_item(
            "pending_drafts",
            "Чернетки на перевірку",
            pending_drafts,
            "warning",
            "OCR або поштові документи очікують ручної перевірки та підтвердження.",
            "/drafts",
        ),
        _attention_item(
            "unassigned_trainees",
            "Слухачі без групи",
            unassigned_trainees,
            "warning",
            "Частина активних слухачів не прив'язана до жодної групи.",
            "/trainees",
        ),
        _attention_item(
            "orphan_group_codes",
            "Коди груп без картки групи",
            orphan_group_codes,
            "warning",
            "У слухачів є коди груп, яких немає у довіднику груп.",
            "/trainees",
        ),
        _attention_item(
            "groups_without_schedule",
            "Активні групи без розкладу",
            groups_without_schedule,
            "info",
            "Активні групи ще не мають жодного заняття у розкладі.",
            "/schedule",
        ),
    ]
    items = [item for item in raw_items if item is not None]
    severity_order = {"error": 0, "warning": 1, "info": 2}
    items.sort(key=lambda item: (severity_order.get(item.severity, 3), item.title))
    return DashboardAttentionResponse(
        generated_at=datetime.now(timezone.utc),
        total_count=sum(item.count for item in items),
        items=items,
    )


@router.get("/kpi/stream")
def stream_kpi(db: DbSession, current_user: CurrentUser) -> StreamingResponse:
    def event_stream() -> Iterator[str]:
        for _ in range(20):
            snapshot = get_kpi(db, current_user)
            payload = snapshot.model_dump_json()
            yield f"event: kpi\ndata: {payload}\n\n"
            yield "event: heartbeat\ndata: {}\n\n"
            import time

            time.sleep(5)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
