"""Physical exam routes — exam operation endpoint."""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session  # noqa: TC002

from core.database import get_db
from core.security import get_current_user
from models import Case, TrainingRecord, User
from profiles.history_taking.exam import handle_operation
from schemas.training import ExamOperationResponse

log = logging.getLogger(__name__)

router = APIRouter()


@router.post("/{record_id}/exam/{op_type}", response_model=ExamOperationResponse)
def perform_exam(
    record_id: int,
    op_type: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).with_for_update().first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能操作自己的训练")
    if record.status != "in_progress":
        raise HTTPException(status_code=400, detail="训练已结束")

    case = db.query(Case).filter(Case.id == record.case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")

    result = handle_operation(op_type, case.case_data or {})

    rs = dict(record.runtime_state or {})
    exam_results = rs.get("exam_results", [])
    if not isinstance(exam_results, list):
        exam_results = []
    exam_results.append(
        {
            "type": op_type,
            "label": result.get("label", ""),
            "value": str(result.get("value", "")),
            "unit": result.get("unit", ""),
        }
    )
    rs["exam_results"] = exam_results

    rs["phase_op_count"] = rs.get("phase_op_count", 0) + 1
    record.runtime_state = rs

    db.commit()
    return {"type": op_type, "data": result, "all_results": exam_results}
