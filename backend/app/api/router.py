from fastapi import APIRouter

from app.api.routes import (
    auth,
    dashboard,
    documents,
    groups,
    jobs,
    mail,
    orders,
    performance,
    schedule,
    teachers,
    trainees,
    workload,
)

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(trainees.router, prefix="/trainees", tags=["trainees"])
api_router.include_router(groups.router, prefix="/groups", tags=["groups"])
api_router.include_router(teachers.router, prefix="/teachers", tags=["teachers"])
api_router.include_router(orders.router, prefix="/orders", tags=["orders"])
api_router.include_router(performance.router, prefix="/performance", tags=["performance"])
api_router.include_router(schedule.router, prefix="/schedule", tags=["schedule"])
api_router.include_router(workload.router, prefix="/teacher-workload", tags=["teacher-workload"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
api_router.include_router(documents.router, prefix="/documents", tags=["documents"])
api_router.include_router(jobs.router, prefix="/jobs", tags=["jobs"])
api_router.include_router(mail.router, tags=["mail"])
