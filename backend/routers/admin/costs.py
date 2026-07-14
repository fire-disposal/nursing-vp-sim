"""Admin cost dashboard — thin router."""

import csv
import io
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from core.deps import DbSession
from core.security import require_permission
from models import User
from schemas.voice import CostDashboardResponse, VoiceUsageResponse
from services.costs import CostService

router = APIRouter(prefix="/api/admin/costs", tags=["成本管理"])

_Manager = Annotated[User, Depends(require_permission("llm_monitor"))]


@router.get("/usage", response_model=VoiceUsageResponse)
def get_voice_usage(current_user: _Manager, db: DbSession):
    return CostService(db).get_usage()


@router.get("/dashboard", response_model=CostDashboardResponse)
def get_cost_dashboard(current_user: _Manager, db: DbSession):
    return CostService(db).get_dashboard()


@router.get("/users")
def get_user_cost_breakdown(current_user: _Manager, db: DbSession):
    return {"items": CostService(db).get_user_breakdown()}


@router.get("/export")
def export_costs(
    current_user: _Manager,
    db: DbSession,
    start_date: str = Query(default=""),
    end_date: str = Query(default=""),
    service: str = Query(default=""),
    granularity: str = Query(default="daily"),
    export_format: str = Query(default="json", alias="format"),
):
    svc = CostService(db)
    rows = svc.export_data(start_date, end_date, service, granularity)
    if export_format == "csv":
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=["date", "service", "cost", "calls", "success", "error"])
        writer.writeheader()
        writer.writerows(rows)
        csv_bytes = output.getvalue().encode("utf-8-sig")
        return StreamingResponse(
            iter([csv_bytes]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=cost_export.csv"},
        )
    return rows
