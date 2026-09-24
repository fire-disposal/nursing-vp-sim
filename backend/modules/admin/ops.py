"""Admin ops endpoints — same diagnostic data as /api/diagnose but authenticated
via ``api_manage`` permission.  Consumed by the frontend SystemOpsPage.

All query logic is delegated to ``infra.ops_queries`` — the only
difference between public and admin endpoints is the authentication layer.
"""

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import require_permission
from infra.diagnose import get_diagnose_service
from infra.diagnostics import (
    ERROR_COUNT_WINDOWS,
    SCOPE_DB,
    SCOPE_PROCESS,
    SCOPE_WORKERS,
    TELEMETRY_WINDOW_LABEL,
    WINDOW_DAY_CN,
    WINDOW_H24,
    WINDOW_MONTH_CN,
    WINDOW_NOW,
    WINDOW_SINCE_START,
    error_count_block,
    frontend_errors_block,
)
from infra.ops_queries import build_dashboard, compute_alerts
from models import User

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/ops/diagnose")
async def admin_ops_diagnose(
    current_user: Annotated[User, Depends(require_permission("api_manage"))],
    request: Request,
):
    diag_svc = get_diagnose_service()
    return await diag_svc.get_diagnose()


@router.get("/ops/dashboard")
async def admin_ops_dashboard(
    current_user: Annotated[User, Depends(require_permission("api_manage"))],
    db: Annotated[Session, Depends(get_db)],
    request: Request,
):
    now = datetime.now(UTC)
    data = build_dashboard(db, now)

    scoring_in_progress = 0
    if hasattr(request.app.state, "scoring_tracker"):
        try:
            scoring_in_progress = len(request.app.state.scoring_tracker._store)
        except Exception:
            log.warning("scoring_tracker read failed", exc_info=True)
    data["scoring"]["in_progress"] = scoring_in_progress

    sse_stats = {}
    if hasattr(request.app.state, "realtime_hub"):
        try:
            sse_stats = request.app.state.realtime_hub.stats
        except Exception:
            log.warning("realtime_hub stats read failed", exc_info=True)

    metrics_snapshot = {}
    if hasattr(request.app.state, "metrics"):
        try:
            metrics_snapshot = request.app.state.metrics.snapshot()
        except Exception:
            log.warning("metrics snapshot read failed", exc_info=True)

    try:
        diag_svc = get_diagnose_service()
        diagnostic = await diag_svc.get_diagnose()
        raw_system_errors = diagnostic.get("errors") if isinstance(diagnostic, dict) else None
        raw_frontend_errors = diagnostic.get("frontend_errors") if isinstance(diagnostic, dict) else None
        system_errors = raw_system_errors if isinstance(raw_system_errors, dict) else {}
        frontend_errors = raw_frontend_errors if isinstance(raw_frontend_errors, dict) else {}
        data["error_burst_5min"] = system_errors.get("last_5min", 0)
        data["frontend_errors"] = frontend_errors
        data["http"] = metrics_snapshot.get("requests", {})
    except Exception:
        log.warning("ops diagnostic failed", exc_info=True)
        system_errors = {}
        frontend_errors = {}
        data["error_burst_5min"] = 0
    errors_structured = {
        "scope": SCOPE_WORKERS,
        "window": TELEMETRY_WINDOW_LABEL,
        "window_by_count": ERROR_COUNT_WINDOWS,
        "count": error_count_block(system_errors),
        "recent": system_errors.get("recent", []),
    }

    alerts = compute_alerts(data)

    return {
        "time": data["time"],
        "uptime_hours": metrics_snapshot.get("uptime_seconds", 0) / 3600 if metrics_snapshot else 0,
        "llm": {"scope": SCOPE_DB, "window": WINDOW_H24, **data["llm"]},
        "scoring": {
            "scope": SCOPE_DB,
            "window": "rolling_24h_by_record_end_time",
            "in_progress_scope": SCOPE_PROCESS,
            "in_progress_window": WINDOW_NOW,
            **data["scoring"],
        },
        "sessions": {"scope": SCOPE_DB, "window": WINDOW_NOW, **data["sessions"]},
        "voice": {"scope": SCOPE_DB, "window": WINDOW_H24, **data["voice"]},
        "voice_budget": {"scope": SCOPE_DB, "window": WINDOW_MONTH_CN, **data["voice_budget"]},
        "business": {"scope": SCOPE_DB, "window": WINDOW_DAY_CN, **data["business"]},
        "sse": sse_stats,
        "metrics": {
            "scope": SCOPE_PROCESS,
            "window": WINDOW_SINCE_START,
            "active_sessions_scope": SCOPE_DB,
            "active_sessions_window": WINDOW_NOW,
            **metrics_snapshot,
        },
        "errors": errors_structured,
        # 与公开端点同形（scope/window/window_by_count/count/groups）。
        "frontend_errors": frontend_errors_block(frontend_errors, window_label=TELEMETRY_WINDOW_LABEL),
        "alerts": alerts,
    }


@router.get("/ops/errors")
async def admin_ops_errors(
    current_user: Annotated[User, Depends(require_permission("api_manage"))],
    n: int = Query(20, description="返回条数"),
):
    try:
        diag_svc = get_diagnose_service()
        diagnostic = await diag_svc.get_diagnose()
        errors = diagnostic.get("errors") or {}
        return {
            "scope": "workers",
            "window_by_count": ERROR_COUNT_WINDOWS,
            "count": {
                "last_5min": errors.get("last_5min", 0),
                "last_hour": errors.get("last_hour", 0),
                "total_captured": errors.get("total_captured", 0),
                "unique_24h": errors.get("unique_24h", 0),
            },
            "recent": (errors.get("recent") or [])[:n],
        }
    except Exception:
        log.warning("ops errors query failed", exc_info=True)
        return {"count": {}, "recent": []}


@router.get("/ops/report")
async def admin_ops_report(
    current_user: Annotated[User, Depends(require_permission("api_manage"))],
    db: Annotated[Session, Depends(get_db)],
    request: Request,
):
    dashboard = await admin_ops_dashboard(current_user, db, request)
    alerts = compute_alerts(dashboard)

    return {
        "summary": {
            "time": dashboard.get("time"),
            "uptime_hours": dashboard.get("uptime_hours", 0),
            "status": "degraded" if alerts else "healthy",
        },
        "llm": {
            "total_calls_24h": dashboard.get("llm", {}).get("total_calls_24h", 0),
            "success_rate": dashboard.get("llm", {}).get("success_rate", 100),
            "error_count_24h": dashboard.get("llm", {}).get("error_count_24h", 0),
            "avg_latency_ms": dashboard.get("llm", {}).get("avg_latency_ms", 0),
            "top_errors": dashboard.get("llm", {}).get("recent_errors", []),
        },
        "scoring": {
            "pending": dashboard.get("scoring", {}).get("pending", 0),
            "in_progress": dashboard.get("scoring", {}).get("in_progress", 0),
            "completed_24h": dashboard.get("scoring", {}).get("completed_24h", 0),
            "failed_24h": dashboard.get("scoring", {}).get("failed_24h", 0),
            "success_rate": dashboard.get("scoring", {}).get("success_rate", 100),
        },
        "sessions": {"active": dashboard.get("sessions", {}).get("active", 0)},
        "notifications": {"unread": 0},
        "voice": dashboard.get("voice", {}),
        "voice_budget": dashboard.get("voice_budget", {}),
        "alerts": alerts,
    }
