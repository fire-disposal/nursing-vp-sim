"""Tests for NoteSource ABC and NoteCollector."""

import pytest

from infra.llm.token_counter import estimate_tokens
from modules.training.patient_ai.note_collector import (
    MAX_AUTHOR_NOTE_TOKENS,
    NoteCollector,
)
from modules.training.patient_ai.note_source import NoteSource


class FakeSource(NoteSource):
    def __init__(self, name: str, priority: int, text: str | None = None):
        self._name = name
        self.priority = priority
        self._text = text

    @property
    def name(self) -> str:
        return self._name

    async def collect(self, ctx) -> str | None:
        return self._text


class FakeContext:
    pass


class TestTokenEstimation:
    def test_english(self):
        assert estimate_tokens("hello world") == 3

    def test_chinese(self):
        assert estimate_tokens("\u60a3\u8005\u4f53\u6e2938.5") == 4

    def test_mixed(self):
        assert estimate_tokens("\u4f53\u6e29 38.5 \u00b0C") == 4


class TestOperationNoteSource:
    """查体注记携带测量值（feedback id=30：患者对自身发烧/剧痛要有言语反应）。"""

    @staticmethod
    def _ctx(exam_results):
        from types import SimpleNamespace

        record = SimpleNamespace(runtime_state={"exam_results": exam_results})
        return SimpleNamespace(record=record)

    @pytest.mark.asyncio
    async def test_note_carries_measured_value(self):
        from modules.training.patient_ai.note_source import OperationNoteSource

        src = OperationNoteSource()
        ctx = self._ctx([{"type": "temp", "label": "体温", "value": "38.5", "unit": "°C"}])
        note = await src.collect(ctx)
        assert "体温测量" in note
        assert "测得 38.5°C" in note

    @pytest.mark.asyncio
    async def test_skin_value_not_carried(self):
        from modules.training.patient_ai.note_source import OperationNoteSource

        src = OperationNoteSource()
        ctx = self._ctx([{"type": "skin", "label": "皮肤检查", "value": "右足底溃烂", "unit": ""}])
        note = await src.collect(ctx)
        assert "皮肤检查" in note
        assert "溃烂" not in note  # 皮肤是文字描述，不让患者复述自己看不到的体征

    @pytest.mark.asyncio
    async def test_repeated_measure_carries_latest_value(self):
        from modules.training.patient_ai.note_source import OperationNoteSource

        src = OperationNoteSource()
        ctx = self._ctx(
            [
                {"type": "temp", "label": "体温", "value": "38.1", "unit": "°C"},
                {"type": "temp", "label": "体温", "value": "38.5", "unit": "°C"},
                {"type": "temp", "label": "体温", "value": "38.6", "unit": "°C"},
            ]
        )
        note = await src.collect(ctx)
        assert "反复测量了3次" in note
        assert "测得 38.6°C" in note
        assert "测得 38.1°C" not in note

    @pytest.mark.asyncio
    async def test_empty(self):
        collector = NoteCollector()
        result = await collector.collect(FakeContext())
        assert result == ""

    @pytest.mark.asyncio
    async def test_single_note(self):
        collector = NoteCollector()
        collector.add(FakeSource("exam", 0, "\u4f53\u6e29 38.5"))
        result = await collector.collect(FakeContext())
        assert "\u4f53\u6e29" in result

    @pytest.mark.asyncio
    async def test_priority_order(self):
        collector = NoteCollector()
        collector.add(FakeSource("low", 10, "low"))
        collector.add(FakeSource("high", 0, "high"))
        result = await collector.collect(FakeContext())
        assert result.index("high") < result.index("low")

    @pytest.mark.asyncio
    async def test_budget_truncation(self):
        collector = NoteCollector()
        long_text = "\u60a3\u8005" * MAX_AUTHOR_NOTE_TOKENS
        collector.add(FakeSource("long", 0, long_text))
        result = await collector.collect(FakeContext())
        assert len(result) < len(long_text)
        assert "\u2026" in result

    @pytest.mark.asyncio
    async def test_source_exception_survives(self):
        class BrokenSource(NoteSource):
            @property
            def name(self):
                return "broken"

            async def collect(self, ctx) -> str | None:
                raise RuntimeError("boom")

        collector = NoteCollector()
        collector.add(BrokenSource())
        collector.add(FakeSource("ok", 0, "fine"))
        result = await collector.collect(FakeContext())
        assert "fine" in result
