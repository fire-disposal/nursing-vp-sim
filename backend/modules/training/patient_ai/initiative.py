"""Patient initiative engine — 四维情绪驱动的主动追问（重设计版）。

设计原则：
1. 主动追问是"患者的情绪行为"，不是定时器产物——四维情绪决定
   患者说不说（will_speak）、何时说（threshold）、怎么说（tone）。
2. 后端是唯一决策者与写入者：端点必须通过 can_initiate 守卫，
   前端任何响应都会停表，洪水在结构上不可能。
3. 生成必须看见真实上下文（学生最后消息 + 最近两轮），不做哑巴触发。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

from core.template import render_template
from infra.llm.client import CallContext
from infra.llm.profile import get_llm_config
from modules.training.prompts.initiative import INITIATIVE_SYSTEM, INITIATIVE_SYSTEM_SHORT
from modules.training.session.cache import InitiativeCache

log = logging.getLogger(__name__)

# 会话硬上限：每轮窗口至多 1 条 + 全会话至多 3 条（教学合理量）
MAX_INITIATIVE_PER_SESSION = 3
# 冷却：两次触发之间至少间隔
INITIATIVE_COOLDOWN_SECONDS = 60.0
# 阈值上下限
THRESHOLD_MIN = 15.0
THRESHOLD_MAX = 90.0


@dataclass
class InitiativePolicy:
    """四维情绪推导出的主动追问策略。"""

    will_speak: bool
    threshold: float
    tone: str
    refusal: str | None = None


# 沉默型情绪 → 患者不主动开口（沉默是角色，不是故障）
_SILENT_LABELS = {"withdrawn"}
# 低频型情绪 → 很少主动
_RARE_LABELS = {"defensive"}

_MOOD_LABELS = {
    "withdrawn": "沉默回避",
    "defensive": "防御抵触",
    "anxious_guarded": "焦虑戒备",
    "anxious_cooperative": "焦虑但配合",
    "trusting_anxious": "信任但焦虑",
    "neutral": "正常",
    "relaxed": "放松配合",
    "open_trusting": "开放信任",
    "irritated": "烦躁抵触",
}


def _mood_of(vector) -> str:
    from modules.training.patient_ai.emotion import resolve_dominant_state

    label = resolve_dominant_state(vector)
    return _MOOD_LABELS.get(label, "正常")


def derive_initiative_policy(vector, personality: dict) -> InitiativePolicy:
    """从四维情绪 + 性格推导主动追问策略（纯函数）。"""
    from modules.training.patient_ai.emotion import resolve_dominant_state

    label = resolve_dominant_state(vector)
    mood = _MOOD_LABELS.get(label, "正常")

    # 1. 说不说：沉默/防御型情绪下患者不主动
    if label in _SILENT_LABELS:
        return InitiativePolicy(will_speak=False, threshold=THRESHOLD_MAX, tone=mood, refusal="withdrawn")
    if label in _RARE_LABELS:
        return InitiativePolicy(will_speak=False, threshold=THRESHOLD_MAX, tone=mood, refusal="defensive")

    # 2. 何时说：焦虑/烦躁缩短，开放/放松拉长
    threshold = 30.0
    if vector.anxiety >= 0.6:
        threshold -= 15
    if vector.irritation >= 0.6:
        threshold -= 10
    if label in ("relaxed", "open_trusting"):
        threshold += 10

    # 性格修正（保留既有语义：急脾气/易紧张催得更早）
    patience = personality.get("patience", "normal")
    anxiety_trait = personality.get("anxiety_trait", "normal")
    threshold += {"low": -8, "normal": 0, "high": 10}.get(patience, 0)
    threshold += {"anxious": -5, "normal": 0, "calm": 5}.get(anxiety_trait, 0)

    threshold = max(THRESHOLD_MIN, min(THRESHOLD_MAX, threshold))
    return InitiativePolicy(will_speak=True, threshold=threshold, tone=mood)


def can_initiate(
    record_id: int,
    cache: InitiativeCache,
    db: Session,
    policy: InitiativePolicy,
) -> tuple[bool, str | None]:
    """端点权威守卫 — 全部满足才允许触发（纯逻辑，可单测）。

    返回 (允许?, 拒绝原因)。原因: max_reached / patient_silent / cooldown / not_ready。
    """
    now = datetime.now(UTC).timestamp()

    if cache.get_count(record_id, db) >= MAX_INITIATIVE_PER_SESSION:
        return False, "max_reached"
    if not policy.will_speak:
        return False, policy.refusal or "patient_silent"

    last_trigger = cache.get_last_trigger(record_id, db)
    if now - last_trigger < INITIATIVE_COOLDOWN_SECONDS:
        return False, "cooldown"

    elapsed = now - cache.get_timer(record_id, now, db)
    if elapsed < policy.threshold:
        return False, "not_ready"

    return True, None


def get_initiative_policy_seconds(
    record_id: int,
    cache: InitiativeCache,
    db: Session,
    vector,
    personality: dict,
) -> tuple[float, float]:
    """side_effects 展示用：elapsed + 当前策略阈值。"""
    now = datetime.now(UTC).timestamp()
    elapsed = now - cache.get_timer(record_id, now, db)
    policy = derive_initiative_policy(vector, personality)
    return elapsed, policy.threshold


def describe_traits(personality: dict) -> str:
    parts = []
    v = personality.get("verbosity", "normal")
    if v == "verbose":
        parts.append("话多健谈")
    elif v == "terse":
        parts.append("寡言少语")
    p = personality.get("patience", "normal")
    if p == "low":
        parts.append("缺乏耐心")
    elif p == "high":
        parts.append("很有耐心")
    a = personality.get("anxiety_trait", "normal")
    if a == "anxious":
        parts.append("容易紧张")
    elif a == "calm":
        parts.append("性格沉稳")
    return "性格特点：" + "，".join(parts) if parts else ""


async def generate_initiative_llm(
    llm_client,
    vector,
    personality: dict,
    case_name: str,
    student_msg: str,
    context_tail: str,
    *,
    ctx: CallContext | None = None,
) -> str:
    """情绪基调 + 真实对话上下文生成患者主动话语。"""
    tone = _mood_of(vector)
    traits = describe_traits(personality)

    llm_cfg = get_llm_config("patient_chat")
    kwargs = {
        "case_name": case_name,
        "traits": traits,
        "mood": tone,
        "trust": str(round(vector.trust * 100)),
        "comfort": str(round((1.0 - vector.anxiety * 0.5 - vector.irritation * 0.5) * 100)),
        "student_msg": student_msg or "（护士在沉默）",
        "context_tail": context_tail or "（暂无对话）",
    }

    try:
        system = render_template(INITIATIVE_SYSTEM, **kwargs)
        result = await llm_client.call(
            [{"role": "system", "content": system}],
            purpose="patient_chat",
            ctx=ctx,
            **llm_cfg,
        )
        text = result.strip()
        if 8 <= len(text) <= 80:
            return text
    except Exception:
        log.warning("LLM initiative attempt 1 failed, retrying with simpler prompt", exc_info=True)

    try:
        system = render_template(INITIATIVE_SYSTEM_SHORT, **kwargs)
        result = await llm_client.call(
            [{"role": "system", "content": system}],
            purpose="patient_chat",
            ctx=ctx,
            **llm_cfg,
        )
        text = result.strip()
        if 5 <= len(text) <= 80:
            return text
    except Exception:
        log.warning("LLM initiative attempt 2 failed", exc_info=True)

    return _last_resort_fallback(tone)


def _last_resort_fallback(mood: str) -> str:
    fallbacks = {
        "沉默回避": "（沉默地等着）",
        "防御抵触": "（沉默地等着）",
        "焦虑不安": "[不安地挪动身体]",
        "放松配合": "不急，你慢慢问。",
        "正常": "还有什么要问的吗？",
        "开放信任": "你还有什么想了解的？",
    }
    return fallbacks.get(mood, "……")


# ── Cache 操作（基础设施，保留） ──


def update_initiative_timer(record_id: int, cache: InitiativeCache, db: Session) -> None:
    now = datetime.now(UTC).timestamp()
    cache.update_timer(record_id, now, db)


def mark_initiative_triggered(record_id: int, cache: InitiativeCache, db: Session) -> int:
    """触发记账：last_trigger = now，count += 1。返回新计数。"""
    now = datetime.now(UTC).timestamp()
    cache.set_last_trigger(record_id, now, db)
    cache.update_timer(record_id, now, db)
    return cache.increment_count(record_id, db)


def apply_initiative_penalty(
    record_id: int,
    cache: InitiativeCache,
    db: Session,
) -> dict:
    """学生忽视患者 → 情绪惩罚（信任下降）。"""
    from modules.training.patient_ai.emotion import EmotionDelta, EmotionRepository

    try:
        repo = EmotionRepository()
        state = repo.get(record_id, db)
        if not state:
            return {}
        delta = EmotionDelta(trust=-8, cooperation=-4)
        state, events = repo.apply(record_id, delta, db, source="initiative_penalty")
        return {"trust": state.vector.trust, "anxiety": state.vector.anxiety}
    except Exception:
        log.warning("Initiative penalty failed: record_id=%d", record_id, exc_info=True)
        return {}


def cleanup_initiative(record_id: int, cache: InitiativeCache, db: Session) -> None:
    cache.cleanup(record_id, db)
