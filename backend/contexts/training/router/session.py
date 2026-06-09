import asyncio
import logging
import threading
from datetime import UTC, datetime

from backend.core.datetime_utils import ensure_utc, parse_iso_datetime
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from core.database import get_db
from core.security import get_current_user, require_permission
from middleware.dependencies import resolve_school_filter
from models import Case, LLMCallLog, Message, Note, Score, TrainingRecord, User, UserClass
from schemas import (
    DeleteResponse,
    MessageResponse,
    PaginatedResponse,
    ScoreReviewRequest,
    ScoreReviewResponse,
    TrainingRecordBrief,
    TrainingRecordDetail,
    TrainingStartRequest,
    TrainingStartResponse,
)
from infrastructure.llm import LogWorker, ProfileRouter
from core.pagination import paginate
from infrastructure.prompt import PromptManager
from core.feature_flags import resolve_features
from contexts.training.service import get_config, list_configs

log = logging.getLogger(__name__)

router = APIRouter()

# 评分并发锁：防止同一 record 触发多次评分
_scoring_pending: set[int] = set()
_scoring_pending_lock = threading.Lock()


def _try_acquire_scoring(record_id: int) -> bool:
    with _scoring_pending_lock:
        if record_id in _scoring_pending:
            return False
        _scoring_pending.add(record_id)
        return True


def _release_scoring(record_id: int):
    with _scoring_pending_lock:
        _scoring_pending.discard(record_id)


_infra_client: httpx.AsyncClient | None = None
_infra_router: ProfileRouter | None = None
_infra_pm: PromptManager | None = None
_infra_log_worker: LogWorker | None = None
_main_loop: asyncio.AbstractEventLoop | None = None


def _ensure_loop():
    global _main_loop
    if _main_loop is None or _main_loop.is_closed():
        _main_loop = asyncio.new_event_loop()
        t = threading.Thread(target=_main_loop.run_forever, daemon=True)
        t.start()
    return _main_loop


def set_training_infra(client, router_obj, pm, log_worker):
    global _infra_client, _infra_router, _infra_pm, _infra_log_worker
    _infra_client = client
    _infra_router = router_obj
    _infra_pm = pm
    _infra_log_worker = log_worker


def _get_client():
    if _infra_client is None:
        raise RuntimeError("Training infra not initialized")
    return _infra_client


def _get_router():
    if _infra_router is None:
        raise RuntimeError("Training infra not initialized")
    return _infra_router


def _get_pm():
    if _infra_pm is None:
        raise RuntimeError("Training infra not initialized")
    return _infra_pm


def _get_log_worker():
    if _infra_log_worker is None:
        raise RuntimeError("Training infra not initialized")
    return _infra_log_worker


def _schedule_background(coro):
    try:
        loop = asyncio.get_running_loop()
        return loop.create_task(coro)
    except RuntimeError:
        loop = _ensure_loop()
        return asyncio.run_coroutine_threadsafe(coro, loop)


@router.post("/start", response_model=TrainingStartResponse)
def start_training(
    req: TrainingStartRequest,
    current_user: Annotated[User, Depends(require_permission("training_access"))],
    db: Annotated[Session, Depends(get_db)],
):
    case = db.query(Case).filter(Case.id == req.case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")

    case_data = case.case_data or {}
    time_limit = case_data.get("time_limit", 20)

    config_id = req.config_id or "standard-assessment"
    config = get_config(config_id)
    if config:
        time_limit = config.get("behavior", {}).get("time_limit_minutes", time_limit)

    record = TrainingRecord(
        user_id=current_user.id,
        case_id=case.id,
        status="in_progress",
        time_limit=time_limit,
        config_id=config_id,
        config_snapshot=config,
    )
    record.current_phase = "history_taking"
    db.add(record)
    db.commit()
    db.refresh(record)

    patient_info = case_data.get("patient_info", {})
    patient_name = patient_info.get("name", "患者")
    greeting = f"你好，我是{patient_name}。{case_data.get('opening_line', '我今天感觉不太舒服，所以来看看。')}"

    greeting_msg = Message(record_id=record.id, role="patient", content=greeting)
    db.add(greeting_msg)
    db.commit()

    log.info(
        f"训练开始: record_id={record.id} case_id={case.id} case_name={case.name}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else "", "action": "training_start"},
    )
    return TrainingStartResponse(record_id=record.id, greeting=greeting)


@router.get("/configs")
def get_session_configs():
    return list_configs()


@router.get("/records", response_model=PaginatedResponse[TrainingRecordBrief])
def get_records(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    student_name: Annotated[str | None, Query(description="按学生姓名模糊搜索")] = None,
    case_id: Annotated[int | None, Query(description="按病例ID筛选")] = None,
    status: Annotated[str | None, Query(description="按状态筛选(in_progress/completed)")] = None,
    date_from: Annotated[str | None, Query(description="开始日期 ISO 格式 (含)")] = None,
    date_to: Annotated[str | None, Query(description="结束日期 ISO 格式 (含)")] = None,
    class_id: Annotated[int | None, Query()] = None,
    school_id: Annotated[int | None, Query(description="super_admin 按学校筛选")] = None,
):
    effective_school = resolve_school_filter(current_user, school_id)
    base = db.query(TrainingRecord)

    if effective_school is not None:
        base = base.join(User, TrainingRecord.user_id == User.id).filter(User.school_id == effective_school)

    if not current_user.has_permission("score_review"):
        base = base.filter(TrainingRecord.user_id == current_user.id)
    else:
        if student_name:
            base = base.filter(TrainingRecord.user.has(User.display_name.ilike(f"%{student_name}%")))
        if case_id is not None:
            base = base.filter(TrainingRecord.case_id == case_id)
        if class_id is not None:
            base = base.join(UserClass, UserClass.user_id == TrainingRecord.user_id).filter(
                UserClass.class_id == class_id
            )

    if status:
        base = base.filter(TrainingRecord.status == status)
    if date_from:
        try:
            df = parse_iso_datetime(date_from)
            base = base.filter(TrainingRecord.start_time >= df)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"无效日期格式: {date_from}")
    if date_to:
        try:
            dt = parse_iso_datetime(date_to)
            base = base.filter(TrainingRecord.start_time <= dt)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"无效日期格式: {date_to}")

    query = base.options(
        joinedload(TrainingRecord.case),
        joinedload(TrainingRecord.user),
        joinedload(TrainingRecord.score),
    ).order_by(TrainingRecord.start_time.desc())

    records, total = paginate(query, offset, limit)

    items = [
        TrainingRecordBrief(
            id=r.id,
            case_id=r.case_id,
            case_name=r.case.name if r.case else "",
            user_display_name=r.user.display_name if r.user else "",
            user_student_id=r.user.student_id if r.user else None,
            status=r.status,
            current_phase=r.current_phase,
            start_time=r.start_time,
            end_time=r.end_time,
            score_total=r.score.total_score if r.score else None,
            scoring_status=r.scoring_status,
            scoring_error=r.scoring_error,
        )
        for r in records
    ]
    return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)


@router.get("/records/{record_id}", response_model=TrainingRecordDetail)
def get_record_detail(
    record_id: int, current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]
):
    record = (
        db.query(TrainingRecord)
        .options(
            joinedload(TrainingRecord.case),
            joinedload(TrainingRecord.user),
            joinedload(TrainingRecord.score),
        )
        .filter(TrainingRecord.id == record_id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在")

    if not current_user.has_permission("score_review") and record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权查看此记录")

    effective_school = resolve_school_filter(current_user)
    if effective_school is not None and (not record.user or record.user.school_id != effective_school):
        raise HTTPException(status_code=404, detail="记录不存在")

    case = record.case
    user = record.user
    score = record.score
    note_records = db.query(Note).filter(Note.record_id == record_id).order_by(Note.updated_at.desc()).all()

    case_data = case.case_data or {} if case else {}
    time_limit = record.time_limit or 20
    remaining_seconds = None
    if record.status == "in_progress" and record.start_time:
        elapsed = (datetime.now(UTC) - ensure_utc(record.start_time)).total_seconds()
        remaining_seconds = max(0, int(time_limit * 60 - elapsed))
    patient_info = case_data.get("patient_info", {})

    return TrainingRecordDetail(
        id=record.id,
        case_id=record.case_id,
        case_name=case.name if case else "",
        user_display_name=user.display_name if user else "",
        status=record.status,
        current_phase=record.current_phase,
        scoring_status=record.scoring_status,
        scoring_error=record.scoring_error,
        start_time=record.start_time,
        end_time=record.end_time,
        time_limit=time_limit,
        remaining_seconds=remaining_seconds,
        messages=record.messages,
        score=score,
        notes=note_records,
        required_inquiries=case_data.get("required_inquiries", []),
        patient_info=patient_info,
        features=resolve_features(record.config_snapshot),
    )


@router.delete("/records/{record_id}", response_model=DeleteResponse)
def delete_record(
    record_id: int, current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")

    if not current_user.has_permission("score_review") and record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权删除此记录")

    record_user = db.query(User).filter(User.id == record.user_id).first()
    effective_school = resolve_school_filter(current_user)
    if effective_school is not None and (not record_user or record_user.school_id != effective_school):
        raise HTTPException(status_code=404, detail="训练记录不存在")

    db.query(Message).filter(Message.record_id == record_id).delete()
    db.query(Score).filter(Score.record_id == record_id).delete()
    db.query(Note).filter(Note.record_id == record_id).delete()
    db.query(LLMCallLog).filter(LLMCallLog.record_id == record_id).delete()
    db.delete(record)
    db.commit()

    log.info(
        f"训练记录删除: record_id={record_id} case_id={record.case_id} owner_id={record.user_id}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    return {"message": "训练记录已删除"}


@router.get("/records/{record_id}/review", response_model=ScoreReviewResponse)
def get_score_review(
    record_id: int,
    current_user: Annotated[User, Depends(require_permission("score_review"))],
    db: Annotated[Session, Depends(get_db)],
):
    score = db.query(Score).filter(Score.record_id == record_id).first()
    if not score:
        raise HTTPException(status_code=404, detail="该记录暂无评分")

    reviewer_name = None
    if score.reviewed_by:
        reviewer = db.query(User).filter(User.id == score.reviewed_by).first()
        reviewer_name = reviewer.display_name if reviewer else None

    return ScoreReviewResponse(
        score_id=score.id,
        review_status=score.review_status or "pending",
        reviewed_by_name=reviewer_name,
        reviewed_at=score.reviewed_at,
        original_detail_scores=score.detail_scores,
        review_detail_scores=score.review_detail_scores,
        review_comment=score.review_comment,
    )


@router.post("/records/{record_id}/review", response_model=ScoreReviewResponse)
def submit_score_review(
    record_id: int,
    req: ScoreReviewRequest,
    current_user: Annotated[User, Depends(require_permission("score_review"))],
    db: Annotated[Session, Depends(get_db)],
):
    score = db.query(Score).filter(Score.record_id == record_id).first()
    if not score:
        raise HTTPException(status_code=404, detail="该记录暂无评分")

    if req.detail_scores is not None:
        score.review_detail_scores = req.detail_scores
        new_total = 0.0
        for dim_data in req.detail_scores.values():
            if isinstance(dim_data, dict):
                raw_score = dim_data.get("score", 0)
                dim_max_100 = dim_data.get("max", 0)
                items = dim_data.get("items", [])
                if isinstance(items, list) and len(items) > 0 and dim_max_100 > 0:
                    raw_max_dim = len(items) * 3
                    new_total += round(raw_score * dim_max_100 / raw_max_dim, 1)
                else:
                    new_total += raw_score
        score.total_score = round(new_total, 1)
    if req.comment is not None:
        score.review_comment = req.comment

    score.review_status = "reviewed"
    score.reviewed_by = current_user.id
    score.reviewed_at = datetime.now(UTC)
    db.commit()
    db.refresh(score)

    log.info(
        f"评分复核: score_id={score.id} reviewer_id={current_user.id}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )

    reviewer_name = current_user.display_name
    return ScoreReviewResponse(
        score_id=score.id,
        review_status=score.review_status or "reviewed",
        reviewed_by_name=reviewer_name,
        reviewed_at=score.reviewed_at,
        original_detail_scores=score.detail_scores,
        review_detail_scores=score.review_detail_scores,
        review_comment=score.review_comment,
    )
