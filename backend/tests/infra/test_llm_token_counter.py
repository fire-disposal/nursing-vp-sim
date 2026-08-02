"""tests for DeepSeek peak/off-peak pricing (时区校准 + 峰谷边界)"""

from datetime import UTC, datetime, timedelta, timezone
from unittest.mock import patch

from infra.llm.token_counter import estimate_cost_cny, is_peak_hour, peak_multiplier

_BEIJING = timezone(timedelta(hours=8))


def _bj(hour: int, minute: int = 0) -> datetime:
    """构造指定北京时间的 UTC-aware datetime。"""
    return datetime(2026, 8, 2, hour, minute, tzinfo=_BEIJING)


# ── is_peak_hour 北京时间边界 ──


def test_peak_boundary_0859_flat():
    assert not is_peak_hour(_bj(8, 59))


def test_peak_boundary_0900_peak():
    assert is_peak_hour(_bj(9, 0))


def test_peak_boundary_1159_peak():
    assert is_peak_hour(_bj(11, 59))


def test_peak_boundary_1200_flat():
    assert not is_peak_hour(_bj(12, 0))


def test_peak_boundary_1359_flat():
    assert not is_peak_hour(_bj(13, 59))


def test_peak_boundary_1400_peak():
    assert is_peak_hour(_bj(14, 0))


def test_peak_boundary_1759_peak():
    assert is_peak_hour(_bj(17, 59))


def test_peak_boundary_1800_flat():
    assert not is_peak_hour(_bj(18, 0))


def test_peak_midnight_flat():
    assert not is_peak_hour(_bj(0, 0))


# ── 时区校准：UTC 时刻须换算为北京时间判定 ──


def test_utc_morning_is_beijing_peak():
    """UTC 01:30 = 北京 09:30（高峰）。若误用 UTC 小时判定会得到平峰，必须校准。"""
    utc_ts = datetime(2026, 8, 2, 1, 30, tzinfo=UTC)
    assert utc_ts.hour == 1  # 防呆：确认 UTC 视角确实非高峰
    assert is_peak_hour(utc_ts)


def test_utc_afternoon_is_beijing_flat():
    """UTC 06:00 = 北京 14:00（高峰）。"""
    utc_ts = datetime(2026, 8, 2, 6, 0, tzinfo=UTC)
    assert is_peak_hour(utc_ts)


def test_utc_evening_is_beijing_flat():
    """UTC 12:30 = 北京 20:30（平峰，且 UTC 视角亦非高峰）。"""
    utc_ts = datetime(2026, 8, 2, 12, 30, tzinfo=UTC)
    assert not is_peak_hour(utc_ts)


def test_naive_datetime_treated_as_utc():
    """naive datetime 视为 UTC（与 ensure_utc 约定一致），00:30 UTC = 08:30 北京 → 平峰。"""
    naive = datetime(2026, 8, 2, 0, 30)  # noqa: DTZ001 — 有意构造 naive 测行为
    assert not is_peak_hour(naive)


# ── peak_multiplier：默认关闭 → 恒 1.0；开启后高峰 ×2 ──


def test_multiplier_disabled_by_default():
    with patch("core.config.LLM_PEAK_PRICING_ENABLED", new=False):
        assert peak_multiplier(_bj(10, 0)) == 1.0
        assert peak_multiplier(_bj(20, 0)) == 1.0


def test_multiplier_enabled_peak_vs_flat():
    with patch("core.config.LLM_PEAK_PRICING_ENABLED", new=True):
        assert peak_multiplier(_bj(10, 0)) == 2.0
        assert peak_multiplier(_bj(20, 0)) == 1.0


def test_multiplier_custom_rate():
    with patch("core.config.LLM_PEAK_PRICING_ENABLED", new=True), patch("core.config.LLM_PEAK_MULTIPLIER", new=1.5):
        assert peak_multiplier(_bj(15, 0)) == 1.5


# ── estimate_cost_cny：峰谷作用于所有计费项（输入/输出/缓存命中） ──


def test_estimate_cost_flat_by_default():
    """默认关闭峰谷时，高峰时刻成本与平峰相同。"""
    cost = estimate_cost_cny(1_000_000, 500_000, model="deepseek-v4-flash", at=_bj(10, 0))
    assert cost == 1.0 + 1.0  # 输入 ¥1 + 输出 ¥2 × 0.5M = ¥1


def test_estimate_cost_peak_doubles_all_items():
    """开启后高峰 ×2：输入 1M×¥1 + 输出 0.5M×¥2 + 缓存命中 0.5M×¥0.02。"""
    with patch("core.config.LLM_PEAK_PRICING_ENABLED", new=True):
        flat = estimate_cost_cny(1_000_000, 500_000, model="deepseek-v4-flash", cache_hit_tokens=500_000, at=_bj(20, 0))
        peak = estimate_cost_cny(1_000_000, 500_000, model="deepseek-v4-flash", cache_hit_tokens=500_000, at=_bj(10, 0))
    assert peak == round(flat * 2, 6)


def test_estimate_cost_timezone_calibration():
    """同一 UTC 时刻，跨北京高峰边界前后成本不同（时区校准核心）。"""
    with patch("core.config.LLM_PEAK_PRICING_ENABLED", new=True):
        before = datetime(2026, 8, 2, 0, 59, 59, tzinfo=UTC)  # 北京 08:59:59 平峰
        after = datetime(2026, 8, 2, 1, 0, 0, tzinfo=UTC)  # 北京 09:00:00 高峰
        c_before = estimate_cost_cny(1_000_000, 0, model="deepseek-v4-flash", at=before)
        c_after = estimate_cost_cny(1_000_000, 0, model="deepseek-v4-flash", at=after)
    assert c_before == 1.0
    assert c_after == 2.0
