"""side_effects — post-reply effects including emotion analysis and initiative state emission."""

import logging
import re

from contexts.patient.emotion import get_emotion
from contexts.patient.initiative import MAX_INITIATIVE_COUNT, get_initiative_seconds

from ..context import (
    STATE_FEATURES,
    PipelineContext,
)

log = logging.getLogger(__name__)

# ── 患者动作关键词 → 情绪衰减映射 ──
# AI 在对话中可能输出括号动作描述，如（无奈地摇头）（皱着眉叹气）
# 元组: (关键词, trust_delta, comfort_delta)
# 注意：第一条匹配优先，较强烈的情绪动作应排在同类前面
ACTION_EMOTION_DELTAS: list[tuple[str, int, int]] = [
    # 强烈负面
    ("愤怒", -8, -12),
    ("发火", -8, -12),
    ("生气", -6, -10),
    ("抗拒", -6, -10),
    ("挣扎", -6, -8),
    ("激动", -4, -8),
    ("痛苦", -5, -8),
    ("哭泣", -4, -8),
    ("哭了", -4, -8),
    ("流泪", -3, -6),
    ("难受", -4, -6),
    ("不耐烦", -3, -6),
    ("烦躁", -3, -6),
    ("无奈", -2, -5),
    ("叹气", -2, -4),
    ("摇头", -2, -4),
    ("不安", -2, -4),
    ("紧张", -1, -4),
    ("皱眉", -1, -3),
    ("勉强", -1, -3),
    ("尴尬", -1, -2),
    ("犹豫", -1, -2),
    ("低头", -1, -2),
    ("回避", -2, -4),
    # 中性 / 正面
    ("微笑", 0, 2),
    ("点头", 1, 2),
    ("放松", 1, 3),
    ("笑了", 1, 3),
    ("感激", 3, 5),
    ("信任", 3, 4),
]


def _analyze_response_emotion(reply: str) -> tuple[int, int, str]:
    """Analyze LLM patient response for emotional cues. Returns (trust_delta, comfort_delta, label).

    Uses weighted keyword matching across multiple emotional categories.
    Negative and resistant keywords outweigh positive to capture subtle distress.
    """
    # 扩展关键词集，按严重程度分组
    strong_negative = ["痛死了", "受不了", "太痛", "疼死", "烦死了", "烦人", "讨厌", "别碰", "走开"]
    mild_negative = [
        "痛",
        "疼",
        "难受",
        "担心",
        "害怕",
        "紧张",
        "不安",
        "不舒服",
        "不好",
        "累",
        "困了",
        "无聊",
        "焦虑",
        "担心",
        "失望",
        "烦",
        "没精神",
        "头晕",
        "恶心",
        "吃不下",
        "睡不好",
        "没胃口",
    ]
    resistant = ["不想", "不要", "不愿", "随便", "算了", "别问了", "别管", "不知道"]
    strong_positive = ["谢谢", "好多了", "放心了", "太好了", "舒服多了", "感激", "信任"]
    mild_positive = ["好的", "可以", "没事", "还行", "还好", "明白了", "嗯嗯", "好"]

    # 计算权重：强烈情绪加倍
    sn = sum(3 for s in strong_negative if s in reply)
    mn = sum(1 for s in mild_negative if s in reply)
    res = sum(2 for s in resistant if s in reply)
    sp = sum(2 for s in strong_positive if s in reply)
    mp = sum(1 for s in mild_positive if s in reply)

    # 防守性回答 → 信任下降为主
    if res > 0 and (sn + mn) > 0:
        return (-8, -12, "response:抗拒")
    if res >= 2:
        return (-5, -8, "response:退缩")

    # 强烈负面
    if sn >= 3 or (sn > 0 and mn >= 2):
        return (-8, -10, "response:强烈负面")

    # 负面占优
    neg_weight = sn + mn + res
    pos_weight = sp + mp
    if neg_weight > pos_weight * 1.5:
        return (-5, -7, "response:消极")
    if neg_weight > pos_weight:
        return (-3, -4, "response:略消极")

    # 积极占优
    if pos_weight > neg_weight * 2:
        return (5, 7, "response:积极")
    if pos_weight > neg_weight:
        return (2, 3, "response:略积极")

    return (0, 0, "")


_ACTION_RE = re.compile(r"[（(][^）)]*[）)]")


def _apply_action_emotion(reply: str) -> tuple[int, int, str]:
    """Extract action-based emotion deltas from reply. Returns (trust_delta, comfort_delta, label).

    For each matched action text, picks the MOST negative (or most positive) delta
    among matched keywords, then returns the worst overall.
    """
    matches = _ACTION_RE.findall(reply)
    if not matches:
        return (0, 0, "")

    worst_dt = 0
    worst_dc = 0
    worst_keyword = None
    for action_text in matches:
        best_neg_dt = 0
        best_neg_dc = 0
        best_neg_kw = None
        for keyword, t_delta, c_delta in ACTION_EMOTION_DELTAS:
            if keyword in action_text:
                # Pick the most negative for this action
                if t_delta < best_neg_dt or (t_delta == best_neg_dt and c_delta < best_neg_dc):
                    best_neg_dt = t_delta
                    best_neg_dc = c_delta
                    best_neg_kw = keyword

        if best_neg_kw:
            # Accumulate the worst delta across all actions
            if best_neg_dt < worst_dt or (best_neg_dt == worst_dt and best_neg_dc < worst_dc):
                worst_dt = best_neg_dt
                worst_dc = best_neg_dc
                worst_keyword = best_neg_kw

    if worst_dt == 0 and worst_dc == 0:
        return (0, 0, "")
    return (worst_dt, worst_dc, f"动作:{worst_keyword or '未知'}")


async def side_effects(ctx: PipelineContext, next_mw) -> None:
    await next_mw()

    if ctx.error or ctx.should_shortcut:
        return

    app = ctx.app_state
    features = ctx.state.get(STATE_FEATURES) or {}

    training_type = getattr(ctx.record, "training_type", None) or "history_taking"
    try:
        from profiles.registry import get_profile
        profile = get_profile(training_type)
    except KeyError:
        profile = None

    has_emotion = profile.has_emotion if profile else features.get("emotion", False)

    if has_emotion and ctx.llm_reply:
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
            emotion_cache.set(ctx.record.id, emotion, ctx.db)
            ctx.system_events.append(
                {
                    "emotion_change": {
                        "state": emotion.state,
                        "trust": emotion.trust,
                        "comfort": emotion.comfort,
                    }
                }
            )

    has_initiative = profile.has_initiative if profile else features.get("patient_initiative", False)
    if not has_initiative or not ctx.llm_reply:
        return

    initiative_cache = getattr(app, "initiative_cache", None)
    if initiative_cache is None:
        return

    try:
        emotion_state = get_emotion(ctx.record.id, app.emotion_cache, ctx.db)
        case_data = ctx.case_data or {}
        personality = case_data.get("personality", {}) or case_data.get("patient_info", {}).get("personality", {})

        # Emit initiative state for frontend polling bar
        elapsed, threshold = get_initiative_seconds(
            ctx.record.id, initiative_cache, ctx.db, personality, emotion_state.trust, emotion_state.comfort
        )
        count = initiative_cache.get_count(ctx.record.id, ctx.db)
        max_reached = count >= MAX_INITIATIVE_COUNT
        ctx.system_events.append(
            {
                "initiative_state": {
                    "elapsed_seconds": round(elapsed, 1),
                    "threshold_seconds": round(threshold, 1),
                    "percent": min(100, round(elapsed / max(1, threshold) * 100, 1)),
                    "initiative_count": count,
                    "max_reached": max_reached,
                }
            }
        )
    except Exception:
        log.warning("Initiative state emission failed: record_id=%d", ctx.record.id, exc_info=True)

    ctx.db.commit()
