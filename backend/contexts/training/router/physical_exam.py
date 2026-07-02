"""Physical exam routes — exam operation endpoint.

Writes exam results + scene vitals to runtime_state via PhysicalExamService
and broadcasts exam:done via SSE so all consumers react in real time.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request

from core.deps import CurrentUser, DbSession
from schemas.training import ExamOperationResponse
from services.physical_exam import PhysicalExamService

log = logging.getLogger(__name__)

router = APIRouter()


@router.post("/{record_id}/exam/{op_type}", response_model=ExamOperationResponse)
async def perform_exam(
    record_id: int,
    op_type: str,
    request: Request,
    current_user: CurrentUser,
    db: DbSession,
):
    result = PhysicalExamService(db).perform(record_id, op_type, current_user)

    entry = {"type": result["type"], "label": result["data"].get("label", ""), "value": str(result["data"].get("value", "")), "unit": result["data"].get("unit", "")}
    await request.app.state.sse_manager.publish(current_user.id, "exam:done", entry)

    return result
