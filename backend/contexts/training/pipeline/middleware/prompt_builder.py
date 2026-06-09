"""prompt_builder — assemble LLM messages array from context."""

import logging

from contexts.patient import (
    build_patient_chat_messages,
    build_patient_context_kwargs,
    classify_intent,
    get_emotion,
)
from prompts.patient_dynamic import PATIENT_DYNAMIC_TEMPLATE
from infrastructure.prompt import render_template
from ..context import PipelineContext

log = logging.getLogger(__name__)


def _collect_author_note(ctx) -> str:
    """收集所有已激活插件的动态提示，未激活的插件不贡献任何内容"""
    notes = []
    if ctx.state.get("emotion_note"):
        notes.append(ctx.state["emotion_note"])
    if ctx.state.get("operation_note"):
        notes.append(ctx.state["operation_note"])
    return "【" + " | ".join(notes) + "】" if notes else ""


async def prompt_builder(ctx: PipelineContext, next_mw) -> None:
    if ctx.should_shortcut:
        await next_mw()
        return

    author_note = _collect_author_note(ctx)

    kwargs = build_patient_context_kwargs(ctx.case_data, author_note=author_note)
    pm = ctx.app_state.prompt_manager
    tmpl = await pm.get(ctx.current_phase.prompt_profile if ctx.current_phase else "patient_chat")

    profile_keys = {"patient_info", "scenario", "personality", "communication_style"}
    try:
        system_prompt = tmpl.render(**{k: v for k, v in kwargs.items() if k in profile_keys})
        dynamic_keys = {"chief_complaint", "present_illness", "allergy_history", "deep_background", "example_dialogues"}
        try:
            dynamic_tmpl = await pm.get("patient_dynamic")
            dynamic_prompt = dynamic_tmpl.render(**{k: v for k, v in kwargs.items() if k in dynamic_keys})
        except Exception:
            dynamic_prompt = render_template(PATIENT_DYNAMIC_TEMPLATE, **kwargs)
    except Exception as e:
        log.error("Prompt render failed: %s", e)
        system_prompt = str(kwargs.get("patient_info", "未知患者"))
        dynamic_prompt = str(kwargs.get("chief_complaint", "无"))

    ctx.llm_messages = build_patient_chat_messages(
        system_prompt,
        dynamic_prompt,
        ctx.messages,
        ctx.student_display or ctx.student_input,
        author_note=author_note,
    )

    await next_mw()
