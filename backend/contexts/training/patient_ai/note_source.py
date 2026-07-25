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
    """注入检体操作描述，对重复/遍历式操作标注体验感受。

    不再去重 — 重复测量次数直接写入 note，让患者 LLM 自然产生
    质疑或不耐烦反应（"你怎么又量体温？"）。
    """

    name = "operation"
    priority = 30
    max_tokens = 250

    async def collect(self, ctx: PipelineContext) -> str | None:
        rs = ctx.record.runtime_state or {}
        ops = rs.get("exam_results", [])
        if not isinstance(ops, list) or not ops:
            return None

        counts: dict[str, int] = {}
        ordered: list[str] = []
        for op in ops:
            type_ = op.get("type", "")
            if type_ not in counts:
                counts[type_] = 0
                ordered.append(type_)
            counts[type_] += 1

        total = sum(counts.values())
        lines: list[str] = []

        # Build the list of performed operations with repetition markers
        examined: list[str] = []
        for type_ in ordered:
            count = counts[type_]
            desc = _OPS_EXPERIENCE_DESCRIPTIONS.get(type_)
            if not desc:
                continue
            if count == 1:
                examined.append(desc)
            elif count == 2:
                examined.append(f"{desc}（重复了{count}次）")
            else:
                examined.append(f"{desc}（反复测量了{count}次）")

        if not examined:
            return None

        lines.append("护士对你进行了以下操作：")
        lines.append("- " + "\n- ".join(examined))

        # ── excessive/repetitive measurement signals ──
        repeated = [(type_, c) for type_, c in counts.items() if c >= 3]
        if repeated:
            names = "、".join(_OPS_EXPERIENCE_DESCRIPTIONS.get(t, t) for t, _ in repeated)
            lines.append(
                f"\n护士反复进行了{names}，这令你感到不适或困惑。"
                "你可以在接下来的对话中对此表示质疑、不耐烦，或追问原因。"
            )
        elif total >= 8:
            lines.append(
                "\n护士进行了大量测量操作，你开始感到不耐烦，"
                "可能会抱怨或质疑这些操作的必要性。"
            )
        elif total >= 5:
            lines.append(
                "\n护士的操作较多，你可能有些困惑，但仍保持配合。"
            )

        return "\n".join(lines)
