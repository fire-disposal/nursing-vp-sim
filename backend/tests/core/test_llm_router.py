"""tests for ProfileRouter priority-based routing (post-Fernet removal)"""

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import time
import pytest

from infrastructure.llm import ProfileRouter
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


def test_select_skips_disabled_secret_raises():
    router = ProfileRouter()
    secret = _make_secret(status="disabled")
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": secret}

    with pytest.raises(RuntimeError, match="无可用密钥"):
        router.select("qa")


def test_select_skips_degraded_profile_raises():
    router = ProfileRouter()
    secret = _make_secret(status="degraded")
    secret.degraded_until = datetime.now(UTC) + timedelta(minutes=5)
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": secret}

    with pytest.raises(RuntimeError, match="无可用密钥"):
        router.select("qa")


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
    secret.degraded_until = datetime.utcnow() - timedelta(minutes=10)  # naive UTC, expired
    secret._last_db_check = time.monotonic()  # suppress DB refresh
    router._bindings = {"qa": secret}

    router.select("qa")
    assert secret.status == "active"


def test_select_handles_naive_degraded_until_active():
    """回归：naive 且未过期的 degraded_until 也不得崩溃，应保持降级。"""
    router = ProfileRouter()
    secret = _make_secret(status="degraded")
    secret.degraded_until = datetime.utcnow() + timedelta(minutes=10)  # naive UTC, active
    secret._last_db_check = time.monotonic()  # suppress DB refresh
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": secret}

    with pytest.raises(RuntimeError, match="无可用密钥"):
        router.select("qa")
    assert secret.status == "degraded"


def test_select_all_unavailable_raises():
    router = ProfileRouter()
    secret = _make_secret(status="degraded")
    secret.degraded_until = datetime.now(UTC) + timedelta(minutes=10)
    router._profiles = {secret.id: secret}

    with pytest.raises(RuntimeError, match="无可用密钥"):
        router.select("qa")


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


def test_select_no_config_for_purpose_raises():
    router = ProfileRouter()

    with pytest.raises(RuntimeError, match="无可用密钥"):
        router.select("qa")


@pytest.mark.asyncio
@patch("services.llm_data.LLMDataService.persist_stats")
async def test_report_result_circuit_breaks_on_consecutive_failures(mock_persist):
    router = ProfileRouter()
    secret = _make_secret()
    router._profiles = {secret.id: secret}

    for _ in range(5):
        await router.report_result(secret, success=False, error="timeout")

    assert secret.status == "degraded"
    assert secret.degraded_reason == "consecutive_failures"


@pytest.mark.asyncio
@patch("services.llm_data.LLMDataService.persist_stats")
async def test_report_result_429_sets_rate_limited(mock_persist):
    router = ProfileRouter()
    secret = _make_secret()
    router._profiles = {secret.id: secret}

    await router.report_result(secret, success=False, error="429 Too Many Requests")

    assert secret.status == "degraded"
    assert secret.degraded_reason == "rate_limited"


@pytest.mark.asyncio
@patch("services.llm_data.LLMDataService.persist_stats")
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
