"""Pipeline builder — middleware chain and NoteCollector assembly."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from .stages import PipelineStage, stage_order

if TYPE_CHECKING:
    from modules.training.profile import WorkflowDefinition

log = logging.getLogger(__name__)

_CORE_MIDDLEWARE: dict[PipelineStage, list[Any]] = {}


def build_pipeline(workflow: WorkflowDefinition | None = None) -> tuple[list[Any], Any]:
    """组装中间件链（按 stages 顺序）+ NoteCollector。

    ``workflow`` 只决定 NoteCollector 种入哪些 ``note_sources``（其余中间件与 workflow 无关）。
    运行期调用方传 ``workflows.workflow_for_record(record)``；缺省取唯一已登记的 workflow
    （无记录上下文的装配点/测试）。``training_type`` 字符串分派已退场（docs/15 §九），
    不要在这里加"看起来能分派"的未用参数。"""
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
    from modules.training.workflows import default_workflow

    collected_from = workflow or default_workflow()
    collector = NoteCollector()
    for src_cls in collected_from.note_sources:
        collector.add(src_cls())

    return result, collector
