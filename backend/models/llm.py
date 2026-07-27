from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models._base import TimestampMixin, _now_utc


class ApiSecret(Base, TimestampMixin):
    __tablename__ = "api_secrets"


    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    label: Mapped[str] = mapped_column(String(80))
    api_key: Mapped[str] = mapped_column(Text)
    base_url: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(20), default="active")
    degraded_reason: Mapped[str | None] = mapped_column(String(40), nullable=True)
    degraded_until: Mapped[datetime | None] = mapped_column(nullable=True)
    price_input_per_1m: Mapped[float] = mapped_column(Numeric(10, 6), default=0)
    price_output_per_1m: Mapped[float] = mapped_column(Numeric(10, 6), default=0)
    monthly_cost_limit: Mapped[float | None] = mapped_column(Numeric(12, 6), nullable=True)
    call_count_today: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens_today: Mapped[int] = mapped_column(BigInteger, default=0)
    total_cost_today: Mapped[float] = mapped_column(Numeric(12, 6), default=0)
    monthly_cost_used: Mapped[float] = mapped_column(Numeric(12, 6), default=0)
    stats_date: Mapped[datetime | None] = mapped_column(nullable=True)
    stats_month: Mapped[str | None] = mapped_column(String(7), nullable=True)
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0)
    last_used_at: Mapped[datetime | None] = mapped_column(nullable=True)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    model_override: Mapped[str | None] = mapped_column(String(80), nullable=True, default=None)


class LLMCallLog(Base):
    __tablename__ = "llm_call_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    record_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("training_records.id"), nullable=True, index=True)
    case_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("cases.id"), nullable=True, index=True)
    purpose: Mapped[str] = mapped_column(String(40), index=True)
    provider_name: Mapped[str] = mapped_column(String(40), default="deepseek")
    api_key_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    config_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    secret_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("api_secrets.id", ondelete="SET NULL"), nullable=True, index=True
    )
    model: Mapped[str] = mapped_column(String(80))
    temperature: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    token_estimated: Mapped[int] = mapped_column(Integer, default=1)
    estimated_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    cost_currency: Mapped[str | None] = mapped_column(String(10), nullable=True, default="CNY")
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="success", server_default=text("'success'"), index=True)
    error_type: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    request_chars: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_chars: Mapped[int | None] = mapped_column(Integer, nullable=True)
    request_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    cache_hit_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cache_miss_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(index=True, default=_now_utc)
