"""查体 → 情绪桥接（线上反馈 id=30：查体结果从不影响 4D 情绪）。

查体调用走 WebSocket 工具通道，不进 chat 管线；情绪中间件
（pipeline/middleware/emotion_analysis.py）只分析学生聊天文本，
因此查体永远无法改变情绪。本模块在查体成功后按 op_type/数值/重复次数
派生确定性情绪事件，走与情绪中间件相同的 EmotionEngine +
EmotionRepository（乐观锁）流程，与查体结果同一事务提交。
"""

from __future__ import annotations

import logging

from modules.training.patient_ai.emotion import (
    EmoState,
    EmotionEngine,
    EmotionProfile,
    EmotionRepository,
    resolve_dominant_state,
)
from modules.training.patient_ai.emotion.events import DetectedEmotionEvent, EmotionEventType

log = logging.getLogger(__name__)

_TURN_PREFIX = "exam"

# 体温阈值（°C）：达到即视为发热
_FEVER_TEMP = 38.0
# 同类测量重复次数：达到即视为反复测量（与 OperationNoteSource 的重复信号同构）
_REPEAT_LIMIT = 3


def derive_exam_emotion_events(op_type: str, value: str, count: int) -> list[DetectedEmotionEvent]:
    """从查体操作派生的确定性情绪事件。无信号返回空列表。

    全部确定性计算，不依赖随机数（路线图 §4：数值变化必须确定性）。
    """
    events: list[DetectedEmotionEvent] = []
    try:
        num = float(str(value).strip())
    except (TypeError, ValueError):
        num = 0.0

    if op_type == "pain":
        if num >= 7:
            events.append(
                DetectedEmotionEvent(
                    type=EmotionEventType.PAINFUL_EXAM,
                    confidence=1.0,
                    evidence=f"NRS 疼痛评分 {value}",
                )
            )
        elif num >= 4:
            events.append(
                DetectedEmotionEvent(
                    type=EmotionEventType.PAINFUL_EXAM,
                    confidence=0.7,
                    evidence=f"NRS 疼痛评分 {value}",
                )
            )
    elif op_type == "temp" and num >= _FEVER_TEMP:
        events.append(
            DetectedEmotionEvent(
                type=EmotionEventType.FEVER,
                confidence=1.0,
                evidence=f"体温 {value}°C",
            )
        )

    if count >= _REPEAT_LIMIT:
        events.append(
            DetectedEmotionEvent(
                type=EmotionEventType.LONG_WAIT,
                confidence=0.8,
                evidence=f"同类测量重复 {count} 次",
            )
        )
    return events


def apply_exam_emotion(
    record_id: int,
    case_data: dict,
    op_type: str,
    value: str,
    count: int,
    db,
) -> dict | None:
    """应用查体情绪事件，返回 4D 变化（供前端 emotion:changed 驱动情绪条）。

    无派生事件、情绪被禁用或引擎异常时返回 None（查体结果照常返回）。
    """
    events = derive_exam_emotion_events(op_type, value, count)
    if not events:
        return None

    try:
        personality = (case_data or {}).get("personality", {}) or {}
        profile = EmotionProfile.from_personality(personality)
        engine = EmotionEngine()
        repo = EmotionRepository()

        state = repo.get_or_create(record_id, db)
        recovered = engine.recover(state.vector, profile)
        work_state = EmoState(vector=recovered, version=state.version)
        new_state, applied = engine.apply_events(work_state, profile, events)
        if not applied:
            return None

        turn_id = f"{record_id}-{_TURN_PREFIX}-{op_type}-{count}"
        final_state = EmoState(
            vector=new_state.vector,
            version=state.version,
            last_turn_id=turn_id,
        )
        saved = repo.save(record_id, final_state, db)
        repo.append_events(record_id, turn_id, applied, db)
        return {
            "trust": round(saved.vector.trust, 2),
            "anxiety": round(saved.vector.anxiety, 2),
            "irritation": round(saved.vector.irritation, 2),
            "cooperation": round(saved.vector.cooperation, 2),
            "dominant_state": resolve_dominant_state(saved.vector),
        }
    except Exception:
        log.warning("Exam emotion bridge failed: record_id=%d", record_id, exc_info=True)
        return None
