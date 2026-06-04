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
from services.chat_session import add_topic, restore_topics
from services.llm_service import call_llm, call_llm_stream
from services.patient_guard import get_allowed_hidden_info, sanitize_patient_reply
from services.virtual_patient_prompt import build_patient_chat_messages, build_patient_context_kwargs

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["对话"])


async def _build_llm_context(case_data: dict, history_messages: list, student_content: str, record_id: int, pm) -> list:
    history_text = " ".join(m.content for m in history_messages)
    topics = restore_topics(record_id, history_text, case_data)
    allowed = get_allowed_hidden_info(case_data, student_content, topics)

    for h in allowed:
        if h.get("triggered") and h.get("topic"):
            add_topic(record_id, h["topic"])

    kwargs = build_patient_context_kwargs(case_data, allowed)

    tmpl = await pm.get("patient_chat")
    system_prompt = tmpl.render(**kwargs)

    llm_messages = build_patient_chat_messages(system_prompt, history_messages, student_content)
    return llm_messages, allowed


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

    pm = request.app.state.prompt_manager
    messages = db.query(Message).filter(Message.record_id == record_id).order_by(Message.created_at).all()
    llm_messages, _allowed = await _build_llm_context(case_data, messages, req.content, record_id, pm)

    rid = getattr(request.state, "request_id", None)
    try:
        reply = await call_llm(
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
        )
    except (httpx.HTTPError, OSError, RuntimeError, ValueError) as e:
        log.exception(
            "patient_chat LLM调用失败", extra={"error": str(e), "user_id": current_user.id, "record_id": record_id}
        )
        import random
        reply = random.choice([
            "嗯……这个我也不太清楚，平时没太注意。",
            "你说这个我得想想……好像不是特别明显。",
            "这个我说不太准，平时也没太留意。",
            "哎呀，你突然这么问，我一下子想不起来了。",
            "这个……以前好像有过，但具体怎样我记不太清了。",
            "让我想想啊……嗯，好像没什么特别的。",
            "这个医生倒是提过，但我没记住。",
            "我平时不太在意这些，说不太上来。",
        ])
        log.info("LLM 失败兜底回复: record_id=%d", record_id)

    from services.patient_guard import correct_via_llm

    sanitized, violations, needs_correction = sanitize_patient_reply(reply, case_data)
    if violations:
        log.info("patient_guard violations", extra={"record_id": record_id, "violations": violations})

    if needs_correction:
        try:
            sanitized = await correct_via_llm(
                sanitized, violations,
                client=request.app.state.httpx_client,
                router=request.app.state.llm_router,
                log_worker=request.app.state.log_worker,
                user_id=current_user.id,
                record_id=record_id,
                case_id=record.case_id,
            )
        except Exception:
            log.exception("guard 修正失败，使用原回复")
            sanitized = reply

    student_msg = Message(record_id=record_id, role="student", content=req.content)
    db.add(student_msg)
    patient_msg = Message(record_id=record_id, role="patient", content=sanitized)
    db.add(patient_msg)
    db.commit()
    db.refresh(patient_msg)

    log.info(f"消息已记录: record_id={record_id}", extra={"user_id": current_user.id, "user_role": current_user.role})
    return ChatMessageResponse(role="patient", content=sanitized)


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
        llm_messages, _allowed = await _build_llm_context(case_data, messages, req.content, record_id, pm)

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

                from services.patient_guard import correct_via_llm, sanitize_patient_reply

                sanitized, violations, needs_correction = sanitize_patient_reply(full_reply, case_data)
                if violations:
                    log.info("patient_guard violations", extra={"record_id": record_id, "violations": violations})

                if needs_correction:
                    corrected = await correct_via_llm(
                        sanitized, violations,
                        client=request.app.state.httpx_client,
                        router=request.app.state.llm_router,
                        log_worker=request.app.state.log_worker,
                        user_id=current_user.id,
                        record_id=record_id,
                        case_id=record.case_id,
                    )
                    yield f"data: {json.dumps({'sanitized': True, 'reply': corrected, 'violations': violations}, ensure_ascii=False)}\n\n"
                    sanitized = corrected

                student_msg = Message(record_id=record_id, role="student", content=req.content)
                db.add(student_msg)
                patient_msg = Message(record_id=record_id, role="patient", content=sanitized)
                db.add(patient_msg)
                db.commit()
                db.refresh(patient_msg)

                log.info(
                    f"流式消息已记录: record_id={record_id}",
                    extra={"user_id": current_user.id, "user_role": current_user.role},
                )
                yield f"data: {json.dumps({'done': True, 'id': patient_msg.id}, ensure_ascii=False)}\n\n"
            except Exception as e:
                log.exception(
                    "patient_chat 流式LLM调用失败",
                    extra={"error": str(e), "user_id": current_user.id, "record_id": record_id},
                )
                if full_reply:
                    yield f"data: {json.dumps({'content': full_reply, 'truncated': True, 'error': str(e)[:200]}, ensure_ascii=False)}\n\n"
                else:
                    import random
                    fallback = random.choice([
                        "嗯……这个我也不太清楚，以前没太注意。",
                        "你说这个我得想想……好像不是特别明显。",
                        "这个我说不太准，平时也没太留意。",
                        "哎呀，你突然这么问，我一下子想不起来了。",
                        "让我想想啊……嗯，好像没什么特别的。",
                        "这个医生倒是提过，但我没记住。",
                    ])
                    yield f"data: {json.dumps({'content': fallback}, ensure_ascii=False)}\n\n"
                    yield f"data: {json.dumps({'done': True}, ensure_ascii=False)}\n\n"
                    return
            finally:
                db.close()

        return StreamingResponse(generate(), media_type="text/event-stream")
    except HTTPException:
        db.close()
        raise
    except Exception:
        db.close()
        raise
