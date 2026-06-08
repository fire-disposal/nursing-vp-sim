"""llm_caller — call LLM for patient reply (batch or streaming)."""

import logging
import random

from services.pipeline.context import PipelineContext

log = logging.getLogger(__name__)

FALLBACK_REPLIES = [
    "嗯……这个我也不太清楚，平时没太注意。",
    "你说这个我得想想……好像不是特别明显。",
    "这个我说不太准，平时也没太留意。",
    "哎呀，你突然这么问，我一下子想不起来了。",
    "让我想想啊……嗯，好像没什么特别的。",
    "这个医生倒是提过，但我没记住。",
    "我平时不太在意这些，说不太上来。",
]


async def llm_caller(ctx: PipelineContext, next_mw) -> None:
    if ctx.should_shortcut:
        await next_mw()
        return

    is_stream = ctx.state.get("_stream_mode", False)

    if is_stream:
        await _call_stream(ctx)
    else:
        await _call_batch(ctx)

    await next_mw()


async def _call_batch(ctx: PipelineContext) -> None:
    from core.config import get_llm_config
    # TODO(v2): use Depends(get_llm_client) — see core/dependencies.py
    from services.patient_ai import has_identity_leak, get_identity_correction_note

    import httpx

    app = ctx.app_state
    try:
        reply = await call_llm(
            ctx.llm_messages,
            purpose="patient_chat",
            user_id=ctx.current_user.id,
            record_id=ctx.record.id,
            case_id=ctx.record.case_id,
            client=app.httpx_client,
            router=app.llm_router,
            log_worker=app.log_worker,
            **get_llm_config("patient_chat"),
        )
    except (httpx.HTTPError, OSError, RuntimeError, ValueError) as e:
        log.exception("LLM batch call failed: record_id=%d", ctx.record.id)
        reply = random.choice(FALLBACK_REPLIES)

    ctx.llm_reply = reply

    if has_identity_leak(reply):
        log.warning("Identity leak in batch: record_id=%d", ctx.record.id)
        corrected = get_identity_correction_note()
        msgs = list(ctx.llm_messages)
        msgs.insert(-1, {"role": "system", "content": corrected})
        try:
            retry = await call_llm(
                msgs,
                purpose="patient_chat",
                user_id=ctx.current_user.id,
                record_id=ctx.record.id,
                case_id=ctx.record.case_id,
                client=app.httpx_client,
                router=app.llm_router,
                log_worker=app.log_worker,
                **get_llm_config("patient_chat"),
            )
            if retry.strip():
                ctx.llm_reply = retry
        except Exception:
            pass

    if not ctx.llm_reply or not ctx.llm_reply.strip():
        ctx.llm_reply = "嗯……（患者似乎在犹豫）"


async def _call_stream(ctx: PipelineContext) -> None:
    from core.config import get_llm_config
    # TODO(v2): use Depends(get_llm_client) — see core/dependencies.py
    from services.patient_ai import has_identity_leak, get_identity_correction_note

    app = ctx.app_state
    full_reply = ""
    chunks = []

    try:
        async for chunk in call_llm_stream(
            ctx.llm_messages,
            purpose="patient_chat",
            user_id=ctx.current_user.id,
            record_id=ctx.record.id,
            case_id=ctx.record.case_id,
            client=app.httpx_client,
            router=app.llm_router,
            log_worker=app.log_worker,
            **get_llm_config("patient_chat"),
        ):
            full_reply += chunk
            chunks.append(chunk)
    except Exception as e:
        log.exception("LLM stream failed: record_id=%d", ctx.record.id)
        full_reply = random.choice(FALLBACK_REPLIES)
        chunks = [full_reply]

    if has_identity_leak(full_reply):
        log.warning("Identity leak in stream: record_id=%d, retrying", ctx.record.id)
        corrected = get_identity_correction_note()
        msgs = list(ctx.llm_messages)
        msgs.insert(-1, {"role": "system", "content": corrected})
        full_retry = ""
        retry_chunks = []
        try:
            async for chunk in call_llm_stream(
                msgs,
                purpose="patient_chat",
                user_id=ctx.current_user.id,
                record_id=ctx.record.id,
                case_id=ctx.record.case_id,
                client=app.httpx_client,
                router=app.llm_router,
                log_worker=app.log_worker,
                **get_llm_config("patient_chat"),
            ):
                full_retry += chunk
                retry_chunks.append(chunk)
            if full_retry.strip():
                full_reply = full_retry
                chunks = retry_chunks
        except Exception:
            pass

    if not full_reply.strip():
        full_reply = "嗯……（患者似乎在犹豫）"
        chunks = [full_reply]

    ctx.llm_reply = full_reply
    ctx.state["_stream_chunks"] = chunks
