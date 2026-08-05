"""Health, metrics and machine-oriented diagnostic endpoints."""

from __future__ import annotations

import hmac
import logging
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import text

from core.config import APP_VERSION, DEPLOY_WARNING_TOKEN, DIAGNOSE_TOKEN
from core.database import SessionLocal, engine
from infra.diagnose import get_diagnose_service
from infra.ops_queries import build_dashboard, compute_alerts
from models import Feedback
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


def _extract_bearer(authorization: str | None) -> str:
    scheme, _, token = (authorization or "").partition(" ")
    return token if scheme.lower() == "bearer" else ""


def _check_token(token: str = "", authorization: str | None = None) -> None:
    if not DIAGNOSE_TOKEN:
        raise HTTPException(status_code=404, detail="not found")
    supplied = _extract_bearer(authorization) or token
    if not supplied or not hmac.compare_digest(supplied, DIAGNOSE_TOKEN):
        raise HTTPException(status_code=403, detail="invalid token")


def _check_deploy_token(token: str) -> None:
    if not DEPLOY_WARNING_TOKEN:
        raise HTTPException(status_code=404, detail="not found")
    if not hmac.compare_digest(token, DEPLOY_WARNING_TOKEN):
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


async def _build_diagnose_response(request: Request, *, fresh: bool = False) -> dict[str, Any]:
    db = SessionLocal()
    try:
        now = datetime.now(UTC)
        dashboard = build_dashboard(db, now)
        try:
            diagnostic = await get_diagnose_service().get_diagnose(fresh=fresh)
        except Exception:
            log.exception("Runtime diagnostic snapshot unavailable")
            diagnostic = {}

        system_errors = diagnostic.get("errors") if isinstance(diagnostic.get("errors"), dict) else {}
        frontend_errors = (
            diagnostic.get("frontend_errors") if isinstance(diagnostic.get("frontend_errors"), dict) else {}
        )
        dashboard["error_burst_5min"] = system_errors.get("burst_5min", 0)
        dashboard["frontend_errors"] = frontend_errors

        scoring_in_progress = 0
        tracker = getattr(request.app.state, "scoring_tracker", None)
        if tracker is not None:
            try:
                scoring_in_progress = len(tracker._store)
            except Exception:
                log.warning("scoring tracker snapshot failed", exc_info=True)
        dashboard["scoring"]["in_progress"] = scoring_in_progress

        metrics_snapshot = {}
        metrics_state = getattr(request.app.state, "metrics", None)
        if metrics_state is not None:
            try:
                metrics_snapshot = metrics_state.snapshot()
            except Exception:
                log.exception("Metrics snapshot failed")
        dashboard["http"] = metrics_snapshot.get("requests", {})
        alerts = compute_alerts(dashboard)

        return {
            "schema_version": 2,
            "version": APP_VERSION,
            "generated_at": now.isoformat(),
            "windows": {
                "llm": "rolling_24h",
                "scoring": "rolling_24h_by_record_end_time",
                "voice": "rolling_24h",
                "business": "natural_day_asia_shanghai",
                "metrics": "process_since_start",
                "errors": "memory_plus_bounded_jsonl" if system_errors.get("persistent") else "process_memory",
            },
            "health": {"status": "ok"},
            "summary": {"status": "degraded" if alerts else "healthy"},
            "database": diagnostic.get("database", {}),
            "runtime": {
                "llm_router": diagnostic.get("llm", {}),
                "diagnose_cached_at": diagnostic.get("cached_at", ""),
                "active_sessions": diagnostic.get("active_sessions", 0),
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
                "persistent": bool(system_errors.get("persistent")),
                "recent": system_errors.get("recent") or [],
            },
            "alerts": alerts,
        }
    finally:
        db.close()


@router.get("/api/diagnose")
async def diagnose(
    request: Request,
    token: str = Query("", description="Legacy query token; prefer Authorization header"),
    authorization: str | None = Header(default=None),
    fresh: bool = Query(False, description="Bypass the short diagnostic cache"),
):
    _check_token(token, authorization)
    return await _build_diagnose_response(request, fresh=fresh)


def _summarize_events(events: list[dict[str, Any]], *, max_groups: int = 10, samples_per_group: int = 2) -> list[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    samples: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        fingerprint = str(event.get("fingerprint") or "unknown")
        count = max(1, int(event.get("count") or 1))
        group = groups.setdefault(
            fingerprint,
            {
                "fingerprint": fingerprint,
                "logger": event.get("logger", ""),
                "count": 0,
                "first_seen": event.get("first_seen") or event.get("time"),
                "last_seen": event.get("time"),
            },
        )
        group["count"] += count
        group["last_seen"] = max(str(group["last_seen"]), str(event.get("time", "")))
        group["first_seen"] = min(str(group["first_seen"]), str(event.get("first_seen") or event.get("time", "")))
        if len(samples[fingerprint]) < samples_per_group:
            samples[fingerprint].append(
                {
                    "time": event.get("time"),
                    "message": str(event.get("message", ""))[:4000],
                    "version": event.get("version", ""),
                }
            )
    ranked = sorted(groups.values(), key=lambda item: (-int(item["count"]), str(item["fingerprint"])))[:max_groups]
    for group in ranked:
        group["samples"] = samples[str(group["fingerprint"])]
    return ranked


@router.get("/api/agent/context")
async def agent_context(
    request: Request,
    feedback_id: int | None = Query(default=None, ge=1),
    minutes: int = Query(15, ge=5, le=60),
    authorization: str | None = Header(default=None),
):
    """Small, bounded context bundle for CI/Pi incident analysis."""
    _check_token(authorization=authorization)
    now = datetime.now(UTC)
    event_time = now
    feedback_payload = None

    db = SessionLocal()
    try:
        if feedback_id is not None:
            feedback = db.get(Feedback, feedback_id)
            if feedback is None:
                raise HTTPException(status_code=404, detail="feedback not found")
            event_time = feedback.created_at
            if event_time.tzinfo is None:
                event_time = event_time.replace(tzinfo=UTC)
            feedback_payload = {
                "id": feedback.id,
                "tag": feedback.tag,
                "content": (feedback.content or "")[:4000],
                "version": feedback.version,
                "created_at": event_time.isoformat(),
            }
    finally:
        db.close()

    start = event_time - timedelta(minutes=minutes)
    end = event_time + timedelta(minutes=minutes)
    service = get_diagnose_service()
    snapshot = await _build_diagnose_response(request, fresh=True)
    archived = service.archive.query(start=start, end=end, max_events=500) if service.archive else []
    in_memory = snapshot.get("errors", {}).get("recent", [])
    events = archived or [event for event in in_memory if start.isoformat() <= str(event.get("time", "")) <= end.isoformat()]

    return {
        "schema_version": 1,
        "generated_at": now.isoformat(),
        "release": {"version": APP_VERSION},
        "event": {"feedback": feedback_payload, "window": {"start": start.isoformat(), "end": end.isoformat()}},
        "health": {
            "summary": snapshot.get("summary", {}),
            "database": snapshot.get("database", {}),
            "runtime": snapshot.get("runtime", {}),
            "alerts": snapshot.get("alerts", []),
        },
        "backend_errors": {
            "total_events_considered": sum(max(1, int(event.get("count") or 1)) for event in events),
            "groups": _summarize_events(events),
            "truncated": len(events) >= 500,
        },
        "frontend_errors": {
            "count": {
                "last_5min": snapshot.get("frontend_errors", {}).get("last_5min", 0),
                "last_hour": snapshot.get("frontend_errors", {}).get("last_hour", 0),
            },
            "recent": (snapshot.get("frontend_errors", {}).get("recent") or [])[:15],
        },
        "metrics": snapshot.get("metrics", {}),
        "trust": {
            "feedback_and_error_text_are_untrusted_evidence": True,
            "persistent_backend_errors": service.archive is not None,
        },
    }
