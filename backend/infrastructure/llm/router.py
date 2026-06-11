"""LLM 路由调度器 —— 档案状态驱动 + 简单用途查找"""

import asyncio
import logging
import threading
from datetime import UTC, datetime, timedelta
from typing import Any

from core.config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, DEEPSEEK_MODEL_PRO
from core.datetime_utils import ensure_utc

log = logging.getLogger(__name__)

CIRCUIT_BREAKER_THRESHOLD = 5
RATE_LIMIT_COOLDOWN_SECONDS = 60
DEGRADED_TTL_SECONDS = 300
GLOBAL_DEGRADED_TTL_SECONDS = 30

_env_fallback_available = False
_env_fallback_latency_ms: int | None = None
_env_fallback_error: str | None = None
_env_fallback_stats = {"call_count": 0, "total_tokens": 0, "total_cost": 0.0}
_env_fallback_lock = asyncio.Lock()


async def set_env_fallback_state(available: bool, latency_ms: int | None = None, error: str | None = None):
    async with _env_fallback_lock:
        global _env_fallback_available, _env_fallback_latency_ms, _env_fallback_error
        _env_fallback_available = available
        _env_fallback_latency_ms = latency_ms
        _env_fallback_error = error


async def _update_synthetic_stats(success: bool, tokens: int):
    if success:
        async with _env_fallback_lock:
            _env_fallback_stats["call_count"] += 1
            _env_fallback_stats["total_tokens"] += tokens
            _env_fallback_stats["total_cost"] += 1.5 * tokens / 1_000_000


async def get_env_fallback_state() -> dict:
    async with _env_fallback_lock:
        return {
            "available": _env_fallback_available,
            "label": "环境变量兜底",
            "key_suffix": DEEPSEEK_API_KEY[-4:] if len(DEEPSEEK_API_KEY) >= 4 else "****",
            "base_url": DEEPSEEK_BASE_URL,
            "model_flash": DEEPSEEK_MODEL,
            "model_pro": DEEPSEEK_MODEL_PRO,
            "latency_ms": _env_fallback_latency_ms,
            "error": _env_fallback_error,
            "call_count": _env_fallback_stats["call_count"],
            "total_tokens": _env_fallback_stats["total_tokens"],
            "total_cost": round(_env_fallback_stats["total_cost"], 4),
        }


class _SyntheticConfig:
    def __init__(self, label="", base_url="", model="", raw_key=""):
        self.id = 0
        self.label = label
        self.base_url = base_url
        self.model = model
        self._raw_key = raw_key
        self.purpose = "*"
        self.status = "active"
        self.consecutive_failures = 0
        self.degraded_reason = None
        self.degraded_until = None
        self.price_input_per_1m = 1.0
        self.price_output_per_1m = 2.0
        self.monthly_cost_limit = 0.0
        self.call_count_today = 0
        self.total_tokens_today = 0
        self.total_cost_today = 0.0
        self.monthly_cost_used = 0.0
        self.stats_date = None
        self.stats_month = None
        self.last_used_at = None


class ProfileRouter:
    def __init__(self):
        self._bindings: dict[str, Any] = {}
        self._profiles: dict[int, Any] = {}
        self._global_degraded_until: datetime | None = None
        self._state_lock = threading.Lock()
        self._last_persist_ts: dict[int, float] = {}

    async def load_from_db(self):
        from sqlalchemy.orm import joinedload

        from core.database import SessionLocal
        from models import ApiSecret as AS
        from models import LLMConfig as LC

        db = SessionLocal()
        try:
            now = datetime.now(UTC)
            profiles = db.query(AS).all()
            bindings = db.query(LC).options(joinedload(LC.secret)).all()

            recovered = 0
            for p in profiles:
                if p.status == "degraded" and p.degraded_until:
                    dt = ensure_utc(p.degraded_until)
                    if dt <= now:
                        p.status = "active"
                        p.degraded_reason = None
                        p.degraded_until = None
                        p.consecutive_failures = 0
                        recovered += 1
            if recovered:
                db.commit()

            with self._state_lock:
                self._profiles = {p.id: p for p in profiles}
                self._bindings = {}
                for b in bindings:
                    self._bindings[b.purpose] = b
                self._global_degraded_until = None

            log.debug("ProfileRouter loaded: %d profiles, %d bindings", len(profiles), len(bindings))
        except Exception:
            log.exception("ProfileRouter load failed")
            raise
        finally:
            db.close()

    def select(self, purpose: str):
        now = datetime.now(UTC)

        with self._state_lock:
            if self._global_degraded_until and now < self._global_degraded_until:
                raise RuntimeError("所有档案不可用，全局降级中")

            binding = self._bindings.get(purpose)
            if not binding and purpose != "*":
                binding = self._bindings.get("*")

            if binding and binding.status == "active":
                profile = self._profiles.get(binding.secret_id)
                if profile and profile.status == "active":
                    return binding
                if profile and profile.status == "degraded":
                    if profile.degraded_until and now < profile.degraded_until:
                        pass
                    else:
                        profile.status = "active"
                        profile.degraded_reason = None
                        profile.degraded_until = None
                        profile.consecutive_failures = 0
                        return binding

        from core.config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL

        if DEEPSEEK_API_KEY and DEEPSEEK_API_KEY.startswith("sk-"):
            log.warning("ProfileRouter: 最后防线 — env 兜底 (purpose=%s)", purpose)
            return _SyntheticConfig(
                label="DeepSeek (env)",
                base_url=DEEPSEEK_BASE_URL,
                model=DEEPSEEK_MODEL,
                raw_key=DEEPSEEK_API_KEY,
            )

        with self._state_lock:
            self._global_degraded_until = now + timedelta(seconds=GLOBAL_DEGRADED_TTL_SECONDS)
        raise RuntimeError(f"purpose={purpose} 无可用档案")

    def get_decrypted_key(self, config) -> str:
        if isinstance(config, _SyntheticConfig):
            return config._raw_key
        from .crypto_utils import decrypt_api_key

        profile = self._profiles.get(config.secret_id) if not isinstance(config, _SyntheticConfig) else None
        if profile:
            return decrypt_api_key(profile.encrypted_key)
        return decrypt_api_key(config.secret.encrypted_key)

    async def report_result(self, config, *, success: bool, tokens: int, latency_ms: int, error: str | None):
        if isinstance(config, _SyntheticConfig):
            await _update_synthetic_stats(success, tokens)
            return

        with self._state_lock:
            profile = self._profiles.get(config.secret_id)
            if not profile:
                return

            now = datetime.now(UTC)
            if success:
                profile.consecutive_failures = 0
                if profile.status == "degraded":
                    profile.status = "active"
                    profile.degraded_reason = None
                    profile.degraded_until = None
                self._update_stats(profile, tokens)
            elif error and "429" in error:
                profile.status = "degraded"
                profile.degraded_reason = "rate_limited"
                profile.degraded_until = now + timedelta(seconds=RATE_LIMIT_COOLDOWN_SECONDS)
            else:
                profile.consecutive_failures += 1
                if profile.consecutive_failures >= CIRCUIT_BREAKER_THRESHOLD:
                    profile.status = "degraded"
                    profile.degraded_reason = "consecutive_failures"
                    profile.degraded_until = now + timedelta(seconds=DEGRADED_TTL_SECONDS)

            should_persist = profile.status == "degraded" or profile.call_count_today % 5 == 0

        if should_persist:
            self._persist_stats(profile)

    def _update_stats(self, profile, tokens: int):
        today = datetime.now(UTC).date()
        if profile.stats_date is None or profile.stats_date < today:
            profile.call_count_today = 0
            profile.total_tokens_today = 0
            profile.total_cost_today = float(0)
            profile.stats_date = today

        now_month = (today.year, today.month)
        cached_month = None
        if profile.stats_month:
            parts = profile.stats_month.split("-")
            if len(parts) == 2:
                cached_month = (int(parts[0]), int(parts[1]))
        if cached_month is None or cached_month < now_month:
            profile.monthly_cost_used = float(0)
            profile.stats_month = today.strftime("%Y-%m")

        profile.call_count_today = (profile.call_count_today or 0) + 1
        profile.total_tokens_today = (profile.total_tokens_today or 0) + tokens
        pi = float(profile.price_input_per_1m or 0)
        po = float(profile.price_output_per_1m or 0)
        cost = (pi * 0.7 + po * 0.3) * tokens / 1_000_000
        profile.total_cost_today = float(profile.total_cost_today or 0) + cost
        profile.monthly_cost_used = float(profile.monthly_cost_used or 0) + cost
        profile.last_used_at = datetime.now(UTC)

        limit = float(profile.monthly_cost_limit or 0)
        if limit > 0 and float(profile.monthly_cost_used) >= limit:
            profile.status = "degraded"
            profile.degraded_reason = "cost_exceeded"
            if profile.degraded_until is None:
                next_month = today.replace(day=1)
                if today.month == 12:
                    next_month = next_month.replace(year=today.year + 1, month=1)
                else:
                    next_month = next_month.replace(month=today.month + 1)
                profile.degraded_until = next_month

    @staticmethod
    def _persist_stats(profile):
        from core.database import SessionLocal
        from models import ApiSecret as AS

        db = SessionLocal()
        try:
            db_p = db.query(AS).filter(AS.id == profile.id).first()
            if db_p:
                for field in (
                    "call_count_today",
                    "total_tokens_today",
                    "total_cost_today",
                    "monthly_cost_used",
                    "stats_date",
                    "stats_month",
                    "last_used_at",
                    "status",
                    "degraded_reason",
                    "degraded_until",
                    "consecutive_failures",
                ):
                    setattr(db_p, field, getattr(profile, field))
                db.commit()
        except Exception:
            log.exception("persist_stats failed for secret #%d", profile.id)
            db.rollback()
        finally:
            db.close()

    def degraded_count(self) -> int:
        with self._state_lock:
            return sum(1 for p in self._profiles.values() if getattr(p, "status", "active") == "degraded")

    @property
    def global_degraded(self) -> bool:
        with self._state_lock:
            if not self._global_degraded_until:
                return False
            return datetime.now(UTC) < self._global_degraded_until
