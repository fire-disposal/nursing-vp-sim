"""Shared diagnostic query helpers — consumed by both public ops endpoints
(``routers/ops.py``) and admin ops endpoints (``routers/admin/ops.py``).

All functions accept a SQLAlchemy ``Session`` and return plain dicts / lists —
callers are responsible for auth, response shaping, and alert derivation.
"""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from models import LLMCallLog, TrainingRecord, VoiceCallLog, VoiceConfig

_CN_TZ = ZoneInfo("Asia/Shanghai")


def query_llm(db: Session, since: datetime) -> dict:
    row = (
        db.query(
            func.count(LLMCallLog.id).label("total"),
            func.sum(case((LLMCallLog.status == "success", 1), else_=0)).label("success"),
            func.sum(case((LLMCallLog.status == "error", 1), else_=0)).label("error"),
            func.avg(LLMCallLog.latency_ms).label("avg_latency_ms"),
        )
        .filter(LLMCallLog.created_at >= since)
        .one()
    )
    return {
        "total": row.total or 0,
        "success": row.success or 0,
        "error": row.error or 0,
        "avg_latency_ms": round(row.avg_latency_ms or 0, 0),
    }


def query_llm_errors(db: Session, since: datetime, limit: int = 5) -> list[dict]:
    rows = (
        db.query(LLMCallLog.error_type, func.count(LLMCallLog.id).label("cnt"))
        .filter(LLMCallLog.status == "error", LLMCallLog.created_at >= since)
        .group_by(LLMCallLog.error_type)
        .order_by(func.count(LLMCallLog.id).desc())
        .limit(limit)
        .all()
    )
    return [{"type": r.error_type, "count": r.cnt} for r in rows]


def query_business(db: Session, now: datetime) -> dict:
    """Business-facing daily metrics — Asia/Shanghai natural day."""
    today_start = now.astimezone(_CN_TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    users_today = (
        db.query(func.count(func.distinct(TrainingRecord.user_id)))
        .filter(TrainingRecord.start_time >= today_start)
        .scalar()
        or 0
    )
    started_today = (
        db.query(func.count(TrainingRecord.id)).filter(TrainingRecord.start_time >= today_start).scalar() or 0
    )
    completed_today = (
        db.query(func.count(TrainingRecord.id))
        .filter(
            TrainingRecord.status == "completed",
            TrainingRecord.end_time >= today_start,
        )
        .scalar()
        or 0
    )
    return {
        "today_users": users_today,
        "today_trainings": started_today,
        "today_completed": completed_today,
    }


def query_scoring(db: Session, day_ago: datetime) -> dict:
    pending = (
        db.query(func.count(TrainingRecord.id))
        .filter(TrainingRecord.scoring_status == "pending", TrainingRecord.end_time >= day_ago)
        .scalar()
        or 0
    )
    completed = (
        db.query(func.count(TrainingRecord.id))
        .filter(TrainingRecord.scoring_status == "completed", TrainingRecord.end_time >= day_ago)
        .scalar()
        or 0
    )
    failed = (
        db.query(func.count(TrainingRecord.id))
        .filter(TrainingRecord.scoring_status == "failed", TrainingRecord.end_time >= day_ago)
        .scalar()
        or 0
    )
    discarded = (
        db.query(func.count(TrainingRecord.id))
        .filter(TrainingRecord.status == "discarded", TrainingRecord.end_time >= day_ago)
        .scalar()
        or 0
    )
    total_scored = completed + failed
    success_rate = round(completed / max(total_scored, 1) * 100, 1)
    return {
        "pending": pending,
        "completed_24h": completed,
        "failed_24h": failed,
        "discarded_24h": discarded,
        "success_rate": success_rate,
    }


def query_sessions(db: Session) -> int:
    return db.query(func.count(TrainingRecord.id)).filter(TrainingRecord.status == "in_progress").scalar() or 0


def query_voice(db: Session, day_ago: datetime) -> dict:
    rows = (
        db.query(
            VoiceCallLog.direction,
            func.count(VoiceCallLog.id).label("total"),
            func.sum(case((VoiceCallLog.status == "success", 1), else_=0)).label("success"),
            func.sum(case((VoiceCallLog.status == "error", 1), else_=0)).label("error"),
            func.avg(VoiceCallLog.latency_ms).label("avg_latency_ms"),
            func.sum(VoiceCallLog.cost_estimated).label("cost"),
        )
        .filter(VoiceCallLog.created_at >= day_ago)
        .group_by(VoiceCallLog.direction)
        .all()
    )
    result: dict = {"tts": {}}
    for r in rows:
        total = r.total or 0
        success = r.success or 0
        section = {
            "calls_24h": total,
            "success_rate": round(success / max(total, 1) * 100, 1),
            "error_count_24h": r.error or 0,
            "avg_latency_ms": round(r.avg_latency_ms or 0, 0),
            "cost_24h": round(float(r.cost or 0), 4),
        }
        if r.direction == "tts":
            result["tts"] = section
    return result


def query_voice_budget(db: Session) -> dict:
    cfg = db.query(VoiceConfig).filter(VoiceConfig.is_active == True).first()
    if not cfg:
        return {"monthly_budget": 0, "monthly_cost": 0, "usage_pct": 0}
    now = datetime.now(UTC)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    monthly_cost = (
        db.query(func.coalesce(func.sum(VoiceCallLog.cost_estimated), 0))
        .filter(VoiceCallLog.created_at >= month_start)
        .scalar()
        or 0
    )
    budget = float(cfg.monthly_budget or 0)
    return {
        "monthly_budget": budget,
        "monthly_cost": round(float(monthly_cost), 4),
        "usage_pct": round(float(monthly_cost) / max(budget, 1) * 100, 1),
    }


def build_dashboard(db: Session, now: datetime | None = None) -> dict:
    """Core snapshot — used by both public diagnose and admin dashboard."""
    if now is None:
        now = datetime.now(UTC)
    day_ago = now - timedelta(hours=24)

    llm = query_llm(db, day_ago)
    errors = query_llm_errors(db, day_ago)
    scoring = query_scoring(db, day_ago)
    active = query_sessions(db)
    voice = query_voice(db, day_ago)
    voice_budget = query_voice_budget(db)

    business = query_business(db, now)

    return {
        "time": now.isoformat(),
        "llm": {
            "total_calls_24h": llm["total"],
            "success_rate": round(llm["success"] / max(llm["total"], 1) * 100, 1),
            "error_count_24h": llm["error"],
            "avg_latency_ms": llm["avg_latency_ms"],
            "recent_errors": errors,
        },
        "scoring": scoring,
        "sessions": {"active": active},
        "voice": voice,
        "voice_budget": voice_budget,
        "business": business,
    }


def compute_alerts(dashboard: dict) -> list[str]:
    llm = dashboard.get("llm", {})
    scoring = dashboard.get("scoring", {})
    sessions = dashboard.get("sessions", {})
    voice = dashboard.get("voice", {})
    voice_budget = dashboard.get("voice_budget", {})
    error_burst = dashboard.get("error_burst_5min", 0)
    http = dashboard.get("http", {})
    frontend_errors = dashboard.get("frontend_errors", {})

    alerts: list[str] = []

    # ── LLM ──
    if llm.get("total_calls_24h", 0) > 0 and llm.get("success_rate", 100) < 90:
        alerts.append(f"LLM 成功率 {llm['success_rate']}% 低于 90%")
    if llm.get("error_count_24h", 0) > 50:
        alerts.append(f"近 24h LLM 错误 {llm['error_count_24h']} 次")
    rate_errors = [
        e
        for e in (llm.get("recent_errors") or [])
        if "rate" in str(e.get("type", "")).lower() or "429" in str(e.get("type", ""))
    ]
    if rate_errors:
        total_rate = sum(e.get("count", 0) for e in rate_errors)
        if total_rate > 10:
            alerts.append(f"LLM 限流错误 {total_rate} 次 (24h)")

    # ── LLM 短窗口突发 ──
    if error_burst > 5:
        alerts.append(f"LLM 5 分钟突发错误 {error_burst} 次")

    # ── HTTP/API surface ──
    http_total = http.get("total", 0)
    http_4xx = (http.get("by_status") or {}).get("4xx", 0)
    if http_total >= 20 and http_4xx / max(http_total, 1) > 0.2:
        alerts.append(f"HTTP 4xx 占比 {round(http_4xx / http_total * 100, 1)}% 偏高")
    http_latency = http.get("latency_ms") or {}
    if http_latency.get("p95", 0) > 2000:
        alerts.append(f"HTTP p95 延迟 {http_latency['p95']}ms 偏高")

    # ── Frontend telemetry ──
    if frontend_errors.get("last_5min", 0) > 0:
        alerts.append(f"前端 5 分钟错误 {frontend_errors['last_5min']} 次")
    elif frontend_errors.get("last_hour", 0) > 10:
        alerts.append(f"前端 1 小时错误 {frontend_errors['last_hour']} 次")
    # ── Scoring ──
    total_scored = scoring.get("completed_24h", 0) + scoring.get("failed_24h", 0)
    if total_scored > 0 and scoring.get("success_rate", 100) < 80:
        alerts.append(f"评分成功率 {scoring['success_rate']}% 低于 80%")
    if scoring.get("pending", 0) > 30:
        alerts.append(f"排队评分 {scoring['pending']} 条")

    # ── Sessions ──
    if sessions.get("active", 0) > 50:
        alerts.append(f"活跃会话 {sessions['active']} 个")

    # ── Voice ──
    for svc, sr_min, err_max in [("tts", 90, 20)]:
        s = voice.get(svc, {})
        if s.get("calls_24h", 0) > 0 and s.get("success_rate", 100) < sr_min:
            alerts.append(f"{svc.upper()} 成功率 {s['success_rate']}% 低于 {sr_min}%")
        if s.get("error_count_24h", 0) > err_max:
            alerts.append(f"近 24h {svc.upper()} 错误 {s['error_count_24h']} 次")

    # ── Voice budget ──
    if voice_budget.get("usage_pct", 0) > 90:
        alerts.append(f"语音月度预算已用 {voice_budget['usage_pct']}%")

    return alerts
