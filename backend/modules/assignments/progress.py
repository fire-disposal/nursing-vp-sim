"""作业进度推导 — 学生端/教师端/训练门控共用的唯一口径（纯函数，无 DB 依赖）。

历史上有三套互不相同的推导（训练门控 / 教师端详情 / 学生端列表），本模块把它们
收敛为同一组函数：

- ``count_attempts``：已用尝试次数 —— 排除 in_progress/discarded/abandoned
  （进行中不算「用过一次」，已放弃/已丢弃同样不算）。
- ``pick_representative``：代表记录 —— 作业进度与分数的唯一来源。先排除
  discarded/abandoned；已完成优先，同组内取有效分最高（``Score.effective_total``
  已复核分优先），无分记录取最新。
- ``progress_status``：进度状态 —— 代表记录状态，未完成且逾期覆写为 overdue。
- ``effective_status``：作业生命周期 —— ``is_closed`` 优先于 ``end_time``。
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from core.datetime_utils import ensure_utc
from core.statuses import (
    AssignmentLifecycle,
    AssignmentProgressStatus,
    ScoringStatus,
    TrainingStatus,
)
from models import TrainingRecord

# 不消耗尝试次数的记录状态：进行中不算「用过一次」，已放弃/已丢弃同样不算。
ATTEMPT_EXCLUDED_STATUSES: frozenset[str] = frozenset(
    {
        TrainingStatus.IN_PROGRESS.value,
        TrainingStatus.DISCARDED.value,
        TrainingStatus.ABANDONED.value,
    }
)

# 不构成「一次作业进度」的记录状态（与尝试计数不同：in_progress 是有效进度）。
_REPRESENTATIVE_EXCLUDED_STATUSES: frozenset[str] = frozenset(
    {TrainingStatus.DISCARDED.value, TrainingStatus.ABANDONED.value}
)

# start_time 缺失（历史脏数据）时的排序兜底。
_EPOCH = datetime.min.replace(tzinfo=UTC)
_NO_SCORE = float("-inf")


@dataclass(frozen=True, slots=True)
class Attempt:
    """推导所需的最小记录视图（由 ``attempt_from_record`` 从 TrainingRecord 投影）。"""

    record_id: int
    status: str
    score: float | None = None  # Score.effective_total（教师复核分优先）
    scoring_status: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    is_overdue: bool = False


def attempt_from_record(record: TrainingRecord) -> Attempt:
    """把 ORM 训练记录投影为 ``Attempt``（分数口径 = effective_total，复核分优先）。

    ``record.score`` 需已加载（调用方 joinedload ），否则分数会退化为 None。
    """
    score = record.score
    score_value: float | None = None
    if score is not None and record.scoring_status == ScoringStatus.COMPLETED.value:
        score_value = score.effective_total
    return Attempt(
        record_id=record.id,
        status=record.status,
        score=score_value,
        scoring_status=record.scoring_status,
        start_time=record.start_time,
        end_time=record.end_time,
        is_overdue=bool(record.is_overdue),
    )


def count_attempts(statuses: Iterable[str]) -> int:
    """已用尝试次数 —— 门控（开始前判定）与展示（剩余次数）共用同一口径。"""
    return sum(1 for s in statuses if s not in ATTEMPT_EXCLUDED_STATUSES)


def pick_representative(attempts: Sequence[Attempt]) -> Attempt | None:
    """代表记录：作业进度/分数的唯一来源。全部记录都被放弃时返回 None（= 未开始）。"""
    pool = [a for a in attempts if a.status not in _REPRESENTATIVE_EXCLUDED_STATUSES]
    if not pool:
        return None
    completed = [a for a in pool if a.status == TrainingStatus.COMPLETED.value]
    if completed:
        return max(completed, key=lambda a: (a.score if a.score is not None else _NO_SCORE, a.start_time or _EPOCH))
    return max(pool, key=lambda a: a.start_time or _EPOCH)


def progress_status(attempt: Attempt | None) -> str:
    """进度状态：无代表记录 = 未开始；未完成且逾期 = overdue。"""
    if attempt is None:
        return AssignmentProgressStatus.NOT_STARTED.value
    if attempt.is_overdue and attempt.status != TrainingStatus.COMPLETED.value:
        return AssignmentProgressStatus.OVERDUE.value
    return attempt.status


def effective_status(is_closed: bool, end_time: datetime, now: datetime) -> AssignmentLifecycle:
    """作业生命周期：``is_closed``（教师手动关闭）优先于 ``end_time``。

    SQL 侧的等价过滤见 ``AssignmentService.list_with_counts`` 的 status 分支，
    两处必须同时修改（同一规则的两个表达面）。
    """
    if is_closed:
        return AssignmentLifecycle.CLOSED
    return AssignmentLifecycle.ENDED if now > ensure_utc(end_time) else AssignmentLifecycle.ACTIVE
