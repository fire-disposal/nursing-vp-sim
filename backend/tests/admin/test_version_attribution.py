"""版本归因聚合（只读）—— 纯函数部分。

不变量：

* 身份从**既有数据**派生（提示词取冻结快照、rubric/映射取分数行），取不到就是 ``unknown``，
  不为历史记录伪造身份；
* 平均分只统计**有效成绩**（``effective_total`` 非空），兜底率只统计已评分记录；
* 身份里含 workflow（``{workflow}@{hash}``）：同样的文本在不同 workflow 下是不同产物。
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

from modules.admin.versions import summarize
from modules.training.prompt_identity import compute_prompt_id

NOW = datetime(2026, 9, 20, 10, 0, tzinfo=UTC)
LATER = datetime(2026, 9, 25, 10, 0, tzinfo=UTC)

SNAPSHOT_A = {"schema_version": 2, "segments": {"system": "提示词 A", "dynamic": "动态 A"}}
SNAPSHOT_B = {"system": "提示词 B", "dynamic": "动态 B"}  # v1 扁平形状：身份只看内容
ID_A = compute_prompt_id("history_taking", "提示词 A", "动态 A")
ID_B = compute_prompt_id("history_taking", "提示词 B", "动态 B")


def _record(*, snapshot=None, workflow="history_taking", started=NOW, policy=None):
    return SimpleNamespace(
        prompt_snapshot=snapshot, workflow_id=workflow, start_time=started, context_policy_version=policy
    )


def _score(*, effective=88.0, fallback=None, rubric="nursing_history_v1@1.0", mapping=1):
    return SimpleNamespace(effective_total=effective, fallback=fallback, rubric_version=rubric, mapping_version=mapping)


class TestPromptDimension:
    def test_groups_by_derived_identity(self):
        rows = [
            (_record(snapshot=SNAPSHOT_A), _score(effective=90.0)),
            (_record(snapshot=SNAPSHOT_A, started=LATER), _score(effective=80.0)),
            (_record(snapshot=SNAPSHOT_B), _score(effective=60.0)),
        ]

        items = summarize(rows, "prompt")

        assert [row["identity"] for row in items] == [ID_A, ID_B]  # 使用量大的在前
        top = items[0]
        assert top["records"] == 2
        assert top["scored"] == 2
        assert top["avg_score"] == 85.0
        assert top["first_seen"] == NOW.isoformat()
        assert top["last_seen"] == LATER.isoformat()

    def test_shape_is_not_identity(self):
        """v1 扁平与 v2 segments 写同样的文本 → 同一个身份（形状不是内容）。"""
        flat = _record(snapshot={"system": "s", "dynamic": "d"})
        versioned = _record(snapshot={"schema_version": 2, "segments": {"system": "s", "dynamic": "d"}})
        items = summarize([(flat, _score()), (versioned, _score())], "prompt")
        assert len(items) == 1
        assert items[0]["records"] == 2

    def test_unknown_bucket_for_records_without_snapshot(self):
        items = summarize([(_record(snapshot=None), _score())], "prompt")
        assert [row["identity"] for row in items] == ["unknown"]

    def test_unscored_record_counts_usage_but_not_score(self):
        rows = [(_record(snapshot=SNAPSHOT_A), None), (_record(snapshot=SNAPSHOT_A), _score(effective=70.0))]
        items = summarize(rows, "prompt")
        assert items[0]["records"] == 2
        assert items[0]["scored"] == 1
        assert items[0]["avg_score"] == 70.0

    def test_fallback_rate_over_scored_only(self):
        rows = [
            (_record(snapshot=SNAPSHOT_A), _score(fallback={"kind": "timeout"})),
            (_record(snapshot=SNAPSHOT_A), _score()),
        ]
        items = summarize(rows, "prompt")
        assert items[0]["fallback_rate"] == 0.5


class TestOtherDimensions:
    def test_rubric_identity_from_score(self):
        rows = [(_record(), _score(rubric="nursing_history_v1@2.0")), (_record(), None)]
        items = summarize(rows, "rubric")
        identities = {row["identity"] for row in items}
        assert identities == {"nursing_history_v1@2.0", "unknown"}

    def test_mapping_identity_from_score(self):
        rows = [(_record(), _score(mapping=0)), (_record(), _score(mapping=1))]
        items = summarize(rows, "mapping")
        assert {row["identity"] for row in items} == {"mapping@0", "mapping@1"}

    def test_context_dimension_uses_frozen_policy(self):
        rows = [
            (_record(policy="ctx@60313cbc"), _score(effective=90.0)),
            (_record(policy="ctx@60313cbc"), _score(effective=70.0)),
            (_record(policy=None), _score()),  # 该列落地前的历史记录
        ]
        items = summarize(rows, "context")
        by_identity = {row["identity"]: row for row in items}
        assert by_identity["ctx@60313cbc"]["records"] == 2
        assert by_identity["ctx@60313cbc"]["avg_score"] == 80.0
        assert "unknown" in by_identity  # 历史记录不伪造策略身份

    def test_identity_keeps_workflows_apart(self):
        """身份形如 ``{workflow}@{hash}``：同样的提示词文本在不同 workflow 下是不同产物。"""
        rows = [
            (_record(snapshot=SNAPSHOT_A, workflow="history_taking"), None),
            (_record(snapshot=SNAPSHOT_A, workflow="clinical_reasoning"), None),
        ]
        items = summarize(rows, "prompt")
        assert len(items) == 2
        assert sorted(row["identity"].split("@")[0] for row in items) == ["clinical_reasoning", "history_taking"]
