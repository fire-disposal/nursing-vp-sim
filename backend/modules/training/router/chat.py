"""Chat router — thin dispatcher delegating to pipeline."""

import asyncio
import logging
from contextlib import AsyncExitStack
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from core.database import db_session, get_db
from core.rate_limits import check_chat_limit
from core.security import get_current_user
from core.statuses import ScoringStatus, TrainingMode, TrainingStatus, normalize_training_mode
from models import Case, Message, TrainingAction, TrainingRecord, User
from modules.training.capabilities import detect_capabilities
from modules.training.session.finalize import is_patient_walkout_ended
from modules.training.timing import is_training_overdue
from schemas import ChatCorrectionRequest, ChatMessageRequest, ChatMessageResponse

from ..pipeline import (
    STATE_CORRECTION_TARGET,
    STATE_CORRECTION_TURN,
    STATE_FEATURES,
    STATE_PIPELINE_TASK,
    STATE_STREAM_MODE,
    PipelineContext,
    build_pipeline,
    run_pipeline,
    stream_pipeline,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["对话"])

# 单次从 DB 读取的消息条数上限。**不是** LLM 上下文上限——实际有多少条进入提示词由
# context.budget 的 token 预算 + 保护集决定。这里限流只为控制 I/O 与内存：单次训练的
# 有效轮次远小于该值，截断不会影响评分/回放（这两者走自己的查询）。
_MESSAGE_READ_LIMIT = 120


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
    if record.status != TrainingStatus.IN_PROGRESS:
        raise HTTPException(status_code=400, detail="训练已结束")
    if is_training_overdue(record):
        raise HTTPException(status_code=409, detail="训练已超时，已自动提交，无法继续对话")
    if is_patient_walkout_ended(record):
        raise HTTPException(status_code=409, detail="患者已中止本次访谈，无法继续对话")

    await check_chat_limit(current_user.id, request)

    case = db.query(Case).filter(Case.id == record.case_id).first()
    case_data = record.case_snapshot or (case.case_data or {} if case else {})

    # 只读最近 _MESSAGE_READ_LIMIT 条（见常量说明：DB I/O 上限，不是 LLM 上下文上限）
    # 使用子查询避免加载整张表，减少 ~60-80% 的 DB I/O
    _recent_ids = (
        db.query(Message.id)
        .filter(Message.record_id == record_id)
        .order_by(Message.created_at.desc())
        .limit(_MESSAGE_READ_LIMIT)
        .subquery()
    )
    messages = (
        db.query(Message).filter(Message.id.in_(db.query(_recent_ids.c.id))).order_by(Message.created_at.asc()).all()
    )

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
    if record.status != TrainingStatus.IN_PROGRESS:
        raise HTTPException(status_code=400, detail="训练已结束")
    mode = normalize_training_mode((record.practice_snapshot or {}).get("behavior", {}).get("mode"))
    if mode == TrainingMode.ASSESSMENT.value:
        raise HTTPException(status_code=400, detail="独立考核不允许修正已发送消息")
    if (
        record.scoring_status
        in {
            ScoringStatus.PENDING,
            ScoringStatus.PROCESSING,
            ScoringStatus.COMPLETED,
        }
        or record.score is not None
    ):
        raise HTTPException(status_code=400, detail="评分已开始，不能再修正")
    state = _correction_state(record)
    if state["remaining"] <= 0:
        raise HTTPException(status_code=400, detail="本次训练的修正次数已用完")
    mutation = (
        db.query(TrainingAction)
        .filter(
            TrainingAction.record_id == record.id,
            TrainingAction.kind != "load",
            TrainingAction.created_at > student.created_at,
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
    if is_training_overdue(record):
        raise HTTPException(status_code=409, detail="训练已超时，已自动提交，无法继续对话")

    await check_chat_limit(current_user.id, request)

    student, patient, prior_messages = _latest_correctable_pair(db, record_id)
    correction_state = _ensure_correction_allowed(db, record, student)
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
        messages=prior_messages[-_MESSAGE_READ_LIMIT:],
    )
    ctx.state[STATE_STREAM_MODE] = True
    ctx.state[STATE_CORRECTION_TARGET] = {"student": student, "patient": patient}
    # 修正序号：情绪分析的 turn_id 需要与"被修正的那一轮"区分开，否则整轮被当作
    # 重复轮跳过，情绪停留在已被删除的那句话上（见 middleware/emotion_analysis）。
    ctx.state[STATE_CORRECTION_TURN] = correction_state["used"]
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
    pipe, collector = build_pipeline()
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
        pipe, collector = build_pipeline()
        ctx.note_collector = collector
    except BaseException as exc:
        await stack.aclose()
        if not isinstance(exc, (GeneratorExit, asyncio.CancelledError)):
            log.warning("send_message_stream context build failed", exc_info=True)
        raise

    async def _stream_with_db():
        # release：DB session 的关闭挂在 pipeline 任务自己的 finally 上，保证 session 的
        # 存活期不短于任务。客户端断线后生成器会被关闭/取消，但任务仍会跑完并成对落库
        # （见 runner.stream_pipeline）——请求侧提前关 session 会让这些写入静默失败。
        try:
            async for chunk in stream_pipeline(ctx, pipe, release=stack.aclose):
                yield chunk
        finally:
            # 兜底：生成器从未被迭代（任务没启动）或任务已结束（session 已由任务释放）时
            # 由请求侧收尾；AsyncExitStack.aclose 幂等，重复调用无副作用。
            task = ctx.state.get(STATE_PIPELINE_TASK)
            if task is None or task.done():
                await stack.aclose()

    return StreamingResponse(
        _stream_with_db(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
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
        pipe, collector = build_pipeline()
        ctx.note_collector = collector
    except BaseException as exc:
        await stack.aclose()
        if not isinstance(exc, (GeneratorExit, asyncio.CancelledError)):
            log.warning("correct_last_message_stream context build failed", exc_info=True)
        raise

    async def _stream_with_db():
        # release：DB session 的关闭挂在 pipeline 任务自己的 finally 上，保证 session 的
        # 存活期不短于任务。客户端断线后生成器会被关闭/取消，但任务仍会跑完并成对落库
        # （见 runner.stream_pipeline）——请求侧提前关 session 会让这些写入静默失败。
        try:
            async for chunk in stream_pipeline(ctx, pipe, release=stack.aclose):
                yield chunk
        finally:
            # 兜底：生成器从未被迭代（任务没启动）或任务已结束（session 已由任务释放）时
            # 由请求侧收尾；AsyncExitStack.aclose 幂等，重复调用无副作用。
            task = ctx.state.get(STATE_PIPELINE_TASK)
            if task is None or task.done():
                await stack.aclose()

    return StreamingResponse(
        _stream_with_db(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )
