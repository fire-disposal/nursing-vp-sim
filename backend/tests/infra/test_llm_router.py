"""tests for ProfileRouter priority-based routing (post-Fernet removal)"""

import logging
import time
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest

from core.exceptions import LLMBudgetExceeded
from infra.llm import ProfileRouter
from models import ApiSecret


def _make_secret(id=1, label="test-secret", key="sk-test-key-1234", status="active", priority=0):
    return ApiSecret(
        id=id,
        label=label,
        api_key=key,
        status=status,
        priority=priority,
        consecutive_failures=0,
        price_input_per_1m=0,
        price_output_per_1m=0,
        call_count_today=0,
        total_tokens_today=0,
        total_cost_today=0,
        monthly_cost_used=0,
    )


def test_select_single_binding():
    router = ProfileRouter()
    secret = _make_secret()
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": secret}

    result = router.select("qa")
    assert result.id == 1


def test_select_skips_disabled_falls_back_to_env():
    router = ProfileRouter()
    secret = _make_secret(status="disabled")
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": secret}

    result = router.select("qa")
    assert result.id == -1  # env fallback


def test_select_skips_degraded_falls_back_to_env():
    router = ProfileRouter()
    secret = _make_secret(status="degraded")
    secret.degraded_until = datetime.now(UTC) + timedelta(minutes=5)
    secret._last_db_check = time.monotonic()
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": secret}

    result = router.select("qa")
    assert result.id == -1  # env fallback


def test_select_uses_degraded_after_ttl():
    router = ProfileRouter()
    secret = _make_secret(status="degraded")
    secret.degraded_until = datetime.now(UTC) - timedelta(minutes=1)
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": secret}

    result = router.select("qa")
    assert result.id == 1
    assert secret.status == "active"


def test_select_handles_naive_degraded_until_expired():
    """回归：DB 返回 naive datetime（已过期）时不得抛 TypeError，应恢复为 active。"""
    router = ProfileRouter()
    secret = _make_secret(status="degraded")
    secret.degraded_until = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=10)
    secret._last_db_check = time.monotonic()  # suppress DB refresh
    router._bindings = {"qa": secret}

    router._profiles = {secret.id: secret}
    router.select("qa")
    assert secret.status == "active"


def test_select_handles_naive_degraded_until_active():
    """回归：naive 且未过期的 degraded_until 也不得崩溃，应回退到 env 兜底。"""
    router = ProfileRouter()
    secret = _make_secret(status="degraded")
    secret.degraded_until = datetime.now(UTC).replace(tzinfo=None) + timedelta(minutes=10)
    secret._last_db_check = time.monotonic()
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": secret}

    result = router.select("qa")
    assert result.id == -1  # env fallback
    assert secret.status == "degraded"  # original still degraded


def test_select_all_unavailable_falls_back_to_env():
    router = ProfileRouter()
    secret = _make_secret(status="degraded")
    secret.degraded_until = datetime.now(UTC) + timedelta(minutes=10)
    router._profiles = {secret.id: secret}

    result = router.select("qa")
    assert result.id == -1  # env fallback


def test_select_falls_back_to_second_priority():
    """When the cached binding is degraded, select should try next priority profile."""
    router = ProfileRouter()
    s1 = _make_secret(id=1, priority=10, status="degraded")
    s1.degraded_until = datetime.now(UTC) + timedelta(minutes=5)
    s2 = _make_secret(id=2, priority=20, status="active")
    router._profiles = {1: s1, 2: s2}
    router._bindings = {"qa": s1}

    result = router.select("qa")
    assert result.id == 2
    assert result.priority == 20


def test_select_uses_highest_priority_active():
    """When no cached binding, iterate profiles by priority and pick best active."""
    router = ProfileRouter()
    s1 = _make_secret(id=1, priority=10, status="active")
    s2 = _make_secret(id=2, priority=5, status="active")
    router._profiles = {1: s1, 2: s2}

    result = router.select("qa")
    assert result.id == 2  # priority 5 wins over priority 10


def test_get_api_key():
    router = ProfileRouter()
    secret = _make_secret(key="sk-my-real-key")
    assert router.get_api_key(secret) == "sk-my-real-key"


def test_select_no_config_falls_back_to_env():
    router = ProfileRouter()

    result = router.select("qa")
    assert result.id == -1
    assert result.label == "DeepSeek (env)"


@pytest.mark.asyncio
@patch("infra.llm.data.LLMDataService.persist_stats")
async def test_report_result_circuit_breaks_on_consecutive_failures(mock_persist):
    router = ProfileRouter()
    secret = _make_secret()
    router._profiles = {secret.id: secret}

    for _ in range(5):
        await router.report_result(secret, success=False, error="timeout")

    assert secret.status == "degraded"
    assert secret.degraded_reason == "consecutive_failures"


@pytest.mark.asyncio
@patch("infra.llm.data.LLMDataService.persist_stats")
async def test_report_result_429_sets_rate_limited(mock_persist):
    router = ProfileRouter()
    secret = _make_secret()
    router._profiles = {secret.id: secret}

    await router.report_result(secret, success=False, error="429 Too Many Requests")

    assert secret.status == "degraded"
    assert secret.degraded_reason == "rate_limited"


@pytest.mark.asyncio
@patch("infra.llm.data.LLMDataService.persist_stats")
async def test_report_result_402_sets_insufficient_balance_long_ttl(mock_persist):
    """402 (余额不足) 必须立即可识别为 insufficient_balance，且 TTL 显著长于容量型降级。"""
    from infra.llm.router import INSUFFICIENT_BALANCE_TTL_SECONDS, RATE_LIMIT_COOLDOWN_SECONDS

    router = ProfileRouter()
    secret = _make_secret()
    router._profiles = {secret.id: secret}

    await router.report_result(secret, success=False, error="HTTP 402 Insufficient Balance")

    assert secret.status == "degraded"
    assert secret.degraded_reason == "insufficient_balance"
    assert secret.degraded_until > datetime.now(UTC) + timedelta(seconds=INSUFFICIENT_BALANCE_TTL_SECONDS - 10)
    assert INSUFFICIENT_BALANCE_TTL_SECONDS > 60 * RATE_LIMIT_COOLDOWN_SECONDS


@pytest.mark.asyncio
@patch("infra.llm.data.LLMDataService.persist_stats")
async def test_report_result_429_with_balance_body_is_insufficient_balance(mock_persist):
    """one-api 等网关可能用 429 携带余额错误体 —— 按 body 关键字识别为余额不足。"""
    router = ProfileRouter()
    secret = _make_secret()
    router._profiles = {secret.id: secret}

    await router.report_result(secret, success=False, error='HTTP 429 {"error": "insufficient balance"}')

    assert secret.status == "degraded"
    assert secret.degraded_reason == "insufficient_balance"


@pytest.mark.asyncio
@patch("infra.llm.data.LLMDataService.persist_stats")
async def test_report_result_5xx_counts_toward_provider_overloaded(mock_persist):
    """5xx (官方承载能力下降) 走连续失败熔断，但原因标注 provider_overloaded。"""
    router = ProfileRouter()
    secret = _make_secret()
    router._profiles = {secret.id: secret}

    for _ in range(5):
        await router.report_result(secret, success=False, error="HTTP 503 Service Unavailable")

    assert secret.status == "degraded"
    assert secret.degraded_reason == "provider_overloaded"


def test_degraded_by_reason_breakdown():
    """degraded_by_reason 按原因统计，供监控侧区分余额型与容量型降级。"""
    router = ProfileRouter()
    s1 = _make_secret(id=1, status="degraded")
    s1.degraded_reason = "insufficient_balance"
    s2 = _make_secret(id=2, status="degraded")
    s2.degraded_reason = "rate_limited"
    s3 = _make_secret(id=3, status="degraded")
    s3.degraded_reason = "provider_overloaded"
    s4 = _make_secret(id=4, status="active")
    router._profiles = {1: s1, 2: s2, 3: s3, 4: s4}

    assert router.degraded_by_reason() == {
        "insufficient_balance": 1,
        "rate_limited": 1,
        "provider_overloaded": 1,
    }
    assert router.degraded_count() == 3


@pytest.mark.asyncio
@patch("infra.llm.data.LLMDataService.persist_stats")
async def test_report_result_success_clears_degraded(mock_persist):
    router = ProfileRouter()
    secret = _make_secret(status="degraded", priority=0)
    secret.degraded_reason = "consecutive_failures"
    secret.degraded_until = datetime.now(UTC) + timedelta(minutes=5)
    secret.consecutive_failures = 5
    router._profiles = {secret.id: secret}

    await router.report_result(secret, success=True, prompt_tokens=10, completion_tokens=5, total_tokens=15)

    assert secret.status == "active"
    assert secret.degraded_reason is None
    assert secret.consecutive_failures == 0


# ── 月度预算闸门（拒绝式） ─────────────────────────────────────────


class TestBudgetGate:
    def _secret_with_limit(self, used: float, limit: float = 10.0, *, id: int = 1, priority: int = 0):
        secret = _make_secret(id=id, priority=priority)
        secret.monthly_cost_limit = limit
        secret.monthly_cost_used = used
        return secret

    def test_over_budget_key_is_rejected(self):
        """预调用估算带入限额 —— 已用 + 单次上限 > 限额即拒绝新调用。"""
        router = ProfileRouter()
        secret = self._secret_with_limit(9.9999)
        router._profiles = {secret.id: secret}
        router._bindings = {"qa": secret}

        with pytest.raises(LLMBudgetExceeded):
            router.select("qa")

    def test_under_budget_key_still_selected(self):
        router = ProfileRouter()
        secret = self._secret_with_limit(1.0)
        router._profiles = {secret.id: secret}
        router._bindings = {"qa": secret}

        assert router.select("qa").id == secret.id

    def test_no_limit_means_no_gate(self):
        router = ProfileRouter()
        secret = _make_secret()
        secret.monthly_cost_used = 9999.0  # 未配置 monthly_cost_limit
        router._profiles = {secret.id: secret}
        router._bindings = {"qa": secret}

        assert router.select("qa").id == secret.id

    def test_falls_through_to_key_with_budget_left(self):
        router = ProfileRouter()
        spent = self._secret_with_limit(9.9999, id=1, priority=0)
        healthy = self._secret_with_limit(0.0, id=2, priority=10)
        router._profiles = {1: spent, 2: healthy}
        router._bindings = {"qa": spent}

        assert router.select("qa").id == 2

    def test_env_fallback_does_not_bypass_budget(self, monkeypatch):
        """全部密钥超预算时必须拒绝 —— 落到 env 兜底等于绕过预算。"""
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-env-fallback-placeholder")
        router = ProfileRouter()
        secret = self._secret_with_limit(9.9999)
        router._profiles = {secret.id: secret}
        router._bindings = {"qa": secret}

        with pytest.raises(LLMBudgetExceeded):
            router.select("qa")

    def test_budget_block_is_visible_in_degraded_by_reason(self):
        router = ProfileRouter()
        secret = self._secret_with_limit(9.9999)
        router._profiles = {secret.id: secret}
        router._bindings = {"qa": secret}

        with pytest.raises(LLMBudgetExceeded):
            router.select("qa")

        assert router.degraded_by_reason() == {"cost_exceeded": 1}

    def test_cooldown_expiry_reevaluates_and_recovers(self):
        """冷却到期后重新核算：管理员调高限额（或用量清零）即恢复可用，无需重启。"""
        router = ProfileRouter()
        secret = self._secret_with_limit(9.9999)
        router._profiles = {secret.id: secret}
        router._bindings = {"qa": secret}
        with pytest.raises(LLMBudgetExceeded):
            router.select("qa")

        router._budget_blocked[secret.id] = datetime.now(UTC) - timedelta(seconds=1)
        secret.monthly_cost_used = 0.0

        assert router.select("qa").id == secret.id


# ── env 兜底不再"永久粘住" ────────────────────────────────────────


def test_env_fallback_does_not_stick_after_db_recovery():
    """回归：env 兜底此前会把 purpose 的 binding 覆盖成 env 单例（status=active），
    于是 Phase 1 快路径永久命中它，DB 密钥再也不被重新探测（只有重启能恢复）。"""
    router = ProfileRouter()
    secret = _make_secret(status="degraded")
    secret.degraded_until = datetime.now(UTC) + timedelta(minutes=5)
    secret._last_db_check = time.monotonic()
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": secret}

    assert router.select("qa").id == -1  # 落到 env 兜底

    # DB 密钥恢复（余额充值 / 降级 TTL 到期）
    secret.status = "active"
    secret.degraded_until = None

    assert router.select("qa").id == secret.id


@pytest.mark.asyncio
async def test_env_fallback_usage_is_observable(monkeypatch):
    """env 兜底此前只记账没人读；现在 call_count / 成本可从状态接口读出。"""
    import infra.llm.router as router_module
    from infra.llm.router import EnvConfig
    from infra.llm.router import ProfileRouter as _Router

    cfg = EnvConfig(api_key="sk-env-fallback-placeholder", base_url="https://api.deepseek.com")
    monkeypatch.setattr(router_module, "_env_fallback", cfg)

    await _Router().report_result(
        cfg,
        success=True,
        prompt_tokens=1_000_000,
        completion_tokens=0,
        total_tokens=1_000_000,
        model="deepseek-v4-flash",
    )

    state = await router_module.get_env_fallback_state()
    assert state["call_count"] == 1
    assert state["total_tokens"] == 1_000_000
    assert state["total_cost"] == pytest.approx(1.0)  # flash 输入价 ¥1/1M
    assert state["degraded_reason"] is None


@pytest.mark.asyncio
@patch("infra.llm.data.LLMDataService.persist_stats")
async def test_env_fallback_failure_breaks_circuit_and_is_reported(mock_persist, monkeypatch):
    import infra.llm.router as router_module
    from infra.llm.router import EnvConfig
    from infra.llm.router import ProfileRouter as _Router

    cfg = EnvConfig(api_key="sk-env-fallback-placeholder")
    monkeypatch.setattr(router_module, "_env_fallback", cfg)
    router = _Router()
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-env-fallback-placeholder")

    for _ in range(5):
        await router.report_result(cfg, success=False, error="HTTP 503 Service Unavailable")

    state = await router_module.get_env_fallback_state()
    assert state["consecutive_failures"] == 5
    assert state["degraded_reason"] == "provider_overloaded"
    assert state["degraded_until"] is not None
    # 熔断窗口内 select 必须拒绝（而不是继续用 env key 打爆）
    with pytest.raises(RuntimeError):
        router.select("qa")


# ── 成本口径收敛（router 与 LLMCallLog 同一公式） ─────────────────


@pytest.mark.asyncio
@patch("infra.llm.data.LLMDataService.persist_stats")
async def test_cost_ledger_matches_token_counter(mock_persist):
    """回归：ApiSecret 成本账必须与 LLMCallLog.estimated_cost 用同一个 estimate_cost_cny。

    改前 router 自带公式"只用 key 价、不识别缓存命中"，pro 模型与缓存命中都会分叉。
    """
    from infra.llm.token_counter import estimate_cost_cny

    router = ProfileRouter()
    secret = _make_secret()
    secret.price_input_per_1m = 3.0
    secret.price_output_per_1m = 6.0
    router._profiles = {secret.id: secret}

    await router.report_result(
        secret,
        success=True,
        prompt_tokens=1_000_000,
        completion_tokens=0,
        total_tokens=1_000_000,
        model="deepseek-v4-pro",
        cache_hit_tokens=500_000,
    )

    expected = estimate_cost_cny(
        1_000_000, 0, price_input=3.0, price_output=6.0, model="deepseek-v4-pro", cache_hit_tokens=500_000
    )
    assert secret.total_cost_today == pytest.approx(expected)
    assert secret.monthly_cost_used == pytest.approx(expected)


@pytest.mark.asyncio
@patch("infra.llm.data.LLMDataService.persist_stats")
async def test_cost_ledger_uses_selected_model_price(mock_persist):
    """select() 选中的实际模型会被记账复用 —— pro 不再按 flash 价少计。"""
    router = ProfileRouter()
    secret = _make_secret()
    secret.model_override = "deepseek-v4-pro"
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": secret}

    assert router.select("qa").id == secret.id
    await router.report_result(secret, success=True, prompt_tokens=1_000_000, total_tokens=1_000_000)

    assert secret.monthly_cost_used == pytest.approx(3.0)  # pro 输入价 ¥3/1M


# ── 落库失败不再静默 ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_persist_failure_is_counted_and_warned(caplog):
    router = ProfileRouter()
    secret = _make_secret()
    router._profiles = {secret.id: secret}

    with (
        patch("infra.llm.data.LLMDataService.persist_stats", side_effect=RuntimeError("db down")),
        caplog.at_level(logging.WARNING),
    ):
        await router.report_result(secret, success=True, prompt_tokens=10, completion_tokens=5, total_tokens=15)

    assert router.persist_failures == 1
    assert any("_persist_stats failed" in record.message for record in caplog.records)


def test_refresh_rebinds_budget_gate_to_fresh_profile():
    """回归：DB 刷新后 binding 必须指向新对象，否则预算闸门读的是永不更新的旧计数。

    快路径返回旧对象 → report_result 却把成本累积到 _profiles 里的新对象上 →
    闸门永远看不到"已用"增长（本用例在修复前会 DID NOT RAISE）。
    """
    router = ProfileRouter()
    stale = _make_secret()
    stale.monthly_cost_limit = 10.0
    stale.monthly_cost_used = 0.0
    router._profiles = {stale.id: stale}
    router._bindings = {"qa": stale}

    fresh = _make_secret()
    fresh.monthly_cost_limit = 10.0
    fresh.monthly_cost_used = 9.9999  # 别处/别的 worker 已经把钱花掉了

    with patch("infra.llm.data.LLMDataService.get_profile", return_value=fresh):
        router._refresh_profile_from_db(stale.id)

    assert router._bindings["qa"] is fresh
    with pytest.raises(LLMBudgetExceeded):
        router.select("qa")
