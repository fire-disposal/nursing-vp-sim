"""确定性敌意预闸：词表命中必须不依赖模型就能产出 INSULT。"""

import logging

import pytest

from infra.llm.profile import get_llm_config
from modules.training.patient_ai.emotion import EmotionAnalyzer
from modules.training.patient_ai.emotion.events import EmotionEventType
from modules.training.patient_ai.emotion.hostility import detect_hostile_event, find_hostile_text


@pytest.mark.parametrize(
    "text",
    [
        "我日你妈",
        "操你妈，你到底会不会看病",
        "去死吧",
        "你怎么不去死",
        "你就是个废物",
        "你个白痴",
        "傻逼",
        "老不死的",
        "你算什么东西",
        "滚出去",
        "cnm",
        "you are an idiot",
    ],
)
def test_hostile_language_is_detected(text):
    assert find_hostile_text(text), f"应命中敌意词表: {text}"
    event = detect_hostile_event(text)
    assert event is not None
    assert event.type is EmotionEventType.INSULT
    assert event.confidence == 1.0


@pytest.mark.parametrize(
    "text",
    [
        "您妈妈最近身体怎么样？",
        "您之前有神经病史吗？",
        "爷爷平时有没有咳嗽、咳痰？",
        "这个检查不疼，我会陪着您做完",
        "您有没有药物或食物过敏史？",
        "我们先量个血压，袖带充气时会有点紧",
    ],
)
def test_clinical_text_is_not_flagged(text):
    """问诊措辞不得被词表误判（否则会平白升级到患者走人）。"""
    assert find_hostile_text(text) == []
    assert detect_hostile_event(text) is None


class _SpyLLM:
    def __init__(self):
        self.called = 0

    async def call_json(self, *args, **kwargs):
        self.called += 1
        return {"events": []}


class _RecordingLLM:
    def __init__(self):
        self.calls: list[dict] = []

    async def call_json(self, messages, **kwargs):
        self.calls.append({"messages": messages, **kwargs})
        return {"events": [{"type": "empathy", "confidence": 0.9, "evidence": "我理解"}]}


@pytest.mark.asyncio
async def test_gate_hit_returns_insult_without_calling_llm():
    """边界输入不依赖模型自由心证：命中即产 INSULT，且不再发起 LLM 调用。"""
    llm = _SpyLLM()
    result = await EmotionAnalyzer(llm).analyze("我日你妈", "……", record_id=3)

    assert llm.called == 0
    assert len(result.events) == 1
    assert result.events[0].type is EmotionEventType.INSULT
    assert result.events[0].confidence == 1.0
    assert result.events[0].evidence


@pytest.mark.asyncio
async def test_gate_hit_is_logged(caplog):
    with caplog.at_level(logging.WARNING):
        await EmotionAnalyzer(_SpyLLM()).analyze("去死吧", "", record_id=9)
    assert any("Hostile language detected" in record.message for record in caplog.records)
    assert any("record_id=9" in record.message for record in caplog.records)


@pytest.mark.asyncio
async def test_non_hostile_input_uses_profile_config():
    """渐变语气仍走 LLM，且调用参数完全来自 profile（原先 analyzer 硬编码覆盖了它）。"""
    llm = _RecordingLLM()
    result = await EmotionAnalyzer(llm).analyze("我理解您现在很担心", "患者回复", user_id=3, record_id=5, case_id=9)

    assert len(llm.calls) == 1
    call = llm.calls[0]
    assert call["purpose"] == "emotion_analysis"
    for key, value in get_llm_config("emotion_analysis").items():
        assert call[key] == value, f"{key} 应来自 profile"
    assert call["response_format"] == {"type": "json_object"}
    assert call["ctx"].record_id == 5
    assert result.events[0].type is EmotionEventType.EMPATHY
