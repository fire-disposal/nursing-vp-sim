"""Unit tests for the emotion analyzer — parsing LLM output into events."""

import pytest

from modules.training.patient_ai.emotion import EmotionAnalyzer
from modules.training.patient_ai.emotion.analyzer import _parse_analysis_result
from modules.training.patient_ai.emotion.events import EmotionEventType


class TestParseAnalysisResult:
    def test_parses_events(self):
        raw = '{"events": [{"type": "empathy", "confidence": 0.9, "evidence": "我理解", "target": null}]}'
        result = _parse_analysis_result(raw)
        assert len(result.events) == 1
        event = result.events[0]
        assert event.type == EmotionEventType.EMPATHY
        assert event.confidence == 0.9
        assert event.evidence == "我理解"

    def test_empty_events(self):
        result = _parse_analysis_result('{"events": []}')
        assert result.events == []

    def test_events_not_list_returns_empty(self):
        result = _parse_analysis_result('{"events": "oops"}')
        assert result.events == []

    def test_unknown_event_type_skipped(self):
        raw = '{"events": [{"type": "not_a_real_type", "confidence": 1.0, "evidence": "x"}]}'
        result = _parse_analysis_result(raw)
        assert result.events == []

    def test_confidence_clamped_to_range(self):
        raw = '{"events": [{"type": "empathy", "confidence": 2.5, "evidence": "a"}, {"type": "empathy", "confidence": -1, "evidence": "b"}]}'
        result = _parse_analysis_result(raw)
        assert result.events[0].confidence == 1.0
        assert result.events[1].confidence == 0.0

    def test_missing_confidence_defaults_to_1(self):
        raw = '{"events": [{"type": "reassurance", "evidence": "别担心"}]}'
        result = _parse_analysis_result(raw)
        assert result.events[0].confidence == 1.0

    def test_missing_fields_default(self):
        raw = '{"events": [{"type": "empathy"}]}'
        result = _parse_analysis_result(raw)
        assert result.events[0].evidence == ""
        assert result.events[0].target is None

    def test_non_dict_item_skipped(self):
        raw = '{"events": [42, {"type": "empathy", "confidence": 1, "evidence": "ok"}]}'
        result = _parse_analysis_result(raw)
        assert len(result.events) == 1

    def test_invalid_json_returns_empty(self):
        assert _parse_analysis_result("not json at all").events == []


class _FakeLLM:
    def __init__(self, raw: str):
        self._raw = raw
        self.calls: list[dict] = []

    async def call(self, messages, **kwargs):
        self.calls.append({"messages": messages, **kwargs})
        return self._raw


class TestEmotionAnalyzer:
    @pytest.mark.asyncio
    async def test_analyze_passes_rendered_messages(self):
        llm = _FakeLLM('{"events": [{"type": "empathy", "confidence": 1, "evidence": "e"}]}')
        analyzer = EmotionAnalyzer(llm)
        result = await analyzer.analyze("护士发言", "患者回复", user_id=3, record_id=5, case_id=9)
        assert len(result.events) == 1
        assert llm.calls[0]["purpose"] == "emotion_analysis"
        assert llm.calls[0]["temperature"] == 0.3
        messages = llm.calls[0]["messages"]
        assert messages[0]["role"] == "system"
        assert "护士发言" in messages[1]["content"]
        assert "患者回复" in messages[1]["content"]
        ctx = llm.calls[0]["ctx"]
        assert ctx.user_id == 3
        assert ctx.record_id == 5
        assert ctx.case_id == 9

    @pytest.mark.asyncio
    async def test_analyze_llm_error_returns_empty(self):
        class _Boom:
            async def call(self, *a, **kw):
                raise RuntimeError("provider down")

        analyzer = EmotionAnalyzer(_Boom())
        result = await analyzer.analyze("x", "y")
        assert result.events == []
