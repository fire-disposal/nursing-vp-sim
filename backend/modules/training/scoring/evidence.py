"""证据引用解析 —— 把评分条目引用的原文定位到**已存在**的对话、动作或提交产物。

docs/19 §5 的最小语义要求：证据引用应能定位到已存在的 Message、TrainingAction 或提交产物
字段；无依据时标为无法判断，**不把自由文本里的"第几轮"当可靠主键**。

因此定位是服务端的确定性匹配（纯函数，无 IO、无 LLM）：模型给出原文引用，这里把它映射到
真实的记录 id。定位失败不删条目、不改分，只把 ``evidence_verified`` 标为 False，由消费方
如实呈现「未能定位证据」。
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Any

#: 候选记录：``(归一化文本, 引用类别, 引用载荷)``
Candidate = tuple[str, str, Any]

REF_KIND_MESSAGE = "message"
REF_KIND_ACTION = "action"
REF_KIND_ARTIFACT = "artifact"

#: 用于定位的最小归一化片段长度。低于该长度不做匹配 —— 太短的片段（如"嗯"）会命中任何
#: 对话，定位结果就不再是证据。
MIN_PROBE_CHARS = 6

#: 归一化时剔除的标点/空白（中英文）。只做形态归一，不改字。
_STRIP_CHARS = " \t\r\n　，。、；：？！“”‘’（）《》〈〉【】…—～·,.;:?!\"'()[]{}<>|/\\-_*=+~`^"


def normalize_for_match(text: str) -> str:
    """去空白与常见标点后的匹配用文本。"""
    return "".join(ch for ch in str(text) if ch not in _STRIP_CHARS)


def _probes(evidence_norm: str) -> list[str]:
    """从证据文本里生成由长到短的匹配片段。

    模型的"引用"常常包着解释性文字（"学生说：咳嗽三天了"），只试前缀会漏掉真正落在句中的
    原话。因此除了前缀，还按固定长度滑窗切片段：先长后短、命中即止 —— 先长是为了让定位
    尽量指向最长的确凿原话，而不是一个可能多处出现的短片段。
    """
    if len(evidence_norm) < MIN_PROBE_CHARS:
        return []
    probes: list[str] = [evidence_norm]
    for window in (16, 12, 9, MIN_PROBE_CHARS):
        if len(evidence_norm) <= window:
            continue
        probes.extend(evidence_norm[i : i + window] for i in range(len(evidence_norm) - window + 1))
    return probes


def _first_match(probes: Sequence[str], candidates: Iterable[Candidate]) -> list[tuple[str, Any]]:
    for probe in probes:
        hits: list[tuple[str, Any]] = [(kind, ref) for norm, kind, ref in candidates if probe in norm]
        if hits:
            return hits
    return []


def resolve_evidence_refs(
    evidence: str,
    *,
    messages: Sequence[tuple[int, str, str]] = (),
    actions: Sequence[tuple[int, str, str]] = (),
    artifacts: Sequence[tuple[str, str]] = (),
    max_refs: int = 3,
) -> tuple[list[dict], bool]:
    """把一段证据原文映射为引用列表。

    Args:
        evidence: 模型给出的原文引用
        messages: ``(message_id, role, content)``
        actions: ``(action_id, kind, rendered_text)``
        artifacts: ``(artifact_kind, rendered_text)``

    Returns:
        ``(refs, verified)``；``refs`` 形如
        ``[{"kind": "message", "id": 12, "role": "student"}]``，
        ``verified=False`` 表示未能在既有记录中定位到该引用。
    """
    evidence_norm = normalize_for_match(evidence)
    probes = _probes(evidence_norm)
    if not probes:
        return [], False

    # 学生消息优先：评分对象是学生的行为；患者原话作为次选（可作为上下文证据）。
    student_msgs = [
        (normalize_for_match(c), REF_KIND_MESSAGE, (mid, "student")) for mid, role, c in messages if role == "student"
    ]
    other_msgs = [
        (normalize_for_match(c), REF_KIND_MESSAGE, (mid, role)) for mid, role, c in messages if role != "student"
    ]

    hits = _first_match(probes, student_msgs)
    if not hits:
        hits = _first_match(probes, other_msgs)
    if not hits:
        hits = _first_match(
            probes, [(normalize_for_match(text), REF_KIND_ACTION, (aid, kind)) for aid, kind, text in actions]
        )
    if not hits:
        hits = _first_match(
            probes, [(normalize_for_match(text), REF_KIND_ARTIFACT, (kind, "")) for kind, text in artifacts]
        )

    refs: list[dict] = []
    for kind, ref in hits[:max_refs]:
        if kind == REF_KIND_MESSAGE:
            message_id, role = ref
            refs.append({"kind": REF_KIND_MESSAGE, "id": message_id, "role": role})
        elif kind == REF_KIND_ACTION:
            action_id, action_kind = ref
            refs.append({"kind": REF_KIND_ACTION, "id": action_id, "action": action_kind})
        else:
            artifact_kind, _hint = ref
            refs.append({"kind": REF_KIND_ARTIFACT, "id": artifact_kind})
    return refs, bool(refs)
