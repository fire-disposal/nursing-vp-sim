"""成绩管理统计服务 — 学生平均成绩排名 / 好中差分档 / 进步幅度。

数据口径：
- 只统计 ``status == completed`` 且 ``scoring_status == completed`` 的
  非测试训练记录（有 Score 行）。
- 默认只统计作业关联记录（assignment_id 非空）；``include_free=True``
  时纳入自主训练。
- 排名按「学生平均分」降序；平均用时取 ``end_time - start_time`` 秒。
- 好/中/差分层基于平均分固定阈值（与前端 SCORE_COLOR 一致）：
  good ≥ 85，medium ≥ 60，poor < 60。
- 进步幅度：按时间把该学生的成绩记录平分为前后两半，
  delta = 后半程均分 − 前半程均分；|delta| < 2 视为平稳。
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from statistics import mean

from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session, joinedload

from core.exceptions import NotFoundError
from core.statuses import ScoringStatus, TrainingStatus
from models import Assignment, Class, Score, TrainingRecord, User, UserClass
from schemas.scoreboard import (
    TIER_GOOD,
    TIER_MEDIUM,
    TIER_NONE,
    TIER_POOR,
    TREND_DOWN,
    TREND_FLAT,
    TREND_NONE,
    TREND_UP,
    ScoreboardRankingItem,
    ScoreboardRankingResponse,
    ScoreboardSummary,
    StudentTrendRecord,
    StudentTrendResponse,
)

log = logging.getLogger(__name__)

# 分层阈值（0-100 分制）
GOOD_MIN = 85.0
MEDIUM_MIN = 60.0

# 进步幅度判定阈值（±2 分内视为平稳）
PROGRESS_TREND_THRESHOLD = 2.0

# 排序字段白名单 → 分组子查询列
_SORT_COLUMNS: dict[str, str] = {
    "avg_score": "avg_score",
    "best_score": "best_score",
    "avg_duration": "avg_duration",
    "training_count": "training_count",
    # progress 需要 Python 侧全量计算，单独处理
}

_VALID_SORTS = frozenset([*_SORT_COLUMNS, "progress"])
_VALID_TIERS = frozenset([TIER_GOOD, TIER_MEDIUM, TIER_POOR])
_VALID_ASSIGNMENT_STATUS = frozenset(["active", "ended"])


@dataclass(frozen=True)
class ScoreboardScope:
    """排名/趋势共用的筛选范围。"""

    case_id: int | None = None
    class_id: int | None = None
    assignment_id: str | None = None
    assignment_status: str | None = None
    include_free: bool = False


def tier_for_score(score: float | None) -> str:
    """按平均分分档：good ≥ 85，medium ≥ 60，poor < 60。"""
    if score is None:
        return TIER_NONE
    if score >= GOOD_MIN:
        return TIER_GOOD
    if score >= MEDIUM_MIN:
        return TIER_MEDIUM
    return TIER_POOR


def compute_progress(rows: Sequence[tuple[datetime, float]]) -> tuple[float | None, str]:
    """按时间升序的成绩序列计算进步幅度。

    - 不足 2 次训练 → (None, "none")
    - 平分前后两半，delta = 后半均分 − 前半均分
    - trend：|delta| < 2 → flat；delta ≥ 2 → up；delta ≤ -2 → down
    """
    n = len(rows)
    if n < 2:
        return None, TREND_NONE
    mid = n // 2
    first = [score for _, score in rows[:mid]]
    second = [score for _, score in rows[mid:]]
    delta = round(mean(second) - mean(first), 1)
    if delta >= PROGRESS_TREND_THRESHOLD:
        trend = TREND_UP
    elif delta <= -PROGRESS_TREND_THRESHOLD:
        trend = TREND_DOWN
    else:
        trend = TREND_FLAT
    return delta, trend


class ScoreboardService:
    def __init__(self, db: Session):
        self.db = db

    # ── 查询构建 ──

    def _scope_conditions(self, scope: ScoreboardScope, now: datetime) -> list:
        conditions = [
            TrainingRecord.status == TrainingStatus.COMPLETED,
            TrainingRecord.scoring_status == ScoringStatus.COMPLETED,
            TrainingRecord.is_test == False,
        ]
        if scope.case_id is not None:
            conditions.append(TrainingRecord.case_id == scope.case_id)
        if scope.assignment_id is not None:
            conditions.append(TrainingRecord.assignment_id == scope.assignment_id)
        if not scope.include_free:
            conditions.append(TrainingRecord.assignment_id.isnot(None))
        if scope.assignment_status == "active":
            conditions.append(Assignment.end_time >= now)
        elif scope.assignment_status == "ended":
            conditions.append(Assignment.end_time < now)
        if scope.class_id is not None:
            conditions.append(
                TrainingRecord.user_id.in_(
                    self.db.query(UserClass.user_id).filter(UserClass.class_id == scope.class_id)
                )
            )
        return conditions

    def _stats_query(self, conditions: list):
        """按学生分组的统计查询（平均分/最高分/平均用时/次数/病例数）。"""
        return (
            self.db.query(
                TrainingRecord.user_id.label("user_id"),
                func.avg(Score.total_score).label("avg_score"),
                func.max(Score.total_score).label("best_score"),
                func.avg(func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time)).label(
                    "avg_duration"
                ),
                func.count(TrainingRecord.id).label("training_count"),
                func.count(func.distinct(TrainingRecord.case_id)).label("case_count"),
            )
            .join(Score, Score.record_id == TrainingRecord.id)
            .outerjoin(Assignment, Assignment.id == TrainingRecord.assignment_id)
            .filter(*conditions)
            .group_by(TrainingRecord.user_id)
        )

    # ── 排名 ──

    def ranking(
        self,
        *,
        scope: ScoreboardScope,
        search: str | None = None,
        sort_by: str = "avg_score",
        order: str = "desc",
        tier: str | None = None,
        offset: int = 0,
        limit: int = 100,
        now: datetime | None = None,
    ) -> ScoreboardRankingResponse:
        if sort_by not in _VALID_SORTS:
            sort_by = "avg_score"
        if order not in ("asc", "desc"):
            order = "desc"
        if tier is not None and tier not in _VALID_TIERS:
            tier = None
        now = now or datetime.now(UTC)

        conditions = self._scope_conditions(scope, now)
        stats_q = self._stats_query(conditions)
        sub = stats_q.subquery()

        q = self.db.query(sub)
        if search:
            q = q.join(User, User.id == sub.c.user_id).filter(
                or_(
                    User.display_name.ilike(f"%{search}%"),
                    User.student_id.ilike(f"%{search}%"),
                )
            )
        if tier == TIER_GOOD:
            q = q.filter(sub.c.avg_score >= GOOD_MIN)
        elif tier == TIER_MEDIUM:
            q = q.filter(sub.c.avg_score >= MEDIUM_MIN, sub.c.avg_score < GOOD_MIN)
        elif tier == TIER_POOR:
            q = q.filter(sub.c.avg_score < MEDIUM_MIN)

        total = q.order_by(None).count()

        progress_map: dict[int, tuple[float | None, str]] = {}
        if sort_by == "progress":
            # 进步幅度需要按学生取全量时间序列，先在 Python 侧算完全部再排序分页
            all_rows = q.all()
            user_ids = [r.user_id for r in all_rows]
            progress_map = self._progress_for_users(user_ids, conditions)
            # 无进步数据（不足 2 次训练）一律排最后
            progress_keys = {
                uid: (delta if delta is not None else float("-inf"))
                for uid, (delta, _trend) in progress_map.items()
            }
            all_rows.sort(
                key=lambda r: progress_keys.get(r.user_id, float("-inf")),
                reverse=order == "desc",
            )
            page_rows = all_rows[offset : offset + limit]
        else:
            column = getattr(sub.c, _SORT_COLUMNS[sort_by])
            q = q.order_by(column.asc() if order == "asc" else column.desc())
            page_rows = q.offset(offset).limit(limit).all()
            progress_map = self._progress_for_users([r.user_id for r in page_rows], conditions)

        items = self._build_items(page_rows, offset, progress_map)
        summary = self._summary(conditions, now)
        return ScoreboardRankingResponse(
            summary=summary,
            items=items,
            total=total,
            offset=offset,
            limit=limit,
        )

    def _progress_for_users(self, user_ids: list[int], conditions: list) -> dict[int, tuple[float | None, str]]:
        """为给定学生批量计算进步幅度（返回 {user_id: (delta, trend)}）。"""
        if not user_ids:
            return {}
        rows = (
            self.db.query(
                TrainingRecord.user_id.label("user_id"),
                TrainingRecord.start_time.label("start_time"),
                Score.total_score.label("score"),
            )
            .join(Score, Score.record_id == TrainingRecord.id)
            .outerjoin(Assignment, Assignment.id == TrainingRecord.assignment_id)
            .filter(*conditions, TrainingRecord.user_id.in_(user_ids))
            .order_by(TrainingRecord.start_time.asc())
            .all()
        )
        by_user: dict[int, list[tuple[datetime, float]]] = {}
        for r in rows:
            by_user.setdefault(r.user_id, []).append((r.start_time, r.score))
        return {uid: compute_progress(seq) for uid, seq in by_user.items()}

    def _build_items(
        self,
        page_rows: Sequence,
        offset: int,
        progress_map: dict[int, tuple[float | None, str]],
    ) -> list[ScoreboardRankingItem]:
        if not page_rows:
            return []
        user_ids = [r.user_id for r in page_rows]
        users = {u.id: u for u in self.db.query(User).filter(User.id.in_(user_ids)).all()}
        class_names = {
            row[0]: row[1]
            for row in self.db.query(UserClass.user_id, Class.name)
            .join(Class, Class.id == UserClass.class_id)
            .filter(UserClass.user_id.in_(user_ids))
            .all()
        }

        items: list[ScoreboardRankingItem] = []
        for i, r in enumerate(page_rows):
            user = users.get(r.user_id)
            delta, trend = progress_map.get(r.user_id, (None, TREND_NONE))
            avg_score = round(float(r.avg_score), 1) if r.avg_score is not None else None
            items.append(
                ScoreboardRankingItem(
                    rank=offset + i + 1,
                    user_id=r.user_id,
                    display_name=user.display_name if user else f"用户 {r.user_id}",
                    student_id=user.student_id if user else None,
                    class_name=class_names.get(r.user_id, ""),
                    avg_score=avg_score,
                    best_score=round(float(r.best_score), 1) if r.best_score is not None else None,
                    avg_duration_seconds=round(float(r.avg_duration)) if r.avg_duration is not None else None,
                    training_count=int(r.training_count),
                    case_count=int(r.case_count),
                    tier=tier_for_score(avg_score),
                    progress_delta=delta,
                    progress_trend=trend,
                )
            )
        return items

    def _summary(self, conditions: list, now: datetime) -> ScoreboardSummary:
        sub = self._stats_query(conditions).subquery()
        row = (
            self.db.query(
                func.count().label("student_count"),
                func.sum(sub.c.training_count).label("record_count"),
                func.avg(sub.c.avg_score).label("avg_score"),
                func.avg(sub.c.avg_duration).label("avg_duration"),
            )
            .select_from(sub)
            .one()
        )

        tier_rows = (
            self.db.query(
                case(
                    (sub.c.avg_score >= GOOD_MIN, TIER_GOOD),
                    (sub.c.avg_score >= MEDIUM_MIN, TIER_MEDIUM),
                    else_=TIER_POOR,
                ).label("tier"),
                func.count().label("cnt"),
            )
            .select_from(sub)
            .group_by("tier")
            .all()
        )
        tier_counts = {TIER_GOOD: 0, TIER_MEDIUM: 0, TIER_POOR: 0}
        for t, cnt in tier_rows:
            tier_counts[t] = int(cnt)

        case_count = (
            self.db.query(func.count(func.distinct(TrainingRecord.case_id)))
            .join(Score, Score.record_id == TrainingRecord.id)
            .outerjoin(Assignment, Assignment.id == TrainingRecord.assignment_id)
            .filter(*conditions)
            .scalar()
            or 0
        )

        return ScoreboardSummary(
            record_count=int(row.record_count or 0),
            student_count=int(row.student_count or 0),
            case_count=int(case_count),
            avg_score=round(float(row.avg_score), 1) if row.avg_score is not None else None,
            avg_duration_seconds=round(float(row.avg_duration)) if row.avg_duration is not None else None,
            tier_counts=tier_counts,
            thresholds={"good_min": GOOD_MIN, "poor_max": MEDIUM_MIN},
        )

    # ── 学生趋势 ──

    def student_trend(
        self,
        user_id: int,
        *,
        scope: ScoreboardScope,
        now: datetime | None = None,
    ) -> StudentTrendResponse:
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            raise NotFoundError("学生不存在")
        now = now or datetime.now(UTC)
        conditions = self._scope_conditions(scope, now) + [TrainingRecord.user_id == user_id]

        rows = (
            self.db.query(TrainingRecord, Score.total_score.label("score"))
            .options(joinedload(TrainingRecord.case), joinedload(TrainingRecord.assignment))
            .join(Score, Score.record_id == TrainingRecord.id)
            .filter(*conditions)
            .order_by(TrainingRecord.start_time.asc())
            .all()
        )

        class_name = (
            self.db.query(Class.name)
            .join(UserClass, UserClass.class_id == Class.id)
            .filter(UserClass.user_id == user_id)
            .first()
        )

        trend_records: list[StudentTrendRecord] = []
        for record, score in rows:
            duration = 0
            if record.start_time and record.end_time:
                duration = max(0, int((record.end_time - record.start_time).total_seconds()))
            trend_records.append(
                StudentTrendRecord(
                    record_id=record.id,
                    case_id=record.case_id,
                    case_name=record.case.name if record.case else "",
                    assignment_id=record.assignment_id,
                    assignment_title=record.assignment.title if record.assignment else None,
                    score=round(float(score), 1),
                    duration_seconds=duration,
                    start_time=record.start_time,
                    end_time=record.end_time,
                )
            )

        scores = [tr.score for tr in trend_records]
        delta, trend = compute_progress([(tr.start_time, tr.score) for tr in trend_records])

        return StudentTrendResponse(
            user_id=user_id,
            display_name=user.display_name,
            student_id=user.student_id,
            class_name=class_name[0] if class_name else "",
            training_count=len(trend_records),
            total_duration_seconds=sum(tr.duration_seconds for tr in trend_records),
            avg_score=round(mean(scores), 1) if scores else None,
            best_score=max(scores) if scores else None,
            first_score=scores[0] if scores else None,
            latest_score=scores[-1] if scores else None,
            progress_delta=delta,
            progress_trend=trend,
            records=trend_records,
        )
