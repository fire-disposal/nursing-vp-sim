"""成本限额守卫：用户按日、院校按月，0 = 不限；未配置用户额度时用默认值（日刷新）。

只做拦截，不参与结算。入口在真正花钱的地方调用（聊天回合、TTS、问答），
超限返回 429 + `code="budget_exceeded"`（前端按它提示"今日额度用尽"）。
平台账号不受用户日额度限制（它要跑系统任务），院校月额度对其仍不适用（无院校）。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from fastapi import HTTPException
from sqlalchemy import func

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

from core.config import USER_DAILY_LLM_LIMIT_CNY, USER_DAILY_TTS_LIMIT_CNY
from core.personas import is_super_admin
from core.statuses import LLMCallStatus
from infra.ops_queries import cn_day_start, cn_month_start
from models import LLMCallLog, SchoolBudget, User, UserBudget, VoiceCallLog

BUDGET_EXCEEDED_CODE = "budget_exceeded"


def _default_daily_limit(channel: str) -> float:
    return USER_DAILY_LLM_LIMIT_CNY if channel == "llm" else USER_DAILY_TTS_LIMIT_CNY


def effective_user_limit(db: Session, user: User, channel: str) -> tuple[float, str]:
    """用户日额度优先级：用户覆盖 > 院校默认 > 平台默认（0 = 不限）。"""
    row = db.query(UserBudget).filter(UserBudget.user_id == user.id).first()
    if row is not None:
        value = row.daily_llm_limit if channel == "llm" else row.daily_tts_limit
        return value, "user"
    school_id = getattr(user, "school_id", None)
    if school_id is not None:
        school_row = db.query(SchoolBudget).filter(SchoolBudget.school_id == school_id).first()
        if school_row is not None:
            value = school_row.default_daily_llm_limit if channel == "llm" else school_row.default_daily_tts_limit
            if value is not None:
                return value, "school"
    return _default_daily_limit(channel), "platform"


def _spend(
    db: Session, *, channel: str, since: datetime, user_id: int | None = None, school_id: int | None = None
) -> float:
    if channel == "llm":
        cost, ok_status = LLMCallLog.estimated_cost, LLMCallLog.status == LLMCallStatus.SUCCESS
        q = db.query(func.coalesce(func.sum(cost), 0.0)).filter(LLMCallLog.created_at >= since, ok_status)
        model = LLMCallLog
    else:
        cost, ok_status = VoiceCallLog.cost_estimated, VoiceCallLog.status == "success"
        q = db.query(func.coalesce(func.sum(cost), 0.0)).filter(VoiceCallLog.created_at >= since, ok_status)
        model = VoiceCallLog
    if user_id is not None:
        q = q.filter(model.user_id == user_id)
    if school_id is not None:
        q = q.join(User, User.id == model.user_id).filter(User.school_id == school_id)
    return float(q.scalar() or 0.0)


def _reject(*, scope: str, channel: str, limit: float, used: float, reset_at: datetime) -> None:
    raise HTTPException(
        status_code=429,
        detail={
            "code": BUDGET_EXCEEDED_CODE,
            "scope": scope,
            "channel": channel,
            "limit": round(limit, 4),
            "used": round(used, 4),
            "reset_at": reset_at.isoformat(),
        },
    )


def assert_within_budget(db: Session, user: User, channel: str) -> None:
    """调用花费入口前检查：用户的日额度与院校月额度。"""
    now = datetime.now(UTC)
    day_start = cn_day_start(now)
    month_start = cn_month_start(now)

    # 用户级：日刷新；平台账号豁免（系统任务）
    if not is_super_admin(user):
        limit, _source = effective_user_limit(db, user, channel)
        if limit > 0:
            used = _spend(db, channel=channel, since=day_start, user_id=user.id)
            if used >= limit:
                _reject(scope="user", channel=channel, limit=limit, used=used, reset_at=day_start + timedelta(days=1))

    # 院校级：按月；平台账号无院校，不适用
    school_id = getattr(user, "school_id", None)
    if school_id is not None:
        school_row = db.query(SchoolBudget).filter(SchoolBudget.school_id == school_id).first()
        if school_row is not None:
            limit = school_row.llm_monthly_limit if channel == "llm" else school_row.tts_monthly_limit
            if limit > 0:
                used = _spend(db, channel=channel, since=month_start, school_id=school_id)
                if used >= limit:
                    _reject(
                        scope="school",
                        channel=channel,
                        limit=limit,
                        used=used,
                        reset_at=month_start + timedelta(days=32),
                    )


def user_daily_spend(db: Session, user_id: int, channel: str) -> float:
    return _spend(db, channel=channel, since=cn_day_start(datetime.now(UTC)), user_id=user_id)


def school_monthly_spend(db: Session, school_id: int, channel: str) -> float:
    return _spend(db, channel=channel, since=cn_month_start(datetime.now(UTC)), school_id=school_id)
