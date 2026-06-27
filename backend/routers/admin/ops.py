"""Admin ops endpoints — same diagnostic data as /api/diagnose but authenticated
via ``api_manage`` permission.  Consumed by the frontend SystemOpsPage.

All query logic is delegated to ``infrastructure.ops_queries`` — the only
difference between public and admin endpoints is the authentication layer.
"""

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from core.config import APP_VERSION
from core.database import get_db
from core.diagnose import get_diagnose_service
from core.security import require_permission
from infrastructure.ops_queries import build_dashboard, compute_alerts
from models import User

log = logging.getLogger(__name__)

router = APIRouter()


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
            pass
    data["scoring"]["in_progress"] = scoring_in_progress

    sse_stats = {}
    if hasattr(request.app.state, "sse_manager"):
        try:
            sse_stats = request.app.state.sse_manager.stats
        except Exception:
            pass

    metrics_snapshot = {}
    if hasattr(request.app.state, "metrics"):
        try:
            metrics_snapshot = request.app.state.metrics.snapshot()
        except Exception:
            pass

    try:
        diag_svc = get_diagnose_service()
        diagnostic = await diag_svc.get_diagnose()
        system_errors = (diagnostic.get("errors") or {}) if isinstance(diagnostic, dict) else {}
    except Exception:
        diagnostic = {"error": "diagnose service unavailable"}
        system_errors = {}

    return {
        "health": {"status": "ok", "version": APP_VERSION},
        "time": data["time"],
        "uptime_hours": metrics_snapshot.get("uptime_seconds", 0) / 3600 if metrics_snapshot else 0,
        "llm": data["llm"],
        "scoring": data["scoring"],
        "sessions": data["sessions"],
        "voice": data["voice"],
        "voice_budget": data["voice_budget"],
        "sse": sse_stats,
        "metrics": metrics_snapshot,
        "diagnostic": diagnostic,
        "system_errors": system_errors,
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
            "count": {
                "last_5min": errors.get("last_5min", 0),
                "last_hour": errors.get("last_hour", 0),
                "total_captured": errors.get("total_captured", 0),
            },
            "recent": (errors.get("recent") or [])[:n],
        }
    except Exception:
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
            "stuck": dashboard.get("scoring", {}).get("stuck", 0),
        },
        "sessions": {"active": dashboard.get("sessions", {}).get("active", 0)},
        "notifications": {"unread": 0},
        "voice": dashboard.get("voice", {}),
        "voice_budget": dashboard.get("voice_budget", {}),
        "alerts": alerts,
    }
