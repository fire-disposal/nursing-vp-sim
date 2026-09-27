"""结果页的「关键选择」投影（docs/19 W5）。

W5 要求：结果页**首先解释少量关键选择**，能回到具体证据，给原则与示例而不是唯一标准话术，
且「证据不足时不生成确定性指导」。

本模块只做**投影**：从已落库的原始条目层、rubric 锚点与病例蓝图里挑出少量最值得解释的条目，
不重新判分、不新增第二套结论。每条都带：条目身份、原始得分、证据引用、判定理由，
以及"下一次练习的原则"——原则取自该条目已作者化的 2 分锚点，不凭空编造话术。

缺少证据（既没有可定位引用，也没有判定理由）的条目直接不入选：给不出确定指导时宁可不指导。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from modules.training.blueprint import blueprint_of
from modules.training.scoring.validation import STATUS_SCORED

KIND_MISSED = "missed"
KIND_PARTIAL = "partial"

DEFAULT_LIMIT = 4


def _anchor_expectation(item: Mapping[str, Any]) -> str:
    anchors = item.get("anchors")
    if not isinstance(anchors, Mapping):
        return ""
    return str(anchors.get("2") or "").strip()


def _iter_raw_items(raw_detail: Mapping[str, Any] | None):
    if not isinstance(raw_detail, Mapping):
        return
    for dim_name, dim_data in raw_detail.items():
        if not isinstance(dim_data, Mapping):
            continue
        for item in dim_data.get("items", []) or []:
            if isinstance(item, Mapping):
                yield str(dim_name), item


def _rubric_item_index(rubric: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    index: dict[str, Mapping[str, Any]] = {}
    for dim in rubric.get("dimensions", []) or []:
        if not isinstance(dim, Mapping):
            continue
        for item in dim.get("items", []) or []:
            if isinstance(item, Mapping):
                index[str(item.get("id") or "")] = item
    return index


def _blueprint_hints(case_data: Mapping[str, Any] | None) -> tuple[set[str], list[str]]:
    blueprint = blueprint_of(case_data)
    if blueprint is None:
        return set(), []
    refs = blueprint.get("key_omissions")
    key_omissions = (
        {str(ref).strip() for ref in refs}
        if isinstance(refs, Sequence) and not isinstance(refs, (str, bytes))
        else set()
    )
    errors = blueprint.get("typical_errors")
    typical_errors = (
        [str(err) for err in errors] if isinstance(errors, Sequence) and not isinstance(errors, (str, bytes)) else []
    )
    return key_omissions, typical_errors


def _focus_candidate(
    dim_name: str,
    item: Mapping[str, Any],
    rubric_items: Mapping[str, Mapping[str, Any]],
    key_omission_refs: set[str],
    raw_scale: float,
) -> tuple[int, float, dict[str, Any]] | None:
    """单个条目能否入选「关键选择」；返回 ``(优先级, 得分, 条目描述)``。"""
    # 只有真正判过的条目才谈得上"关键选择"：不适用与"模型未判定"都不该被读成学生表现
    if item.get("status") != STATUS_SCORED:
        return None
    score = item.get("score")
    if not isinstance(score, (int, float)):
        return None
    item_id = str(item.get("id") or "")
    evidence = str(item.get("evidence") or "").strip()
    reason = str(item.get("reason") or "").strip()
    if not evidence and not reason:
        # 既无引用也无理由 → 给不出确定指导（W5 通过条件）
        return None
    is_key_omission = item_id in key_omission_refs
    if score >= raw_scale and not is_key_omission:
        return None

    rubric_item = rubric_items.get(item_id, {})
    name = str(item.get("name") or rubric_item.get("name") or item_id)
    if name in key_omission_refs:
        is_key_omission = True
    priority = 0 if is_key_omission else (1 if score <= 0 else 2)
    entry = {
        "dimension": dim_name,
        "item_id": item_id,
        "item_name": name,
        "score": score,
        "max": raw_scale,
        "kind": KIND_MISSED if score <= 0 else KIND_PARTIAL,
        "key_omission": is_key_omission,
        "evidence": evidence,
        "evidence_refs": item.get("evidence_refs") if isinstance(item.get("evidence_refs"), list) else [],
        "evidence_verified": bool(item.get("evidence_verified")),
        "reason": reason,
        # 原则来自该条目已作者化的 2 分锚点（不是系统生成的唯一话术）
        "principle": _anchor_expectation(rubric_item),
        "typical_error": "",
    }
    return priority, float(score), entry


def build_review_focus(
    raw_detail: Mapping[str, Any] | None,
    rubric: Mapping[str, Any] | None,
    case_data: Mapping[str, Any] | None,
    *,
    limit: int = DEFAULT_LIMIT,
) -> list[dict[str, Any]]:
    """挑出最值得解释的少量条目（关键遗漏优先，其次得分最低的条目）。"""
    if not isinstance(raw_detail, Mapping) or not isinstance(rubric, Mapping):
        return []

    rubric_items = _rubric_item_index(rubric)
    raw_scale = float(rubric.get("raw_scale", 2) or 2)
    key_omission_refs, typical_errors = _blueprint_hints(case_data)

    candidates = []
    for dim_name, item in _iter_raw_items(raw_detail):
        candidate = _focus_candidate(dim_name, item, rubric_items, key_omission_refs, raw_scale)
        if candidate is not None:
            candidates.append(candidate)

    candidates.sort(key=lambda row: (row[0], row[1]))
    focus = [entry for _priority, _score, entry in candidates[: max(0, limit)]]
    if focus and typical_errors:
        for entry in focus:
            entry["typical_error"] = typical_errors[0]
    return focus


def review_focus_note(focus: Sequence[Mapping[str, Any]]) -> str:
    """结果页顶部的一句话说明；没有可解释的条目时给出明确空态语义。"""
    if not focus:
        return "本次没有需要单独解释的关键条目；逐项表现与证据在下方可查。"
    return "下面几条是本次最值得回看的关键选择：它们决定了得分，也指出了下一次练习的原则。"
