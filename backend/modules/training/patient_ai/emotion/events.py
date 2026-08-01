"""四维情绪系统 — 事件类型与 LLM 输出 Schema。

LLM 只识别事件，不输出数值变化。
数值变化由规则引擎根据事件类型查表计算。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum

from pydantic import BaseModel, Field

from .models import EmotionDelta, EmotionVector


class EmotionEventType(StrEnum):
    """情绪事件类型。

    正面事件（来自护士建设性沟通行为）：
        empathy               共情 — 护士表达理解与关心
        active_listening      积极倾听 — 护士认真倾听、确认理解
        clear_explanation     清晰解释 — 护士用易懂语言解释病情
        respectful_communication  尊重沟通 — 护士尊重患者、使用恰当称呼
        reassurance           安抚 — 护士给予情感支持、减轻担忧

    负面事件（来自护士沟通失误）：
        interruption          打断 — 护士打断患者叙述
        repeated_question     重复询问 — 护士反复问已回答的问题
        judgmental_language   评判性语言 — 护士使用指责或评判语气
        privacy_intrusion     隐私冒犯 — 护士不当触及敏感话题
        dismissal             忽视 — 护士忽视或贬低患者主诉

    情境事件（来自外部临床情境）：
        request_cooperation   请求配合 — 护士请求患者配合检查或问诊
        explains_procedure    解释操作 — 护士解释即将进行的操作
        respects_refusal      尊重拒绝 — 护士尊重患者不愿检查的选择
        painful_exam          痛苦检查 — 患者经历疼痛的操作
        bad_news              坏消息 — 患者获知不好的检查结果
        long_wait             长时间等待 — 患者等待时间过长
        fatigue               疲劳 — 对话持续太久，患者疲劳
    """

    EMPATHY = "empathy"
    ACTIVE_LISTENING = "active_listening"
    CLEAR_EXPLANATION = "clear_explanation"
    RESPECTFUL_COMMUNICATION = "respectful_communication"
    REASSURANCE = "reassurance"

    INTERRUPTION = "interruption"
    REPEATED_QUESTION = "repeated_question"
    JUDGMENTAL_LANGUAGE = "judgmental_language"
    PRIVACY_INTRUSION = "privacy_intrusion"
    DISMISSAL = "dismissal"

    REQUEST_COOPERATION = "request_cooperation"
    EXPLAINS_PROCEDURE = "explains_procedure"
    RESPECTS_REFUSAL = "respects_refusal"
    PAINFUL_EXAM = "painful_exam"
    BAD_NEWS = "bad_news"
    LONG_WAIT = "long_wait"
    FATIGUE = "fatigue"
    FEVER = "fever"


class DetectedEmotionEvent(BaseModel):
    """LLM 检测到的单个情绪事件。

    confidence: LLM 对该事件识别结果的信心 [0,1]。
    evidence:   引用学生原话或对话上下文佐证。
    target:     事件关联的上下文引用，可选。
    """

    type: EmotionEventType
    confidence: float = Field(ge=0.0, le=1.0, default=1.0)
    evidence: str = ""
    target: str | None = None


class EmotionAnalysisResult(BaseModel):
    """LLM 情绪分析输出。

    只包含检测到的事件列表。没有事件时返回空数组。
    """

    events: list[DetectedEmotionEvent] = Field(default_factory=list)


@dataclass(slots=True)
class AppliedEmotionEvent:
    """规则引擎已应用的单个事件记录。

    包含事件类型、前后状态对比，用于审计和历史记录。
    """

    type: EmotionEventType
    confidence: float
    evidence: str
    before: EmotionVector
    delta: EmotionDelta
    after: EmotionVector

    @property
    def created_at(self) -> datetime:
        return datetime.now(UTC)

    def to_dict(self) -> dict:
        return {
            "type": self.type.value,
            "confidence": self.confidence,
            "evidence": self.evidence,
            "before": self.before.to_dict(),
            "delta": self.delta.to_dict(),
            "after": self.after.to_dict(),
        }
