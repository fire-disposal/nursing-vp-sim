"""成绩可比性分组。

同一个 ``rubric_version`` 在历史上横跨多种原始满分与单项刻度，
把不同量尺的展示分直接平均或画在同一条趋势线上，会制造不存在的"进步/退步"。
因此任何聚合/趋势都必须先回答"这些记录可比吗"，答案由本模块给出：

可比组键 = 病例 + 评分内容身份（rubric 内容）+ 适用原始满分 + 辅助条件 + 等第政策身份。
缺 ``score_meta`` 的历史记录不是"某一组"，而是**身份不明**：单独成组并显式标记，
绝不与有身份的新记录混算，也不回填伪造身份。

本模块只做纯计算，不写库、不改分。
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from typing import Any

IDENTITY_UNKNOWN = "unknown"

#: 可比组键的字段顺序（展示与分组共用同一份定义）
KEY_FIELDS = (
    "case_id",
    "rubric_content_id",
    "scale_max",
    "assistance_mode",
    "grade_policy",
    "experiment",
)


def _as_mapping(value: object) -> Mapping[Any, Any]:
    """把任意值收窄成映射（None/标量 → 空映射）。"""
    return value if isinstance(value, Mapping) else {}


def comparability_key(
    *,
    score_meta: Mapping[str, Any] | None,
    rubric_version: str | None,
    case_id: int,
    mode: str | None = None,
) -> dict[str, Any]:
    """单条评分记录的可比组键。

    ``identity_unknown=True`` 表示该记录没有评分溯源元数据（本批次之前的历史分）：
    它的原始量尺、rubric 内容与等第政策都不可知，只能单独成组。
    """
    meta = _as_mapping(score_meta)
    policy = _as_mapping(meta.get("grade_policy"))
    assistance = _as_mapping(meta.get("assistance"))
    experiment = _as_mapping(meta.get("experiment"))
    batch = str(experiment.get("batch") or "")
    arm = str(experiment.get("arm") or "")
    experiment_label = f"{batch}/{arm}" if batch and arm else batch
    applicable = meta.get("applicable_raw_max")
    scale_max: Any = float(applicable) if isinstance(applicable, (int, float)) and applicable > 0 else IDENTITY_UNKNOWN
    return {
        "case_id": case_id,
        "rubric_content_id": str(meta.get("rubric_content_id") or IDENTITY_UNKNOWN),
        "rubric_version": rubric_version or IDENTITY_UNKNOWN,
        "scale_max": scale_max,
        "assistance_mode": str(assistance.get("mode") or mode or IDENTITY_UNKNOWN),
        "grade_policy": (f"{policy.get('id')}@{policy.get('version')}" if policy.get("id") else IDENTITY_UNKNOWN),
        # 实验批次（未标记 = 非实验批次，单独成组，不与实验批次混算）
        "experiment": experiment_label or IDENTITY_UNKNOWN,
        "identity_unknown": not meta,
    }


def key_signature(key: Mapping[str, Any]) -> str:
    """可比较/可哈希的组签名（不含 identity_unknown，它由其余字段推出）。"""
    return "|".join(str(key.get(field, IDENTITY_UNKNOWN)) for field in KEY_FIELDS)


def key_label(key: Mapping[str, Any]) -> str:
    """可比组的可读标签（学生/教师界面与导出共用同一句）。"""
    if key.get("identity_unknown"):
        return "身份不明（本批次之前的历史分，量尺与规则不可知）"
    scale = key.get("scale_max")
    scale_text = f"原始满分 {scale:g}" if isinstance(scale, (int, float)) else "原始满分未知"
    mode = str(key.get("assistance_mode") or IDENTITY_UNKNOWN)
    mode_text = {"guided": "引导模式", "assessment": "独立考核", "blind_box": "盲盒"}.get(mode, mode)
    batch = str(key.get("experiment") or "")
    batch_text = f" · 批次 {batch}" if batch and batch != IDENTITY_UNKNOWN else ""
    return f"病例 {key.get('case_id')} · {mode_text} · {scale_text} · {key.get('rubric_content_id')}{batch_text}"


def group_keys(keys: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """把若干可比组键归并成组（稳定顺序：先有身份的后无身份的，再按签名）。"""
    buckets: dict[str, dict[str, Any]] = {}
    for key in keys:
        signature = key_signature(key)
        bucket = buckets.setdefault(signature, {"key": dict(key), "count": 0})
        bucket["count"] += 1
    return sorted(
        buckets.values(),
        key=lambda bucket: (bool(bucket["key"].get("identity_unknown")), key_signature(bucket["key"])),
    )


def build_comparability(keys: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """聚合/趋势响应共用的可比性块。"""
    groups = group_keys(keys)
    unknown = sum(bucket["count"] for bucket in groups if bucket["key"].get("identity_unknown"))
    known_groups = [bucket for bucket in groups if not bucket["key"].get("identity_unknown")]
    return {
        "mixed": len(known_groups) > 1 or unknown > 0,
        "single_group": len(known_groups) == 1 and unknown == 0,
        "identity_unknown_count": unknown,
        "groups": [
            {"label": key_label(bucket["key"]), "count": bucket["count"], "key": bucket["key"]} for bucket in groups
        ],
    }


def group_rows(
    rows: Iterable[tuple[Any, Mapping[str, Any]]],
) -> list[tuple[str, list[Any]]]:
    """按组签名把 (记录, 键) 行分组，返回 ``[(签名, [记录...])]``（稳定顺序）。"""
    buckets: dict[str, list[Any]] = {}
    for row, key in rows:
        buckets.setdefault(key_signature(key), []).append(row)
    return sorted(buckets.items())
