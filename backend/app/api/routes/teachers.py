from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import CurrentUser, DbSession, apply_branch_scope, ensure_same_branch, require_roles
from app.models import RoleName, Teacher, ScheduleSlot
from app.schemas.api import TeacherCreate, TeacherResponse, TeacherUpdate
from app.services.audit import write_audit

router = APIRouter()


@router.get("", response_model=list[TeacherResponse])
def list_teachers(db: DbSession, current_user: CurrentUser) -> list[TeacherResponse]:
    teachers = apply_branch_scope(db.query(Teacher), Teacher, current_user.branch_id).order_by(Teacher.created_at.desc()).all()
    return [TeacherResponse.model_validate(teacher) for teacher in teachers]


@router.post(
    "",
    response_model=TeacherResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def create_teacher(payload: TeacherCreate, db: DbSession, current_user: CurrentUser) -> TeacherResponse:
    teacher = Teacher(**payload.model_dump(), branch_id=current_user.branch_id)
    db.add(teacher)
    db.commit()
    db.refresh(teacher)
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="teacher.create",
        entity_type="teacher",
        entity_id=str(teacher.id),
    )
    return TeacherResponse.model_validate(teacher)


@router.put(
    "/{teacher_id}",
    response_model=TeacherResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def update_teacher(teacher_id: int, payload: TeacherUpdate, db: DbSession, current_user: CurrentUser) -> TeacherResponse:
    teacher = db.get(Teacher, teacher_id)
    if not teacher:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Викладача не знайдено")
    ensure_same_branch(current_user, teacher, "Викладача")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(teacher, key, value)
    db.add(teacher)
    db.commit()
    db.refresh(teacher)
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="teacher.update",
        entity_type="teacher",
        entity_id=str(teacher.id),
    )
    return TeacherResponse.model_validate(teacher)


@router.delete(
    "/{teacher_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.METHODIST))],
)
def delete_teacher(teacher_id: int, db: DbSession, current_user: CurrentUser) -> None:
    teacher = db.get(Teacher, teacher_id)
    if not teacher:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Викладача не знайдено")
    ensure_same_branch(current_user, teacher, "Викладача")
    db.query(ScheduleSlot).filter(ScheduleSlot.teacher_id == teacher_id).delete(synchronize_session=False)
    db.delete(teacher)
    db.commit()
    write_audit(
        db,
        actor_user_id=current_user.id,
        action="teacher.delete",
        entity_type="teacher",
        entity_id=str(teacher_id),
    )
