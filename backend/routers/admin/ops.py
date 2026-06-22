"""Admin ops endpoints — same data as /api/ops/* but authenticated via api_manage permission."""

import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from core.config import APP_VERSION
from core.database import get_db
from core.diagnose import get_diagnose_service
from core.security import require_permission
from models import LLMCallLog, Notification, TrainingRecord, User

log = logging.getLogger(__name__)

router = APIRouter()


def _query_llm_stats(db: Session, since: datetime):
    row = (
        db.query(
            func.count(LLMCallLog.id).label("total"),
            func.sum(case((LLMCallLog.status == "success", 1), else_=0)).label("success"),
            func.sum(case((LLMCallLog.status == "error", 1), else_=0)).label("error"),
            func.avg(LLMCallLog.latency_ms).label("avg_latency_ms"),
        )
        .filter(LLMCallLog.created_at >= since)
        .first()
    )
    return {
        "total": row.total or 0,
        "success": row.success or 0,
        "error": row.error or 0,
        "avg_latency_ms": round(row.avg_latency_ms or 0, 0),
    }


def _query_scoring_queue(db: Session, day_ago: datetime):
    pending = (
        db.query(func.count(TrainingRecord.id))
        .filter(
            TrainingRecord.scoring_status == "pending",
            TrainingRecord.end_time >= day_ago,
        )
        .scalar()
        or 0
    )
    stuck = (
        db.query(func.count(TrainingRecord.id))
        .filter(
            TrainingRecord.scoring_status.in_(["pending", "processing"]),
            TrainingRecord.end_time < day_ago,
        )
        .scalar()
        or 0
    )
    return {"pending": pending, "stuck": stuck}


def _query_active_sessions(db: Session):
    return (
        db.query(func.count(TrainingRecord.id))
        .filter(TrainingRecord.status == "in_progress")
        .scalar()
        or 0
    )


def _query_recent_llm_errors(db: Session, since: datetime):
    rows = (
        db.query(LLMCallLog.error_type, func.count(LLMCallLog.id).label("cnt"))
        .filter(
            LLMCallLog.status == "error",
            LLMCallLog.created_at >= since,
        )
        .group_by(LLMCallLog.error_type)
        .order_by(func.count(LLMCallLog.id).desc())
        .limit(5)
        .all()
    )
    return [{"type": r.error_type, "count": r.cnt} for r in rows]


def _query_unread_notifications(db: Session):
    return (
        db.query(func.count(Notification.id))
        .filter(Notification.is_read == False)
        .scalar()
        or 0
    )


@router.get("/ops/dashboard")
async def admin_ops_dashboard(
    current_user: Annotated[User, Depends(require_permission("api_manage"))],
    db: Annotated[Session, Depends(get_db)],
    request: Request,
):
    now = datetime.now(UTC)
    day_ago = now - timedelta(hours=24)

    health_data = {"status": "ok", "version": APP_VERSION}
    llm_stats = _query_llm_stats(db, day_ago)
    scoring = _query_scoring_queue(db, day_ago)
    active_sessions = _query_active_sessions(db)
    recent_errors = _query_recent_llm_errors(db, day_ago)
    unread_notifications = _query_unread_notifications(db)

    try:
        service = get_diagnose_service()
        diagnostic = await service.get_diagnose()
        system_errors = (diagnostic.get("errors") or {}) if isinstance(diagnostic, dict) else {}
    except Exception:
        diagnostic = {"error": "diagnose service unavailable"}
        system_errors = {}

    metrics_snapshot = {}
    if hasattr(request.app.state, "metrics"):
        try:
            metrics_snapshot = request.app.state.metrics.snapshot()
        except Exception:
            pass

    return {
        "health": health_data,
        "time": now.isoformat(),
        "uptime_hours": metrics_snapshot.get("uptime_seconds", 0) / 3600 if metrics_snapshot else 0,
        "llm": {
            "total_calls_24h": llm_stats["total"],
            "success_rate": round(llm_stats["success"] / max(llm_stats["total"], 1) * 100, 1),
            "error_count_24h": llm_stats["error"],
            "avg_latency_ms": llm_stats["avg_latency_ms"],
            "recent_errors": recent_errors,
        },
        "scoring": scoring,
        "sessions": {"active": active_sessions},
        "notifications": {"unread": unread_notifications},
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
        service = get_diagnose_service()
        diagnostic = await service.get_diagnose()
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
    data = dashboard

    llm = data.get("llm", {})
    scoring = data.get("scoring", {})
    sessions = data.get("sessions", {})

    alerts = []
    if llm.get("success_rate", 100) < 90:
        alerts.append(f"LLM 成功率 {llm['success_rate']}% 低于 90%")
    if llm.get("error_count_24h", 0) > 50:
        alerts.append(f"近 24h LLM 错误 {llm['error_count_24h']} 次")
    if scoring.get("stuck", 0) > 5:
        alerts.append(f"卡住评分 {scoring['stuck']} 条")
    if sessions.get("active", 0) > 50:
        alerts.append(f"活跃会话 {sessions['active']} 个")

    return {
        "summary": {
            "time": data.get("time"),
            "uptime_hours": data.get("uptime_hours", 0),
            "status": "degraded" if alerts else "healthy",
        },
        "llm": {
            "total_calls_24h": llm.get("total_calls_24h", 0),
            "success_rate": llm.get("success_rate", 100),
            "error_count_24h": llm.get("error_count_24h", 0),
            "avg_latency_ms": llm.get("avg_latency_ms", 0),
            "top_errors": llm.get("recent_errors", []),
        },
        "scoring": {
            "pending": scoring.get("pending", 0),
            "stuck": scoring.get("stuck", 0),
        },
        "sessions": {
            "active": sessions.get("active", 0),
        },
        "notifications": {
            "unread": data.get("notifications", {}).get("unread", 0),
        },
        "alerts": alerts,
    }
