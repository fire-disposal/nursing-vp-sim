"""prompt_builder — assemble LLM messages array from context."""

import logging

from contexts.patient import (
    build_patient_chat_messages,
    build_patient_context_kwargs,
)
from infrastructure.prompt import render_template
from prompts.patient_dynamic import PATIENT_DYNAMIC_TEMPLATE

from ..context import PipelineContext

log = logging.getLogger(__name__)


async def prompt_builder(ctx: PipelineContext, next_mw) -> None:
    if ctx.should_shortcut:
        await next_mw()
        return

    author_note = ""
    if ctx.note_collector:
        author_note = await ctx.note_collector.collect(ctx)

    # 病例静态数据缓存 — 性格/背景/示例对话整个会话不变，仅 author_note 每轮更新
    cached = ctx.state.get("_patient_context_kwargs")
    if cached is None:
        cached = build_patient_context_kwargs(ctx.case_data)
        ctx.state["_patient_context_kwargs"] = cached
    kwargs = {**cached, "author_note": author_note if author_note.strip() else ""}
    pm = ctx.app_state.prompt_manager
    tmpl = await pm.get(ctx.current_phase.prompt_profile if ctx.current_phase else "patient_chat")

    # 直接传入全部 kwargs，模板引擎只替换 {#var#} 占位符，多余的变量无副作用
    try:
        system_prompt = tmpl.render(**kwargs)
        try:
            dynamic_tmpl = await pm.get("patient_dynamic")
            dynamic_prompt = dynamic_tmpl.render(**kwargs)
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
