"""Tests for NoteSource ABC and NoteCollector."""

import pytest

from contexts.patient.note_collector import (
    MAX_AUTHOR_NOTE_TOKENS,
    NoteCollector,
    _estimate_tokens,
)
from contexts.patient.note_source import NoteSource


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
        assert _estimate_tokens("hello world") == 5

    def test_chinese(self):
        assert _estimate_tokens("\u60a3\u8005\u4f53\u6e2938.5") == 10

    def test_mixed(self):
        assert _estimate_tokens("\u4f53\u6e29 38.5 \u00b0C") == 8


class TestNoteCollector:
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
