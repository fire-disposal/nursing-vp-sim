"""Wall-clock training countdown semantics (modules/training/timing.py)."""

from datetime import UTC, datetime, timedelta

from models import TrainingRecord
from modules.training.timing import is_training_overdue, remaining_seconds, training_deadline


def _record(*, start_time, status="in_progress", time_limit=20) -> TrainingRecord:
    return TrainingRecord(start_time=start_time, status=status, time_limit=time_limit)


def test_training_deadline_start_plus_limit():
    start = datetime(2026, 7, 31, 10, 0, tzinfo=UTC)
    rec = _record(start_time=start, time_limit=20)
    assert training_deadline(rec) == start + timedelta(minutes=20)


def test_training_deadline_default_limit_when_missing():
    start = datetime(2026, 7, 31, 10, 0, tzinfo=UTC)
    rec = _record(start_time=start, time_limit=0)  # falsy → default 30 (D5)
    assert training_deadline(rec) == start + timedelta(minutes=30)


def test_is_training_overdue_before_deadline():
    rec = _record(start_time=datetime.now(UTC) - timedelta(minutes=10), time_limit=20)
    assert not is_training_overdue(rec)


def test_is_training_overdue_after_deadline():
    rec = _record(start_time=datetime.now(UTC) - timedelta(minutes=21), time_limit=20)
    assert is_training_overdue(rec)


def test_is_training_overdue_ignores_ended_records():
    rec = _record(start_time=datetime.now(UTC) - timedelta(minutes=21), status="completed", time_limit=20)
    assert not is_training_overdue(rec)


def test_remaining_seconds_counts_down():
    rec = _record(start_time=datetime.now(UTC) - timedelta(minutes=10), time_limit=20)
    remaining = remaining_seconds(rec)
    assert remaining is not None
    assert 599 <= remaining <= 600  # 10 minutes left


def test_remaining_seconds_none_when_not_in_progress():
    rec = _record(start_time=datetime.now(UTC) - timedelta(minutes=1), status="completed", time_limit=20)
    assert remaining_seconds(rec) is None


def test_remaining_seconds_clamps_to_zero():
    rec = _record(start_time=datetime.now(UTC) - timedelta(minutes=21), time_limit=20)
    assert remaining_seconds(rec) == 0


def test_deadline_pure_wall_clock():
    """D5 硬截止：deadline = start + time_limit，与 paused_seconds 无关。"""
    start = datetime(2026, 7, 31, 10, 0, tzinfo=UTC)
    rec = _record(start_time=start, time_limit=20)
    rec.runtime_state = {"paused_seconds": 600}
    assert training_deadline(rec) == start + timedelta(minutes=20)


def test_paused_seconds_does_not_extend_deadline():
    """D5 硬截止（方案 A）：暂停不延展截止时间，纯墙钟。"""
    start = datetime(2026, 7, 31, 10, 0, tzinfo=UTC)
    rec = _record(start_time=start, time_limit=20)
    rec.runtime_state = {"paused_seconds": 600}  # 离开 10 分钟 → 无效，deadline 不变
    assert training_deadline(rec) == start + timedelta(minutes=20)


def test_paused_seconds_does_not_extend_remaining():
    """暂停后重进：剩余时间按墙钟递减（离开时段照扣）。"""
    start = datetime.now(UTC) - timedelta(minutes=25)
    rec = _record(start_time=start, time_limit=20)
    rec.runtime_state = {"paused_seconds": 600}  # 离开 10 分钟 → 无效
    assert remaining_seconds(rec) == 0  # 25 分钟 > 20 分钟，已到期
    assert is_training_overdue(rec)


def test_no_paused_seconds_unchanged():
    start = datetime.now(UTC) - timedelta(minutes=10)
    rec = _record(start_time=start, time_limit=20)
    rec.runtime_state = {}
    remaining = remaining_seconds(rec)
    assert remaining is not None
    assert 599 <= remaining <= 600
