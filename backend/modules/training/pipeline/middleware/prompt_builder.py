"""prompt_builder — 四域患者消息组装（PROMPT 阶段）。

职责边界（docs/15 §八）：本中间件只**取料**（Workflow 声明的模板 + 病例数据渲染，
NoteSource 的类型化片段），组装权在 ``ContextAssembler``：选择 / 排序 / 裁剪 / 预算 /
落位都在那里。这里不再拼接任何 system prompt 字符串。

域拆分：
  STATIC    人设卡 system 消息（渲染自 workflow.prompts.system）
  SESSION   病例   system 消息（渲染自 workflow.prompts.dynamic，逐字节稳定 → prefix cache）
  EXAMPLES  example_dialogues 转 user/assistant few-shot 对
  HISTORY   真实对话（token 预算 + 保护集，见 context.budget）
  PER-TURN  患者当前状态 system 消息（情绪策略 + 操作注记 + 场景状态）

静态前缀只在首个请求时计算一次（STATE_PATIENT_CONTEXT_KWARGS 缓存）；
每轮只变化 PER-TURN 消息与 HISTORY。
"""

from __future__ import annotations

import logging

from core.template import render_template
from modules.training.context.assembler import ContextAssembler
from modules.training.context.examples import build_example_pairs
from modules.training.pipeline.prompt_context_builder import build_context_kwargs
from modules.training.session.state import (
    SceneState,
    format_scene_for_prompt,
)
from modules.training.workflows import workflow_for_record

from ..context import STATE_ASSEMBLER, STATE_PATIENT_CONTEXT_KWARGS, PipelineContext
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

    # 提示词模板取自**本次记录冻结的 workflow**（记录 = 唯一运行期 owner）
    workflow = workflow_for_record(ctx.record)

    # Case-data kwargs — cached across turns (personality, background, …)
    cached = ctx.state.get(STATE_PATIENT_CONTEXT_KWARGS)
    if cached is None:
        cached = build_context_kwargs(ctx.case_data)
        ctx.state[STATE_PATIENT_CONTEXT_KWARGS] = cached

    prompt_ctx = PromptContext()
    prompt_ctx.register("case", cached)

    system_prompt = render_template(str(workflow.prompts.system), **prompt_ctx.as_dict())
    try:
        session_prompt = render_template(str(workflow.prompts.dynamic), **prompt_ctx.as_dict())
    except Exception as e:
        log.exception("动态模板渲染失败 workflow=%s: %s", workflow.id, e)
        session_prompt = ""

    fragments = await ctx.note_collector.collect(ctx) if ctx.note_collector else []

    assembler = ContextAssembler(
        workflow.context_sources(
            ctx.case_data,
            overrides=(ctx.record.practice_snapshot or {}).get("features"),
        )
    )
    ctx.state[STATE_ASSEMBLER] = assembler

    result = assembler.assemble(
        role=system_prompt,
        scenario=session_prompt,
        history=ctx.messages,
        student_input=ctx.student_display or ctx.student_input,
        examples=build_example_pairs(ctx.case_data),
        fragments=fragments,
        scene_text=_resolve_scene_text(ctx) or "",
    )
    ctx.llm_messages = result.messages
    log.debug("context ledger: %s", result.ledger)

    await next_mw()
