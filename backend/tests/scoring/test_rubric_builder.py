"""build_final_rubric 纯函数单元测试"""

from contexts.training.rubric_builder import build_final_rubric

BASE_RUBRIC = {
    "id": "test_v1",
    "name": "测试评分标准",
    "raw_max": 57,
    "dimensions": [
        {"id": "comm", "name": "沟通技能", "max": 42, "items": []},
    ],
}


class TestBuildFinalRubric:
    def test_without_nursing_record_returns_deep_copy(self):
        result = build_final_rubric(BASE_RUBRIC, features={})
        assert result["raw_max"] == 57
        assert len(result["dimensions"]) == 1
        assert len(BASE_RUBRIC["dimensions"]) == 1
        result["dimensions"].append({"id": "extra", "name": "x", "max": 0, "items": []})
        assert len(BASE_RUBRIC["dimensions"]) == 1

    def test_without_nursing_record_features_none(self):
        result = build_final_rubric(BASE_RUBRIC, features=None)
        assert result["raw_max"] == 57
        assert len(result["dimensions"]) == 1

    def test_with_nursing_record_enabled(self):
        # [DISABLED] nursing_record 评分维度已暂时禁用，此测试反映当前行为
        result = build_final_rubric(BASE_RUBRIC, features={"nursing_record": True})
        assert result["raw_max"] == 57  # disabled: raw_max unchanged
        assert len(result["dimensions"]) == 1  # disabled: no nursing_record dimension added
        assert len(BASE_RUBRIC["dimensions"]) == 1  # original untouched
        assert BASE_RUBRIC["raw_max"] == 57

    def test_nursing_record_feature_false(self):
        result = build_final_rubric(BASE_RUBRIC, features={"nursing_record": False})
        assert result["raw_max"] == 57
        assert len(result["dimensions"]) == 1

    def test_nursing_record_missing_key(self):
        result = build_final_rubric(BASE_RUBRIC, features={"emotion": True})
        assert result["raw_max"] == 57
        assert len(result["dimensions"]) == 1

    def test_idempotent_double_call(self):
        # [DISABLED] nursing_record scoring disabled — idempotent call returns same
        r1 = build_final_rubric(BASE_RUBRIC, features={"nursing_record": True})
        r2 = build_final_rubric(r1, features={"nursing_record": True})
        assert len(r2["dimensions"]) == 1  # disabled: no dimension added
        assert r2["raw_max"] == 57  # disabled: raw_max unchanged
