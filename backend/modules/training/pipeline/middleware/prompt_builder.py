"""prompt_builder — 四域患者消息组装（PROMPT 阶段）。

域拆分：
  STATIC    人设卡 system 消息（渲染自 profile.prompts.system）
  SESSION   病例   system 消息（渲染自 profile.prompts.dynamic，逐字节稳定 → prefix cache）
  EXAMPLES  example_dialogues 转 user/assistant few-shot 对
  HISTORY   真实对话（token 预算 + 保护集，见 context.budget）
  PER-TURN  患者当前状态 system 消息（情绪策略 + 操作注记 + 场景状态）

静态前缀只在首个请求时计算一次（STATE_PATIENT_CONTEXT_KWARGS 缓存）；
每轮只变化 PER-TURN 消息与 HISTORY。
"""

from __future__ import annotations

import logging

from core.template import render_template
from modules.training.context.assembler import assemble_patient_messages
from modules.training.context.examples import build_example_pairs
from modules.training.context.patient_state import build_patient_state
from modules.training.pipeline.prompt_context_builder import build_context_kwargs
from modules.training.profile import PROFILE
from modules.training.session.state import (
    SceneState,
    format_scene_for_prompt,
)

from ..context import STATE_CONTEXT_LEDGER, STATE_PATIENT_CONTEXT_KWARGS, PipelineContext
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

    profile = PROFILE

    # Case-data kwargs — cached across turns (personality, background, …)
    cached = ctx.state.get(STATE_PATIENT_CONTEXT_KWARGS)
    if cached is None:
        cached = build_context_kwargs(ctx.case_data)
        ctx.state[STATE_PATIENT_CONTEXT_KWARGS] = cached

    prompt_ctx = PromptContext()
    prompt_ctx.register("case", cached)

    system_prompt = render_template(str(profile.prompts.system), **prompt_ctx.as_dict())
    try:
        session_prompt = render_template(str(profile.prompts.dynamic), **prompt_ctx.as_dict())
    except Exception as e:
        log.exception("动态模板渲染失败 profile=history_taking: %s", e)
        session_prompt = ""

    note_text = ""
    if ctx.note_collector:
        note_text = await ctx.note_collector.collect(ctx)

    patient_state = build_patient_state(
        scene_text=_resolve_scene_text(ctx) or "",
        note_text=note_text,
    )

    ctx.llm_messages, ledger = assemble_patient_messages(
        system_prompt=system_prompt,
        session_prompt=session_prompt,
        history=ctx.messages,
        student_input=ctx.student_display or ctx.student_input,
        patient_state=patient_state,
        examples=build_example_pairs(ctx.case_data),
    )
    ctx.state[STATE_CONTEXT_LEDGER] = ledger
    log.debug("context ledger: %s", ledger)

    await next_mw()
