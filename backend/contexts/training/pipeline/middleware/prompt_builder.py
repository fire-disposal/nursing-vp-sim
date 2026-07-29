"""prompt_builder — assemble LLM messages array from context.

Each data source is registered into a ``PromptContext`` so the assembly
is explicit, debuggable, and extensible without touching the flat
``kwargs`` dict.
"""

from __future__ import annotations

import logging

from contexts.training.patient_ai.chat_messages import build_patient_chat_messages
from contexts.training.session.state import (
    SceneState,
    format_scene_for_prompt,
)
from profiles.history_taking import PROFILE
from profiles.history_taking.builder import build_context_kwargs
from prompts import render_template

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

    profile = PROFILE

    # Case-data kwargs — cached across turns (personality, background, …)
    cached = ctx.state.get(STATE_PATIENT_CONTEXT_KWARGS)
    if cached is None:
        cached = build_context_kwargs(ctx.case_data)
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
        log.exception("动态模板渲染失败 profile=history_taking: %s", e)
        dynamic_prompt = ""

    ctx.llm_messages = build_patient_chat_messages(
        system_prompt,
        dynamic_prompt,
        ctx.messages,
        ctx.student_display or ctx.student_input,
        author_note=author_note,
    )

    await next_mw()
