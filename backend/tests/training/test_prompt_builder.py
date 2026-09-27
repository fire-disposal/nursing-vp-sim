"""PROMPT 阶段（prompt_builder）的取料契约。

钉住 U0-A 第 4 条要确认的那条链路：``runtime_state["scene"]`` 经
``_resolve_scene_text`` → ``format_scene_for_prompt`` → PER-TURN 消息进入患者上下文。
病例里的 ``scene``（作者面）走同一路径，因此这里用运行态形态构造输入。

失败语义：场景是库里的 JSONB，形状无法在类型层保证——坏数据只能退化为"不注入场景"，
不能让整轮对话失败；本文件同时钉住这条降级边界。
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from modules.training.pipeline.context import PipelineContext
from modules.training.pipeline.middleware.prompt_builder import prompt_builder

_CASE = {
    "patient_info": {"name": "张三", "age": 68, "gender": "男"},
    "chief_complaint": "咳嗽咳痰加重伴呼吸困难3天",
    "present_illness": "3天前受凉后咳嗽加重。",
    "communication_style": "老年男性，喘息明显。",
}

_SCENE = {
    "environment": {"type": "er", "time_of_day": "night", "equipment": ["氧气管"], "noise_level": "moderate"},
    "patient": {"position": "semi-recumbent", "consciousness": "alert", "visible_symptoms": ["喘息"]},
    "vitals": {"hr": 108, "spo2": 91, "rr": 26},
    "phase": "initial_assessment",
}


def _ctx(*, scene: dict | None = None) -> PipelineContext:
    runtime_state: dict = {} if scene is None else {"scene": scene}
    record = SimpleNamespace(
        id=7,
        case_id=1,
        workflow_id="history_taking",
        runtime_state=runtime_state,
        practice_snapshot={},
    )
    return PipelineContext(
        record=record,
        case_data=_CASE,
        current_user=SimpleNamespace(id=1),
        db=object(),
        app_state=object(),
        student_input="大爷，您哪里不舒服？",
        student_display="大爷，您哪里不舒服？",
    )


def _state_message(ctx: PipelineContext) -> str:
    """PER-TURN 患者状态消息（user 输入之前的那条 system）。"""
    assert ctx.llm_messages is not None
    message = ctx.llm_messages[-2]
    assert message["role"] == "system"
    return str(message["content"])


@pytest.mark.asyncio
async def test_scene_from_runtime_state_reaches_prompt():
    ctx = _ctx(scene=_SCENE)
    await prompt_builder(ctx)

    state = _state_message(ctx)
    assert "环境: er (night)" in state
    assert "设备: 氧气管" in state
    assert "可见体征: 喘息" in state
    assert "SpO₂ 91%" in state
    assert "阶段: initial_assessment" in state


@pytest.mark.asyncio
async def test_renderable_scene_alone_creates_state_message():
    """只有场景、没有情绪注记时，仍必须产生 PER-TURN 消息（否则场景白注入）。"""
    ctx = _ctx(scene={"environment": {"type": "ward", "time_of_day": "morning"}})
    await prompt_builder(ctx)

    assert "环境: ward (morning)" in _state_message(ctx)


@pytest.mark.asyncio
async def test_missing_scene_has_no_state_message():
    ctx = _ctx(scene=None)
    await prompt_builder(ctx)

    assert ctx.llm_messages is not None
    # 无场景也无注记 → 不产生 PER-TURN 消息，user 输入仍是最后一条
    assert ctx.llm_messages[-1] == {"role": "user", "content": "大爷，您哪里不舒服？"}
    assert all("环境:" not in m["content"] for m in ctx.llm_messages)


@pytest.mark.asyncio
async def test_malformed_scene_degrades_without_failing_turn():
    ctx = _ctx(scene={"environment": {"type": "不存在的科室"}, "vitals": {"hr": "很快"}})
    await prompt_builder(ctx)

    messages = ctx.llm_messages or []
    assert messages, "坏场景不得让整轮对话没有消息"
    assert messages[-1]["role"] == "user"
    assert all("环境:" not in m["content"] for m in messages)
