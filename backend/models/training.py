from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models._base import TimestampMixin, _now_utc

if TYPE_CHECKING:
    from models.auth import User
    from models.case_practice import Assignment, Case, Practice


class TrainingRecord(Base):
    __tablename__ = "training_records"
    __table_args__ = (
        Index("ix_tr_user_status", "user_id", "status"),
        Index("ix_tr_status", "status"),
        Index("ix_tr_start_time", "start_time"),
        Index("ix_tr_case_id", "case_id"),
        Index("ix_tr_practice_id", "practice_id"),
        CheckConstraint(
            "status IN ('in_progress', 'completed', 'abandoned')",
            name="ck_training_records_status",
        ),
        CheckConstraint(
            "scoring_status IN ('pending', 'processing', 'completed', 'failed')",
            name="ck_training_records_scoring_status",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", name="fk_training_records_user_id"))
    case_id: Mapped[int] = mapped_column(Integer, ForeignKey("cases.id", name="fk_training_records_case_id"))
    practice_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("practices.id", name="fk_training_records_practice_id"), nullable=True
    )
    practice_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    runtime_state: Mapped[dict] = mapped_column(JSONB, server_default=text("'{}'::jsonb"), default=dict)
    status: Mapped[str] = mapped_column(String(20), default="in_progress")
    scoring_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    scoring_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    time_limit: Mapped[int] = mapped_column(Integer, default=20)
    current_phase: Mapped[str | None] = mapped_column(String(50), nullable=True)
    training_type: Mapped[str] = mapped_column(String(50), default="history_taking")
    prompt_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    rubric_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    assignment_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("assignments.id", ondelete="SET NULL"), nullable=True
    )
    is_overdue: Mapped[bool] = mapped_column(default=False, server_default=text("false"))
    start_time: Mapped[datetime] = mapped_column(default=_now_utc)
    end_time: Mapped[datetime | None] = mapped_column(nullable=True)

    user: Mapped[User] = relationship(back_populates="training_records")
    case: Mapped[Case] = relationship()
    practice: Mapped[Practice | None] = relationship(back_populates="training_records")
    assignment: Mapped[Assignment | None] = relationship(back_populates="training_records")
    messages: Mapped[list[Message]] = relationship(back_populates="record", order_by="Message.created_at")
    score: Mapped[Score | None] = relationship(back_populates="record", uselist=False)
    session_state: Mapped[TrainingSessionState | None] = relationship(back_populates="record", uselist=False)


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_msg_record_created", "record_id", "created_at"),
        Index("ix_msg_role", "role"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    record_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("training_records.id", ondelete="CASCADE", name="fk_messages_record_id")
    )
    role: Mapped[str] = mapped_column(String(10))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)

    record: Mapped[TrainingRecord] = relationship(back_populates="messages")


class Score(Base):
    __tablename__ = "scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    record_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("training_records.id", ondelete="CASCADE", name="fk_scores_record_id"), unique=True
    )
    total_score: Mapped[float] = mapped_column(Float)
    detail_scores: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    strengths: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    weaknesses: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    missed_content: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    suggestions: Mapped[str | None] = mapped_column(Text, nullable=True)
    rubric_version: Mapped[str | None] = mapped_column(String(40), nullable=True)
    model_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    prompt_version: Mapped[int | None] = mapped_column(Integer, nullable=True, default=1)
    score_scale: Mapped[int | None] = mapped_column(Integer, nullable=True, default=100)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)

    record: Mapped[TrainingRecord] = relationship(back_populates="score")
    reviews: Mapped[list[ScoreReview]] = relationship(
        back_populates="score", order_by="ScoreReview.created_at", cascade="all, delete-orphan"
    )


class ScoreReview(Base):
    __tablename__ = "score_reviews"
    __table_args__ = (UniqueConstraint("score_id", name="uq_score_reviews_score_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    score_id: Mapped[int] = mapped_column(Integer, ForeignKey("scores.id", ondelete="CASCADE"))
    reviewed_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    detail_scores: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)

    score: Mapped[Score] = relationship(back_populates="reviews")
    reviewer: Mapped[User | None] = relationship()


class Note(Base, TimestampMixin):
    __tablename__ = "notes"
    __table_args__ = (Index("ix_notes_record_id", "record_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    record_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("training_records.id", ondelete="SET NULL"), nullable=True
    )
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(20), default="free")
    title: Mapped[str] = mapped_column(String(200), default="")
    content: Mapped[str] = mapped_column(Text)
    content_jsonb: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    tags: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    is_private: Mapped[bool] = mapped_column(Boolean, default=True)
    training_type: Mapped[str | None] = mapped_column(String(50), nullable=True)

    user: Mapped[User] = relationship()
    comments: Mapped[list[NoteComment]] = relationship(back_populates="note", cascade="all, delete-orphan")


class NoteComment(Base, TimestampMixin):
    __tablename__ = "note_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    note_id: Mapped[int] = mapped_column(Integer, ForeignKey("notes.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    content: Mapped[str] = mapped_column(Text)

    note: Mapped[Note] = relationship(back_populates="comments")
    user: Mapped[User] = relationship()


class NursingRecord(Base, TimestampMixin):
    __tablename__ = "nursing_records"
    __table_args__ = (Index("ix_nr_record_id", "record_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    record_id: Mapped[int] = mapped_column(Integer, ForeignKey("training_records.id", ondelete="CASCADE"), unique=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    sheet_data: Mapped[dict] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="draft")

    record: Mapped[TrainingRecord] = relationship()
    user: Mapped[User] = relationship()


class ScoringProgress(Base, TimestampMixin):
    __tablename__ = "scoring_progress"
    __table_args__ = (UniqueConstraint("record_id", name="uq_sp_record"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    record_id: Mapped[int] = mapped_column(Integer, ForeignKey("training_records.id", ondelete="CASCADE"), unique=True)
    stage: Mapped[str] = mapped_column(String(20), default="pending")
    percent: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)


class TrainingSessionState(Base):
    __tablename__ = "training_session_state"

    record_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("training_records.id", ondelete="CASCADE"), primary_key=True
    )
    emotion_state: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    initiative_timer: Mapped[float | None] = mapped_column(Float, nullable=True)
    initiative_last_trigger: Mapped[float | None] = mapped_column(Float, nullable=True)
    initiative_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("'0'"))
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)
    updated_at: Mapped[datetime] = mapped_column(default=_now_utc, onupdate=_now_utc)

    record: Mapped[TrainingRecord] = relationship(back_populates="session_state")
