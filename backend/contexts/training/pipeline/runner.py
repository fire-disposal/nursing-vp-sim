"""Pipeline runner — executes middleware chain with short-circuit support."""

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable

from .context import (
    STATE_DONE_PAYLOAD,
    STATE_POST_STREAM_EVENTS,
    STATE_SAVED_MESSAGES,
    STATE_STREAM_CHUNKS,
    STATE_STREAM_QUEUE,
    PipelineContext,
)

log = logging.getLogger(__name__)

PipelineMiddleware = Callable[
    [PipelineContext, Callable[[], Awaitable[None]]],
    Awaitable[None],
]


def _make_next(ctx: PipelineContext, middlewares: list[PipelineMiddleware]):
    index = 0

    async def next_mw():
        nonlocal index
        if ctx.should_shortcut:
            return
        if index < len(middlewares):
            mw = middlewares[index]
            index += 1
            await mw(ctx, next_mw)

    return next_mw


async def run_pipeline(ctx: PipelineContext, middlewares: list[PipelineMiddleware]) -> None:
    """Execute middleware chain. Middleware may set ctx.should_shortcut to skip remainder."""
    try:
        await _make_next(ctx, middlewares)()
    except Exception as e:
        log.exception("Pipeline error: record_id=%d", ctx.record.id)
        ctx.error = str(e)


async def stream_pipeline(ctx: PipelineContext, middlewares: list[PipelineMiddleware]):
    """Execute pipeline in streaming mode, yielding SSE events.

    使用 asyncio.Queue 在 LLM 产出块时实时推送 SSE，而非全缓冲后回放。
    保留 STATE_STREAM_CHUNKS 以支持身份纠正（correction 不经过队列）。
    """
    queue: asyncio.Queue[str] = asyncio.Queue()
    ctx.state[STATE_STREAM_QUEUE] = queue

    async def _run():
        await _make_next(ctx, middlewares)()

    task = asyncio.create_task(_run())

    # 在 pipeline 运行中实时消费 LLM 块
    while not task.done():
        try:
            chunk = await asyncio.wait_for(queue.get(), timeout=0.2)
            yield f"data: {json.dumps({'content': chunk}, ensure_ascii=False)}\n\n"
        except TimeoutError:
            continue

    # 消费 pipeline 完成后遗留的块
    while not queue.empty():
        try:
            chunk = queue.get_nowait()
            yield f"data: {json.dumps({'content': chunk}, ensure_ascii=False)}\n\n"
        except asyncio.QueueEmpty:
            break

    # 传播 pipeline 异常
    try:
        await task
    except GeneratorExit:
        log.info("Stream pipeline cancelled (disconnect): record_id=%d", ctx.record.id)
        if not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        raise
    except Exception as e:
        log.exception("Stream pipeline error: record_id=%d", ctx.record.id)
        ctx.error = str(e)
        yield f"data: {json.dumps({'error': str(e)[:200]}, ensure_ascii=False)}\n\n"
        return

    if ctx.error:
        yield f"data: {json.dumps({'error': ctx.error}, ensure_ascii=False)}\n\n"
        return

    for event in ctx.system_events:
        yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    for event in ctx.state.get(STATE_POST_STREAM_EVENTS, []):
        yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    done_id: int | None = None
    for msg in ctx.state.get(STATE_SAVED_MESSAGES, []):
        if msg.role == "patient":
            done_id = msg.id
            break

    done_payload = {"done": True, "id": done_id, **ctx.state.get(STATE_DONE_PAYLOAD, {})}
    yield f"data: {json.dumps(done_payload, ensure_ascii=False)}\n\n"


async def _emit_chunks(ctx: PipelineContext):
    chunks = ctx.state.get(STATE_STREAM_CHUNKS, [])
    for chunk in chunks:
        yield f"data: {json.dumps({'content': chunk}, ensure_ascii=False)}\n\n"

    if not chunks and ctx.llm_reply:
        yield f"data: {json.dumps({'content': ctx.llm_reply}, ensure_ascii=False)}\n\n"
