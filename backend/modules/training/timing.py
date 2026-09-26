"""Authoritative training countdown semantics.

Guided and blind-box practice pause while the student is away. Independent
assessment keeps a wall-clock deadline except while a required pre-training
questionnaire is open. Chat admission, detail responses and settlement share it.
"""

from datetime import UTC, datetime, timedelta

from core.datetime_utils import ensure_utc
from core.statuses import TrainingMode, TrainingStatus, normalize_training_mode
from core.time_limits import (  # 唯一口径在 core；此处转出供训练域既有导入使用
    DEFAULT_TIME_LIMIT_MINUTES,
    MAX_TIME_LIMIT_MINUTES,
    MIN_TIME_LIMIT_MINUTES,
    resolve_time_limit_minutes,
)
from models import TrainingRecord

__all__ = [
    "DEFAULT_TIME_LIMIT_MINUTES",
    "MAX_TIME_LIMIT_MINUTES",
    "MIN_TIME_LIMIT_MINUTES",
    "is_training_overdue",
    "remaining_seconds",
    "resolve_time_limit_minutes",
    "training_deadline",
]


def _pause_extension(record: TrainingRecord, now: datetime) -> timedelta:
    mode = normalize_training_mode((record.practice_snapshot or {}).get("behavior", {}).get("mode"))
    runtime_state = dict(record.runtime_state or {})
    seconds = max(0, int(runtime_state.get("questionnaire_paused_seconds") or 0))
    questionnaire_paused_at = runtime_state.get("questionnaire_paused_at")
    if isinstance(questionnaire_paused_at, str):
        try:
            seconds += max(0, int((now - ensure_utc(datetime.fromisoformat(questionnaire_paused_at))).total_seconds()))
        except ValueError:
            pass

    if mode != TrainingMode.ASSESSMENT.value:
        seconds += max(0, int(runtime_state.get("paused_seconds") or 0))
        paused_at = runtime_state.get("paused_at")
        if isinstance(paused_at, str):
            try:
                seconds += max(0, int((now - ensure_utc(datetime.fromisoformat(paused_at))).total_seconds()))
            except ValueError:
                pass
    return timedelta(seconds=seconds)


def training_deadline(record: TrainingRecord, now: datetime | None = None) -> datetime:
    """Return the effective deadline, including practice-mode pauses."""
    now = now or datetime.now(UTC)
    start = ensure_utc(record.start_time)
    return start + timedelta(minutes=record.time_limit or DEFAULT_TIME_LIMIT_MINUTES) + _pause_extension(record, now)


def is_training_overdue(record: TrainingRecord, now: datetime | None = None) -> bool:
    if record.status != TrainingStatus.IN_PROGRESS:
        return False
    now = now or datetime.now(UTC)
    return now > training_deadline(record, now)


def remaining_seconds(record: TrainingRecord, now: datetime | None = None) -> int | None:
    if record.status != TrainingStatus.IN_PROGRESS:
        return None
    now = now or datetime.now(UTC)
    return max(0, int((training_deadline(record, now) - now).total_seconds()))
