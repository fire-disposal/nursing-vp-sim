from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.database import get_db
from core.pagination import paginate
from core.security import get_current_user, require_permission
from middleware.dependencies import resolve_school_filter
from models import Class, Grade, Role, Score, TrainingRecord, User, UserClass
from schemas import (
    ClassSummaryItemSchema,
    DurationStats,
    PaginatedResponse,
    RankingItem,
    TeacherSummaryItem,
    TrendStats,
)

router = APIRouter(prefix="/api/stats", tags=["统计"])


@router.get("/duration", response_model=DurationStats)
def get_duration_stats(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    period: Annotated[str, Query(description="统计周期: week / month / all")] = "month",
    school_id: Annotated[int | None, Query(description="super_admin 按学校筛选")] = None,
):
    now = datetime.now(UTC)
    effective_school = resolve_school_filter(current_user, school_id)
    if period == "week":
        since = now - timedelta(days=7)
    elif period == "month":
        since = now - timedelta(days=30)
    else:
        since = datetime(2000, 1, 1, tzinfo=UTC)

    base = db.query(
        func.date(TrainingRecord.start_time).label("d"),
        func.sum(func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60).label("minutes"),
        func.count().label("sessions"),
    ).filter(
        TrainingRecord.status == "completed",
        TrainingRecord.start_time >= since,
    )

    if not current_user.has_permission("stats_view"):
        base = base.filter(TrainingRecord.user_id == current_user.id)

    rows = base.group_by(func.date(TrainingRecord.start_time)).order_by("d").all()

    daily = [{"date": str(r.d), "minutes": round(float(r.minutes or 0), 1)} for r in rows]
    total_minutes = round(sum(r.minutes or 0 for r in rows))
    total_sessions = sum(r.sessions for r in rows)

    return DurationStats(daily=daily, total_minutes=total_minutes, total_sessions=total_sessions)


@router.get("/trends", response_model=TrendStats)
def get_trends(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    period: Annotated[str, Query(description="统计周期: week / month / all")] = "month",
    school_id: Annotated[int | None, Query(description="super_admin 按学校筛选")] = None,
):
    now = datetime.now(UTC)
    effective_school = resolve_school_filter(current_user, school_id)
    if period == "week":
        since = now - timedelta(days=7)
    elif period == "month":
        since = now - timedelta(days=30)
    else:
        since = datetime(2000, 1, 1, tzinfo=UTC)

    base = (
        db.query(
            func.date(TrainingRecord.start_time).label("d"),
            func.count().label("sessions"),
            func.sum(func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60).label("minutes"),
            func.avg(Score.total_score).label("avg_score"),
        )
        .outerjoin(Score, Score.record_id == TrainingRecord.id)
        .filter(
            TrainingRecord.status == "completed",
            TrainingRecord.start_time >= since,
        )
    )

    if not current_user.has_permission("stats_view"):
        base = base.filter(TrainingRecord.user_id == current_user.id)
    elif effective_school is not None:
        base = base.join(User, TrainingRecord.user_id == User.id).filter(User.school_id == effective_school)

    rows = base.group_by(func.date(TrainingRecord.start_time)).order_by("d").all()

    daily = [
        {
            "date": str(r.d),
            "sessions": r.sessions,
            "minutes": round(float(r.minutes or 0), 1),
            "avg_score": round(float(r.avg_score), 1) if r.avg_score is not None else None,
        }
        for r in rows
    ]
    total_sessions = sum(r.sessions for r in rows)
    total_minutes = round(sum(r.minutes or 0 for r in rows))
    all_scores = [float(r.avg_score) for r in rows if r.avg_score is not None]
    overall_avg = round(sum(all_scores) / len(all_scores), 1) if all_scores else None

    return TrendStats(daily=daily, total_sessions=total_sessions, total_minutes=total_minutes, avg_score=overall_avg)


@router.get("/teacher-summary", response_model=PaginatedResponse[TeacherSummaryItem])
def teacher_summary(
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    class_id: Annotated[int | None, Query()] = None,
    current_user: User = Depends(require_permission("stats_view")),
    db: Session = Depends(get_db),
):
    student_role = db.query(Role).filter(Role.name == "student", Role.school_id == current_user.school_id).first()
    student_role_id = student_role.id if student_role else -1
    base = (
        db.query(
            User.id.label("user_id"),
            User.display_name.label("display_name"),
            User.student_id.label("student_code"),
            func.count(TrainingRecord.id).label("total_sessions"),
            func.coalesce(
                func.sum(func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60),
                0,
            ).label("total_minutes"),
        )
        .outerjoin(TrainingRecord, (TrainingRecord.user_id == User.id) & (TrainingRecord.status == "completed"))
        .filter(User.role_id == student_role_id)
    )
    if class_id is not None:
        base = base.filter(User.id.in_(db.query(UserClass.user_id).filter(UserClass.class_id == class_id)))
    base = base.group_by(User.id).order_by(User.id)

    items, total = paginate(base, offset, limit)

    data = [
        {
            "user_id": r.user_id,
            "display_name": r.display_name,
            "student_code": r.student_code,
            "total_sessions": r.total_sessions,
            "total_minutes": round(float(r.total_minutes)),
        }
        for r in items
    ]
    return PaginatedResponse(items=data, total=total, offset=offset, limit=limit)


@router.get("/ranking", response_model=PaginatedResponse[RankingItem])
def student_ranking(
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    class_id: Annotated[int | None, Query()] = None,
    current_user: User = Depends(require_permission("stats_view")),
    db: Session = Depends(get_db),
):
    student_role = db.query(Role).filter(Role.name == "student", Role.school_id == current_user.school_id).first()
    student_role_id = student_role.id if student_role else -1
    sub = (
        db.query(
            User.id.label("user_id"),
            User.display_name.label("display_name"),
            User.student_id.label("student_id"),
            func.count(TrainingRecord.id).label("total_sessions"),
            func.coalesce(func.avg(Score.total_score), 0).label("avg_score"),
            func.coalesce(func.sum(Score.total_score), 0).label("total_score"),
            func.coalesce(
                func.sum(func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60),
                0,
            ).label("total_minutes"),
            func.rank().over(order_by=func.coalesce(func.avg(Score.total_score), 0).desc()).label("rank"),
        )
        .outerjoin(TrainingRecord, (TrainingRecord.user_id == User.id) & (TrainingRecord.status == "completed"))
        .outerjoin(Score, Score.record_id == TrainingRecord.id)
        .filter(User.role_id == student_role_id)
    )
    if class_id is not None:
        sub = sub.filter(User.id.in_(db.query(UserClass.user_id).filter(UserClass.class_id == class_id)))
    sub = sub.group_by(User.id).subquery()

    total = db.query(func.count()).select_from(sub).scalar()
    rows = db.query(sub).order_by(sub.c.rank).offset(offset).limit(limit).all()

    items = [
        {
            "user_id": r.user_id,
            "display_name": r.display_name,
            "student_id": r.student_id,
            "total_sessions": r.total_sessions,
            "avg_score": round(float(r.avg_score), 1) if r.avg_score else None,
            "total_score": round(float(r.total_score), 1),
            "total_minutes": round(float(r.total_minutes)),
            "rank": r.rank,
        }
        for r in rows
    ]
    return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)


@router.get("/class-summary", response_model=list[ClassSummaryItemSchema])
def class_summary(
    grade_id: Annotated[int | None, Query()] = None,
    school_id: Annotated[int | None, Query(description="super_admin 按学校筛选")] = None,
    current_user: User = Depends(require_permission("stats_view")),
    db: Session = Depends(get_db),
):
    effective_school = resolve_school_filter(current_user, school_id)
    q = db.query(Class, Grade.name.label("grade_name"))
    q = q.join(Grade, Grade.id == Class.grade_id)
    if effective_school is not None:
        q = q.filter(Grade.school_id == effective_school)
    if grade_id is not None:
        q = q.filter(Class.grade_id == grade_id)
    classes = q.order_by(Grade.name, Class.name).all()

    class_ids = [c.id for c, _ in classes]

    if not class_ids:
        return []

    stats_rows = (
        db.query(
            Class.id,
            func.count(func.distinct(UserClass.user_id)).label("student_count"),
            func.count(TrainingRecord.id).label("total_sessions"),
            func.coalesce(
                func.sum(func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60), 0
            ).label("total_minutes"),
            func.avg(Score.total_score).label("avg_score"),
        )
        .outerjoin(UserClass, UserClass.class_id == Class.id)
        .outerjoin(
            TrainingRecord,
            (TrainingRecord.user_id == UserClass.user_id) & (TrainingRecord.status == "completed"),
        )
        .outerjoin(Score, Score.record_id == TrainingRecord.id)
        .filter(Class.id.in_(class_ids))
        .group_by(Class.id)
        .all()
    )

    stats_map = {row.id: row for row in stats_rows}

    result = []
    for cls, grade_name in classes:
        s = stats_map.get(cls.id)
        student_count = int(s.student_count) if s else 0
        total_sessions = int(s.total_sessions) if s else 0
        total_minutes = round(float(s.total_minutes)) if s else 0
        avg_score = round(float(s.avg_score), 1) if s and s.avg_score is not None else None
        completion_rate = total_sessions / student_count if student_count > 0 else 0

        result.append(
            {
                "class_id": cls.id,
                "class_name": cls.name,
                "grade_name": grade_name,
                "student_count": student_count,
                "avg_score": avg_score,
                "completion_rate": round(float(completion_rate), 1),
                "total_sessions": total_sessions,
                "total_minutes": total_minutes,
            }
        )
    return result
