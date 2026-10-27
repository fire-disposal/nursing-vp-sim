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

import logging
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import case, func, text
from sqlalchemy.orm import Query, Session

from core.audit import ACTION_SCENARIO_RATE_LIMITED
from core.exceptions import ValidationError
from core.statuses import LLMCallStatus
from models import LLMCallLog, School, TrainingRecord, User, VoiceCallLog, VoiceConfig
from models.audit import AuditLog
from models.scenario_training import StEvent, StSession

log = logging.getLogger(__name__)

# 情境训练的 LLM purpose（agent 运行时：一个回合内模型可能多步调用工具，都走 `st_dm`）。
# 权威定义在 ``modules/scenario_training/agent/runner.py`` 与 ``infra/llm/profile.py`` 的 ``PROFILES``；
# 这里不反向 import feature 模块，故复写这个冻结字面量（改名时必须两处一起改）。
# 已废弃：两阶段时代的 ``st_intent``（意图解析）与独立患者实体的 ``st_patient``，都不再写入。
SCENARIO_LLM_PURPOSES: tuple[str, ...] = ("st_dm",)

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


# ── 成本归因（唯一实现）─────────────────────────────────────────────

#: 无法归因到院校的行在 ``by_school`` 拆分里的桶名（``school_id`` 为 ``None``）。
UNATTRIBUTED_SCHOOL_NAME = "未归属"


def scope_by_school(query: Query, log_model: type[LLMCallLog] | type[VoiceCallLog], school_id: int | None) -> Query:
    """把调用日志按 ``log.user_id → users.school_id`` 收窄到某个院校。

    ``school_id is None`` = 跨院校（平台角色）：不加任何过滤，``user_id`` 为空或用户无院校
    （平台角色自身的调用）的行必须留在总数里，否则平台账本对不上账单。
    院校视图一律 ``INNER JOIN``：归因不到本校的行既不是本校花的钱，也不该出现在本校报表里，
    抛进本校的“未归属”桶等于把平台开销摊给院校。
    """
    if school_id is None:
        return query
    return query.join(User, User.id == log_model.user_id).filter(User.school_id == school_id)


def llm_window(
    db: Session, since: datetime | None, until: datetime | None = None, *, school_id: int | None = None
) -> dict:
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
    q = scope_by_school(q, LLMCallLog, school_id)
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
    *,
    school_id: int | None = None,
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
    q = scope_by_school(q, VoiceCallLog, school_id)
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


def cost_by_school(db: Session, since: datetime | None, until: datetime | None = None) -> list[dict]:
    """按院校拆分的成本账：LLM 成本 / 语音成本 / 调用数。

    归因链路 ``*.user_id → users.school_id``（唯一实现，调用方不要再自己 join users）。
    归因不到院校的行——``user_id`` 为空、用户是平台角色（``school_id`` 为空）、用户已被删除
    ——聚成一个 ``school_id=None`` 的“未归属”桶：宁可多一个桶，也不能让这些开销从平台总账
    里消失。金额口径与 :func:`llm_window` / :func:`voice_window` 一致（LLM 只算成功调用，
    语音算 ``cost_estimated`` 全量），否则各校之和会对不上 dashboard 总数。
    """
    buckets: dict[int | None, dict] = {}

    def bucket(school_id: int | None, school_name: str | None) -> dict:
        if school_id not in buckets:
            if school_name:
                name = school_name
            elif school_id is None:
                name = UNATTRIBUTED_SCHOOL_NAME
            else:
                # 院校行已被删除但日志还在：保留桶，别把钱丢了。
                name = f"院校#{school_id}"
            buckets[school_id] = {
                "school_id": school_id,
                "school_name": name,
                "llm_cost": 0.0,
                "llm_calls": 0,
                "voice_cost": 0.0,
                "voice_calls": 0,
            }
        return buckets[school_id]

    def windowed(query: Query, log_model: type[LLMCallLog] | type[VoiceCallLog]) -> Query:
        if since is not None:
            query = query.filter(log_model.created_at >= since)
        if until is not None:
            query = query.filter(log_model.created_at < until)
        return query

    llm_rows = windowed(
        db.query(
            User.school_id.label("school_id"),
            School.name.label("school_name"),
            func.count(LLMCallLog.id).label("calls"),
            func.coalesce(
                func.sum(case((LLMCallLog.status == LLMCallStatus.SUCCESS, LLMCallLog.estimated_cost), else_=0)), 0
            ).label("cost"),
        )
        .select_from(LLMCallLog)
        # outer：``user_id`` 为空（系统任务）不能因为 drop row 就从账本里消失。
        .outerjoin(User, User.id == LLMCallLog.user_id)
        .outerjoin(School, School.id == User.school_id),
        LLMCallLog,
    ).group_by(User.school_id, School.name)
    for r in llm_rows.all():
        b = bucket(r.school_id, r.school_name)
        b["llm_cost"] = float(r.cost or 0)
        b["llm_calls"] = int(r.calls or 0)

    voice_rows = windowed(
        db.query(
            User.school_id.label("school_id"),
            School.name.label("school_name"),
            func.count(VoiceCallLog.id).label("calls"),
            func.coalesce(func.sum(VoiceCallLog.cost_estimated), 0).label("cost"),
        )
        .select_from(VoiceCallLog)
        .outerjoin(User, User.id == VoiceCallLog.user_id)
        .outerjoin(School, School.id == User.school_id),
        VoiceCallLog,
    ).group_by(User.school_id, School.name)
    for r in voice_rows.all():
        b = bucket(r.school_id, r.school_name)
        b["voice_cost"] = float(r.cost or 0)
        b["voice_calls"] = int(r.calls or 0)

    items = []
    for b in buckets.values():
        total_cost = round(b["llm_cost"] + b["voice_cost"], 6)
        items.append(
            {
                **b,
                "llm_cost": round(b["llm_cost"], 6),
                "voice_cost": round(b["voice_cost"], 6),
                "total_cost": total_cost,
                "calls": b["llm_calls"] + b["voice_calls"],
            }
        )
    # 院校按花费降序；“未归属”永远垫底，它不是一所学校。
    items.sort(key=lambda x: (x["school_id"] is None, -x["total_cost"]))
    return items


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


def query_scenario(db: Session, day_ago: datetime) -> dict:
    """情境训练（`st_*`）的 24h 观察面 + 即时会话数（docs/scenario.md 唯一回合管线口径）。

    只读、只聚合，不触碰老系统的任何表；`st_*` 表在功能未上线/未加迁移的环境可能不存在
    → 调用方（`build_dashboard`）负责降级，这里只管查询。

    事件口径（新机制只写 `session_opened` / `turn_committed` / `clarification_exchange` /
    `hint_requested` / `session_closed` 五种 kind）：

    - `requests_24h` / `time_cost_24h` / `model_calls_24h`：分子都只取 `turn_committed`
      （= 已提交的业务回合）。`time_cost_24h` = 窗口内这些回合推进的**情境时间单位总和**
      （载荷 `time_cost` 是本请求消耗的时间单位，0 = 没花时间；机制切换前的事件没有该键 → 记 0）。
      它不是请求数、不是分钟。`model_calls_24h` 取该回合记录的 `models.calls`（agent 运行时一个回合
      可能调用模型多步）；历史事件用的是 `models.parse + models.delivery` 两阶段口径，两者都认，
      不静默记 0。
    - `avg_time_cost_per_request_24h` / `avg_model_calls_per_request_24h`：分子分母
      **同群体同窗口**（都只数 `turn_committed`）；请求数为 0 时给 `null`，不给 0。
      `avg_time_cost_per_request_24h` 读作「平均每个已提交请求推进的时间单位」。
    - `clarifications_24h` / `hints_24h`：`clarification_exchange` / `hint_requested` 的次数
      ——它们**不推进情境时间**，故与 `requests_24h` 分列。
    - `llm_failures_24h`：情境 agent 运行时（`st_dm`）在 `llm_call_logs` 里窗口内
      `status != success` 的调用数——失败没有世界事件，只有日志来源，故不取 `st_events`。
    - `active` / `completed`：即时状态计数（见块上的 `state_window`），不受 24h 窗口影响。
    - `rate_limited_24h`：`audit_logs` 里 `scenario.rate_limited` 的行数（见
      `core/rate_limits._scenario_limited`）——多 worker 安全的唯一取数来源。
    """
    opened_24h = db.query(func.count(StSession.id)).filter(StSession.created_at >= day_ago).scalar() or 0
    active = db.query(func.count(StSession.id)).filter(StSession.status == "active").scalar() or 0
    completed = db.query(func.count(StSession.id)).filter(StSession.status == "completed").scalar() or 0

    turns = db.execute(
        text(
            """
            SELECT
                count(*) AS requests,
                coalesce(sum(coalesce((payload ->> 'time_cost')::int, 0)), 0) AS time_cost,
                coalesce(sum(
                    coalesce((payload -> 'models' ->> 'calls')::int,
                             coalesce((payload -> 'models' ->> 'parse')::int, 0)
                           + coalesce((payload -> 'models' ->> 'delivery')::int, 0))
                ), 0) AS model_calls
              FROM st_events
             WHERE kind = 'turn_committed' AND created_at >= :since
            """
        ),
        {"since": day_ago},
    ).one()

    llm_failures_24h = (
        db.query(func.count(LLMCallLog.id))
        .filter(
            LLMCallLog.purpose.in_(SCENARIO_LLM_PURPOSES),
            LLMCallLog.status != LLMCallStatus.SUCCESS,
            LLMCallLog.created_at >= day_ago,
        )
        .scalar()
        or 0
    )

    clarifications_24h = (
        db.query(func.count(StEvent.id))
        .filter(StEvent.kind == "clarification_exchange", StEvent.created_at >= day_ago)
        .scalar()
        or 0
    )
    hints_24h = (
        db.query(func.count(StEvent.id))
        .filter(StEvent.kind == "hint_requested", StEvent.created_at >= day_ago)
        .scalar()
        or 0
    )
    rate_limited_24h = (
        db.query(func.count(AuditLog.id))
        .filter(AuditLog.action == ACTION_SCENARIO_RATE_LIMITED, AuditLog.created_at >= day_ago)
        .scalar()
        or 0
    )

    requests_24h = int(turns.requests or 0)
    time_cost_24h = int(turns.time_cost or 0)
    model_calls_24h = int(turns.model_calls or 0)
    return {
        "opened_24h": int(opened_24h),
        "active": int(active),
        "completed": int(completed),
        "requests_24h": requests_24h,
        "time_cost_24h": time_cost_24h,
        "avg_time_cost_per_request_24h": round(time_cost_24h / requests_24h, 2) if requests_24h else None,
        "model_calls_24h": model_calls_24h,
        "avg_model_calls_per_request_24h": round(model_calls_24h / requests_24h, 2) if requests_24h else None,
        "clarifications_24h": int(clarifications_24h),
        "hints_24h": int(hints_24h),
        "llm_failures_24h": int(llm_failures_24h),
        "rate_limited_24h": int(rate_limited_24h),
    }


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


def query_jobs(db: Session, now: datetime | None = None) -> dict:
    """持久化 Job 的即时状态（scope=db / window=now）。

    为什么必须在这一层可见：`SCORING_EXECUTION=job` 时评分不再走进程内 TaskQueue，
    `metrics.queue.task_queue` 恒为 0 —— 队列可见性必须由这里提供，否则切到 job 模式后
    运维面就"看不见评分是否在跑"。字段只取可行动信息：各状态计数、最老 pending 等待秒数、
    租约已过期（执行者消失但尚未被重领）的条数。
    """
    if now is None:
        now = datetime.now(UTC)
    rows = db.execute(
        text(
            """
            SELECT kind, status, count(*) AS n,
                   coalesce(max(extract(epoch FROM :now_ts - available_at))
                            FILTER (WHERE status = 'pending'), 0) AS oldest_pending_s,
                   count(*) FILTER (WHERE status = 'running' AND lease_expires_at < :now_ts) AS expired_leases
              FROM jobs
             GROUP BY kind, status
            """
        ),
        {"now_ts": now},
    ).all()

    by_kind: dict[str, dict[str, int]] = {}
    oldest_pending = 0
    expired = 0
    for row in rows:
        bucket = by_kind.setdefault(row.kind, {})
        bucket[row.status] = int(row.n)
        oldest_pending = max(oldest_pending, int(row.oldest_pending_s or 0))
        expired += int(row.expired_leases or 0)

    # 没有行时也要给出确定的形状，消费方（看板/冒烟）不必判空
    by_kind.setdefault("scoring", {})
    return {
        "by_kind": by_kind,
        "oldest_pending_seconds": oldest_pending,
        "expired_leases": expired,
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
    jobs = query_jobs(db, now)

    return {
        "time": now.isoformat(),
        "jobs": jobs,
        "llm": {
            "total_calls_24h": llm["total"],
            "success_rate": round(llm["success"] / max(llm["total"], 1) * 100, 1),
            "error_count_24h": llm["error"],
            "avg_latency_ms": llm["avg_latency_ms"],
            "recent_errors": errors,
        },
        "scoring": scoring,
        "sessions": {"active": active},
        "scenario": query_scenario_safe(db, day_ago),
        "voice": voice,
        "voice_budget": voice_budget,
        "business": business,
    }


def query_scenario_safe(db: Session, day_ago: datetime) -> dict:
    """`query_scenario` 的降级外壳：`st_*` 表缺失（未跑迁移的环境）与其他查询失败
    都只告警并返回确定的零值形状 —— 情境训练是**附加轨道**，它的查询失败不得让
    整个诊断/看板端点倒下（老系统的可见性优先）。
    """
    try:
        return query_scenario(db, day_ago)
    except Exception:
        log.warning("scenario diagnostics unavailable", exc_info=True)
        return {
            "opened_24h": 0,
            "active": 0,
            "completed": 0,
            "requests_24h": 0,
            "time_cost_24h": 0,
            "avg_time_cost_per_request_24h": None,
            "model_calls_24h": 0,
            "avg_model_calls_per_request_24h": None,
            "clarifications_24h": 0,
            "hints_24h": 0,
            "llm_failures_24h": 0,
            "rate_limited_24h": 0,
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

    # ── 后端 ERROR 日志短窗口突发（workers 口径：档案 + 未落盘增量，按事件时间计）──
    if error_burst > 5:
        alerts.append(f"后端 ERROR 日志 5 分钟突发 {error_burst} 次")

    # ── HTTP/API surface ──
    # A public API is constantly probed by port/exploit scanners, which flood 4xx
    # (mostly 404 on non-existent paths: /api/.aws/credentials, /api/v1/fetch,
    # /graphql, /download, …). A raw 4xx ratio is therefore NOT an actionable signal
    # — don't alert on it. Genuine HTTP degradation is covered by the dashboard 5xx
    # counts and the p95 latency check below.
    http_latency = http.get("latency_ms") or {}
    if http_latency.get("p95", 0) > 2000:
        alerts.append(f"HTTP p95 延迟 {http_latency['p95']}ms 偏高（本进程 since_start）")

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
