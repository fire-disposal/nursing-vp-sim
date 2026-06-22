import asyncio
import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse

from contexts.training.score_engine import evaluate_training
from core.config import SCORING_TIMEOUT_SECONDS
from core.database import SessionLocal, db_session, get_db
from core.datetime_utils import ensure_utc
from core.security import get_current_user
from infrastructure.llm.client import LLMClient
from infrastructure.prompt import PromptManager
from infrastructure.queue import QueueFullError
from infrastructure.scoring_progress import ScoringProgressTracker
from models import Case, Message, Notification, Score, ScoreReview, TrainingRecord, User
from schemas import ScoringTriggerResponse
from schemas.common import OkResponse
from schemas.training import ScoringStatusResponse, TrainingNotificationItem

from .session import _try_acquire_scoring

log = logging.getLogger(__name__)

router = APIRouter()

# Generation counter to detect stale background scoring tasks.
# Incremented in _try_acquire_scoring whenever a new scoring session starts.
_scoring_generation: dict[int, int] = {}


def _increment_scoring_generation(record_id: int) -> None:
    _scoring_generation[record_id] = _scoring_generation.get(record_id, 0) + 1


def _get_current_generation(record_id: int) -> int:
    return _scoring_generation.get(record_id, 0)


@router.get("/{record_id}/scoring-status", response_model=ScoringStatusResponse)
def get_scoring_status(
    record_id: int,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if record.user_id != current_user.id and not current_user.has_permission("score_review"):
        raise HTTPException(status_code=403, detail="无权限")

    score = db.query(Score).filter(Score.record_id == record_id).first()
    review_exists = score and db.query(ScoreReview).filter(ScoreReview.score_id == score.id).first() is not None

    progress = None
    tracker: ScoringProgressTracker | None = getattr(request.app.state, "scoring_tracker", None)
    if tracker:
        p = tracker.get(record_id)
        if p:
            progress = {
                "phase": p["stage"],
                "percentage": p["percent"],
                "message": p["message"],
                "thought": p.get("thought_scoring", "") or p.get("thought_feedback", "") or "",
                "score_thought": p.get("thought_scoring", ""),
                "feedback_thought": p.get("thought_feedback", ""),
            }

    return {
        "scoring_status": record.scoring_status,
        "scoring_error": record.scoring_error,
        "score": {
            "total_score": score.total_score,
            "detail_scores": score.detail_scores,
            "review_status": "reviewed" if review_exists else "pending",
        }
        if score
        else None,
        "progress": progress,
    }


def _set_overdue_if_needed(record: TrainingRecord, db: Session) -> None:
    if not record.assignment_id or record.is_overdue:
        return
    from models import Assignment

    assignment = db.query(Assignment).filter(Assignment.id == record.assignment_id).first()
    if assignment and record.end_time and ensure_utc(record.end_time) > ensure_utc(assignment.end_time):
        record.is_overdue = True


async def _run_scoring_background(
    record_id: int,
    case_data: dict,
    *,
    llm_client: LLMClient,
    pm: PromptManager,
    tracker: ScoringProgressTracker | None = None,
    sse_manager=None,
) -> None:
    SCORING_GLOBAL_TIMEOUT = SCORING_TIMEOUT_SECONDS

    db = SessionLocal()
    gen = _get_current_generation(record_id)
    log.info("[SCORING] START record_id=%d gen=%d timeout=%ds", record_id, gen, SCORING_GLOBAL_TIMEOUT)
    try:
        record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        if not record:
            log.warning("评分任务：记录不存在", extra={"record_id": record_id})
            return
        log.info("评分任务开始", extra={"record_id": record_id, "scoring_status": record.scoring_status})
        if _get_current_generation(record_id) != gen:
            log.info("评分被新任务取代，跳过执行", extra={"record_id": record_id})
            return

        record.scoring_status = "processing"
        db.commit()

        if tracker:
            tracker.start(record_id)

        await asyncio.wait_for(
            evaluate_training(
                record_id,
                case_data,
                db,
                pm=pm,
                llm_client=llm_client,
                tracker=tracker,
                sse_manager=sse_manager,
                user_id=record.user_id,
            ),
            timeout=SCORING_GLOBAL_TIMEOUT,
        )

        if _get_current_generation(record_id) != gen:
            log.info("评分被新任务取代，跳过完成状态更新", extra={"record_id": record_id})
            return

        record.scoring_status = "completed"
        record.scoring_error = None
        if tracker:
            tracker.update(record_id, "completed", 100, "评分完成")
        db.commit()
        log.info("[SCORING] DONE record_id=%d", record_id)

        try:
            notif = Notification(
                user_id=record.user_id,
                record_id=record.id,
                type="scoring_complete",
                title="评分已完成",
                body="训练评分已完成，请查看详情",
            )
            db.add(notif)
            db.commit()
        except Exception:
            db.rollback()
            log.warning("Failed to create scoring notification", exc_info=True)

        if sse_manager:
            try:
                score_obj = db.query(Score).filter(Score.record_id == record_id).first()
                await sse_manager.publish(
                    record.user_id,
                    "scoring_complete",
                    {
                        "record_id": record.id,
                        "total_score": score_obj.total_score if score_obj else None,
                    },
                )
            except Exception:
                log.warning("SSE publish failed", exc_info=True)
    except TimeoutError:
        log.exception("[SCORING] TIMEOUT record_id=%d", record_id)
        if tracker:
            tracker.update(record_id, "failed", 0, "评分超时（超过5分钟）")
        try:
            db.expire_all()
            record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
            if record and _get_current_generation(record_id) == gen:
                record.scoring_status = "failed"
                record.scoring_error = "评分超时（超过5分钟）"
                db.commit()
        except Exception as e:
            log.exception("评分超时后状态更新失败", extra={"record_id": record_id, "error": str(e)})
    except Exception as e:
        log.exception("[SCORING] FAIL record_id=%d error=%s: %s", record_id, type(e).__name__, str(e)[:200])
        if tracker:
            tracker.update(record_id, "failed", 0, str(e)[:100])
        try:
            db.expire_all()
            record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
            if record and _get_current_generation(record_id) == gen:
                record.scoring_status = "failed"
                record.scoring_error = str(e)[:2000] or f"{type(e).__name__}"
                db.commit()
        except Exception as inner:
            log.exception("评分失败后状态更新失败", extra={"record_id": record_id, "error": str(inner)})
    finally:
        db.close()
        if tracker:
            tracker.cleanup(record_id)
        if _get_current_generation(record_id) == gen:
            _scoring_generation.pop(record_id, None)


@router.post("/{record_id}/end", response_model=ScoringTriggerResponse)
async def end_training(
    record_id: int,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
):
    async with db_session() as db:
        record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        if not record:
            raise HTTPException(status_code=404, detail="训练记录不存在")
        if record.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="只能结束自己的训练")
        if record.status == "completed":
            raise HTTPException(status_code=400, detail="训练已结束")
        if record.scoring_status in ("pending", "processing"):
            raise HTTPException(status_code=400, detail="评分正在进行中，请稍后查看")

        if not _try_acquire_scoring(record_id, db):
            raise HTTPException(status_code=409, detail="评分已被其他请求触发，请刷新查看")

        case = db.query(Case).filter(Case.id == record.case_id).first()
        case_data = case.case_data if case else {}

        record.status = "completed"
        record.end_time = datetime.now(UTC)
        _set_overdue_if_needed(record, db)

        try:
            await request.app.state.task_queue.enqueue(
                lambda: _run_scoring_background(
                    record_id,
                    case_data,
                    llm_client=request.app.state.llm_client,
                    pm=request.app.state.prompt_manager,
                    tracker=getattr(request.app.state, "scoring_tracker", None),
                    sse_manager=request.app.state.sse_manager,
                ),
                priority=5,
            )
        except QueueFullError:
            raise HTTPException(status_code=503, detail="评分队列繁忙，请稍后重试")

        db.commit()

        from core.capabilities import resolve_features

        features = resolve_features(record.practice_snapshot)
        if features.get("patient_initiative"):
            from contexts.patient.initiative import cleanup_initiative

            cleanup_initiative(record.id, request.app.state.initiative_cache, db)
        if features.get("emotion"):
            from contexts.patient.emotion import cleanup_emotion

            cleanup_emotion(record.id, request.app.state.emotion_cache, db)

        message_count = db.query(func.count(Message.id)).filter(Message.record_id == record_id).scalar() or 0
        log.info(
            f"训练结束: record_id={record_id} case_id={record.case_id} messages={message_count}",
            extra={
                "user_id": current_user.id,
                "user_role": current_user.role.name if current_user.role else "",
                "action": "training_end",
            },
        )
        return {
            "message": "训练已结束，评分正在后台生成中",
            "record_id": record_id,
            "scoring_status": "pending",
        }


@router.post("/{record_id}/retry-scoring", response_model=ScoringTriggerResponse)
async def retry_scoring(
    record_id: int,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
):
    async with db_session() as db:
        record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        if not record:
            raise HTTPException(status_code=404, detail="训练记录不存在")
        if not current_user.has_permission("score_review") and record.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="无权操作此记录")
        if record.status != "completed":
            raise HTTPException(status_code=400, detail="训练尚未结束")

        now = datetime.now(UTC)
        if record.scoring_status in ("pending", "processing"):
            if record.end_time and (now - ensure_utc(record.end_time)).total_seconds() <= 300:
                raise HTTPException(status_code=400, detail="评分正在进行中，请稍后重试")

        if not _try_acquire_scoring(record_id, db, allow_retry=True):
            raise HTTPException(status_code=409, detail="评分已被其他请求触发，请稍后重试")

        old_score = db.query(Score).filter(Score.record_id == record_id).first()
        if old_score:
            db.query(ScoreReview).filter(ScoreReview.score_id == old_score.id).delete()
            db.delete(old_score)

        db.commit()

        case = db.query(Case).filter(Case.id == record.case_id).first()
        case_data = case.case_data if case else {}

        try:
            await request.app.state.task_queue.enqueue(
                lambda: _run_scoring_background(
                    record_id,
                    case_data,
                    llm_client=request.app.state.llm_client,
                    pm=request.app.state.prompt_manager,
                    tracker=getattr(request.app.state, "scoring_tracker", None),
                    sse_manager=request.app.state.sse_manager,
                ),
                priority=5,
            )
        except QueueFullError:
            raise HTTPException(status_code=503, detail="评分队列繁忙，请稍后重试")

        return {"message": "评分已重新触发", "record_id": record_id, "scoring_status": "pending"}


@router.get("/notifications", response_model=list[TrainingNotificationItem])
def get_notifications(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    notifs = (
        db.query(Notification)
        .filter(
            Notification.user_id == current_user.id,
            Notification.is_read == False,
        )
        .order_by(Notification.created_at.desc())
        .limit(20)
        .all()
    )
    return [
        {
            "id": n.id,
            "type": n.type,
            "title": n.title,
            "body": n.body,
            "record_id": n.record_id,
            "created_at": str(n.created_at),
        }
        for n in notifs
    ]


@router.patch("/notifications/{notif_id}", response_model=OkResponse)
def mark_notification_read(
    notif_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    notif = db.query(Notification).filter(Notification.id == notif_id, Notification.user_id == current_user.id).first()
    if not notif:
        raise HTTPException(status_code=404, detail="通知不存在")
    notif.is_read = True
    db.commit()
    return OkResponse(message="ok")


@router.patch("/notifications/read-all", response_model=OkResponse)
def mark_all_notifications_read(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.is_read == False,
    ).update({"is_read": True}, synchronize_session=False)
    db.commit()
    return OkResponse(message="ok")


@router.get("/notifications/stream")
async def notifications_stream(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
):
    manager = request.app.state.sse_manager
    queue = await manager.subscribe(current_user.id)

    async def event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30)
                    yield event
                except TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            manager.unsubscribe(current_user.id, queue)

    return StreamingResponse(event_generator(), media_type="text/event-stream")
