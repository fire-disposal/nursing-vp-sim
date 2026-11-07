"""成本限额：院校级（月度）与用户级（每日，默认较充裕、日刷新）。

- 院校：`school_budgets.llm_monthly_limit/tts_monthly_limit`，0 = 不限；
- 用户：`user_budgets.daily_llm_limit/daily_tts_limit`，0 = 不限；
  没有行 = 使用配置默认值（`core/budget.py`，按日刷新）。
额度只用于拦截（`assert_within_budget`），不参与结算；未配置院校额度时行为与之前一致。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, text
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models._base import _now_utc


class SchoolBudget(Base):
    __tablename__ = "school_budgets"

    school_id: Mapped[int] = mapped_column(Integer, ForeignKey("schools.id", ondelete="CASCADE"), primary_key=True)
    llm_monthly_limit: Mapped[float] = mapped_column(Float, default=0.0, server_default=text("0"))
    tts_monthly_limit: Mapped[float] = mapped_column(Float, default=0.0, server_default=text("0"))
    # 院校给本校用户设的默认日额度；NULL = 继续继承平台默认。
    default_daily_llm_limit: Mapped[float | None] = mapped_column(Float, nullable=True)
    default_daily_tts_limit: Mapped[float | None] = mapped_column(Float, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc, onupdate=_now_utc)
    updated_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class UserBudget(Base):
    __tablename__ = "user_budgets"

    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    daily_llm_limit: Mapped[float] = mapped_column(Float, default=0.0, server_default=text("0"))
    daily_tts_limit: Mapped[float] = mapped_column(Float, default=0.0, server_default=text("0"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc, onupdate=_now_utc)
    updated_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
