"""系统端点 — 健康检查、指标、综合诊断。

* ``/api/health``    — 数据库连通性检查（公开，无认证）
* ``/api/metrics``   — Prometheus 格式指标快照（公开，无认证）
* ``/api/diagnose``  — 综合诊断快照（token 认证，OpenClaw Agent / 日报脚本统一入口）

``/api/diagnose`` 取代了原有的 ``/api/ops/*`` 三元组（dashboard / errors / report），
将运维面板、错误日志、告警计算合并为一个综合响应，一次调用获取全部运维信息。
"""

import logging
import os
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

from core.config import APP_VERSION, DIAGNOSE_TOKEN
from core.database import SessionLocal, engine
from core.diagnose import get_diagnose_service
from infrastructure.ops_queries import build_dashboard, compute_alerts
from schemas.ops import HealthResponse

log = logging.getLogger(__name__)

router = APIRouter(tags=["ops"])


def _check_token(token: str) -> None:
    if not DIAGNOSE_TOKEN:
        raise HTTPException(status_code=404, detail="not found")
    if token != DIAGNOSE_TOKEN:
        raise HTTPException(status_code=403, detail="invalid token")


# ── Health ──────────────────────────────────────────────────────────────────


@router.get("/api/health", response_model=HealthResponse)
def health():
    """数据库连通性检查 —— 负载均衡器健康探针。"""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse(status_code=503, content={"detail": "database unreachable"})
    return {"status": "ok", "version": APP_VERSION}


# ── Metrics ─────────────────────────────────────────────────────────────────


@router.get("/api/metrics")
def metrics(request: Request):
    """指标快照 —— 内部监控消费。"""
    m = getattr(request.app.state, "metrics", None)
    if m is None:
        return JSONResponse(status_code=503, content=_empty_metrics("metrics not initialized"))
    try:
        return m.snapshot()
    except Exception as e:
        log.warning("/api/metrics snapshot failed: %s", e)
        return JSONResponse(status_code=500, content=_empty_metrics(str(e)[:200]))


def _empty_metrics(error: str = "") -> dict:
    return {
        "uptime_seconds": 0,
        "version": os.getenv("APP_VERSION", "dev"),
        "requests": {"total": 0, "by_status": {}, "latency_ms": {"p50": 0, "p95": 0, "p99": 0, "avg": 0}},
        "active_sessions": 0,
        "llm": {
            "calls_total": 0,
            "calls_success": 0,
            "calls_error": 0,
            "tokens_used": 0,
            "estimated_cost": 0,
            "latency_ms": {"avg": 0, "p95": 0},
            "degraded_providers": 0,
            "global_degraded": False,
        },
        "db": {"pool_size": 0, "checked_out": 0, "overflow": 0, "connections_in_use": 0},
        "queue": {"task_queue": 0, "log_queue": 0},
        "memory_mb": 0.0,
        **({"error": error} if error else {}),
    }


# ── Diagnose (comprehensive) ────────────────────────────────────────────────


@router.get("/api/diagnose")
async def diagnose(request: Request, token: str = Query("", description="诊断令牌")):
    """综合诊断快照 —— 运维监控统一入口。

    一次调用返回：系统版本、健康状态、LLM 统计、评分队列、
    语音服务 (TTS/ASR) 统计、系统错误日志、指标快照、告警列表。
    """
    _check_token(token)

    db = SessionLocal()
    try:
        now = datetime.now(UTC)

        # DB-backed snapshot
        dashboard = build_dashboard(db, now)
        alerts = compute_alerts(dashboard)

        # Scoring in-progress count (from app state, not DB)
        scoring_in_progress = 0
        if hasattr(request.app.state, "scoring_tracker"):
            try:
                scoring_in_progress = len(request.app.state.scoring_tracker._store)
            except Exception:
                pass
        dashboard["scoring"]["in_progress"] = scoring_in_progress

        # Metrics snapshot
        metrics_snapshot = {}
        if hasattr(request.app.state, "metrics"):
            try:
                metrics_snapshot = request.app.state.metrics.snapshot()
            except Exception:
                pass

        # Diagnose service errors
        system_errors = {}
        try:
            diag_svc = get_diagnose_service()
            diagnostic = await diag_svc.get_diagnose()
            errors = (diagnostic.get("errors") or {}) if isinstance(diagnostic, dict) else {}
            system_errors = errors
        except Exception:
            diagnostic = {"error": "diagnose service unavailable"}

        return {
            "version": APP_VERSION,
            "health": {"status": "ok"},
            "summary": {"status": "degraded" if alerts else "healthy"},
            "llm": dashboard["llm"],
            "scoring": dashboard["scoring"],
            "voice": dashboard["voice"],
            "voice_budget": dashboard["voice_budget"],
            "metrics": metrics_snapshot,
            "errors": {
                "count": {
                    "last_5min": system_errors.get("last_5min", 0),
                    "last_hour": system_errors.get("last_hour", 0),
                    "total_captured": system_errors.get("total_captured", 0),
                },
                "recent": (system_errors.get("recent") or []),
            },
            "alerts": alerts,
        }
    finally:
        db.close()
