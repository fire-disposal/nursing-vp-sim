"""``build_clinical_rubric`` —— 病例声明的临床锚点 → **现有 rubric 结构**。

临床判断训练的评分域由**病例**声明（``rubric.anchors``），而现有消费方
（``Score.detail_scores`` / ``RecordDetail`` 复盘 / 教师复核 / ``review_focus``）只认
一套结构：``dimensions[].items[]`` + ``raw_scale`` + ``anchors{"0"/"1"/"2"}``。

本模块只做**投影**：一个 anchor → 一个 rubric item，weight → item 的原始满分刻度，
并把 ``rule/findings/objectives`` 原样保留在 item 上，供冻结与复盘使用。
不判分、不改病例、不发明条目。

刻度：``raw_scale`` 沿用基准 rubric 的 0..2 制，因此：

* ``weight`` 是相对权重，映射成 ``raw_scale * weight`` 的条目上限（锚点权重越高，
  该条在总分里的占比越大）；
* 每个 item 仍保留 ``anchors{"2"/"1"/"0"}`` 三档文本 —— 确定性评分只会给出
  2（完全达成）/1（部分达成）/0（未达成），不产生中间刻度。
"""

from __future__ import annotations

import copy
from collections.abc import Mapping, Sequence
from typing import Any

from .state import findings_index, objectives_of

#: 与基准 rubric 一致的刻度（每个条目 0..2）
RAW_SCALE = 2

#: 目标组 → 中文维度名（锚点按规则归组，复盘时一眼能看出考的是哪一类判断）
_GROUP_LABELS: dict[str, str] = {
    "must_notice": "线索识别",
    "must_act": "临床处置",
    "must_communicate": "沟通与交接",
}

#: 规则 → 缺省维度（锚点没有目标引用时按规则归组）
_RULE_GROUP: dict[str, str] = {
    "finding_observed": "must_notice",
    "objective_met": "must_notice",
    "action_taken": "must_act",
    "communicated": "must_communicate",
}

_RULE_TEXT: dict[str, str] = {
    "finding_observed": "识别并获取了关键证据",
    "objective_met": "达成了该目标",
    "action_taken": "完成了关键处置动作",
    "communicated": "向患者/团队讲清了关键信息",
}


def _ids(raw: Any) -> list[str]:
    if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes)):
        return []
    return [str(item) for item in raw if isinstance(item, str) and item.strip()]


def _anchor_targets(anchor: Mapping[str, Any]) -> set[str]:
    return set(_ids(anchor.get("objectives"))) | set(_ids(anchor.get("findings")))


def _group_of(anchor: Mapping[str, Any], objectives: Mapping[str, str]) -> str:
    """锚点所属目标组：优先按引用目标分组，否则按规则归类。"""
    for oid in _ids(anchor.get("objectives")):
        group = objectives.get(oid)
        if group in _GROUP_LABELS:
            return group
    return _RULE_GROUP.get(str(anchor.get("rule") or ""), "must_notice")


def _item_anchors(
    anchor: Mapping[str, Any], findings: Mapping[str, Mapping[str, Any]], objectives: Mapping[str, str]
) -> dict[str, str]:
    """三档锚点文本 —— 直接由病例声明派生，不编造作者没写的判据。"""
    rule = str(anchor.get("rule") or "")
    label = str(anchor.get("label") or anchor.get("id") or "该锚点")
    evidence_labels = [
        str(findings[fid].get("label") or fid) for fid in _ids(anchor.get("findings")) if fid in findings
    ]
    objective_ids = _ids(anchor.get("objectives"))
    objective_labels = [objectives.get(oid, oid) for oid in objective_ids]
    refs = "、".join([*evidence_labels, *objective_labels])
    full = f"{label}：{_RULE_TEXT.get(rule, '达成该锚点')}"
    if refs:
        full = f"{full}（{refs}）"
    return {
        "2": full,
        "1": f"部分达成：{label} 只做到一部分或证据获取不完整",
        "0": f"未达成：{label} 没有证据支撑或动作未执行",
    }


def build_clinical_rubric(case_data: Mapping[str, Any] | None) -> dict[str, Any]:
    """把病例 ``rubric.anchors`` 规范化为现有 ``dimensions/items/raw_scale`` 结构。

    Returns:
        ``{"id", "name", "version", "scale", "raw_scale", "raw_max", "total_max",
        "dimensions": [{"id","name","items":[{"id","name","max","weight","rule",
        "findings","objectives","anchors"}],"max"}]}``

    没有声明的锚点（病例未配 rubric）返回空 dimensions 与 ``raw_max=0`` 的结构：
    调用方据此判定"无评分域"，而不是拿一套假的锚点给分。
    """
    payload = case_data if isinstance(case_data, Mapping) else {}
    rubric_raw = payload.get("rubric")
    raw_rubric: Mapping[str, Any] = rubric_raw if isinstance(rubric_raw, Mapping) else {}
    raw_anchors = raw_rubric.get("anchors")
    anchors = [a for a in raw_anchors if isinstance(a, Mapping)] if isinstance(raw_anchors, list) else []

    finding_index = findings_index(payload)
    objective_groups: dict[str, str] = {}
    objective_labels: dict[str, str] = {}
    for group in ("must_notice", "must_act", "must_communicate"):
        for item in objectives_of(payload)[group]:
            oid = str(item.get("id") or "")
            if not oid:
                continue
            objective_groups[oid] = group
            objective_labels[oid] = str(item.get("label") or oid)

    buckets: dict[str, list[dict[str, Any]]] = {group: [] for group in _GROUP_LABELS}
    for anchor in anchors:
        anchor_id = str(anchor.get("id") or "").strip()
        if not anchor_id:
            continue
        try:
            weight = float(anchor.get("weight") or 0)
        except (TypeError, ValueError):
            weight = 0.0
        if weight <= 0:
            weight = 1.0
        group = _group_of(anchor, objective_groups)
        buckets[group].append(
            {
                "id": anchor_id,
                "name": str(anchor.get("label") or anchor_id),
                # 条目上限：weight 是相对权重，按基准刻度放大（见模块说明）
                "max": RAW_SCALE * weight,
                "weight": weight,
                "rule": str(anchor.get("rule") or ""),
                "findings": _ids(anchor.get("findings")),
                "objectives": _ids(anchor.get("objectives")),
                "anchors": _item_anchors(anchor, finding_index, objective_labels),
            }
        )

    dimensions: list[dict[str, Any]] = []
    for group, label in _GROUP_LABELS.items():
        items = buckets[group]
        if not items:
            continue
        dimensions.append(
            {
                "id": f"clinical_{group}",
                "name": label,
                "max": sum(float(item["max"]) for item in items),
                "items": items,
            }
        )

    raw_max = sum(float(item["max"]) for dim in dimensions for item in dim["items"])
    return {
        # 稳定短 id：``Score.rubric_version`` 是 ``String(40)``，而 ``id@version`` 会被
        # 直接落库——把病例名塞进 id 会撑爆该列（病例名可达 100 字符）。
        "id": "clinical_reasoning.v2",
        "name": "临床判断训练评分标准（病例锚点）",
        "version": "1.0",
        "scale": 100,
        "total_max": 100,
        "raw_scale": RAW_SCALE,
        "raw_max": raw_max,
        "dimensions": dimensions,
    }


def rubric_item_status(rubric: Mapping[str, Any] | None) -> dict[str, str]:
    """条目 id → 所属维度 id（评分/复盘共用；避免各自遍历）。"""
    out: dict[str, str] = {}
    for dim in (rubric or {}).get("dimensions", []) or []:
        if not isinstance(dim, Mapping):
            continue
        dim_id = str(dim.get("id") or "")
        for item in dim.get("items", []) or []:
            if isinstance(item, Mapping) and item.get("id"):
                out[str(item["id"])] = dim_id
    return out


def freeze_copy(rubric: Mapping[str, Any]) -> dict[str, Any]:
    """冻结用的深拷贝（记录建好后 rubric 不可再被病例编辑影响）。"""
    return copy.deepcopy(dict(rubric))
