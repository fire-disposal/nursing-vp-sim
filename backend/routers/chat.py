import json
import logging
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from core.config import get_llm_config
from core.database import get_db
from core.security import get_current_user
from middleware.rate_limits import check_chat_limit
from models import Case, Message, TrainingRecord, User
from schemas import ChatMessageRequest, ChatMessageResponse
from services.llm_service import call_llm, call_llm_stream
from prompts.patient_chat import PATIENT_DYNAMIC
from services.emotion_engine import classify_intent, cleanup_emotion, get_emotion
from services.exam_handler import detect_operation, handle_operation
from services.patient_guard import get_identity_correction_note, has_identity_leak
from services.patient_initiative import cleanup_initiative, update_initiative_timer
from services.virtual_patient_prompt import build_patient_chat_messages, build_patient_context_kwargs

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["对话"])

FALLBACK_REPLIES = [
    "嗯……这个我也不太清楚，平时没太注意。",
    "你说这个我得想想……好像不是特别明显。",
    "这个我说不太准，平时也没太留意。",
    "哎呀，你突然这么问，我一下子想不起来了。",
    "让我想想啊……嗯，好像没什么特别的。",
    "这个医生倒是提过，但我没记住。",
    "我平时不太在意这些，说不太上来。",
]


def _get_emotion_note(record, student_msg: str) -> str:
    """Stub — 情绪状态机尚未实现，返回空字符串。"""
    return ""


async def _generate_patient_reply(
    messages: list[dict],
    user_id: int,
    record_id: int,
    case_id: int,
    request: Request,
    max_retries: int = 1,
) -> str:
    """调用 LLM 生成患者回复。身份泄露时追加 Author's Note 重试一次。"""
    rid = getattr(request.state, "request_id", None)
    reply = await call_llm(
        messages,
        purpose="patient_chat",
        user_id=user_id,
        record_id=record_id,
        case_id=case_id,
        log_meta={"request_id": rid} if rid else None,
        client=request.app.state.httpx_client,
        router=request.app.state.llm_router,
        log_worker=request.app.state.log_worker,
        **get_llm_config("patient_chat"),
    )

    for attempt in range(max_retries):
        if not has_identity_leak(reply):
            break
        log.warning("身份泄露重试: record_id=%d attempt=%d/%d reply_len=%d", record_id, attempt + 1, max_retries, len(reply))
        corrected_note = get_identity_correction_note()
        messages_with_note = list(messages)
        messages_with_note.insert(-1, {"role": "system", "content": corrected_note})
        reply = await call_llm(
            messages_with_note,
            purpose="patient_chat",
            user_id=user_id,
            record_id=record_id,
            case_id=case_id,
            log_meta={"request_id": rid} if rid else None,
            client=request.app.state.httpx_client,
            router=request.app.state.llm_router,
            log_worker=request.app.state.log_worker,
            **get_llm_config("patient_chat"),
        )

    if not reply or not reply.strip():
        log.warning("LLM 返回空回复: record_id=%d len=%d", record_id, len(reply) if reply else 0)
        reply = "嗯……（患者似乎在犹豫）"

    return reply


async def _build_llm_messages(case_data: dict, history_messages: list, student_content: str, record_id: int, pm) -> tuple[list[dict], str]:
    """构建 AI酒馆风格的 messages 数组。返回 (messages, author_note)。"""
    emotion = get_emotion(record_id)
    intent = classify_intent(student_content)
    emotion.update(intent)
    author_note = emotion.note

    kwargs = build_patient_context_kwargs(case_data, author_note="")
    kwargs["author_note"] = author_note  # Used by PATIENT_DYNAMIC if referenced

    tmpl = await pm.get("patient_chat")
    system_prompt = tmpl.render(**{
        k: v for k, v in kwargs.items()
        if k in {"patient_info", "scenario", "personality", "communication_style"}
    })

    from services.prompt_manager import render_template
    dynamic_prompt = render_template(PATIENT_DYNAMIC, **kwargs)

    llm_messages = build_patient_chat_messages(
        system_prompt, dynamic_prompt, history_messages, student_content,
        author_note=author_note
    )
    return llm_messages, author_note


@router.post("/{record_id}/message", response_model=ChatMessageResponse)
async def send_message(
    record_id: int,
    req: ChatMessageRequest,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能在自己训练中发送消息")
    if record.status != "in_progress":
        raise HTTPException(status_code=400, detail="训练已结束")

    await check_chat_limit(current_user.id, request)

    case = db.query(Case).filter(Case.id == record.case_id).first()
    case_data = case.case_data or {}

    # Detect and handle operations (/bp, /vitals, etc.)
    op_type = detect_operation(req.content)
    operation_result = None
    if op_type:
        operation_result = handle_operation(op_type, case_data)
        log.info("操作触发: record_id=%d op=%s", record_id, op_type)

    pm = request.app.state.prompt_manager
    messages = db.query(Message).filter(Message.record_id == record_id).order_by(Message.created_at).all()
    llm_messages, _author_note = await _build_llm_messages(case_data, messages, req.content, record_id, pm)

    rid = getattr(request.state, "request_id", None)
    try:
        reply = await _generate_patient_reply(
            llm_messages,
            user_id=current_user.id,
            record_id=record_id,
            case_id=record.case_id,
            request=request,
        )
    except (httpx.HTTPError, OSError, RuntimeError, ValueError) as e:
        log.exception(
            "patient_chat LLM调用失败", extra={"error": str(e), "user_id": current_user.id, "record_id": record_id}
        )
        import random
        reply = random.choice(FALLBACK_REPLIES)
        log.info("LLM 失败兜底回复: record_id=%d", record_id)

    student_msg = Message(record_id=record_id, role="student", content=req.content)
    db.add(student_msg)
    patient_msg = Message(record_id=record_id, role="patient", content=reply)
    db.add(patient_msg)
    db.commit()
    db.refresh(patient_msg)
    update_initiative_timer(record_id, len(reply))

    log.info("消息已记录: record_id=%d", extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""})
    return ChatMessageResponse(role="patient", content=reply)


@router.post("/{record_id}/message/stream")
async def send_message_stream(
    record_id: int,
    req: ChatMessageRequest,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
):
    from core.database import SessionLocal

    db = SessionLocal()
    try:
        record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        if not record:
            raise HTTPException(status_code=404, detail="训练记录不存在")
        if record.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="只能在自己训练中发送消息")
        if record.status != "in_progress":
            raise HTTPException(status_code=400, detail="训练已结束")

        await check_chat_limit(current_user.id, request)

        case = db.query(Case).filter(Case.id == record.case_id).first()
        case_data = case.case_data or {}

        pm = request.app.state.prompt_manager
        messages = db.query(Message).filter(Message.record_id == record_id).order_by(Message.created_at).all()
        llm_messages, _author_note = await _build_llm_messages(case_data, messages, req.content, record_id, pm)

        rid = getattr(request.state, "request_id", None)

        async def generate():
            full_reply = ""
            try:
                log.info("开始 LLM 流式调用: record_id=%d messages=%d", record_id, len(llm_messages))
                async for chunk in call_llm_stream(
                    llm_messages,
                    purpose="patient_chat",
                    user_id=current_user.id,
                    record_id=record_id,
                    case_id=record.case_id,
                    log_meta={"request_id": rid} if rid else None,
                    client=request.app.state.httpx_client,
                    router=request.app.state.llm_router,
                    log_worker=request.app.state.log_worker,
                    **get_llm_config("patient_chat"),
                ):
                    full_reply += chunk
                    yield f"data: {json.dumps({'content': chunk}, ensure_ascii=False)}\n\n"

                if has_identity_leak(full_reply):
                    log.warning("stream 身份泄露: record_id=%d reply_len=%d 触发重试", record_id, len(full_reply))
                    corrected_note = get_identity_correction_note()
                    messages_with_note = list(llm_messages)
                    messages_with_note.insert(-1, {"role": "system", "content": corrected_note})
                    full_retry = ""
                    async for chunk in call_llm_stream(
                        messages_with_note,
                        purpose="patient_chat",
                        user_id=current_user.id,
                        record_id=record_id,
                        case_id=record.case_id,
                        log_meta={"request_id": rid} if rid else None,
                        client=request.app.state.httpx_client,
                        router=request.app.state.llm_router,
                        log_worker=request.app.state.log_worker,
                        **get_llm_config("patient_chat"),
                    ):
                        full_retry += chunk
                        yield f"data: {json.dumps({'content': chunk}, ensure_ascii=False)}\n\n"
                    full_reply = full_retry

                if not full_reply.strip():
                    log.warning("stream 空回复兜底: record_id=%d", record_id)
                    full_reply = "嗯……（患者似乎在犹豫）"
                    yield f"data: {json.dumps({'content': full_reply}, ensure_ascii=False)}\n\n"

                student_msg = Message(record_id=record_id, role="student", content=req.content)
                db.add(student_msg)
                patient_msg = Message(record_id=record_id, role="patient", content=full_reply)
                db.add(patient_msg)
                db.commit()
                db.refresh(patient_msg)
                update_initiative_timer(record_id, len(full_reply))

                log.info(
                    "流式消息已记录: record_id=%d",
                    extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
                )
                yield f"data: {json.dumps({'done': True, 'id': patient_msg.id}, ensure_ascii=False)}\n\n"
            except Exception as e:
                log.exception(
                    "patient_chat 流式LLM调用失败",
                    extra={"error": str(e), "user_id": current_user.id, "record_id": record_id},
                )
                if full_reply:
                    student_msg = Message(record_id=record_id, role="student", content=req.content)
                    db.add(student_msg)
                    patient_msg = Message(record_id=record_id, role="patient", content=full_reply)
                    db.add(patient_msg)
                    db.commit()
                    db.refresh(patient_msg)
                    yield f"data: {json.dumps({'content': full_reply, 'truncated': True, 'error': str(e)[:200]}, ensure_ascii=False)}\n\n"
                    yield f"data: {json.dumps({'done': True, 'id': patient_msg.id}, ensure_ascii=False)}\n\n"
                else:
                    import random
                    fallback = random.choice(FALLBACK_REPLIES)
                    student_msg = Message(record_id=record_id, role="student", content=req.content)
                    db.add(student_msg)
                    patient_msg = Message(record_id=record_id, role="patient", content=fallback)
                    db.add(patient_msg)
                    db.commit()
                    db.refresh(patient_msg)
                    yield f"data: {json.dumps({'content': fallback}, ensure_ascii=False)}\n\n"
                    yield f"data: {json.dumps({'done': True, 'id': patient_msg.id}, ensure_ascii=False)}\n\n"
            finally:
                db.close()

        return StreamingResponse(generate(), media_type="text/event-stream")
    except HTTPException:
        db.close()
        raise
    except Exception:
        db.close()
        raise
