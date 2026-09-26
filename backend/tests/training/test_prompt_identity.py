"""内容身份派生（docs/ideas/prompt-context-versioning.md §四）。

不变量：

* 身份**内容派生**：改内容即改身份；改预算常量即改策略身份；
* 形状不是内容：v1 扁平与 v2 segments 只要文本相同，身份必须相同；
* 取不到就返回 None/unknown —— 不为历史记录伪造身份。
"""

from __future__ import annotations

import pytest

from modules.training.context import budget as budget_module
from modules.training.prompt_identity import (
    compute_context_policy_version,
    compute_prompt_id,
    prompt_id_from_snapshot,
)


class TestPromptId:
    def test_same_input_same_identity(self):
        first = compute_prompt_id("history_taking", "系统", "动态")
        assert first == compute_prompt_id("history_taking", "系统", "动态")
        assert first.startswith("history_taking@")

    def test_workflow_is_part_of_identity(self):
        assert compute_prompt_id("history_taking", "s", "d") != compute_prompt_id("clinical_reasoning", "s", "d")

    def test_single_character_change_changes_identity(self):
        assert compute_prompt_id("w", "系统", "动态") != compute_prompt_id("w", "系统", "动态。")

    def test_field_boundary_is_unambiguous(self):
        """拼接必须无歧义：('ab','c') 与 ('a','bc') 不得同身份。"""
        assert compute_prompt_id("w", "ab", "c") != compute_prompt_id("w", "a", "bc")

    def test_shape_is_not_identity(self):
        flat = {"system": "s", "dynamic": "d"}
        versioned = {"schema_version": 2, "segments": {"system": "s", "dynamic": "d"}}
        assert prompt_id_from_snapshot(flat, "w") == prompt_id_from_snapshot(versioned, "w")

    @pytest.mark.parametrize(
        ("snapshot", "workflow"),
        [(None, "w"), ({}, "w"), ({"schema_version": 2, "segments": {}}, "w"), ({"system": "s"}, None)],
    )
    def test_missing_inputs_have_no_identity(self, snapshot, workflow):
        assert prompt_id_from_snapshot(snapshot, workflow) is None


class TestContextPolicyVersion:
    def test_stable_without_changes(self):
        assert compute_context_policy_version() == compute_context_policy_version()

    @pytest.mark.parametrize(
        "constant",
        ["HISTORY_BUDGET_TOKENS", "PATIENT_STATE_BUDGET_TOKENS", "MIN_HISTORY_ROUNDS", "HEAD_PINNED_ROUNDS"],
    )
    def test_budget_change_changes_identity(self, monkeypatch, constant):
        before = compute_context_policy_version()
        monkeypatch.setattr(budget_module, constant, getattr(budget_module, constant) + 1)
        assert compute_context_policy_version() != before
