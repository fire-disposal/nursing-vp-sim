"""Rubric 单一真相（SSOT = ``scoring/rubric.json``，只经 ``rubric_loader`` 读取）。

守护：
- 基准 rubric 只有一个加载入口；``HISTORY_TAKING.rubric`` 是它的副本（不共享可变对象）。
- 基准 rubric 自身自洽：``Σ 维度 max == raw_max == Σ 条目数 × raw_scale``；
  ``build_final_rubric`` 追加"护理记录"维度后仍然自洽（该追加行为是病例能力开关的一部分）。
"""

from __future__ import annotations

import importlib

import pytest

from modules.training.profile import HISTORY_TAKING
from modules.training.scoring.rubric import build_final_rubric
from modules.training.scoring.rubric_loader import get_base_rubric, load_rubric


def _assert_self_consistent(rubric: dict) -> None:
    raw_scale = rubric["raw_scale"]
    assert sum(dim["max"] for dim in rubric["dimensions"]) == rubric["raw_max"]
    assert sum(len(dim["items"]) * raw_scale for dim in rubric["dimensions"]) == rubric["raw_max"]
    for dim in rubric["dimensions"]:
        assert dim["max"] == len(dim["items"]) * raw_scale


class TestRubricSingleSource:
    def test_profile_rubric_is_a_copy_of_the_loader_rubric(self):
        loaded = load_rubric()
        assert HISTORY_TAKING.rubric == loaded
        assert HISTORY_TAKING.rubric is not loaded
        assert get_base_rubric() is not loaded
        assert get_base_rubric() == loaded

    def test_base_rubric_is_self_consistent_for_both_feature_states(self):
        base = get_base_rubric()
        _assert_self_consistent(base)
        _assert_self_consistent(build_final_rubric(base, {"nursing_record": True}))

    def test_nursing_record_dimension_is_appended_not_baked_in(self):
        """护理记录维度由病例能力追加（base 中不得预置），追加后 raw_max 增加维度分。"""
        base = get_base_rubric()
        assert "nursing_record" not in {dim["id"] for dim in base["dimensions"]}

        with_nursing = build_final_rubric(base, {"nursing_record": True})
        assert with_nursing["raw_max"] == base["raw_max"] + 10
        assert len(with_nursing["dimensions"]) == len(base["dimensions"]) + 1

    def test_rubric_data_module_no_longer_exists(self):
        """冗余的第二份真相已删除：再引入即失败。"""
        with pytest.raises(ModuleNotFoundError):
            importlib.import_module("modules.training.scoring.rubric_data")
