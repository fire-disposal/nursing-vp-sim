"""tests for ProfileRouter priority-based routing"""

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest

from infrastructure.llm import ProfileRouter, _SyntheticConfig
from models import ApiSecret


def _make_secret(id=1, label="test-secret", key="encrypted-test-key", suffix="xxxx", status="active", priority=0):
    return ApiSecret(
        id=id,
        label=label,
        encrypted_key=key,
        key_suffix=suffix,
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


def test_select_skips_disabled_secret():
    router = ProfileRouter()
    secret = _make_secret(status="disabled")
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": secret}

    result = router.select("qa")
    assert isinstance(result, _SyntheticConfig)


def test_select_skips_degraded_profile():
    router = ProfileRouter()
    secret = _make_secret(status="degraded")
    secret.degraded_until = datetime.now(UTC) + timedelta(minutes=5)
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": secret}

    result = router.select("qa")
    assert isinstance(result, _SyntheticConfig)


def test_select_uses_degraded_after_ttl():
    router = ProfileRouter()
    secret = _make_secret(status="degraded")
    secret.degraded_until = datetime.now(UTC) - timedelta(seconds=1)
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": secret}

    result = router.select("qa")
    assert result.id == 1
    assert secret.status == "active"


def test_select_handles_naive_degraded_until_expired():
    """回归：DB 返回 naive datetime（已过期）时不得抛 TypeError，应恢复为 active。"""
    router = ProfileRouter()
    secret = _make_secret(status="degraded")
    secret.degraded_until = (datetime.now(UTC) - timedelta(seconds=1)).replace(tzinfo=None)
    assert secret.degraded_until.tzinfo is None
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": secret}

    result = router.select("qa")
    assert result.id == 1
    assert secret.status == "active"


def test_select_handles_naive_degraded_until_active():
    """回归：naive 且未过期的 degraded_until 也不得崩溃，应保持降级。"""
    router = ProfileRouter()
    secret = _make_secret(status="degraded")
    secret.degraded_until = (datetime.now(UTC) + timedelta(minutes=5)).replace(tzinfo=None)
    assert secret.degraded_until.tzinfo is None
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": secret}

    result = router.select("qa")
    assert isinstance(result, _SyntheticConfig)
    assert secret.status == "degraded"


def test_select_all_unavailable():
    router = ProfileRouter()
    secret = _make_secret(status="disabled")
    router._profiles = {secret.id: secret}
    router._bindings = {}

    result = router.select("qa")
    assert isinstance(result, _SyntheticConfig)
    assert result.label == "DeepSeek (env)"
    assert len(result._raw_key) > 0


def test_select_falls_back_to_second_priority():
    """When the cached binding is degraded, select should try next priority profile."""
    router = ProfileRouter()
    secret1 = _make_secret(id=1, label="high-prio", key="key1", suffix="1111", status="degraded", priority=10)
    secret1.degraded_until = datetime.now(UTC) + timedelta(minutes=5)
    secret2 = _make_secret(id=2, label="low-prio", key="key2", suffix="2222", status="active", priority=20)
    router._profiles = {1: secret1, 2: secret2}
    router._bindings = {"qa": secret1}  # cached high-prio is degraded

    result = router.select("qa")
    assert result.id == 2
    assert result.priority == 20


def test_select_uses_highest_priority_active():
    """When no cached binding, iterate profiles by priority and pick best active."""
    router = ProfileRouter()
    secret1 = _make_secret(id=1, label="low-prio", key="key1", suffix="1111", status="active", priority=10)
    secret2 = _make_secret(id=2, label="high-prio", key="key2", suffix="2222", status="active", priority=5)
    router._profiles = {1: secret1, 2: secret2}
    router._bindings = {}

    result = router.select("qa")
    assert result.id == 2  # priority 5 wins over priority 10


@pytest.mark.asyncio
@patch("services.llm_data.LLMDataService.persist_stats")
async def test_report_result_circuit_breaks_on_consecutive_failures(mock_persist):
    router = ProfileRouter()
    secret = _make_secret()
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": secret}

    for _i in range(5):
        await router.report_result(
            secret, success=False, prompt_tokens=0, completion_tokens=0, latency_ms=0, error="timeout"
        )
    assert secret.status == "degraded"
    assert secret.degraded_reason == "consecutive_failures"


@pytest.mark.asyncio
@patch("services.llm_data.LLMDataService.persist_stats")
async def test_report_result_429_sets_rate_limited(mock_persist):
    router = ProfileRouter()
    secret = _make_secret()
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": secret}

    await router.report_result(
        secret, success=False, prompt_tokens=0, completion_tokens=0, latency_ms=0, error="HTTP 429"
    )
    assert secret.status == "degraded"
    assert secret.degraded_reason == "rate_limited"


@pytest.mark.asyncio
@patch("services.llm_data.LLMDataService.persist_stats")
async def test_report_result_success_clears_degraded(mock_persist):
    router = ProfileRouter()
    secret = _make_secret(status="degraded")
    secret.degraded_reason = "rate_limited"
    secret.degraded_until = datetime.now(UTC) + timedelta(minutes=5)
    secret.consecutive_failures = 3
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": secret}

    await router.report_result(
        secret, success=True, prompt_tokens=70, completion_tokens=30, total_tokens=100, latency_ms=50, error=None
    )
    assert secret.status == "active"
    assert secret.degraded_reason is None
    assert secret.consecutive_failures == 0


def test_select_no_config_for_purpose():
    router = ProfileRouter()
    router._profiles = {}
    router._bindings = {}

    result = router.select("scoring")
    assert isinstance(result, _SyntheticConfig)
    assert "env" in result.label.lower()


async def test_env_fallback_circuit_breaks_after_repeated_failures():
    """env 兜底连续失败达阈值后应熔断，select() 快速失败而非无限重试击打死密钥。"""
    import infrastructure.llm.router as router_mod

    router_mod._env_fallback_consecutive_failures = 0
    router_mod._env_fallback_degraded_until = None
    try:
        router = ProfileRouter()
        router._profiles = {}
        router._bindings = {}

        # 未熔断 → 正常返回 env 兜底
        assert isinstance(router.select("scoring"), _SyntheticConfig)

        # 连续失败累计到阈值
        for _ in range(router_mod.CIRCUIT_BREAKER_THRESHOLD):
            await router_mod._record_synthetic_result(
                success=False, error="connection error", prompt_tokens=0, completion_tokens=0
            )

        # 熔断后 select 抛错（全局降级）
        with pytest.raises(RuntimeError):
            router.select("scoring")

        # 成功一次即恢复
        await router_mod._record_synthetic_result(success=True, error=None, prompt_tokens=10, completion_tokens=10)
        assert router_mod._env_fallback_degraded_until is None
    finally:
        router_mod._env_fallback_consecutive_failures = 0
        router_mod._env_fallback_degraded_until = None
