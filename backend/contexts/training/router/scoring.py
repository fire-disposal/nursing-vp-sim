import asyncio
import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from contexts.training.score_engine import evaluate_training
from core.config import SCORING_TIMEOUT_SECONDS
from core.database import SessionLocal, db_session, get_db
from core.datetime_utils import ensure_utc
from core.security import get_current_user
from infrastructure.llm.client import LLMClient
from infrastructure.prompt import PromptManager
from infrastructure.scoring_progress import ScoringProgressTracker
from models import Case, Message, Score, ScoreReview, TrainingRecord, User
from plugins.manager import get_plugin_manager
from schemas import ScoringTriggerResponse

from .session import _try_acquire_scoring

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/{record_id}/scoring-status")
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
                "phase": p.phase,
                "percentage": p.percentage,
                "message": p.message,
            }

    return {
        "scoring_status": record.scoring_status,
        "scoring_error": record.scoring_error,
        "score": {
            "total_score": score.total_score,
            "review_status": "reviewed" if review_exists else "pending",
        }
        if score
        else None,
        "progress": progress,
    }


def _set_overdue_if_needed(record: TrainingRecord, db: Session) -> None:
    if not record.assignment_id or record.is_overdue:
        return
    from core.datetime_utils import ensure_utc
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
) -> None:
    SCORING_GLOBAL_TIMEOUT = SCORING_TIMEOUT_SECONDS

    db = SessionLocal()
    try:
        record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        if not record:
            log.warning("评分任务：记录不存在", extra={"record_id": record_id})
            return
        log.info("评分任务开始", extra={"record_id": record_id, "scoring_status": record.scoring_status})
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
            ),
            timeout=SCORING_GLOBAL_TIMEOUT,
        )

        record.scoring_status = "completed"
        record.scoring_error = None
        if tracker:
            tracker.update(record_id, "completed", 100, "评分完成")
        db.commit()
        log.info("评分完成", extra={"record_id": record_id, "scoring_status": "completed"})
    except TimeoutError:
        if tracker:
            tracker.update(record_id, "failed", 0, "评分超时（超过5分钟）")
        try:
            record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
            if record:
                record.scoring_status = "failed"
                record.scoring_error = "评分超时（超过5分钟）"
                db.commit()
        except Exception as e:
            log.warning("评分超时后状态更新失败", extra={"record_id": record_id, "error": str(e)})
        log.exception("评分超时", extra={"record_id": record_id})
    except Exception as e:
        if tracker:
            tracker.update(record_id, "failed", 0, str(e)[:100])
        try:
            record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
            if record:
                record.scoring_status = "failed"
                record.scoring_error = str(e)[:2000] or f"{type(e).__name__}"
                db.commit()
        except Exception as inner:
            log.warning("评分失败后状态更新失败", extra={"record_id": record_id, "error": str(inner)})
        log.exception("评分失败", extra={"record_id": record_id, "error": str(e)[:200]})
    finally:
        db.close()


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

        if not await _try_acquire_scoring(record_id, db):
            raise HTTPException(status_code=409, detail="评分已被其他请求触发，请刷新查看")

        case = db.query(Case).filter(Case.id == record.case_id).first()

        record.status = "completed"
        record.end_time = datetime.now(UTC)
        _set_overdue_if_needed(record, db)

        await request.app.state.task_queue.enqueue(
            lambda: _run_scoring_background(
                record_id,
                case.case_data if case else {},
                llm_client=request.app.state.llm_client,
                pm=request.app.state.prompt_manager,
                tracker=getattr(request.app.state, "scoring_tracker", None),
            ),
            priority=5,
        )

        db.commit()

        from core.feature_flags import resolve_features
        from plugins.base import EndContext

        features = resolve_features(record.practice_snapshot)
        pm = get_plugin_manager()
        ctx = EndContext(
            record=record,
            emotion_cache=request.app.state.emotion_cache,
            initiative_cache=request.app.state.initiative_cache,
        )
        pm.run_hook_sync("on_training_end", ctx, features)
        if features.get("patient_initiative"):
            from contexts.patient.initiative import cleanup_initiative

            cleanup_initiative(ctx.record.id, ctx.initiative_cache)
        if features.get("emotion"):
            from contexts.patient.emotion import cleanup_emotion

            cleanup_emotion(ctx.record.id, ctx.emotion_cache)

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

        # 清理上次评分结果（Score + ScoreReview），避免唯一约束冲突
        old_score = db.query(Score).filter(Score.record_id == record_id).first()
        if old_score:
            db.query(ScoreReview).filter(ScoreReview.score_id == old_score.id).delete()
            db.delete(old_score)

        record.scoring_status = None
        record.scoring_error = None
        db.commit()

        case = db.query(Case).filter(Case.id == record.case_id).first()

        if not await _try_acquire_scoring(record_id, db):
            raise HTTPException(status_code=409, detail="评分已被其他请求触发，请稍后重试")

        await request.app.state.task_queue.enqueue(
            lambda: _run_scoring_background(
                record_id,
                case.case_data if case else {},
                llm_client=request.app.state.llm_client,
                pm=request.app.state.prompt_manager,
                tracker=getattr(request.app.state, "scoring_tracker", None),
            ),
            priority=5,
        )

        return {"message": "评分已重新触发", "record_id": record_id, "scoring_status": "pending"}
