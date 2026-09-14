"""Shared diagnostic query helpers — consumed by both public ops endpoints
(``infra/diagnostics.py``) and admin ops endpoints (``modules/admin/ops.py``).

This module is the **single query layer** for LLM / voice call statistics: the
admin cost dashboard (``modules/admin/costs.py``), the LLM monitor
(``modules/admin/llm_monitor.py``), the ops dashboard (``modules/admin/ops.py``)
and ``/api/diagnose`` (``infra/diagnostics.py``) all read the same window
functions, so "错误数 / 时间桶 / 日期边界" can no longer drift apart.

Two invariants are enforced here and nowhere else:

- **状态口径**：DB 只写 ``LLMCallStatus.SUCCESS`` / ``LLMCallStatus.FAILED``；
  错误数一律是 ``status != SUCCESS``（不是字面量 ``"error"``——那个值从不落库）。
- **时间口径**：统计窗口与日/月边界一律按北京自然日（``Asia/Shanghai``）换算成
  naïve-UTC 传给 DB 列（该列存的就是 UTC 墙钟时间），日期筛选为**闭区间**。

All functions accept a SQLAlchemy ``Session`` and return plain dicts / lists —
callers are responsible for auth, response shaping, and alert derivation.
"""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from core.exceptions import ValidationError
from core.statuses import LLMCallStatus
from models import LLMCallLog, TrainingRecord, VoiceCallLog, VoiceConfig

_CN_TZ = ZoneInfo("Asia/Shanghai")
_TZ_NAME = "Asia/Shanghai"


# ── 时间基准（唯一实现）─────────────────────────────────────────────


def local_ts(col):
    """把 naïve-UTC 时间列标注为 UTC 后转换为北京时区，用于按北京日/月分桶。"""
    return func.timezone(_TZ_NAME, func.timezone("UTC", col))


def local_date(col):
    """按北京时区对时间列取 date。"""
    return func.date(local_ts(col))


def cn_day_start(now: datetime) -> datetime:
    """*now* 所在北京自然日的零点，返回 **aware UTC** 时刻。

    列口径：``LLMCallLog.created_at`` / ``VoiceCallLog.created_at`` 是 naïve 的
    ``timestamp`` 列，但应用一律用 **aware** 值写入 —— psycopg 发 timestamptz，PG 按
    **会话时区**折算成列值。查询侧因此也必须传 aware 值，PG 才会做同样的折算；传
    naïve 值会绕过折算，在会话时区非 UTC（如 ``TZ=Asia/Shanghai``）时与写入值错开
    整整 8 小时（实测：naïve 边界会让"今日"过滤匹配 0 行）。
    """
    return now.astimezone(_CN_TZ).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)


def cn_month_start(now: datetime) -> datetime:
    """*now* 所在北京自然月的月初零点（aware UTC）。"""
    return cn_day_start(now).replace(day=1)


def _cn_day_start_of(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=_CN_TZ).astimezone(UTC)


def day_range(date_from: str | None, date_to: str | None) -> tuple[datetime | None, datetime | None]:
    """把 ``YYYY-MM-DD`` 的**闭区间**转成 aware-UTC 的 ``[since, until)``。

    按北京自然日解释：``date_to`` 当天 23:59:59 的记录必须落在窗口内
    （历史实现用 ``created_at < date_to`` 静默丢掉当天数据）。
    """
    try:
        since = _cn_day_start_of(date.fromisoformat(date_from)) if date_from else None
        until = _cn_day_start_of(date.fromisoformat(date_to)) + timedelta(days=1) if date_to else None
    except ValueError as exc:
        raise ValidationError(f"无效的日期格式: {exc.args[0] if exc.args else ''}，请使用 YYYY-MM-DD 格式")
    return since, until


# ── 窗口统计（唯一实现）─────────────────────────────────────────────


def llm_window(db: Session, since: datetime | None, until: datetime | None = None) -> dict:
    """LLM 调用窗口统计。``cost`` / ``tokens`` 仅统计成功调用（失败行的成本是估值噪声）。"""
    success_case = case((LLMCallLog.status == LLMCallStatus.SUCCESS, 1), else_=0)
    q = db.query(
        func.count(LLMCallLog.id).label("total"),
        func.sum(success_case).label("success"),
        func.avg(LLMCallLog.latency_ms).label("avg_latency_ms"),
        func.coalesce(
            func.sum(case((LLMCallLog.status == LLMCallStatus.SUCCESS, LLMCallLog.estimated_cost), else_=0)), 0
        ).label("cost"),
        func.coalesce(
            func.sum(case((LLMCallLog.status == LLMCallStatus.SUCCESS, LLMCallLog.total_tokens), else_=0)), 0
        ).label("tokens"),
    )
    if since is not None:
        q = q.filter(LLMCallLog.created_at >= since)
    if until is not None:
        q = q.filter(LLMCallLog.created_at < until)
    row = q.one()
    total = int(row.total or 0)
    success = int(row.success or 0)
    return {
        "total": total,
        "success": success,
        "error": total - success,
        "success_rate": round(success / max(total, 1) * 100, 1),
        "avg_latency_ms": round(float(row.avg_latency_ms or 0), 0),
        "cost": round(float(row.cost or 0), 6),
        "tokens": int(row.tokens or 0),
    }


def voice_window(
    db: Session,
    since: datetime | None,
    until: datetime | None = None,
    direction: str | None = None,
) -> dict[str, dict]:
    """语音调用窗口统计，按 ``direction`` 分组（当前只有 ``tts``）。"""
    q = db.query(
        VoiceCallLog.direction,
        func.count(VoiceCallLog.id).label("total"),
        func.sum(case((VoiceCallLog.status == "success", 1), else_=0)).label("success"),
        func.sum(case((VoiceCallLog.status == "fallback", 1), else_=0)).label("fallback"),
        func.sum(case((VoiceCallLog.status == "error", 1), else_=0)).label("error"),
        func.avg(VoiceCallLog.latency_ms).label("avg_latency_ms"),
        func.coalesce(func.sum(VoiceCallLog.cost_estimated), 0).label("cost"),
        func.coalesce(func.sum(VoiceCallLog.text_length), 0).label("chars"),
        func.coalesce(func.sum(VoiceCallLog.latency_ms), 0).label("total_latency_ms"),
    )
    if since is not None:
        q = q.filter(VoiceCallLog.created_at >= since)
    if until is not None:
        q = q.filter(VoiceCallLog.created_at < until)
    if direction is not None:
        q = q.filter(VoiceCallLog.direction == direction)
    result: dict[str, dict] = {}
    for r in q.group_by(VoiceCallLog.direction).all():
        total = int(r.total or 0)
        success = int(r.success or 0)
        result[r.direction] = {
            "total": total,
            "success": success,
            "fallback": int(r.fallback or 0),
            "error": int(r.error or 0),
            "success_rate": round(success / max(total, 1) * 100, 1),
            "avg_latency_ms": round(float(r.avg_latency_ms or 0), 0),
            "cost": round(float(r.cost or 0), 6),
            "chars": int(r.chars or 0),
            "total_latency_ms": int(r.total_latency_ms or 0),
        }
    return result


def query_llm(db: Session, since: datetime) -> dict:
    return llm_window(db, since)


def query_llm_errors(db: Session, since: datetime, limit: int = 5) -> list[dict]:
    rows = (
        db.query(LLMCallLog.error_type, func.count(LLMCallLog.id).label("cnt"))
        .filter(LLMCallLog.status != LLMCallStatus.SUCCESS, LLMCallLog.created_at >= since)
        .group_by(LLMCallLog.error_type)
        .order_by(func.count(LLMCallLog.id).desc())
        .limit(limit)
        .all()
    )
    return [{"type": r.error_type, "count": r.cnt} for r in rows]


def query_business(db: Session, now: datetime) -> dict:
    """Business-facing daily metrics — Asia/Shanghai natural day.

    注意：``TrainingRecord.start_time`` 是 ``timestamptz`` 列，因此这里用**aware**的
    北京零点；而 ``LLMCallLog.created_at``/``VoiceCallLog.created_at`` 是 naïve-UTC 列，
    对应窗口用 ``cn_day_start``（naïve-UTC）。口径同为"北京自然日"，仅因列类型不同而
    采用不同的 tz 表示形式 —— 不要为了"看起来统一"而把两者改成同一种。
    """
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
    windows = voice_window(db, day_ago, direction="tts")
    tts = windows.get("tts", {})
    return {
        "tts": {
            "calls_24h": tts.get("total", 0),
            "success_rate": tts.get("success_rate", 0.0),
            "error_count_24h": tts.get("error", 0),
            "avg_latency_ms": tts.get("avg_latency_ms", 0),
            "cost_24h": tts.get("cost", 0.0),
        }
    }


def query_voice_budget(db: Session) -> dict:
    cfg = db.query(VoiceConfig).filter(VoiceConfig.is_active == True).first()
    if not cfg:
        return {"monthly_budget": 0, "monthly_cost": 0, "usage_pct": 0}
    month_start = cn_month_start(datetime.now(UTC))
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
    # A public API is constantly probed by port/exploit scanners, which flood 4xx
    # (mostly 404 on non-existent paths: /api/.aws/credentials, /api/v1/fetch,
    # /graphql, /download, …). A raw 4xx ratio is therefore NOT an actionable signal
    # — don't alert on it. Genuine HTTP degradation is covered by the dashboard 5xx
    # counts and the p95 latency check below.
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
