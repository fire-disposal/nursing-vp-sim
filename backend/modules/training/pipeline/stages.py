"""Pipeline stages — stage enum, ordering, and middleware type alias."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from enum import StrEnum

from .context import PipelineContext

PipelineMiddleware = Callable[
    [PipelineContext, Callable[[], Awaitable[None]]],
    Awaitable[None],
]


class PipelineStage(StrEnum):
    """真实存在的阶段 —— 只登记有实现的阶段（docs/ideas/pipeline-and-job-separation.md）。

    曾声明过 ``guard`` / ``transition`` 两个空阶段（只有编号没有实现），已删除：
    枚举里的成员必须对应一段真实执行的代码，否则读者会去找不存在的阶段。
    """

    ANALYSIS = "analysis"
    PROMPT = "prompt"
    LLM = "llm"
    PERSIST = "persist"
    SIDE_EFFECTS = "side_effects"


_STAGE_ORDER: dict[PipelineStage, int] = {
    PipelineStage.ANALYSIS: 150,
    PipelineStage.PROMPT: 200,
    PipelineStage.LLM: 300,
    PipelineStage.PERSIST: 400,
    PipelineStage.SIDE_EFFECTS: 500,
}


def stage_order(stage: PipelineStage) -> int:
    return _STAGE_ORDER[stage]
