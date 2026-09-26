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
        Index("ix_tr_case_revision", "case_revision_id"),
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
    #: 本次训练固化的 Workflow（docs/15 §二、§九）：训练开始时由**钉住的 CaseRevision** 解析
    #: 写入（``modules/training/workflows.workflow_for_case_revision``），之后不再变；运行期
    #: 一律 ``workflows.workflow_for_record(record)`` 读取，不再 import 任何 workflow 常量。
    #: server_default 只服务判别列落地前的存量行回填（迁移 f5a6b7c8d9e0 之后新增；当时唯一
    #: 现行 workflow 是 history_taking），与 ``is_test`` 同策。
    workflow_id: Mapped[str] = mapped_column(
        String(50), nullable=False, default="history_taking", server_default=text("'history_taking'")
    )
    #: 本次训练固化的病例版本（docs/15 §六）：复盘/评分按它来的版本解释 case_snapshot。
    #: 旧记录为 NULL（只有 case_snapshot，迁移前就固化了内容），新记录一律有值。
    case_revision_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("case_revisions.id", ondelete="RESTRICT", name="fk_training_records_case_revision_id"),
        nullable=True,
    )
    prompt_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    rubric_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    #: 本次训练使用的**上下文装配策略**身份（``ctx@{hash}``，由预算常量派生）。
    #: 记录级冻结：策略是代码派生的，记录创建时定版；历史记录为 NULL = 不可知（不回填）。
    context_policy_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # 乐观并发号（工具/变更写操作原子自增，旧值 409）——**不是**内容版本，
    # 与 CaseRevision.revision_no（病例内容修订）同名不同义，见 docs/17 §2.2。
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc)

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
    #: prompt_snapshot 的**形状**版本（v1 扁平 / v2 segments）。形状不是内容版本：
    #: 改名是为了消除「prompt_version 被读成提示词内容第几版」的同名异义
    #: （docs/review/tech-debt-audit-2026-09-14.md PIP-8）。
    prompt_schema_version: Mapped[int | None] = mapped_column(Integer, nullable=True, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc)

    # ── 评分契约（docs/16 §四/八）──
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

    @property
    def effective_total(self) -> float | None:
        """成绩口径：教师复核分优先，否则 AI 原始分（COALESCE(reviewed_total, total_score)）。"""
        if self.reviewed_total is not None:
            return float(self.reviewed_total)
        return float(self.total_score) if self.total_score is not None else None


class ScoreReview(Base):
    __tablename__ = "score_reviews"
    __table_args__ = (UniqueConstraint("score_id", name="uq_score_reviews_score_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    score_id: Mapped[int] = mapped_column(Integer, ForeignKey("scores.id", ondelete="CASCADE"))
    reviewed_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    detail_scores: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    total_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc)

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


class TrainingAction(Base):
    """Immutable operation audit log — one row per student action in a training.

    Phase 2.5：唯一审计表——同时承担 RPC 幂等（unique(record_id, request_id)）
    与域时间线（评分按序读取）。TrainingToolRequest 已删除。
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc)


class TrainingSessionState(Base):
    __tablename__ = "training_session_state"

    record_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("training_records.id", ondelete="CASCADE"), primary_key=True
    )
    emotion_state: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    initiative_timer: Mapped[float | None] = mapped_column(Float, nullable=True)
    initiative_last_trigger: Mapped[float | None] = mapped_column(Float, nullable=True)
    initiative_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("'0'"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc, onupdate=_now_utc)

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
