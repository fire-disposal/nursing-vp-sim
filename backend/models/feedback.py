from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models._base import _now_utc

if TYPE_CHECKING:
    from models.auth import User


class Feedback(Base):
    __tablename__ = "feedbacks"
    __table_args__ = (
        Index("ix_feedback_user_id", "user_id"),
        Index("ix_feedback_tag", "tag"),
        Index("ix_feedback_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    rating: Mapped[int] = mapped_column(Integer, default=3)
    tag: Mapped[str] = mapped_column(String(20), default="")
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[str] = mapped_column(String(20), default="")
    developer_reply: Mapped[str | None] = mapped_column(Text, nullable=True)
    replied_at: Mapped[datetime | None] = mapped_column(nullable=True)
    auto_fix_attempted: Mapped[bool] = mapped_column(default=False)
    auto_fix_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)

    user: Mapped[User] = relationship()
    images: Mapped[list] = relationship("FeedbackImage", cascade="all, delete-orphan")
