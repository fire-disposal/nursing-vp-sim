"""四维情绪系统 — 行为策略派生。

将四维情绪数值转换为行为策略 (PatientBehaviorPolicy)，
用于注入患者生成 Prompt 和 TTS 参数控制。

情绪数值不能直接注入 Prompt，必须先转为行为描述。
"""

from __future__ import annotations

from dataclasses import dataclass

from .models import EmotionVector, clamp01


@dataclass(frozen=True, slots=True)
class PatientBehaviorPolicy:
    """患者行为策略 — 情绪状态的抽象行为表现。

    disclosure:   信息披露程度 [0,1] — 越低越不愿透露敏感信息
    verbosity:    回答长度 [0,1] — 越低回答越简短
    initiative:   主动性 [0,1] — 越高越主动补充信息
    cooperation:  配合程度 [0,1] — 越低越抵触检查/问诊
    repetition:   重复倾向 [0,1] — 越高越可能重复确认

    tone:         语气描述（中文，直接注入 Prompt）
    response_style: 回答风格描述
    refusal_style:  拒绝风格描述（可能为 None）
    """

    disclosure: float
    verbosity: float
    initiative: float
    cooperation: float
    repetition: float

    tone: str
    response_style: str
    refusal_style: str | None = None


def derive_behavior(state: EmotionVector) -> PatientBehaviorPolicy:
    """从四维情绪状态派生患者行为策略。

    所有数值基于 [0,1] 范围的浮点状态。
    """
    disclosure = clamp01(
        0.15 + state.trust * 0.75 - state.irritation * 0.25
    )

    verbosity = clamp01(
        0.45 + state.trust * 0.25 + state.anxiety * 0.15 - state.irritation * 0.45
    )

    initiative = clamp01(
        0.10 + state.trust * 0.45 + state.anxiety * 0.15 - state.irritation * 0.30
    )

    cooperation = state.cooperation

    repetition = clamp01(
        state.anxiety * 0.70 - state.irritation * 0.15
    )

    tone = _resolve_tone(state)
    response_style = _resolve_response_style(state)
    refusal_style = _resolve_refusal_style(state)

    return PatientBehaviorPolicy(
        disclosure=disclosure,
        verbosity=verbosity,
        initiative=initiative,
        cooperation=cooperation,
        repetition=repetition,
        tone=tone,
        response_style=response_style,
        refusal_style=refusal_style,
    )


def _resolve_tone(state: EmotionVector) -> str:
    """根据四维状态解析患者语气描述。"""
    if state.irritation >= 0.75:
        return "明显不耐烦，语气生硬，但不得辱骂或失控"

    if state.anxiety >= 0.75 and state.trust >= 0.55:
        return "明显紧张，频繁确认病情，但仍信任并配合医护人员"

    if state.anxiety >= 0.75:
        return "紧张且戒备，回答容易犹豫"

    if state.trust <= 0.30 and state.cooperation <= 0.35:
        return "疏离、简短，不主动透露信息"

    if state.trust >= 0.75 and state.irritation <= 0.25:
        return "自然、开放，愿意主动补充相关细节"

    return "平稳、正常交流"


def _resolve_response_style(state: EmotionVector) -> str:
    """根据四维状态解析回答风格描述。"""
    disclosure = clamp01(0.15 + state.trust * 0.75 - state.irritation * 0.25)
    verbosity = clamp01(0.45 + state.trust * 0.25 + state.anxiety * 0.15 - state.irritation * 0.45)

    parts: list[str] = []

    # 信息披露程度
    if disclosure >= 0.7:
        parts.append("愿意详细回答问题，包括敏感信息")
    elif disclosure >= 0.4:
        parts.append("愿意回答一般问题；敏感信息需要先说明询问原因")
    else:
        parts.append("仅回答最直接的问题，回避深入细节")

    # 回答长度
    if verbosity >= 0.7:
        parts.append("回答较为详细，通常 2～4 句")
    elif verbosity >= 0.4:
        parts.append("通常回答 1～3 句")
    else:
        parts.append("回答尽量简短，通常 1 句以内")

    # 主动性
    initiative = clamp01(0.10 + state.trust * 0.45 + state.anxiety * 0.15 - state.irritation * 0.30)
    if initiative >= 0.6:
        parts.append("偶尔主动补充与当前问题有关的信息")
    elif initiative <= 0.25:
        parts.append("不会主动提供额外信息")

    # 重复
    if state.anxiety >= 0.6:
        parts.append("可能重复确认疾病是否严重")

    return "；".join(parts)


def _resolve_refusal_style(state: EmotionVector) -> str | None:
    """根据四维状态解析拒绝风格。

    None 表示当前状态不太可能拒绝。
    """
    if state.cooperation >= 0.6:
        return None

    if state.irritation >= 0.6:
        return "直接拒绝，语气略带不耐烦，可能反问"

    if state.trust <= 0.3 and state.cooperation <= 0.3:
        return "沉默或转移话题，不直接说'不'但也不配合"

    if state.anxiety >= 0.7:
        return "犹豫不决，表达担忧，可能反复确认后才肯配合"

    return "温和推脱，找理由不配合"
