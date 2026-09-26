"""断线（生成器提前关闭）时 pipeline 任务必须跑完，session 必须活到任务结束。

背景：collect-then-push + 前端 60s idle 超时会让断线成为常规路径。旧实现里
`except GeneratorExit` 分支不可达，任务游离到后台，而请求侧先关了 DB session。
"""

import asyncio
import json

import pytest

import modules.training.pipeline.runner as runner_mod
from modules.training.pipeline import PipelineContext, stream_pipeline
from modules.training.pipeline.context import (
    STATE_DONE_PAYLOAD,
    STATE_PIPELINE_TASK,
    STATE_SAVED_MESSAGES,
    STATE_STREAM_QUEUE,
)
from modules.training.pipeline.runner import abandoned_stream_count


class _PatientMessage:
    """persister 落库后的 patient 消息（done 帧只用 id/role）。"""

    role = "patient"
    id = 42


def _ctx() -> PipelineContext:
    record = type("R", (), {"id": 7, "case_id": 1})()
    user = type("U", (), {"id": 1})()
    return PipelineContext(record=record, case_data={}, current_user=user, db=object(), app_state=object())


def _single_stage(monkeypatch, name: str, stage) -> None:
    """用单个假阶段替换整条管线（``runner.STAGES`` 是唯一的执行 seam）。"""
    monkeypatch.setattr(runner_mod, "STAGES", ((name, stage),))


@pytest.mark.asyncio
async def test_early_close_lets_pipeline_finish_and_release(monkeypatch):
    """客户端断线：任务不取消（成对落库）、release 仍被调用、断线被计数。"""
    ctx = _ctx()
    persisted: list[str] = []
    released: list[str] = []

    async def slow_stage(ctx: PipelineContext):
        # 模拟 llm_caller 的 collect-then-push：先推一段内容（此时生成器可能已被关闭），
        # 再慢慢跑完 persister。队列无界，消费者消失不会把任务卡死。
        await ctx.state[STATE_STREAM_QUEUE].put("早段")
        await asyncio.sleep(0.05)
        ctx.state[STATE_SAVED_MESSAGES] = [_PatientMessage()]
        persisted.append("patient")
        await ctx.state[STATE_STREAM_QUEUE].put("晚段")

    _single_stage(monkeypatch, "slow", slow_stage)

    async def release():
        released.append("closed")

    before = abandoned_stream_count()
    agen = stream_pipeline(ctx, release=release)
    first = await agen.__anext__()
    assert "早段" in first

    await agen.aclose()

    # 任务跑完（不是被取消）——半途取消会让学生的提问凭空消失
    assert persisted == ["patient"]
    # session 的释放发生在任务结束时，因此断线也不会出现"孤儿任务写已关闭 session"
    assert released == ["closed"]
    assert ctx.state[STATE_PIPELINE_TASK].done()
    assert abandoned_stream_count() == before + 1


@pytest.mark.asyncio
async def test_completed_stream_is_not_counted_abandoned_and_keeps_done_id(monkeypatch):
    """正常跑完：不计入被放弃，done 帧仍带 patient id（id 在 release 前已快照）。"""
    ctx = _ctx()
    released: list[str] = []

    async def fast_stage(ctx: PipelineContext):
        ctx.state[STATE_SAVED_MESSAGES] = [_PatientMessage()]
        ctx.state[STATE_DONE_PAYLOAD] = {"corrections_used": 1}

    _single_stage(monkeypatch, "fast", fast_stage)

    async def release():
        released.append("closed")

    before = abandoned_stream_count()
    frames = [frame async for frame in stream_pipeline(ctx, release=release)]

    assert released == ["closed"]
    assert abandoned_stream_count() == before
    done = json.loads(frames[-1].removeprefix("data: "))
    assert done["done"] is True
    assert done["id"] == 42
    assert done["corrections_used"] == 1
