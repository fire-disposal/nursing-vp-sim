"""系统端点 — 健康检查、指标、综合诊断。

* ``/api/health``    — 数据库连通性检查（公开，无认证）
* ``/api/metrics``   — Prometheus 格式指标快照（公开，无认证）
* ``/api/diagnose``  — 综合诊断快照（token 认证，OpenClaw Agent / 日报脚本统一入口）

``/api/diagnose`` 取代了原有的 ``/api/ops/*`` 三元组（dashboard / errors / report），
将运维面板、错误日志、告警计算合并为一个综合响应，一次调用获取全部运维信息。
"""

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

from core.config import APP_VERSION, DIAGNOSE_TOKEN
from core.database import SessionLocal, engine
from infra.diagnose import get_diagnose_service
from infra.ops_queries import build_dashboard, compute_alerts
from schemas.ops import HealthResponse

log = logging.getLogger(__name__)

# ── Deploy warning banner ───────────────────────────────────────────────

_deploy_warning: dict | None = None


@router.post("/api/admin/deploy-warning")
def set_deploy_warning(token: str = Query(""), message: str = Query("系统即将进行版本更新，服务可能短暂中断，请保存当前进度。")):
    _check_token(token)
    global _deploy_warning
    _deploy_warning = {"active": True, "message": message, "set_at": datetime.now(UTC).isoformat()}
    log.warning("Deploy warning activated: %s", message)
    return _deploy_warning


@router.delete("/api/admin/deploy-warning")
def clear_deploy_warning(token: str = Query("")):
    _check_token(token)
    global _deploy_warning
    _deploy_warning = None
    log.info("Deploy warning cleared")
    return {"active": False}


@router.get("/api/deploy-status")
def get_deploy_status():
    return _deploy_warning or {"active": False}
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
        log.exception("/api/health 数据库连通性检查失败")
        return JSONResponse(status_code=503, content={"detail": "database unreachable"})
    return {"status": "ok", "version": APP_VERSION}


# ── Metrics ─────────────────────────────────────────────────────────────────


@router.get("/api/metrics")
def metrics(request: Request):
    """指标快照 —— 内部监控消费。"""
    m = getattr(request.app.state, "metrics", None)
    if m is None:
        return JSONResponse(status_code=503, content={"error": "metrics not initialized"})
    try:
        return m.snapshot()
    except Exception as e:
        log.exception("/api/metrics snapshot failed")
        return JSONResponse(status_code=500, content={"error": str(e)[:200]})


# ── Diagnose (comprehensive) ────────────────────────────────────────────────


@router.get("/api/diagnose")
async def diagnose(request: Request, token: str = Query("", description="诊断令牌")):
    """综合诊断快照 —— 运维监控统一入口。

    一次调用返回：系统版本、健康状态、LLM 统计、评分队列、
    语音服务 (TTS) 统计、系统错误日志、指标快照、告警列表。
    """
    _check_token(token)

    db = SessionLocal()
    try:
        now = datetime.now(UTC)

        # DB-backed snapshot
        dashboard = build_dashboard(db, now)

        # Runtime snapshot: in-memory backend/frontend errors, DB probe, LLM router state.
        try:
            diag_svc = get_diagnose_service()
            diagnostic = await diag_svc.get_diagnose()
        except Exception:
            log.exception("/api/diagnose runtime snapshot unavailable")
            diagnostic = {"error": "diagnose service unavailable"}

        raw_system_errors = diagnostic.get("errors") if isinstance(diagnostic, dict) else None
        raw_frontend_errors = diagnostic.get("frontend_errors") if isinstance(diagnostic, dict) else None
        system_errors = raw_system_errors if isinstance(raw_system_errors, dict) else {}
        frontend_errors = raw_frontend_errors if isinstance(raw_frontend_errors, dict) else {}
        dashboard["error_burst_5min"] = system_errors.get("burst_5min", 0)
        dashboard["frontend_errors"] = frontend_errors

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
                log.exception("/api/diagnose metrics snapshot failed")
        dashboard["http"] = metrics_snapshot.get("requests", {})

        alerts = compute_alerts(dashboard)

        return {
            "version": APP_VERSION,
            "generated_at": now.isoformat(),
            "windows": {
                "llm": "rolling_24h",
                "scoring": "rolling_24h_by_record_end_time",
                "voice": "rolling_24h",
                "business": "natural_day_asia_shanghai",
                "metrics": "process_since_start",
                "errors": "in_memory_process_ring_buffer",
            },
            "health": {"status": "ok"},
            "summary": {"status": "degraded" if alerts else "healthy"},
            "database": diagnostic.get("database", {}) if isinstance(diagnostic, dict) else {},
            "runtime": {
                "llm_router": diagnostic.get("llm", {}) if isinstance(diagnostic, dict) else {},
                "diagnose_cached_at": diagnostic.get("cached_at", "") if isinstance(diagnostic, dict) else "",
            },
            "llm": dashboard["llm"],
            "scoring": dashboard["scoring"],
            "voice": dashboard["voice"],
            "voice_budget": dashboard["voice_budget"],
            "business": dashboard["business"],
            "metrics": metrics_snapshot,
            "frontend_errors": frontend_errors,
            "errors": {
                "count": {
                    "last_5min": system_errors.get("last_5min", 0),
                    "last_hour": system_errors.get("last_hour", 0),
                    "total_captured": system_errors.get("total_captured", 0),
                    "unique_24h": system_errors.get("unique_24h", 0),
                    "burst_5min": system_errors.get("burst_5min", 0),
                },
                "recent": (system_errors.get("recent") or []),
            },
            "alerts": alerts,
        }
    finally:
        db.close()
