"""作业进度推导回归（纯逻辑，无数据库）。

守护评审报告 mess-domain-crud.md 第 5/7 条：学生端与教师端必须给出同一份
「尝试次数 / 代表记录 / 进度状态」，且 abandoned 既不消耗次数也不代表进度。
"""

from datetime import UTC, datetime, timedelta

from core.statuses import AssignmentLifecycle, AssignmentProgressStatus, TrainingStatus
from models import Score, TrainingRecord
from modules.assignments.progress import (
    ATTEMPT_EXCLUDED_STATUSES,
    attempt_from_record,
    count_attempts,
    effective_status,
    pick_representative,
    progress_status,
)

T0 = datetime(2026, 3, 1, 8, 0, tzinfo=UTC)


def _record(
    record_id: int,
    status: str,
    *,
    scored: bool = False,
    total: float | None = None,
    reviewed: float | None = None,
    start: datetime | None = None,
    overdue: bool = False,
) -> TrainingRecord:
    """构造内存中的 TrainingRecord（不经数据库，仅用于投影）。"""
    r = TrainingRecord(
        id=record_id,
        user_id=1,
        case_id=1,
        status=status,
        scoring_status="completed" if scored else "pending",
        start_time=start or T0 + timedelta(hours=record_id),
        is_overdue=overdue,
    )
    if scored:
        r.score = Score(record_id=record_id, total_score=total, reviewed_total=reviewed)
    return r


class TestCountAttempts:
    def test_excludes_in_progress_discarded_abandoned(self):
        statuses = [
            TrainingStatus.COMPLETED.value,
            TrainingStatus.IN_PROGRESS.value,
            TrainingStatus.DISCARDED.value,
            TrainingStatus.ABANDONED.value,
            TrainingStatus.COMPLETED.value,
        ]
        assert count_attempts(statuses) == 2
        assert sorted(ATTEMPT_EXCLUDED_STATUSES) == ["abandoned", "discarded", "in_progress"]

    def test_all_excluded_is_zero(self):
        assert count_attempts([TrainingStatus.ABANDONED.value, TrainingStatus.DISCARDED.value]) == 0

    def test_empty_is_zero(self):
        assert count_attempts([]) == 0


class TestRepresentative:
    def test_abandoned_does_not_hide_completed(self):
        """报告场景：completed(88) 之后再开一次并中止 → 代表仍是 completed(88)。"""
        attempts = [
            attempt_from_record(_record(2, TrainingStatus.ABANDONED.value, start=T0 + timedelta(hours=2))),
            attempt_from_record(_record(1, TrainingStatus.COMPLETED.value, scored=True, total=88.0, start=T0)),
        ]
        rep = pick_representative(attempts)
        assert rep is not None
        assert rep.record_id == 1
        assert rep.score == 88.0
        assert progress_status(rep) == AssignmentProgressStatus.COMPLETED.value

    def test_best_score_wins_among_completed(self):
        attempts = [
            attempt_from_record(_record(1, TrainingStatus.COMPLETED.value, scored=True, total=60.0)),
            attempt_from_record(_record(2, TrainingStatus.COMPLETED.value, scored=True, total=88.0)),
        ]
        rep = pick_representative(attempts)
        assert rep is not None
        assert rep.record_id == 2

    def test_in_progress_is_representative_when_alone(self):
        attempts = [attempt_from_record(_record(1, TrainingStatus.IN_PROGRESS.value))]
        rep = pick_representative(attempts)
        assert rep is not None
        assert rep.record_id == 1
        assert progress_status(rep) == AssignmentProgressStatus.IN_PROGRESS.value

    def test_all_abandoned_is_not_started(self):
        attempts = [
            attempt_from_record(_record(1, TrainingStatus.ABANDONED.value)),
            attempt_from_record(_record(2, TrainingStatus.DISCARDED.value)),
        ]
        assert pick_representative(attempts) is None
        assert progress_status(None) == AssignmentProgressStatus.NOT_STARTED.value

    def test_latest_unscored_record_wins(self):
        """未评分的 completed（评分失败）取最新一条，且不带分数。"""
        attempts = [
            attempt_from_record(_record(1, TrainingStatus.COMPLETED.value, start=T0)),
            attempt_from_record(_record(2, TrainingStatus.COMPLETED.value, start=T0 + timedelta(hours=5))),
        ]
        rep = pick_representative(attempts)
        assert rep is not None
        assert rep.record_id == 2
        assert rep.score is None

    def test_overdue_overrides_unfinished_status(self):
        rep = attempt_from_record(_record(1, TrainingStatus.IN_PROGRESS.value, overdue=True))
        assert progress_status(rep) == AssignmentProgressStatus.OVERDUE.value

    def test_overdue_does_not_override_completed(self):
        rep = attempt_from_record(_record(1, TrainingStatus.COMPLETED.value, scored=True, total=70.0, overdue=True))
        assert progress_status(rep) == AssignmentProgressStatus.COMPLETED.value


class TestAttemptProjection:
    def test_reviewed_total_takes_precedence(self):
        """成绩口径 = 已复核优先（reviewed_total 覆盖 AI 原始分）。"""
        attempt = attempt_from_record(
            _record(1, TrainingStatus.COMPLETED.value, scored=True, total=100.0, reviewed=70.0)
        )
        assert attempt.score == 70.0

    def test_unscored_record_has_no_score(self):
        attempt = attempt_from_record(_record(1, TrainingStatus.COMPLETED.value))
        assert attempt.score is None
        assert attempt.scoring_status == "pending"

    def test_started_but_unscored_has_no_score_even_if_score_row_exists(self):
        """scoring_status != completed 时不应展示分数（落库分未定稿）。"""
        r = _record(1, TrainingStatus.IN_PROGRESS.value)
        r.score = Score(record_id=1, total_score=99.0)
        assert attempt_from_record(r).score is None


class TestEffectiveStatus:
    NOW = datetime(2026, 3, 10, 12, 0, tzinfo=UTC)

    def test_closed_wins_over_future_end_time(self):
        assert (
            effective_status(is_closed=True, end_time=self.NOW + timedelta(days=1), now=self.NOW)
            is AssignmentLifecycle.CLOSED
        )

    def test_ended_after_end_time(self):
        assert (
            effective_status(is_closed=False, end_time=self.NOW - timedelta(minutes=1), now=self.NOW)
            is AssignmentLifecycle.ENDED
        )

    def test_active_within_window(self):
        assert (
            effective_status(is_closed=False, end_time=self.NOW + timedelta(minutes=1), now=self.NOW)
            is AssignmentLifecycle.ACTIVE
        )

    def test_active_at_exact_end_time(self):
        assert effective_status(is_closed=False, end_time=self.NOW, now=self.NOW) is AssignmentLifecycle.ACTIVE

    def test_naive_end_time_treated_as_utc(self):
        naive = self.NOW.replace(tzinfo=None) - timedelta(minutes=1)
        assert effective_status(is_closed=False, end_time=naive, now=self.NOW) is AssignmentLifecycle.ENDED

    def test_non_utc_offset_end_time(self):
        tz_plus8 = self.NOW.astimezone(UTC)
        assert (
            effective_status(is_closed=False, end_time=tz_plus8 + timedelta(hours=1), now=self.NOW + timedelta(hours=2))
            is AssignmentLifecycle.ENDED
        )
