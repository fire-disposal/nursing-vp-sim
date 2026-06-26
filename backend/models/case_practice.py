from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import (
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.case_schema import CaseDataSchema
from core.database import Base
from core.jsonb import PydanticJSONB
from models._base import TimestampMixin

if TYPE_CHECKING:
    from models.auth import User
    from models.org import Class
    from models.tenant import School
    from models.training import TrainingRecord


class Case(Base, TimestampMixin):
    __tablename__ = "cases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    case_data: Mapped[dict] = mapped_column(PydanticJSONB(CaseDataSchema))
    school_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("schools.id", ondelete="SET NULL"), nullable=True)

    school: Mapped[School | None] = relationship()
    practices: Mapped[list[Practice]] = relationship(back_populates="case")


class Practice(Base, TimestampMixin):
    __tablename__ = "practices"
    __table_args__ = (
        Index("ix_practices_case_id", "case_id"),
        Index("ix_practices_school_id", "school_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    case_id: Mapped[int] = mapped_column(Integer, ForeignKey("cases.id", ondelete="RESTRICT"))
    school_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("schools.id", ondelete="SET NULL"), nullable=True)
    features: Mapped[dict] = mapped_column(JSONB, default=dict)
    behavior: Mapped[dict] = mapped_column(JSONB, default=dict)
    is_active: Mapped[bool] = mapped_column(default=True, server_default=text("true"))

    case: Mapped[Case] = relationship(back_populates="practices")
    school: Mapped[School | None] = relationship()
    assignments: Mapped[list[Assignment]] = relationship(back_populates="practice")
    training_records: Mapped[list[TrainingRecord]] = relationship(back_populates="practice")


class Assignment(Base, TimestampMixin):
    __tablename__ = "assignments"
    __table_args__ = (
        Index("ix_assignments_teacher", "teacher_id"),
        Index("ix_assignments_class", "class_id"),
        Index("ix_assignments_practice", "practice_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    practice_id: Mapped[int] = mapped_column(Integer, ForeignKey("practices.id", ondelete="RESTRICT"))
    class_id: Mapped[int] = mapped_column(Integer, ForeignKey("classes.id", ondelete="RESTRICT"))
    teacher_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="RESTRICT"))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_time: Mapped[datetime] = mapped_column()
    end_time: Mapped[datetime] = mapped_column()

    practice: Mapped[Practice] = relationship(back_populates="assignments")
    class_: Mapped[Class] = relationship()
    teacher: Mapped[User] = relationship(foreign_keys=[teacher_id])
    training_records: Mapped[list[TrainingRecord]] = relationship(back_populates="assignment")


class Rubric(Base, TimestampMixin):
    __tablename__ = "rubrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    version: Mapped[str] = mapped_column(String(40))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    total_max: Mapped[int] = mapped_column(Integer, default=100)
    raw_max: Mapped[int] = mapped_column(Integer, default=57)
    raw_scale: Mapped[int] = mapped_column(Integer, default=3)
    dimensions: Mapped[list] = mapped_column(JSONB)
    is_active: Mapped[bool] = mapped_column(default=False)
