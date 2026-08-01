from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models._base import TimestampMixin, _now_utc

if TYPE_CHECKING:
    from models.auth import User


class QASession(Base, TimestampMixin):
    __tablename__ = "qa_sessions"
    __table_args__ = (Index("ix_qa_sessions_user_updated", "user_id", "updated_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(String(80))

    user: Mapped[User] = relationship()
    records: Mapped[list[QARecord]] = relationship(back_populates="session", order_by="QARecord.created_at")


class QARecord(Base):
    __tablename__ = "qa_records"
    __table_args__ = (Index("ix_qa_session_created", "session_id", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(Integer, ForeignKey("qa_sessions.id"), index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(index=True, default=_now_utc)

    user: Mapped[User] = relationship()
    session: Mapped[QASession] = relationship(back_populates="records")
