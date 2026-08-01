"""Unit tests for NoteSource implementations."""

from modules.training.patient_ai.note_source import OperationNoteSource
from modules.training.patient_ai.notes import EmotionNoteSource, IdentityGuardSource


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
    async def test_returns_cached_note_from_state(self):
        src = EmotionNoteSource()
        note = "【患者当前互动策略】\n- 语气：平稳、正常交流"
        ctx = FakeContext(state={"_emotion_note": note})
        result = await src.collect(ctx)
        assert result == note

    async def test_returns_none_when_no_cached_note(self):
        src = EmotionNoteSource()
        ctx = FakeContext(state={})
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
        # 反馈 id=30 修复：测量值随注记告知患者，患者对自身发烧/剧痛才有言语反应
        assert "测得 36.5℃" in result
        assert "测得 120/80mmHg" in result

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
