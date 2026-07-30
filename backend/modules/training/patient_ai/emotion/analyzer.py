"""四维情绪系统 — LLM 情绪分析器。

调用 LLM 分析学生消息，识别沟通情绪事件。
LLM 只输出事件类型 + 置信度 + 证据，不输出数值变化。

关键约束：
    只识别学生行为和明确的外部临床事件。
    患者回复是旧状态的表现，不得因患者语气而生成负面事件。
"""

from __future__ import annotations

import json
import logging

from core.template import render_template
from infra.llm.client import CallContext

from .events import EmotionAnalysisResult, DetectedEmotionEvent, EmotionEventType

log = logging.getLogger(__name__)

EMOTION_ANALYSIS_SYSTEM = """你是护理对话情绪分析助手。分析护士最新发言，识别其中对患者情绪产生影响的行为事件。

## 输出格式
```json
{"events": [{"type": "<event_type>", "confidence": <0.0-1.0>, "evidence": "<引用原文>", "target": null}]}
```

## 事件类型

正面事件（护士建设性沟通）：
- empathy：护士表达了共情、理解或关心
- active_listening：护士认真倾听、复述或确认患者表达的内容
- clear_explanation：护士用清晰易懂的语言解释病情、检查或治疗
- respectful_communication：护士使用恰当称呼、尊重患者选择
- reassurance：护士给予情感支持、安抚或减轻担忧
- explains_procedure：护士解释即将进行的操作步骤和原因
- respects_refusal：护士尊重患者不愿接受检查或回答的选择
- request_cooperation：护士礼貌请求患者配合检查或问诊

负面事件（护士沟通失误）：
- interruption：护士打断患者正在说的话
- repeated_question：护士反复询问患者已回答过的问题
- judgmental_language：护士使用指责、批评或评判性语言
- privacy_intrusion：护士不当触及敏感隐私话题或未解释即询问隐私
- dismissal：护士忽视、贬低或否定患者的主诉

情境事件（外部临床事件，非护士直接行为导致）：
- painful_exam：护士对患者进行了可能疼痛的检查操作
- bad_news：护士告知患者不好的检查结果或诊断
- long_wait：患者经历了较长时间的等待
- fatigue：对话轮次较多，患者因疲劳导致不耐烦

## 规则
- 只识别护士行为和明确的外部临床事件。
- 患者回复是旧情绪状态的表现，不得因为患者语气焦虑、烦躁或冷淡而生成负面事件。
- 不要输出情绪数值。
- 不要输出状态变化值。
- 没有明确事件时返回 {"events": []}。
- 仅返回一行 JSON，不包含任何其他文字、解释或 markdown。
"""

EMOTION_ANALYSIS_USER = """护士最新发言：
{#nurse_message#}

患者上一轮回复（仅供参考上下文，不得据此判断护士行为）：
{#patient_reply#}

请分析护士发言中是否存在上述情绪事件，并返回 JSON。"""


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
            raw = await self._llm.call(
                messages,
                purpose="emotion_analysis",
                ctx=CallContext(
                    purpose="emotion_analysis",
                    user_id=user_id or 0,
                    record_id=record_id or 0,
                    case_id=case_id or 0,
                ),
                temperature=0.3,
                max_tokens=256,
            )
            return _parse_analysis_result(raw)
        except Exception:
            log.warning("Emotion analysis LLM call failed", exc_info=True)
            return EmotionAnalysisResult(events=[])


def _parse_analysis_result(raw: str) -> EmotionAnalysisResult:
    """解析 LLM 输出的情绪分析 JSON。"""
    try:
        data = json.loads(raw.strip())
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

            confidence = float(item.get("confidence", 1.0))
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

    except (json.JSONDecodeError, ValueError, TypeError):
        log.warning("Failed to parse emotion analysis result: %s", raw[:200])
        return EmotionAnalysisResult(events=[])
