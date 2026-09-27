"""患者消息编译 —— 患者扮演上下文的**唯一**装配入口（docs/15 §八）。

布局（固定形状，域序不可调换）：

  messages[0]      system  人设卡 (ROLE)        — 会话不变
  messages[1]      system  病例   (SCENARIO)    — 会话不变，逐字节稳定
  [可选] system   示例标记 + user/assistant 示例对   — EXAMPLES，会话不变
  [可选] user/assistant 历史（钉住的首 K 轮）        — HISTORY-HEAD，跨轮逐字节稳定
  [可选] system   中段摘要                          — HISTORY-SUMMARY，半稳定
  [可选] user/assistant 历史（近期尾部）             — HISTORY-TAIL，预算选择
  [可选] system   患者当前状态                      — PER-TURN，每轮变化
  messages[-1]     user    学生本轮输入

不变量：

  1. 纯函数：入参齐备即可复算，无 IO、无跨轮状态（没有任何"缓存"承诺）；
  2. 稳定前缀 = 人设卡 + 病例 + 示例 + 钉住的首 K 轮，跨轮逐字节不变 → prefix cache 命中
     （评审 R1：旧实现预算饱和后从最旧端整条丢弃，首部每轮偏移，缓存全失效）；
  3. 每轮状态只出现在一个 system 消息、一个位置；中段摘要位于 HISTORY 段内部，
     与 PER-TURN 状态消息是两处不同的注入（位置不同、内容来源不同）；
  4. 除 history 外全部有界；history 上界 = 首 K 轮 + min_rounds 保底 + 预算 + 摘要预算。

槽位权限（"谁有权注入什么"）在本模块执行，不是约定：

  ``ROLE`` / ``SCENARIO`` 由内核参数传入（Workflow 声明的模板 + 病例数据渲染），
  **不接受任何贡献** —— 患者身份与病例事实不可被 Activity 覆盖；
  ``PATIENT_STATE`` 只接受 ``declared_sources`` 里的来源；
  ``GUARD`` 只接受内核守卫来源，且只能追加到消息尾部重试。
被拒的贡献一律记 warning（越权尝试是安全事件，不是噪声）。
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Sequence

from infra.llm.token_counter import estimate_tokens

from .budget import (
    DEFAULT_POLICY,
    ContextPolicy,
    compact_history,
)
from .examples import EXAMPLES_MARKER
from .fragment import GUARD_SOURCES, ContextFragment, ContextSlot

log = logging.getLogger(__name__)

#: 消息布局与选择算法的版本。**改动本模块的装配行为必须 +1**：算法本身无法被哈希，
#: 这个显式版本号是让 ``context_policy_version`` 覆盖"改了算法但策略字段没动"的
#: 唯一手段（否则该改动在观测上是隐形的）。
COMPILER_SCHEMA = 1

PATIENT_STATE_HEADER = "【患者当前状态 — 以下为患者此刻的实时事实，仅本轮生效】"


def build_patient_state(*, scene_text: str = "", note_text: str = "") -> str:
    """合成每轮状态消息；无任何内容时返回空串（调用方跳过该消息）。"""
    sections: list[str] = []
    if note_text and note_text.strip():
        sections.append(note_text.strip())
    if scene_text and scene_text.strip():
        sections.append(scene_text.strip())
    if not sections:
        return ""
    return PATIENT_STATE_HEADER + "\n" + "\n\n".join(sections)


def compile_patient_prompt(
    *,
    role: str,
    scenario: str,
    history: list,
    student_input: str,
    fragments: Iterable[ContextFragment] = (),
    declared_sources: Iterable[str] = (),
    examples: list[dict] | None = None,
    scene_text: str = "",
    policy: ContextPolicy = DEFAULT_POLICY,
) -> list[dict]:
    """编译患者 LLM messages 数组（纯函数）。

    ``declared_sources`` 是本轮**被声明过**的患者状态贡献来源（Workflow 的
    ``note_sources`` ∪ 本次病例实际启用 Activity 的 ``context_contribution.key``，
    见 ``WorkflowDefinition.context_sources``）。未声明的来源会被拒绝并记录。
    """
    accepted, _ = _accept(fragments, slot=ContextSlot.PATIENT_STATE, declared_sources=declared_sources)
    selected, _ = _select_notes(accepted, budget=policy.patient_state_budget_tokens)
    patient_state = build_patient_state(scene_text=scene_text, note_text=_render_notes(selected))

    messages: list[dict] = [
        {"role": "system", "content": role},
        {"role": "system", "content": scenario},
    ]

    example_msgs = list(examples or [])
    if example_msgs:
        messages.append({"role": "system", "content": EXAMPLES_MARKER})
        messages.extend(example_msgs)

    selection = compact_history(history, policy=policy)
    messages.extend(_as_llm_message(m) for m in selection.head)
    if selection.summary:
        messages.append({"role": "system", "content": selection.summary})
    messages.extend(_as_llm_message(m) for m in selection.tail)

    if patient_state:
        messages.append({"role": "system", "content": patient_state})

    messages.append({"role": "user", "content": student_input})
    return messages


def append_guard_fragments(messages: list[dict], fragments: Iterable[ContextFragment]) -> list[dict]:
    """出站守卫修正：在消息尾部追加声明过的 GUARD 片段（不改写既有消息）。

    守卫是内核安全边界，不属于任何 Activity/病例的声明集合；因此这里只允许
    ``GUARD_SOURCES`` 的来源，越权片段被拒绝而不是静默拼进系统提示。
    """
    accepted, _ = _accept(fragments, slot=ContextSlot.GUARD, declared_sources=GUARD_SOURCES)
    return [*messages, *({"role": "system", "content": fragment.text.strip()} for fragment in accepted)]


# ── 内部：槽位校验与患者状态选择 ────────────────────────────────────────────


def _accept(
    fragments: Iterable[ContextFragment],
    *,
    slot: ContextSlot,
    declared_sources: Iterable[str],
) -> tuple[list[ContextFragment], list[dict]]:
    """按槽位校验来源，返回 (可用片段, 被拒记录)。空片段不算贡献。"""
    declared = frozenset(declared_sources)
    accepted: list[ContextFragment] = []
    rejected: list[dict] = []
    for fragment in fragments:
        reason = _rejection_reason(fragment, slot=slot, declared_sources=declared)
        if reason is not None:
            rejected.append({"source": fragment.source, "slot": str(fragment.slot), "reason": reason})
            continue
        if fragment.text and fragment.text.strip():
            accepted.append(fragment)
    accepted.sort(key=lambda f: f.priority)  # 稳定排序：同级保持来源顺序
    if rejected:
        log.warning("Context contributions rejected: %s", rejected)
    return accepted, rejected


def _rejection_reason(
    fragment: ContextFragment,
    *,
    slot: ContextSlot,
    declared_sources: frozenset[str],
) -> str | None:
    # 1) "谁有权注入什么"：先按片段自己声明的槽位判定来源资格
    if fragment.slot is ContextSlot.PATIENT_STATE:
        if fragment.source not in declared_sources:
            return "undeclared-source"
    elif fragment.slot is ContextSlot.GUARD:
        if fragment.source not in GUARD_SOURCES:
            return "undeclared-guard-source"
    else:
        # ROLE / SCENARIO：内核保留槽位，任何贡献都是越权（身份/病例事实不可被覆盖）
        return "kernel-reserved-slot"
    # 2) 装配位置必须与片段声明的槽位一致（装配位置由装配器定，不由来源自选）
    if fragment.slot != slot:
        return "slot-mismatch"
    return None


def _select_notes(fragments: Sequence[ContextFragment], *, budget: int) -> tuple[list[str], list[dict]]:
    """按优先级 + 槽位预算裁剪患者状态注记（装配者唯一决定，来源只声明上限）。"""
    selected: list[str] = []
    dropped: list[dict] = []
    for fragment in fragments:
        cap = fragment.max_tokens if fragment.max_tokens and fragment.max_tokens > 0 else budget
        allowance = min(cap, budget)
        text = fragment.text.strip()
        if estimate_tokens(text) > allowance:
            if not selected:
                truncated = _truncate_tokens(text, allowance)
                selected.append(truncated)
                budget -= estimate_tokens(truncated)
            else:
                dropped.append({"source": fragment.source, "slot": str(fragment.slot), "reason": "budget"})
            continue
        selected.append(text)
        budget -= estimate_tokens(text)
    if dropped:
        log.warning("Patient-state contributions dropped over budget: %s", dropped)
    return selected, dropped


def _as_llm_message(msg) -> dict:
    """历史消息 → LLM 消息（学生轮 → user，其余 → assistant）。"""
    role = "user" if getattr(msg, "role", "") == "student" else "assistant"
    return {"role": role, "content": getattr(msg, "content", "")}


def _truncate_tokens(text: str, max_tokens: int) -> str:
    # CJK ~0.6 token/char → ~1.67 char/token，用 1.5 保守估算
    max_chars = int(max_tokens * 1.5)
    return text[:max_chars] + "\u2026" if len(text) > max_chars else text


def _render_notes(notes: Sequence[str]) -> str:
    """患者状态注记的固定渲染形状（跨轮稳定，前端/快照按它比对）。"""
    return "\u3010" + " | ".join(notes) + "\u3011" if notes else ""


__all__ = [
    "COMPILER_SCHEMA",
    "PATIENT_STATE_HEADER",
    "append_guard_fragments",
    "build_patient_state",
    "compile_patient_prompt",
]
