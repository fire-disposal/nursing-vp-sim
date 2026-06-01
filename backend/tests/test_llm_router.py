"""tests for ConfigRouter priority-based degradation routing"""
import pytest
from datetime import datetime, timezone, timedelta
from services.llm_router import ConfigRouter
from models import LLMConfig, ApiSecret


def _make_secret(id=1, label="test-secret", key="encrypted-test-key", suffix="xxxx"):
    s = ApiSecret(id=id, label=label, encrypted_key=key, key_suffix=suffix)
    return s


def _make_config(id, secret, purpose="qa", priority=10, status="active",
                 model="test-model", base_url="https://test.api",
                 consecutive_failures=0, degraded_reason=None,
                 degraded_until=None):
    c = LLMConfig(
        id=id, secret_id=secret.id, label=f"cfg-{id}",
        base_url=base_url, model=model,
        purpose=purpose, priority=priority, status=status,
        consecutive_failures=consecutive_failures,
        degraded_reason=degraded_reason,
        degraded_until=degraded_until,
        price_input_per_1m=1, price_output_per_1m=2,
    )
    c.secret = secret
    return c


def test_select_key_single_config():
    router = ConfigRouter()
    secret = _make_secret()
    cfg = _make_config(1, secret)
    router._cache_by_purpose = {"qa": [cfg]}

    result = router.select_key("qa")
    assert result.id == 1


def test_select_key_skips_disabled():
    router = ConfigRouter()
    secret = _make_secret()
    cfg1 = _make_config(1, secret, priority=10, status="disabled")
    cfg2 = _make_config(2, secret, priority=20, status="active")
    router._cache_by_purpose = {"qa": [cfg1, cfg2]}

    result = router.select_key("qa")
    assert result.id == 2


def test_select_key_skips_degraded_in_cooldown():
    router = ConfigRouter()
    secret = _make_secret()
    cfg1 = _make_config(1, secret, priority=10, status="degraded",
                        degraded_until=datetime.now(timezone.utc) + timedelta(minutes=5))
    cfg2 = _make_config(2, secret, priority=20, status="active")
    router._cache_by_purpose = {"qa": [cfg1, cfg2]}

    result = router.select_key("qa")
    assert result.id == 2


def test_select_key_uses_degraded_after_ttl():
    router = ConfigRouter()
    secret = _make_secret()
    cfg1 = _make_config(1, secret, priority=10, status="degraded",
                        degraded_until=datetime.now(timezone.utc) - timedelta(seconds=1))
    cfg2 = _make_config(2, secret, priority=20, status="active")
    router._cache_by_purpose = {"qa": [cfg1, cfg2]}

    result = router.select_key("qa")
    assert result.id == 1


def test_select_key_all_unavailable():
    router = ConfigRouter()
    secret = _make_secret()
    cfg = _make_config(1, secret, status="disabled")
    router._cache_by_purpose = {"qa": [cfg]}

    with pytest.raises(RuntimeError, match="无可用配置"):
        router.select_key("qa")


def test_report_result_consecutive_failures_circuit_break():
    router = ConfigRouter()
    secret = _make_secret()
    cfg = _make_config(1, secret)
    router._cache_by_purpose = {"qa": [cfg]}

    for i in range(5):
        router.report_result(cfg, success=False, tokens=0, latency_ms=0, error="timeout")
    assert cfg.status == "degraded"
    assert cfg.degraded_reason == "consecutive_failures"


def test_report_result_429_sets_rate_limited():
    router = ConfigRouter()
    secret = _make_secret()
    cfg = _make_config(1, secret)
    router._cache_by_purpose = {"qa": [cfg]}

    router.report_result(cfg, success=False, tokens=0, latency_ms=0, error="HTTP 429")
    assert cfg.status == "degraded"
    assert cfg.degraded_reason == "rate_limited"


def test_report_result_success_clears_degraded():
    router = ConfigRouter()
    secret = _make_secret()
    cfg = _make_config(1, secret, status="degraded", degraded_reason="rate_limited",
                       degraded_until=datetime.now(timezone.utc) + timedelta(minutes=5),
                       consecutive_failures=3)
    router._cache_by_purpose = {"qa": [cfg]}

    router.report_result(cfg, success=True, tokens=100, latency_ms=50, error=None)
    assert cfg.status == "active"
    assert cfg.degraded_reason is None
    assert cfg.consecutive_failures == 0


def test_select_key_no_config_for_purpose():
    router = ConfigRouter()
    router._cache_by_purpose = {"qa": []}

    with pytest.raises(RuntimeError, match="无可用配置"):
        router.select_key("scoring")


def test_select_key_falls_back_to_wildcard():
    from models import LLMConfig

    wildcard_cfg = LLMConfig(
        id=99, secret_id=1, label="catch-all",
        base_url="https://api.wildcard.com", model="gpt-4",
        purpose="*", priority=100,
    )

    router = ConfigRouter()
    router._cache_by_purpose = {
        "patient_chat": [],
        "*": [wildcard_cfg],
    }

    result = router.select_key("patient_chat")
    assert result is wildcard_cfg


def test_select_key_wildcard_no_fallback_for_star_itself():
    router = ConfigRouter()
    router._cache_by_purpose = {}

    with pytest.raises(RuntimeError, match="无可用配置"):
        router.select_key("*")
