from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models._base import TimestampMixin, _now_utc

if TYPE_CHECKING:
    from models.assignment import Assignment
    from models.auth import User
    from models.case import Case


class TrainingRecord(Base):
    __tablename__ = "training_records"
    __table_args__ = (
        Index("ix_tr_user_status", "user_id", "status"),
        Index("ix_tr_status", "status"),
        Index("ix_tr_start_time", "start_time"),
        Index("ix_tr_case_id", "case_id"),
        CheckConstraint(
            "status IN ('in_progress', 'completed', 'abandoned', 'discarded')",
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
    practice_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    runtime_state: Mapped[dict] = mapped_column(JSONB, server_default=text("'{}'::jsonb"), default=dict)
    status: Mapped[str] = mapped_column(String(20), default="in_progress")
    scoring_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    scoring_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    time_limit: Mapped[int] = mapped_column(Integer, default=20)
    case_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    training_type: Mapped[str] = mapped_column(String(50), default="history_taking")
    prompt_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    rubric_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    assignment_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("assignments.id", ondelete="SET NULL"), nullable=True
    )
    is_overdue: Mapped[bool] = mapped_column(default=False, server_default=text("false"))
    is_test: Mapped[bool] = mapped_column(default=False, server_default=text("false"))
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc)
    end_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship(back_populates="training_records")
    case: Mapped[Case] = relationship()
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
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)

    # ── Phase 1 评分契约（refactor-scoring.md §2）──
    # raw_total: Σ条目原始分（0..raw_max），NULL = 旧口径历史分（不可逆）
    # mapping_version: 映射曲线版本（0=旧口径，1=现行线性映射）
    # fallback: {kind, note, attempts} 兜底/降级标记——非 NULL 时必须 UI 呈现且不进排行榜
    # dim_total: LLM 维度自评快照（展示用，不参与总分）
    # reviewed_total/reviewed_at: 教师复核写回（成绩口径 = COALESCE(reviewed_total, total_score)）
    raw_total: Mapped[float | None] = mapped_column(Float, nullable=True)
    mapping_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    fallback: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    dim_total: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    reviewed_total: Mapped[float | None] = mapped_column(Float, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

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
    total_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)

    score: Mapped[Score] = relationship(back_populates="reviews")
    reviewer: Mapped[User | None] = relationship()


class NursingRecord(Base, TimestampMixin):
    __tablename__ = "nursing_records"
    __table_args__ = (Index("ix_nr_record_id", "record_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    record_id: Mapped[int] = mapped_column(Integer, ForeignKey("training_records.id", ondelete="CASCADE"), unique=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    sheet_data: Mapped[dict] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    record: Mapped[TrainingRecord] = relationship()
    user: Mapped[User] = relationship()


class TrainingToolRequest(Base):
    __tablename__ = "training_tool_requests"
    __table_args__ = (
        UniqueConstraint("record_id", "request_id", name="uq_training_tool_request"),
        Index("ix_training_tool_requests_record_id", "record_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    record_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("training_records.id", ondelete="CASCADE"), nullable=False
    )
    request_id: Mapped[str] = mapped_column(String(64), nullable=False)
    tool_name: Mapped[str] = mapped_column(String(50), nullable=False)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    response: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)


class TrainingAction(Base):
    """Immutable operation audit log — one row per student action in a training.

    Unlike TrainingToolRequest (RPC dedup log), this is the domain timeline:
    scoring reads actions in chronological order to evaluate student choices.
    """

    __tablename__ = "training_actions"
    __table_args__ = (
        UniqueConstraint("record_id", "request_id", name="uq_training_action_record_request"),
        Index("ix_training_actions_record_id", "record_id"),
        Index("ix_training_actions_record_kind", "record_id", "kind"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    record_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("training_records.id", ondelete="CASCADE"), nullable=False
    )
    request_id: Mapped[str] = mapped_column(String(64), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    input: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    result: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)


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


class TrainingSessionEmotionState(Base):
    """四维情绪当前状态 — 每 training record 一行，乐观锁版本控制。"""

    __tablename__ = "training_session_emotion_state"

    record_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("training_records.id", ondelete="CASCADE"), primary_key=True
    )
    trust: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    anxiety: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    irritation: Mapped[float] = mapped_column(Float, nullable=False, default=0.35)
    cooperation: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    last_turn_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc, onupdate=_now_utc)

    record: Mapped[TrainingRecord] = relationship()


class TrainingSessionEmotionEvent(Base):
    """情绪事件历史 — append-only 审计日志。"""

    __tablename__ = "training_session_emotion_event"
    __table_args__ = (
        Index("ix_emotion_event_record_id", "record_id"),
        Index("ix_emotion_event_turn_id", "turn_id"),
    )

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=text("gen_random_uuid()"))
    record_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("training_records.id", ondelete="CASCADE"), nullable=False
    )
    turn_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    evidence: Mapped[str] = mapped_column(Text, nullable=False, default="")
    delta: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    before_state: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    after_state: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc)

    record: Mapped[TrainingRecord] = relationship()
