"""四维情绪系统 — 事件规则表。

将 LLM 检测到的情绪事件类型映射为基础 delta 值。
这些默认值可通过配置覆盖。
所有值针对 [0,1] 范围的浮点状态设计。
"""

from __future__ import annotations

from .events import EmotionEventType
from .models import EmotionDelta

EVENT_RULES: dict[EmotionEventType, EmotionDelta] = {
    # ── 正面事件：护士建设性沟通 ──
    EmotionEventType.EMPATHY: EmotionDelta(
        trust=0.04,
        anxiety=-0.05,
        irritation=-0.02,
        cooperation=0.03,
    ),
    EmotionEventType.ACTIVE_LISTENING: EmotionDelta(
        trust=0.03,
        anxiety=-0.02,
        irritation=-0.03,
        cooperation=0.03,
    ),
    EmotionEventType.CLEAR_EXPLANATION: EmotionDelta(
        trust=0.03,
        anxiety=-0.04,
        cooperation=0.03,
    ),
    EmotionEventType.RESPECTFUL_COMMUNICATION: EmotionDelta(
        trust=0.02,
        irritation=-0.02,
    ),
    EmotionEventType.REASSURANCE: EmotionDelta(
        anxiety=-0.03,
    ),
    EmotionEventType.EXPLAINS_PROCEDURE: EmotionDelta(
        trust=0.02,
        anxiety=-0.04,
        cooperation=0.04,
    ),
    EmotionEventType.RESPECTS_REFUSAL: EmotionDelta(
        trust=0.04,
        irritation=-0.03,
    ),

    # ── 负面事件：护士沟通失误 ──
    EmotionEventType.INTERRUPTION: EmotionDelta(
        trust=-0.03,
        irritation=0.05,
        cooperation=-0.03,
    ),
    EmotionEventType.REPEATED_QUESTION: EmotionDelta(
        trust=-0.02,
        irritation=0.05,
        cooperation=-0.03,
    ),
    EmotionEventType.JUDGMENTAL_LANGUAGE: EmotionDelta(
        trust=-0.08,
        anxiety=0.03,
        irritation=0.08,
        cooperation=-0.08,
    ),
    EmotionEventType.PRIVACY_INTRUSION: EmotionDelta(
        trust=-0.07,
        anxiety=0.04,
        irritation=0.06,
        cooperation=-0.06,
    ),
    EmotionEventType.DISMISSAL: EmotionDelta(
        trust=-0.07,
        irritation=0.07,
        cooperation=-0.06,
    ),

    # ── 情境事件：外部临床事件 ──
    EmotionEventType.REQUEST_COOPERATION: EmotionDelta(
        cooperation=0.02,
    ),
    EmotionEventType.PAINFUL_EXAM: EmotionDelta(
        anxiety=0.04,
        irritation=0.03,
        cooperation=-0.03,
    ),
    EmotionEventType.BAD_NEWS: EmotionDelta(
        anxiety=0.10,
        cooperation=-0.03,
    ),
    EmotionEventType.LONG_WAIT: EmotionDelta(
        irritation=0.06,
        cooperation=-0.04,
    ),
    EmotionEventType.FATIGUE: EmotionDelta(
        irritation=0.02,
        cooperation=-0.06,
    ),
    # 查体桥接事件：体温 ≥38°C，患者自觉不适（feedback id=30）
    EmotionEventType.FEVER: EmotionDelta(
        anxiety=0.04,
        cooperation=-0.02,
    ),
}
