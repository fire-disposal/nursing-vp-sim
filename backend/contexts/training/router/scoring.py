import asyncio
import logging
import os
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from contexts.training.score_engine import evaluate_training
from core.config import (
    AUTO_SCORE_STUDENT_CHARS_MIN,
    AUTO_SCORE_STUDENT_MSG_MIN,
    SCORING_RETRY_GRACE_SECONDS,
    SCORING_TIMEOUT_SECONDS,
)
from core.database import SessionLocal, db_session, get_db
from core.datetime_utils import ensure_utc
from core.security import get_current_user
from infrastructure.llm.client import LLMClient
from infrastructure.queue import QueueFullError
from infrastructure.scoring_progress import ScoringProgressTracker

# NOTE: ScoringProgressTracker 是内存 dict — 仅适合作业内暂存。
# 多 worker 下会各自独立，不影响功能（UI 轮询走当前 worker）。
from models import Case, Message, Notification, Score, ScoreReview, TrainingRecord, User
from schemas import ScoringTriggerResponse
from schemas.common import OkResponse, PaginatedResponse
from schemas.training import ScoringStatusResponse, TrainingNotificationItem

from ..scoring_lifecycle import acquire_scoring, claim_scoring, release_scoring

log = logging.getLogger(__name__)

router = APIRouter()

SCORING_RETRY_DELAY_SECONDS = int(os.getenv("SCORING_RETRY_DELAY_SECONDS", "30"))

# Generation counter to detect stale background scoring tasks.
# Incremented in acquire_scoring whenever a new scoring session starts.
# Scoring 生成控制：使用 DB 的 scoring_status 作为唯一仲裁者。
# 弃用进程内 generation dict（多 worker 下不安全）。
# 每个任务在写入终态前校验 scoring_status 是否仍是 "processing"。


def _check_scoring_threshold(db: Session, record_id: int) -> str | None:
    student_msgs = db.query(Message).filter(Message.record_id == record_id, Message.role == "student").all()
    student_msg_count = len(student_msgs)
    student_chars = sum(len(m.content or "") for m in student_msgs)

    if student_msg_count < AUTO_SCORE_STUDENT_MSG_MIN:
        return (
            f"训练对话内容过少，未生成评分"
            f"（已发送 {student_msg_count} 条消息，需要至少 {AUTO_SCORE_STUDENT_MSG_MIN} 条）"
        )
    if student_chars < AUTO_SCORE_STUDENT_CHARS_MIN:
        return f"训练对话内容过少，未生成评分（已输入 {student_chars} 字，需要至少 {AUTO_SCORE_STUDENT_CHARS_MIN} 字）"
    return None


def _create_notification(
    db: Session,
    *,
    user_id: int,
    record_id: int | None,
    type: str,
    title: str,
    body: str,
) -> None:
    """Create a user notification in its own transaction. Never raises."""
    try:
        db.add(
            Notification(
                user_id=user_id,
                record_id=record_id,
                type=type,
                title=title,
                body=body,
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        log.warning("Failed to create notification (type=%s)", type, exc_info=True)


async def _publish_scoring_event(realtime_hub, user_id: int, event: str, payload: dict) -> None:
    """Publish an SSE event, swallowing transport errors."""
    if not realtime_hub:
        return
    try:
        await realtime_hub.publish(user_id, event, payload)
    except Exception:
        log.warning("SSE publish failed (event=%s)", event, exc_info=True)


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


def _resolve_terminal_status(db: Session, record_id: int, *, intended: str) -> str:
    """若记录已存在有效 Score，则终态强制为 'completed'，避免孤儿 Score + failed。

    intended 为调用方本想设置的终态（通常 'failed'）。仅当无 Score 时才沿用。
    """
    has_score = db.query(Score.id).filter(Score.record_id == record_id).first() is not None
    if has_score:
        return "completed"
    return intended


def _handle_scoring_failure(
    record_id: int,
    error_msg: str,
    tracker: ScoringProgressTracker | None = None,
    realtime_hub=None,
    user_id: int | None = None,
) -> None:
    """Shared error handling — updates DB status, creates notification, publishes SSE."""
    try:
        from core.database import SessionLocal

        db = SessionLocal()
        try:
            db.expire_all()
            record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
            if record and record.scoring_status == "processing":
                terminal = _resolve_terminal_status(db, record_id, intended="failed")
                record.scoring_status = terminal
                record.scoring_error = None if terminal == "completed" else error_msg[:2000]
                db.commit()
                if terminal == "completed":
                    log.info("评分超时但已存在有效 Score，纠正为 completed", extra={"record_id": record_id})
                    return
                actual_user_id = user_id or record.user_id
                _create_notification(
                    db,
                    user_id=actual_user_id,
                    record_id=record.id,
                    type="scoring_failed",
                    title="评分失败",
                    body=f"评分失败：{error_msg[:100] or '未知错误'}",
                )
                if realtime_hub:
                    import asyncio

                    asyncio.ensure_future(  # noqa: RUF006
                        _publish_scoring_event(
                            realtime_hub,
                            actual_user_id,
                            "scoring_failed",
                            {"record_id": record.id, "error": error_msg[:100] or "未知错误"},
                        )
                    )
        finally:
            db.close()
    except Exception as inner:
        log.exception("评分失败后状态更新失败", extra={"record_id": record_id, "error": str(inner)})


async def _run_scoring_background(
    record_id: int,
    case_data: dict,
    *,
    llm_client: LLMClient,
    tracker: ScoringProgressTracker | None = None,
    realtime_hub=None,
) -> None:
    SCORING_GLOBAL_TIMEOUT = SCORING_TIMEOUT_SECONDS

    db = SessionLocal()
    log.info("[SCORING] START record_id=%d timeout=%ds", record_id, SCORING_GLOBAL_TIMEOUT)
    try:
        record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        if not record:
            log.warning("评分任务：记录不存在", extra={"record_id": record_id})
            return
        log.info("评分任务开始", extra={"record_id": record_id, "scoring_status": record.scoring_status})
        # 原子性认领：仅当记录处于可执行态才继续。
        # 'pending'  — end_training / retry_scoring / triage 经 acquire_scoring 获取；
        # NULL       — settlement 自动结算路径（未走 acquire）。
        # UPDATE 的 rowcount 保证并发重复入队时只有一个 worker 认领成功（幂等）。
        claimed = claim_scoring(record_id, db)
        db.commit()
        if not claimed:
            db.refresh(record)
            log.info("评分状态非可执行态 (%s)，跳过执行", record.scoring_status, extra={"record_id": record_id})
            return

        # 存量记录兼容：评分时补写 snapshot（新记录已在 _create_record 固化）
        if not record.prompt_snapshot or not record.rubric_snapshot:
            try:
                from contexts.training.rubric_builder import build_final_rubric
                from profiles.registry import get_profile

                profile = get_profile(record.training_type)
                record.prompt_snapshot = {
                    "system": profile.prompts.system,
                    "dynamic": profile.prompts.dynamic,
                }
                features = (record.practice_snapshot or {}).get("features", {})
                record.rubric_snapshot = build_final_rubric(profile.rubric, features)
                db.commit()
            except (KeyError, AttributeError):
                pass

        if tracker:
            tracker.start(record_id)

        async def _attempt_evaluate():
            await asyncio.wait_for(
                evaluate_training(
                    record_id,
                    case_data,
                    db,
                    llm_client=llm_client,
                    tracker=tracker,
                    realtime_hub=realtime_hub,
                    user_id=record.user_id,
                ),
                timeout=SCORING_GLOBAL_TIMEOUT,
            )

        last_error = None
        for attempt in range(2):
            try:
                await _attempt_evaluate()
                break
            except asyncio.CancelledError:
                raise
            except TimeoutError:
                raise
            except Exception as e:
                last_error = e
                if attempt == 0:
                    log.warning(
                        "评分首次尝试失败，%ds 后重试",
                        SCORING_RETRY_DELAY_SECONDS,
                        extra={"record_id": record_id, "attempt": attempt + 1, "error": str(e)[:200]},
                    )
                    await asyncio.sleep(SCORING_RETRY_DELAY_SECONDS)
                else:
                    log.error("评分重试仍失败", extra={"record_id": record_id, "error": str(e)[:200]})
                    raise

        # Re-fetch record to check if status was reset by a retry_scoring
        db.refresh(record)
        if record.scoring_status != "processing":
            log.info("评分被新任务取代，跳过完成状态更新", extra={"record_id": record_id})
            return

        record.scoring_status = "completed"
        record.scoring_error = None
        if tracker:
            tracker.update(record_id, "completed", 100, "评分完成")
        db.commit()
        log.info("[SCORING] DONE record_id=%d", record_id)

        _create_notification(
            db,
            user_id=record.user_id,
            record_id=record.id,
            type="scoring_complete",
            title="评分已完成",
            body="训练评分已完成，请查看详情",
        )

        score_obj = db.query(Score).filter(Score.record_id == record_id).first()
        await _publish_scoring_event(
            realtime_hub,
            record.user_id,
            "scoring_complete",
            {
                "record_id": record.id,
                "total_score": score_obj.total_score if score_obj else None,
            },
        )
    except TimeoutError:
        log.exception("[SCORING] TIMEOUT record_id=%d", record_id)
        _timeout_msg = f"评分超时（超过{SCORING_TIMEOUT_SECONDS}秒）"
        if tracker:
            tracker.update(record_id, "failed", 0, _timeout_msg)
        _handle_scoring_failure(
            record_id,
            _timeout_msg,
            tracker=tracker,
            realtime_hub=realtime_hub,
        )
    except Exception as e:
        msg = str(e)[:200]
        log.exception("[SCORING] FAIL record_id=%d error=%s: %s", record_id, type(e).__name__, msg)
        if tracker:
            tracker.update(record_id, "failed", 0, msg)
        _handle_scoring_failure(
            record_id,
            str(e)[:2000] or type(e).__name__,
            tracker=tracker,
            realtime_hub=realtime_hub,
        )
    finally:
        db.close()
        if tracker:
            tracker.cleanup(record_id)


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

        if not acquire_scoring(record_id, db):
            raise HTTPException(status_code=409, detail="评分已被其他请求触发，请刷新查看")

        case = db.query(Case).filter(Case.id == record.case_id).first()
        case_data = record.case_snapshot or (case.case_data if case else {})

        record.status = "completed"
        record.end_time = datetime.now(UTC)
        _set_overdue_if_needed(record, db)

        try:
            await request.app.state.task_queue.enqueue(
                lambda: _run_scoring_background(
                    record_id,
                    case_data,
                    llm_client=request.app.state.llm_client,
                    tracker=getattr(request.app.state, "scoring_tracker", None),
                    realtime_hub=request.app.state.realtime_hub,
                ),
                priority=5,
            )
        except QueueFullError:
            db.rollback()
            release_scoring(record_id, db)
            db.commit()
            raise HTTPException(status_code=503, detail="评分队列繁忙，请稍后重试")

        db.commit()

        from infrastructure.llm.capabilities import resolve_features

        features = resolve_features(
            record.practice_snapshot,
            case_defaults=(record.case_snapshot or {}).get("capabilities"),
        )
        if features.get("patient_initiative"):
            from profiles.history_taking.initiative import cleanup_initiative

            cleanup_initiative(record.id, request.app.state.initiative_cache, db)
        if features.get("emotion"):
            from profiles.history_taking.emotion import cleanup_emotion

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
    force: Annotated[bool, Query()] = False,
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
            if record.end_time and (now - ensure_utc(record.end_time)).total_seconds() <= SCORING_RETRY_GRACE_SECONDS:
                raise HTTPException(status_code=400, detail="评分正在进行中，请稍后重试")

        has_score_review = current_user.has_permission("score_review")
        old_score = db.query(Score).filter(Score.record_id == record_id).first()
        if old_score:
            review_exists = db.query(ScoreReview).filter(ScoreReview.score_id == old_score.id).first() is not None
            if review_exists:
                if not has_score_review:
                    raise HTTPException(status_code=403, detail="该评分已由教师复核，无法重新评分")
                if not force:
                    raise HTTPException(
                        status_code=409,
                        detail="该评分已有教师复核，确定重新评分？请添加 force=true 参数确认",
                    )

        if not acquire_scoring(record_id, db, allow_retry=True):
            raise HTTPException(status_code=409, detail="评分已被其他请求触发，请稍后重试")

        if old_score:
            db.query(ScoreReview).filter(ScoreReview.score_id == old_score.id).delete()
            db.delete(old_score)

        case = db.query(Case).filter(Case.id == record.case_id).first()
        case_data = record.case_snapshot or (case.case_data if case else {})

        try:
            await request.app.state.task_queue.enqueue(
                lambda: _run_scoring_background(
                    record_id,
                    case_data,
                    llm_client=request.app.state.llm_client,
                    tracker=getattr(request.app.state, "scoring_tracker", None),
                    realtime_hub=request.app.state.realtime_hub,
                ),
                priority=5,
            )
        except QueueFullError:
            db.rollback()
            release_scoring(record_id, db)
            db.commit()
            raise HTTPException(status_code=503, detail="评分队列繁忙，请稍后重试")

        db.commit()
        return {"message": "评分已重新触发", "record_id": record_id, "scoring_status": "pending"}


@router.get("/notifications", response_model=PaginatedResponse[TrainingNotificationItem])
def get_notifications(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    unread_only: Annotated[bool, Query()] = False,
    type: Annotated[str | None, Query(description="按类型过滤")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    q = db.query(Notification).filter(Notification.user_id == current_user.id)
    if unread_only:
        q = q.filter(Notification.is_read == False)
    if type:
        q = q.filter(Notification.type == type)
    total = q.count()
    notifs = q.order_by(Notification.created_at.desc()).offset(offset).limit(limit).all()
    items = [
        TrainingNotificationItem(
            id=n.id,
            type=n.type,
            title=n.title,
            body=n.body,
            record_id=n.record_id,
            is_read=n.is_read,
            created_at=n.created_at,
        )
        for n in notifs
    ]
    return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)


@router.put("/notifications/read-all", response_model=OkResponse)
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


@router.put("/notifications/{notif_id}/read", response_model=OkResponse)
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


@router.put("/notifications/{notif_id}/unread", response_model=OkResponse)
def mark_notification_unread(
    notif_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    notif = db.query(Notification).filter(Notification.id == notif_id, Notification.user_id == current_user.id).first()
    if not notif:
        raise HTTPException(status_code=404, detail="通知不存在")
    notif.is_read = False
    db.commit()
    return OkResponse(message="ok")
