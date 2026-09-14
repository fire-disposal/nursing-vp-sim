"""LLM 路由调度器 —— 档案状态驱动 + 优先级密钥池"""

import logging
import re
import threading
import time as _time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from core.datetime_utils import ensure_utc
from core.exceptions import LLMBudgetExceeded

log = logging.getLogger(__name__)

CIRCUIT_BREAKER_THRESHOLD = 5
RATE_LIMIT_COOLDOWN_SECONDS = 60
DEGRADED_TTL_SECONDS = 300
GLOBAL_DEGRADED_TTL_SECONDS = 30
# 402 (余额不足) 属人工动作型故障：长 TTL 避免死密钥被反复试探，
# 同时让监控侧能把它与容量型降级明确区分开。
INSUFFICIENT_BALANCE_TTL_SECONDS = 6 * 3600

# ── 月度成本预算闸门 ──
# 预调用估算的输入规模假设：学校场景 prompt 含病例+历史，量级 2k~6k token。
BUDGET_ASSUMED_PROMPT_TOKENS = 4000
# 命中预算后的冷却：期间不再选中该密钥（避免每次调用都重复估算与刷屏日志）。
# 取 5 分钟 —— 管理员调高 monthly_cost_limit 后最多 5 分钟自动恢复，无需重启。
BUDGET_COOLDOWN_SECONDS = 300
# 与前端 frontend/src/utils/llm-status.ts 的 REASON_LABELS 同一词表（"超预算"），
# 不要再造第二个名字。
BUDGET_DEGRADED_REASON = "cost_exceeded"

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
    # 内存级统计/熔断（env 兜底不落库，进程内追踪 —— **worker-local**：
    # 多 worker 部署时每个进程各记一份，重启清零。见 get_env_fallback_state()）
    consecutive_failures: int = 0
    degraded_until: datetime | None = None
    degraded_reason: str | None = None
    call_count_today: int = 0
    total_tokens_today: int = 0
    total_cost_today: float = 0.0


# env 兜底单例：跨调用共享熔断状态（select() 每次构造会丢失统计）
_env_fallback: EnvConfig | None = None


def estimate_next_call_cost_cny(purpose: str, model: str | None = None) -> float:
    """预调用成本估算 —— 预算闸门用。按用途 ``max_tokens`` 全量输出 + 假定输入规模计费。"""
    from infra.llm.profile import get_llm_config, get_model
    from infra.llm.token_counter import estimate_cost_cny

    max_tokens = int(get_llm_config(purpose).get("max_tokens") or 0)
    return estimate_cost_cny(BUDGET_ASSUMED_PROMPT_TOKENS, max_tokens, model=model or get_model(purpose))


async def get_env_fallback_state() -> dict:
    from core.config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL

    available = bool(DEEPSEEK_API_KEY and DEEPSEEK_API_KEY.startswith("sk-"))
    cfg = _env_fallback
    return {
        "available": available,
        "label": "环境变量 (当前使用)",
        "key_suffix": DEEPSEEK_API_KEY[-4:] if len(DEEPSEEK_API_KEY) >= 4 else "****",
        "base_url": DEEPSEEK_BASE_URL,
        "model_flash": "deepseek-v4-flash",
        "model_pro": "deepseek-v4-pro",
        # 兜底使用情况（进程内统计，worker-local；重启清零）
        "call_count": cfg.call_count_today if cfg else 0,
        "total_tokens": cfg.total_tokens_today if cfg else 0,
        "total_cost": round(cfg.total_cost_today, 6) if cfg else 0.0,
        "consecutive_failures": cfg.consecutive_failures if cfg else 0,
        "degraded_reason": cfg.degraded_reason if cfg else None,
        "degraded_until": cfg.degraded_until if cfg else None,
    }


class ProfileRouter:
    def __init__(self):
        self._bindings: dict[str, Any] = {}
        self._profiles: dict[int, Any] = {}
        self._global_degraded_until: datetime | None = None
        self._state_lock = threading.Lock()
        self._last_persist_ts: dict[int, float] = {}
        # key 级预算闸门冷却（profile.id → 截止时刻）；进程内状态，重启清零
        self._budget_blocked: dict[int, datetime] = {}
        self._persist_failures = 0
        self._env_in_use = False

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

    def _budget_blocked_now(self, config, purpose: str, now: datetime) -> bool:
        """月度预算闸门（拒绝式，key 级）。

        ``monthly_cost_limit`` 之前只是"展示字段"，超支后仍会继续调用。这里在**选中密钥
        之前**做预调用估算：``monthly_cost_used + estimate_next_call_cost_cny(purpose)``
        超过限额即把该密钥临时停用（``BUDGET_COOLDOWN_SECONDS``），select 会尝试下一个密钥；
        全部超限则抛 ``LLMBudgetExceeded`` 拒绝新调用。在途调用不受影响（它们已持有 config），
        冷却到期后自动重新核算 —— 管理员调高限额即恢复。

        调用方必须持有 ``_state_lock``。
        """
        limit = float(getattr(config, "monthly_cost_limit", 0) or 0)
        if limit <= 0:  # 未配置限额 = 不设闸门
            return False
        blocked_until = self._budget_blocked.get(config.id)
        if blocked_until and now < blocked_until:
            return True
        used = float(getattr(config, "monthly_cost_used", 0) or 0)
        estimate = estimate_next_call_cost_cny(purpose, getattr(config, "model_override", None))
        if used + estimate <= limit:
            self._budget_blocked.pop(config.id, None)
            return False
        self._budget_blocked[config.id] = now + timedelta(seconds=BUDGET_COOLDOWN_SECONDS)
        log.warning(
            "LLM 预算闸门命中 (%s): key=%s 已用 %.4f + 预估 %.4f > 限额 %.4f 元，临时停用 %ds",
            BUDGET_DEGRADED_REASON,
            config.id,
            used,
            estimate,
            limit,
            BUDGET_COOLDOWN_SECONDS,
        )
        return True

    @staticmethod
    def _remember_model(config, purpose: str) -> None:
        """把本次选中的实际模型挂在 config 上，供 report_result 用同一套定价记账。"""
        from infra.llm.profile import get_model

        config._selected_model = getattr(config, "model_override", None) or get_model(purpose)

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
            if binding and binding.status == "active" and not self._budget_blocked_now(binding, purpose, now):
                self._remember_model(binding, purpose)
                return binding
            if binding and binding.status == "degraded" and not self._budget_blocked.get(binding.id):
                if binding.degraded_until and now < ensure_utc(binding.degraded_until):
                    pass
                else:
                    binding.status = "active"
                    binding.degraded_reason = None
                    binding.degraded_until = None
                    binding.consecutive_failures = 0
                    if not self._budget_blocked_now(binding, purpose, now):
                        self._remember_model(binding, purpose)
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
            budget_blocked = 0
            unavailable = 0
            for p in sorted_profiles:
                if p.status == "active":
                    if self._budget_blocked_now(p, purpose, now):
                        budget_blocked += 1
                        continue
                    self._bindings[purpose] = p
                    self._remember_model(p, purpose)
                    return p
                if p.status == "degraded" and p.degraded_until and now < ensure_utc(p.degraded_until):
                    unavailable += 1
                    continue
                if p.status == "degraded":
                    p.status = "active"
                    p.degraded_reason = None
                    p.degraded_until = None
                    p.consecutive_failures = 0
                    if self._budget_blocked_now(p, purpose, now):
                        budget_blocked += 1
                        continue
                    self._bindings[purpose] = p
                    self._remember_model(p, purpose)
                    return p

            # 全部密钥都因预算被停用：拒绝新调用（不落到 env 兜底 —— 那等于绕过预算）
            if budget_blocked and not unavailable:
                raise LLMBudgetExceeded(
                    f"purpose={purpose} 全部密钥均已超出月度预算（{budget_blocked} 个），拒绝新调用"
                )

        # Last resort: env fallback
        # 注意：**不写入 _bindings**。若把 env 单例缓存进 binding，Phase 1 快路径会永久
        # 命中它（它自己是 active），DB 密钥从此不再被重新探测 —— 只有重启才能恢复。
        # env 兜底是 worker-local 的进程内状态：call_count/total_cost/熔断 TTL 各 worker
        # 各记一份，重启清零（见 get_env_fallback_state / EnvConfig 注释）。
        from core.config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL

        if DEEPSEEK_API_KEY and DEEPSEEK_API_KEY.startswith("sk-"):
            global _env_fallback
            if _env_fallback is None:
                # model_override 留空：实际模型由调用侧按 purpose 解析（get_model），
                # 避免单例把"第一个命中 env 的用途"的模型泄漏给所有用途。
                _env_fallback = EnvConfig(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)
            cfg = _env_fallback
            if cfg.degraded_until and now < cfg.degraded_until:
                log.warning(
                    "ProfileRouter: env 兜底熔断中 (%s) — 全局降级",
                    cfg.degraded_reason,
                )
                with self._state_lock:
                    self._global_degraded_until = now + timedelta(seconds=GLOBAL_DEGRADED_TTL_SECONDS)
                raise RuntimeError(f"purpose={purpose} 无可用密钥（env 兜底已熔断）")
            log.warning("ProfileRouter: env 兜底 (purpose=%s)", purpose)
            self._env_in_use = True
            return cfg

        with self._state_lock:
            self._global_degraded_until = now + timedelta(seconds=GLOBAL_DEGRADED_TTL_SECONDS)
        raise RuntimeError(f"purpose={purpose} 无可用密钥")

    def get_api_key(self, config) -> str:
        """Return the plaintext API key from a profile."""
        return config.api_key

    @staticmethod
    def _call_cost_cny(config, prompt_tokens, completion_tokens, model, cache_hit_tokens, at) -> float:
        """单次调用成本 —— 与 ``LLMCallLog.estimated_cost`` 调用**同一个** ``estimate_cost_cny``。

        定价优先级由 token_counter 单点决定（模型官方价 > 显式 key 价 > env 回退价），并含
        缓存命中折扣与峰谷因子；因此 ``ApiSecret.total_cost_today / monthly_cost_used`` 与
        调用明细表口径一致（此前 router 自带一套"只按 key 价、不识别缓存"的公式，两处会分叉）。
        """
        from infra.llm.token_counter import estimate_cost_cny

        resolved_model = model or getattr(config, "_selected_model", None) or getattr(config, "model_override", None)
        return estimate_cost_cny(
            prompt_tokens or 0,
            completion_tokens or 0,
            price_input=float(getattr(config, "price_input_per_1m", 0) or 0),
            price_output=float(getattr(config, "price_output_per_1m", 0) or 0),
            model=resolved_model,
            cache_hit_tokens=cache_hit_tokens or 0,
            at=at,
        )

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
        model: str | None = None,
        cache_hit_tokens: int = 0,
    ):
        should_persist = False
        persist_profile = None

        with self._state_lock:
            profile = self._profiles.get(config.id)
            if config.id == -1 and isinstance(config, EnvConfig):
                # env 兜底：内存级记账与熔断（不落库，重启即清零——worker-local，见 EnvConfig）
                now = datetime.now(UTC)
                if success:
                    config.consecutive_failures = 0
                    config.degraded_reason = None
                    config.degraded_until = None
                else:
                    config.consecutive_failures += 1
                    reason = classify_llm_error(error)
                    if reason == "rate_limited":
                        config.degraded_until = now + timedelta(seconds=RATE_LIMIT_COOLDOWN_SECONDS)
                        config.degraded_reason = reason
                    elif reason == "insufficient_balance":
                        config.degraded_until = now + timedelta(seconds=INSUFFICIENT_BALANCE_TTL_SECONDS)
                        config.degraded_reason = reason
                    elif config.consecutive_failures >= CIRCUIT_BREAKER_THRESHOLD:
                        config.degraded_until = now + timedelta(seconds=DEGRADED_TTL_SECONDS)
                        config.degraded_reason = reason or "consecutive_failures"
                config.call_count_today += 1
                if success:
                    config.total_tokens_today += total_tokens or 0
                    config.total_cost_today += self._call_cost_cny(
                        config, prompt_tokens, completion_tokens, model, cache_hit_tokens, now
                    )
                log.warning(
                    "env 兜底调用统计: success=%s failures=%d reason=%s calls=%d cost=%.4f",
                    success,
                    config.consecutive_failures,
                    config.degraded_reason,
                    config.call_count_today,
                    config.total_cost_today,
                )
                return
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
                profile.total_tokens_today = (profile.total_tokens_today or 0) + (total_tokens or 0)
                cost = self._call_cost_cny(config, prompt_tokens, completion_tokens, model, cache_hit_tokens, now)
                profile.total_cost_today = float(profile.total_cost_today or 0) + cost
                profile.monthly_cost_used = float(profile.monthly_cost_used or 0) + cost

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
        """按原因统计不可用密钥数 —— 让监控侧区分可人工处理的余额型降级
        (insufficient_balance)、官方容量波动型降级 (rate_limited/provider_overloaded)
        与预算闸门 (cost_exceeded，人工动作型：调高 monthly_cost_limit 即恢复)。"""
        counts: dict[str, int] = {}
        now = datetime.now(UTC)
        with self._state_lock:
            for p in self._profiles.values():
                if p.status == "degraded":
                    key = p.degraded_reason or "unknown"
                    counts[key] = counts.get(key, 0) + 1
            budget_blocked = sum(1 for until in self._budget_blocked.values() if now < until)
            if budget_blocked:
                counts[BUDGET_DEGRADED_REASON] = budget_blocked
        return counts

    @property
    def persist_failures(self) -> int:
        """成本/降级状态落库失败累计次数（>0 表示内存账与 DB 账已分叉，需人工核对）。"""
        return self._persist_failures

    @property
    def env_fallback_in_use(self) -> bool:
        """本进程是否至少使用过一次 env 兜底密钥（worker-local）。"""
        return self._env_in_use

    def env_fallback_usage(self) -> dict:
        """env 兜底的进程内用量（worker-local，重启清零）—— 供诊断/监控读取。"""
        cfg = _env_fallback
        if cfg is None:
            return {"in_use": False, "call_count": 0, "total_tokens": 0, "total_cost": 0.0}
        return {
            "in_use": self._env_in_use,
            "call_count": cfg.call_count_today,
            "total_tokens": cfg.total_tokens_today,
            "total_cost": round(cfg.total_cost_today, 6),
            "consecutive_failures": cfg.consecutive_failures,
            "degraded_reason": cfg.degraded_reason,
            "degraded_until": cfg.degraded_until.isoformat() if cfg.degraded_until else None,
        }

    @property
    def global_degraded(self) -> bool:
        """True while the router is in the global-degradation window (no profile usable).

        Exposed for metrics/diagnostics; `select` raises RuntimeError during the window.
        """
        now = datetime.now(UTC)
        with self._state_lock:
            return bool(self._global_degraded_until) and now < self._global_degraded_until

    def _refresh_profile_from_db(self, profile_id: int) -> None:
        """Refresh a single profile from DB. Caller MUST NOT hold _state_lock.

        刷新出来的新对象必须同时替换 ``_bindings`` 里指向同 id 的旧对象 —— 否则
        ``select()`` 的快路径会一直返回旧对象，而 ``report_result`` 写入的是
        ``_profiles`` 里的新对象，两者数字永久分叉（成本累积、预算闸门、status 读取
        都会看到过期值）。
        """
        from infra.llm.data import LLMDataService

        try:
            fresh = LLMDataService.get_profile(profile_id)
            if fresh:
                with self._state_lock:
                    self._profiles[profile_id] = fresh
                    for purpose, bound in self._bindings.items():
                        if getattr(bound, "id", None) == profile_id:
                            self._bindings[purpose] = fresh
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
            # 这是 DB 侧成本账（ApiSecret.monthly_cost_used 等）的唯一写手：失败必须可见，
            # 否则内存计数与 DB 永久分叉却没有任何现场线索（原先吞成 debug，root 级别 INFO 下不输出）。
            self._persist_failures += 1
            log.warning(
                "_persist_stats failed for id=%d (累计 %d 次，内存账与 DB 账可能已分叉)",
                profile.id,
                self._persist_failures,
                exc_info=True,
            )
