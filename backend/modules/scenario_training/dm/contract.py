"""DM 两个模型阶段的输出契约与平台侧校验。

阶段分明（docs/23 §4）：
- **解析阶段**（`parse_intent` / `validate_intent`）：把学生的一次表达说成一个 `IntentResolution`；
  可以读包里的动作约束与隐藏依据，但**结论只是提议**，平台仍要校验。
- **演出阶段**（`parse_delivery` / `validate_delivery`）：只输出 `SceneDelivery`（消息/提示/资源引用），
  **没有**状态写权限，也没有 `effects` / `reveals` / `facts` / 笔记 / 委派字段。

两个阶段的 JSON 形状**由模型生成**（`model_json_schema()` 直接进提示词），不另写散文枚举规范。
"""

from __future__ import annotations

import json
import re
from typing import Any

from pydantic import BaseModel, ValidationError

from infra.llm import safe_parse_json

from ..runtime.world import World, facts_observed, visible_affordances
from ..schema import ScenarioPack
from ..turns import (
    AttemptOutcome,
    DeliveryMessage,
    IntentKind,
    IntentResolution,
    SceneDelivery,
    TargetKind,
    TargetRef,
)

MAX_MESSAGES = 8
MAX_TEXT = 600
MAX_HINTS = 3
MAX_CLARIFICATION = 200
_FENCE = re.compile(r"^```[a-zA-Z]*\s*|\s*```$")


class StageError(ValueError):
    """模型输出不满足该阶段的结构要求（可纠偏重试一次）。"""


def schema_of(model: type[BaseModel]) -> str:
    """把 pydantic 模型生成成提示词里的 JSON schema（形状与前端类型的唯一来源）。"""
    return json.dumps(model.model_json_schema(), ensure_ascii=False, separators=(",", ":"))


def _unwrap(raw: str) -> Any:
    text = _FENCE.sub("", raw.strip()).strip()
    return safe_parse_json(text)


def banned_terms(pack: ScenarioPack, world: World | None = None) -> list[str]:
    """按钮/选项/提示文案里不得出现的术语：由 facts 派生（作者可用 banned_phrases 显式补充）。

    已经**揭示/采集**的事实不再算泄底——否则一旦让学生看见某条线索，就再也不能谈论它。
    """
    observed = facts_observed(pack, world) if world is not None else set()
    terms: list[str] = []
    for fact in pack.facts:
        if fact.id in observed:
            continue
        for token in re.split(r"[^\w\u4e00-\u9fff]+", f"{fact.id} {fact.intent}"):
            if len(token) >= 2:
                terms.append(token)
        terms.extend(fact.banned_phrases)
    return sorted(set(terms))


# --------------------------------------------------------------------------- #
# 第一阶段：意图解析
# --------------------------------------------------------------------------- #


def parse_intent(raw: str) -> IntentResolution:
    try:
        return IntentResolution.model_validate(_unwrap(raw))
    except (ValidationError, ValueError, TypeError) as exc:
        raise StageError(f"intent_shape:{exc}") from exc


_GENERIC_CLARIFICATION = {
    "target": "你要对谁做这件事？请从现场的对象里选一个。",
    "action": "你想做的事具体是哪一步？请说明你要先尝试哪一个动作。",
    "default": "请补充一下：你要做什么、对谁做？",
}


def fallback_clarification(pack: ScenarioPack, world: World, target: TargetRef | None) -> str:
    """澄清问题的最小兜底（**确定性**，不依赖模型措辞；不含答案提示）。"""
    if target is None:
        bound = [item for item in visible_affordances(pack, world) if len(item.targets) > 1]
        if bound:
            return _GENERIC_CLARIFICATION["target"]
    return _GENERIC_CLARIFICATION["default"]


def validate_intent(
    pack: ScenarioPack,
    world: World,
    intent: IntentResolution,
    *,
    utterance: str,
    problems: list[str],
) -> IntentResolution:
    """把模型提议规范成"平台敢结算"的形态；**丢弃非法项并记账**，绝不静默凑成一次有效处置。"""
    declared_target = intent.target is not None
    target = intent.target
    if declared_target and target is not None and target.kind is TargetKind.ACTOR and pack.actor(target.id) is None:
        problems.append(f"intent_unknown_target:{target.kind.value}:{target.id}")
        target = None
    elif target is not None and target.kind is TargetKind.DEVICE and pack.device(target.id) is None:
        problems.append(f"intent_unknown_target:device:{target.id}")
        target = None
    elif target is not None and target.kind is TargetKind.SCENE and target.id != "scene":
        problems.append(f"intent_unknown_target:scene:{target.id}")
        target = None

    kind = intent.kind
    affordance_id = intent.affordance_id
    if kind is IntentKind.ACTION and affordance_id and pack.affordance(affordance_id) is None:
        # 模型点名了一个不存在的动作：宁可当"未建模的尝试"，也不要硬凑一个最接近的动作
        problems.append(f"intent_undelcared_affordance:{affordance_id}")
        affordance_id = None
    if kind is IntentKind.CLARIFICATION and affordance_id:
        problems.append(f"intent_clarification_with_action:{affordance_id}")
        affordance_id = None

    said = utterance[:MAX_TEXT]  # **学生原话**：模型的转述一律不作证据
    if kind is not IntentKind.CLARIFICATION:
        return IntentResolution(
            kind=kind,
            target=target,
            affordance_id=affordance_id,
            selection=list(intent.selection) if affordance_id else [],
            utterance=said,
            clarification="",
            social_updates=list(intent.social_updates),
        )

    question = " ".join(intent.clarification.split())[:MAX_CLARIFICATION]
    leaks = leak_terms(pack, world)
    if not question:
        problems.append("intent_clarification_empty")
        question = fallback_clarification(pack, world, target)
    elif any(term in question for term in leaks):
        problems.append("intent_clarification_leaks")
        question = fallback_clarification(pack, world, target)
    return IntentResolution(
        kind=IntentKind.CLARIFICATION,
        target=target,
        affordance_id=None,
        selection=[],
        utterance=said,
        clarification=question,
    )


# --------------------------------------------------------------------------- #
# 第二阶段：演出
# --------------------------------------------------------------------------- #


def parse_delivery(raw: str) -> SceneDelivery:
    try:
        return SceneDelivery.model_validate(_unwrap(raw))
    except (ValidationError, ValueError, TypeError) as exc:
        raise StageError(f"delivery_shape:{exc}") from exc


def leak_terms(pack: ScenarioPack, world: World) -> list[str]:
    """**不得出现在学生可见文本里**的短语（隐藏事实的证据口径）。

    与 `banned_terms` 的区别：这里只取**作者显式写的整句/短语**（未采集事实的 `intent`、
    `banned_phrases`、未揭示线索的全文、`hidden_from_player`），不切词——
    切词会把某个读数缩写这类正常说法也判成泄底，宁可精确、不要误杀。
    """
    observed = facts_observed(pack, world)
    terms: list[str] = []
    for fact in pack.facts:
        if fact.id in observed:
            continue
        terms.append(fact.intent)
        terms.extend(fact.banned_phrases)
    terms.extend(cue.text for cue in pack.setting.cues if cue.id not in world.revealed)
    terms.extend(pack.hidden_from_player)
    return sorted({term for term in terms if len(term) >= 4})


def _reject_leak(text: str, leaks: list[str]) -> None:
    """泄底短语**整条拒绝**，绝不"剥掉非法部分再照说"。"""
    hit = next((term for term in leaks if term in text), None)
    if hit is not None:
        raise StageError(f"delivery_leak:{hit[:24]}")


def _reject_unknown_refs(kind: str, refs: list[str], allowed: set[str]) -> None:
    """引用（来源 / 资源 / 高亮）必须已在学生这一侧可见。"""
    unknown = [ref for ref in refs if ref not in allowed]
    if unknown:
        raise StageError(f"delivery_unknown_{kind}:{','.join(unknown)[:40]}")


def _checked_message(
    message: DeliveryMessage,
    *,
    leaks: list[str],
    actor_ids: set[str],
    allowed_refs: set[str],
) -> DeliveryMessage:
    """一条消息：文本、说话人、来源全部过关才收（未声明的说话人须给出显示名 → 临时角色）。"""
    text = " ".join(message.text.split())[:MAX_TEXT]
    if not text:
        raise StageError("delivery_empty_message")
    _reject_leak(text, leaks)
    speaker = (message.speaker or "").strip() or None
    as_role = " ".join(message.as_role.split())[:40]
    ephemeral = False
    if speaker is not None and speaker not in actor_ids:
        if not as_role:
            raise StageError(f"delivery_unknown_speaker:{speaker}")
        ephemeral = True  # 临时角色：有显示名、无状态写权限
    _reject_unknown_refs("source", message.sources, allowed_refs)
    return DeliveryMessage(
        speaker=speaker, as_role=as_role, ephemeral=ephemeral, text=text, sources=list(message.sources)
    )


def _checked_hint(hint: str, leaks: list[str]) -> str | None:
    """一条提示：空白丢弃（返回 `None`）；越界照旧整条拒绝。"""
    text = " ".join(hint.split())[:MAX_TEXT]
    if not text:
        return None
    _reject_leak(text, leaks)
    return text


def validate_delivery(
    pack: ScenarioPack,
    world: World,
    delivery: SceneDelivery,
    *,
    allowed_refs: set[str],
) -> SceneDelivery:
    """演出的**安全边界**：引用、说话人、泄底一律**整条拒绝**，绝不"剥掉非法部分再照说"。

    越界即 `StageError`（由 `run_delivery` 在有界纠偏里让模型重来；第二次仍越界就不提交）。
    结构校验不能证明自然语言绝不撒谎（docs/23 §4.4）——能查的只有：说话人是否已声明、
    引用是否已可见、文本是否含未获准的短语。其余靠缩小演出输入与真实对抗回合降风险。
    """
    problems: list[str] = []
    if delivery_is_empty(delivery):
        raise StageError("delivery_empty")
    if not delivery.messages and not delivery.hints:
        raise StageError("delivery_empty")

    leaks = leak_terms(pack, world)
    actor_ids = {actor.id for actor in pack.actors}
    declared_assets = {asset.id for asset in pack.assets}
    messages: list[DeliveryMessage] = []
    for message in delivery.messages[:MAX_MESSAGES]:
        messages.append(_checked_message(message, leaks=leaks, actor_ids=actor_ids, allowed_refs=allowed_refs))
    if len(delivery.messages) > MAX_MESSAGES:
        problems.append(f"delivery_messages_truncated:{len(delivery.messages)}")

    hints: list[str] = []
    for hint in delivery.hints[:MAX_HINTS]:
        text = _checked_hint(hint, leaks)
        if text is not None:
            hints.append(text)

    _reject_unknown_refs("asset", delivery.assets, declared_assets)
    _reject_unknown_refs("highlight", delivery.highlights, allowed_refs)
    return SceneDelivery(
        messages=messages,
        hints=hints,
        assets=list(delivery.assets),
        highlights=list(delivery.highlights),
    )


def delivery_is_empty(delivery: SceneDelivery) -> bool:
    return not delivery.messages and not delivery.hints


def notice_for(pack: ScenarioPack, outcome: AttemptOutcome, block_reason: str, text: str) -> str:
    """`blocked` / `unmodeled` 的**引擎直出**说明（保证被看见，且不依赖模型措辞）。"""
    if outcome is AttemptOutcome.BLOCKED:
        return {
            "target_unreachable": "你够不到这个对象——他/它此刻不在你能触及的范围内。",
            "affordance_unavailable": "此刻做不了这件事：这个情境还不允许这样操作。",
        }.get(block_reason, "这件事此刻做不到。")
    if outcome is AttemptOutcome.UNMODELED:
        said = f"「{text}」" if text else "这个做法"
        return f"{said}在当前情境里没有建模，平台无法模拟它的此类后果。"
    return ""
