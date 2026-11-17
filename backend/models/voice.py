from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models._base import TimestampMixin, _now_utc

if TYPE_CHECKING:
    from models.auth import User


class VoiceConfig(Base, TimestampMixin):
    """TTS unified configuration. API key stored as plaintext.

    Uses the new Volcengine console single ``X-Api-Key`` (v3 binary protocol).

    ``api_key`` 只给 TTS；``asr_api_key`` 是独立的 ASR 凭据（SAUC 流式识别）。
    两者互不替代：ASR 没配就不工作，不会悄悄借用 TTS 的 Key。
    """

    __tablename__ = "voice_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider: Mapped[str] = mapped_column(String(20), default="volcengine")
    api_key: Mapped[str] = mapped_column(Text, default="")
    asr_api_key: Mapped[str] = mapped_column(Text, default="")
    tts_env_seeded: Mapped[bool] = mapped_column(Boolean, default=False)
    asr_env_seeded: Mapped[bool] = mapped_column(Boolean, default=False)
    tts_resource_id: Mapped[str] = mapped_column(String(64), default="seed-tts-2.0")
    tts_speaker: Mapped[str] = mapped_column(String(64), default="zh_female_vv_uranus_bigtts")
    tts_model: Mapped[str] = mapped_column(String(40), default="seed-tts-2.0-standard")
    tts_sample_rate: Mapped[int] = mapped_column(Integer, default=24000)
    tts_format: Mapped[str] = mapped_column(String(16), default="mp3")
    tts_timeout: Mapped[int] = mapped_column(Integer, default=8)
    monthly_budget: Mapped[float] = mapped_column(Float, default=200.0)
    is_active: Mapped[bool] = mapped_column(default=True)
    speaker_library: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class VoiceCallLog(Base):
    __tablename__ = "voice_call_logs"
    __table_args__ = (
        Index("ix_vcl_user_created", "user_id", "created_at"),
        Index("ix_vcl_direction", "direction"),
        Index("ix_vcl_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    record_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("training_records.id"), nullable=True)
    direction: Mapped[str] = mapped_column(String(10))  # "tts"
    text_length: Mapped[int] = mapped_column(Integer, default=0)
    emotion_state: Mapped[str | None] = mapped_column(String(20), nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="success")  # success | fallback | error
    cost_estimated: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc)

    user: Mapped[User] = relationship()


class VoiceDemoLog(Base):
    """语音实验室的实验采集记录（仅追加，**不是**训练档案）。

    每个 role 一行：学生说了什么、角色回了什么，都带着当时的四维情绪快照。没有
    ``record_id``、不关联 ``TrainingRecord``/``messages``——演示消耗与训练数据彻底分开，
    删除整张表也不影响任何训练证据链。

    写入策略：流结束（或中断）时把已生成的部分原样落地，``status`` 标明
    ``success`` / ``interrupted`` / ``error``，失败时 ``error`` 保留原因。这使"学生听到的
    半句"也能被采集到——采集目的正是研究打断与长句表现，不是复现完整对话。
    """

    __tablename__ = "voice_demo_logs"
    __table_args__ = (
        Index("ix_vdl_session", "session_id", "created_at"),
        Index("ix_vdl_user_created", "user_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    #: 前端页面会话 ID（演示页面自己生成，非训练会话）。
    session_id: Mapped[str] = mapped_column(String(64))
    character_id: Mapped[str] = mapped_column(String(40))
    role: Mapped[str] = mapped_column(String(12))  # "user" | "assistant"
    content: Mapped[str] = mapped_column(Text, default="")
    #: 当时的四维情绪快照（前端状态机的原样 JSON）。
    emotion_state: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="success")  # success | interrupted | error
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc, index=True)
