"""Chat router — thin dispatcher delegating to pipeline."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from core.database import db_session, get_db
from core.feature_flags import resolve_features
from core.security import get_current_user
from middleware.rate_limits import check_chat_limit
from models import Case, Message, TrainingRecord, User
from schemas import ChatMessageRequest, ChatMessageResponse

from ..pipeline import (
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

    await check_chat_limit(current_user.id, request)

    case = db.query(Case).filter(Case.id == record.case_id).first()
    case_data = case.case_data or {} if case else {}

    messages = db.query(Message).filter(Message.record_id == record_id).order_by(Message.created_at).all()

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
    ctx.state["_stream_mode"] = stream_mode
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
    features = resolve_features(ctx.record.practice_snapshot)
    pipe = get_pipeline(features)
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
    async with db_session() as db:
        ctx = await _build_context(record_id, req, current_user, db, request, stream_mode=True)
        features = resolve_features(ctx.record.practice_snapshot)
        pipe = get_pipeline(features)

        return StreamingResponse(
            stream_pipeline(ctx, pipe),
            media_type="text/event-stream",
        )
