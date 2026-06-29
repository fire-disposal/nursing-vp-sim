"""NoteSource — per-round context injection sources."""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from contexts.training.pipeline.context import PipelineContext

log = logging.getLogger(__name__)


class NoteSource(ABC):
    name: str = ""
    priority: int = 0
    max_tokens: int = 100

    @abstractmethod
    async def collect(self, ctx: PipelineContext) -> str | None: ...


_OPS_EXPERIENCE_DESCRIPTIONS: dict[str, str] = {
    "temp": "体温测量（体温计置于腋下）",
    "bp": "血压测量（袖带绑在左上臂）",
    "hr": "心率测量",
    "rr": "呼吸频率测量（观察胸廓起伏）",
    "spo2": "血氧测量（手指佩戴血氧夹）",
    "vitals": "全套生命体征测量",
    "skin": "皮肤检查（视诊观察）",
    "pain": "NRS 疼痛评估",
}


class OperationNoteSource(NoteSource):
    """注入场景操作的过程描述（不含数值），通用替代 ExamExperienceSource。"""

    name = "operation"
    priority = 30
    max_tokens = 150

    async def collect(self, ctx: PipelineContext) -> str | None:
        rs = ctx.record.runtime_state or {}
        ops = rs.get("operations", [])
        if not isinstance(ops, list) or not ops:
            return None
        experiences: list[str] = []
        seen: set[str] = set()
        for op in ops:
            type_ = op.get("type", "")
            if type_ in seen:
                continue
            seen.add(type_)
            desc = _OPS_EXPERIENCE_DESCRIPTIONS.get(type_)
            if desc:
                experiences.append(desc)
        if not experiences:
            return None
        return "护士对你进行了以下操作：\n- " + "\n- ".join(experiences)
