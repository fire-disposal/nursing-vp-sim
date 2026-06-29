"""Pipeline builder — middleware chain and NoteCollector assembly."""

from __future__ import annotations

import logging
from typing import Any

from .stages import PipelineStage, stage_order

log = logging.getLogger(__name__)

_CORE_MIDDLEWARE: dict[PipelineStage, list[Any]] = {}


def build_pipeline(training_type: str | None = None) -> tuple[list[Any], Any]:
    if not _CORE_MIDDLEWARE:
        from .middleware import (
            llm_caller,
            persister,
            phase_guard,
            phase_transition,
            prompt_builder,
            side_effects,
        )

        _CORE_MIDDLEWARE[PipelineStage.GUARD] = [phase_guard]
        _CORE_MIDDLEWARE[PipelineStage.TRANSITION] = [phase_transition]
        _CORE_MIDDLEWARE[PipelineStage.PROMPT] = [prompt_builder]
        _CORE_MIDDLEWARE[PipelineStage.LLM] = [llm_caller]
        _CORE_MIDDLEWARE[PipelineStage.PERSIST] = [persister]
        _CORE_MIDDLEWARE[PipelineStage.SIDE_EFFECTS] = [side_effects]

    stage_buckets: dict[PipelineStage, list[Any]] = {s: list(_CORE_MIDDLEWARE.get(s, [])) for s in PipelineStage}

    result: list[Any] = []
    for stage in sorted(PipelineStage, key=stage_order):
        result.extend(stage_buckets.get(stage, []))

    # --- assemble NoteCollector ---
    from contexts.patient.note_collector import NoteCollector
    from profiles.registry import get_profile

    collector = NoteCollector()
    pt = training_type or "history_taking"
    try:
        profile = get_profile(pt)
        for src_cls in profile.note_sources:
            collector.add(src_cls())
    except KeyError:
        log.warning("Unknown training type %r, using generic OperationNoteSource only", pt)
        from contexts.patient.note_source import OperationNoteSource

        collector.add(OperationNoteSource())

    return result, collector
