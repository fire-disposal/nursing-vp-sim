"""Shared diagnostic query helpers — consumed by both public ops endpoints
(``routers/ops.py``) and admin ops endpoints (``routers/admin/ops.py``).

All functions accept a SQLAlchemy ``Session`` and return plain dicts / lists —
callers are responsible for auth, response shaping, and alert derivation.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from models import LLMCallLog, TrainingRecord, VoiceCallLog, VoiceConfig


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


def query_scoring(db: Session, day_ago: datetime) -> dict:
    pending = (
        db.query(func.count(TrainingRecord.id))
        .filter(TrainingRecord.scoring_status == "pending", TrainingRecord.end_time >= day_ago)
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
    result: dict = {"tts": {}, "asr": {}}
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
        elif r.direction == "asr":
            result["asr"] = section
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
    }


def compute_alerts(dashboard: dict) -> list[str]:
    llm = dashboard.get("llm", {})
    scoring = dashboard.get("scoring", {})
    sessions = dashboard.get("sessions", {})
    voice = dashboard.get("voice", {})
    voice_budget = dashboard.get("voice_budget", {})

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

    # ── Scoring ──
    if scoring.get("stuck", 0) > 5:
        alerts.append(f"卡住评分 {scoring['stuck']} 条")
    if scoring.get("pending", 0) > 20:
        alerts.append(f"排队评分 {scoring['pending']} 条")

    # ── Sessions ──
    if sessions.get("active", 0) > 50:
        alerts.append(f"活跃会话 {sessions['active']} 个")

    # ── Voice ──
    for svc, sr_min, err_max in [("tts", 90, 20), ("asr", 80, 20)]:
        s = voice.get(svc, {})
        if s.get("calls_24h", 0) > 0 and s.get("success_rate", 100) < sr_min:
            alerts.append(f"{svc.upper()} 成功率 {s['success_rate']}% 低于 {sr_min}%")
        if s.get("error_count_24h", 0) > err_max:
            alerts.append(f"近 24h {svc.upper()} 错误 {s['error_count_24h']} 次")

    # ── Voice budget ──
    if voice_budget.get("usage_pct", 0) > 90:
        alerts.append(f"语音月度预算已用 {voice_budget['usage_pct']}%")

    return alerts
