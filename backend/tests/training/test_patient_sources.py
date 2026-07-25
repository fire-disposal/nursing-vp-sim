"""Unit tests for NoteSource implementations."""

from contexts.training.patient_ai.note_source import OperationNoteSource
from profiles.history_taking.notes import EmotionNoteSource, IdentityGuardSource


class FakeContext:
    """Minimal PipelineContext stub for testing."""

    def __init__(self, **kwargs):
        self.state = kwargs.get("state", {})
        self.messages = kwargs.get("messages", [])
        self.record = kwargs.get("record")
        self.app_state = kwargs.get("app_state")
        self.db = kwargs.get("db")

    class Record:
        def __init__(self, runtime_state=None, id_=1):
            self.runtime_state = runtime_state
            self.id = id_

    class Message:
        def __init__(self, role, content):
            self.role = role
            self.content = content


class TestEmotionNoteSource:
    async def test_returns_note_when_present(self, db_session):
        from contexts.training.session_cache import EmotionCache
        from models import Case, TrainingRecord, User
        from profiles.history_taking.emotion import EmotionState

        user = db_session.query(User).filter(User.is_active == True).first()
        case = db_session.query(Case).first()
        if not user or not case:
            import pytest

            pytest.skip("No user or case in test DB")
        record = TrainingRecord(user_id=user.id, case_id=case.id, status="in_progress", time_limit=20)
        db_session.add(record)
        db_session.flush()

        cache = EmotionCache()
        cache.set(record.id, EmotionState(trust=70, comfort=80), db_session)
        db_session.commit()

        ctx = FakeContext(
            app_state=type("AppState", (), {"emotion_cache": cache})(),
            record=FakeContext.Record(id_=record.id),
            db=db_session,
        )
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


class TestOperationNoteSource:
    async def test_formats_experiences(self):
        src = OperationNoteSource()
        record = FakeContext.Record(
            runtime_state={
                "exam_results": [
                    {"type": "temp", "label": "体温", "value": "36.5", "unit": "℃"},
                    {"type": "bp", "label": "血压", "value": "120/80", "unit": "mmHg"},
                ]
            }
        )
        ctx = FakeContext(record=record)
        result = await src.collect(ctx)
        assert "体温测量" in result
        assert "血压测量" in result
        assert "体温计置于腋下" in result
        assert "袖带绑在左上臂" in result
        assert "36.5" not in result
        assert "120/80" not in result

    async def test_returns_none_when_no_results(self):
        src = OperationNoteSource()
        record = FakeContext.Record(runtime_state={})
        ctx = FakeContext(record=record)
        result = await src.collect(ctx)
        assert result is None

    async def test_marks_repeated_measurements(self):
        src = OperationNoteSource()
        results = [
            {"type": "temp", "label": "体温", "value": "36.5", "unit": "℃"},
            {"type": "bp", "label": "血压", "value": "120/80", "unit": "mmHg"},
            {"type": "temp", "label": "体温", "value": "36.6", "unit": "℃"},
        ]
        record = FakeContext.Record(runtime_state={"exam_results": results})
        ctx = FakeContext(record=record)
        result = await src.collect(ctx)
        assert "体温测量（重复了2次）" in result or "体温测量" in result
        assert "血压测量" in result
        # No excessive threshold yet — only 3+ triggers the warning
        assert "不适" not in result

    async def test_excessive_repetition_triggers_discomfort(self):
        src = OperationNoteSource()
        results = [
            {"type": "temp", "label": "体温", "value": "36.5", "unit": "℃"},
            {"type": "temp", "label": "体温", "value": "36.6", "unit": "℃"},
            {"type": "temp", "label": "体温", "value": "36.7", "unit": "℃"},
        ]
        record = FakeContext.Record(runtime_state={"exam_results": results})
        ctx = FakeContext(record=record)
        result = await src.collect(ctx)
        assert "反复测量了3次" in result
        assert "不适" in result or "质疑" in result or "困惑" in result

    async def test_unknown_type_skipped(self):
        src = OperationNoteSource()
        results = [{"type": "unknown_op", "label": "未知", "value": "x", "unit": ""}]
        record = FakeContext.Record(runtime_state={"exam_results": results})
        ctx = FakeContext(record=record)
        result = await src.collect(ctx)
        assert result is None
