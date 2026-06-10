import asyncio
import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from contexts.training.pipeline.plugin import run_plugin_hooks
from contexts.training.service import evaluate_training
from core.database import SessionLocal, get_db
from core.datetime_utils import ensure_utc
from core.security import get_current_user
from infrastructure.llm.client import LLMClient
from infrastructure.prompt import PromptManager
from models import Case, Message, TrainingRecord, User
from schemas import ScoringTriggerResponse

from .session import (
    _release_scoring,
    _schedule_background,
    _try_acquire_scoring,
)

log = logging.getLogger(__name__)

router = APIRouter()


async def _run_scoring_background(
    record_id: int,
    case_data: dict,
    *,
    llm_client: LLMClient,
    pm: PromptManager,
) -> None:
    SCORING_GLOBAL_TIMEOUT = 300

    db = SessionLocal()
    try:
        record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        if not record:
            return
        record.scoring_status = "processing"
        db.commit()

        await asyncio.wait_for(
            evaluate_training(
                record_id, case_data, db,
                pm=pm,
                llm_client=llm_client,
            ),
            timeout=SCORING_GLOBAL_TIMEOUT,
        )

        record.scoring_status = "completed"
        record.scoring_error = None
        db.commit()
        log.info("评分完成", extra={"record_id": record_id, "scoring_status": "completed"})
    except TimeoutError:
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
        try:
            record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
            if record:
                record.scoring_status = "failed"
                record.scoring_error = str(e)[:2000]
                db.commit()
        except Exception as inner:
            log.warning("评分失败后状态更新失败", extra={"record_id": record_id, "error": str(inner)})
        log.exception("评分失败", extra={"record_id": record_id, "error": str(e)[:200]})
    finally:
        db.close()
        _release_scoring(record_id)


@router.post("/{record_id}/end", response_model=ScoringTriggerResponse)
async def end_training(
    record_id: int,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能结束自己的训练")
    if record.status == "completed":
        raise HTTPException(status_code=400, detail="训练已结束")
    if record.scoring_status in ("pending", "processing"):
        raise HTTPException(status_code=400, detail="评分正在进行中，请稍后查看")

    if not _try_acquire_scoring(record_id):
        raise HTTPException(status_code=409, detail="评分已被其他请求触发，请刷新查看")

    case = db.query(Case).filter(Case.id == record.case_id).first()

    record.status = "completed"
    record.end_time = datetime.now(UTC)

    _schedule_background(_run_scoring_background(
        record_id,
        case.case_data if case else {},
        llm_client=request.app.state.llm_client,
        pm=request.app.state.prompt_manager,
    ))

    record.scoring_status = "pending"
    db.commit()

    from contexts.training.plugins import _hook_ctx
    from core.feature_flags import resolve_features
    features = resolve_features(record.config_snapshot)
    hook_ctx = _hook_ctx(record, request.app.state)
    run_plugin_hooks("on_end", hook_ctx, features)

    message_count = db.query(func.count(Message.id)).filter(Message.record_id == record_id).scalar() or 0
    log.info(
        f"训练结束: record_id={record_id} case_id={record.case_id} messages={message_count}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else "", "action": "training_end"},
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
    db: Annotated[Session, Depends(get_db)],
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if not current_user.has_permission("score_review") and record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权操作此记录")
    if record.status != "completed":
        raise HTTPException(status_code=400, detail="训练尚未结束")
    if record.scoring_status == "pending":
        raise HTTPException(status_code=400, detail="评分正在进行中，请稍后重试")
    if record.scoring_status == "processing":
        if record.end_time and (datetime.now(UTC) - ensure_utc(record.end_time)).total_seconds() > 300:
            record.scoring_status = "failed"
            db.commit()
        else:
            raise HTTPException(status_code=400, detail="评分正在进行中，请稍后重试")

    if not _try_acquire_scoring(record_id):
        raise HTTPException(status_code=409, detail="评分已被其他请求触发，请稍后重试")

    case = db.query(Case).filter(Case.id == record.case_id).first()
    record.scoring_status = "pending"
    record.scoring_error = None
    db.commit()

    _schedule_background(_run_scoring_background(
        record_id,
        case.case_data if case else {},
        llm_client=request.app.state.llm_client,
        pm=request.app.state.prompt_manager,
    ))

    return {"message": "评分已重新触发", "record_id": record_id, "scoring_status": "pending"}
