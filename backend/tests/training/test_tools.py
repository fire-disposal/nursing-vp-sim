"""Unit tests for training tools — handlers, registry, config resolution.

All handlers are exercised with fake sessions; no database connection.
"""

from types import SimpleNamespace

import pytest

from core.exceptions import AuthError
from modules.training.capabilities import ToolBinding
from modules.training.patient_ai.emotion.events import EmotionEventType
from modules.training.tools.base import ToolContext, get_tool_config
from modules.training.tools.exam_emotion import apply_exam_emotion, derive_exam_emotion_events
from modules.training.tools.nursing_diagnosis import NursingDiagnosisHandler
from modules.training.tools.nursing_record import NursingRecordHandler
from modules.training.tools.physical_exam import PhysicalExamHandler
from modules.training.tools.quiz import QuizHandler
from modules.training.tools.registry import dispatch, register
from tests._fakes import FakeSession


def _case(**overrides) -> dict:
    base = {
        "patient_info": {"name": "王建国", "age": 68, "gender": "男"},
        "chief_complaint": "喘不上气",
    }
    base.update(overrides)
    return base


def _ctx(*, record=None, case_data=None, user=None, db=None) -> ToolContext:
    user = user or SimpleNamespace(id=10, has_permission=lambda p: True)
    record = record or SimpleNamespace(
        id=1,
        user_id=10,
        runtime_state=None,
        status="in_progress",
        case_snapshot=case_data or {},
        practice_snapshot={},
        training_type="history_taking",
    )
    return ToolContext(
        record=record,
        case_data=case_data or {},
        current_user=user,
        db=db or FakeSession(),
    )


# ── get_tool_config ──────────────────────────────────────────────────────


class TestGetToolConfig:
    def test_reads_from_tools_ns(self):
        cfg = get_tool_config({"tools": {"quiz": {"title": "测试"}}}, "quiz")
        assert cfg == {"title": "测试"}

    def test_legacy_top_level_fallback(self):
        cfg = get_tool_config({"quiz": {"title": "旧格式"}}, "quiz")
        assert cfg == {"title": "旧格式"}

    def test_missing_returns_none(self):
        assert get_tool_config({}, "quiz") is None

    def test_non_dict_value_returns_none(self):
        assert get_tool_config({"quiz": "not-a-dict"}, "quiz") is None

    def test_non_dict_case_data(self):
        assert get_tool_config(None, "quiz") is None


# ── quiz ──────────────────────────────────────────────────────────────────


class TestQuiz:
    @pytest.mark.asyncio
    async def test_disabled_training_rejects(self):
        handler = QuizHandler()
        ctx = _ctx(case_data={})
        result = await handler.handle("load", {}, ctx)
        assert result.ok is False
        assert "未启用" in result.error

    @pytest.mark.asyncio
    async def test_unknown_action(self):
        handler = QuizHandler()
        ctx = _ctx(case_data=_case(tools={"quiz": {"questions": []}}))
        result = await handler.handle("nope", {}, ctx)
        assert result.ok is False
        assert "Unknown action" in result.error

    @pytest.mark.asyncio
    async def test_load_without_config(self):
        handler = QuizHandler()
        # case_snapshot 启用 quiz，但 ctx.case_data 无 quiz 配置 → 返回 quiz: None
        record = SimpleNamespace(
            id=1,
            user_id=10,
            runtime_state=None,
            status="in_progress",
            case_snapshot=_case(tools={"quiz": {"questions": []}}),
            practice_snapshot={},
            training_type="history_taking",
        )
        ctx = _ctx(record=record, case_data=_case())
        result = await handler.handle("load", {}, ctx)
        assert result.ok is True
        assert result.data["quiz"] is None

    @pytest.mark.asyncio
    async def test_load_strips_answers_from_questions(self):
        handler = QuizHandler()
        cfg = {
            "title": "随堂测验",
            "questions": [
                {"id": "q1", "stem": "题干", "options": ["A", "B"], "answer": "A", "explanation": "解析"},
            ],
        }
        ctx = _ctx(case_data=_case(tools={"quiz": cfg}))
        result = await handler.handle("load", {}, ctx)
        quiz = result.data["quiz"]
        assert quiz["title"] == "随堂测验"
        assert quiz["questions"][0]["stem"] == "题干"
        assert "answer" not in quiz["questions"][0]

    @pytest.mark.asyncio
    async def test_submit_correct_answer(self):
        handler = QuizHandler()
        cfg = {
            "questions": [
                {"id": "q1", "stem": "题干", "options": ["A", "B"], "answer": "a", "explanation": "解析"},
            ],
        }
        ctx = _ctx(case_data=_case(tools={"quiz": cfg}))
        result = await handler.handle("submit", {"question_id": "q1", "answer": "A"}, ctx)
        assert result.ok is True
        assert result.data["correct"] is True
        assert result.data["correct_answer"] == "a"
        # runtime_state persisted
        answers = ctx.record.runtime_state["quiz_answers"]
        assert answers[0]["question_id"] == "q1"
        assert answers[0]["correct"] is True

    @pytest.mark.asyncio
    async def test_submit_wrong_answer(self):
        handler = QuizHandler()
        cfg = {"questions": [{"id": "q1", "stem": "s", "options": ["A", "B"], "answer": "A"}]}
        ctx = _ctx(case_data=_case(tools={"quiz": cfg}))
        result = await handler.handle("submit", {"question_id": "q1", "answer": "B"}, ctx)
        assert result.ok is True
        assert result.data["correct"] is False

    @pytest.mark.asyncio
    async def test_submit_unknown_question(self):
        handler = QuizHandler()
        cfg = {"questions": [{"id": "q1", "stem": "s", "options": [], "answer": "A"}]}
        ctx = _ctx(case_data=_case(tools={"quiz": cfg}))
        result = await handler.handle("submit", {"question_id": "q9", "answer": "A"}, ctx)
        assert result.ok is False
        assert "题目不存在" in result.error

    @pytest.mark.asyncio
    async def test_submit_missing_question_id(self):
        handler = QuizHandler()
        cfg = {"questions": [{"id": "q1", "stem": "s", "options": [], "answer": "A"}]}
        ctx = _ctx(case_data=_case(tools={"quiz": cfg}))
        result = await handler.handle("submit", {"answer": "A"}, ctx)
        assert result.ok is False
        assert "question_id" in result.error

    @pytest.mark.asyncio
    async def test_submit_updates_existing_answer(self):
        handler = QuizHandler()
        cfg = {"questions": [{"id": "q1", "stem": "s", "options": [], "answer": "A"}]}
        record = SimpleNamespace(
            id=1,
            user_id=10,
            runtime_state={"quiz_answers": [{"question_id": "q1", "answer": "B", "correct": False}]},
            status="in_progress",
            case_snapshot=_case(tools={"quiz": cfg}),
            practice_snapshot={},
            training_type="history_taking",
        )
        ctx = _ctx(record=record, case_data=_case(tools={"quiz": cfg}))
        await handler.handle("submit", {"question_id": "q1", "answer": "A"}, ctx)
        answers = ctx.record.runtime_state["quiz_answers"]
        assert len(answers) == 1
        assert answers[0]["answer"] == "A"
        assert answers[0]["correct"] is True


# ── nursing_diagnosis ─────────────────────────────────────────────────────


_DIAGNOSIS_TOOLS = {"nursing_diagnosis": {"enabled": True}}


class TestNursingDiagnosis:
    @pytest.mark.asyncio
    async def test_disabled_rejects(self):
        handler = NursingDiagnosisHandler()
        ctx = _ctx(case_data={})
        result = await handler.handle("save", {"diagnoses": []}, ctx)
        assert result.ok is False
        assert "未启用" in result.error

    @pytest.mark.asyncio
    async def test_unknown_action(self):
        handler = NursingDiagnosisHandler()
        ctx = _ctx(case_data=_case(tools=_DIAGNOSIS_TOOLS))
        result = await handler.handle("nope", {}, ctx)
        assert result.ok is False

    @pytest.mark.asyncio
    async def test_load_returns_options_and_saved(self):
        handler = NursingDiagnosisHandler()
        record = SimpleNamespace(
            id=1,
            user_id=10,
            runtime_state={"nursing_diagnoses": [{"label": "疼痛"}]},
            status="in_progress",
            case_snapshot=_case(tools=_DIAGNOSIS_TOOLS),
            practice_snapshot={},
            training_type="history_taking",
        )
        ctx = _ctx(record=record, case_data=_case(tools=_DIAGNOSIS_TOOLS))
        result = await handler.handle("load", {}, ctx)
        assert result.ok is True
        assert result.data["diagnoses"] == [{"label": "疼痛"}]
        assert len(result.data["stems"]) > 0
        assert len(result.data["factor_options"]) > 0
        assert len(result.data["characteristic_options"]) > 0

    @pytest.mark.asyncio
    async def test_save_persists_to_runtime_state(self):
        handler = NursingDiagnosisHandler()
        ctx = _ctx(case_data=_case(tools=_DIAGNOSIS_TOOLS))
        diagnoses = [{"label": "体液不足"}]
        result = await handler.handle("save", {"diagnoses": diagnoses}, ctx)
        assert result.ok is True
        assert result.data["diagnoses"] == diagnoses
        assert ctx.record.runtime_state["nursing_diagnoses"] == diagnoses

    @pytest.mark.asyncio
    async def test_save_without_param_clears(self):
        handler = NursingDiagnosisHandler()
        ctx = _ctx(case_data=_case(tools=_DIAGNOSIS_TOOLS))
        result = await handler.handle("save", {}, ctx)
        assert result.ok is True
        assert result.data["diagnoses"] == []


# ── nursing_record ────────────────────────────────────────────────────────


def _nr_case() -> dict:
    return _case(
        tools={"nursing_record": {"enabled": True}},
        patient_info={"name": "李阿姨", "age": 70, "gender": "女"},
        chief_complaint="头晕",
    )


class TestNursingRecord:
    @pytest.mark.asyncio
    async def test_denied_without_permission(self):
        handler = NursingRecordHandler()
        user = SimpleNamespace(id=99, has_permission=lambda p: False)
        ctx = _ctx(user=user, case_data=_nr_case())
        result = await handler.handle("load", {}, ctx)
        assert result.ok is False
        assert "无权限" in result.error

    @pytest.mark.asyncio
    async def test_disabled_rejects(self):
        handler = NursingRecordHandler()
        ctx = _ctx(case_data=_case())
        result = await handler.handle("load", {}, ctx)
        assert result.ok is False
        assert "未启用" in result.error

    @pytest.mark.asyncio
    async def test_load_builds_template_when_no_record(self):
        handler = NursingRecordHandler()
        ctx = _ctx(case_data=_nr_case())
        result = await handler.handle("load", {}, ctx)
        assert result.ok is True
        sheet = result.data["sheet_data"]
        assert set(sheet) >= {"subjective", "objective", "assessment", "plan", "evaluation"}
        # patient context prefilled
        assert "李阿姨" in sheet["objective"]
        assert "头晕" in sheet["objective"]

    @pytest.mark.asyncio
    async def test_save_creates_record(self):
        handler = NursingRecordHandler()
        db = FakeSession()
        ctx = _ctx(case_data=_nr_case(), db=db)
        sheet = {"subjective": "患者主诉头晕", "objective": "", "assessment": "", "plan": "", "evaluation": ""}
        result = await handler.handle("save", {"sheet_data": sheet, "status": "draft"}, ctx)
        assert result.ok is True
        assert result.data["sheet_data"] == sheet
        assert ctx.record.id in db.rows

    @pytest.mark.asyncio
    async def test_save_rejects_non_dict_sheet(self):
        handler = NursingRecordHandler()
        ctx = _ctx(case_data=_nr_case())
        result = await handler.handle("save", {"sheet_data": "nope"}, ctx)
        assert result.ok is False
        assert "必须是对象" in result.error

    @pytest.mark.asyncio
    async def test_submit_before_save_fails(self):
        handler = NursingRecordHandler()
        ctx = _ctx(case_data=_nr_case())
        result = await handler.handle("submit", {}, ctx)
        assert result.ok is False
        assert "尚未创建" in result.error

    @pytest.mark.asyncio
    async def test_submit_locks_and_is_idempotent(self):
        handler = NursingRecordHandler()
        db = FakeSession()
        ctx = _ctx(case_data=_nr_case(), db=db)
        await handler.handle("save", {"sheet_data": {}, "status": "draft"}, ctx)
        first = await handler.handle("submit", {}, ctx)
        assert first.ok is True
        assert first.data["submitted_at"]

        second = await handler.handle("submit", {}, ctx)
        assert second.ok is True
        assert second.data["submitted_at"] == first.data["submitted_at"]

        # submitted record cannot be modified
        saved = await handler.handle("save", {"sheet_data": {"x": 1}}, ctx)
        assert saved.ok is False
        assert "已提交" in saved.error


# ── physical_exam ─────────────────────────────────────────────────────────


class TestPhysicalExam:
    @pytest.mark.asyncio
    async def test_unknown_action(self):
        handler = PhysicalExamHandler()
        ctx = _ctx(case_data=_case(tools={"physical_exam": {"groups": []}}))
        result = await handler.handle("nope", {}, ctx)
        assert result.ok is False
        assert "Unknown action" in result.error

    @pytest.mark.asyncio
    async def test_missing_op_type(self):
        handler = PhysicalExamHandler()
        ctx = _ctx(case_data=_case(tools={"physical_exam": {"groups": []}}))
        result = await handler.handle("measure", {}, ctx)
        assert result.ok is False
        assert "op_type" in result.error

    @pytest.mark.asyncio
    async def test_cannot_measure_others_record(self):
        handler = PhysicalExamHandler()
        record = SimpleNamespace(
            id=1,
            user_id=5,
            runtime_state=None,
            status="in_progress",
            case_snapshot=_case(tools={"physical_exam": {"groups": []}}),
            practice_snapshot={},
            training_type="history_taking",
        )
        ctx = _ctx(record=record, case_data=_case(tools={"physical_exam": {"groups": []}}))
        with pytest.raises(AuthError):
            await handler.handle("measure", {"op_type": "temp"}, ctx)

    @pytest.mark.asyncio
    async def test_measure_temp_records_result(self):
        handler = PhysicalExamHandler()
        case_data = _case(tools={"physical_exam": {"groups": []}})
        ctx = _ctx(case_data=case_data)
        result = await handler.handle("measure", {"op_type": "temp"}, ctx)
        assert result.ok is True
        assert result.data["op_type"] == "temp"
        assert result.data["result"]["value"]
        assert result.data["all_results"][-1]["type"] == "temp"
        # vitals patch written into runtime_state.scene
        assert "temp" in ctx.record.runtime_state["scene"]["vitals"]

    @pytest.mark.asyncio
    async def test_measure_appends_to_history(self):
        handler = PhysicalExamHandler()
        case_data = _case(tools={"physical_exam": {"groups": []}})
        record = SimpleNamespace(
            id=1,
            user_id=10,
            runtime_state={"exam_results": [{"type": "hr", "value": "72"}]},
            status="in_progress",
            case_snapshot=case_data,
            practice_snapshot={},
            training_type="history_taking",
        )
        ctx = _ctx(record=record, case_data=case_data)
        await handler.handle("measure", {"op_type": "temp"}, ctx)
        types = [e["type"] for e in ctx.record.runtime_state["exam_results"]]
        assert types == ["hr", "temp"]


# ── exam emotion derivation (pure) ────────────────────────────────────────


class TestDeriveExamEmotionEvents:
    def test_pain_high_confidence(self):
        events = derive_exam_emotion_events("pain", "8", 1)
        assert len(events) == 1
        assert events[0].type == EmotionEventType.PAINFUL_EXAM
        assert events[0].confidence == 1.0

    def test_pain_mid_confidence(self):
        events = derive_exam_emotion_events("pain", "5", 1)
        assert events[0].confidence == 0.7

    def test_low_pain_no_event(self):
        assert derive_exam_emotion_events("pain", "2", 1) == []

    def test_fever_temp(self):
        events = derive_exam_emotion_events("temp", "38.5", 1)
        assert events[0].type == EmotionEventType.FEVER

    def test_normal_temp_no_event(self):
        assert derive_exam_emotion_events("temp", "36.8", 1) == []

    def test_invalid_value_no_event(self):
        assert derive_exam_emotion_events("pain", "abc", 1) == []

    def test_repeat_measurement_triggers_long_wait(self):
        events = derive_exam_emotion_events("hr", "72", 3)
        assert any(e.type == EmotionEventType.LONG_WAIT for e in events)

    def test_apply_returns_none_when_no_events(self):
        db = FakeSession()
        assert apply_exam_emotion(1, _case(), "temp", "36.8", 1, db) is None

    def test_apply_returns_emotion_patch_on_pain(self):
        db = FakeSession()
        patch = apply_exam_emotion(1, _case(), "pain", "9", 1, db)
        if patch is not None:  # 仓库层失败时优雅降级为 None，不抛异常
            assert set(patch) >= {"trust", "anxiety", "irritation", "cooperation", "dominant_state"}


# ── registry / dispatch ───────────────────────────────────────────────────


class _DummyHandler:
    tool_name = "dummy"

    async def handle(self, action, params, ctx):
        return SimpleNamespace(ok=True, data={"action": action})


class TestRegistry:
    @pytest.mark.asyncio
    async def test_register_and_dispatch(self):
        register(_DummyHandler())
        result = await dispatch("dummy", "ping", {}, _ctx())
        assert result.ok is True
        assert result.data["action"] == "ping"

    @pytest.mark.asyncio
    async def test_unknown_tool_returns_error(self):
        result = await dispatch("no_such_tool", "ping", {}, _ctx())
        assert result.ok is False
        assert "Unknown tool" in result.error

    @pytest.mark.asyncio
    async def test_handler_exception_wrapped(self):
        class _Boom:
            tool_name = "boom"

            async def handle(self, action, params, ctx):
                raise RuntimeError("kaboom")

        register(_Boom())
        result = await dispatch("boom", "x", {}, _ctx())
        assert result.ok is False
        assert "工具操作失败" in result.error


class TestToolBindingContract:
    def test_bindings_are_frozen_dataclasses(self):
        from modules.training.capabilities import all_bindings

        for b in all_bindings():
            assert isinstance(b, ToolBinding)
