"""Pipeline builder — middleware chain and NoteCollector assembly."""

from __future__ import annotations

import logging
from typing import Any

from .stages import PipelineStage, stage_order

log = logging.getLogger(__name__)

_CORE_MIDDLEWARE: dict[PipelineStage, list[Any]] = {}


def build_pipeline() -> tuple[list[Any], Any]:
    """组装中间件链（按 stages 顺序）+ NoteCollector。

    目前只有一条链（问诊 history_taking，与评分 rubric 同源）：TrainingRecord.training_type
    由建单路径（session.py）硬编码为该值，因此本函数不接收该参数——它曾经只是被透传、
    无人读，容易让读者以为存在多 profile 分派。新增训练类型 = 新链 + 新 rubric，
    不要再往这里加"看起来能分派"的未用参数。
    """
    if not _CORE_MIDDLEWARE:
        from .middleware import (
            emotion_analysis,
            llm_caller,
            persister,
            prompt_builder,
            side_effects,
        )

        _CORE_MIDDLEWARE[PipelineStage.ANALYSIS] = [emotion_analysis]
        _CORE_MIDDLEWARE[PipelineStage.PROMPT] = [prompt_builder]
        _CORE_MIDDLEWARE[PipelineStage.LLM] = [llm_caller]
        _CORE_MIDDLEWARE[PipelineStage.PERSIST] = [persister]
        _CORE_MIDDLEWARE[PipelineStage.SIDE_EFFECTS] = [side_effects]

    stage_buckets: dict[PipelineStage, list[Any]] = {s: list(_CORE_MIDDLEWARE.get(s, [])) for s in PipelineStage}

    result: list[Any] = []
    for stage in sorted(PipelineStage, key=stage_order):
        result.extend(stage_buckets.get(stage, []))

    # --- assemble NoteCollector ---
    from modules.training.patient_ai.note_collector import NoteCollector
    from modules.training.profile import PROFILE

    collector = NoteCollector()
    for src_cls in PROFILE.note_sources:
        collector.add(src_cls())

    return result, collector
