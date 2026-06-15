"""side_effects — post-reply effects including initiative generation and action monitoring."""

import logging
import re
from datetime import UTC, datetime

from contexts.patient.emotion import EmotionState, get_emotion
from contexts.patient.initiative import generate_initiative, should_initiate, update_initiative_timer
from models import Message

from ..context import PipelineContext

log = logging.getLogger(__name__)

# ── 患者动作关键词 → 情绪衰减映射 ──
# AI 在对话中可能输出括号动作描述，如（无奈地摇头）（皱着眉叹气）
# 优先级越靠前越优先匹配
ACTION_EMOTION_DELTAS: list[tuple[str, int, int]] = [
    ("痛苦", -5, -8),
    ("难受", -4, -6),
    ("不耐烦", -3, -6),
    ("无奈", -2, -5),
    ("叹气", -2, -4),
    ("不安", -2, -4),
    ("紧张", -1, -4),
    ("皱眉", -1, -3),
    ("勉强", -1, -3),
    ("尴尬", -1, -2),
    ("犹豫", -1, -2),
    ("微笑", 0, 2),
    ("放松", 1, 3),
    ("点头", 1, 2),
]

_ACTION_RE = re.compile(r"[（(][^）)]*[）)]")


def _apply_action_emotion(emotion: EmotionState, reply: str) -> bool:
    """从患者回复中提取动作描述并匹配情绪衰减。返回 True 表示有变更。"""
    matches = _ACTION_RE.findall(reply)
    if not matches:
        return False

    dt, dc = 0, 0
    matched = None
    for action_text in " ".join(matches):
        for keyword, t_delta, c_delta in ACTION_EMOTION_DELTAS:
            if keyword in action_text:
                if t_delta < dt or (t_delta == dt and c_delta < dc):
                    dt = t_delta
                    dc = c_delta
                    matched = keyword
                break

    if dt == 0 and dc == 0:
        return False

    old_t, old_c = emotion.trust, emotion.comfort
    emotion.trust = max(0, min(100, emotion.trust + dt))
    emotion.comfort = max(0, min(100, emotion.comfort + dc))
    if old_t == emotion.trust and old_c == emotion.comfort:
        return False

    emotion.history.append({
        "trust": emotion.trust,
        "comfort": emotion.comfort,
        "state": emotion.state,
        "intent": f"动作:{matched or '未知'}",
        "timestamp": datetime.now(UTC).isoformat(),
    })
    return True


async def side_effects(ctx: PipelineContext, next_mw) -> None:
    await next_mw()

    if ctx.error or ctx.should_shortcut:
        return

    app = ctx.app_state
    features = ctx.state.get("features") or {}

    if features.get("emotion") and ctx.llm_reply:
        emotion = get_emotion(ctx.record.id, app.emotion_cache)
        if _apply_action_emotion(emotion, ctx.llm_reply):
            ctx.system_events.append({
                "emotion_change": {
                    "state": emotion.state,
                    "trust": emotion.trust,
                    "comfort": emotion.comfort,
                }
            })

    if not features.get("patient_initiative") or not ctx.llm_reply:
        return

    initiative_cache = getattr(app, "initiative_cache", None)
    if initiative_cache is None:
        return

    try:
        emotion_state = get_emotion(ctx.record.id, app.emotion_cache)
        case_data = ctx.case_data or {}
        personality = case_data.get("personality", {}) or case_data.get("patient_info", {}).get("personality", {})

        if not should_initiate(
            ctx.record.id, initiative_cache, personality, emotion_state.trust, emotion_state.comfort
        ):
            update_initiative_timer(ctx.record.id, initiative_cache, len(ctx.llm_reply))
            return

        msg_text = generate_initiative(personality, emotion_state.trust, emotion_state.comfort, 999.0)
        if not msg_text:
            return

        msg = Message(record_id=ctx.record.id, role="patient", content=msg_text)
        ctx.db.add(msg)
        ctx.db.commit()
        ctx.db.refresh(msg)

        ctx.state.setdefault("_saved_messages", []).append(msg)
        ctx.state.setdefault("_post_stream_events", []).append({"initiative": {"content": msg_text, "id": msg.id}})
    except Exception:
        log.warning("Initiative generation failed: record_id=%d", ctx.record.id, exc_info=True)
    finally:
        update_initiative_timer(ctx.record.id, initiative_cache, len(ctx.llm_reply or ""))
