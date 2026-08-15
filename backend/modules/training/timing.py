"""Training time semantics — single source of truth for the countdown.

Semantics (D5 硬截止，方案 A，2026-08-15): a training clock starts at record
creation (`start_time`) and runs on **wall-clock time** for `time_limit`
minutes. **暂停不延展截止时间**——`paused_seconds` 字段保留（API 兼容）但不再
进入 deadline；执行口径与展示口径合一，均为墙钟。到点后：
  - chat 准入拒绝新消息（chat.py 守卫）
  - 结算扫频自动 finalize（settlement.py）
  - 前端倒计时归零自动触发结束

The chat guard, the countdown view (`session_views`), and the settlement loop
all derive from this one definition.
"""

from datetime import UTC, datetime, timedelta

from core.datetime_utils import ensure_utc
from core.statuses import TrainingStatus
from models import TrainingRecord

# D5: 硬截止生效下限 30 分钟（病例/配置声明的更长时间仍生效，但不得短于 30）
DEFAULT_TIME_LIMIT_MINUTES = 30
MIN_TIME_LIMIT_MINUTES = 30


def training_deadline(record: TrainingRecord) -> datetime:
    """Wall-clock moment the training expires (start_time + time_limit).

    纯墙钟，不含暂停。暂停（离开训练页）期间训练仍在倒计时，到点即结算。
    """
    start = ensure_utc(record.start_time)
    return start + timedelta(minutes=record.time_limit or DEFAULT_TIME_LIMIT_MINUTES)


def is_training_overdue(record: TrainingRecord, now: datetime | None = None) -> bool:
    """True when an in-progress training has passed its deadline."""
    if record.status != TrainingStatus.IN_PROGRESS:
        return False
    now = now or datetime.now(UTC)
    return now > training_deadline(record)


def remaining_seconds(record: TrainingRecord, now: datetime | None = None) -> int | None:
    """Remaining wall-clock seconds; None when the record is not in_progress."""
    if record.status != TrainingStatus.IN_PROGRESS:
        return None
    now = now or datetime.now(UTC)
    return max(0, int((training_deadline(record) - now).total_seconds()))
