"""prompt_builder — assemble LLM messages array from context."""

import logging

from contexts.patient import (
    build_patient_chat_messages,
    build_patient_context_kwargs,
)
from infrastructure.prompt import render_template
from profiles.registry import get_profile
from prompts.patient_chat import PATIENT_CHAT_SYSTEM
from prompts.patient_dynamic import PATIENT_DYNAMIC_TEMPLATE

from ..context import STATE_PATIENT_CONTEXT_KWARGS, PipelineContext

log = logging.getLogger(__name__)


async def prompt_builder(ctx: PipelineContext, next_mw) -> None:
    if ctx.should_shortcut:
        await next_mw()
        return

    author_note = ""
    if ctx.note_collector:
        author_note = await ctx.note_collector.collect(ctx)

    training_type = getattr(ctx.record, "training_type", None) or "history_taking"
    profile = get_profile(training_type)

    # 病例静态数据缓存 — 性格/背景/示例对话整个会话不变，仅 author_note 每轮更新
    cached = ctx.state.get(STATE_PATIENT_CONTEXT_KWARGS)
    if cached is None:
        cached = build_patient_context_kwargs(ctx.case_data)
        ctx.state[STATE_PATIENT_CONTEXT_KWARGS] = cached
    kwargs = {**cached, "author_note": author_note if author_note.strip() else ""}

    # 直接传入全部 kwargs，模板引擎只替换 {#var#} 占位符，多余的变量无副作用
    try:
        system_prompt = render_template(PATIENT_CHAT_SYSTEM, **kwargs)
        try:
            dynamic_prompt = render_template(PATIENT_DYNAMIC_TEMPLATE, **kwargs)
        except Exception:
            log.warning("Dynamic prompt unavailable, falling back to static template", exc_info=True)
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
        max_rounds=profile.max_rounds,
    )

    await next_mw()
