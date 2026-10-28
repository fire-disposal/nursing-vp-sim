"""版本归因聚合（只读）—— 纯函数部分（SQL 已分组，这里只验证身份派生与合并口径）。

不变量：

* 身份从**既有数据**派生（提示词取冻结快照、rubric/映射取分数行），取不到就是 ``unknown``，
  不为历史记录伪造身份；
* 平均分只统计**有效成绩**（``effective_total`` 非空），兜底率只统计已评分记录；
* 身份里含 workflow（``{workflow}@{hash}``）：同样的文本在不同 workflow 下是不同产物；
* 形状不是内容：v1 扁平与 v2 segments 同文本 → 同一个身份（聚合键不同，身份合并）。
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


def _group(*, key_a=None, key_b=None, records=1, scored=0, score_sum=0.0, fallback=0, first=NOW, last=NOW):
    """SQL 聚合后的一个分组（GROUP BY 聚合键 + 五个指标）。"""
    return SimpleNamespace(
        key_a=key_a,
        key_b=key_b,
        records=records,
        scored=scored,
        score_sum=score_sum,
        fallback=fallback,
        first_seen=first,
        last_seen=last,
    )


class TestPromptDimension:
    def test_groups_by_derived_identity(self):
        groups = [
            _group(key_a=SNAPSHOT_A, key_b="history_taking", records=2, scored=2, score_sum=170.0, last=LATER),
            _group(key_a=SNAPSHOT_B, key_b="history_taking", records=1, scored=1, score_sum=60.0),
        ]

        items = summarize(groups, "prompt")

        assert [row["identity"] for row in items] == [ID_A, ID_B]  # 使用量大的在前
        top = items[0]
        assert top["records"] == 2
        assert top["scored"] == 2
        assert top["avg_score"] == 85.0
        assert top["first_seen"] == NOW.isoformat()
        assert top["last_seen"] == LATER.isoformat()

    def test_shape_is_not_identity(self):
        """v1 扁平与 v2 segments 写同样的文本 → 同一个身份（两个聚合键合并成一个桶）。"""
        flat = _group(key_a={"system": "s", "dynamic": "d"}, key_b="history_taking", scored=1, score_sum=88.0)
        versioned = _group(
            key_a={"schema_version": 2, "segments": {"system": "s", "dynamic": "d"}},
            key_b="history_taking",
            scored=1,
            score_sum=70.0,
        )
        items = summarize([flat, versioned], "prompt")
        assert len(items) == 1
        assert items[0]["records"] == 2
        assert items[0]["avg_score"] == 79.0

    def test_unknown_bucket_for_records_without_snapshot(self):
        items = summarize([_group(key_a=None, key_b=None, scored=1, score_sum=88.0)], "prompt")
        assert [row["identity"] for row in items] == ["unknown"]

    def test_unscored_record_counts_usage_but_not_score(self):
        items = summarize(
            [_group(key_a=SNAPSHOT_A, key_b="history_taking", records=2, scored=1, score_sum=70.0)], "prompt"
        )
        assert items[0]["records"] == 2
        assert items[0]["scored"] == 1
        assert items[0]["avg_score"] == 70.0
        assert items[0]["fallback_rate"] == 0.0

    def test_fallback_rate_over_scored_only(self):
        items = summarize(
            [_group(key_a=SNAPSHOT_A, key_b="history_taking", records=2, scored=2, score_sum=176.0, fallback=1)],
            "prompt",
        )
        assert items[0]["fallback_rate"] == 0.5


class TestOtherDimensions:
    def test_rubric_identity_from_score(self):
        groups = [_group(key_a="nursing_history_v1@2.0", scored=1, score_sum=88.0), _group(key_a=None)]
        items = summarize(groups, "rubric")
        identities = {row["identity"] for row in items}
        assert identities == {"nursing_history_v1@2.0", "unknown"}

    def test_mapping_identity_from_score(self):
        groups = [_group(key_a=0, scored=1, score_sum=88.0), _group(key_a=1, scored=1, score_sum=88.0)]
        items = summarize(groups, "mapping")
        assert {row["identity"] for row in items} == {"mapping@0", "mapping@1"}

    def test_context_dimension_uses_frozen_policy(self):
        groups = [
            _group(key_a="ctx@60313cbc", records=2, scored=2, score_sum=160.0),
            _group(key_a=None),  # 该列落地前的历史记录
        ]
        items = summarize(groups, "context")
        by_identity = {row["identity"]: row for row in items}
        assert by_identity["ctx@60313cbc"]["records"] == 2
        assert by_identity["ctx@60313cbc"]["avg_score"] == 80.0
        assert "unknown" in by_identity  # 历史记录不伪造策略身份

    def test_identity_keeps_workflows_apart(self):
        """身份形如 ``{workflow}@{hash}``：同样的提示词文本在不同 workflow 下是不同产物。"""
        groups = [
            _group(key_a=SNAPSHOT_A, key_b="history_taking"),
            _group(key_a=SNAPSHOT_A, key_b="clinical_reasoning"),
        ]
        items = summarize(groups, "prompt")
        assert len(items) == 2
        assert sorted(row["identity"].split("@")[0] for row in items) == ["clinical_reasoning", "history_taking"]
