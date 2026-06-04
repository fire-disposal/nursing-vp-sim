import asyncio
import logging
import threading
from datetime import UTC, datetime
from typing import Annotated

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from core.database import SessionLocal, get_db
from core.security import get_current_user, require_teacher
from models import Case, LLMCallLog, Message, Note, Score, TrainingRecord, User, UserClass
from schemas import (
    MessageResponse,
    PaginatedResponse,
    ScoreReviewRequest,
    ScoreReviewResponse,
    ScoringTriggerResponse,
    TrainingRecordBrief,
    TrainingRecordDetail,
    TrainingStartRequest,
    TrainingStartResponse,
)
from services.pagination import paginate

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/training", tags=["训练"])

# 评分并发锁：防止同一 record 触发多次评分
_scoring_pending: set[int] = set()
_scoring_pending_lock = threading.Lock()


def _try_acquire_scoring(record_id: int) -> bool:
    """尝试标记评分进行中，失败表示已有任务在处理"""
    with _scoring_pending_lock:
        if record_id in _scoring_pending:
            return False
        _scoring_pending.add(record_id)
        return True


def _release_scoring(record_id: int):
    """评分任务完成或失败后释放"""
    with _scoring_pending_lock:
        _scoring_pending.discard(record_id)


@router.post("/start", response_model=TrainingStartResponse)
def start_training(
    req: TrainingStartRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="仅学生可以开始训练")

    case = db.query(Case).filter(Case.id == req.case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")

    record = TrainingRecord(
        user_id=current_user.id,
        case_id=case.id,
        status="in_progress",
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    # 从病例中获取患者姓名用于开场问候
    case_data = case.case_data or {}
    patient_info = case_data.get("patient_info", {})
    patient_name = patient_info.get("name", "患者")
    greeting = f"你好，我是{patient_name}。{case_data.get('opening_line', '我今天感觉不太舒服，所以来看看。')}"

    # 保存欢迎消息
    greeting_msg = Message(record_id=record.id, role="patient", content=greeting)
    db.add(greeting_msg)
    db.commit()

    log.info(
        f"训练开始: record_id={record.id} case_id={case.id} case_name={case.name}",
        extra={"user_id": current_user.id, "user_role": current_user.role, "action": "training_start"},
    )
    return TrainingStartResponse(record_id=record.id, greeting=greeting)


def _run_scoring_background(record_id: int, case_data: dict):
    """后台线程中执行评分。使用 asyncio.run() 新建事件循环。"""
    SCORING_GLOBAL_TIMEOUT = 300

    async def _do():
        from services.llm_logging import LogWorker
        from services.llm_router import ProfileRouter
        from services.prompt_manager import PromptManager

        db = SessionLocal()
        local_client = httpx.AsyncClient(timeout=httpx.Timeout(180, connect=15.0))
        local_pm = PromptManager()
        await local_pm.load_from_db()
        local_router = ProfileRouter()
        await local_router.load_from_db()
        log_worker = LogWorker()
        await log_worker.start()
        try:
            record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
            if not record:
                return
            record.scoring_status = "processing"
            db.commit()

            from services.scoring import evaluate_training

            await asyncio.wait_for(
                evaluate_training(
                    record_id, case_data, db,
                    pm=local_pm,
                    router=local_router,
                    log_worker=log_worker,
                    client=local_client,
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
            await local_client.aclose()
            await log_worker.stop()

    try:
        try:
            asyncio.run(_do())
        except Exception as e:
            log.exception("后台评分线程异常 (record_id=%d): %s", record_id, e)
    finally:
        _release_scoring(record_id)


@router.post("/{record_id}/end", response_model=ScoringTriggerResponse)
def end_training(
    record_id: int,
    background_tasks: BackgroundTasks,
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

    # 立即标记完成 + 评分待处理，响应不再阻塞在 LLM 调用上
    record.status = "completed"
    record.end_time = datetime.now(UTC)
    record.scoring_status = "pending"
    db.commit()

    from services.chat_session import cleanup_topics

    cleanup_topics(record_id)

    background_tasks.add_task(_run_scoring_background, record_id, case.case_data if case else {})

    message_count = db.query(func.count(Message.id)).filter(Message.record_id == record_id).scalar() or 0
    log.info(
        f"训练结束: record_id={record_id} case_id={record.case_id} messages={message_count}",
        extra={"user_id": current_user.id, "user_role": current_user.role, "action": "training_end"},
    )
    return {
        "message": "训练已结束，评分正在后台生成中",
        "record_id": record_id,
        "scoring_status": "pending",
    }


@router.post("/{record_id}/retry-scoring", response_model=ScoringTriggerResponse)
def retry_scoring(
    record_id: int,
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """重新触发失败的评分（学生本人或教师可操作）"""
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if current_user.role != "teacher" and record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权操作此记录")
    if record.status != "completed":
        raise HTTPException(status_code=400, detail="训练尚未结束")
    if record.scoring_status == "pending":
        raise HTTPException(status_code=400, detail="评分正在进行中，请稍后重试")
    if record.scoring_status == "processing":
        # 检查是否超时（超过 5 分钟仍 processing，视为僵尸状态）
        if record.end_time and (datetime.now(UTC) - record.end_time).total_seconds() > 300:
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

    background_tasks.add_task(_run_scoring_background, record_id, case.case_data if case else {})

    return {"message": "评分已重新触发", "record_id": record_id, "scoring_status": "pending"}


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
):
    """获取训练记录列表。学生只看自己的，教师看全部并支持多维过滤。"""
    base = db.query(TrainingRecord)

    if current_user.role != "teacher":
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
            df = datetime.fromisoformat(date_from)
            if df.tzinfo is None:
                df = df.replace(tzinfo=UTC)
            base = base.filter(TrainingRecord.start_time >= df)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"无效日期格式: {date_from}")
    if date_to:
        try:
            dt = datetime.fromisoformat(date_to)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
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
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在")

    # 权限检查：学生只能看自己的，教师看全部
    if current_user.role != "teacher" and record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权查看此记录")

    case = db.query(Case).filter(Case.id == record.case_id).first()
    user = db.query(User).filter(User.id == record.user_id).first()
    score = db.query(Score).filter(Score.record_id == record_id).first()
    note_records = db.query(Note).filter(Note.record_id == record_id).order_by(Note.updated_at.desc()).all()

    case_data = case.case_data or {} if case else {}
    time_limit = case_data.get("time_limit", 20)
    remaining_seconds = None
    if record.status == "in_progress" and record.start_time:
        elapsed = (datetime.now(UTC) - record.start_time).total_seconds()
        remaining_seconds = max(0, int(time_limit * 60 - elapsed))
    patient_info = case_data.get("patient_info", {})

    return TrainingRecordDetail(
        id=record.id,
        case_id=record.case_id,
        case_name=case.name if case else "",
        user_display_name=user.display_name if user else "",
        status=record.status,
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
    )


@router.delete("/records/{record_id}", response_model=MessageResponse)
def delete_record(
    record_id: int, current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]
):
    """删除训练记录。教师可删全部，学生仅可删自己的。"""
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")

    # 权限检查
    if current_user.role != "teacher" and record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权删除此记录")

    # 级联删除关联数据
    db.query(Message).filter(Message.record_id == record_id).delete()
    db.query(Score).filter(Score.record_id == record_id).delete()
    db.query(Note).filter(Note.record_id == record_id).delete()
    db.query(LLMCallLog).filter(LLMCallLog.record_id == record_id).delete()
    db.delete(record)
    db.commit()

    log.info(
        f"训练记录删除: record_id={record_id} case_id={record.case_id} owner_id={record.user_id}",
        extra={"user_id": current_user.id, "user_role": current_user.role},
    )
    return {"message": "训练记录已删除"}


# ── 教师复核 ──


@router.get("/records/{record_id}/review", response_model=ScoreReviewResponse)
def get_score_review(
    record_id: int,
    current_user: Annotated[User, Depends(require_teacher)],
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
    current_user: Annotated[User, Depends(require_teacher)],
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
        extra={"user_id": current_user.id, "user_role": current_user.role},
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
