import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.config import SCORING_RETRY_GRACE_SECONDS
from core.database import db_session, get_db
from core.datetime_utils import ensure_utc
from core.security import get_current_user
from core.statuses import ScoringStatus, TrainingStatus
from infra.queue import QueueFullError
from infra.scoring_progress import ScoringProgressTracker
from models import Case, Message, Notification, Score, ScoreReview, TrainingRecord, User
from modules.training.scoring.runner import (
    enqueue_scoring,
    snapshot_score_for_rescore,
)
from modules.training.session.finalize import (
    END_ORIGIN_USER,
    NO_STUDENT_MESSAGES_MESSAGE,
    NO_STUDENT_MESSAGES_REASON,
    cleanup_session_runtime,
    finalize_training,
    mark_discarded,
    student_message_count,
)
from modules.training.session.state import patch_runtime_state
from modules.training.tools.nursing_record import (
    NursingAssessmentError,
    submit_nursing_assessment,
)
from modules.training.workflows import workflow_for_record
from schemas import ScoringTriggerResponse
from schemas.common import OkResponse, PaginatedResponse
from schemas.training import ScoringStatusResponse, TrainingNotificationItem

from ..scoring.lifecycle import acquire_scoring, release_scoring

log = logging.getLogger(__name__)

router = APIRouter()


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
        "record_status": record.status,
        "scoring_status": record.scoring_status,
        "scoring_error": record.scoring_error,
        "score": {
            "total_score": score.total_score,
            "detail_scores": score.detail_scores,
            "raw_total": score.raw_total,
            "mapping_version": score.mapping_version,
            "fallback": score.fallback,
            "reviewed_total": score.reviewed_total,
            "review_status": "reviewed" if review_exists else "pending",
        }
        if score
        else None,
        "progress": progress,
    }


class EndTrainingRequest(BaseModel):
    """结束训练请求（全部可选，向后兼容无 body 调用）。

    ``submit_nursing_record`` + ``nursing_record_sheet`` 构成**原子「提交并完成」**：
    服务端在同一事务里先落盘草稿、冻结提交版本，再校验完成前置条件并完成训练——
    学生看到的最后内容与被评分的内容必然一致。
    """

    submit_nursing_record: bool = False
    nursing_record_sheet: dict | None = None


@router.post("/{record_id}/end", response_model=ScoringTriggerResponse)
async def end_training(
    record_id: int,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    body: EndTrainingRequest | None = None,
):
    async with db_session() as db:
        record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).with_for_update().first()
        if not record:
            raise HTTPException(status_code=404, detail="训练记录不存在")
        if record.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="只能结束自己的训练")
        if record.status != TrainingStatus.IN_PROGRESS:
            raise HTTPException(status_code=400, detail="训练已结束")
        if record.scoring_status in (ScoringStatus.PENDING, ScoringStatus.PROCESSING):
            raise HTTPException(status_code=400, detail="评分正在进行中，请稍后查看")

        now = datetime.now(UTC)

        # 原子「提交护理评估并完成」：提交与完成同一事务边界。
        # 幂等：已提交且内容一致时是 no-op；内容不同则 409（冻结版本不可覆盖）。
        if body is not None and body.submit_nursing_record:
            try:
                submit_nursing_assessment(
                    db,
                    record_id=record_id,
                    user_id=current_user.id,
                    sheet_data=body.nursing_record_sheet,
                    at=now,
                )
            except NursingAssessmentError as exc:
                db.rollback()
                raise HTTPException(
                    status_code=exc.status_code,
                    detail={
                        "message": exc.message,
                        "code": exc.code,
                        "missing_fields": exc.missing_fields,
                    },
                ) from exc

        # 要求评估的 workflow：未提交时拒绝完成（绝不把草稿偷偷标成 submitted）。
        # 完成前置条件由**记录冻结的 workflow** 的 CompletionPolicy 声明，不在端点里写死。
        try:
            claimed, kind, case_data = finalize_training(
                db,
                record_id,
                ended_at=now,
                origin=END_ORIGIN_USER,
                require_nursing_submission=bool(workflow_for_record(record).completion.required_artifacts),
            )
        except NursingAssessmentError as exc:
            db.rollback()
            raise HTTPException(
                status_code=exc.status_code,
                detail={
                    "message": exc.message,
                    "code": exc.code,
                    "missing_fields": exc.missing_fields,
                },
            ) from exc
        if not claimed:
            raise HTTPException(status_code=409, detail="评分已被其他请求触发，请刷新查看")

        if kind == TrainingStatus.DISCARDED:
            db.commit()
            log.info(
                "训练废弃: record_id=%d case_id=%d reason=%s",
                record_id,
                record.case_id,
                NO_STUDENT_MESSAGES_REASON,
                extra={
                    "user_id": current_user.id,
                    "user_role": current_user.role.name if current_user.role else "",
                    "action": "training_discard",
                },
            )
            return {
                "message": NO_STUDENT_MESSAGES_MESSAGE,
                "record_id": record_id,
                "scoring_status": None,
                "record_status": TrainingStatus.DISCARDED,
                "terminal_reason": NO_STUDENT_MESSAGES_REASON,
            }

        # kind == "completed" 保证 finalize_training 返回了 case_data
        assert case_data is not None
        try:
            await enqueue_scoring(request.app.state, record_id, case_data)
        except QueueFullError:
            db.rollback()
            raise HTTPException(status_code=503, detail="评分队列繁忙，请稍后重试")

        # 先清理运行时缓存再提交：cleanup 发的 DELETE 必须在同一事务里落库
        # （db_session 关闭时只 close 不 commit，先 commit 会把 DELETE 回滚掉）
        cleanup_session_runtime(record, request.app.state, db)
        db.commit()

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
            "scoring_status": ScoringStatus.PENDING,
            "record_status": TrainingStatus.COMPLETED,
            "terminal_reason": END_ORIGIN_USER,
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
        if record.status != TrainingStatus.COMPLETED:
            raise HTTPException(status_code=400, detail="训练尚未结束")

        if student_message_count(db, record_id) == 0:
            mark_discarded(db, record)
            db.commit()
            return {
                "message": NO_STUDENT_MESSAGES_MESSAGE,
                "record_id": record_id,
                "scoring_status": None,
                "record_status": TrainingStatus.DISCARDED,
                "terminal_reason": NO_STUDENT_MESSAGES_REASON,
            }

        now = datetime.now(UTC)
        if record.scoring_status in (ScoringStatus.PENDING, ScoringStatus.PROCESSING):
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
            # S6 两阶段 force 重评：先快照旧分/旧复核，新评分失败时由
            # scoring.runner.handle_scoring_failure 恢复（不再"先删后算"丢分）。
            # 经 patch_runtime_state 原子写入本键（session/state.py 的写入契约）。
            old_review = db.query(ScoreReview).filter(ScoreReview.score_id == old_score.id).first()
            snapshot = snapshot_score_for_rescore(old_score, old_review)
            patch_runtime_state(db, record_id, {"force_rescore_snapshot": snapshot})
            db.query(ScoreReview).filter(ScoreReview.score_id == old_score.id).delete()
            db.delete(old_score)

        case = db.query(Case).filter(Case.id == record.case_id).first()
        case_data = record.case_snapshot or (case.case_data if case else {})

        try:
            await enqueue_scoring(request.app.state, record_id, case_data)
        except QueueFullError:
            db.rollback()
            release_scoring(record_id, db)
            db.commit()
            raise HTTPException(status_code=503, detail="评分队列繁忙，请稍后重试")

        db.commit()
        return {"message": "评分已重新触发", "record_id": record_id, "scoring_status": ScoringStatus.PENDING}


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
