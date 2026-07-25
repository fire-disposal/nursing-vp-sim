"""Extended scoring validation tests for 1.8 — hallucination filtering, clamping, total recalc, missing-zero."""

from contexts.training.scoring._validation import (
    _clamp_scores,
    _filter_hallucinated_dimensions,
    _inject_missing_dimensions,
    _recalc_total_from_dimensions,
)

RUBRIC_SAMPLE = {
    "raw_scale": 3,
    "raw_max": 57,
    "dimensions": [
        {
            "id": "dim_a",
            "name": "问诊完整性",
            "max": 30,
            "items": [{"id": "a1", "name": "现病史"}, {"id": "a2", "name": "既往史"}],
        },
        {"id": "dim_b", "name": "沟通技巧", "max": 15, "items": [{"id": "b1", "name": "共情表达"}]},
        {"id": "dim_c", "name": "临床推理", "max": 12, "items": [{"id": "c1", "name": "鉴别诊断"}]},
    ],
}


class TestFilterHallucinatedDimensions:
    def test_filters_dimension_not_in_rubric(self):
        detail = {"问诊完整性": {"score": 25}, "不存在的维度": {"score": 10}}
        rubric_names = {d["name"] for d in RUBRIC_SAMPLE["dimensions"]}
        result = _filter_hallucinated_dimensions(detail, rubric_names)
        assert "不存在的维度" not in result
        assert "问诊完整性" in result

    def test_keeps_all_valid_dimensions(self):
        detail = {"问诊完整性": {"score": 25}, "沟通技巧": {"score": 10}, "临床推理": {"score": 8}}
        rubric_names = {d["name"] for d in RUBRIC_SAMPLE["dimensions"]}
        result = _filter_hallucinated_dimensions(detail, rubric_names)
        assert len(result) == 3

    def test_returns_empty_dict_when_all_hallucinated(self):
        detail = {"幻觉1": {"score": 10}, "幻觉2": {"score": 20}}
        rubric_names = {d["name"] for d in RUBRIC_SAMPLE["dimensions"]}
        result = _filter_hallucinated_dimensions(detail, rubric_names)
        assert result == {}


class TestClampScores:
    def test_clamps_item_score_to_0_raw_scale(self):
        detail = {"问诊完整性": {"score": 25, "max": 30, "items": [{"score": 5, "max": 3}, {"score": -1, "max": 3}]}}
        _clamp_scores(detail, raw_scale=3)
        assert detail["问诊完整性"]["items"][0]["score"] == 3
        assert detail["问诊完整性"]["items"][1]["score"] == 0

    def test_clamps_dimension_score_to_0_max(self):
        detail = {"问诊完整性": {"score": 35, "max": 30}}
        _clamp_scores(detail, raw_scale=3)
        assert detail["问诊完整性"]["score"] == 30

    def test_clamps_dimension_score_above_0(self):
        detail = {"问诊完整性": {"score": -5, "max": 30}}
        _clamp_scores(detail, raw_scale=3)
        assert detail["问诊完整性"]["score"] == 0


class TestRecalcTotalFromDimensions:
    def test_recalc_total_matches_rounded_weighted_sum(self):
        detail = {
            "问诊完整性": {"score": 25, "max": 30, "items": [{}, {}]},
            "沟通技巧": {"score": 10, "max": 15, "items": [{}]},
            "临床推理": {"score": 8, "max": 12, "items": [{}]},
        }
        total = _recalc_total_from_dimensions(detail, raw_scale=3)
        expected = round(25 * 30 / (2 * 3) + 10 * 15 / (1 * 3) + 8 * 12 / (1 * 3))
        assert total == expected

    def test_skips_dim_without_items(self):
        detail = {"问诊完整性": {"score": 10, "max": 10}}
        total = _recalc_total_from_dimensions(detail, raw_scale=3)
        assert total == 10  # no items → adds raw score directly


class TestInjectMissingDimensions:
    def test_adds_missing_dimension_with_zero_score(self):
        detail = {"问诊完整性": {"score": 25, "max": 30, "items": [{}, {}]}}
        rubric = RUBRIC_SAMPLE
        _inject_missing_dimensions(detail, rubric)
        assert "沟通技巧" in detail
        assert detail["沟通技巧"]["score"] == 0
        assert detail["沟通技巧"].get("_injected") is True

    def test_does_not_override_existing_dimension(self):
        detail = {"问诊完整性": {"score": 25, "max": 30, "items": [{}, {}]}}
        rubric = RUBRIC_SAMPLE
        _inject_missing_dimensions(detail, rubric)
        assert detail["问诊完整性"]["score"] == 25
