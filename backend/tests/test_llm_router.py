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
            "priority": pd.get("provider_priority", 100),
        })()
        keys = []
        for kd in pd["keys"]:
            k = type("k", (), {
                "id": kd["id"], "provider_id": pid, "label": kd.get("label", ""),
                "model": kd.get("model"), "weight": kd.get("weight", 10),
                "status": kd.get("status", "active"),
                "consecutive_failures": kd.get("consecutive_failures", 0),
                "rate_limit_until": None,
                "price_input_per_1m": 0, "price_output_per_1m": 0,
                "encrypted_key": kd.get("encrypted_key", "enc-test"),
            })()
            rules = []
            for rd in kd.get("rules", []):
                r = type("r", (), {
                    "id": rd.get("id", 1), "api_key_id": kd["id"],
                    "purpose": rd["purpose"], "priority": rd["priority"],
                    "is_enabled": rd.get("is_enabled", True),
                })()
                rules.append(r)
            k.rules = rules
            keys.append(k)
        p.keys = keys
        providers[pid] = {"provider": p, "keys": keys}
    return providers


def test_select_key_single():
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://api.deepseek.com",
            "keys": [{"id": 1, "rules": [{"purpose": "patient_chat", "priority": 10}]}]}
    })
    router._load_config(cfg)
    key, provider = router.select_key("patient_chat")
    assert key.id == 1
    assert provider.name == "deepseek"


def test_select_key_weight_zero_never_chosen():
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com",
            "keys": [
                {"id": 1, "weight": 10, "rules": [{"purpose": "*", "priority": 10}]},
                {"id": 2, "weight": 0, "rules": [{"purpose": "*", "priority": 10}]},
            ]}
    })
    router._load_config(cfg)
    results = [router.select_key("*")[0].id for _ in range(100)]
    assert results.count(1) == 100
    assert results.count(2) == 0


def test_select_key_fallback_priority():
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com",
            "keys": [
                {"id": 1, "weight": 10, "rules": [{"purpose": "scoring", "priority": 10}]},
                {"id": 2, "weight": 10, "rules": [{"purpose": "scoring", "priority": 20}]},
            ]}
    })
    router._load_config(cfg)
    key, _ = router.select_key("scoring")
    assert key.id == 1


def test_select_key_disabled_skipped():
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com",
            "keys": [
                {"id": 1, "status": "disabled", "rules": [{"purpose": "scoring", "priority": 10}]},
                {"id": 2, "rules": [{"purpose": "scoring", "priority": 20}]},
            ]}
    })
    router._load_config(cfg)
    key, _ = router.select_key("scoring")
    assert key.id == 2


def test_select_key_fallback_wildcard():
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com",
            "keys": [{"id": 1, "rules": [
                {"purpose": "patient_chat", "priority": 10},
                {"purpose": "*", "priority": 50},
            ]}]}
    })
    router._load_config(cfg)
    key, _ = router.select_key("scoring")
    assert key.id == 1


def test_select_key_all_unavailable():
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com",
            "keys": [{"id": 1, "status": "disabled",
                       "rules": [{"purpose": "qa", "priority": 10}]}]}
    })
    router._load_config(cfg)
    with pytest.raises(RuntimeError, match="无可用"):
        router.select_key("qa")


def test_select_key_rate_limited_skipped():
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com",
            "keys": [
                {"id": 1, "status": "rate_limited",
                 "rules": [{"purpose": "*", "priority": 10}]},
                {"id": 2, "rules": [{"purpose": "*", "priority": 20}]},
            ]}
    })
    router._load_config(cfg)
    key, _ = router.select_key("*")
    assert key.id == 2


def test_report_result_success_resets_failures():
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com",
            "keys": [{"id": 1, "consecutive_failures": 4,
                       "rules": [{"purpose": "*", "priority": 10}]}]}
    })
    router._load_config(cfg)
    key, _ = router.select_key("*")
    assert key.consecutive_failures == 4
    router.report_result(1, success=True, tokens=100, latency_ms=500, error=None)
    assert key.consecutive_failures == 0


def test_report_result_429_sets_rate_limited():
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com",
            "keys": [{"id": 1, "rules": [{"purpose": "*", "priority": 10}]}]}
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
            "keys": [{"id": 1, "rules": [{"purpose": "*", "priority": 10}]}]}
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
            "keys": [{"id": 1, "encrypted_key": encrypt_api_key("sk-real-key"),
                       "rules": [{"purpose": "*", "priority": 10}]}]}
    })
    router._load_config(cfg)
    key = router.get_decrypted_key(1)
    assert key == "sk-real-key"


def test_select_key_returns_provider_info():
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://api.deepseek.com", "model": "deepseek-chat",
            "keys": [{"id": 1, "model": "deepseek-reasoner",
                       "rules": [{"purpose": "scoring", "priority": 10}]}]}
    })
    router._load_config(cfg)
    key, provider = router.select_key("scoring")
    assert key.id == 1
    assert key.model == "deepseek-reasoner"
    assert provider.name == "deepseek"
    assert provider.base_url == "https://api.deepseek.com"
