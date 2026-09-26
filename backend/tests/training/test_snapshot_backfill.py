"""存量记录快照补写（SCR-7）。

不变量：**冻结过的快照永不回写**。旧实现用 `if not A or not B` 触发却在块内无条件重写两者，
导致只缺 rubric 的旧记录被顺手改成"今天"的提示词 —— 事后审计/回放/归因全部失真且无日志。
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from modules.training.scoring import runner


def _workflow():
    return SimpleNamespace(
        id="history_taking",
        prompts=SimpleNamespace(system="今天的系统提示", dynamic="今天的动态段"),
        rubric={"id": "nursing_history_v1", "version": "1.0", "dimensions": []},
    )


def _record(*, prompt_snapshot, rubric_snapshot, features=None):
    return SimpleNamespace(
        prompt_snapshot=prompt_snapshot,
        rubric_snapshot=rubric_snapshot,
        practice_snapshot={"features": features or {}},
    )


@pytest.fixture
def workflow(monkeypatch):
    wf = _workflow()
    monkeypatch.setattr(runner, "workflow_for_record", lambda _record: wf)
    return wf


class TestMissingSnapshotUpdates:
    def test_only_rubric_missing_does_not_touch_frozen_prompt(self, workflow):
        """SCR-7 回归：prompt 快照是冻结产物，缺 rubric 也不得重写它。"""
        frozen_prompt = {"schema_version": 2, "segments": {"system": "当年的提示", "dynamic": "当年的动态"}}
        record = _record(prompt_snapshot=frozen_prompt, rubric_snapshot=None)

        updates = runner.missing_snapshot_updates(record)

        assert set(updates) == {"rubric_snapshot"}
        assert record.prompt_snapshot == frozen_prompt
        assert "今天的系统提示" not in str(record.prompt_snapshot)

    def test_only_prompt_missing_does_not_touch_frozen_rubric(self, workflow):
        frozen_rubric = {"id": "old", "version": "0.9", "dimensions": []}
        record = _record(prompt_snapshot=None, rubric_snapshot=frozen_rubric)

        updates = runner.missing_snapshot_updates(record)

        assert set(updates) == {"prompt_snapshot"}
        assert record.rubric_snapshot == frozen_rubric

    def test_both_missing_fills_both(self, workflow):
        record = _record(prompt_snapshot=None, rubric_snapshot=None)

        updates = runner.missing_snapshot_updates(record)

        assert set(updates) == {"prompt_snapshot", "rubric_snapshot"}
        assert updates["prompt_snapshot"]["segments"]["system"] == "今天的系统提示"
        assert updates["rubric_snapshot"]["id"] == "nursing_history_v1"

    def test_both_present_writes_nothing_and_skips_workflow_lookup(self, monkeypatch):
        """两个快照都在 ⇒ 不解析 workflow（避免为无操作付出解析成本与异常风险）。"""
        called = False

        def _explode(_record):
            nonlocal called
            called = True
            raise AssertionError("workflow 不该被解析")

        monkeypatch.setattr(runner, "workflow_for_record", _explode)
        record = _record(prompt_snapshot={"schema_version": 2}, rubric_snapshot={"id": "x"})

        assert runner.missing_snapshot_updates(record) == {}
        assert called is False

    def test_backfilled_prompt_snapshot_carries_no_purpose_key(self, workflow):
        """`purpose` 恒为常量、零信息（docs/17 §三#3）：补写也不得再引入它。"""
        record = _record(prompt_snapshot=None, rubric_snapshot={"id": "x"})

        updates = runner.missing_snapshot_updates(record)

        assert "purpose" not in updates["prompt_snapshot"]
