"""Unit tests for the emotion analyzer — JSON → events mapping + LLM call contract."""

import logging

import pytest

from core.exceptions import LLMParseError
from infra.llm.profile import get_llm_config
from modules.training.patient_ai.emotion import EmotionAnalyzer
from modules.training.patient_ai.emotion.analyzer import _build_result
from modules.training.patient_ai.emotion.events import EmotionEventType


def test_prompts_live_in_single_source_module():
    """提示词只存在于 prompts/emotion.py，运行时与启动校验引用同一对象。

    回归守卫：真实提示词曾经内联在 analyzer.py，而启动校验校的是另一个（已死的）文件，
    导致占位符写错没有任何告警。
    """
    import modules.training.patient_ai.emotion.analyzer as analyzer_module
    from modules.training.prompts import emotion as prompt_module

    assert analyzer_module.EMOTION_ANALYSIS_SYSTEM is prompt_module.EMOTION_ANALYSIS_SYSTEM
    assert analyzer_module.EMOTION_ANALYSIS_USER is prompt_module.EMOTION_ANALYSIS_USER


class TestBuildResult:
    def test_parses_events(self):
        data = {"events": [{"type": "empathy", "confidence": 0.9, "evidence": "我理解", "target": None}]}
        result = _build_result(data)
        assert len(result.events) == 1
        event = result.events[0]
        assert event.type == EmotionEventType.EMPATHY
        assert event.confidence == 0.9
        assert event.evidence == "我理解"

    def test_empty_events(self):
        assert _build_result({"events": []}).events == []

    def test_events_not_list_returns_empty(self):
        assert _build_result({"events": "oops"}).events == []

    def test_missing_events_key_returns_empty(self):
        assert _build_result({}).events == []

    def test_unknown_event_type_skipped(self):
        data = {"events": [{"type": "not_a_real_type", "confidence": 1.0, "evidence": "x"}]}
        assert _build_result(data).events == []

    def test_confidence_clamped_to_range(self):
        data = {
            "events": [
                {"type": "empathy", "confidence": 2.5, "evidence": "a"},
                {"type": "empathy", "confidence": -1, "evidence": "b"},
            ]
        }
        result = _build_result(data)
        assert result.events[0].confidence == 1.0
        assert result.events[1].confidence == 0.0

    def test_missing_confidence_defaults_to_1(self):
        assert _build_result({"events": [{"type": "reassurance", "evidence": "别担心"}]}).events[0].confidence == 1.0

    def test_missing_fields_default(self):
        event = _build_result({"events": [{"type": "empathy"}]}).events[0]
        assert event.evidence == ""
        assert event.target is None

    def test_non_dict_item_skipped(self):
        data = {"events": [42, {"type": "empathy", "confidence": 1, "evidence": "ok"}]}
        assert len(_build_result(data).events) == 1


class _FakeLLM:
    def __init__(self, payload: dict | Exception):
        self._payload = payload
        self.calls: list[dict] = []

    async def call_json(self, messages, **kwargs):
        self.calls.append({"messages": messages, **kwargs})
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class TestEmotionAnalyzer:
    @pytest.mark.asyncio
    async def test_analyze_passes_rendered_messages(self):
        llm = _FakeLLM({"events": [{"type": "empathy", "confidence": 1, "evidence": "e"}]})
        result = await EmotionAnalyzer(llm).analyze("护士发言", "患者回复", user_id=3, record_id=5, case_id=9)
        assert len(result.events) == 1
        call = llm.calls[0]
        assert call["purpose"] == "emotion_analysis"
        assert call["temperature"] == get_llm_config("emotion_analysis")["temperature"]
        assert call["messages"][0]["role"] == "system"
        assert "护士发言" in call["messages"][1]["content"]
        assert "患者回复" in call["messages"][1]["content"]
        ctx = call["ctx"]
        assert ctx.user_id == 3
        assert ctx.record_id == 5
        assert ctx.case_id == 9

    @pytest.mark.asyncio
    async def test_analyze_llm_error_returns_empty(self):
        analyzer = EmotionAnalyzer(_FakeLLM(RuntimeError("provider down")))
        assert (await analyzer.analyze("我理解您的担心", "y")).events == []

    @pytest.mark.asyncio
    async def test_unparsable_json_is_logged_not_silent(self, caplog):
        """解析失败不得静默降级：必须留下日志，否则情绪行为异常无从排查。"""
        analyzer = EmotionAnalyzer(_FakeLLM(LLMParseError("purpose=emotion_analysis: 无法解析LLM返回的JSON: {oops")))
        with caplog.at_level(logging.WARNING):
            result = await analyzer.analyze("我理解您的担心", "y", record_id=11)
        assert result.events == []
        assert any("unparsable JSON" in record.message for record in caplog.records)
        assert any(record.exc_info for record in caplog.records if "unparsable JSON" in record.message)
