"""Stats router — training statistics and analytics."""

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from core.deps import DbSession
from core.pagination import paginate
from core.security import get_current_user, require_permission
from models import Class, ClassMembership, Role, Score, TrainingRecord, User
from modules.training.scoring.grade_scope import grade_conditions, grade_expr
from schemas import (
    ClassSummaryItemSchema,
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

    def get_trends(self, current_user: User, period: str) -> TrendStats:
        since = self._period_since(period)

        base = (
            self.db.query(
                func.date(TrainingRecord.start_time).label("d"),
                func.count().label("sessions"),
                func.sum(func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60).label(
                    "minutes"
                ),
                func.avg(grade_expr()).label("avg_score"),
                func.count(grade_expr()).label("graded"),
            )
            # INV-3：兜底分不进平均分，但训练记录仍要计入场次/时长 → 条件挂在 Score 的 JOIN 上
            .outerjoin(Score, and_(Score.record_id == TrainingRecord.id, *grade_conditions()))
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
        # INV-3/INV-5：跨日总平均按「有效成绩条数」加权。用场次加权会让兜底分/无成绩的
        # 场次放大某天的平均分（场次与时长仍照旧展示，不受成绩口径影响）。
        graded_rows = [r for r in rows if r.graded and r.avg_score is not None]
        score_sum = sum(float(r.avg_score) * r.graded for r in graded_rows)
        score_weight = sum(r.graded for r in graded_rows)
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
            base = base.filter(
                User.id.in_(
                    self.db.query(ClassMembership.user_id).filter(
                        ClassMembership.class_id == class_id,
                        ClassMembership.member_role == "student",
                    )
                )
            )
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
                func.coalesce(func.avg(grade_expr()), 0).label("avg_score"),
                func.coalesce(func.sum(grade_expr()), 0).label("total_score"),
                func.coalesce(
                    func.sum(func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60),
                    0,
                ).label("total_minutes"),
                func.rank().over(order_by=func.coalesce(func.avg(grade_expr()), 0).desc()).label("rank"),
                func.count(grade_expr()).label("graded"),
            )
            .outerjoin(
                TrainingRecord,
                (TrainingRecord.user_id == User.id)
                & (TrainingRecord.status == "completed")
                & (TrainingRecord.is_test == False),
            )
            # INV-3：兜底分不进平均分/总分/排名，但场次与时长照旧统计
            .outerjoin(Score, and_(Score.record_id == TrainingRecord.id, *grade_conditions()))
            .filter(User.role_id == student_role_id)
        )

        if class_id is not None:
            sub = sub.filter(
                User.id.in_(
                    self.db.query(ClassMembership.user_id).filter(
                        ClassMembership.class_id == class_id,
                        ClassMembership.member_role == "student",
                    )
                )
            )
        sub = sub.group_by(User.id).subquery()

        total = self.db.query(func.count()).select_from(sub).scalar()
        rows = self.db.query(sub).order_by(sub.c.rank).offset(offset).limit(limit).all()

        items = [
            RankingItem(
                user_id=r.user_id,
                display_name=r.display_name,
                student_id=r.student_id,
                total_sessions=r.total_sessions,
                # INV-3/INV-5：avg_score 的 0 是聚合默认值；只有存在有效成绩行时才是真成绩
                # （教师复核 0 分必须显示 0.0，无有效成绩才显示 None）。
                avg_score=round(float(r.avg_score), 1) if r.graded else None,
                total_score=round(float(r.total_score), 1),
                total_minutes=round(float(r.total_minutes)),
                rank=r.rank,
            )
            for r in rows
        ]
        return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)

    def class_summary(
        self,
        cohort_label: str | None = None,
        class_id: int | None = None,
    ) -> list[ClassSummaryItemSchema]:
        q = self.db.query(Class)
        if cohort_label is not None:
            q = q.filter(Class.cohort_label == cohort_label)
        if class_id is not None:
            q = q.filter(Class.id == class_id)
        classes = q.order_by(Class.cohort_label, Class.name).all()

        class_ids = [c.id for c in classes]

        if not class_ids:
            return []

        stats_rows = (
            self.db.query(
                Class.id,
                func.count(func.distinct(ClassMembership.user_id)).label("student_count"),
                func.count(TrainingRecord.id).label("total_sessions"),
                func.coalesce(
                    func.sum(func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60),
                    0,
                ).label("total_minutes"),
                func.avg(grade_expr()).label("avg_score"),
            )
            .outerjoin(
                ClassMembership,
                and_(
                    ClassMembership.class_id == Class.id,
                    ClassMembership.member_role == "student",
                ),
            )
            .outerjoin(
                TrainingRecord,
                (TrainingRecord.user_id == ClassMembership.user_id)
                & (TrainingRecord.status == "completed")
                & (TrainingRecord.is_test == False),
            )
            # INV-3：兜底分不参与班级平均分，无有效成绩的班级仍保留（avg_score = None）
            .outerjoin(Score, and_(Score.record_id == TrainingRecord.id, *grade_conditions()))
            .filter(Class.id.in_(class_ids))
            .group_by(Class.id)
            .all()
        )

        stats_map = {row.id: row for row in stats_rows}

        result = []
        for cls in classes:
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
                    cohort_label=cls.cohort_label,
                    student_count=student_count,
                    avg_score=avg_score,
                    completion_rate=round(float(completion_rate), 1),
                    total_sessions=total_sessions,
                    total_minutes=total_minutes,
                )
            )
        return result


router = APIRouter(prefix="/api/stats", tags=["统计"])


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
    cohort_label: Annotated[str | None, Query(max_length=40)] = None,
    class_id: Annotated[int | None, Query()] = None,
    _current_user: User = Depends(require_permission("stats_view")),
):
    svc = StatsService(db)
    return svc.class_summary(cohort_label=cohort_label, class_id=class_id)
