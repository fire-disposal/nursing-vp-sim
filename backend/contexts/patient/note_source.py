"""NoteSource — per-round context injection sources."""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from contexts.training.pipeline.context import PipelineContext

from contexts.patient.guards import get_identity_correction_note, has_identity_leak

log = logging.getLogger(__name__)


class NoteSource(ABC):
    name: str = ""
    priority: int = 0
    max_tokens: int = 100

    @abstractmethod
    async def collect(self, ctx: PipelineContext) -> str | None: ...


class EmotionNoteSource(NoteSource):
    name = "emotion"
    priority = 10
    max_tokens = 100

    async def collect(self, ctx: PipelineContext) -> str | None:
        from contexts.patient.emotion import get_emotion

        cache = getattr(ctx.app_state, "emotion_cache", None)
        if cache is None:
            return None
        emotion = get_emotion(ctx.record.id, cache, ctx.db)
        return emotion.note


class IdentityGuardSource(NoteSource):
    name = "identity_guard"
    priority = 20
    max_tokens = 50

    async def collect(self, ctx: PipelineContext) -> str | None:
        last_patient = None
        for msg in reversed(ctx.messages):
            if msg.role == "patient":
                last_patient = msg.content
                break
        if last_patient and has_identity_leak(last_patient):
            return get_identity_correction_note()
        return None


_EXAM_EXPERIENCE_DESCRIPTIONS: dict[str, str] = {
    "temp": "体温测量（体温计置于腋下）",
    "bp": "血压测量（袖带绑在左上臂）",
    "hr": "心率测量",
    "rr": "呼吸频率测量（观察胸廓起伏）",
    "spo2": "血氧测量（手指佩戴血氧夹）",
    "vitals": "全套生命体征测量",
    "skin": "皮肤检查（视诊观察）",
    "pain": "NRS 疼痛评估",
}


class ExamExperienceSource(NoteSource):
    """注入查体过程体验描述，不含临床数值。

    只告诉 LLM 病人被做了什么操作（如"血压测量（袖带绑在左上臂）"），
    不泄露任何测量结果。病人 LLM 据此自然产生感受和回应，而非"知道"数据。
    """

    name = "exam_experience"
    priority = 30
    max_tokens = 150

    async def collect(self, ctx: PipelineContext) -> str | None:
        rs = ctx.record.runtime_state or {}
        exam_results = rs.get("exam_results", [])
        if not isinstance(exam_results, list) or not exam_results:
            return None
        experiences: list[str] = []
        seen: set[str] = set()
        for r in exam_results:
            op_type = r.get("type", "")
            if op_type in seen:
                continue
            seen.add(op_type)
            desc = _EXAM_EXPERIENCE_DESCRIPTIONS.get(op_type)
            if desc:
                experiences.append(desc)
        if not experiences:
            return None
        return "护士对你进行了以下操作：\n- " + "\n- ".join(experiences)
