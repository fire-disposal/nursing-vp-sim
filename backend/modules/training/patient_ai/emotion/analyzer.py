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

EMOTION_ANALYSIS_SYSTEM = """你是护理沟通事件分析器。你的任务是分析护士最新发言中的沟通行为，识别对患者情绪产生影响的事件。

## 核心原则

1. 只分析护士的行为——护士说了什么、做了什么。
2. 患者回复的语气、态度、配合度是之前状态的结果，不得据此推断护士的沟通质量。
3. 一次发言可能包含多个事件，也可能一个都没有。没有就返回空数组。
4. 基于文本证据判断，不要猜测隐藏意图。

## 输出格式

严格输出一行 JSON，不含 markdown、不含注释：

{"events": [{"type": "<event_type>", "confidence": <0.0-1.0>, "evidence": "<护士原话片段>", "target": null}]}

## 事件类型定义

### 正面事件（护士展现了良好的沟通技巧）

| type | 含义 | 触发条件 | 示例 |
|------|------|---------|------|
| empathy | 共情回应 | 护士明确表达了理解患者的感受或处境 | "我理解你现在很担心"、"听起来这段时间很不容易" |
| active_listening | 积极倾听 | 护士复述、总结或确认了患者刚说的内容 | "所以你刚才说疼痛是从上周开始的，对吗" |
| clear_explanation | 清晰解释 | 护士用通俗语言解释了病情、检查目的或治疗方案 | "这个检查是看心脏的电活动，就像给心脏拍个心电图" |
| respectful_communication | 尊重沟通 | 护士使用了恰当称呼，或明确表示尊重患者的选择/意愿 | "张阿姨，您觉得这样可以吗"、"我们尊重您的想法" |
| reassurance | 安抚 | 护士给予了情感支持或减轻了患者的担忧 | "不用太紧张，这个检查很快的"、"我们会一直在这里陪着您" |
| explains_procedure | 解释操作 | 护士在操作前说明了步骤、目的和可能的感受 | "我现在要量一下血压，袖带充气的时候会有点紧" |
| respects_refusal | 尊重拒绝 | 患者拒绝检查或回答问题，护士表示尊重且未施压 | "没关系，如果您不想做这个检查我们可以先放一放" |
| request_cooperation | 礼貌请求配合 | 护士用商量的语气请求患者配合，而非命令 | "方便的话，我想请您配合做一次体温测量" |

### 负面事件（护士沟通存在明显失误）

| type | 含义 | 触发条件 | 示例 |
|------|------|---------|------|
| interruption | 打断患者 | 护士在患者话没说完时插入新话题或转向其他问题 | 患者正描述病情，护士突然问"你吃饭了吗" |
| repeated_question | 重复询问 | 护士又问了患者刚刚已经回答过的问题 | 患者刚说体温 38 度，护士又问"你发烧吗" |
| judgmental_language | 评判性语言 | 护士使用了指责、批评、贴标签的语气 | "你怎么不早点来看"、"你这生活习惯太差了" |
| privacy_intrusion | 隐私冒犯 | 护士未经铺垫就直接追问敏感隐私，或询问与病情无关的隐私 | 无上下文突然问"你有过几个性伴侣" |
| dismissal | 忽视主诉 | 护士对患者明确表达的痛苦或担忧置之不理或轻描淡写 | 患者说疼得厉害，护士说"没事，忍忍就好了" |

### 情境事件（外部临床事实，非护士行为导致）

这些事件不是护士的"错"，但它们确实影响患者的情绪状态：

| type | 含义 | 触发条件 |
|------|------|---------|
| painful_exam | 疼痛操作 | 护士在对话中明确进行了可能引起疼痛的检查（如抽血、注射、按压痛处） |
| bad_news | 告知坏消息 | 护士告知了异常的检查结果或不乐观的诊断 |
| long_wait | 长时间等待 | 对话或操作前有明显等待，或护士在系统中看到排队信息 |
| fatigue | 对话疲劳 | 对话已进行多轮（通常 > 8 轮），患者可能因长时间交流而疲惫 |

### 对临床操作的补充说明

测量生命体征（体温、血压、心率、血氧、呼吸频率）本身不触发 painful_exam。
但如果：
- 同一项测量被反复进行（同一项目 ≥ 3 次）→ 可能触发 fatigue
- 测量时护士未做任何解释 → 不触发 explains_procedure
- 测量后护士告知了异常数值并解释了含义 → 触发 clear_explanation

## confidence 评分指南

- 0.9~1.0：护士发言中有明确的、可直接引用的对应语句
- 0.7~0.9：行为模式明显，但措辞含蓄
- 0.5~0.7：有迹象但不够确定
- 低于 0.5：不要报告

## 边界规则

1. 患者说"我疼"、"我不舒服"——这是病情陈述，不触发挥判性语言或忽视事件。
   护士的回应才需要分析。如果护士回应"我理解，让我看看"，这是 empathy + request_cooperation。
   如果护士回应"没事的"，这可能是 dismissal。

2. 护士问了很多问题（如病史采集）——正常问诊流程，不触发 repeated_question 或 privacy_intrusion。
   只有在同一问题被明确重复、或隐私问题缺少铺垫时才触发。

3. 患者语气恶劣、不耐烦——不得因此产生对护士的负面事件。患者态度只反映旧状态。

4. fatigue 和 long_wait 通常由系统在对话后期注入，LLM 只在有明显线索时报告。

5. 一次发言中同一类型事件只报告一次，取最高 confidence。
"""

EMOTION_ANALYSIS_USER = """护士最新发言：
{#nurse_message#}

患者上一轮回复（仅供参考上下文，不得据此判断护士行为）：
{#patient_reply#}

请分析护士发言中的沟通事件，返回 JSON。"""


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
