"""LLM 路由调度器 —— 档案状态驱动 + 优先级密钥池"""


import asyncio
import logging
import threading
import time as _time
from datetime import UTC, datetime, timedelta
from typing import Any

from dataclasses import dataclass

from core.datetime_utils import ensure_utc

log = logging.getLogger(__name__)

CIRCUIT_BREAKER_THRESHOLD = 5
RATE_LIMIT_COOLDOWN_SECONDS = 60
DEGRADED_TTL_SECONDS = 300
GLOBAL_DEGRADED_TTL_SECONDS = 30


@dataclass
class EnvConfig:
    """Lightweight config for env fallback — mimics ApiSecret interface."""
    id: int = -1
    label: str = "DeepSeek (env)"
    api_key: str = ""
    base_url: str = ""
    status: str = "active"
    priority: int = -1
    model_override: str | None = None


async def get_env_fallback_state() -> dict:
    from core.config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL

    available = bool(DEEPSEEK_API_KEY and DEEPSEEK_API_KEY.startswith("sk-"))
    return {
        "available": available,
        "label": "环境变量兜底",
        "key_suffix": DEEPSEEK_API_KEY[-4:] if len(DEEPSEEK_API_KEY) >= 4 else "****",
        "base_url": DEEPSEEK_BASE_URL,
    }



class ProfileRouter:
    def __init__(self):
        self._bindings: dict[str, Any] = {}
        self._profiles: dict[int, Any] = {}
        self._global_degraded_until: datetime | None = None
        self._state_lock = threading.Lock()
        self._last_persist_ts: dict[int, float] = {}

    async def load_from_db(self):
        from services.llm_data import LLMDataService

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

            # Refresh cached binding from DB periodically
            if binding:
                last_check = getattr(binding, "_last_db_check", 0.0)
                if _time.monotonic() - last_check > 5.0:
                    self._refresh_profile_from_db(binding)
                    binding._last_db_check = _time.monotonic()

            # Check cached binding
            if binding and binding.status == "active":
                return binding
            if binding and binding.status == "degraded":
                if binding.degraded_until and now < ensure_utc(binding.degraded_until):
                    pass
                else:
                    binding.status = "active"
                    binding.degraded_reason = None
                    binding.degraded_until = None
                    binding.consecutive_failures = 0
                    return binding

            # No cached binding or it's degraded — iterate profiles by priority
            sorted_profiles = sorted(
                self._profiles.values(),
                key=lambda p: (getattr(p, "priority", 0), getattr(p, "id", 0)),
            )
            for p in sorted_profiles:
                if p.status == "active":
                    self._bindings[purpose] = p
                    return p
                if p.status == "degraded" and p.degraded_until and now < ensure_utc(p.degraded_until):
                    continue
                if p.status == "degraded":
                    p.status = "active"
                    p.degraded_reason = None
                    p.degraded_until = None
                    p.consecutive_failures = 0
                    self._bindings[purpose] = p
                    return p

        # Last resort: env fallback
        from core.config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL
        from infrastructure.llm.profile import get_model

        if DEEPSEEK_API_KEY and DEEPSEEK_API_KEY.startswith("sk-"):
            log.warning("ProfileRouter: env 兜底 (purpose=%s)", purpose)
            cfg = EnvConfig(
                api_key=DEEPSEEK_API_KEY,
                base_url=DEEPSEEK_BASE_URL,
                model_override=get_model(purpose),
            )
            self._bindings[purpose] = cfg
            return cfg

        with self._state_lock:
            self._global_degraded_until = now + timedelta(seconds=GLOBAL_DEGRADED_TTL_SECONDS)
        raise RuntimeError(f"purpose={purpose} 无可用密钥")

    def get_api_key(self, config) -> str:
        """Return the plaintext API key from a profile."""
        return config.api_key

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
        with self._state_lock:
            profile = self._profiles.get(config.id)
            if not profile:
                return

            now = datetime.now(UTC)
            if success:
                profile.consecutive_failures = 0
                profile.degraded_reason = None
                profile.degraded_until = None
                if profile.status == "degraded":
                    profile.status = "active"
            else:
                profile.consecutive_failures += 1
                if error and "429" in error:
                    profile.degraded_until = now + timedelta(seconds=RATE_LIMIT_COOLDOWN_SECONDS)
                    profile.degraded_reason = "rate_limited"
                    profile.status = "degraded"
                elif profile.consecutive_failures >= CIRCUIT_BREAKER_THRESHOLD:
                    profile.degraded_until = now + timedelta(seconds=DEGRADED_TTL_SECONDS)
                    profile.degraded_reason = "consecutive_failures"
                    profile.status = "degraded"

            if profile.status == "active":
                profile.last_used_at = now
            profile.call_count_today = (profile.call_count_today or 0) + 1
            if success:
                profile.total_tokens_today = (profile.total_tokens_today or 0) + (total_tokens or 0)
                input_cost = (prompt_tokens or 0) * float(profile.price_input_per_1m or 0) / 1_000_000
                output_cost = (completion_tokens or 0) * float(profile.price_output_per_1m or 0) / 1_000_000
                profile.total_cost_today = float(profile.total_cost_today or 0) + input_cost + output_cost
                profile.monthly_cost_used = float(profile.monthly_cost_used or 0) + input_cost + output_cost

            should_persist = success or profile.status == "degraded"
            if should_persist and _time.monotonic() - self._last_persist_ts.get(config.id, 0) > 5:
                self._persist_stats(profile)
                self._last_persist_ts[config.id] = _time.monotonic()

    def degraded_count(self) -> int:
        with self._state_lock:
            return sum(1 for p in self._profiles.values() if p.status == "degraded")

    @property
    def global_degraded(self) -> bool:
        if self._global_degraded_until:
            return datetime.now(UTC) < self._global_degraded_until
        return False

    def _refresh_profile_from_db(self, profile) -> None:
        """Refresh a single profile from DB. Caller MUST hold _state_lock."""
        from services.llm_data import LLMDataService

        try:
            fresh = LLMDataService.get_profile(profile.id)
            if fresh:
                self._profiles[profile.id] = fresh
        except Exception:
            log.debug("_refresh_profile_from_db failed for id=%d", profile.id, exc_info=True)

    def _persist_stats(self, profile) -> None:
        from services.llm_data import LLMDataService

        try:
            LLMDataService.persist_stats(
                profile.id,
                {
                    "status": profile.status,
                    "degraded_reason": profile.degraded_reason,
                    "degraded_until": profile.degraded_until,
                    "consecutive_failures": profile.consecutive_failures,
                    "call_count_today": profile.call_count_today,
                    "total_tokens_today": profile.total_tokens_today,
                    "total_cost_today": float(profile.total_cost_today or 0),
                    "monthly_cost_used": float(profile.monthly_cost_used or 0),
                    "last_used_at": profile.last_used_at,
                },
            )
        except Exception:
            log.debug("_persist_stats failed for id=%d", profile.id, exc_info=True)
