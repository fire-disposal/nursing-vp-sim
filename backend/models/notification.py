from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models._base import TimestampMixin, _now_utc

if TYPE_CHECKING:
    from models.auth import User


class SystemNotification(Base, TimestampMixin):
    __tablename__ = "system_notifications"
    __table_args__ = (
        CheckConstraint(
            "level IN ('info', 'warning', 'success')",
            name="ck_sn_level",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text)
    level: Mapped[str] = mapped_column(String(20), default="info")
    is_active: Mapped[bool] = mapped_column(default=True)
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(nullable=True)

    creator: Mapped[User | None] = relationship()


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_read", "user_id", "is_read"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    record_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("training_records.id", ondelete="CASCADE"), nullable=True
    )
    type: Mapped[str] = mapped_column(String(30))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_read: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)
    updated_at: Mapped[datetime | None] = mapped_column(default=_now_utc, onupdate=_now_utc, nullable=True)

    user: Mapped[User] = relationship()
