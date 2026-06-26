from datetime import UTC, datetime

from sqlalchemy.orm import Mapped, mapped_column


def _now_utc() -> datetime:
    return datetime.now(UTC)


class TimestampMixin:
    """Mixin providing created_at + updated_at columns for models with full audit trails."""

    created_at: Mapped[datetime] = mapped_column(default=_now_utc)
    updated_at: Mapped[datetime] = mapped_column(default=_now_utc, onupdate=_now_utc)
