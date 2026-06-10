"""Pipeline runner — executes middleware chain with short-circuit support."""

import json
import logging
from typing import Awaitable, Callable

from .context import PipelineContext

log = logging.getLogger(__name__)

PipelineMiddleware = Callable[
    [PipelineContext, Callable[[], Awaitable[None]]],
    Awaitable[None],
]


async def run_pipeline(ctx: PipelineContext, middlewares: list[PipelineMiddleware]) -> None:
    """Execute middleware chain. Middleware may set ctx.should_shortcut to skip remainder."""
    index = 0

    async def next_mw():
        nonlocal index
        if ctx.should_shortcut:
            return
        if index < len(middlewares):
            mw = middlewares[index]
            index += 1
            await mw(ctx, next_mw)

    try:
        await next_mw()
    except Exception as e:
        log.exception("Pipeline error: record_id=%d", ctx.record.id)
        ctx.error = str(e)


async def stream_pipeline(ctx: PipelineContext, middlewares: list[PipelineMiddleware]):
    """Execute pipeline in streaming mode, yielding SSE events."""
    index = 0

    async def next_mw():
        nonlocal index
        if ctx.should_shortcut:
            return
        if index < len(middlewares):
            mw = middlewares[index]
            index += 1
            await mw(ctx, next_mw)

    try:
        await next_mw()
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

    if ctx.exam_result:
        yield f"data: {json.dumps({'exam_result': ctx.exam_result}, ensure_ascii=False)}\n\n"

    if ctx.llm_reply:
        async for chunk in _emit_chunks(ctx):
            yield chunk

    done_id: int | None = None
    for msg in ctx.state.get("_saved_messages", []):
        if msg.role == "patient":
            done_id = msg.id
            break

    yield f"data: {json.dumps({'done': True, 'id': done_id}, ensure_ascii=False)}\n\n"


async def _emit_chunks(ctx: PipelineContext):
    chunks = ctx.state.get("_stream_chunks", [])
    for chunk in chunks:
        yield f"data: {json.dumps({'content': chunk}, ensure_ascii=False)}\n\n"

    if not chunks and ctx.llm_reply:
        yield f"data: {json.dumps({'content': ctx.llm_reply}, ensure_ascii=False)}\n\n"
