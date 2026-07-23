"""Cost dashboard + usage stats business logic."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from core.exceptions import ValidationError
from models import ApiSecret, LLMCallLog, User, VoiceCallLog, VoiceConfig
from repositories.voice_log import VoiceCallLogRepository
from schemas.voice import (
    CostBreakdown,
    CostDashboardResponse,
    CostSeriesPoint,
    VoiceUsageItem,
    VoiceUsageResponse,
)

_LOCAL_TZ = "Asia/Shanghai"


def _local_ts(col):
    """将 naive-UTC 时间列转为北京时区（先标记 UTC 再转 Asia/Shanghai）。"""
    return func.timezone(_LOCAL_TZ, func.timezone("UTC", col))


def _local_date(col):
    """按北京时区对时间列取 date，用于日/月成本分桶（修正跨零点错位）。"""
    return func.date(_local_ts(col))


class CostService:
    def __init__(self, db: Session):
        self.db = db
        self.voice_repo = VoiceCallLogRepository(db)

    def _voice_usage(self, direction: str, since: datetime) -> VoiceUsageItem:
        total = self.voice_repo.count_direction_since(direction, since)
        success = self.voice_repo.count_status_since(direction, "success", since)
        fallback = self.voice_repo.count_status_since(direction, "fallback", since)
        error_count = self.voice_repo.count_status_since(direction, "error", since)
        total_chars = self.voice_repo.sum_field_since(VoiceCallLog.text_length, direction, since)
        total_latency = self.voice_repo.sum_field_since(VoiceCallLog.latency_ms, direction, since)
        cost = self.voice_repo.sum_field_since(VoiceCallLog.cost_estimated, direction, since)
        return VoiceUsageItem(
            calls_total=total,
            calls_success=success,
            calls_fallback=fallback,
            calls_error=error_count,
            total_chars=int(total_chars),
            total_latency_ms=int(total_latency),
            cost_estimated=round(float(cost), 6),
        )

    def get_usage(self) -> VoiceUsageResponse:
        now = datetime.now(UTC)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        month_start = today_start.replace(day=1)
        vc = self.db.query(VoiceConfig).filter(VoiceConfig.is_active == True).first()
        monthly_budget = vc.monthly_budget if vc else 0.0
        month_tts = self._voice_usage("tts", month_start)
        month_asr = self._voice_usage("asr", month_start)
        return VoiceUsageResponse(
            tts_today=self._voice_usage("tts", today_start),
            asr_today=self._voice_usage("asr", today_start),
            tts_month=month_tts,
            asr_month=month_asr,
            monthly_budget=monthly_budget,
            monthly_used=round(month_tts.cost_estimated + month_asr.cost_estimated, 6),
        )

    def _build_breakdown(
        self, total: int, success: int, error_count: int, avg_latency: float, total_cost: float
    ) -> CostBreakdown:
        return CostBreakdown(
            calls=total,
            success=success,
            error=error_count,
            latency_ms_avg=round(avg_latency or 0, 1),
            total_cost=round(total_cost or 0, 6),
        )

    def _llm_stats(self, since: datetime) -> tuple:
        base = self.db.query(LLMCallLog).filter(LLMCallLog.created_at >= since)
        total = base.count()
        success = base.filter(LLMCallLog.status == "success").count()
        error_count = base.filter(LLMCallLog.status == "error").count()
        avg_latency = self.db.query(func.avg(LLMCallLog.latency_ms)).filter(LLMCallLog.created_at >= since).scalar()
        total_cost = (
            self.db.query(func.sum(LLMCallLog.estimated_cost))
            .filter(LLMCallLog.created_at >= since, LLMCallLog.status == "success")
            .scalar()
        )
        return total, success, error_count, float(avg_latency or 0), float(total_cost or 0)

    def _voice_stats(self, since: datetime) -> tuple:
        total = self.voice_repo.count_since(since)
        success = self.voice_repo.status_count_since("success", since)
        error_count = self.voice_repo.status_count_since("error", since)
        avg_latency = self.voice_repo.avg_field_since(VoiceCallLog.latency_ms, since)
        total_cost = self.voice_repo.sum_field_all_since(VoiceCallLog.cost_estimated, since)
        return total, success, error_count, avg_latency, total_cost

    def _voice_stats_direction(self, since: datetime, direction: str) -> tuple:
        total = self.voice_repo.count_direction_since(direction, since)
        success = self.voice_repo.count_status_since(direction, "success", since)
        error_count = self.voice_repo.count_status_since(direction, "error", since)
        avg_latency = self.voice_repo.avg_field_direction_since(VoiceCallLog.latency_ms, direction, since)
        total_cost = self.voice_repo.sum_field_since(VoiceCallLog.cost_estimated, direction, since)
        return total, success, error_count, avg_latency, total_cost

    def _daily_series(self, days: int = 30) -> list[CostSeriesPoint]:
        now = datetime.now(UTC)
        since = now - timedelta(days=days - 1)
        llm_rows = (
            self.db.query(
                _local_date(LLMCallLog.created_at).label("date"),
                func.coalesce(func.sum(LLMCallLog.estimated_cost), 0).label("llm_cost"),
            )
            .filter(LLMCallLog.created_at >= since, LLMCallLog.status == "success")
            .group_by("date")
            .all()
        )
        llm_map = {str(r[0]): float(r[1]) for r in llm_rows}
        tts_rows = (
            self.db.query(
                _local_date(VoiceCallLog.created_at).label("date"),
                func.coalesce(func.sum(VoiceCallLog.cost_estimated).filter(VoiceCallLog.direction == "tts"), 0).label(
                    "tts_cost"
                ),
            )
            .filter(VoiceCallLog.created_at >= since)
            .group_by("date")
            .all()
        )
        tts_map = {str(r[0]): float(r[1]) for r in tts_rows}
        asr_rows = (
            self.db.query(
                _local_date(VoiceCallLog.created_at).label("date"),
                func.coalesce(func.sum(VoiceCallLog.cost_estimated).filter(VoiceCallLog.direction == "asr"), 0).label(
                    "asr_cost"
                ),
            )
            .filter(VoiceCallLog.created_at >= since)
            .group_by("date")
            .all()
        )
        asr_map = {str(r[0]): float(r[1]) for r in asr_rows}
        series = []
        for i in range(days - 1, -1, -1):
            d = now - timedelta(days=i)
            date_str = d.strftime("%Y-%m-%d")
            series.append(
                CostSeriesPoint(
                    date=date_str,
                    llm_cost=llm_map.get(date_str, 0.0),
                    tts_cost=tts_map.get(date_str, 0.0),
                    asr_cost=asr_map.get(date_str, 0.0),
                )
            )
        return series

    def get_dashboard(self) -> CostDashboardResponse:
        now = datetime.now(UTC)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        month_start = today_start.replace(day=1)

        vc = self.db.query(VoiceConfig).filter(VoiceConfig.is_active == True).first()
        voice_budget = vc.monthly_budget if vc else 0.0

        llm_budget = round(
            float(
                self.db.query(func.coalesce(func.sum(ApiSecret.monthly_cost_limit), 0))
                .filter(ApiSecret.status == "active")
                .scalar()
                or 0.0
            ),
            6,
        )

        llm_today = self._llm_stats(today_start)
        voice_today = self._voice_stats(today_start)
        today_total = llm_today[0] + voice_today[0]
        today_latency = (
            ((float(llm_today[3]) * llm_today[0] + float(voice_today[3]) * voice_today[0]) / today_total) if today_total > 0 else 0.0
        )

        voice_tts_today = self._voice_stats_direction(today_start, "tts")
        voice_asr_today = self._voice_stats_direction(today_start, "asr")

        llm_month = self._llm_stats(month_start)
        voice_month = self._voice_stats(month_start)
        month_total = llm_month[0] + voice_month[0]
        month_latency = (
            ((float(llm_month[3]) * llm_month[0] + float(voice_month[3]) * voice_month[0]) / month_total) if month_total > 0 else 0.0
        )

        top_llm = (
            self.db.query(
                User.display_name.label("user_name"),
                User.id.label("user_id"),
                func.sum(LLMCallLog.estimated_cost).label("llm_cost"),
                func.count(LLMCallLog.id).label("llm_calls"),
            )
            .join(LLMCallLog, LLMCallLog.user_id == User.id)
            .filter(
                LLMCallLog.created_at >= month_start,
            )
            .group_by(User.id, User.display_name)
            .all()
        )

        top_voice = (
            self.db.query(
                User.display_name.label("user_name"),
                User.id.label("user_id"),
                func.sum(VoiceCallLog.cost_estimated).label("voice_cost"),
                func.count(VoiceCallLog.id).label("voice_calls"),
            )
            .join(VoiceCallLog, VoiceCallLog.user_id == User.id)
            .filter(
                VoiceCallLog.created_at >= month_start,
            )
            .group_by(User.id, User.display_name)
            .all()
        )

        user_costs: dict[int, dict] = {}
        for r in top_llm:
            uid = r[1]
            user_costs[uid] = {"user_name": r[0] or "未知", "total_cost": float(r[2] or 0), "calls": int(r[3] or 0)}
        for r in top_voice:
            uid = r[1]
            if uid in user_costs:
                user_costs[uid]["total_cost"] += float(r[2] or 0)
                user_costs[uid]["calls"] += int(r[3] or 0)
            else:
                user_costs[uid] = {"user_name": r[0] or "未知", "total_cost": float(r[2] or 0), "calls": int(r[3] or 0)}

        top_users = sorted(
            [
                {"user_name": v["user_name"], "total_cost": round(v["total_cost"], 6), "calls": v["calls"]}
                for v in user_costs.values()
            ],
            key=lambda x: x["total_cost"],
            reverse=True,
        )[:10]

        return CostDashboardResponse(
            today=self._build_breakdown(
                today_total,
                llm_today[1] + voice_today[1],
                llm_today[2] + voice_today[2],
                today_latency,
                round(llm_today[4] + voice_today[4], 6),
            ),
            this_month=self._build_breakdown(
                month_total,
                llm_month[1] + voice_month[1],
                llm_month[2] + voice_month[2],
                month_latency,
                round(llm_month[4] + voice_month[4], 6),
            ),
            llm_today=self._build_breakdown(*llm_today),
            tts_today=self._build_breakdown(*voice_tts_today),
            asr_today=self._build_breakdown(*voice_asr_today),
            monthly_budget=round(voice_budget + llm_budget, 6),
            monthly_used=round(llm_month[4] + voice_month[4], 6),
            llm_monthly_budget=llm_budget,
            voice_monthly_budget=voice_budget,
            daily_series=self._daily_series(30),
            top_users=top_users,
        )

    def get_user_breakdown(self, month_start: datetime | None = None, limit: int = 50) -> list[dict]:
        since = month_start or datetime.now(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        rows = (
            self.db.query(
                User.id.label("user_id"),
                User.display_name.label("user_name"),
                LLMCallLog.purpose,
                func.count(LLMCallLog.id).label("calls"),
                func.sum(LLMCallLog.prompt_tokens).label("input_tokens"),
                func.sum(LLMCallLog.completion_tokens).label("output_tokens"),
                func.sum(LLMCallLog.estimated_cost).label("cost"),
            )
            .join(LLMCallLog, LLMCallLog.user_id == User.id)
            .filter(LLMCallLog.created_at >= since)
            .group_by(User.id, User.display_name, LLMCallLog.purpose)
            .order_by(func.sum(LLMCallLog.estimated_cost).desc())
            .all()
        )

        user_map: dict[int, dict] = {}
        for r in rows:
            uid = r.user_id
            if uid not in user_map:
                user_map[uid] = {
                    "user_id": uid,
                    "user_name": r.user_name or "未知",
                    "total_cost": 0.0,
                    "total_calls": 0,
                    "purposes": {},
                }
            user_map[uid]["total_cost"] += float(r.cost or 0)
            user_map[uid]["total_calls"] += int(r.calls or 0)
            user_map[uid]["purposes"][r.purpose] = {
                "calls": int(r.calls or 0),
                "input_tokens": int(r.input_tokens or 0),
                "output_tokens": int(r.output_tokens or 0),
                "cost": round(float(r.cost or 0), 6),
            }

        return sorted(
            user_map.values(),
            key=lambda x: x["total_cost"],
            reverse=True,
        )[:limit]

    def export_data(self, start_date: str, end_date: str, service: str, granularity: str) -> list[dict]:
        now = datetime.now(UTC)
        since = self._parse_date(start_date) if start_date else now - timedelta(days=30)
        until = (self._parse_date(end_date) + timedelta(days=1)) if end_date else now
        rows: list[dict] = []

        date_group = (
            func.date_trunc("month", _local_ts(LLMCallLog.created_at))
            if granularity == "monthly"
            else _local_date(LLMCallLog.created_at)
        )

        include_llm = not service or service == "llm"
        include_voice = not service or service in ("tts", "asr")

        if include_llm:
            for r in (
                self.db.query(
                    date_group.label("date"),
                    func.coalesce(
                        func.sum(case((LLMCallLog.status == "success", LLMCallLog.estimated_cost), else_=0)), 0
                    ).label("cost"),
                    func.count().label("calls"),
                    func.sum(func.cast(LLMCallLog.status == "success", type_=int)).label("success"),
                    func.sum(func.cast(LLMCallLog.status != "success", type_=int)).label("error"),
                )
                .filter(LLMCallLog.created_at >= since, LLMCallLog.created_at < until)
                .group_by("date")
                .order_by("date")
                .all()
            ):
                rows.append(
                    {
                        "date": str(r[0]),
                        "service": "llm",
                        "cost": round(float(r[1] or 0), 6),
                        "calls": r[2],
                        "success": r[3] or 0,
                        "error": r[4] or 0,
                    }
                )

        if include_voice:
            voice_date_group = (
                func.date_trunc("month", _local_ts(VoiceCallLog.created_at))
                if granularity == "monthly"
                else _local_date(VoiceCallLog.created_at)
            )
            for direction in [service] if service in ("tts", "asr") else ["tts", "asr"]:
                for r in (
                    self.db.query(
                        voice_date_group.label("date"),
                        func.coalesce(func.sum(VoiceCallLog.cost_estimated), 0).label("cost"),
                        func.count().label("calls"),
                        func.sum(func.cast(VoiceCallLog.status == "success", type_=int)).label("success"),
                        func.sum(func.cast(VoiceCallLog.status != "success", type_=int)).label("error"),
                    )
                    .filter(
                        VoiceCallLog.direction == direction,
                        VoiceCallLog.created_at >= since,
                        VoiceCallLog.created_at < until,
                    )
                    .group_by("date")
                    .order_by("date")
                    .all()
                ):
                    rows.append(
                        {
                            "date": str(r[0]),
                            "service": direction,
                            "cost": round(float(r[1] or 0), 6),
                            "calls": r[2],
                            "success": r[3] or 0,
                            "error": r[4] or 0,
                        }
                    )

        rows.sort(key=lambda x: x["date"])
        return rows

    @staticmethod
    def _parse_date(d: str) -> datetime:
        try:
            return datetime.strptime(d, "%Y-%m-%d").replace(tzinfo=UTC)
        except (ValueError, TypeError):
            raise ValidationError(f"无效的日期格式: {d}，请使用 YYYY-MM-DD 格式")
