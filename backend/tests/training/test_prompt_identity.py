"""提示词/上下文内容身份（docs/ideas/prompt-context-versioning.md S1）。

这些断言钉的是设计不变量，不是实现细节：

* 身份**内容派生**：改内容 ⇒ 改身份；身份与提示词形状（v1/v2）无关。
* 身份**无进程内缓存**：模板文本变化必须立刻反映（否则热更或多 worker 之间会漂移）。
* 指纹只覆盖取舍数值，可安全用于等值比较。
"""

from __future__ import annotations

import pytest

from modules.training.context import budget as budget_module
from modules.training.prompt_identity import (
    compute_context_policy_version,
    compute_prompt_id,
    compute_scoring_prompt_id,
    context_fingerprint,
    prompt_id_from_snapshot,
)
from modules.training.prompts import scoring as scoring_prompts

WORKFLOW = "history_taking"
SYSTEM = "你是患者{name}。"
DYNAMIC = "当前场景：{scene}"


class TestPromptIdentity:
    def test_same_content_same_identity(self):
        first = compute_prompt_id(WORKFLOW, SYSTEM, DYNAMIC)
        second = compute_prompt_id(WORKFLOW, SYSTEM, DYNAMIC)
        assert first == second
        assert first.startswith(f"{WORKFLOW}@")

    def test_workflow_change_changes_identity(self):
        assert compute_prompt_id(WORKFLOW, SYSTEM, DYNAMIC) != compute_prompt_id("clinical_reasoning", SYSTEM, DYNAMIC)

    @pytest.mark.parametrize(("system", "dynamic"), [("你是患者{name}？", DYNAMIC), (SYSTEM, "当前场景：{scene}。")])
    def test_single_character_change_changes_identity(self, system, dynamic):
        assert compute_prompt_id(WORKFLOW, SYSTEM, DYNAMIC) != compute_prompt_id(WORKFLOW, system, dynamic)

    def test_segment_boundary_is_unambiguous(self):
        """字段拼接必须无歧义：('ab','c') 与 ('a','bc') 不得同身份。"""
        assert compute_prompt_id(WORKFLOW, "ab", "c") != compute_prompt_id(WORKFLOW, "a", "bc")

    def test_identity_is_shape_independent(self):
        """v1 扁平与 v2 segments 只要文本相同，身份必须相同（形状不是版本）。"""
        flat = {"system": SYSTEM, "dynamic": DYNAMIC}
        versioned = {"schema_version": 2, "purpose": "patient_chat", "segments": {"system": SYSTEM, "dynamic": DYNAMIC}}
        assert prompt_id_from_snapshot(flat, WORKFLOW) == prompt_id_from_snapshot(versioned, WORKFLOW)
        assert prompt_id_from_snapshot(flat, WORKFLOW) == compute_prompt_id(WORKFLOW, SYSTEM, DYNAMIC)

    @pytest.mark.parametrize("snapshot", [None, {}, {"schema_version": 2, "segments": {}}])
    def test_missing_snapshot_has_no_identity(self, snapshot):
        assert prompt_id_from_snapshot(snapshot, WORKFLOW) is None


class TestScoringPromptIdentity:
    def test_stable_across_calls(self):
        assert compute_scoring_prompt_id() == compute_scoring_prompt_id()

    def test_template_change_changes_identity(self, monkeypatch):
        before = compute_scoring_prompt_id()
        monkeypatch.setattr(scoring_prompts, "SCORING_SYSTEM", scoring_prompts.SCORING_SYSTEM + "\n（新增约束）")
        assert compute_scoring_prompt_id() != before

    def test_feedback_template_change_changes_identity(self, monkeypatch):
        before = compute_scoring_prompt_id()
        monkeypatch.setattr(
            scoring_prompts, "SCORING_FEEDBACK_SYSTEM", scoring_prompts.SCORING_FEEDBACK_SYSTEM + "\n（新增反馈约束）"
        )
        assert compute_scoring_prompt_id() != before


class TestContextPolicyVersion:
    def test_stable_across_calls(self):
        assert compute_context_policy_version() == compute_context_policy_version()

    @pytest.mark.parametrize(
        ("constant", "new_value"),
        [
            ("HISTORY_BUDGET_TOKENS", budget_module.HISTORY_BUDGET_TOKENS + 500),
            ("PATIENT_STATE_BUDGET_TOKENS", budget_module.PATIENT_STATE_BUDGET_TOKENS + 50),
            ("MIN_HISTORY_ROUNDS", budget_module.MIN_HISTORY_ROUNDS + 1),
            ("HEAD_PINNED_ROUNDS", budget_module.HEAD_PINNED_ROUNDS + 1),
            ("MAX_TOKEN_SCALE", budget_module.MAX_TOKEN_SCALE + 1),
        ],
    )
    def test_budget_change_changes_policy_version(self, monkeypatch, constant, new_value):
        before = compute_context_policy_version()
        monkeypatch.setattr(budget_module, constant, new_value)
        assert compute_context_policy_version() != before


class TestContextFingerprint:
    LEDGER = {
        "static_tokens": 900,
        "history_budget_tokens": 2000,
        "history_effective_budget_tokens": 1800,
        "history_token_scale": 1.0,
        "dropped_rounds": 0,
    }

    def test_same_tradeoff_same_fingerprint(self):
        policy = compute_context_policy_version()
        assert context_fingerprint(policy, dict(self.LEDGER)) == context_fingerprint(policy, dict(self.LEDGER))

    def test_ignores_text_values(self):
        """文本字段不参与指纹（否则审计表会因文案变化而无法等值比较）。"""
        policy = compute_context_policy_version()
        with_text = dict(self.LEDGER, scene_text="病房，白天")
        assert context_fingerprint(policy, with_text) == context_fingerprint(policy, dict(self.LEDGER))

    @pytest.mark.parametrize("key", ["dropped_rounds", "history_effective_budget_tokens", "history_token_scale"])
    def test_tradeoff_change_changes_fingerprint(self, key):
        policy = compute_context_policy_version()
        changed = dict(self.LEDGER, **{key: 9})
        assert context_fingerprint(policy, changed) != context_fingerprint(policy, dict(self.LEDGER))

    def test_policy_version_is_part_of_fingerprint(self):
        assert context_fingerprint("ctx@aaaaaaaa", dict(self.LEDGER)) != context_fingerprint(
            "ctx@bbbbbbbb", dict(self.LEDGER)
        )
