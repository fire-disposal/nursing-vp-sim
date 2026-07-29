"""Stats router — thin layer delegating to StatsService."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from core.deps import DbSession
from core.security import get_current_user, require_permission
from models import User
from schemas import (
    ClassSummaryItemSchema,
    DurationStats,
    PaginatedResponse,
    RankingItem,
    TeacherSummaryItem,
    TrendStats,
)
from services.stats import StatsService

router = APIRouter(prefix="/api/stats", tags=["统计"])


@router.get("/duration", response_model=DurationStats)
def get_duration_stats(
    current_user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
    period: Annotated[str, Query(description="统计周期: week / month / all")] = "month",
):
    svc = StatsService(db)
    return svc.get_duration_stats(current_user, period)


@router.get("/trends", response_model=TrendStats)
def get_trends(
    current_user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
    period: Annotated[str, Query(description="统计周期: week / month / all")] = "month",
):
    svc = StatsService(db)
    return svc.get_trends(current_user, period)


@router.get("/teacher-summary", response_model=PaginatedResponse[TeacherSummaryItem])
def teacher_summary(
    db: DbSession,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    class_id: Annotated[int | None, Query()] = None,
    _current_user: User = Depends(require_permission("stats_view")),
):
    svc = StatsService(db)
    return svc.teacher_summary(offset=offset, limit=limit, class_id=class_id)


@router.get("/ranking", response_model=PaginatedResponse[RankingItem])
def student_ranking(
    db: DbSession,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    class_id: Annotated[int | None, Query()] = None,
    _current_user: User = Depends(require_permission("stats_view")),
):
    svc = StatsService(db)
    return svc.student_ranking(offset=offset, limit=limit, class_id=class_id)


@router.get("/class-summary", response_model=list[ClassSummaryItemSchema])
def class_summary(
    db: DbSession,
    grade_id: Annotated[int | None, Query()] = None,
    _current_user: User = Depends(require_permission("stats_view")),
):
    svc = StatsService(db)
    return svc.class_summary(grade_id=grade_id)
