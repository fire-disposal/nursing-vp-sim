"""prompt_builder — assemble LLM messages array from context.

Each data source is registered into a ``PromptContext`` so the assembly
is explicit, debuggable, and extensible without touching the flat
``kwargs`` dict.
"""

from __future__ import annotations

import importlib
import logging

from contexts.training.patient_ai.chat_messages import build_patient_chat_messages
from contexts.training.session.state import (
    SceneState,
    format_scene_for_prompt,
)
from prompts import render_template
from profiles.registry import get_profile

from ..context import STATE_PATIENT_CONTEXT_KWARGS, PipelineContext
from ..prompt_context import PromptContext

log = logging.getLogger(__name__)


def _resolve_scene_text(ctx: PipelineContext) -> str | None:
    """Read ``runtime_state.scene`` and format for prompt injection."""
    raw = (ctx.record.runtime_state or {}).get("scene", {}) if ctx.record else None
    if not raw:
        return None
    try:
        state = SceneState.model_validate(raw)
    except Exception:
        log.warning("Invalid scene state in runtime_state", exc_info=True)
        return None
    return format_scene_for_prompt(state)


async def prompt_builder(ctx: PipelineContext, next_mw) -> None:
    if ctx.should_shortcut:
        await next_mw()
        return

    author_note = ""
    if ctx.note_collector:
        author_note = await ctx.note_collector.collect(ctx)

    training_type = getattr(ctx.record, "training_type", None) or "history_taking"
    try:
        profile = get_profile(training_type)
    except KeyError:
        log.warning("Unknown training_type=%s, falling back to history_taking", training_type)
        training_type = "history_taking"
        profile = get_profile(training_type)

    # Case-data kwargs — cached across turns (personality, background, …)
    cached = ctx.state.get(STATE_PATIENT_CONTEXT_KWARGS)
    if cached is None:
        try:
            builder_mod = importlib.import_module(f"profiles.{training_type}.builder")
            cached = builder_mod.build_context_kwargs(ctx.case_data)
        except ModuleNotFoundError:
            log.warning("No builder module for training_type=%s, using empty kwargs", training_type)
            cached = {}
        ctx.state[STATE_PATIENT_CONTEXT_KWARGS] = cached

    # Assemble all sources into a PromptContext
    prompt_ctx = PromptContext()
    prompt_ctx.register("case", cached)
    prompt_ctx.register("author", {"author_note": author_note if author_note.strip() else ""})
    prompt_ctx.register("scene", {"scene_state": _resolve_scene_text(ctx)})

    system_template = profile.prompts.system
    dynamic_template = profile.prompts.dynamic
    system_prompt = render_template(str(system_template), **prompt_ctx.as_dict())
    try:
        dynamic_prompt = render_template(str(dynamic_template), **prompt_ctx.as_dict())
    except Exception as e:
        log.exception("动态模板渲染失败 training_type=%s: %s", training_type, e)
        dynamic_prompt = ""

    ctx.llm_messages = build_patient_chat_messages(
        system_prompt,
        dynamic_prompt,
        ctx.messages,
        ctx.student_display or ctx.student_input,
        author_note=author_note,
    )

    await next_mw()
