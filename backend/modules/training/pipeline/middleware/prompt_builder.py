"""prompt_builder — 患者消息编译（PROMPT 阶段）。

职责边界（docs/15 §八）：本中间件只**取料**（Workflow 声明的模板 + 病例数据渲染，
NoteSource 的类型化片段），编译交给唯一入口 ``compile_patient_prompt``：槽位校验 /
选择 / 排序 / 裁剪 / 预算 / 落位都在那里。这里不拼接任何 system prompt 字符串。

本阶段**不保存任何跨轮状态**：``PipelineContext`` 每个回合新建，往 ``ctx.state`` 里
写"跨轮缓存"只会随回合一起被丢弃（曾有一版如此，见 docs/19 §2.2）。
"""

from __future__ import annotations

import logging

from core.template import render_template
from modules.training.context.case_vars import build_case_vars
from modules.training.context.compiler import compile_patient_prompt
from modules.training.context.examples import build_example_pairs
from modules.training.session.state import (
    SceneState,
    format_scene_for_prompt,
)
from modules.training.workflows import workflow_for_record

from ..context import PipelineContext

log = logging.getLogger(__name__)


def _resolve_scene_text(ctx: PipelineContext) -> str | None:
    """Read ``runtime_state.scene`` and format for prompt injection."""
    raw = (ctx.record.runtime_state or {}).get("scene", {}) if ctx.record else None
    if not raw:
        return None
    try:
        state = SceneState.model_validate(raw)
    except Exception:
        # 场景是**运行期数据**（库里的 JSONB），形状无法在类型层保证：坏了就退化为
        # 不注入场景，而不是让整轮对话 500。
        log.warning("Invalid scene state in runtime_state", exc_info=True)
        return None
    return format_scene_for_prompt(state)


async def prompt_builder(ctx: PipelineContext) -> None:
    if ctx.should_shortcut:
        return

    # 提示词模板取自**本次记录冻结的 workflow**（记录 = 唯一运行期 owner）
    workflow = workflow_for_record(ctx.record)
    # 病例模板变量：纯函数，从本次记录的 case_snapshot 现算。没有可缓存的东西——
    # 模板渲染是确定性的，模板本身是代码常量。
    case_vars = build_case_vars(ctx.case_data)

    fragments = await ctx.note_collector.collect(ctx) if ctx.note_collector else []

    ctx.llm_messages = compile_patient_prompt(
        # 渲染失败即抛（render_template 缺变量抛 RuntimeError）：模板是代码常量，
        # 渲染不出来是代码缺陷，不能静默退化成"没有病例信息的患者"。
        role=render_template(str(workflow.prompts.system), **case_vars),
        scenario=render_template(str(workflow.prompts.dynamic), **case_vars),
        history=ctx.messages,
        student_input=ctx.student_display or ctx.student_input,
        fragments=fragments,
        declared_sources=workflow.context_sources(
            ctx.case_data,
            overrides=(ctx.record.practice_snapshot or {}).get("features"),
        ),
        examples=build_example_pairs(ctx.case_data),
        scene_text=_resolve_scene_text(ctx) or "",
    )
