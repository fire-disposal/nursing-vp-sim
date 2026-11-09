"""临床判断训练（V2）的运行时状态与**公有投影**。

一个事实一个 owner：

| 事实 | owner |
|---|---|
| 病例声明（scenario / findings / initial / objectives / rubric） | 病例快照（``record.case_snapshot``） |
| 已观察证据、已完成目标、已沟通目标 | ``runtime_state["clinical_reasoning"]``（本模块） |
| 学生可见的一切 | :func:`public_state_for`（**唯一**投影出口，内部 :func:`_project`） |

``runtime_state`` 是裸 JSONB：本模块**不**直接写列，写入一律走
``session.state.patch_runtime_state``（行锁 + 重读 + 只改本键），因此一条回合/命令
只碰 ``clinical_reasoning`` 键，不会覆盖并发写入的 ``exam_results`` 等键。

投影边界（安全约束，不是样式选择）：

* ``evidence`` 只含**已观察**的 finding（未观察的证据绝不下发）；
* ``available_findings`` 只给「可主动获取且尚未观察」的 ``finding_id/action/label``，
  其中 ``label`` 是**操作名**（"听诊双肺"），不是证据结果（"双肺哮鸣音"）——
  提前下发结果等于把判断替学生做了；
* rubric / 权重 / must_act 之外的评分锚点**永不**进入公有状态。
"""

from __future__ import annotations

import copy
from collections.abc import Mapping, Sequence
from typing import Any

#: ``runtime_state`` 顶层专属键（本 workflow 独占；其它键属于别的 owner）
STATE_KEY = "clinical_reasoning"

#: 证据获取途径前缀：``inquiry`` = 只能通过对话让患者说出来，``observe`` 不能拿。
VIA_INQUIRY = "inquiry"

#: 未声明 ``obtainable_via`` 时的缺省途径（病例门禁要求隐藏证据必须声明，这里只是兜底）
DEFAULT_VIA = "observe"


# ── 病例声明读取（只读，不解释业务）────────────────────────────────────────


def clinical_case(case_data: Mapping[str, Any] | None) -> Mapping[str, Any]:
    if not isinstance(case_data, Mapping):
        return {}
    return case_data


def scenario_of(case_data: Mapping[str, Any] | None) -> dict[str, Any]:
    raw = clinical_case(case_data).get("scenario")
    return dict(raw) if isinstance(raw, Mapping) else {}


def findings_of(case_data: Mapping[str, Any] | None) -> list[dict[str, Any]]:
    raw = clinical_case(case_data).get("findings")
    if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes)):
        return []
    return [dict(item) for item in raw if isinstance(item, Mapping)]


def findings_index(case_data: Mapping[str, Any] | None) -> dict[str, dict[str, Any]]:
    return {str(f.get("id")): f for f in findings_of(case_data) if f.get("id")}


def initial_catalog(case_data: Mapping[str, Any] | None) -> tuple[list[str], list[str]]:
    """``(visible_findings, hidden_findings)``；形状非法时按空处理（门禁在发布期负责）。"""
    raw = clinical_case(case_data).get("initial")
    if not isinstance(raw, Mapping):
        return [], []

    def _ids(key: str) -> list[str]:
        value = raw.get(key)
        if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
            return []
        return [str(item) for item in value if isinstance(item, str) and item.strip()]

    return _ids("visible_findings"), _ids("hidden_findings")


def objectives_of(case_data: Mapping[str, Any] | None) -> dict[str, list[dict[str, Any]]]:
    raw = clinical_case(case_data).get("objectives")
    out: dict[str, list[dict[str, Any]]] = {"must_notice": [], "must_act": [], "must_communicate": []}
    if not isinstance(raw, Mapping):
        return out
    for group in out:
        items = raw.get(group)
        if isinstance(items, Sequence) and not isinstance(items, (str, bytes)):
            out[group] = [dict(item) for item in items if isinstance(item, Mapping)]
    return out


def obtainable_via(finding: Mapping[str, Any]) -> list[str]:
    """获取途径列表（``["inquiry:起病诱因"]`` / ``["exam:听诊"]``）；空 = 未声明。"""
    raw = finding.get("obtainable_via")
    if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes)):
        return []
    return [str(v).strip() for v in raw if isinstance(v, str) and v.strip()]


def via_channel(via: str) -> str:
    """途径的通道名（``"inquiry:起病诱因"`` → ``"inquiry"``）。"""
    return via.split(":", 1)[0].strip().lower() if via else ""


def is_inquiry_only(finding: Mapping[str, Any]) -> bool:
    """只能靠问患者拿到的证据（``observe`` **不得**获取）。

    无 ``obtainable_via`` 声明的证据按「可观察」处理：门禁已要求隐藏证据必须声明途径，
    这里不为坏数据猜"它是问出来的"。
    """
    vias = obtainable_via(finding)
    if not vias:
        return False
    return all(via_channel(v) == VIA_INQUIRY for v in vias)


def initial_evidence_ids(case_data: Mapping[str, Any] | None) -> list[str]:
    """``initial.visible_findings``：开场即已观察的证据。"""
    visible, _ = initial_catalog(case_data)
    known = findings_index(case_data)
    return [fid for fid in visible if fid in known]


# ── 运行态（读写）──────────────────────────────────────────────────────────


def _as_list(raw: Any) -> list:
    return list(raw) if isinstance(raw, list) else []


def _as_dict(raw: Any) -> dict:
    return dict(raw) if isinstance(raw, Mapping) else {}


def read_state(runtime_state: Mapping[str, Any] | None) -> dict[str, Any]:
    """运行态规范化形状（缺失/坏形状 → 空集合）。

    入参可以是 **完整的 ``runtime_state``**（含 ``clinical_reasoning`` 键），也可以
    是 ``clinical_reasoning`` **本身**（``merge_state``/``seed_state`` 的内部形态）。
    只看形状区分，不引入第二个读者：两种形态的键集合互不相交（``evidence`` /
    ``completed_objectives`` / ``communicated_objectives`` 从不出现在顶层）。
    """
    raw = _as_dict(runtime_state)
    if STATE_KEY in raw:
        raw = _as_dict(raw.get(STATE_KEY))
    data = raw
    return {
        "evidence": [dict(item) for item in _as_list(data.get("evidence")) if isinstance(item, Mapping)],
        "completed_objectives": [str(x) for x in _as_list(data.get("completed_objectives")) if isinstance(x, str)],
        "communicated_objectives": [
            str(x) for x in _as_list(data.get("communicated_objectives")) if isinstance(x, str)
        ],
    }


def seed_state(case_data: Mapping[str, Any] | None, existing: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """把 ``initial.visible_findings`` 并入已观察集合（幂等；不改动既有条目）。

    开场证据是**病例声明的事实**，不是学生的动作：第一次初始化时写入，之后重复调用
    不重复追加、也不覆盖已有证据的顺序。
    """
    stored = read_state(existing)
    seen = {str(item.get("finding_id")) for item in stored["evidence"]}
    known = findings_index(case_data)
    for fid in initial_evidence_ids(case_data):
        if fid in seen:
            continue
        seen.add(fid)
        stored["evidence"].append(evidence_entry(known[fid], source="initial"))
    return stored


def evidence_entry(finding: Mapping[str, Any], *, source: str, message_id: int | None = None) -> dict[str, Any]:
    """一条已观察证据的落库形状（公有投影直接取它的子集）。"""
    entry: dict[str, Any] = {
        "finding_id": str(finding.get("id") or ""),
        "label": str(finding.get("label") or ""),
        "kind": str(finding.get("kind") or ""),
        "note": str(finding.get("note") or ""),
        "source": source,
    }
    if message_id is not None:
        entry["message_id"] = message_id
    return entry


def observed_ids(state: Mapping[str, Any]) -> set[str]:
    return {str(item.get("finding_id")) for item in read_state(state)["evidence"]}


def complete_objectives(completed: Sequence[str], communicated: Sequence[str]) -> dict[str, list[str]]:
    """``completed_objectives`` / ``communicated_objectives`` 的去重合并形状。"""
    return {
        "completed_objectives": list(dict.fromkeys(completed)),
        "communicated_objectives": list(dict.fromkeys(communicated)),
    }


def merge_state(
    *,
    base: Mapping[str, Any] | None,
    evidence: Sequence[Mapping[str, Any]] | None = None,
    completed: Sequence[str] | None = None,
    communicated: Sequence[str] | None = None,
) -> dict[str, Any]:
    """在既有运行态上合并新证据/目标完成（幂等，返回**新** dict，不就地修改入参）。"""
    state = copy.deepcopy(read_state(base))
    seen = {str(item.get("finding_id")) for item in state["evidence"]}
    for item in evidence or ():
        fid = str(item.get("finding_id") or "")
        if not fid or fid in seen:
            continue
        seen.add(fid)
        state["evidence"].append(copy.deepcopy(dict(item)))
    state["completed_objectives"] = list(
        dict.fromkeys([*state["completed_objectives"], *(str(x) for x in (completed or ()))])
    )
    state["communicated_objectives"] = list(
        dict.fromkeys([*state["communicated_objectives"], *(str(x) for x in (communicated or ()))])
    )
    return state


# ── 公有投影 ───────────────────────────────────────────────────────────────


def _available_findings(case_data: Mapping[str, Any] | None, observed: set[str]) -> list[dict[str, str]]:
    """可主动获取且尚未观察的证据 —— ``label`` 用**操作名**，不泄露结果。

    只有声明了非 inquiry 途径的证据可被 ``observe``；``hidden_findings`` 之外但声明了
    途径的证据同样可达（病例门禁要求每条证据都必须登记在 initial 里，这里不额外放宽）。
    """
    visible, hidden = initial_catalog(case_data)
    registered = set(visible) | set(hidden)
    out: list[dict[str, str]] = []
    for finding in findings_of(case_data):
        fid = str(finding.get("id") or "")
        if not fid or fid in observed or fid not in registered:
            continue
        vias = [v for v in obtainable_via(finding) if via_channel(v) != VIA_INQUIRY]
        if not vias:
            continue  # 只能问出来的证据不在"主动获取"面板里
        out.append({"finding_id": fid, "action": _action_verb(finding, vias), "label": _label_hint(finding, vias)})
    return out


def _action_label(via: str) -> str:
    """途径 → 操作名（``"exam:听诊"`` 的冒号后是操作描述；没有冒号就用整个 token）。"""
    _, _, tail = via.partition(":")
    return (tail or via).strip()


def _label_hint(finding: Mapping[str, Any], vias: Sequence[str]) -> str:
    """详情行：操作名（途径冒号后的可执行描述），**不**是结果。

    病例 schema 对 findings 是 ``extra="forbid"``：没有"操作提示"这种自由字段，
    所以操作名只能由途径派生（``"exam:听诊双肺"`` → "听诊双肺"）。没有可读途径时
    回落到 ``kind`` 的通用名——两者都不泄露"这次会看到什么"。
    """
    for via in vias:
        action = _action_label(via)
        if action:
            return action
    return _KIND_ACTION_LABEL.get(str(finding.get("kind") or ""), "获取")


def _action_verb(finding: Mapping[str, Any], vias: Sequence[str]) -> str:
    """按钮/动作的短动词：优先途径通道的通用名，没有声明时按证据种类。"""
    for via in vias:
        verb = _CHANNEL_ACTION_LABEL.get(via_channel(via))
        if verb:
            return verb
    return _KIND_ACTION_LABEL.get(str(finding.get("kind") or ""), "获取")


_CHANNEL_ACTION_LABEL: dict[str, str] = {
    "exam": "床旁检查",
    "lab": "调阅检验",
    "observation": "观察",
    "history": "查阅",
}


_KIND_ACTION_LABEL: dict[str, str] = {
    "vital_sign": "测量生命体征",
    "exam": "床旁查体",
    "lab": "调阅检验结果",
    "history": "查阅病历",
    "observation": "观察患者",
}


def _required_findings(item: Mapping[str, Any]) -> list[str]:
    """``must_act[].requires_findings`` 的规范化：去空、去重、保序。"""
    raw = item.get("requires_findings")
    if not isinstance(raw, list):
        return []
    return list(dict.fromkeys(v.strip() for v in raw if isinstance(v, str) and v.strip()))


def _finding_label(finding: Mapping[str, Any] | None, fid: str) -> str:
    """缺失证据的可读名 —— 用 ``findings[].label``（学生已见过的临床表述）。

    证据目录里查不到这个 id 时（病例内容损坏）回落到 id 本身：宁可显示生 key，
    也不把缺口静默吞成"无需证据"。
    """
    if isinstance(finding, Mapping):
        label = str(finding.get("label") or "").strip()
        if label:
            return label
    return fid


def missing_required_findings(
    case_data: Mapping[str, Any] | None, item: Mapping[str, Any], observed: set[str]
) -> list[str]:
    """该行动**尚未满足**的前置证据 label（空 = 门已开）。

    与公有投影的 ``missing_findings`` 同源：前端置灰的理由和 ``act`` 拒绝的理由
    必须是同一份清单，否则学生看到按钮可点、点了却报"缺证据"。
    """
    index = findings_index(case_data)
    return [_finding_label(index.get(fid), fid) for fid in _required_findings(item) if fid not in observed]


def _objectives_view(case_data: Mapping[str, Any] | None, state: Mapping[str, Any]) -> dict[str, Any]:
    stored = read_state(state)
    completed = set(stored["completed_objectives"])
    communicated = set(stored["communicated_objectives"])
    observed = {str(item.get("finding_id")) for item in stored["evidence"]}
    objectives = objectives_of(case_data)
    must_act = [
        {
            "id": str(item.get("id") or ""),
            "label": str(item.get("label") or ""),
            "action": str(item.get("action") or ""),
            "completed": str(item.get("id") or "") in completed,
            # 前置证据未观察 = 该行动现在做了也不算：前端据此置灰并点名缺哪几条。
            "available": not missing_required_findings(case_data, item, observed),
            "missing_findings": missing_required_findings(case_data, item, observed),
        }
        for item in objectives["must_act"]
        if item.get("id")
    ]
    must_communicate = [
        {
            "id": str(item.get("id") or ""),
            "label": str(item.get("label") or ""),
            "completed": str(item.get("id") or "") in communicated,
        }
        for item in objectives["must_communicate"]
        if item.get("id")
    ]
    return {
        "notice_count": len(stored["evidence"]),
        "notice_total": len({str(f.get("id")) for f in findings_of(case_data) if f.get("id")}),
        "must_act": must_act,
        "must_communicate": must_communicate,
    }


def _project(
    case_data: Mapping[str, Any] | None,
    runtime_state: Mapping[str, Any] | None,
    revision: int,
) -> dict[str, Any]:
    """``PublicClinicalState`` —— 学生可见的全部事实（**唯一**投影实现）。

    ``revision`` 是训练记录的乐观并发号（由调用方传入，含 0）；
    本函数不读数据库。
    """
    stored = read_state(runtime_state)
    evidence = [
        {key: item.get(key) for key in ("finding_id", "label", "kind", "note", "source")}
        | ({"message_id": item["message_id"]} if item.get("message_id") is not None else {})
        for item in stored["evidence"]
    ]
    observed = {str(item.get("finding_id")) for item in stored["evidence"]}
    return {
        "scenario": scenario_of(case_data),
        "evidence": evidence,
        "available_findings": _available_findings(case_data, observed),
        "objectives": _objectives_view(case_data, runtime_state or {}),
        "revision": int(revision or 0),
    }


def public_state_for(
    case_data: Mapping[str, Any] | None,
    runtime_state: Mapping[str, Any] | None,
    *,
    revision: int,
) -> dict[str, Any]:
    """``PublicClinicalState`` —— 学生可见的全部事实（**唯一**投影出口）。"""
    return _project(case_data, runtime_state, revision)
