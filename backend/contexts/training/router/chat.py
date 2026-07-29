"""Chat router — thin dispatcher delegating to pipeline."""

import logging
from contextlib import AsyncExitStack
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from contexts.training.capabilities import detect_capabilities
from core.database import db_session, get_db
from core.datetime_utils import ensure_utc
from core.rate_limits import check_chat_limit
from core.security import get_current_user
from models import Case, Message, TrainingRecord, TrainingToolRequest, User
from schemas import ChatCorrectionRequest, ChatMessageRequest, ChatMessageResponse

from ..pipeline import (
    STATE_CORRECTION_TARGET,
    STATE_FEATURES,
    STATE_STREAM_MODE,
    PipelineContext,
    get_pipeline,
    run_pipeline,
    stream_pipeline,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["对话"])


async def _build_context(
    record_id: int,
    req: ChatMessageRequest,
    current_user: User,
    db: Session,
    request: Request,
    stream_mode: bool = False,
) -> PipelineContext:
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能在自己训练中发送消息")
    if record.status != "in_progress":
        raise HTTPException(status_code=400, detail="训练已结束")
    # 实时超时守卫（补漏：结算循环每 30s 一次，两次 tick 之间此前仍可发消息）
    if (
        record.start_time
        and (datetime.now(UTC) - ensure_utc(record.start_time)).total_seconds() > record.time_limit * 60
    ):
        raise HTTPException(status_code=400, detail="训练时间已到")

    await check_chat_limit(current_user.id, request)

    case = db.query(Case).filter(Case.id == record.case_id).first()
    case_data = record.case_snapshot or (case.case_data or {} if case else {})

    # 只加载最近消息用于 LLM 上下文（MAX_HISTORY_ROUNDS * 2 + 缓冲区）
    # 使用子查询避免加载整张表，减少 ~60-80% 的 DB I/O
    _subq = (
        db.query(Message.id)
        .filter(Message.record_id == record_id)
        .order_by(Message.created_at.desc())
        .limit(120)
        .subquery()
    )
    messages = db.query(Message).filter(Message.id.in_(db.query(_subq.c.id))).order_by(Message.created_at.asc()).all()

    if messages and messages[-1].role == "student":
        log.warning("Orphaned student message detected: record_id=%d msg_id=%d", record_id, messages[-1].id)

    ctx = PipelineContext(
        record=record,
        case_data=case_data,
        current_user=current_user,
        db=db,
        app_state=request.app.state,
        student_input=req.content,
        student_display=req.content,
        messages=messages,
    )
    ctx.state[STATE_STREAM_MODE] = stream_mode
    ctx.state[STATE_FEATURES] = detect_capabilities(
        case_data=ctx.case_data,
        training_type=ctx.record.training_type or "history_taking",
        overrides=(ctx.record.practice_snapshot or {}).get("features"),
    )
    return ctx


def _correction_state(record: TrainingRecord) -> dict:
    raw = dict(record.runtime_state or {}).get("message_correction")
    state = raw if isinstance(raw, dict) else {}
    limit = int(state.get("limit") or 3)
    used = max(0, int(state.get("used") or 0))
    return {"used": used, "limit": limit, "remaining": max(0, limit - used)}


def _latest_correctable_pair(db: Session, record_id: int) -> tuple[Message, Message | None, list[Message]]:
    messages = (
        db.query(Message)
        .filter(Message.record_id == record_id)
        .order_by(Message.created_at.asc(), Message.id.asc())
        .all()
    )
    if not messages:
        raise HTTPException(status_code=400, detail="暂无可修正的发言")
    patient = messages[-1] if messages[-1].role == "patient" else None
    student_idx = len(messages) - 2 if patient is not None else len(messages) - 1
    if student_idx < 0 or messages[student_idx].role != "student":
        raise HTTPException(status_code=400, detail="只能修正最近一次学生发言")
    student = messages[student_idx]
    if any(m.role == "system" for m in messages[student_idx + 1 :]):
        raise HTTPException(status_code=400, detail="上一轮之后已有系统事件，不能再修正")
    return student, patient, messages[:student_idx]


def _ensure_correction_allowed(db: Session, record: TrainingRecord, student: Message) -> dict:
    if record.status != "in_progress":
        raise HTTPException(status_code=400, detail="训练已结束")
    if record.scoring_status in {"pending", "processing", "completed"} or record.score is not None:
        raise HTTPException(status_code=400, detail="评分已开始，不能再修正")
    state = _correction_state(record)
    if state["remaining"] <= 0:
        raise HTTPException(status_code=400, detail="本次训练的修正次数已用完")
    mutation = (
        db.query(TrainingToolRequest)
        .filter(
            TrainingToolRequest.record_id == record.id,
            TrainingToolRequest.action != "load",
            TrainingToolRequest.created_at > student.created_at,
        )
        .first()
    )
    if mutation is not None:
        raise HTTPException(status_code=400, detail="上一轮之后已有工具操作，不能再修正该发言")
    return state


async def _build_correction_context(
    record_id: int,
    req: ChatCorrectionRequest,
    current_user: User,
    db: Session,
    request: Request,
) -> PipelineContext:
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能在自己训练中修正消息")
    if (
        record.start_time
        and (datetime.now(UTC) - ensure_utc(record.start_time)).total_seconds() > record.time_limit * 60
    ):
        raise HTTPException(status_code=400, detail="训练时间已到")

    await check_chat_limit(current_user.id, request)

    student, patient, prior_messages = _latest_correctable_pair(db, record_id)
    _ensure_correction_allowed(db, record, student)
    if req.content.strip() == student.content.strip():
        raise HTTPException(status_code=400, detail="修正内容没有变化")

    case = db.query(Case).filter(Case.id == record.case_id).first()
    case_data = record.case_snapshot or (case.case_data or {} if case else {})
    ctx = PipelineContext(
        record=record,
        case_data=case_data,
        current_user=current_user,
        db=db,
        app_state=request.app.state,
        student_input=req.content,
        student_display=req.content,
        messages=prior_messages[-120:],
    )
    ctx.state[STATE_STREAM_MODE] = True
    ctx.state[STATE_CORRECTION_TARGET] = {"student": student, "patient": patient}
    ctx.state[STATE_FEATURES] = detect_capabilities(
        case_data=ctx.case_data,
        training_type=ctx.record.training_type or "history_taking",
        overrides=(ctx.record.practice_snapshot or {}).get("features"),
    )
    return ctx


@router.post("/{record_id}/message", response_model=ChatMessageResponse)
async def send_message(
    record_id: int,
    req: ChatMessageRequest,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    ctx = await _build_context(record_id, req, current_user, db, request, stream_mode=False)
    pipe, collector = get_pipeline(training_type=ctx.record.training_type)
    ctx.note_collector = collector
    await run_pipeline(ctx, pipe)

    if ctx.error:
        raise HTTPException(status_code=500, detail=ctx.error)

    return ChatMessageResponse(
        role="patient",
        content=ctx.llm_reply or "",
    )


@router.post(
    "/{record_id}/message/stream",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {"schema": {"type": "string"}}}}},
)
async def send_message_stream(
    record_id: int,
    req: ChatMessageRequest,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
):
    # 校验必须在 StreamingResponse 返回前完成：响应一旦开始（200 头已发出），
    # 再抛 HTTPException 会触发 "response already started" RuntimeError。
    stack = AsyncExitStack()
    db = await stack.enter_async_context(db_session())
    try:
        ctx = await _build_context(record_id, req, current_user, db, request, stream_mode=True)
        pipe, collector = get_pipeline(training_type=ctx.record.training_type)
        ctx.note_collector = collector
    except BaseException:
        await stack.aclose()
        raise

    async def _stream_with_db():
        try:
            async for chunk in stream_pipeline(ctx, pipe):
                yield chunk
        finally:
            await stack.aclose()

    return StreamingResponse(
        _stream_with_db(),
        media_type="text/event-stream",
    )


@router.post(
    "/{record_id}/message/correct-last/stream",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {"schema": {"type": "string"}}}}},
)
async def correct_last_message_stream(
    record_id: int,
    req: ChatCorrectionRequest,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
):
    # 与普通 stream 一样：资格校验必须在 200 响应头发出前完成。
    stack = AsyncExitStack()
    db = await stack.enter_async_context(db_session())
    try:
        ctx = await _build_correction_context(record_id, req, current_user, db, request)
        pipe, collector = get_pipeline(training_type=ctx.record.training_type)
        ctx.note_collector = collector
    except BaseException:
        await stack.aclose()
        raise

    async def _stream_with_db():
        try:
            async for chunk in stream_pipeline(ctx, pipe):
                yield chunk
        finally:
            await stack.aclose()

    return StreamingResponse(
        _stream_with_db(),
        media_type="text/event-stream",
    )
