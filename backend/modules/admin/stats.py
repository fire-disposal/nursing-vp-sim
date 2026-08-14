"""Stats router — training statistics and analytics."""

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.deps import DbSession
from core.pagination import paginate
from core.security import get_current_user, require_permission
from models import Class, Grade, Role, Score, TrainingRecord, User, UserClass
from schemas import (
    ClassStudentItem,
    ClassSummaryItemSchema,
    DurationStats,
    PaginatedResponse,
    RankingItem,
    TeacherSummaryItem,
    TrendStats,
)


class StatsService:
    def __init__(self, db: Session):
        self.db = db

    @staticmethod
    def _period_since(period: str) -> datetime:
        now = datetime.now(UTC)
        if period == "week":
            return now - timedelta(days=7)
        if period == "month":
            return now - timedelta(days=30)
        return datetime(2000, 1, 1, tzinfo=UTC)

    def get_duration_stats(self, current_user: User, period: str) -> DurationStats:
        since = self._period_since(period)

        base = self.db.query(
            func.date(TrainingRecord.start_time).label("d"),
            func.sum(func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60).label("minutes"),
            func.count().label("sessions"),
        ).filter(
            TrainingRecord.status == "completed",
            TrainingRecord.start_time >= since,
            TrainingRecord.is_test == False,
        )

        if not current_user.has_permission("stats_view"):
            base = base.filter(TrainingRecord.user_id == current_user.id)

        rows = base.group_by(func.date(TrainingRecord.start_time)).order_by("d").all()

        daily = [{"date": str(r.d), "minutes": round(float(r.minutes or 0), 1)} for r in rows]
        total_minutes = round(sum(r.minutes or 0 for r in rows))
        total_sessions = sum(r.sessions for r in rows)

        return DurationStats(daily=daily, total_minutes=total_minutes, total_sessions=total_sessions)

    def get_trends(self, current_user: User, period: str) -> TrendStats:
        since = self._period_since(period)

        base = (
            self.db.query(
                func.date(TrainingRecord.start_time).label("d"),
                func.count().label("sessions"),
                func.sum(func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60).label(
                    "minutes"
                ),
                func.avg(Score.total_score).label("avg_score"),
            )
            .outerjoin(Score, Score.record_id == TrainingRecord.id)
            .filter(
                TrainingRecord.status == "completed",
                TrainingRecord.start_time >= since,
                TrainingRecord.is_test == False,
            )
        )

        if not current_user.has_permission("stats_view"):
            base = base.filter(TrainingRecord.user_id == current_user.id)

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
        score_sum = sum(float(r.avg_score) * r.sessions for r in rows if r.avg_score is not None)
        score_weight = sum(r.sessions for r in rows if r.avg_score is not None)
        overall_avg = round(score_sum / score_weight, 1) if score_weight > 0 else None

        return TrendStats(
            daily=daily,
            total_sessions=total_sessions,
            total_minutes=total_minutes,
            avg_score=overall_avg,
        )

    def teacher_summary(
        self,
        offset: int = 0,
        limit: int = 50,
        class_id: int | None = None,
    ) -> PaginatedResponse[TeacherSummaryItem]:
        student_role = self.db.query(Role).filter(Role.name == "student").first()
        if not student_role:
            return PaginatedResponse(items=[], total=0, offset=offset, limit=limit)
        student_role_id = student_role.id

        base = (
            self.db.query(
                User.id.label("user_id"),
                User.display_name.label("display_name"),
                User.student_id.label("student_code"),
                func.count(TrainingRecord.id).label("total_sessions"),
                func.coalesce(
                    func.sum(func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60),
                    0,
                ).label("total_minutes"),
            )
            .outerjoin(
                TrainingRecord,
                (TrainingRecord.user_id == User.id)
                & (TrainingRecord.status == "completed")
                & (TrainingRecord.is_test == False),
            )
            .filter(User.role_id == student_role_id)
        )

        if class_id is not None:
            base = base.filter(User.id.in_(self.db.query(UserClass.user_id).filter(UserClass.class_id == class_id)))
        base = base.group_by(User.id).order_by(User.id)

        items, total = paginate(base, offset, limit)

        data = [
            TeacherSummaryItem(
                user_id=r.user_id,
                display_name=r.display_name,
                student_code=r.student_code,
                total_sessions=r.total_sessions,
                total_minutes=round(float(r.total_minutes)),
            )
            for r in items
        ]
        return PaginatedResponse(items=data, total=total, offset=offset, limit=limit)

    def student_ranking(
        self,
        offset: int = 0,
        limit: int = 50,
        class_id: int | None = None,
    ) -> PaginatedResponse[RankingItem]:
        student_role = self.db.query(Role).filter(Role.name == "student").first()
        if not student_role:
            return PaginatedResponse(items=[], total=0, offset=offset, limit=limit)
        student_role_id = student_role.id

        sub = (
            self.db.query(
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
            .outerjoin(
                TrainingRecord,
                (TrainingRecord.user_id == User.id)
                & (TrainingRecord.status == "completed")
                & (TrainingRecord.is_test == False),
            )
            .outerjoin(Score, Score.record_id == TrainingRecord.id)
            .filter(User.role_id == student_role_id)
        )

        if class_id is not None:
            sub = sub.filter(User.id.in_(self.db.query(UserClass.user_id).filter(UserClass.class_id == class_id)))
        sub = sub.group_by(User.id).subquery()

        total = self.db.query(func.count()).select_from(sub).scalar()
        rows = self.db.query(sub).order_by(sub.c.rank).offset(offset).limit(limit).all()

        items = [
            RankingItem(
                user_id=r.user_id,
                display_name=r.display_name,
                student_id=r.student_id,
                total_sessions=r.total_sessions,
                avg_score=round(float(r.avg_score), 1) if r.avg_score else None,
                total_score=round(float(r.total_score), 1),
                total_minutes=round(float(r.total_minutes)),
                rank=r.rank,
            )
            for r in rows
        ]
        return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)

    def class_students(
        self,
        class_id: int,
    ) -> list[ClassStudentItem]:
        """班级学生维度聚合 — 取代前端拉 200 条原始记录做客户端聚合。"""
        rows = (
            self.db.query(
                User.id.label("user_id"),
                User.display_name,
                User.student_id,
                func.count(TrainingRecord.id).label("total_sessions"),
                func.avg(Score.total_score).label("avg_score"),
                func.max(TrainingRecord.start_time).label("last_start_time"),
            )
            .join(UserClass, UserClass.user_id == User.id)
            .outerjoin(
                TrainingRecord,
                (TrainingRecord.user_id == User.id)
                & (TrainingRecord.status == "completed")
                & (TrainingRecord.is_test == False),
            )
            .outerjoin(Score, Score.record_id == TrainingRecord.id)
            .filter(UserClass.class_id == class_id)
            .group_by(User.id)
            .order_by(User.display_name, User.id)
            .all()
        )
        return [
            ClassStudentItem(
                user_id=r.user_id,
                display_name=r.display_name,
                student_id=r.student_id,
                total_sessions=int(r.total_sessions or 0),
                avg_score=round(float(r.avg_score), 1) if r.avg_score is not None else None,
                last_start_time=r.last_start_time,
            )
            for r in rows
        ]

    def class_summary(
        self,
        grade_id: int | None = None,
        class_id: int | None = None,
    ) -> list[ClassSummaryItemSchema]:
        q = self.db.query(Class, Grade.name.label("grade_name"))
        q = q.join(Grade, Grade.id == Class.grade_id)
        if grade_id is not None:
            q = q.filter(Class.grade_id == grade_id)
        if class_id is not None:
            q = q.filter(Class.id == class_id)
        classes = q.order_by(Grade.name, Class.name).all()

        class_ids = [c.id for c, _ in classes]

        if not class_ids:
            return []

        stats_rows = (
            self.db.query(
                Class.id,
                func.count(func.distinct(UserClass.user_id)).label("student_count"),
                func.count(TrainingRecord.id).label("total_sessions"),
                func.coalesce(
                    func.sum(func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60),
                    0,
                ).label("total_minutes"),
                func.avg(Score.total_score).label("avg_score"),
            )
            .outerjoin(UserClass, UserClass.class_id == Class.id)
            .outerjoin(
                TrainingRecord,
                (TrainingRecord.user_id == UserClass.user_id)
                & (TrainingRecord.status == "completed")
                & (TrainingRecord.is_test == False),
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
                ClassSummaryItemSchema(
                    class_id=cls.id,
                    class_name=cls.name,
                    grade_name=grade_name,
                    student_count=student_count,
                    avg_score=avg_score,
                    completion_rate=round(float(completion_rate), 1),
                    total_sessions=total_sessions,
                    total_minutes=total_minutes,
                )
            )
        return result


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
    class_id: Annotated[int | None, Query()] = None,
    _current_user: User = Depends(require_permission("stats_view")),
):
    svc = StatsService(db)
    return svc.class_summary(grade_id=grade_id, class_id=class_id)


@router.get("/class-students", response_model=list[ClassStudentItem])
def class_students(
    db: DbSession,
    class_id: Annotated[int, Query(description="班级ID")],
    _current_user: User = Depends(require_permission("stats_view")),
):
    svc = StatsService(db)
    return svc.class_students(class_id=class_id)
