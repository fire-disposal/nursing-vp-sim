"""System health, metrics, deployment status, and machine diagnostics."""

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

from core.config import APP_VERSION, DEPLOY_WARNING_TOKEN, DIAGNOSE_TOKEN
from core.database import SessionLocal, engine
from infra.diagnose import CACHE_TTL_SECONDS, get_diagnose_service
from infra.ops_queries import build_dashboard, compute_alerts
from infra.telemetry import SNAPSHOT_WINDOW_MINUTES
from schemas.ops import HealthResponse

log = logging.getLogger(__name__)
router = APIRouter(tags=["ops"])
_deploy_warning: dict | None = None

# ── 诊断口径词表（唯一语义来源，改这里即改契约）──────────────────────────
# scope：process = 本 worker 进程内；workers = 跨 worker 档案合并；db = 数据库全局。
# window：now = 即时状态；since_start = 进程启动至今累计；m5/h1/h24 = 滚动窗口；
#         rolling_Nm = 由请求参数 error_window_minutes 决定的滚动窗口；
#         rolling_24h / day_cn / month_cn = DB 侧滚动 24 小时 / 北京自然日 / 北京自然月。
SCOPE_PROCESS = "process"
SCOPE_WORKERS = "workers"
SCOPE_DB = "db"
WINDOW_NOW = "now"
WINDOW_SINCE_START = "since_start"
WINDOW_H24 = "rolling_24h"
WINDOW_DAY_CN = "day_cn"
WINDOW_MONTH_CN = "month_cn"
ERROR_COUNT_WINDOWS = {"last_5min": "m5", "last_hour": "h1", "unique_24h": "h24", "total_captured": "h24"}
# 前端遥测分组窗口固定 60 分钟（telemetry.SNAPSHOT_WINDOW_MINUTES），标签同时供 admin 端点复用。
TELEMETRY_WINDOW_LABEL = f"rolling_{SNAPSHOT_WINDOW_MINUTES}m"


def _cached_age_seconds(cached_at: str, now: datetime) -> int:
    """runtime 快照的陈旧秒数（快照最长 ``CACHE_TTL_SECONDS``）；缺字段返回 -1。"""
    if not cached_at:
        return -1
    try:
        stamp = datetime.fromisoformat(str(cached_at))
    except ValueError:
        return -1
    stamp = stamp if stamp.tzinfo else stamp.replace(tzinfo=UTC)
    return max(0, int((now - stamp).total_seconds()))


def error_count_block(source: dict) -> dict:
    """``count`` 子块（公开端点与 admin 端点共用，避免两套形状漂移）。"""
    return {
        "last_5min": source.get("last_5min", 0),
        "last_hour": source.get("last_hour", 0),
        "total_captured": source.get("total_captured", 0),
        "unique_24h": source.get("unique_24h", source.get("total_captured", 0)),
    }


def frontend_errors_block(frontend_errors: dict, *, window_label: str) -> dict:
    """前端遥测块 —— 与 ``errors`` 同形（公开端点与 admin 端点共用）。"""
    return {
        "scope": SCOPE_WORKERS,
        "window": window_label,
        "window_by_count": ERROR_COUNT_WINDOWS,
        "count": error_count_block(frontend_errors),
        "groups": (frontend_errors.get("groups") or [])[:20],
    }


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
    # 刻意不加应用层鉴权（2026-07-10 决策：Prometheus scrape 惯例 + 网络层负责，
    # 见 deploy/nginx/snippets/block-scanners.conf）。审计研究 RB-8 曾建议加 token，
    # 经核对与既有决策冲突 → 不改（2026-09-26 裁定）。
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
        llm_router_state = diagnostic.get("llm", {}) if isinstance(diagnostic, dict) else {}
        error_context = diag_svc.get_error_context(minutes=error_window_minutes, max_groups=error_groups)

        # 口径统一：5 分钟突发与错误块的 last_5min 同源同义（旧 burst_5min 是重复键）。
        dashboard["error_burst_5min"] = error_context.get("last_5min", system_errors.get("last_5min", 0))
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

        cached_age_seconds = _cached_age_seconds(str(diagnostic.get("cached_at") or ""), now)
        error_window_label = f"rolling_{error_window_minutes}m"

        return {
            "schema_version": 3,
            "version": APP_VERSION,
            "generated_at": now.isoformat(),
            "summary": {
                "status": "degraded" if alerts else "healthy",
                "alerts": alerts,
            },
            "alerts": alerts,
            "runtime": {
                "scope": SCOPE_PROCESS,
                "window": WINDOW_NOW,
                "cache_ttl_seconds": CACHE_TTL_SECONDS,
                "cached_age_seconds": cached_age_seconds,
                "uptime_seconds": diagnostic.get("server", {}).get("uptime_seconds", 0),
                "database": diagnostic.get("database", {}),
                "diagnose_cached_at": diagnostic.get("cached_at", ""),
            },
            "sessions": {
                "scope": SCOPE_DB,
                "window": WINDOW_NOW,
                **dashboard.get("sessions", {}),
            },
            "errors": {
                "scope": SCOPE_WORKERS,
                "window": error_window_label,
                "window_by_count": ERROR_COUNT_WINDOWS,
                "count": error_count_block(system_errors),
                **error_context,
            },
            "frontend_errors": frontend_errors_block(frontend_errors, window_label=error_window_label),
            "llm": {
                "scope": SCOPE_DB,
                "window": WINDOW_H24,
                **dashboard["llm"],
                # 进程侧（router 熔断/降级/兜底/落库失败）单列，scope/window 与 24h 统计区分。
                "router": {"scope": SCOPE_PROCESS, "window": WINDOW_NOW, **llm_router_state},
            },
            "scoring": {
                "scope": SCOPE_DB,
                "window": "rolling_24h_by_record_end_time",
                "in_progress_scope": SCOPE_PROCESS,
                "in_progress_window": WINDOW_NOW,
                **dashboard["scoring"],
            },
            "jobs": {
                "scope": SCOPE_DB,
                "window": WINDOW_NOW,
                **dashboard["jobs"],
            },
            "voice": {"scope": SCOPE_DB, "window": WINDOW_H24, **dashboard["voice"]},
            "voice_budget": {"scope": SCOPE_DB, "window": WINDOW_MONTH_CN, **dashboard["voice_budget"]},
            "business": {"scope": SCOPE_DB, "window": WINDOW_DAY_CN, **dashboard["business"]},
            "metrics": {
                "scope": SCOPE_PROCESS,
                "window": WINDOW_SINCE_START,
                "active_sessions_scope": SCOPE_DB,
                "active_sessions_window": WINDOW_NOW,
                **metrics_snapshot,
            },
        }
    finally:
        db.close()
