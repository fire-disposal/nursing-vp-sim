"""assemble_patient_messages — 四域患者消息组装（纯函数）。

布局（固定形状，域序不可调换）：
  messages[0]      system  人设卡 (STATIC)        — 会话不变
  messages[1]      system  病例   (SESSION)       — 会话不变，逐字节稳定
  [可选] system   示例标记 + user/assistant 示例对  — EXAMPLES，会话不变
  [可选] user/assistant 历史（钉住的首 K 轮）        — HISTORY-HEAD，跨轮逐字节稳定
  [可选] system   中段摘要                          — HISTORY-SUMMARY，半稳定
  [可选] user/assistant 历史（近期尾部）             — HISTORY-TAIL，预算选择
  [可选] system   患者当前状态                      — PER-TURN，每轮变化
  messages[-1]     user    学生本轮输入

不变量：
  1. 纯函数：(case 渲染产物, session 状态, turn) → (messages, ledger)
  2. 稳定前缀 = 人设卡 + 病例 + 示例 + 钉住的首 K 轮，跨轮逐字节不变 → prefix cache 命中
     （评审 R1：旧实现预算饱和后从最旧端整条丢弃，首部每轮偏移，缓存全失效）
  3. 每轮状态只出现在一个 system 消息、一个位置；中段摘要位于 HISTORY 段内部，
     与 PER-TURN 状态消息是两处不同的注入（位置不同、内容来源不同）
  4. 除 history 外全部有界；history 上界 = 首 K 轮 + min_rounds 保底 + 预算 + 摘要预算
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from infra.llm.token_counter import estimate_tokens

from .budget import (
    HEAD_PINNED_ROUNDS,
    HISTORY_BUDGET_TOKENS,
    MIN_HISTORY_ROUNDS,
    PATIENT_STATE_BUDGET_TOKENS,
    compact_history,
    estimate_text_tokens,
    resolve_token_scale,
)
from .examples import EXAMPLES_MARKER
from .fragment import GUARD_SOURCES, ContextFragment, ContextSlot
from .patient_state import build_patient_state

log = logging.getLogger(__name__)


def _as_llm_message(msg) -> dict:
    """历史消息 → LLM 消息（学生轮 → user，其余 → assistant）。"""
    role = "user" if getattr(msg, "role", "") == "student" else "assistant"
    return {"role": role, "content": getattr(msg, "content", "")}


def assemble_patient_messages(
    *,
    system_prompt: str,
    session_prompt: str,
    history: list,
    student_input: str,
    patient_state: str = "",
    examples: list[dict] | None = None,
    history_budget_tokens: int = HISTORY_BUDGET_TOKENS,
    min_history_rounds: int = MIN_HISTORY_ROUNDS,
    head_pinned_rounds: int = HEAD_PINNED_ROUNDS,
    estimated_prompt_tokens: int | None = None,
    actual_prompt_tokens: int | None = None,
) -> tuple[list[dict], dict]:
    """组装患者 LLM messages 数组。

    ``estimated_prompt_tokens`` / ``actual_prompt_tokens`` 是**上一轮** prompt 的
    估算与实际用量（后者来自 API usage）：两者都给出时按真实值收紧历史预算
    （评审 R4），缺省则回退纯估算。ledger 里的 ``prompt_estimated_tokens`` 就是
    本轮整份 prompt 的估算总量，下一轮回传即可闭环。

    返回 (messages, ledger)；ledger 为各段 token 账本，供可观测性使用。
    """
    messages: list[dict] = [
        {"role": "system", "content": system_prompt},
        {"role": "system", "content": session_prompt},
    ]

    example_msgs = list(examples or [])
    if example_msgs:
        messages.append({"role": "system", "content": EXAMPLES_MARKER})
        messages.extend(example_msgs)

    token_scale = resolve_token_scale(estimated=estimated_prompt_tokens, actual=actual_prompt_tokens)
    selection = compact_history(
        history,
        budget_tokens=history_budget_tokens,
        min_rounds=min_history_rounds,
        head_rounds=head_pinned_rounds,
        token_scale=token_scale,
    )

    head_msgs = [_as_llm_message(m) for m in selection.head]
    tail_msgs = [_as_llm_message(m) for m in selection.tail]
    messages.extend(head_msgs)
    if selection.summary:
        messages.append({"role": "system", "content": selection.summary})
    messages.extend(tail_msgs)

    state_text = patient_state if patient_state and patient_state.strip() else ""
    if state_text:
        messages.append({"role": "system", "content": state_text})

    messages.append({"role": "user", "content": student_input})

    history_tokens = sum(estimate_text_tokens(m["content"]) for m in [*head_msgs, *tail_msgs])
    ledger = {
        "static_tokens": estimate_text_tokens(system_prompt),
        "session_tokens": estimate_text_tokens(session_prompt),
        "examples_tokens": sum(estimate_text_tokens(m["content"]) for m in example_msgs),
        "examples_pairs": len(example_msgs) // 2,
        "history_budget_tokens": history_budget_tokens,
        "history_effective_budget_tokens": selection.effective_budget_tokens,
        "history_token_scale": token_scale,
        "history_head_messages": len(head_msgs),
        "history_selected_tokens": history_tokens,
        "history_summarized": len(selection.summarized),
        "history_summary_tokens": estimate_text_tokens(selection.summary),
        "state_tokens": estimate_text_tokens(state_text),
        "user_tokens": estimate_text_tokens(student_input),
    }
    # 本轮整份 prompt 的估算总量：下一轮把它当 ``estimated_prompt_tokens`` 传回，
    # 与 API usage 的真实值对账（infra.llm.token_counter.reconcile_tokens）即闭环
    ledger["prompt_estimated_tokens"] = sum(
        ledger[key]
        for key in (
            "static_tokens",
            "session_tokens",
            "examples_tokens",
            "history_selected_tokens",
            "history_summary_tokens",
            "state_tokens",
            "user_tokens",
        )
    )
    return messages, ledger


def _truncate_tokens(text: str, max_tokens: int) -> str:
    # CJK ~0.6 token/char → ~1.67 char/token，用 1.5 保守估算
    max_chars = int(max_tokens * 1.5)
    return text[:max_chars] + "\u2026" if len(text) > max_chars else text


def _render_notes(notes: Sequence[str]) -> str:
    """患者状态注记的固定渲染形状（跨轮稳定，前端/快照按它比对）。"""
    return "\u3010" + " | ".join(notes) + "\u3011" if notes else ""


@dataclass(frozen=True)
class AssemblyResult:
    messages: list[dict]
    ledger: dict


class ContextAssembler:
    """唯一装配者：选择 / 排序 / 裁剪 / 预算 / 落位（docs/15 §八）。

    ``declared_sources`` 是本轮**被声明过**的贡献来源（Workflow 的 note_sources +
    本次病例实际启用的 Activity 的 ``context_contribution.key``）。未声明的来源、
    以及试图写内核保留槽位（ROLE/SCENARIO）的片段一律拒绝并记账 —— 这是"谁有权
    注入什么"的执行点，不是约定。

    ROLE/SCENARIO 由内核参数传入（Workflow 声明的模板 + 病例数据渲染），不接受
    任何贡献，因此 Activity 无法覆盖患者身份、安全边界或评分规则。
    """

    declared_sources: frozenset[str]

    def __init__(self, declared_sources: Iterable[str] = ()) -> None:
        self.declared_sources = frozenset(declared_sources)

    # ── 校验：谁能写哪个槽位 ────────────────────────────────────────────

    def accept(
        self,
        fragments: Iterable[ContextFragment],
        *,
        slot: ContextSlot,
    ) -> tuple[list[ContextFragment], list[dict]]:
        """按槽位校验来源，返回 (可用片段, 被拒记录)。空片段不算贡献。"""
        accepted: list[ContextFragment] = []
        rejected: list[dict] = []
        for fragment in fragments:
            reason = self._rejection_reason(fragment, slot=slot)
            if reason is not None:
                rejected.append({"source": fragment.source, "slot": str(fragment.slot), "reason": reason})
                continue
            if fragment.text and fragment.text.strip():
                accepted.append(fragment)
        accepted.sort(key=lambda f: f.priority)  # 稳定排序：同级保持来源顺序
        if rejected:
            log.warning("Context contributions rejected: %s", rejected)
        return accepted, rejected

    def _rejection_reason(self, fragment: ContextFragment, *, slot: ContextSlot) -> str | None:
        # 1) 片段自己声明的槽位是否允许该来源（"谁有权注入什么"），2) 装配位置是否匹配
        owner_reason = self._owner_reason(fragment)
        if owner_reason is not None:
            return owner_reason
        if fragment.slot != slot:
            return "slot-mismatch"
        return None

    def _owner_reason(self, fragment: ContextFragment) -> str | None:
        if fragment.slot is ContextSlot.PATIENT_STATE:
            return None if fragment.source in self.declared_sources else "undeclared-source"
        if fragment.slot is ContextSlot.GUARD:
            return None if fragment.source in GUARD_SOURCES else "undeclared-guard-source"
        # ROLE / SCENARIO：内核保留槽位，任何贡献都是越权（身份/病例事实不可被覆盖）
        return "kernel-reserved-slot"

    # ── 装配 ────────────────────────────────────────────────────────────

    def assemble(
        self,
        *,
        role: str,
        scenario: str,
        history: list,
        student_input: str,
        examples: list[dict] | None = None,
        fragments: Iterable[ContextFragment] = (),
        scene_text: str = "",
        history_budget_tokens: int = HISTORY_BUDGET_TOKENS,
        min_history_rounds: int = MIN_HISTORY_ROUNDS,
        head_pinned_rounds: int = HEAD_PINNED_ROUNDS,
        estimated_prompt_tokens: int | None = None,
        actual_prompt_tokens: int | None = None,
    ) -> AssemblyResult:
        accepted, rejected = self.accept(fragments, slot=ContextSlot.PATIENT_STATE)
        selected, budget_rejected = self._select_notes(accepted)
        rejected.extend(budget_rejected)

        note_text = _render_notes(selected)
        patient_state = build_patient_state(scene_text=scene_text, note_text=note_text)

        messages, ledger = assemble_patient_messages(
            system_prompt=role,
            session_prompt=scenario,
            history=history,
            student_input=student_input,
            patient_state=patient_state,
            examples=examples,
            history_budget_tokens=history_budget_tokens,
            min_history_rounds=min_history_rounds,
            head_pinned_rounds=head_pinned_rounds,
            estimated_prompt_tokens=estimated_prompt_tokens,
            actual_prompt_tokens=actual_prompt_tokens,
        )
        ledger["contributions"] = [
            {"source": f.source, "slot": str(f.slot), "tokens": estimate_text_tokens(f.text.strip())} for f in accepted
        ]
        ledger["rejected_contributions"] = rejected
        ledger["patient_state_tokens"] = estimate_text_tokens(patient_state)
        return AssemblyResult(messages=messages, ledger=ledger)

    def _select_notes(self, fragments: Sequence[ContextFragment]) -> tuple[list[str], list[dict]]:
        """按优先级 + 槽位预算裁剪患者状态注记（装配者唯一决定，来源只声明上限）。"""
        budget = PATIENT_STATE_BUDGET_TOKENS
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
        return selected, dropped


def append_guard_fragments(messages: list[dict], fragments: Iterable[ContextFragment]) -> list[dict]:
    """出站守卫修正：在消息尾部追加声明过的 GUARD 片段（不改写既有消息）。

    守卫是内核安全边界，不属于任何 Activity/病例的声明集合；因此这里用**只允许
    GUARD 槽位**的装配器校验，越权来源同样被拒绝而不是静默拼进系统提示。
    """
    assembler = ContextAssembler()
    accepted, rejected = assembler.accept(fragments, slot=ContextSlot.GUARD)
    if rejected:
        log.warning("Guard contributions rejected: %s", rejected)
    return [*messages, *({"role": "system", "content": fragment.text.strip()} for fragment in accepted)]
