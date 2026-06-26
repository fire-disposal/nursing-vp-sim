from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models._base import TimestampMixin, _now_utc

if TYPE_CHECKING:
    from models.auth import User


class VoiceConfig(Base, TimestampMixin):
    """TTS + ASR unified configuration. API key is Fernet-encrypted.

    Uses the new Volcengine console single ``X-Api-Key`` (v3 protocol).
    """

    __tablename__ = "voice_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider: Mapped[str] = mapped_column(String(20), default="volcengine")
    api_key_enc: Mapped[str] = mapped_column(Text, default="")
    api_key_suffix: Mapped[str] = mapped_column(String(8), default="")
    tts_resource_id: Mapped[str] = mapped_column(String(64), default="seed-tts-2.0")
    tts_speaker: Mapped[str] = mapped_column(String(64), default="zh_female_vv_uranus_bigtts")
    tts_model: Mapped[str] = mapped_column(String(40), default="seed-tts-2.0-standard")
    tts_sample_rate: Mapped[int] = mapped_column(Integer, default=24000)
    tts_format: Mapped[str] = mapped_column(String(16), default="mp3")
    tts_timeout: Mapped[int] = mapped_column(Integer, default=8)
    asr_resource_id: Mapped[str] = mapped_column(String(64), default="volc.bigasr.sauc.duration")
    asr_sample_rate: Mapped[int] = mapped_column(Integer, default=16000)
    asr_endpoint_mode: Mapped[str] = mapped_column(String(24), default="bigmodel_nostream")
    monthly_budget: Mapped[float] = mapped_column(Float, default=200.0)
    is_active: Mapped[bool] = mapped_column(default=True)


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
    direction: Mapped[str] = mapped_column(String(10))  # "tts" | "asr"
    text_length: Mapped[int] = mapped_column(Integer, default=0)
    emotion_state: Mapped[str | None] = mapped_column(String(20), nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="success")  # success | fallback | error
    cost_estimated: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)

    user: Mapped[User] = relationship()
