"""成绩管理纯逻辑测试 — 好中差分档与进步幅度计算（无数据库）。"""

from datetime import UTC, datetime

from modules.scoreboard.service import compute_progress, tier_for_score
from schemas.scoreboard import (
    TIER_GOOD,
    TIER_MEDIUM,
    TIER_NONE,
    TIER_POOR,
    TREND_DOWN,
    TREND_FLAT,
    TREND_NONE,
    TREND_UP,
)


def _t(day: int, score: float) -> tuple[datetime, float]:
    return datetime(2026, 3, day, tzinfo=UTC), score


class TestTierForScore:
    def test_good_at_85(self):
        assert tier_for_score(85.0) == TIER_GOOD

    def test_good_above_85(self):
        assert tier_for_score(95.5) == TIER_GOOD

    def test_medium_at_60(self):
        assert tier_for_score(60.0) == TIER_MEDIUM

    def test_medium_between(self):
        assert tier_for_score(72.3) == TIER_MEDIUM

    def test_poor_below_60(self):
        assert tier_for_score(59.9) == TIER_POOR
        assert tier_for_score(0.0) == TIER_POOR

    def test_none_returns_none_tier(self):
        assert tier_for_score(None) == TIER_NONE


class TestComputeProgress:
    def test_insufficient_records_returns_none(self):
        assert compute_progress([]) == (None, TREND_NONE)
        assert compute_progress([_t(1, 80.0)]) == (None, TREND_NONE)

    def test_improvement_scores_up(self):
        rows = [_t(1, 60.0), _t(2, 70.0), _t(3, 80.0), _t(4, 90.0)]
        delta, trend = compute_progress(rows)
        assert delta == 20.0
        assert trend == TREND_UP

    def test_decline_scores_down(self):
        rows = [_t(1, 90.0), _t(2, 80.0), _t(3, 70.0), _t(4, 60.0)]
        delta, trend = compute_progress(rows)
        assert delta == -20.0
        assert trend == TREND_DOWN

    def test_flat_within_threshold(self):
        rows = [_t(1, 80.0), _t(2, 81.0), _t(3, 79.0), _t(4, 80.5)]
        delta, trend = compute_progress(rows)
        assert delta == -0.8  # 后半 (79, 80.5) 均 79.75 − 前半 (80, 81) 均 80.5
        assert trend == TREND_FLAT

    def test_odd_count_splits_later_half_larger(self):
        rows = [_t(1, 60.0), _t(2, 60.0), _t(3, 90.0)]
        delta, trend = compute_progress(rows)
        assert delta == 15.0  # 后半 [60, 90] 均 75 − 前半 [60] 均 60
        assert trend == TREND_UP

    def test_chronological_order_matters(self):
        rows = [_t(3, 90.0), _t(2, 60.0), _t(1, 60.0)]
        delta, trend = compute_progress(rows)
        assert delta == -30.0  # 按传入顺序，前半 [90] 后半 [60, 60]
        assert trend == TREND_DOWN
