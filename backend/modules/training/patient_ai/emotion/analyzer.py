"""四维情绪系统 — LLM 情绪分析器。

调用 LLM 分析学生消息，识别沟通情绪事件。
LLM 只输出事件类型 + 置信度 + 证据，不输出数值变化。

关键约束：
    只识别学生行为和明确的外部临床事件。
    患者回复是旧状态的表现，不得因患者语气而生成负面事件。

调用 LLM 之前先过确定性敌意预闸（``hostility``）：词表命中直接产出 INSULT，
不再依赖模型自由心证、也不再发起 LLM 调用。
"""

from __future__ import annotations

import logging

from core.exceptions import LLMParseError
from core.template import render_template
from infra.llm.client import CallContext
from infra.llm.profile import get_llm_config
from modules.training.prompts.emotion import EMOTION_ANALYSIS_SYSTEM, EMOTION_ANALYSIS_USER

from .events import DetectedEmotionEvent, EmotionAnalysisResult, EmotionEventType
from .hostility import detect_hostile_event

log = logging.getLogger(__name__)


class EmotionAnalyzer:
    """基于 LLM 的情绪事件分析器。"""

    def __init__(self, llm_client) -> None:
        self._llm = llm_client

    async def analyze(
        self,
        nurse_message: str,
        patient_reply: str = "",
        user_id: int | None = None,
        record_id: int | None = None,
        case_id: int | None = None,
    ) -> EmotionAnalysisResult:
        """分析护士发言，返回检测到的情绪事件列表。"""
        # 0. 确定性敌意预闸：辱骂/诅咒/人身攻击不由模型判断（见 hostility 模块说明）
        hostile = detect_hostile_event(nurse_message)
        if hostile is not None:
            log.warning(
                "Hostile language detected by lexicon, skipping LLM: record_id=%s evidence=%s",
                record_id,
                hostile.evidence,
            )
            return EmotionAnalysisResult(events=[hostile])

        try:
            user_msg = render_template(
                EMOTION_ANALYSIS_USER,
                nurse_message=nurse_message,
                patient_reply=patient_reply,
            )
            messages = [
                {"role": "system", "content": EMOTION_ANALYSIS_SYSTEM},
                {"role": "user", "content": user_msg},
            ]
            # 模型/超时/token 预算/重试/response_format 全部取自 profile，"emotion_analysis"
            # 是唯一真值（原先这里硬编码 temperature=0.3/max_tokens=256，覆盖了 profile 的
            # 128 与 json_object，导致调参与运维面分叉）。
            data = await self._llm.call_json(
                messages,
                purpose="emotion_analysis",
                ctx=CallContext(
                    purpose="emotion_analysis",
                    user_id=user_id or 0,
                    record_id=record_id or 0,
                    case_id=case_id or 0,
                ),
                **get_llm_config("emotion_analysis"),
            )
        except LLMParseError:
            # 解析失败不能静默降级：原文（截断）已随异常带出，这里落日志供排查
            log.warning("Emotion analysis returned unparsable JSON: record_id=%s", record_id, exc_info=True)
            return EmotionAnalysisResult(events=[])
        except Exception:
            log.warning("Emotion analysis LLM call failed: record_id=%s", record_id, exc_info=True)
            return EmotionAnalysisResult(events=[])

        return _build_result(data)


def _build_result(data: dict) -> EmotionAnalysisResult:
    """把已解析的 JSON 对象映射为情绪事件列表（未知类型丢弃，confidence 钳制到 [0,1]）。"""
    events_raw = data.get("events", [])
    if not isinstance(events_raw, list):
        return EmotionAnalysisResult(events=[])

    events: list[DetectedEmotionEvent] = []
    for item in events_raw:
        if not isinstance(item, dict):
            continue
        event_type_str = item.get("type", "")
        try:
            event_type = EmotionEventType(event_type_str)
        except ValueError:
            log.warning("Unknown emotion event type: %s", event_type_str)
            continue

        try:
            confidence = float(item.get("confidence", 1.0))
        except (TypeError, ValueError):
            confidence = 1.0
        confidence = max(0.0, min(1.0, confidence))

        events.append(
            DetectedEmotionEvent(
                type=event_type,
                confidence=confidence,
                evidence=str(item.get("evidence", "")),
                target=item.get("target"),
            )
        )

    return EmotionAnalysisResult(events=events)
