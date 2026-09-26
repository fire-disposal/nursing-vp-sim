"""LLM caller middleware — invokes the LLM to generate patient replies."""

import logging

from infra.llm.client import CallContext
from modules.training.context.assembler import append_guard_fragments
from modules.training.context.fragment import (
    SOURCE_GUARD_HIDDEN_TOPIC,
    SOURCE_GUARD_IDENTITY,
    ContextFragment,
    ContextSlot,
)
from modules.training.context.leak_guard import (
    find_hidden_topic_leaks,
    get_hidden_topic_correction_note,
)
from modules.training.patient_ai.guards import get_identity_correction_note, has_identity_leak

from ..context import (
    STATE_LEAK_CORRECTION_COUNT,
    STATE_PATIENT_CHAT_CFG,
    STATE_STREAM_MODE,
    STATE_STREAM_QUEUE,
    PipelineContext,
)
from ..turn import (
    ERROR_LLM_EMPTY_REPLY,
    ERROR_LLM_UNAVAILABLE,
    ERROR_PROMPT_MISSING,
)

log = logging.getLogger(__name__)

#: 对学生的统一文案（稳定错误码见 pipeline/turn.py）
LLM_UNAVAILABLE_MESSAGE = "LLM 服务暂时不可用，请稍后重试"


def _collect_leak_corrections(ctx: PipelineContext, reply: str) -> list[ContextFragment]:
    """检测身份/隐藏主题泄漏，返回类型化守卫片段（空 = 无泄漏）。

    守卫只生产片段；追加方式（尾部 system 消息）由 ``append_guard_fragments``
    统一决定，中间件不再自行拼 system prompt（docs/15 §八）。
    """
    corrections: list[ContextFragment] = []
    if has_identity_leak(reply):
        corrections.append(
            ContextFragment(
                source=SOURCE_GUARD_IDENTITY,
                slot=ContextSlot.GUARD,
                text=get_identity_correction_note(),
            )
        )
    leaks = find_hidden_topic_leaks(
        reply,
        ctx.case_data,
        ctx.student_display or ctx.student_input,
    )
    if leaks:
        corrections.append(
            ContextFragment(
                source=SOURCE_GUARD_HIDDEN_TOPIC,
                slot=ContextSlot.GUARD,
                text=get_hidden_topic_correction_note(leaks),
            )
        )
    return corrections


def _fail(ctx: PipelineContext, *, error_code: str, message: str = LLM_UNAVAILABLE_MESSAGE) -> None:
    ctx.error = message
    ctx.error_code = error_code
    ctx.should_shortcut = True


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

    app = ctx.app_state
    llm_client = app.llm_client
    llm_cfg = ctx.state.get(STATE_PATIENT_CHAT_CFG)
    if llm_cfg is None:
        from infra.llm.profile import get_llm_config

        llm_cfg = get_llm_config("patient_chat")
        ctx.state[STATE_PATIENT_CHAT_CFG] = llm_cfg
    try:
        reply = await llm_client.call(
            ctx.llm_messages,
            purpose="patient_chat",
            ctx=CallContext(
                purpose="patient_chat",
                user_id=ctx.current_user.id,
                record_id=ctx.record.id,
                case_id=ctx.record.case_id,
            ),
            **llm_cfg,
        )
    except (httpx.HTTPError, OSError, RuntimeError, ValueError):
        log.exception("LLM batch call failed: record_id=%d", ctx.record.id)
        _fail(ctx, error_code=ERROR_LLM_UNAVAILABLE)
        return

    ctx.llm_reply = reply

    corrections = _collect_leak_corrections(ctx, reply)
    if corrections:
        log.warning("Patient reply leaked: record_id=%d, corrections=%d", ctx.record.id, len(corrections))
        count = ctx.state.get(STATE_LEAK_CORRECTION_COUNT, 0)
        if count < 2:
            ctx.state[STATE_LEAK_CORRECTION_COUNT] = count + 1
            if ctx.llm_messages is None:
                ctx.llm_reply = reply
                return
            msgs = append_guard_fragments(list(ctx.llm_messages), corrections)
            try:
                retry = await llm_client.call(
                    msgs,
                    purpose="patient_chat",
                    ctx=CallContext(
                        purpose="patient_chat",
                        user_id=ctx.current_user.id,
                        record_id=ctx.record.id,
                        case_id=ctx.record.case_id,
                    ),
                    **llm_cfg,
                )
                if retry.strip():
                    ctx.llm_reply = retry
            except Exception:
                log.warning("Leak retry failed (batch): record_id=%d", ctx.record.id, exc_info=True)

    if not ctx.llm_reply or not ctx.llm_reply.strip():
        _fail(ctx, error_code=ERROR_LLM_EMPTY_REPLY)
        return


async def _call_stream(ctx: PipelineContext) -> None:
    app = ctx.app_state
    llm_client = app.llm_client
    llm_cfg = ctx.state.get(STATE_PATIENT_CHAT_CFG)
    if llm_cfg is None:
        from infra.llm.profile import get_llm_config

        llm_cfg = get_llm_config("patient_chat")
        ctx.state[STATE_PATIENT_CHAT_CFG] = llm_cfg
    stream_queue = ctx.state.get(STATE_STREAM_QUEUE)

    def _call_ctx() -> CallContext:
        return CallContext(
            purpose="patient_chat",
            user_id=ctx.current_user.id,
            record_id=ctx.record.id,
            case_id=ctx.record.case_id,
        )

    async def _stream_full(msgs: list[dict]) -> str:
        """流式收集全文，不推 SSE（T1：通过守卫后才一次性推送）。

        客户端级重试置 0（max_retries=0）——避免流式中断重试把已发内容
        从头重放（T2）；重试由本层用全新 stream 调用完成，杜绝重复推送。
        """
        buf = ""
        async for chunk in llm_client.stream(
            msgs,
            purpose="patient_chat",
            ctx=_call_ctx(),
            **{**llm_cfg, "max_retries": 0},
        ):
            buf += chunk
        return buf

    if ctx.llm_messages is None:
        _fail(ctx, error_code=ERROR_PROMPT_MISSING, message="LLM 消息未构建")
        return

    full_reply = ""
    # 调用层重试（全新流）：一次失败重试一次，仍失败走错误路径
    for attempt in range(2):
        try:
            full_reply = await _stream_full(ctx.llm_messages)
            break
        except Exception:
            if attempt == 1:
                log.exception("LLM stream failed: record_id=%d", ctx.record.id)
                _fail(ctx, error_code=ERROR_LLM_UNAVAILABLE)
                return
            log.warning("LLM stream retry: record_id=%d attempt=%d", ctx.record.id, attempt)

    corrections = _collect_leak_corrections(ctx, full_reply)
    if corrections:
        correction_count = ctx.state.get(STATE_LEAK_CORRECTION_COUNT, 0)
        if correction_count >= 2:
            log.warning("Leak correction limit reached (stream): record_id=%d", ctx.record.id)
        else:
            log.warning("Leak in stream: record_id=%d, retrying", ctx.record.id)
            ctx.state[STATE_LEAK_CORRECTION_COUNT] = correction_count + 1
            if ctx.llm_messages is not None:
                msgs = append_guard_fragments(list(ctx.llm_messages), corrections)
                try:
                    retry = await _stream_full(msgs)
                    if retry.strip():
                        full_reply = retry
                except Exception:
                    log.warning("Leak retry failed (stream): record_id=%d", ctx.record.id, exc_info=True)

    if not full_reply.strip():
        _fail(ctx, error_code=ERROR_LLM_EMPTY_REPLY)
        return

    ctx.llm_reply = full_reply
    # T1：通过泄漏守卫后一次性推 SSE —— 前端实时看到的 == DB 持久化的 == 评分读到的
    if stream_queue is not None:
        await stream_queue.put(full_reply)
