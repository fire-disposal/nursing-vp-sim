"""tests for LLMRouter priority-based weighted routing"""
import pytest
from services.llm_router import LLMRouter

router = LLMRouter()


def _make_config(keys_data):
    """Simulate config loaded from DB: {provider_id: {provider, keys}}"""
    providers = {}
    for pid, pd in keys_data.items():
        p = type("p", (), {
            "id": pid, "name": pd["name"], "display_name": pd["name"],
            "base_url": pd["base_url"], "default_model": pd.get("model", "gpt-4"),
            "is_enabled": pd.get("is_enabled", True),
            "priority": pd.get("provider_priority", 10),
        })()
        keys = []
        for kd in pd["keys"]:
            k = type("k", (), {
                "id": kd["id"], "provider_id": pid, "label": kd.get("label", ""),
                "model": kd.get("model"), "weight": kd.get("weight", 10),
                "status": kd.get("status", "active"),
                "purpose": kd.get("purpose", "*"),
                "priority": kd.get("priority", 100),
                "consecutive_failures": kd.get("consecutive_failures", 0),
                "rate_limit_until": None,
                "price_input_per_1m": 0, "price_output_per_1m": 0,
                "encrypted_key": kd.get("encrypted_key", "enc-test"),
            })()
            keys.append(k)
        p.keys = keys
        providers[pid] = {"provider": p, "keys": keys}
    return providers


def test_select_key_single():
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://api.deepseek.com",
            "provider_priority": 10,
            "keys": [{"id": 1, "purpose": "patient_chat", "priority": 10}]}
    })
    router._load_config(cfg)
    key, provider = router.select_key("patient_chat")
    assert key.id == 1
    assert provider.name == "deepseek"


def test_select_key_weight_zero_never_chosen():
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com",
            "keys": [
                {"id": 1, "weight": 10, "purpose": "*"},
                {"id": 2, "weight": 0, "purpose": "*"},
            ]}
    })
    router._load_config(cfg)
    results = [router.select_key("*")[0].id for _ in range(100)]
    assert results.count(1) == 100
    assert results.count(2) == 0


def test_select_key_provider_failover():
    """provider_priority controls failover order"""
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com", "provider_priority": 10,
            "keys": [{"id": 1, "purpose": "scoring", "weight": 10}]},
        2: {"name": "openai", "base_url": "https://x.com", "provider_priority": 20,
            "keys": [{"id": 2, "purpose": "scoring", "weight": 10}]},
    })
    router._load_config(cfg)
    key, provider = router.select_key("scoring")
    assert key.id == 1
    assert provider.name == "deepseek"


def test_select_key_disabled_skipped_then_provider_failover():
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com", "provider_priority": 10,
            "keys": [{"id": 1, "purpose": "scoring", "status": "disabled"}]},
        2: {"name": "openai", "base_url": "https://x.com", "provider_priority": 20,
            "keys": [{"id": 2, "purpose": "scoring"}]},
    })
    router._load_config(cfg)
    key, provider = router.select_key("scoring")
    assert key.id == 2
    assert provider.name == "openai"


def test_select_key_wildcard_purpose():
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com",
            "keys": [{"id": 1, "purpose": "*"}]}
    })
    router._load_config(cfg)
    key, _ = router.select_key("scoring")
    assert key.id == 1


def test_select_key_specific_purpose_preferred_over_wildcard():
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com",
            "keys": [
                {"id": 1, "purpose": "patient_chat"},
                {"id": 2, "purpose": "*"},
            ]}
    })
    router._load_config(cfg)
    key, _ = router.select_key("scoring")
    assert key.id == 2  # wildcard matches
    key, _ = router.select_key("patient_chat")
    assert key.id == 1  # specific matches


def test_select_key_all_unavailable():
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com",
            "keys": [{"id": 1, "purpose": "qa", "status": "disabled"}]}
    })
    router._load_config(cfg)
    with pytest.raises(RuntimeError, match="无可用"):
        router.select_key("qa")


def test_select_key_rate_limited_skipped_then_fallback():
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com", "provider_priority": 10,
            "keys": [{"id": 1, "purpose": "*", "status": "rate_limited"}]},
        2: {"name": "openai", "base_url": "https://x.com", "provider_priority": 20,
            "keys": [{"id": 2, "purpose": "*"}]},
    })
    router._load_config(cfg)
    key, provider = router.select_key("*")
    assert key.id == 2
    assert provider.name == "openai"


def test_report_result_success_resets_failures():
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com",
            "keys": [{"id": 1, "purpose": "*", "consecutive_failures": 4}]}
    })
    router._load_config(cfg)
    key, _ = router.select_key("*")
    assert key.consecutive_failures == 4
    router.report_result(1, success=True, tokens=100, latency_ms=500, error=None)
    assert key.consecutive_failures == 0


def test_report_result_429_sets_rate_limited():
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com",
            "keys": [{"id": 1, "purpose": "*"}]}
    })
    router._load_config(cfg)
    router.report_result(1, success=False, tokens=0, latency_ms=100,
                         error="HTTP 429: rate limited")
    key = router._get_key(1)
    assert key.status == "rate_limited"
    assert key.rate_limit_until is not None


def test_report_result_consecutive_failures_circuit_break():
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com",
            "keys": [{"id": 1, "purpose": "*"}]}
    })
    router._load_config(cfg)
    key = router._get_key(1)
    for _ in range(5):
        router.report_result(1, success=False, tokens=0, latency_ms=100, error="500 error")
    assert key.status == "disabled"


def test_get_decrypted_key():
    from services.crypto_utils import encrypt_api_key
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com",
            "keys": [{"id": 1, "purpose": "*",
                       "encrypted_key": encrypt_api_key("sk-real-key")}]}
    })
    router._load_config(cfg)
    key = router.get_decrypted_key(1)
    assert key == "sk-real-key"


def test_select_key_returns_provider_info():
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://api.deepseek.com", "model": "deepseek-chat",
            "keys": [{"id": 1, "purpose": "scoring", "model": "deepseek-reasoner"}]}
    })
    router._load_config(cfg)
    key, provider = router.select_key("scoring")
    assert key.id == 1
    assert key.model == "deepseek-reasoner"
    assert provider.name == "deepseek"
    assert provider.base_url == "https://api.deepseek.com"


def test_select_key_same_provider_weighted_distribution():
    """Weighted random within same provider should distribute proportionally"""
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com",
            "keys": [
                {"id": 1, "purpose": "*", "weight": 8},
                {"id": 2, "purpose": "*", "weight": 2},
            ]}
    })
    router._load_config(cfg)
    results = [router.select_key("*")[0].id for _ in range(100)]
    # key 1 (weight 8) should be selected much more often than key 2 (weight 2)
    assert results.count(1) > results.count(2)
