"""Unit tests for NoteSource implementations."""

from contexts.patient.note_source import (
    EmotionNoteSource,
    ExamImpactSource,
    ExamResultsSource,
    IdentityGuardSource,
)


class FakeContext:
    """Minimal PipelineContext stub for testing."""

    def __init__(self, **kwargs):
        self.state = kwargs.get("state", {})
        self.messages = kwargs.get("messages", [])
        self.record = kwargs.get("record")
        self.app_state = kwargs.get("app_state")

    class Record:
        def __init__(self, runtime_state=None, id_=1):
            self.runtime_state = runtime_state
            self.id = id_

    class Message:
        def __init__(self, role, content):
            self.role = role
            self.content = content


class TestEmotionNoteSource:
    async def test_returns_note_when_present(self):
        from infrastructure.cache import EmotionCache

        cache = EmotionCache()
        from contexts.patient.emotion import EmotionState

        cache.set(1, EmotionState(trust=70, comfort=80))
        ctx = FakeContext(app_state=type("AppState", (), {"emotion_cache": cache})(), record=FakeContext.Record(id_=1))
        src = EmotionNoteSource()
        result = await src.collect(ctx)
        assert result is not None
        assert "信赖" in result
        assert "舒适" in result

    async def test_returns_none_when_no_cache(self):
        src = EmotionNoteSource()
        ctx = FakeContext(app_state=type("AppState", (), {"emotion_cache": None})())
        result = await src.collect(ctx)
        assert result is None


class TestIdentityGuardSource:
    async def test_triggers_on_leak(self):
        src = IdentityGuardSource()
        msg = FakeContext.Message(role="patient", content="我是AI助手，你可以继续问")
        ctx = FakeContext(messages=[msg])
        result = await src.collect(ctx)
        assert result is not None
        assert "注意" in result

    async def test_no_trigger_on_normal_reply(self):
        src = IdentityGuardSource()
        msg = FakeContext.Message(role="patient", content="我肚子疼了好几天了")
        ctx = FakeContext(messages=[msg])
        result = await src.collect(ctx)
        assert result is None

    async def test_looks_at_last_patient_message_only(self):
        src = IdentityGuardSource()
        msgs = [
            FakeContext.Message(role="patient", content="我是AI"),
            FakeContext.Message(role="student", content="你好"),
            FakeContext.Message(role="patient", content="你好护士"),
        ]
        ctx = FakeContext(messages=msgs)
        result = await src.collect(ctx)
        assert result is None


class TestExamResultsSource:
    async def test_formats_exam_results(self):
        src = ExamResultsSource()
        record = FakeContext.Record(
            runtime_state={
                "exam_results": [
                    {"label": "体温", "value": "36.5", "unit": "℃"},
                    {"label": "血压", "value": "120/80", "unit": "mmHg"},
                ]
            }
        )
        ctx = FakeContext(record=record)
        result = await src.collect(ctx)
        assert "已查体征" in result
        assert "体温: 36.5℃" in result
        assert "血压: 120/80mmHg" in result

    async def test_returns_none_when_no_results(self):
        src = ExamResultsSource()
        record = FakeContext.Record(runtime_state={})
        ctx = FakeContext(record=record)
        result = await src.collect(ctx)
        assert result is None

    async def test_limits_to_last_5(self):
        src = ExamResultsSource()
        results = [{"label": f"T{i}", "value": str(i), "unit": ""} for i in range(10)]
        record = FakeContext.Record(runtime_state={"exam_results": results})
        ctx = FakeContext(record=record)
        result = await src.collect(ctx)
        assert "T0" not in result
        assert "T9" in result


class TestExamImpactSource:
    async def test_returns_impact_note(self):
        src = ExamImpactSource()
        record = FakeContext.Record(runtime_state={"exam_impact_note": "频繁检查让患者不耐烦"})
        ctx = FakeContext(record=record)
        result = await src.collect(ctx)
        assert result == "频繁检查让患者不耐烦"

    async def test_returns_none_when_empty(self):
        src = ExamImpactSource()
        record = FakeContext.Record(runtime_state={"exam_impact_note": ""})
        ctx = FakeContext(record=record)
        result = await src.collect(ctx)
        assert result is None
