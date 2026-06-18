"""Physical exam routes — exam operation endpoint (absorbed from former plugin)."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request

from contexts.patient import handle_operation
from core.database import get_db
from core.feature_flags import resolve_features
from core.security import get_current_user
from models import Case, Message, TrainingRecord, User

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


@dataclass
class ExamContext:
    record: Any  # TrainingRecord
    emotion_cache: Any  # EmotionCache
    op_type: str
    explanation_given: bool
    exam_count: int


@dataclass
class ExamEffect:
    snapshot_updates: dict = field(default_factory=dict)
    emotion_delta: tuple[int, int] | None = None
    history_event: dict | None = None


log = logging.getLogger(__name__)

router = APIRouter()

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

    impact_note = _build_impact_note(ctx.op_type, impact, dt, dc, ctx.exam_count, ctx.explanation_given)
    effect = ExamEffect(emotion_delta=(dt, dc))
    if impact_note:
        effect.snapshot_updates["_exam_impact_note"] = impact_note
    return effect


def _build_impact_note(op_type: str, impact: dict, dt: int, dc: int, exam_count: int, explained: bool) -> str | None:
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


@router.post("/{record_id}/exam/{op_type}")
def perform_exam(
    record_id: int,
    op_type: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    request: Request,
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能操作自己的训练")
    if record.status != "in_progress":
        raise HTTPException(status_code=400, detail="训练已结束")

    case = db.query(Case).filter(Case.id == record.case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")

    result = handle_operation(op_type, case.case_data or {})

    rs = dict(record.runtime_state or {})
    exam_results = rs.get("exam_results", [])
    if not isinstance(exam_results, list):
        exam_results = []
    exam_results.append(
        {
            "type": op_type,
            "label": result.get("label", ""),
            "value": str(result.get("value", "")),
            "unit": result.get("unit", ""),
        }
    )
    rs["exam_results"] = exam_results
    record.runtime_state = rs

    msg = Message(
        record_id=record_id,
        role="system",
        content=f"{result.get('label', '')}: {result.get('value', '')}{result.get('unit', '')}",
    )
    db.add(msg)

    features = resolve_features(record.practice_snapshot)
    if features.get("exam_emotion_bridge") and features.get("emotion"):
        last_student_msg = (
            db.query(Message)
            .filter(Message.record_id == record_id, Message.role == "student")
            .order_by(Message.created_at.desc())
            .first()
        )
        explained = bool(last_student_msg and _has_explanation(last_student_msg.content))
        exam_count = len(exam_results)

        ctx = ExamContext(
            record=record,
            emotion_cache=request.app.state.emotion_cache,
            op_type=op_type,
            explanation_given=explained,
            exam_count=exam_count,
        )
        effect = _apply_exam_emotion_effect(ctx)
        if effect is not None and effect.snapshot_updates:
            rs = dict(record.runtime_state or {})
            for k, v in effect.snapshot_updates.items():
                key = k.lstrip("_")
                rs[key] = v
            record.runtime_state = rs

    db.commit()
    return {"type": op_type, "data": result, "all_results": exam_results}


def _has_explanation(text: str) -> bool:
    keywords = ["因为", "所以", "给你", "检查一下", "评估", "需要了解", "测量一下", "看一下", "查一下"]
    return any(kw in text for kw in keywords)
