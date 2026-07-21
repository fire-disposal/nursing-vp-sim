from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models._base import TimestampMixin

if TYPE_CHECKING:
    from models.auth import User
    from models.org import Class
    from models.training import TrainingRecord


class Case(Base, TimestampMixin):
    __tablename__ = "cases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    training_type: Mapped[str] = mapped_column(String(50), default="history_taking")
    difficulty: Mapped[int] = mapped_column(Integer, default=1)
    time_limit_minutes: Mapped[int] = mapped_column(Integer, default=20)
    is_open: Mapped[bool] = mapped_column(default=False)
    case_data: Mapped[dict] = mapped_column(JSONB, default=dict)


class Assignment(Base, TimestampMixin):
    __tablename__ = "assignments"
    __table_args__ = (
        Index("ix_assignments_teacher", "teacher_id"),
        Index("ix_assignments_class", "class_id"),
        Index("ix_assignments_case", "case_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    case_id: Mapped[int] = mapped_column(Integer, ForeignKey("cases.id", ondelete="RESTRICT"))
    class_id: Mapped[int] = mapped_column(Integer, ForeignKey("classes.id", ondelete="RESTRICT"))
    teacher_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="RESTRICT"))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    features: Mapped[dict] = mapped_column(JSONB, default=dict)
    behavior: Mapped[dict] = mapped_column(JSONB, default=dict)
    student_ids: Mapped[list[int] | None] = mapped_column(JSONB, nullable=True)
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    is_closed: Mapped[bool] = mapped_column(default=False, server_default=text("false"))

    case: Mapped[Case] = relationship()
    class_: Mapped[Class] = relationship()
    teacher: Mapped[User] = relationship(foreign_keys=[teacher_id])
    training_records: Mapped[list[TrainingRecord]] = relationship(back_populates="assignment")
