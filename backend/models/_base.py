from datetime import UTC, datetime

from sqlalchemy import DateTime
from sqlalchemy.orm import Mapped, mapped_column


def _now_utc() -> datetime:
    return datetime.now(UTC)


class TimestampMixin:
    """Mixin providing created_at + updated_at columns for models with full audit trails."""

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc, onupdate=_now_utc)
