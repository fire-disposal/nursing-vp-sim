from __future__ import annotations

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models._base import TimestampMixin


class SimulationSession(Base, TimestampMixin):
    """A playable clinical-reasoning session, business-isolated from the
    training/cases domains. The whole deterministic engine state lives in the
    ``state`` JSONB column (MVP-B §10: save the session as one JSON blob)."""

    __tablename__ = "simulation_sessions"
    __table_args__ = (
        Index("ix_simulation_sessions_user", "user_id"),
        CheckConstraint("status IN ('ACTIVE', 'SUCCESS', 'FAILURE')", name="ck_simulation_sessions_status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", name="fk_simulation_sessions_user_id"))
    case_version: Mapped[str] = mapped_column(String(32), default="mvpb-1")
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE")
    state: Mapped[dict] = mapped_column(JSONB, server_default=text("'{}'::jsonb"), default=dict)
