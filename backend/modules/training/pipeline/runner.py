"""Pipeline runner — executes middleware chain with short-circuit support."""

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable

from .context import (
    STATE_DONE_PAYLOAD,
    STATE_PIPELINE_TASK,
    STATE_SAVED_MESSAGES,
    STATE_STREAM_QUEUE,
    PipelineContext,
)
from .turn import ERROR_PIPELINE, finalize_pending_turn

log = logging.getLogger(__name__)

PipelineMiddleware = Callable[
    [PipelineContext, Callable[[], Awaitable[None]]],
    Awaitable[None],
]

# 客户端断线时被放弃的流数量（pipeline 任务仍照跑完）。
# 整段生成期间零字节下发是常态（collect-then-push），前端 60s idle 超时后 cancel reader
# 就会走到这里，因此这是"断线频率"的唯一可见度；供测试与后续 ops 接入。
_abandoned_streams = 0


def abandoned_stream_count() -> int:
    """返回进程内累计被放弃的 SSE 流数量（客户端断线，但任务已跑完）。"""
    return _abandoned_streams


def _snapshot_done_id(ctx: PipelineContext) -> None:
    """把 done 帧需要的 patient id 从 ORM 实例搬到 ctx.state。

    ``release`` 会关闭 router 的 DB session；commit 之后 ORM 实例属性已过期，
    session 一关就再也读不出来（DetachedInstanceError），故尾帧必须先快照。
    """
    for msg in ctx.state.get(STATE_SAVED_MESSAGES, []):
        if getattr(msg, "role", None) == "patient":
            ctx.state[STATE_DONE_PAYLOAD] = {**(ctx.state.get(STATE_DONE_PAYLOAD) or {}), "id": msg.id}
            return


def _error_frame(ctx: PipelineContext) -> str:
    """SSE 错误帧：``error`` 保持既有形状，新增稳定 ``code``（可新增字段，兼容）。"""
    payload: dict = {"error": (ctx.error or "生成失败")[:200]}
    if ctx.error_code:
        payload["code"] = ctx.error_code
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


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
        ctx.error_code = ctx.error_code or ERROR_PIPELINE
    finally:
        # 链异常时 persister 可能没跑到：回合兜底收尾，绝不静默留在 pending
        await finalize_pending_turn(ctx)


async def stream_pipeline(
    ctx: PipelineContext,
    middlewares: list[PipelineMiddleware],
    *,
    release: Callable[[], Awaitable[None]] | None = None,
):
    """Execute pipeline in streaming mode, yielding SSE events.

    使用 asyncio.Queue 承载 LLM 最终文本（collect-then-push，见 llm_caller）：
    患者回复通过泄漏守卫后才整体入队，前端实时看到的 == DB 持久化的。

    生命周期契约（断线）：
      * 客户端断线 → 生成器提前关闭，但**任务不取消**：persister 必须成对写
        student + patient，半途取消会让学生的提问凭空消失。
      * 提前关闭时记日志 + 计数（``abandoned_stream_count``），并尽力等任务跑完
        （生成器正被取消时该等待会立刻中断，不影响任务本身继续跑）。
      * ``release``：由任务在自身 ``finally`` 里调用，用于释放必须活到任务结束的资源
        （router 的 DB session）。放在请求侧则会在孤儿任务仍在写库时先关 session，
        落库静默失败或重复；放在任务里可保证 session 的存活期不短于任务。
    """
    queue: asyncio.Queue[str] = asyncio.Queue()
    ctx.state[STATE_STREAM_QUEUE] = queue

    async def _run():
        try:
            await _make_next(ctx, middlewares)()
        except Exception as e:
            # 异常在此落地（不吞）：先记 ctx.error/错误码，供回合收尾与错误帧使用
            log.exception("Stream pipeline error: record_id=%d", ctx.record.id)
            ctx.error = ctx.error or str(e)
            ctx.error_code = ctx.error_code or ERROR_PIPELINE
        finally:
            # 回合兜底收尾必须在释放 DB session 之前（persister 没跑到时靠它标记 failed）
            await finalize_pending_turn(ctx)
            _snapshot_done_id(ctx)
            if release is not None:
                await release()

    task = asyncio.create_task(_run())
    ctx.state[STATE_PIPELINE_TASK] = task
    completed = False

    try:
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

        # 传播 pipeline 异常（_run 已捕获并落到 ctx.error，这里是最后一道兜底）
        try:
            await task
        except Exception as e:
            log.exception("Stream pipeline error: record_id=%d", ctx.record.id)
            ctx.error = ctx.error or str(e)
            ctx.error_code = ctx.error_code or ERROR_PIPELINE

        if ctx.error:
            yield _error_frame(ctx)
            return

        for event in ctx.system_events:
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

        done_payload = {"done": True, "id": None, **(ctx.state.get(STATE_DONE_PAYLOAD) or {})}
        completed = True
        yield f"data: {json.dumps(done_payload, ensure_ascii=False)}\n\n"
    finally:
        if not completed:
            global _abandoned_streams
            _abandoned_streams += 1
            log.warning(
                "SSE stream abandoned by client, pipeline keeps running: record_id=%d abandoned_total=%d",
                ctx.record.id,
                _abandoned_streams,
            )
        if not task.done():
            # 尽力等任务跑完（正常 aclose 时必然等到）；本协程被取消时（Starlette 对 SSE
            # 会取消）该等待立刻中断，任务与 release 不受影响。
            try:
                outcome = await asyncio.gather(task, return_exceptions=True)
            except asyncio.CancelledError:
                log.info("Stream pipeline wait interrupted by cancellation: record_id=%d", ctx.record.id)
            else:
                if outcome and isinstance(outcome[0], BaseException):
                    log.error(
                        "Abandoned pipeline failed: record_id=%d",
                        ctx.record.id,
                        exc_info=outcome[0],
                    )
