from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    DateTime,
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
    replied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 回复人（决策 2026-09-26：谁回复的既在审计里、也在业务表里可查）。
    # ON DELETE SET NULL：删管理员账号不连带抹掉"这条反馈被回复过"的事实。
    replied_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    auto_fix_attempted: Mapped[bool] = mapped_column(default=False)
    auto_fix_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc)

    # 显式 foreign_keys：replied_by 也是指向 users 的外键，不指定则关系判定二义
    user: Mapped[User] = relationship(foreign_keys=[user_id])
    images: Mapped[list] = relationship("FeedbackImage", cascade="all, delete-orphan")
