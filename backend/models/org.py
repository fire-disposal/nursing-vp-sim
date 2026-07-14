from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models._base import _now_utc

if TYPE_CHECKING:
    from models.auth import User


class Grade(Base):
    __tablename__ = "grades"
    __table_args__ = (UniqueConstraint("name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)

    classes: Mapped[list[Class]] = relationship(back_populates="grade", cascade="all, delete-orphan")


class Class(Base):
    __tablename__ = "classes"
    __table_args__ = (
        UniqueConstraint("grade_id", "name"),
        Index("ix_classes_grade_id", "grade_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    grade_id: Mapped[int] = mapped_column(Integer, ForeignKey("grades.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(60))
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)

    grade: Mapped[Grade] = relationship(back_populates="classes")
    user_classes: Mapped[list[UserClass]] = relationship(back_populates="class_", cascade="all, delete-orphan")


class UserClass(Base):
    __tablename__ = "user_class"
    __table_args__ = (Index("ix_user_class_class_id", "class_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    class_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("classes.id", ondelete="SET NULL"), nullable=True)
    joined_at: Mapped[datetime] = mapped_column(default=_now_utc)

    user: Mapped[User] = relationship(back_populates="user_classes")
    class_: Mapped[Class] = relationship(back_populates="user_classes")
