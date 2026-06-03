"""LLM 路由调度器 —— 档案状态驱动 + 简单用途查找"""
import asyncio
import logging
import time
from datetime import datetime, timezone, timedelta

_logger = logging.getLogger(__name__)

CIRCUIT_BREAKER_THRESHOLD = 5
RATE_LIMIT_COOLDOWN_SECONDS = 60
DEGRADED_TTL_SECONDS = 300
GLOBAL_DEGRADED_TTL_SECONDS = 30

_env_fallback_available = False
_env_fallback_latency_ms: int | None = None
_env_fallback_error: str | None = None


def set_env_fallback_state(available: bool, latency_ms: int | None = None, error: str | None = None):
    global _env_fallback_available, _env_fallback_latency_ms, _env_fallback_error
    _env_fallback_available = available
    _env_fallback_latency_ms = latency_ms
    _env_fallback_error = error


def get_env_fallback_state() -> dict:
    from config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, DEEPSEEK_MODEL_PRO
    return {
        "available": _env_fallback_available,
        "label": "环境变量兜底",
        "key_suffix": DEEPSEEK_API_KEY[-4:] if len(DEEPSEEK_API_KEY) >= 4 else "****",
        "base_url": DEEPSEEK_BASE_URL,
        "model_flash": DEEPSEEK_MODEL,
        "model_pro": DEEPSEEK_MODEL_PRO,
        "latency_ms": _env_fallback_latency_ms,
        "error": _env_fallback_error,
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
        self._bindings: dict[str, object] = {}
        self._profiles: dict[int, object] = {}
        self._global_degraded_until: datetime | None = None
        self._state_lock = asyncio.Lock()
        self._last_persist_ts: dict[int, float] = {}

    async def load_from_db(self):
        from database import SessionLocal
        from models import LLMConfig as LC, ApiSecret as AS
        from sqlalchemy.orm import joinedload

        db = SessionLocal()
        try:
            now = datetime.now(timezone.utc)
            profiles = db.query(AS).all()
            bindings = db.query(LC).options(joinedload(LC.secret)).all()

            recovered = 0
            for p in profiles:
                if p.status == "degraded" and p.degraded_until and p.degraded_until <= now:
                    p.status = "active"
                    p.degraded_reason = None
                    p.degraded_until = None
                    p.consecutive_failures = 0
                    recovered += 1
            if recovered:
                db.commit()

            async with self._state_lock:
                self._profiles = {p.id: p for p in profiles}
                self._bindings = {}
                for b in bindings:
                    self._bindings.setdefault(b.purpose, b)
                self._global_degraded_until = None

            _logger.info("ProfileRouter loaded: %d profiles, %d bindings", len(profiles), len(bindings))
        except Exception:
            _logger.exception("ProfileRouter load failed")
            raise
        finally:
            db.close()

    def select(self, purpose: str):
        now = datetime.now(timezone.utc)

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

        from config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, DEEPSEEK_MODEL_PRO
        if DEEPSEEK_API_KEY and DEEPSEEK_API_KEY.startswith("sk-"):
            _logger.warning("ProfileRouter: 最后防线 — env 兜底 (purpose=%s)", purpose)
            return _SyntheticConfig(
                label="DeepSeek (env)", base_url=DEEPSEEK_BASE_URL,
                model=DEEPSEEK_MODEL_PRO if purpose == "scoring" else DEEPSEEK_MODEL,
                raw_key=DEEPSEEK_API_KEY,
            )

        self._global_degraded_until = now + timedelta(seconds=GLOBAL_DEGRADED_TTL_SECONDS)
        raise RuntimeError(f"purpose={purpose} 无可用档案")

    def get_decrypted_key(self, config) -> str:
        if isinstance(config, _SyntheticConfig):
            return config._raw_key
        from services.crypto_utils import decrypt_api_key
        profile = self._profiles.get(config.secret_id) if not isinstance(config, _SyntheticConfig) else None
        if profile:
            return decrypt_api_key(profile.encrypted_key)
        return decrypt_api_key(config.secret.encrypted_key)

    def report_result(self, config, *, success: bool, tokens: int, latency_ms: int, error: str | None):
        if isinstance(config, _SyntheticConfig):
            return

        profile = self._profiles.get(config.secret_id)
        if not profile:
            return

        now = datetime.now(timezone.utc)
        if success:
            profile.consecutive_failures = 0
            if profile.status == "degraded":
                profile.status = "active"
                profile.degraded_reason = None
                profile.degraded_until = None
            self._update_stats(profile, tokens)
        else:
            if error and "429" in error:
                profile.status = "degraded"
                profile.degraded_reason = "rate_limited"
                profile.degraded_until = now + timedelta(seconds=RATE_LIMIT_COOLDOWN_SECONDS)
            else:
                profile.consecutive_failures += 1
                if profile.consecutive_failures >= CIRCUIT_BREAKER_THRESHOLD:
                    profile.status = "degraded"
                    profile.degraded_reason = "consecutive_failures"
                    profile.degraded_until = now + timedelta(seconds=DEGRADED_TTL_SECONDS)

        if profile.status == "degraded" or profile.call_count_today % 5 == 0:
            self._persist_stats(profile)

    def _update_stats(self, profile, tokens: int):
        today = datetime.now(timezone.utc).date()
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
        avg_price = (float(profile.price_input_per_1m or 0) + float(profile.price_output_per_1m or 0)) / 2
        cost = avg_price * tokens / 1_000_000
        profile.total_cost_today = float(profile.total_cost_today or 0) + cost
        profile.monthly_cost_used = float(profile.monthly_cost_used or 0) + cost
        profile.last_used_at = datetime.now(timezone.utc)

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
        from database import SessionLocal
        from models import ApiSecret as AS
        db = SessionLocal()
        try:
            db_p = db.query(AS).filter(AS.id == profile.id).first()
            if db_p:
                for field in ("call_count_today", "total_tokens_today", "total_cost_today",
                              "monthly_cost_used", "stats_date", "stats_month", "last_used_at",
                              "status", "degraded_reason", "degraded_until", "consecutive_failures"):
                    setattr(db_p, field, getattr(profile, field))
                db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()


_router: ProfileRouter | None = None
_router_lock = asyncio.Lock()


async def get_router() -> ProfileRouter:
    global _router
    if _router is not None:
        return _router
    async with _router_lock:
        if _router is None:
            _router = ProfileRouter()
            await _router.load_from_db()
    return _router


async def refresh_router():
    global _router
    if _router is None:
        _router = ProfileRouter()
    await _router.load_from_db()
