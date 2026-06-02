from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from database import get_db
from models import User, Case, TrainingRecord, Message
from schemas import ChatMessageRequest, ChatMessageResponse
from auth import get_current_user
from services.llm_service import call_llm, call_llm_stream
from services.virtual_patient_prompt import build_patient_context_kwargs, build_patient_chat_messages
from services.prompt_manager import get_prompt_manager
from services.variable_registry import get_registry
from services.patient_guard import (
    get_allowed_hidden_info, sanitize_patient_reply,
)
from services.chat_session import restore_topics, add_topic, cleanup_topics
from config import get_llm_config
from rate_limiter import check_chat_limit
from logger import log
import json

router = APIRouter(prefix="/api/chat", tags=["对话"])


async def _build_llm_context(case_data: dict, history_messages: list,
                               student_content: str, record_id: int) -> list:
    """构建 LLM 消息列表。编排角色：恢复已泄露主题 → 筛选隐藏信息 → 构建渲染变量 → 渲染模板 → 组装消息。"""
    history_text = " ".join(m.content for m in history_messages)
    topics = restore_topics(record_id, history_text, case_data)
    allowed = get_allowed_hidden_info(case_data, student_content, topics)

    for h in allowed:
        if h.get("triggered") and h.get("topic"):
            add_topic(record_id, h["topic"])

    kwargs = build_patient_context_kwargs(case_data, allowed)

    pm = await get_prompt_manager()
    tmpl = await pm.get("patient_chat")
    system_prompt = tmpl.render(**kwargs)

    llm_messages = build_patient_chat_messages(system_prompt, history_messages, student_content)
    return llm_messages, allowed


@router.post("/{record_id}/message", response_model=ChatMessageResponse)
async def send_message(
    record_id: int,
    req: ChatMessageRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能在自己训练中发送消息")
    if record.status != "in_progress":
        raise HTTPException(status_code=400, detail="训练已结束")

    check_chat_limit(current_user.id)

    case = db.query(Case).filter(Case.id == record.case_id).first()
    case_data = case.case_data or {}

    messages = db.query(Message).filter(Message.record_id == record_id).order_by(Message.created_at).all()
    llm_messages, _allowed = await _build_llm_context(case_data, messages, req.content, record_id)

    rid = getattr(request.state, "request_id", None)
    try:
        reply = await call_llm(llm_messages,
                                purpose="patient_chat", user_id=current_user.id,
                                record_id=record_id, case_id=record.case_id,
                                log_meta={"request_id": rid} if rid else None,
                                **get_llm_config("patient_chat"))
    except Exception as e:
        log.error("patient_chat LLM调用失败", extra={"error": str(e), "user_id": current_user.id, "record_id": record_id})
        raise HTTPException(status_code=502, detail=f"LLM 调用失败: {str(e)}")

    # 角色守卫：检测越界并替换
    sanitized, violations = sanitize_patient_reply(reply, case_data)
    if violations:
        log.info("patient_guard", extra={"record_id": record_id, "violations": violations})

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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """流式发送消息：逐字返回 LLM 回复，大幅提升感知速度"""
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能在自己训练中发送消息")
    if record.status != "in_progress":
        raise HTTPException(status_code=400, detail="训练已结束")

    check_chat_limit(current_user.id)

    case = db.query(Case).filter(Case.id == record.case_id).first()
    case_data = case.case_data or {}

    messages = db.query(Message).filter(Message.record_id == record_id).order_by(Message.created_at).all()
    llm_messages, _allowed = await _build_llm_context(case_data, messages, req.content, record_id)

    rid = getattr(request.state, "request_id", None)

    async def generate():
        full_reply = ""
        try:
            async for chunk in call_llm_stream(
                llm_messages,
                purpose="patient_chat", user_id=current_user.id,
                record_id=record_id, case_id=record.case_id,
                log_meta={"request_id": rid} if rid else None,
                **get_llm_config("patient_chat"),
            ):
                full_reply += chunk
                yield f"data: {json.dumps({'content': chunk}, ensure_ascii=False)}\n\n"

            sanitized, violations = sanitize_patient_reply(full_reply, case_data)
            if violations:
                log.info("patient_guard", extra={"record_id": record_id, "violations": violations})
                yield f"data: {json.dumps({'sanitized': True, 'reply': sanitized, 'violations': violations}, ensure_ascii=False)}\n\n"

            student_msg = Message(record_id=record_id, role="student", content=req.content)
            db.add(student_msg)
            patient_msg = Message(record_id=record_id, role="patient", content=sanitized)
            db.add(patient_msg)
            db.commit()
            db.refresh(patient_msg)

            log.info(f"流式消息已记录: record_id={record_id}", extra={"user_id": current_user.id, "user_role": current_user.role})
            yield f"data: {json.dumps({'done': True, 'id': patient_msg.id}, ensure_ascii=False)}\n\n"
        except Exception as e:
            log.error("patient_chat 流式LLM调用失败", extra={"error": str(e), "user_id": current_user.id, "record_id": record_id})
            if full_reply:
                yield f"data: {json.dumps({'content': full_reply, 'truncated': True, 'error': str(e)[:200]}, ensure_ascii=False)}\n\n"
            else:
                yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
