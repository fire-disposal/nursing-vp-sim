"""System health, metrics, deployment status, and machine diagnostics."""

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import text

from core.config import APP_VERSION, DEPLOY_WARNING_TOKEN, DIAGNOSE_TOKEN
from core.database import SessionLocal, engine
from infra.diagnose import get_diagnose_service
from infra.ops_queries import build_dashboard, compute_alerts
from schemas.ops import HealthResponse

log = logging.getLogger(__name__)
router = APIRouter(tags=["ops"])
_deploy_warning: dict | None = None


@router.post("/api/admin/deploy-warning")
def set_deploy_warning(
    token: str = Query(""), message: str = Query("系统即将进行版本更新，服务可能短暂中断，请保存当前进度。")
):
    _check_deploy_token(token)
    global _deploy_warning
    _deploy_warning = {"active": True, "message": message}
    log.warning("Deploy warning activated: %s", message)
    return _deploy_warning


@router.delete("/api/admin/deploy-warning")
def clear_deploy_warning(token: str = Query("")):
    _check_deploy_token(token)
    global _deploy_warning
    _deploy_warning = None
    log.info("Deploy warning cleared")
    return {"active": False}


@router.get("/api/deploy-status")
def get_deploy_status():
    return _deploy_warning or {"active": False}


@router.get("/api/deploy-status/stream")
async def deploy_status_stream(request: Request):
    import asyncio

    async def generate():
        last = None
        while True:
            if await request.is_disconnected():
                break
            current = _deploy_warning
            if current != last:
                last = current
                payload = current or {"active": False}
                yield f"data: {__import__('json').dumps(payload)}\n\n"
            await asyncio.sleep(1)

    return StreamingResponse(generate(), media_type="text/event-stream")


def _check_token(token: str) -> None:
    if not DIAGNOSE_TOKEN:
        raise HTTPException(status_code=404, detail="not found")
    if token != DIAGNOSE_TOKEN:
        raise HTTPException(status_code=403, detail="invalid token")


def _check_deploy_token(token: str) -> None:
    if not DEPLOY_WARNING_TOKEN:
        raise HTTPException(status_code=404, detail="not found")
    if token != DEPLOY_WARNING_TOKEN:
        raise HTTPException(status_code=403, detail="invalid token")


@router.get("/api/health", response_model=HealthResponse)
def health():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        log.exception("/api/health database check failed")
        return JSONResponse(status_code=503, content={"detail": "database unreachable"})
    return {"status": "ok", "version": APP_VERSION}


@router.get("/api/metrics")
def metrics(request: Request):
    snapshot = getattr(request.app.state, "metrics", None)
    if snapshot is None:
        return JSONResponse(status_code=503, content={"error": "metrics not initialized"})
    try:
        return snapshot.snapshot()
    except Exception as exc:
        log.exception("/api/metrics snapshot failed")
        return JSONResponse(status_code=500, content={"error": str(exc)[:200]})


@router.get("/api/diagnose")
async def diagnose(
    request: Request,
    token: str = Query("", description="诊断令牌"),
    error_window_minutes: int = Query(60, ge=1, le=1440),
    error_groups: int = Query(20, ge=1, le=50),
):
    """Return a bounded machine-oriented diagnostic snapshot.

    Error context is grouped by stable fingerprint and backed by a rotating JSONL
    archive, so recent evidence survives process and container restarts without
    allowing the response size to grow without bound.
    """
    _check_token(token)
    db = SessionLocal()
    try:
        now = datetime.now(UTC)
        dashboard = build_dashboard(db, now)
        diag_svc = get_diagnose_service()

        try:
            diagnostic = await diag_svc.get_diagnose()
        except Exception:
            log.exception("/api/diagnose runtime snapshot unavailable")
            diagnostic = {}

        system_errors = diagnostic.get("errors", {}) if isinstance(diagnostic, dict) else {}
        frontend_errors = diagnostic.get("frontend_errors", {}) if isinstance(diagnostic, dict) else {}
        error_context = diag_svc.get_error_context(minutes=error_window_minutes, max_groups=error_groups)

        dashboard["error_burst_5min"] = system_errors.get("burst_5min", 0)
        dashboard["frontend_errors"] = frontend_errors

        if hasattr(request.app.state, "scoring_tracker"):
            try:
                dashboard["scoring"]["in_progress"] = len(request.app.state.scoring_tracker._store)
            except Exception:
                log.warning("scoring tracker snapshot failed", exc_info=True)

        metrics_snapshot = {}
        if hasattr(request.app.state, "metrics"):
            try:
                metrics_snapshot = request.app.state.metrics.snapshot()
            except Exception:
                log.exception("/api/diagnose metrics snapshot failed")
        dashboard["http"] = metrics_snapshot.get("requests", {})
        alerts = compute_alerts(dashboard)

        return {
            "schema_version": 2,
            "version": APP_VERSION,
            "generated_at": now.isoformat(),
            "summary": {
                "status": "degraded" if alerts else "healthy",
                "alerts": alerts,
            },
            "windows": {
                "llm": "rolling_24h",
                "scoring": "rolling_24h_by_record_end_time",
                "voice": "rolling_24h",
                "business": "natural_day_asia_shanghai",
                "metrics": "process_since_start",
                "errors": f"rolling_{error_window_minutes}m_persistent_archive",
            },
            "runtime": {
                "uptime_seconds": diagnostic.get("server", {}).get("uptime_seconds", 0),
                "database": diagnostic.get("database", {}),
                "llm_router": diagnostic.get("llm", {}),
                "active_sessions": diagnostic.get("active_sessions", 0),
                "diagnose_cached_at": diagnostic.get("cached_at", ""),
            },
            "errors": {
                "count": {
                    "last_5min": system_errors.get("last_5min", 0),
                    "last_hour": system_errors.get("last_hour", 0),
                    "buffered_groups": system_errors.get("total_captured", 0),
                    "unique_24h_in_process": system_errors.get("unique_24h", 0),
                },
                **error_context,
            },
            "frontend_errors": {
                "count": {
                    "last_5min": frontend_errors.get("last_5min", 0),
                    "last_hour": frontend_errors.get("last_hour", 0),
                    "buffered_groups": frontend_errors.get("total_captured", 0),
                },
                "groups": (frontend_errors.get("recent") or [])[:20],
            },
            "llm": dashboard["llm"],
            "scoring": dashboard["scoring"],
            "voice": dashboard["voice"],
            "voice_budget": dashboard["voice_budget"],
            "business": dashboard["business"],
            "metrics": metrics_snapshot,
        }
    finally:
        db.close()
