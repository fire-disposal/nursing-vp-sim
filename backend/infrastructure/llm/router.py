"""LLM 路由调度器 —— 档案状态驱动 + 简单用途查找"""

import asyncio
import logging
import threading
import time as _time
from datetime import UTC, datetime, timedelta
from typing import Any

from core.config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL
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

# env 兜底熔断状态（死密钥/限流时停止无谓重试）。
# 写于 async report_result，读于 sync select()；datetime 赋值在 CPython 下原子，容忍轻微 stale。
_env_fallback_consecutive_failures = 0
_env_fallback_degraded_until: datetime | None = None
_env_fallback_degraded_reason: str | None = None


async def _record_synthetic_result(
    success: bool, error: str | None, prompt_tokens: int, completion_tokens: int
) -> None:
    global _env_fallback_consecutive_failures, _env_fallback_degraded_until, _env_fallback_degraded_reason
    async with _env_fallback_lock:
        if success:
            _env_fallback_consecutive_failures = 0
            _env_fallback_degraded_until = None
            _env_fallback_degraded_reason = None
            total = prompt_tokens + completion_tokens
            _env_fallback_stats["call_count"] += 1
            _env_fallback_stats["total_tokens"] += total
            _env_fallback_stats["total_cost"] += (prompt_tokens * 1.0 + completion_tokens * 2.0) / 1_000_000
            return
        now = datetime.now(UTC)
        if error and "429" in error:
            _env_fallback_degraded_until = now + timedelta(seconds=RATE_LIMIT_COOLDOWN_SECONDS)
            _env_fallback_degraded_reason = "rate_limited"
        else:
            _env_fallback_consecutive_failures += 1
            if _env_fallback_consecutive_failures >= CIRCUIT_BREAKER_THRESHOLD:
                _env_fallback_degraded_until = now + timedelta(seconds=DEGRADED_TTL_SECONDS)
                _env_fallback_degraded_reason = "consecutive_failures"


async def get_env_fallback_state() -> dict:
    async with _env_fallback_lock:
        return {
            "available": _env_fallback_available,
            "label": "环境变量兜底",
            "key_suffix": DEEPSEEK_API_KEY[-4:] if len(DEEPSEEK_API_KEY) >= 4 else "****",
            "base_url": DEEPSEEK_BASE_URL,
            "model_flash": "deepseek-v4-flash",
            "model_pro": "deepseek-v4-pro",
            "latency_ms": _env_fallback_latency_ms,
            "error": _env_fallback_error,
            "degraded_reason": _env_fallback_degraded_reason,
            "degraded_until": _env_fallback_degraded_until.isoformat() if _env_fallback_degraded_until else None,
            "consecutive_failures": _env_fallback_consecutive_failures,
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
        # 定价从 token_counter 单一来源派生（F-7）
        if model:
            from infrastructure.llm.token_counter import get_model_price_cny

            mpi, mpo = get_model_price_cny(model)
            self.price_input_per_1m = mpi
            self.price_output_per_1m = mpo
        else:
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
        from services.llm import LLMDataService

        try:
            profiles, bindings = LLMDataService.load_all()
            with self._state_lock:
                self._profiles = profiles
                self._bindings = bindings
                self._global_degraded_until = None
            log.debug("ProfileRouter loaded: %d profiles, %d bindings", len(profiles), len(bindings))
        except Exception:
            log.exception("ProfileRouter load failed")
            raise

    def select(self, purpose: str):
        now = datetime.now(UTC)

        with self._state_lock:
            if self._global_degraded_until and now < self._global_degraded_until:
                raise RuntimeError("所有档案不可用，全局降级中")

            binding = self._bindings.get(purpose)

            if binding and not isinstance(binding, _SyntheticConfig):
                profile = self._profiles.get(binding.secret_id)
                if profile and not isinstance(profile, _SyntheticConfig):
                    last_check = getattr(profile, "_last_db_check", 0.0)
                    if _time.monotonic() - last_check > 5.0:
                        self._refresh_profile_from_db(profile)
                        profile._last_db_check = _time.monotonic()

            if binding and binding.status == "active":
                profile = self._profiles.get(binding.secret_id)
                if profile and profile.status == "active":
                    return binding
                if profile and profile.status == "degraded":
                    if profile.degraded_until and now < ensure_utc(profile.degraded_until):
                        pass
                    else:
                        profile.status = "active"
                        profile.degraded_reason = None
                        profile.degraded_until = None
                        profile.consecutive_failures = 0
                        return binding

        from core.config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL
        from core.llm_profile import get_model

        if DEEPSEEK_API_KEY and DEEPSEEK_API_KEY.startswith("sk-"):
            # env 兜底自身已熔断（死密钥/限流）→ 全局降级，停止无谓重试击打死密钥。
            if _env_fallback_degraded_until and now < _env_fallback_degraded_until:
                with self._state_lock:
                    self._global_degraded_until = now + timedelta(seconds=GLOBAL_DEGRADED_TTL_SECONDS)
                raise RuntimeError(f"purpose={purpose} env 兜底已熔断，全局降级中")
            log.warning("ProfileRouter: 最后防线 — env 兜底 (purpose=%s)", purpose)
            return _SyntheticConfig(
                label="DeepSeek (env)",
                base_url=DEEPSEEK_BASE_URL,
                model=get_model(purpose),
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

    async def report_result(
        self,
        config,
        *,
        success: bool,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        total_tokens: int = 0,
        latency_ms: int = 0,
        error: str | None = None,
    ):
        if isinstance(config, _SyntheticConfig):
            await _record_synthetic_result(success, error, prompt_tokens, completion_tokens)
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
                self._update_stats(profile, prompt_tokens, completion_tokens)
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

            # 每次成功调用都持久化计费数据，防止崩溃丢失
            should_persist = success or profile.status == "degraded"

        if should_persist:
            self._persist_stats(profile)

    def _update_stats(self, profile, prompt_tokens: int, completion_tokens: int, model: str = ""):
        today = datetime.now(UTC)
        today_date = today.date()
        total_tokens = prompt_tokens + completion_tokens
        if profile.stats_date is None or profile.stats_date.date() < today_date:
            profile.call_count_today = 0
            profile.total_tokens_today = 0
            profile.total_cost_today = float(0)
            profile.stats_date = today

        current_month = today.strftime("%Y-%m")
        cached_month = None
        if profile.stats_month:
            parts = profile.stats_month.split("-")
            if len(parts) == 2:
                cached_month = (int(parts[0]), int(parts[1]))
        now_month = (today.year, today.month)
        if cached_month is None or cached_month < now_month:
            profile.monthly_cost_used = float(0)
            profile.stats_month = current_month

        profile.call_count_today = (profile.call_count_today or 0) + 1
        profile.total_tokens_today = (profile.total_tokens_today or 0) + total_tokens
        from .token_counter import estimate_cost_cny

        cost = estimate_cost_cny(
            prompt_tokens,
            completion_tokens,
            price_input=float(profile.price_input_per_1m or 0),
            price_output=float(profile.price_output_per_1m or 0),
            model=model,
        )
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

    def _refresh_profile_from_db(self, profile) -> None:
        from services.llm import LLMDataService

        try:
            row = LLMDataService.get_profile(profile.id)
            if row:
                profile.status = row.status
                profile.degraded_reason = row.degraded_reason
                profile.degraded_until = ensure_utc(row.degraded_until) if row.degraded_until else None
                profile.consecutive_failures = row.consecutive_failures
        except Exception:
            log.debug("Failed to refresh profile %d from DB", profile.id, exc_info=True)

    @staticmethod
    def _persist_stats(profile):
        from services.llm import LLMDataService

        data = {
            "call_count_today": getattr(profile, "call_count_today", None),
            "total_tokens_today": getattr(profile, "total_tokens_today", None),
            "total_cost_today": getattr(profile, "total_cost_today", None),
            "monthly_cost_used": getattr(profile, "monthly_cost_used", None),
            "stats_date": getattr(profile, "stats_date", None),
            "stats_month": getattr(profile, "stats_month", None),
            "last_used_at": getattr(profile, "last_used_at", None),
            "status": getattr(profile, "status", None),
            "degraded_reason": getattr(profile, "degraded_reason", None),
            "degraded_until": getattr(profile, "degraded_until", None),
            "consecutive_failures": getattr(profile, "consecutive_failures", None),
        }
        LLMDataService.persist_stats(profile.id, data)

    def degraded_count(self) -> int:
        with self._state_lock:
            return sum(1 for p in self._profiles.values() if getattr(p, "status", "active") == "degraded")

    @property
    def global_degraded(self) -> bool:
        with self._state_lock:
            if not self._global_degraded_until:
                return False
            return datetime.now(UTC) < self._global_degraded_until
