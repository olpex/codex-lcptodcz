from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import CurrentUser, DbSession, require_roles
from app.models import RoleName, ScheduleSlot, Teacher
from app.schemas.api import TeacherMergeRequest, TeacherMergeResponse, WorkloadResponse
from app.services.audit import write_audit
from app.services.import_export import collect_teacher_workload_summary

router = APIRouter()


@router.get("", response_model=list[WorkloadResponse])
def get_workload(
    db: DbSession,
    current_user: CurrentUser,
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
) -> list[WorkloadResponse]:
    summary = collect_teacher_workload_summary(db, current_user.branch_id, date_from=date_from, date_to=date_to)
    return [
        WorkloadResponse(
            teacher_id=row["teacher_id"],
            row_number=row["row_number"],
            teacher_name=row["teacher_name"],
            total_hours=row["total_hours"],
            annual_load_hours=row["annual_load_hours"],
            remaining_hours=row["remaining_hours"],
        )
        for row in summary
    ]


@router.post(
    "/merge-teachers",
    response_model=TeacherMergeResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def merge_teachers(
    payload: TeacherMergeRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> TeacherMergeResponse:
    source_ids = sorted({teacher_id for teacher_id in payload.source_teacher_ids if teacher_id != payload.target_teacher_id})
    if not source_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Оберіть щонайменше одного викладача для об'єднання")

    target = (
        db.query(Teacher)
        .filter(Teacher.id == payload.target_teacher_id, Teacher.branch_id == current_user.branch_id)
        .first()
    )
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Основного викладача не знайдено")

    sources = (
        db.query(Teacher)
        .filter(Teacher.branch_id == current_user.branch_id, Teacher.id.in_(source_ids))
        .all()
    )
    if len(sources) != len(source_ids):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Одного з викладачів для об'єднання не знайдено")

    reassigned_slots = (
        db.query(ScheduleSlot)
        .filter(ScheduleSlot.teacher_id.in_(source_ids))
        .update({ScheduleSlot.teacher_id: target.id}, synchronize_session=False)
    )
    target.annual_load_hours = float(target.annual_load_hours or 0) + sum(float(source.annual_load_hours or 0) for source in sources)
    if not target.hourly_rate:
        target.hourly_rate = max(float(source.hourly_rate or 0) for source in sources + [target])
    db.add(target)

    merged_names = [f"{source.last_name} {source.first_name}".strip() for source in sources]
    for source in sources:
        db.delete(source)

    db.commit()
    db.refresh(target)

    write_audit(
        db,
        actor_user_id=current_user.id,
        action="teacher.merge",
        entity_type="teacher",
        entity_id=str(target.id),
        details={
            "merged_teacher_ids": source_ids,
            "merged_teacher_names": merged_names,
            "reassigned_slots": reassigned_slots,
            "annual_load_hours": target.annual_load_hours,
        },
    )
    return TeacherMergeResponse(
        target_teacher_id=target.id,
        merged_teacher_ids=source_ids,
        reassigned_slots=reassigned_slots,
        annual_load_hours=target.annual_load_hours,
    )
