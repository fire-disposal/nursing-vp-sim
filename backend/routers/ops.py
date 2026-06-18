"""
运维 API —— 统一系统诊断与日报数据出口

专为 OpenClaw Agent 和内部监控设计，一个端点即可获取全部运维信息。
认证方式与 /api/diagnose 一致：DIAGNOSE_TOKEN 查询参数。
"""

import logging
import os
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query, Request
from sqlalchemy import case, func

from core.database import SessionLocal
from core.diagnose import get_diagnose_service
from models import LLMCallLog, Notification, TrainingRecord

log = logging.getLogger(__name__)

router = APIRouter(tags=["ops"])

_DIAGNOSE_TOKEN = os.getenv("DIAGNOSE_TOKEN", "")


def _check_token(token: str) -> None:
    if not _DIAGNOSE_TOKEN:
        raise HTTPException(status_code=404, detail="not found")
    if token != _DIAGNOSE_TOKEN:
        raise HTTPException(status_code=403, detail="invalid token")


@router.get("/api/ops/dashboard")
async def ops_dashboard(
    token: str = Query("", description="诊断令牌"),
    request: Request = None,
):
    """统一运维面板 —— OpenClaw Agent 专用入口，一次调用获取全部状态。"""
    _check_token(token)

    db = SessionLocal()
    try:
        now = datetime.now(UTC)
        day_ago = now - timedelta(hours=24)

        # ── 基础健康 ──
        health_data = {"status": "ok", "version": os.getenv("APP_VERSION", "dev")}

        # ── LLM 调用统计（近 24h） ──
        llm_stats = (
            db.query(
                func.count(LLMCallLog.id).label("total"),
                func.sum(case((LLMCallLog.status == "success", 1), else_=0)).label("success"),
                func.sum(case((LLMCallLog.status == "error", 1), else_=0)).label("error"),
                func.avg(LLMCallLog.latency_ms).label("avg_latency_ms"),
            )
            .filter(LLMCallLog.created_at >= day_ago)
            .first()
        )
        llm_total = llm_stats.total or 0
        llm_success = llm_stats.success or 0
        llm_error = llm_stats.error or 0

        # ── 评分队列 ──
        scoring_pending = db.query(func.count(TrainingRecord.id)).filter(
            TrainingRecord.scoring_status == "pending",
            TrainingRecord.end_time >= day_ago,
        ).scalar() or 0
        scoring_stuck = db.query(func.count(TrainingRecord.id)).filter(
            TrainingRecord.scoring_status.in_(["pending", "processing"]),
            TrainingRecord.end_time < day_ago,
        ).scalar() or 0

        # ── 活跃会话 ──
        active_sessions = db.query(func.count(TrainingRecord.id)).filter(
            TrainingRecord.status == "in_progress",
        ).scalar() or 0

        # ── 近期异常 ──
        recent_errors = (
            db.query(LLMCallLog.error_type, func.count(LLMCallLog.id).label("cnt"))
            .filter(
                LLMCallLog.status == "error",
                LLMCallLog.created_at >= day_ago,
            )
            .group_by(LLMCallLog.error_type)
            .order_by(func.count(LLMCallLog.id).desc())
            .limit(5)
            .all()
        )

        # ── 后端诊断快照 ──
        try:
            service = get_diagnose_service()
            diagnostic = await service.get_diagnose()
            system_errors = diagnostic.get("errors", {}) if isinstance(diagnostic, dict) else {}
        except Exception:
            diagnostic = {"error": "diagnose service unavailable"}
            system_errors = {}

        # ── 指标快照 ──
        metrics_snapshot = {}
        if request and hasattr(request.app.state, "metrics"):
            try:
                metrics_snapshot = request.app.state.metrics.snapshot()
            except Exception:
                pass

        # ── 通知统计 ──
        unread_notifications = db.query(func.count(Notification.id)).filter(
            Notification.is_read == False,
        ).scalar() or 0

        return {
            "health": health_data,
            "time": now.isoformat(),
            "uptime_hours": metrics_snapshot.get("uptime_seconds", 0) / 3600 if metrics_snapshot else 0,
            "llm": {
                "total_calls_24h": llm_total,
                "success_rate": round(llm_success / max(llm_total, 1) * 100, 1),
                "error_count_24h": llm_error,
                "avg_latency_ms": round(llm_stats.avg_latency_ms or 0, 0),
                "recent_errors": [{"type": r.error_type, "count": r.cnt} for r in recent_errors],
            },
            "scoring": {
                "pending": scoring_pending,
                "stuck": scoring_stuck,
            },
            "sessions": {
                "active": active_sessions,
            },
            "notifications": {
                "unread": unread_notifications,
            },
            "metrics": metrics_snapshot,
            "diagnostic": diagnostic,
            "system_errors": system_errors,
        }
    finally:
        db.close()




@router.get("/api/ops/errors")
async def ops_errors(
    token: str = Query("", description="诊断令牌"),
    n: int = Query(20, description="返回条数"),
):
    """系统错误日志 —— ErrorCaptureHandler 环缓冲内容。"""
    _check_token(token)
    try:
        service = get_diagnose_service()
        diagnostic = await service.get_diagnose()
        errors = diagnostic.get("errors", {})
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


@router.get("/api/ops/report")
async def ops_report(
    token: str = Query("", description="诊断令牌"),
    request: Request = None,
):
    """运维日报 —— 返回纯数据的日报摘要，OpenClaw Agent 或外部 cron 可消费。"""
    _check_token(token)

    dashboard = await ops_dashboard(token, request)
    data = dashboard  # 不再自包装，EnvelopeMiddleware 统一处理

    # 提取关键指标，生成日报摘要
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



