"""Training time semantics — single source of truth for the countdown.

Semantics: a training clock starts at record creation (`start_time`) and runs
on wall-clock time for `time_limit` minutes. There is no auto-pause. The chat
guard, the countdown view (`session_views`), and the settlement loop all derive
from this one definition, so the frontend countdown and the server's message
admission can never disagree by design.
"""

from datetime import UTC, datetime, timedelta

from core.datetime_utils import ensure_utc
from models import TrainingRecord

DEFAULT_TIME_LIMIT_MINUTES = 20


def training_deadline(record: TrainingRecord) -> datetime:
    """Wall-clock moment the training expires (start_time + time_limit)."""
    start = ensure_utc(record.start_time)
    return start + timedelta(minutes=record.time_limit or DEFAULT_TIME_LIMIT_MINUTES)


def is_training_overdue(record: TrainingRecord, now: datetime | None = None) -> bool:
    """True when an in-progress training has passed its deadline."""
    if record.status != "in_progress":
        return False
    now = now or datetime.now(UTC)
    return now > training_deadline(record)


def remaining_seconds(record: TrainingRecord, now: datetime | None = None) -> int | None:
    """Remaining wall-clock seconds; None when the record is not in_progress."""
    if record.status != "in_progress":
        return None
    now = now or datetime.now(UTC)
    return max(0, int((training_deadline(record) - now).total_seconds()))
