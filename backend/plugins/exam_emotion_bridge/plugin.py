"""ExamEmotionBridgePlugin — exam operations impact patient trust/comfort."""

from core.feature_flags import FeatureFlag

from plugins.base import ExamContext, ExamEffect, Plugin


EXAM_EMOTION_IMPACT: dict[str, dict] = {
    "temp": {"category": "routine", "trust_no": 0, "comfort_no": -1, "trust_yes": 0, "comfort_yes": 0},
    "bp": {"category": "routine", "trust_no": 0, "comfort_no": -1, "trust_yes": 0, "comfort_yes": 0},
    "hr": {"category": "routine", "trust_no": 0, "comfort_no": -1, "trust_yes": 0, "comfort_yes": 0},
    "rr": {"category": "routine", "trust_no": 0, "comfort_no": -1, "trust_yes": 0, "comfort_yes": 0},
    "spo2": {"category": "routine", "trust_no": 0, "comfort_no": -1, "trust_yes": 0, "comfort_yes": 0},
    "vitals": {"category": "bundle", "trust_no": 0, "comfort_no": -3, "trust_yes": 0, "comfort_yes": -1},
    "skin": {"category": "moderate", "trust_no": -2, "comfort_no": -5, "trust_yes": -1, "comfort_yes": -2},
    "pain": {"category": "moderate", "trust_no": -1, "comfort_no": -3, "trust_yes": 0, "comfort_yes": -1},
}

_CUMULATIVE_THRESHOLDS: list[tuple[int, int, int]] = [
    (4, 0, -2),
    (7, -1, -4),
    (10, -2, -6),
]

_EXAM_EMOTION_IMPACT_LABELS: dict[str, str] = {
    "temp": "体温测量",
    "bp": "血压测量",
    "hr": "心率测量",
    "rr": "呼吸频率测量",
    "spo2": "血氧测量",
    "vitals": "全套生命体征",
    "skin": "皮肤检查",
    "pain": "疼痛评估",
}


class ExamEmotionBridgePlugin(Plugin):
    id = "exam-emotion-bridge"
    name = "查体-情绪联动"
    description = "查体操作会影响患者心态：缺少解释或进行不相关检查时信任/舒适下降"
    requires = ["emotion", "physical-exam"]
    feature_flag = FeatureFlag(
        key="exam_emotion_bridge",
        label="查体-情绪联动",
        default=False,
        description="查体操作影响患者心态：缺乏解释或不相关检查会降低信任/舒适度",
    )

    async def on_exam(self, ctx: ExamContext) -> ExamEffect | None:
        return _apply_exam_emotion_effect(ctx)


def _apply_exam_emotion_effect(ctx: ExamContext) -> ExamEffect | None:
    from contexts.patient.emotion import get_emotion

    emotion = get_emotion(ctx.record.id, ctx.emotion_cache)
    impact = EXAM_EMOTION_IMPACT.get(ctx.op_type)
    if not impact:
        return None

    suffix = "yes" if ctx.explanation_given else "no"
    dt = impact.get(f"trust_{suffix}", 0)
    dc = impact.get(f"comfort_{suffix}", 0)

    for threshold, ct_dt, ct_dc in _CUMULATIVE_THRESHOLDS:
        if ctx.exam_count >= threshold:
            dt += ct_dt
            dc += ct_dc
            break

    explained_routine = impact["category"] == "routine" and ctx.explanation_given
    if explained_routine and dc < 0:
        dc += 1

    if dt != 0 or dc != 0:
        emotion.trust = max(0, min(100, emotion.trust + dt))
        emotion.comfort = max(0, min(100, emotion.comfort + dc))
        emotion.history.append(
            {
                "trust": emotion.trust,
                "comfort": emotion.comfort,
                "state": emotion.state,
                "intent": f"查体:{ctx.op_type}",
                "timestamp": "",
            }
        )

    impact_note = _build_impact_note(
        ctx.op_type, impact, dt, dc, ctx.exam_count, ctx.explanation_given
    )
    effect = ExamEffect(emotion_delta=(dt, dc))
    if impact_note:
        effect.snapshot_updates["_exam_impact_note"] = impact_note
    return effect


def _build_impact_note(
    op_type: str, impact: dict, dt: int, dc: int, exam_count: int, explained: bool
) -> str | None:
    label = _EXAM_EMOTION_IMPACT_LABELS.get(op_type, op_type)
    category = impact["category"]

    parts = [f"患者刚接受了{label}"]

    if not explained:
        if category == "routine":
            parts.append("护士没有解释原因，患者感到些许不适")
        elif category == "bundle":
            parts.append("护士没有解释为何要做全套检查，患者感到被当作'流程'对待")
        elif category == "moderate":
            parts.append("这项检查让患者感到尴尬和暴露，护士也没有事先说明必要性")
    elif category == "routine":
        parts.append("护士解释了原因，患者基本接受")
    elif category == "bundle":
        parts.append("护士解释了全套检查的必要性，患者勉强配合但感到紧张")
    elif category == "moderate":
        parts.append("虽然护士做了解释，患者仍然感到不适")

    if exam_count >= 7:
        parts.append(f"这已经是第{exam_count}次检查，患者开始怀疑是否必要")
    elif exam_count >= 4:
        parts.append("频繁的检查让患者有些不耐烦")

    if dt < 0 and dc < 0:
        parts.append(f"信任{dt:+d}，舒适{dc:+d}")
    elif dc < 0:
        parts.append(f"舒适{dc:+d}")
    elif dt < 0:
        parts.append(f"信任{dt:+d}")

    return " | ".join(parts)
