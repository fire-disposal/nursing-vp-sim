from __future__ import annotations

from sqlalchemy import (
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models._base import TimestampMixin


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
