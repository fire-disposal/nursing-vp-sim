"""流式打断必须取消旧生成，而不是留下后台患者回合。"""

import asyncio
from types import SimpleNamespace

import pytest

from modules.training.pipeline import runner
from modules.training.pipeline.context import STATE_PIPELINE_TASK


@pytest.mark.asyncio
async def test_abandoned_stream_cancels_pipeline_and_releases_resources(monkeypatch):
    started = asyncio.Event()
    finalized = False
    released = False

    async def run_stages(_ctx):
        started.set()
        await asyncio.Event().wait()

    async def finalize(_ctx):
        nonlocal finalized
        finalized = True

    async def release():
        nonlocal released
        released = True

    monkeypatch.setattr(runner, "_run_stages", run_stages)
    monkeypatch.setattr(runner, "finalize_pending_turn", finalize)
    monkeypatch.setattr(runner, "_snapshot_done_id", lambda _ctx: None)
    ctx = SimpleNamespace(
        state={},
        record=SimpleNamespace(id=7),
        error=None,
        error_code=None,
        system_events=[],
    )

    stream = runner.stream_pipeline(ctx, release=release)
    pending_next = asyncio.create_task(anext(stream))
    await asyncio.wait_for(started.wait(), timeout=1)
    task = ctx.state[STATE_PIPELINE_TASK]

    pending_next.cancel()
    with pytest.raises(asyncio.CancelledError):
        await pending_next
    await stream.aclose()

    assert task.cancelled()
    assert finalized
    assert released
