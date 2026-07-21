"""LLM Monitor — thin router delegating to LLMMonitorService."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from core.deps import DbSession
from core.security import require_permission
from models import User
from schemas import LLMCallLogItem, LLMStatsResponse, PaginatedResponse
from services.llm_monitor import LLMMonitorService

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/llm-stats", response_model=LLMStatsResponse)
def get_llm_stats(
    db: DbSession,
    current_user: Annotated[User, Depends(require_permission("llm_monitor"))],
):
    svc = LLMMonitorService(db)
    return svc.get_llm_stats()


@router.get("/llm-logs", response_model=PaginatedResponse[LLMCallLogItem])
def get_llm_logs(
    db: DbSession,
    current_user: User = Depends(require_permission("llm_monitor")),
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    purpose: str | None = None,
    status: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    record_id: int | None = None,
    aggregate_patient_chat: bool = True,
):
    svc = LLMMonitorService(db)
    return svc.get_llm_logs(
        offset=offset,
        limit=limit,
        purpose=purpose,
        status=status,
        date_from=date_from,
        date_to=date_to,
        record_id=record_id,
        aggregate_patient_chat=aggregate_patient_chat,
    )


@router.post("/llm-logs/export")
def export_llm_logs_csv(
    db: DbSession,
    current_user: User = Depends(require_permission("llm_monitor")),
    format: str = Query("csv", pattern="^(csv|xlsx)$"),
    date_from: str | None = None,
    date_to: str | None = None,
):
    svc = LLMMonitorService(db)
    return svc.export_llm_logs(fmt=format, date_from=date_from, date_to=date_to)


@router.get("/llm-logs/{log_id}", response_model=LLMCallLogItem)
def get_llm_log_detail(
    log_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_permission("llm_monitor"))],
):
    svc = LLMMonitorService(db)
    return svc.get_llm_log_detail(log_id)


@router.post("/records/export")
def export_records_excel(
    db: DbSession,
    current_user: Annotated[User, Depends(require_permission("export_data"))],
    format: str = Query("xlsx", pattern="^(csv|xlsx)$"),
):
    svc = LLMMonitorService(db)
    return svc.export_records(fmt=format)
