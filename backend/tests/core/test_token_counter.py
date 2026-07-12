from infrastructure.llm.token_counter import estimate_cost_cny


def test_pro_model_priced_by_model_not_key_flat_price():
    # key 价为 flash(1/2)，但模型是 pro(3/6) —— 必须按模型 3/6 计。
    cost = estimate_cost_cny(1_000_000, 1_000_000, price_input=1.0, price_output=2.0, model="deepseek-v4-pro")
    assert cost == 9.0  # 3 + 6，而非旧行为的 3.0 (1+2)


def test_flash_model_priced_by_model():
    cost = estimate_cost_cny(1_000_000, 1_000_000, model="deepseek-v4-flash")
    assert cost == 3.0  # 1 + 2


def test_no_model_falls_back_to_key_price():
    cost = estimate_cost_cny(1_000_000, 0, price_input=5.0, price_output=9.0)
    assert cost == 5.0


def test_cache_hit_priced_lower():
    # pro：100万 prompt 全部命中缓存 + 0 输出。命中价 ¥0.025/1M，远低于满价 ¥3。
    cost = estimate_cost_cny(1_000_000, 0, model="deepseek-v4-pro", cache_hit_tokens=1_000_000)
    assert cost == 0.025


def test_cache_hit_partial_split():
    # pro：50 万命中(0.025) + 50 万未命中(3) + 0 输出 = 0.0125 + 1.5 = 1.5125
    cost = estimate_cost_cny(1_000_000, 0, model="deepseek-v4-pro", cache_hit_tokens=500_000)
    assert cost == round(500_000 / 1_000_000 * 3.0 + 500_000 / 1_000_000 * 0.025, 6)
