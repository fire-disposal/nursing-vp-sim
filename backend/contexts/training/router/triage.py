"""Triage router — submit triage result and trigger scoring."""

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import get_current_user
from infrastructure.queue import QueueFullError
from models import Case, TrainingRecord, User

from ..scoring_lifecycle import acquire_scoring
from .scoring import _run_scoring_background

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/triage", tags=["分诊"])


class TriageSubmitRequest(BaseModel):
    mews_score: int = Field(ge=0, le=14)
    category: str = Field(min_length=1)
    department: str = Field(min_length=1)
    notes: str = ""


class TriageSubmitResponse(BaseModel):
    message: str
    record_id: int
    triage_result: dict = Field(default_factory=dict)


_TRIAGE_CATEGORIES = ["red", "orange", "yellow", "green", "blue"]
_TRIAGE_DEPARTMENTS = ["内科", "外科", "妇产科", "儿科", "急诊科", "ICU", "骨科", "神经科"]


@router.post("/{record_id}/submit", response_model=TriageSubmitResponse)
async def submit_triage(
    record_id: int,
    req: TriageSubmitRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    request: Request,
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能操作自己的训练")
    if record.status != "in_progress":
        raise HTTPException(status_code=400, detail="训练已结束")

    if req.category not in _TRIAGE_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"无效的分诊级别: {req.category}")
    if req.department not in _TRIAGE_DEPARTMENTS:
        raise HTTPException(status_code=400, detail=f"无效的目标科室: {req.department}")

    rs = dict(record.runtime_state or {})
    rs["triage_result"] = {
        "mews_score": req.mews_score,
        "category": req.category,
        "department": req.department,
        "notes": req.notes,
    }
    record.runtime_state = rs

    # End training and trigger scoring
    case = db.query(Case).filter(Case.id == record.case_id).first()
    case_data = case.case_data if case else {}

    acquired = acquire_scoring(record_id, db)
    if acquired:
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
            # 入队失败：回滚评分锁与终态，返回 503 让前端重试，避免记录卡死为评分中
            db.rollback()
            raise HTTPException(
                status_code=503,
                detail="评分队列繁忙，请稍后重试结束训练",
            )
        record.status = "completed"
        record.end_time = datetime.now(UTC)

    db.commit()

    log.info(
        "Triage submitted: record_id=%d category=%s department=%s mews=%d",
        record_id,
        req.category,
        req.department,
        req.mews_score,
    )

    return TriageSubmitResponse(message="分诊完成", record_id=record_id, triage_result=rs.get("triage_result", {}))
