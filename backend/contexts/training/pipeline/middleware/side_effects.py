"""side_effects — post-reply effects including emotion analysis, initiative generation and action monitoring."""

import logging
import re

from contexts.patient.emotion import get_emotion
from contexts.patient.initiative import (
    generate_initiative_llm,
    get_initiative_seconds,
    should_initiate,
    update_initiative_timer,
)
from models import Message

from ..context import PipelineContext

log = logging.getLogger(__name__)

# ── 患者动作关键词 → 情绪衰减映射 ──
# AI 在对话中可能输出括号动作描述，如（无奈地摇头）（皱着眉叹气）
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


def _analyze_response_emotion(reply: str) -> tuple[int, int, str]:
    """Analyze LLM patient response for emotional cues. Returns (trust_delta, comfort_delta, label)."""
    positive = ["谢谢", "好多了", "舒服", "放心", "明白", "好的", "可以", "没事"]
    negative = ["痛", "难受", "担心", "害怕", "紧张", "不安", "不舒服", "不好"]
    resistant = ["不想", "不要", "不愿", "随便", "算了", "不知道", "别问了"]

    pos = sum(1 for s in positive if s in reply)
    neg = sum(1 for s in negative if s in reply)
    res = sum(1 for s in resistant if s in reply)

    if res > 0 and neg > 0:
        return (-6, -10, "response:抗拒")
    if neg > pos:
        return (-4, -6, "response:消极")
    if pos > neg:
        return (4, 6, "response:积极")
    return (0, 0, "")


_ACTION_RE = re.compile(r"[（(][^）)]*[）)]")


def _apply_action_emotion(reply: str) -> tuple[int, int, str]:
    """Extract action-based emotion deltas from reply. Returns (trust_delta, comfort_delta, label)."""
    matches = _ACTION_RE.findall(reply)
    if not matches:
        return (0, 0, "")

    best_dt = 0
    best_dc = 0
    best_keyword = None
    for action_text in matches:
        for keyword, t_delta, c_delta in ACTION_EMOTION_DELTAS:
            if keyword in action_text:
                if t_delta < best_dt or (t_delta == best_dt and c_delta < best_dc):
                    best_dt = t_delta
                    best_dc = c_delta
                    best_keyword = keyword
                break

    if best_dt == 0 and best_dc == 0:
        return (0, 0, "")
    return (best_dt, best_dc, f"动作:{best_keyword or '未知'}")


async def side_effects(ctx: PipelineContext, next_mw) -> None:
    await next_mw()

    if ctx.error or ctx.should_shortcut:
        return

    app = ctx.app_state
    features = ctx.state.get("features") or {}

    if features.get("emotion") and ctx.llm_reply:
        emotion_cache = getattr(app, "emotion_cache", None)
        if emotion_cache is None:
            return
        emotion = get_emotion(ctx.record.id, emotion_cache, ctx.db)
        emotion.decay()

        action_dt, action_dc, action_label = _apply_action_emotion(ctx.llm_reply)
        resp_dt, resp_dc, resp_label = _analyze_response_emotion(ctx.llm_reply)

        dt_total = action_dt + resp_dt
        dc_total = action_dc + resp_dc
        label_parts = []
        if action_label:
            label_parts.append(action_label)
        if resp_label:
            label_parts.append(resp_label)

        if dt_total != 0 or dc_total != 0:
            label = "+".join(label_parts) if label_parts else ""
            emotion.update(dt_total, dc_total, label)
            ctx.system_events.append(
                {
                    "emotion_change": {
                        "state": emotion.state,
                        "trust": emotion.trust,
                        "comfort": emotion.comfort,
                    }
                }
            )

    if not features.get("patient_initiative") or not ctx.llm_reply:
        return

    initiative_cache = getattr(app, "initiative_cache", None)
    if initiative_cache is None:
        return

    try:
        emotion_state = get_emotion(ctx.record.id, app.emotion_cache, ctx.db)
        case_data = ctx.case_data or {}
        personality = case_data.get("personality", {}) or case_data.get("patient_info", {}).get("personality", {})

        # Emit initiative state for frontend polling
        elapsed, threshold = get_initiative_seconds(
            ctx.record.id, initiative_cache, ctx.db, personality, emotion_state.trust, emotion_state.comfort
        )
        ctx.system_events.append(
            {
                "initiative_state": {
                    "elapsed_seconds": round(elapsed, 1),
                    "threshold_seconds": round(threshold, 1),
                    "percent": min(100, round(elapsed / max(1, threshold) * 100, 1)),
                }
            }
        )

        if not should_initiate(
            ctx.record.id, initiative_cache, ctx.db, personality, emotion_state.trust, emotion_state.comfort
        ):
            update_initiative_timer(ctx.record.id, initiative_cache, ctx.db)
            return

        msg_text = await generate_initiative_llm(
            ctx.app_state.llm_client,
            personality,
            emotion_state.trust,
            emotion_state.comfort,
            case_data.get("name", "未知病例"),
            ctx.student_input or "",
        )
        if not msg_text:
            return

        msg = Message(record_id=ctx.record.id, role="patient", content=msg_text)
        ctx.db.add(msg)
        ctx.db.flush()

        ctx.state.setdefault("_saved_messages", []).append(msg)
        ctx.state.setdefault("_post_stream_events", []).append({"initiative": {"content": msg_text, "id": msg.id}})
    except Exception:
        log.warning("Initiative generation failed: record_id=%d", ctx.record.id, exc_info=True)
    finally:
        update_initiative_timer(ctx.record.id, initiative_cache, ctx.db, len(ctx.llm_reply or ""))

    ctx.db.commit()
