"""Tests for NoteSource（类型化片段）与 NoteCollector（只收集，不裁剪）。

装配（选择/排序/裁剪/预算/落位）的测试在 ``test_context_assembler.py``：本切片把
预算从 collector 移到 ``ContextAssembler``，因此这里只断言"产出了什么片段"。
"""

import pytest

from modules.training.context.fragment import ContextSlot
from modules.training.patient_ai.note_collector import NoteCollector
from modules.training.patient_ai.note_source import NoteSource


class FakeSource(NoteSource):
    def __init__(self, name: str, priority: int, text: str | None = None):
        self._name = name
        self.priority = priority
        self._text = text

    @property
    def name(self) -> str:
        return self._name

    async def collect(self, ctx) -> object:
        return self.fragment(self._text) if self._text else None


class FakeContext:
    pass


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
        assert "体温测量" in note.text
        assert "测得 38.5°C" in note.text
        # 片段携带声明来源与槽位：装配器据此判断"谁有权注入什么"
        assert note.source == "operation"
        assert note.slot == ContextSlot.PATIENT_STATE
        assert note.max_tokens == src.max_tokens

    @pytest.mark.asyncio
    async def test_skin_value_not_carried(self):
        from modules.training.patient_ai.note_source import OperationNoteSource

        src = OperationNoteSource()
        ctx = self._ctx([{"type": "skin", "label": "皮肤检查", "value": "右足底溃烂", "unit": ""}])
        note = await src.collect(ctx)
        assert "皮肤检查" in note.text
        assert "溃烂" not in note.text  # 皮肤是文字描述，不让患者复述自己看不到的体征

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
        assert "反复测量了3次" in note.text
        assert "测得 38.6°C" in note.text
        assert "测得 38.1°C" not in note.text


class TestNoteCollector:
    @pytest.mark.asyncio
    async def test_empty(self):
        collector = NoteCollector()
        assert await collector.collect(FakeContext()) == []

    @pytest.mark.asyncio
    async def test_returns_fragments_in_source_order(self):
        collector = NoteCollector()
        collector.add(FakeSource("exam", 30, "体温 38.5"))
        collector.add(FakeSource("emotion", 10, "患者焦虑"))
        fragments = await collector.collect(FakeContext())
        assert [f.source for f in fragments] == ["exam", "emotion"]
        assert [f.text for f in fragments] == ["体温 38.5", "患者焦虑"]

    @pytest.mark.asyncio
    async def test_none_fragments_are_dropped(self):
        collector = NoteCollector()
        collector.add(FakeSource("quiet", 0, None))
        collector.add(FakeSource("loud", 0, "有内容"))
        assert [f.source for f in await collector.collect(FakeContext())] == ["loud"]

    @pytest.mark.asyncio
    async def test_source_exception_survives(self):
        class BrokenSource(NoteSource):
            name = "broken"

            async def collect(self, ctx) -> object:
                raise RuntimeError("boom")

        collector = NoteCollector()
        collector.add(BrokenSource())
        collector.add(FakeSource("ok", 0, "fine"))
        assert [f.text for f in await collector.collect(FakeContext())] == ["fine"]
