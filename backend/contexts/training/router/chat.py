"""Chat router — thin dispatcher delegating to pipeline."""

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from core.capabilities import resolve_features
from core.database import db_session, get_db
from core.datetime_utils import ensure_utc
from core.security import get_current_user
from middleware.rate_limits import check_chat_limit
from models import Case, Message, TrainingRecord, User
from schemas import ChatMessageRequest, ChatMessageResponse

from ..pipeline import (
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
    case_data = case.case_data or {} if case else {}

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
    ctx.setup_phases()
    ctx.state[STATE_STREAM_MODE] = stream_mode
    ctx.state[STATE_FEATURES] = resolve_features(ctx.record.practice_snapshot)
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


@router.post("/{record_id}/message/stream")
async def send_message_stream(
    record_id: int,
    req: ChatMessageRequest,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
):
    async def _stream_with_db():
        async with db_session() as db:
            ctx = await _build_context(record_id, req, current_user, db, request, stream_mode=True)
            pipe, collector = get_pipeline(training_type=ctx.record.training_type)
            ctx.note_collector = collector

            async for chunk in stream_pipeline(ctx, pipe):
                yield chunk

    return StreamingResponse(
        _stream_with_db(),
        media_type="text/event-stream",
    )
