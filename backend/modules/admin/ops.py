"""Admin ops endpoints — same diagnostic data as /api/diagnose but authenticated
via ``api_manage`` permission.  Consumed by the frontend SystemOpsPage.

All query logic is delegated to ``infra.ops_queries`` — the only
difference between public and admin endpoints is the authentication layer.
"""

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request
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
from modules.feedback.service import FeedbackService

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/ops/diagnose")
async def admin_ops_diagnose(
    current_user: Annotated[User, Depends(require_permission("api_manage"))],
    request: Request,
):
    diag_svc = get_diagnose_service()
    return await diag_svc.get_diagnose()


def _feedback_block(db: Session) -> dict:
    """未回复反馈块 —— 只暴露计数与最老一条的时间，绝不返回正文或用户标识。

    查询走 ``modules.feedback.service`` 服务层；失败只告警并降级为 0/None，
    不能让反馈统计拖垮整个 dashboard。
    """
    summary: dict = {"unanswered": 0, "oldest_created_at": None, "oldest_age_days": None}
    try:
        summary = FeedbackService(db).unreplied_summary()
    except Exception:
        log.warning("feedback unreplied summary failed", exc_info=True)
    return {"scope": SCOPE_DB, "window": WINDOW_NOW, **summary}


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
        "jobs": {"scope": SCOPE_DB, "window": WINDOW_NOW, **data["jobs"]},
        "voice": {"scope": SCOPE_DB, "window": WINDOW_H24, **data["voice"]},
        "voice_budget": {"scope": SCOPE_DB, "window": WINDOW_MONTH_CN, **data["voice_budget"]},
        "business": {"scope": SCOPE_DB, "window": WINDOW_DAY_CN, **data["business"]},
        "feedback": _feedback_block(db),
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
