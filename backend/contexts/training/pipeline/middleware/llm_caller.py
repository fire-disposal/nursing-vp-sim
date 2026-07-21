"""LLM caller middleware — invokes the LLM to generate patient replies."""

import logging

from infrastructure.llm.client import CallContext

from ..context import (
    STATE_IDENTITY_CORRECTION_COUNT,
    STATE_PATIENT_CHAT_CFG,
    STATE_SOURCE_TRACES,
    STATE_STREAM_CHUNKS,
    STATE_STREAM_MODE,
    STATE_STREAM_QUEUE,
    PipelineContext,
)

log = logging.getLogger(__name__)


async def llm_caller(ctx: PipelineContext, next_mw) -> None:
    if ctx.should_shortcut:
        await next_mw()
        return

    is_stream = ctx.state.get(STATE_STREAM_MODE, False)

    if is_stream:
        await _call_stream(ctx)
    else:
        await _call_batch(ctx)

    await next_mw()


async def _call_batch(ctx: PipelineContext) -> None:
    import httpx

    from profiles.history_taking.guards import get_identity_correction_note, has_identity_leak

    app = ctx.app_state
    llm_client = app.llm_client
    llm_cfg = ctx.state.get(STATE_PATIENT_CHAT_CFG)
    if llm_cfg is None:
        from infrastructure.llm.profile import get_llm_config

        llm_cfg = get_llm_config("patient_chat")
        ctx.state[STATE_PATIENT_CHAT_CFG] = llm_cfg
    log_meta = {"source_traces": ctx.state.get(STATE_SOURCE_TRACES, [])}
    try:
        reply = await llm_client.call(
            ctx.llm_messages,
            purpose="patient_chat",
            ctx=CallContext(
                purpose="patient_chat",
                user_id=ctx.current_user.id,
                record_id=ctx.record.id,
                case_id=ctx.record.case_id,
                log_meta=log_meta,
            ),
            **llm_cfg,
        )
    except (httpx.HTTPError, OSError, RuntimeError, ValueError):
        log.exception("LLM batch call failed: record_id=%d", ctx.record.id)
        ctx.error = "LLM 服务暂时不可用，请稍后重试"
        ctx.should_shortcut = True
        return

    ctx.llm_reply = reply

    if has_identity_leak(reply):
        log.warning("Identity leak in batch: record_id=%d", ctx.record.id)
        count = ctx.state.get(STATE_IDENTITY_CORRECTION_COUNT, 0)
        if count < 2:
            ctx.state[STATE_IDENTITY_CORRECTION_COUNT] = count + 1
            if ctx.llm_messages is None:
                ctx.llm_reply = reply
                return
            msgs = list(ctx.llm_messages)
            msgs.append({"role": "system", "content": get_identity_correction_note()})
            try:
                retry = await llm_client.call(
                    msgs,
                    purpose="patient_chat",
                    ctx=CallContext(
                        purpose="patient_chat",
                        user_id=ctx.current_user.id,
                        record_id=ctx.record.id,
                        case_id=ctx.record.case_id,
                        log_meta=log_meta,
                    ),
                    **llm_cfg,
                )
                if retry.strip():
                    ctx.llm_reply = retry
            except Exception:
                log.warning("Identity leak retry failed (batch): record_id=%d", ctx.record.id, exc_info=True)

    if not ctx.llm_reply or not ctx.llm_reply.strip():
        ctx.error = "LLM 服务暂时不可用，请稍后重试"
        ctx.should_shortcut = True
        return


async def _call_stream(ctx: PipelineContext) -> None:
    from profiles.history_taking.guards import get_identity_correction_note, has_identity_leak

    app = ctx.app_state
    llm_client = app.llm_client
    llm_cfg = ctx.state.get(STATE_PATIENT_CHAT_CFG)
    if llm_cfg is None:
        from infrastructure.llm.profile import get_llm_config

        llm_cfg = get_llm_config("patient_chat")
        ctx.state[STATE_PATIENT_CHAT_CFG] = llm_cfg
    full_reply = ""
    chunks = []
    stream_queue = ctx.state.get(STATE_STREAM_QUEUE)
    log_meta = {"source_traces": ctx.state.get(STATE_SOURCE_TRACES, [])}

    try:
        async for chunk in llm_client.stream(
            ctx.llm_messages,
            purpose="patient_chat",
            ctx=CallContext(
                purpose="patient_chat",
                user_id=ctx.current_user.id,
                record_id=ctx.record.id,
                case_id=ctx.record.case_id,
                log_meta=log_meta,
            ),
            **llm_cfg,
        ):
            full_reply += chunk
            chunks.append(chunk)
            if stream_queue is not None:
                await stream_queue.put(chunk)  # 实时推送至 SSE 流
    except Exception:
        log.exception("LLM stream failed: record_id=%d", ctx.record.id)
        ctx.error = "LLM 服务暂时不可用，请稍后重试"
        ctx.should_shortcut = True
        return

    if has_identity_leak(full_reply):
        correction_count = ctx.state.get(STATE_IDENTITY_CORRECTION_COUNT, 0)
        if correction_count >= 2:
            log.warning("Identity leak correction limit reached (stream): record_id=%d", ctx.record.id)
        else:
            log.warning("Identity leak in stream: record_id=%d, retrying", ctx.record.id)
            ctx.state[STATE_IDENTITY_CORRECTION_COUNT] = correction_count + 1
            corrected = get_identity_correction_note()
            if ctx.llm_messages is None:
                ctx.llm_reply = full_reply
                return
            msgs = list(ctx.llm_messages)
            msgs.append({"role": "system", "content": corrected})
            try:
                retry = ""
                async for chunk in llm_client.stream(
                    msgs,
                    purpose="patient_chat",
                    ctx=CallContext(
                        purpose="patient_chat",
                        user_id=ctx.current_user.id,
                        record_id=ctx.record.id,
                        case_id=ctx.record.case_id,
                        log_meta=log_meta,
                    ),
                    **llm_cfg,
                ):
                    retry += chunk
                if retry.strip():
                    full_reply = retry
                    chunks = [retry]
            except Exception:
                log.warning("Identity leak retry failed (stream): record_id=%d", ctx.record.id, exc_info=True)

    if not full_reply.strip():
        ctx.error = "LLM 服务暂时不可用，请稍后重试"
        ctx.should_shortcut = True
        return

    ctx.llm_reply = full_reply
    ctx.state[STATE_STREAM_CHUNKS] = chunks
