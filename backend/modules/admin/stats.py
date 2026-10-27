"""Stats router — training statistics and analytics."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from core.datetime_utils import parse_iso_datetime
from core.deps import DbSession
from core.pagination import paginate
from core.security import get_current_user, require_permission
from core.tenant import Scope, TenantScope, scope_query, visible_class
from models import MEMBER_ROLE_STUDENT, Class, ClassMembership, Role, Score, TrainingRecord, User
from modules.training.scoring.grade_scope import grade_conditions, grade_expr
from schemas import (
    ClassSummaryItemSchema,
    PaginatedResponse,
    TeacherSummaryItem,
    TrendStats,
)


def _trend_since(date_from: str | None) -> datetime | None:
    """趋势窗口下界：**时间窗由调用方显式给出**，不传 = 不限。

    原先的 `period: week|month|all` 是后端在猜"周/月"，与列表的 `date_from`
    是两套时间语义（同一个界面上的两个数字因此可以互相矛盾）。现在全仓只有
    `date_from` 一种表达，前端把窗口算好传进来。
    """
    if not date_from:
        return None
    try:
        return parse_iso_datetime(date_from)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"无效日期格式: {date_from}") from None


class StatsService:
    """校级统计。所有查询都在 ``TenantScope`` 上收窄，见 ``_narrow_training``。

    统计本身是"校园内可见数据"的聚合：院校管理员看全校，教师只看自己任教的班
    （``TenantScope.class_ids``）——与班级端点同一判据，不在这里另立归属规则。
    """

    def __init__(self, db: Session, tenant: TenantScope):
        self.db = db
        self.tenant = tenant

    # ── 作用域 ──

    def _student_ids_in_classes(self, class_ids):
        """给定班级里的**学生**（``member_role='student'``；教师成员不算学生口径）。"""
        return self.db.query(ClassMembership.user_id).filter(
            ClassMembership.class_id.in_(class_ids),
            ClassMembership.member_role == MEMBER_ROLE_STUDENT,
        )

    def _visible_student_ids(self):
        """可统计的学生：本校；教师视角再收窄到自己任教的班。"""
        q = self.db.query(User.id).filter(User.school_id == self.tenant.school_id)
        if self.tenant.class_ids is not None:
            q = q.filter(User.id.in_(self._student_ids_in_classes(self.tenant.class_ids or {-1})))
        return q

    def _narrow_training(self, query):
        """把训练记录收窄到可统计学生；跨院校平台角色（``school_id is None``）不收窄。"""
        if self.tenant.school_id is None:
            return query
        return query.filter(TrainingRecord.user_id.in_(self._visible_student_ids()))

    def get_trends(self, current_user: User, date_from: str | None = None) -> TrendStats:
        since = _trend_since(date_from)

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
                TrainingRecord.is_student_practice == True,
            )
        )

        if since is not None:
            base = base.filter(TrainingRecord.start_time >= since)

        if not current_user.has_permission("stats_view"):
            # 无统计权限 = 只有自己的训练数据（既有口径，不随院校作用域放宽）
            base = base.filter(TrainingRecord.user_id == current_user.id)
        else:
            base = self._narrow_training(base)

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
                & (TrainingRecord.is_student_practice == True),
            )
            .filter(User.role_id == student_role_id)
        )

        base = scope_query(base, User.school_id, self.tenant)
        if self.tenant.class_ids is not None:
            # 教师视角：名单只到「自己任教的班」，跨班学生即使同校也不进名单
            base = base.filter(User.id.in_(self._student_ids_in_classes(self.tenant.class_ids or {-1})))

        if class_id is not None:
            # 跨院校 / 非任教班一律 404：不区分"不存在"与"无权看到"
            visible_class(self.db, self.tenant, class_id)
            base = base.filter(User.id.in_(self._student_ids_in_classes({class_id})))
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

    def class_summary(
        self,
        cohort_label: str | None = None,
        class_id: int | None = None,
    ) -> list[ClassSummaryItemSchema]:
        q = scope_query(self.db.query(Class), Class.school_id, self.tenant)
        if self.tenant.class_ids is not None:
            # 教师视角：只看自己任教的班（cohort_label 只是标签，挡不住别校班级）
            q = q.filter(Class.id.in_(self.tenant.class_ids or {-1}))
        if cohort_label is not None:
            q = q.filter(Class.cohort_label == cohort_label)
        if class_id is not None:
            # 跨院校 / 非任教班一律 404，而不是返回空列表
            visible_class(self.db, self.tenant, class_id)
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
                & (TrainingRecord.is_student_practice == True),
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
    scope: Scope,
    date_from: Annotated[
        str | None, Query(description="窗口起点 ISO 格式（含），如 2026-09-24T00:00:00+08:00；不传 = 不限")
    ] = None,
):
    return StatsService(db, scope).get_trends(current_user, date_from)


@router.get("/teacher-summary", response_model=PaginatedResponse[TeacherSummaryItem])
def teacher_summary(
    db: DbSession,
    scope: Scope,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    class_id: Annotated[int | None, Query(description="班级筛选；只能指向作用域内的班级，否则 404")] = None,
    _current_user: User = Depends(require_permission("stats_view")),
):
    return StatsService(db, scope).teacher_summary(offset=offset, limit=limit, class_id=class_id)


@router.get("/class-summary", response_model=list[ClassSummaryItemSchema])
def class_summary(
    db: DbSession,
    scope: Scope,
    cohort_label: Annotated[str | None, Query(max_length=40)] = None,
    class_id: Annotated[int | None, Query(description="班级筛选；只能指向作用域内的班级，否则 404")] = None,
    _current_user: User = Depends(require_permission("stats_view")),
):
    return StatsService(db, scope).class_summary(cohort_label=cohort_label, class_id=class_id)
