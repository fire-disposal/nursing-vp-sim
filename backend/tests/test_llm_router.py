"""tests for ProfileRouter purpose-based routing"""

from datetime import UTC, datetime, timedelta

from models import ApiSecret, LLMConfig
from services.llm_router import ProfileRouter, _SyntheticConfig


def _make_secret(id=1, label="test-secret", key="encrypted-test-key", suffix="xxxx", status="active"):
    return ApiSecret(
        id=id, label=label, encrypted_key=key, key_suffix=suffix, status=status,
        consecutive_failures=0, price_input_per_1m=0, price_output_per_1m=0,
        call_count_today=0, total_tokens_today=0, total_cost_today=0,
        monthly_cost_used=0,
    )


def _make_config(id, secret, purpose="qa", model="test-model", status="active"):
    c = LLMConfig(id=id, secret_id=secret.id, model=model, purpose=purpose, status=status)
    c.secret = secret
    return c


def test_select_single_binding():
    router = ProfileRouter()
    secret = _make_secret()
    cfg = _make_config(1, secret)
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": cfg}

    result = router.select("qa")
    assert result.id == 1


def test_select_skips_disabled_binding():
    router = ProfileRouter()
    secret = _make_secret()
    cfg = _make_config(1, secret, status="disabled")
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": cfg}

    result = router.select("qa")
    assert isinstance(result, _SyntheticConfig)


def test_select_skips_degraded_profile():
    router = ProfileRouter()
    secret = _make_secret(status="degraded")
    secret.degraded_until = datetime.now(UTC) + timedelta(minutes=5)
    cfg = _make_config(1, secret)
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": cfg}

    result = router.select("qa")
    assert isinstance(result, _SyntheticConfig)


def test_select_uses_degraded_after_ttl():
    router = ProfileRouter()
    secret = _make_secret(status="degraded")
    secret.degraded_until = datetime.now(UTC) - timedelta(seconds=1)
    cfg = _make_config(1, secret)
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": cfg}

    result = router.select("qa")
    assert result.id == 1
    assert secret.status == "active"


def test_select_all_unavailable():
    router = ProfileRouter()
    secret = _make_secret(status="disabled")
    cfg = _make_config(1, secret, status="disabled")
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": cfg}

    result = router.select("qa")
    assert isinstance(result, _SyntheticConfig)
    assert result.label == "DeepSeek (env)"
    assert len(result._raw_key) > 0


def test_report_result_circuit_breaks_on_consecutive_failures():
    router = ProfileRouter()
    secret = _make_secret()
    cfg = _make_config(1, secret)
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": cfg}

    for _i in range(5):
        router.report_result(cfg, success=False, tokens=0, latency_ms=0, error="timeout")
    assert secret.status == "degraded"
    assert secret.degraded_reason == "consecutive_failures"


def test_report_result_429_sets_rate_limited():
    router = ProfileRouter()
    secret = _make_secret()
    cfg = _make_config(1, secret)
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": cfg}

    router.report_result(cfg, success=False, tokens=0, latency_ms=0, error="HTTP 429")
    assert secret.status == "degraded"
    assert secret.degraded_reason == "rate_limited"


def test_report_result_success_clears_degraded():
    router = ProfileRouter()
    secret = _make_secret(status="degraded")
    secret.degraded_reason = "rate_limited"
    secret.degraded_until = datetime.now(UTC) + timedelta(minutes=5)
    secret.consecutive_failures = 3
    cfg = _make_config(1, secret)
    router._profiles = {secret.id: secret}
    router._bindings = {"qa": cfg}

    router.report_result(cfg, success=True, tokens=100, latency_ms=50, error=None)
    assert secret.status == "active"
    assert secret.degraded_reason is None
    assert secret.consecutive_failures == 0


def test_select_no_config_for_purpose():
    router = ProfileRouter()
    router._profiles = {}
    router._bindings = {"qa": None}

    result = router.select("scoring")
    assert isinstance(result, _SyntheticConfig)
    assert "env" in result.label.lower()


def test_select_falls_back_to_wildcard():
    secret = _make_secret(id=99)
    wildcard_cfg = _make_config(99, secret, purpose="*", model="gpt-4")

    router = ProfileRouter()
    router._profiles = {secret.id: secret}
    router._bindings = {"*": wildcard_cfg}

    result = router.select("patient_chat")
    assert result is wildcard_cfg


def test_select_wildcard_fallback_for_star():
    router = ProfileRouter()
    router._profiles = {}
    router._bindings = {}

    result = router.select("*")
    assert isinstance(result, _SyntheticConfig)
    assert len(result._raw_key) > 0
