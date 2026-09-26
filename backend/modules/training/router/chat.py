"""Chat router — thin dispatcher delegating to pipeline.

**对话回合的唯一写入 owner**（docs/16 §四·4.2）：SSE（``/message/stream``）与非流式
（``/message``）只是同一命令的两种 transport，二者共用 ``begin_turn`` → pipeline →
``persister``，不会出现第二条写消息/写运行的路径。

事务边界（docs/15 §五，见 ``pipeline/turn.py``）：
  1. 准入守卫 / 读消息窗口（只读）；
  2. **事务 A**：学生消息 + turn(pending) → commit（``begin_turn``，在任何 LLM 之前）；
  3. LLM / 流式推送：不持有数据库事务；
  4. **事务 B**：患者消息 + turn(completed|failed) → commit（``persister``）。

``runtime_state`` 的写入（修正计数等）走 ``session/state.patch_runtime_state``：
行锁 + 重读 + 只改本键，与 Activity 命令面同一把锁，互不覆盖。

幂等：请求可带 ``request_id``（老客户端不带也会生成一个，保证每轮都有 turn 记录）。
同一 ``(record_id, request_id)`` 重放：已完成的回合直接回放同一结果、失败回合回放
同一错误码、仍在生成的回合回 409 —— 三种情况都**不再发起 LLM**，也不插入第二条
学生消息。陈旧 pending（上一进程死在这一轮）会被重新认领，沿用已落库的学生消息。
"""

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from core.database import db_session, get_db
from core.exceptions import ValidationError
from core.rate_limits import check_chat_limit
from core.security import get_current_user
from core.statuses import ScoringStatus, TrainingMode, TrainingStatus, normalize_training_mode
from models import Case, Message, TrainingAction, TrainingRecord, User
from modules.training.session.finalize import is_patient_walkout_ended
from modules.training.timing import is_training_overdue
from modules.training.workflows import workflow_for_record
from schemas import ChatCorrectionRequest, ChatMessageRequest, ChatMessageResponse

from ..pipeline import (
    STATE_CORRECTION_TARGET,
    STATE_CORRECTION_TURN,
    STATE_FEATURES,
    STATE_PIPELINE_TASK,
    STATE_STREAM_MODE,
    STATE_TURN,
    PipelineContext,
    build_note_collector,
    message_views,
    run_pipeline,
    stream_pipeline,
)
from ..pipeline.turn import (
    CODE_TURN_CONFLICT,
    CODE_TURN_IN_PROGRESS,
    CODE_TURN_SUPERSEDED,
    ERROR_INCOMPLETE,
    TURN_KIND,
    TurnClaim,
    TurnConflict,
    TurnStatus,
    begin_turn,
    message_content,
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

    # ── 事务 A：学生消息 + turn(pending)，必须在任何 LLM 调用之前落库 ──
    claim = _begin_turn(db, record=record, request_id=req.request_id, content=req.content)
    student_text = req.content
    if claim.resumed:
        # 陈旧 pending 被重新认领：正文以**已落库的学生消息**为准（不能用请求体改写它）
        student_text = message_content(db, claim.student_message_id) or req.content
        log.info("Chat turn resumed (stale pending): record_id=%d request_id=%s", record_id, claim.request_id)

    ctx = PipelineContext(
        record=record,
        case_data=case_data,
        current_user=current_user,
        db=db,
        app_state=request.app.state,
        student_input=student_text,
        student_display=student_text,
        messages=message_views(messages),
    )
    ctx.state[STATE_STREAM_MODE] = stream_mode
    ctx.state[STATE_TURN] = claim
    ctx.state[STATE_FEATURES] = workflow_for_record(ctx.record).resolve_features(
        ctx.case_data,
        overrides=(ctx.record.practice_snapshot or {}).get("features"),
    )
    return ctx


def _begin_turn(db: Session, *, record: TrainingRecord, request_id: str | None, content: str) -> TurnClaim:
    """把事务 A 的领域异常翻译成 HTTP 契约（400/409 + 稳定码）。"""
    try:
        return begin_turn(db, record=record, request_id=request_id, content=content)
    except TurnConflict as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": CODE_TURN_CONFLICT, "message": str(exc)},
        )
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=exc.detail)


def _resolve_turn_replay(ctx: PipelineContext) -> tuple[TurnClaim, str] | None:
    """命中既有回合时的回放决策（返回 None = 本轮是新回合/被重新认领，走正常流程）。

    三种已存在状态都不再发起 LLM：
      * completed → 回放同一患者回复；
      * failed    → 回放同一错误码（重试不等于把失败当作成功）；
      * pending   → 409（同一请求仍在生成中）。
    """
    claim: TurnClaim | None = ctx.state.get(STATE_TURN)
    if claim is None or not claim.replayed:
        return None
    if claim.status == TurnStatus.COMPLETED:
        content = message_content(ctx.db, claim.patient_message_id)
        if content is None:
            # 患者消息已被后续"修正"替换（修正删除并重插最后一对）→ 该回合不可回放
            raise HTTPException(
                status_code=409,
                detail={
                    "code": CODE_TURN_SUPERSEDED,
                    "message": "该回合已被后续修正替换，无法回放",
                    "replayed": True,
                    "turn_id": claim.turn_id,
                },
            )
        return claim, content
    if claim.status == TurnStatus.FAILED:
        raise HTTPException(
            status_code=409,
            detail={
                "code": claim.error_code or ERROR_INCOMPLETE,
                "message": claim.error_message or "上一回合生成失败",
                "replayed": True,
                "turn_id": claim.turn_id,
            },
        )
    raise HTTPException(
        status_code=409,
        detail={
            "code": CODE_TURN_IN_PROGRESS,
            "message": "同一请求仍在生成中，请稍候",
            "replayed": True,
            "turn_id": claim.turn_id,
        },
    )


async def _stream_turn_replay(claim: TurnClaim, content: str) -> AsyncIterator[str]:
    """重放已完成的回合：形状与正常流一致（content 帧 + done 帧），新增 replayed 标记。"""
    yield _sse({"content": content})
    yield _sse({"done": True, "id": claim.patient_message_id, "replayed": True, **claim.replay_payload})


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _turn_operation(ctx: PipelineContext) -> dict | None:
    """非流式响应的 operation 字段：回合句柄（新字段，老客户端忽略）。"""
    claim: TurnClaim | None = ctx.state.get(STATE_TURN)
    if claim is None:
        return None
    return dict(claim.replay_payload)


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
            # 回合本身（kind=chat_turn）不是"工具操作"：它在学生发言之前登记，
            # 若算进来会永久禁用修正入口
            TrainingAction.kind != TURN_KIND,
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
        messages=message_views(prior_messages[-_MESSAGE_READ_LIMIT:]),
    )
    ctx.state[STATE_STREAM_MODE] = True
    ctx.state[STATE_CORRECTION_TARGET] = {"student": student, "patient": patient}
    # 修正序号：情绪分析的 turn_id 需要与"被修正的那一轮"区分开，否则整轮被当作
    # 重复轮跳过，情绪停留在已被删除的那句话上（见 middleware/emotion_analysis）。
    ctx.state[STATE_CORRECTION_TURN] = correction_state["used"]
    ctx.state[STATE_FEATURES] = workflow_for_record(ctx.record).resolve_features(
        ctx.case_data,
        overrides=(ctx.record.practice_snapshot or {}).get("features"),
    )
    # 结束只读事务：修正的 LLM 期间不持有数据库连接/事务；新消息对在 persister 的
    # 单一事务里写入（旧消息只在新回复成功后才删，失败则原样保留）。
    db.commit()
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

    replay = _resolve_turn_replay(ctx)
    if replay is not None:
        claim, content = replay
        return ChatMessageResponse(
            role="patient",
            content=content,
            operation={"replayed": True, **claim.replay_payload},
        )

    collector = build_note_collector(workflow_for_record(ctx.record))
    ctx.note_collector = collector
    await run_pipeline(ctx)

    if ctx.error:
        raise HTTPException(status_code=500, detail=ctx.error)

    return ChatMessageResponse(role="patient", content=ctx.llm_reply or "", operation=_turn_operation(ctx))


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
        # 幂等回放：命中既有回合 → 直接回放，不重复开始 LLM（也不新建 SSE 任务）
        replay = _resolve_turn_replay(ctx)
        if replay is not None:
            claim, content = replay
            await stack.aclose()
            return StreamingResponse(
                _stream_turn_replay(claim, content),
                media_type="text/event-stream",
                headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
            )
        collector = build_note_collector(workflow_for_record(ctx.record))
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
            async for chunk in stream_pipeline(ctx, release=stack.aclose):
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
        collector = build_note_collector(workflow_for_record(ctx.record))
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
            async for chunk in stream_pipeline(ctx, release=stack.aclose):
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
