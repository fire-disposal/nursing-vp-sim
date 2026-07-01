"""Physical exam routes — exam operation endpoint.

Writes exam results + scene vitals to runtime_state and
broadcasts exam:done via SSE so all consumers (MonitorCard,
ChatArea, prompt builder) react in real time.
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session  # noqa: TC002

from core.database import get_db
from core.security import get_current_user
from infrastructure.sse import notify_sse
from models import Case, TrainingRecord, User
from profiles.history_taking.exam import handle_operation
from schemas.training import ExamOperationResponse

log = logging.getLogger(__name__)

router = APIRouter()

# op_type → SceneState vitals field mapping
_VITALS_MAP: dict[str, tuple[str, ...]] = {
    "hr": ("hr",),
    "bp": ("bp_sys", "bp_dia"),
    "rr": ("rr",),
    "spo2": ("spo2",),
    "temp": ("temp",),
    "pain": ("pain",),
}


def _vitals_patch(op_type: str, value: str) -> dict:
    """Convert an exam result into a SceneState vitals patch."""
    if op_type not in _VITALS_MAP:
        return {}
    fields = _VITALS_MAP[op_type]
    patch: dict[str, float | int] = {}
    if op_type == "bp":
        try:
            parts = value.split("/")
            patch["bp_sys"] = int(parts[0])
            patch["bp_dia"] = int(parts[1])
        except (ValueError, IndexError):
            return {}
    else:
        try:
            val = float(value)
            patch[fields[0]] = int(val) if op_type in ("hr", "rr", "pain") else val
        except ValueError:
            return {}
    return patch


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
    entry = {
        "type": op_type,
        "label": result.get("label", ""),
        "value": str(result.get("value", "")),
        "unit": result.get("unit", ""),
    }
    exam_results.append(entry)
    rs["exam_results"] = exam_results

    # Write scene vitals so {#scene_state#} in prompts is populated
    vitals_patch = _vitals_patch(op_type, str(result.get("value", "")))
    if vitals_patch:
        rs.setdefault("scene", {}).setdefault("vitals", {}).update(vitals_patch)

    rs["phase_op_count"] = rs.get("phase_op_count", 0) + 1
    record.runtime_state = rs

    db.commit()

    # Broadcast so ChatArea inserts a system message, MonitorCard updates, etc.
    notify_sse(record_id, "exam:done", entry)

    return {"type": op_type, "data": result, "all_results": exam_results}
