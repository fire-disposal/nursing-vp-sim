"""LLM 路由调度器 —— 档案状态驱动 + 优先级密钥池"""

import logging
import re
import threading
import time as _time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from core.datetime_utils import ensure_utc

log = logging.getLogger(__name__)

CIRCUIT_BREAKER_THRESHOLD = 5
RATE_LIMIT_COOLDOWN_SECONDS = 60
DEGRADED_TTL_SECONDS = 300
GLOBAL_DEGRADED_TTL_SECONDS = 30
# 402 (余额不足) 属人工动作型故障：长 TTL 避免死密钥被反复试探，
# 同时让监控侧能把它与容量型降级明确区分开。
INSUFFICIENT_BALANCE_TTL_SECONDS = 6 * 3600

# 余额耗尽关键字（one-api 等网关可能用 429 携带余额错误体，不能只看状态码）
_BALANCE_KEYWORDS = ("insufficient balance", "balance insufficient", "余额不足", "欠费", "account balance")
_STATUS_RE = re.compile(r"\b([45]\d\d)\b")


def classify_llm_error(error: str | None) -> str | None:
    """把供应商错误字符串映射为降级原因。

    - ``insufficient_balance``: 402 或余额相关错误体 —— 钱花光了，需人工充值
    - ``rate_limited``: 429 —— 官方限流（QPS/并发承载）
    - ``provider_overloaded``: 5xx —— 官方承载能力下降
    - ``None``: 其它错误，走连续失败熔断（consecutive_failures）
    """
    if not error:
        return None
    lowered = error.lower()
    if any(k in lowered for k in _BALANCE_KEYWORDS):
        return "insufficient_balance"
    m = _STATUS_RE.search(error)
    if not m:
        return None
    status = int(m.group(1))
    if status == 402:
        return "insufficient_balance"
    if status == 429:
        return "rate_limited"
    if status in (500, 502, 503, 504):
        return "provider_overloaded"
    return None


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
        "label": "环境变量 (当前使用)",
        "key_suffix": DEEPSEEK_API_KEY[-4:] if len(DEEPSEEK_API_KEY) >= 4 else "****",
        "base_url": DEEPSEEK_BASE_URL,
        "model_flash": "deepseek-v4-flash",
        "model_pro": "deepseek-v4-pro",
    }


class ProfileRouter:
    def __init__(self):
        self._bindings: dict[str, Any] = {}
        self._profiles: dict[int, Any] = {}
        self._global_degraded_until: datetime | None = None
        self._state_lock = threading.Lock()
        self._last_persist_ts: dict[int, float] = {}

    async def load_from_db(self):
        from infra.llm.data import LLMDataService

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

        # Phase 1: lock → check bindings, detect if DB refresh needed
        refresh_id: int | None = None
        with self._state_lock:
            if self._global_degraded_until and now < self._global_degraded_until:
                raise RuntimeError("所有档案不可用，全局降级中")

            binding = self._bindings.get(purpose)
            if binding:
                last_check = getattr(binding, "_last_db_check", 0.0)
                if _time.monotonic() - last_check > 5.0:
                    refresh_id = binding.id
                    binding._last_db_check = _time.monotonic()

            # Fast path: cached active binding — return immediately
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

        # Phase 2: no lock — sync DB refresh (avoids blocking event loop)
        if refresh_id is not None:
            self._refresh_profile_from_db(refresh_id)

        # Phase 3: lock → iterate profiles, pick best
        with self._state_lock:
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
        from infra.llm.profile import get_model

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
        should_persist = False
        persist_profile = None

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
                reason = classify_llm_error(error)
                if reason == "insufficient_balance":
                    # 余额耗尽：长冷却，避免死密钥被反复试探；监控侧据此立即告警。
                    profile.degraded_until = now + timedelta(seconds=INSUFFICIENT_BALANCE_TTL_SECONDS)
                    profile.degraded_reason = reason
                    profile.status = "degraded"
                elif reason == "rate_limited":
                    profile.degraded_until = now + timedelta(seconds=RATE_LIMIT_COOLDOWN_SECONDS)
                    profile.degraded_reason = reason
                    profile.status = "degraded"
                elif profile.consecutive_failures >= CIRCUIT_BREAKER_THRESHOLD:
                    profile.degraded_until = now + timedelta(seconds=DEGRADED_TTL_SECONDS)
                    profile.degraded_reason = reason or "consecutive_failures"
                    profile.status = "degraded"

            if profile.status == "active":
                profile.last_used_at = now
            profile.call_count_today = (profile.call_count_today or 0) + 1
            if success:
                from infra.llm.token_counter import peak_multiplier

                profile.total_tokens_today = (profile.total_tokens_today or 0) + (total_tokens or 0)
                mult = peak_multiplier(now)
                input_cost = (prompt_tokens or 0) * float(profile.price_input_per_1m or 0) / 1_000_000 * mult
                output_cost = (completion_tokens or 0) * float(profile.price_output_per_1m or 0) / 1_000_000 * mult
                profile.total_cost_today = float(profile.total_cost_today or 0) + input_cost + output_cost
                profile.monthly_cost_used = float(profile.monthly_cost_used or 0) + input_cost + output_cost

            if (success or profile.status == "degraded") and _time.monotonic() - self._last_persist_ts.get(
                config.id, 0
            ) > 5:
                should_persist = True
                persist_profile = profile
                self._last_persist_ts[config.id] = _time.monotonic()

        # Persist outside lock to avoid blocking event loop
        if should_persist and persist_profile:
            self._persist_stats(persist_profile)

    def degraded_count(self) -> int:
        with self._state_lock:
            return sum(1 for p in self._profiles.values() if p.status == "degraded")

    def degraded_by_reason(self) -> dict[str, int]:
        """按原因统计降级密钥数 —— 让监控侧区分可人工处理的余额型降级
        (insufficient_balance) 与官方容量波动型降级 (rate_limited/provider_overloaded)。"""
        counts: dict[str, int] = {}
        with self._state_lock:
            for p in self._profiles.values():
                if p.status == "degraded":
                    key = p.degraded_reason or "unknown"
                    counts[key] = counts.get(key, 0) + 1
        return counts

    @property
    def global_degraded(self) -> bool:
        """True while the router is in the global-degradation window (no profile usable).

        Exposed for metrics/diagnostics; `select` raises RuntimeError during the window.
        """
        now = datetime.now(UTC)
        with self._state_lock:
            return bool(self._global_degraded_until) and now < self._global_degraded_until

    def _refresh_profile_from_db(self, profile_id: int) -> None:
        """Refresh a single profile from DB. Caller MUST NOT hold _state_lock."""
        from infra.llm.data import LLMDataService

        try:
            fresh = LLMDataService.get_profile(profile_id)
            if fresh:
                with self._state_lock:
                    self._profiles[profile_id] = fresh
        except Exception:
            log.debug("_refresh_profile_from_db failed for id=%d", profile_id, exc_info=True)

    def _persist_stats(self, profile) -> None:
        from infra.llm.data import LLMDataService

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
