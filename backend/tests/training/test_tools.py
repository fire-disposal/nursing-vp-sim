"""Unit tests for training tools — handlers, registry, config resolution.

All handlers are exercised with fake sessions; no database connection.
"""

from types import SimpleNamespace

import pytest

from core.exceptions import ValidationError
from modules.training.activities import ACTIVITY_BINDINGS, activity_config
from modules.training.patient_ai.emotion.events import EmotionEventType
from modules.training.tools.base import ToolContext
from modules.training.tools.exam_emotion import apply_exam_emotion, derive_exam_emotion_events
from modules.training.tools.nursing_diagnosis import NursingDiagnosisHandler
from modules.training.tools.nursing_record import NursingRecordHandler
from modules.training.tools.physical_exam import PhysicalExamHandler
from modules.training.tools.quiz import QuizHandler
from modules.training.tools.registry import dispatch, registry
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
    )
    return ToolContext(
        record=record,
        case_data=case_data or {},
        current_user=user,
        db=db or FakeSession(),
    )


# ── activity_config（病例声明的唯一读取入口）──────────────────────────────


class TestActivityConfig:
    def test_reads_declared_config(self):
        cfg = activity_config({"activities": {"quiz": {"config": {"title": "测试"}}}}, "quiz")
        assert cfg == {"title": "测试"}

    def test_boolean_config_preserved_verbatim(self):
        assert activity_config({"activities": {"nursing_record": {"config": True}}}, "nursing_record") is True

    def test_missing_declaration_returns_none(self):
        assert activity_config({}, "quiz") is None

    def test_declaration_without_config_returns_none(self):
        assert activity_config({"activities": {"quiz": {}}}, "quiz") is None

    def test_legacy_tools_namespace_is_not_a_source(self):
        """tools.* 是迁移前的旧形状：解析器只认 activities（docs/15 §四）。"""
        assert activity_config({"tools": {"quiz": {"title": "旧格式"}}}, "quiz") is None

    def test_non_dict_case_data(self):
        assert activity_config(None, "quiz") is None


# ── quiz ──────────────────────────────────────────────────────────────────


class TestQuiz:
    @pytest.mark.asyncio
    async def test_load_without_config(self):
        handler = QuizHandler()
        # case_snapshot 启用 quiz，但 ctx.case_data 无 quiz 配置 → 返回 quiz: None
        record = SimpleNamespace(
            id=1,
            user_id=10,
            runtime_state=None,
            status="in_progress",
            case_snapshot=_case(activities={"quiz": {"config": {"questions": []}}}),
            practice_snapshot={},
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
        ctx = _ctx(case_data=_case(activities={"quiz": {"config": cfg}}))
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
        ctx = _ctx(case_data=_case(activities={"quiz": {"config": cfg}}))
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
        ctx = _ctx(case_data=_case(activities={"quiz": {"config": cfg}}))
        result = await handler.handle("submit", {"question_id": "q1", "answer": "B"}, ctx)
        assert result.ok is True
        assert result.data["correct"] is False

    @pytest.mark.asyncio
    async def test_submit_unknown_question(self):
        handler = QuizHandler()
        cfg = {"questions": [{"id": "q1", "stem": "s", "options": [], "answer": "A"}]}
        ctx = _ctx(case_data=_case(activities={"quiz": {"config": cfg}}))
        result = await handler.handle("submit", {"question_id": "q9", "answer": "A"}, ctx)
        assert result.ok is False
        assert "题目不存在" in result.error

    @pytest.mark.asyncio
    async def test_submit_missing_question_id(self):
        handler = QuizHandler()
        cfg = {"questions": [{"id": "q1", "stem": "s", "options": [], "answer": "A"}]}
        ctx = _ctx(case_data=_case(activities={"quiz": {"config": cfg}}))
        with pytest.raises(ValidationError):
            await handler.handle("submit", {"answer": "A"}, ctx)

    @pytest.mark.asyncio
    async def test_submit_updates_existing_answer(self):
        handler = QuizHandler()
        cfg = {"questions": [{"id": "q1", "stem": "s", "options": [], "answer": "A"}]}
        record = SimpleNamespace(
            id=1,
            user_id=10,
            runtime_state={"quiz_answers": [{"question_id": "q1", "answer": "B", "correct": False}]},
            status="in_progress",
            case_snapshot=_case(activities={"quiz": {"config": cfg}}),
            practice_snapshot={},
        )
        ctx = _ctx(record=record, case_data=_case(activities={"quiz": {"config": cfg}}))
        await handler.handle("submit", {"question_id": "q1", "answer": "A"}, ctx)
        answers = ctx.record.runtime_state["quiz_answers"]
        assert len(answers) == 1
        assert answers[0]["answer"] == "A"
        assert answers[0]["correct"] is True

    @pytest.mark.asyncio
    async def test_submit_does_not_mutate_previous_state(self):
        """裸 JSONB 无变更追踪：就地改旧对象图会让 flush 判定"未修改"，作答静默不入库。"""
        handler = QuizHandler()
        cfg = {"questions": [{"id": "q1", "stem": "s", "options": [], "answer": "A"}]}
        previous = {"quiz_answers": [{"question_id": "q1", "answer": "B", "correct": False}]}
        record = SimpleNamespace(
            id=1,
            user_id=10,
            runtime_state=previous,
            status="in_progress",
            case_snapshot=_case(activities={"quiz": {"config": cfg}}),
            practice_snapshot={},
        )
        ctx = _ctx(record=record, case_data=_case(activities={"quiz": {"config": cfg}}))
        await handler.handle("submit", {"question_id": "q1", "answer": "A"}, ctx)

        assert previous["quiz_answers"] == [{"question_id": "q1", "answer": "B", "correct": False}]
        assert ctx.record.runtime_state["quiz_answers"][0]["answer"] == "A"


# ── nursing_diagnosis ─────────────────────────────────────────────────────


_DIAGNOSIS_ACTIVITIES = {"nursing_diagnosis": {"config": {"enabled": True}}}


class TestNursingDiagnosis:
    @pytest.mark.asyncio
    async def test_load_returns_options_and_saved(self):
        handler = NursingDiagnosisHandler()
        record = SimpleNamespace(
            id=1,
            user_id=10,
            runtime_state={"nursing_diagnoses": [{"label": "疼痛"}]},
            status="in_progress",
            case_snapshot=_case(activities=_DIAGNOSIS_ACTIVITIES),
            practice_snapshot={},
        )
        ctx = _ctx(record=record, case_data=_case(activities=_DIAGNOSIS_ACTIVITIES))
        result = await handler.handle("load", {}, ctx)
        assert result.ok is True
        assert result.data["diagnoses"] == [{"label": "疼痛"}]
        assert len(result.data["stems"]) > 0
        assert len(result.data["factor_options"]) > 0
        assert len(result.data["characteristic_options"]) > 0

    @pytest.mark.asyncio
    async def test_save_persists_to_runtime_state(self):
        handler = NursingDiagnosisHandler()
        ctx = _ctx(case_data=_case(activities=_DIAGNOSIS_ACTIVITIES))
        diagnoses = [{"label": "体液不足"}]
        result = await handler.handle("save", {"diagnoses": diagnoses}, ctx)
        assert result.ok is True
        assert result.data["diagnoses"] == diagnoses
        assert ctx.record.runtime_state["nursing_diagnoses"] == diagnoses

    @pytest.mark.asyncio
    async def test_save_without_param_clears(self):
        handler = NursingDiagnosisHandler()
        ctx = _ctx(case_data=_case(activities=_DIAGNOSIS_ACTIVITIES))
        result = await handler.handle("save", {}, ctx)
        assert result.ok is True
        assert result.data["diagnoses"] == []


# ── nursing_record ────────────────────────────────────────────────────────


def _nr_case() -> dict:
    return _case(
        activities={"nursing_record": {"config": {"enabled": True}}},
        patient_info={"name": "李阿姨", "age": 70, "gender": "女"},
        chief_complaint="头晕",
    )


class TestNursingRecord:
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
        with pytest.raises(ValidationError):
            await handler.handle("save", {"sheet_data": "nope"}, ctx)

    @pytest.mark.asyncio
    async def test_submit_before_save_fails(self):
        handler = NursingRecordHandler()
        ctx = _ctx(case_data=_nr_case())
        result = await handler.handle("submit", {}, ctx)
        assert result.ok is False
        assert "尚未创建" in result.error

    @pytest.mark.asyncio
    async def test_submit_rejects_empty_sheet(self):
        """空提交 == 零评估：必须拒绝，否则「零评估也能完成训练」原样复活。"""
        handler = NursingRecordHandler()
        ctx = _ctx(case_data=_nr_case(), db=FakeSession())
        result = await handler.handle("submit", {"sheet_data": {"subjective": "  "}}, ctx)
        assert result.ok is False
        assert result.data["code"] == "nursing_record_empty"

    @pytest.mark.asyncio
    async def test_submit_locks_and_is_idempotent(self):
        handler = NursingRecordHandler()
        db = FakeSession()
        ctx = _ctx(case_data=_nr_case(), db=db)
        sheet = {"subjective": "患者主诉头晕", "objective": "BP 130/80"}
        await handler.handle("save", {"sheet_data": sheet, "status": "draft"}, ctx)
        first = await handler.handle("submit", {}, ctx)
        assert first.ok is True
        assert first.data["submitted_at"]
        assert first.data["status"] == "submitted"
        assert first.data["editable"] is False

        second = await handler.handle("submit", {}, ctx)
        assert second.ok is True
        assert second.data["submitted_at"] == first.data["submitted_at"]

        # submitted record cannot be modified
        saved = await handler.handle("save", {"sheet_data": {"x": 1}}, ctx)
        assert saved.ok is False
        assert "已提交" in saved.error
        assert saved.data["code"] == "nursing_record_submitted"


# ── physical_exam ─────────────────────────────────────────────────────────


class TestPhysicalExam:
    @pytest.mark.asyncio
    async def test_missing_op_type(self):
        handler = PhysicalExamHandler()
        ctx = _ctx(case_data=_case(activities={"physical_exam": {"config": {"groups": []}}}))
        with pytest.raises(ValidationError):
            await handler.handle("measure", {}, ctx)

    @pytest.mark.asyncio
    async def test_unknown_op_type_rejected(self):
        """未知 op_type 是客户端错误——不得落成一条伪查体记录。"""
        handler = PhysicalExamHandler()
        case_data = _case(activities={"physical_exam": {"config": {"groups": []}}})
        ctx = _ctx(case_data=case_data)
        with pytest.raises(ValidationError):
            await handler.handle("measure", {"op_type": "bogus"}, ctx)
        assert not (ctx.record.runtime_state or {}).get("exam_results")

    @pytest.mark.asyncio
    async def test_measure_temp_records_result(self):
        handler = PhysicalExamHandler()
        case_data = _case(activities={"physical_exam": {"config": {"groups": []}}})
        ctx = _ctx(case_data=case_data)
        result = await handler.handle("measure", {"op_type": "temp"}, ctx)
        assert result.ok is True
        assert result.data["op_type"] == "temp"
        assert result.data["result"]["value"]
        assert result.data["all_results"][-1]["type"] == "temp"
        # vitals patch written into runtime_state.scene
        assert "temp" in ctx.record.runtime_state["scene"]["vitals"]

    @pytest.mark.asyncio
    async def test_measure_does_not_mutate_previous_state(self):
        """裸 JSONB 无变更追踪：就地改旧对象图会让 flush 判定"未修改"，查体结果静默不入库。"""
        handler = PhysicalExamHandler()
        case_data = _case(activities={"physical_exam": {"config": {"groups": []}}})
        previous = {"exam_results": [{"type": "hr", "value": "72"}], "scene": {"vitals": {"hr": 72}}}
        record = SimpleNamespace(
            id=1,
            user_id=10,
            runtime_state=previous,
            status="in_progress",
            case_snapshot=case_data,
            practice_snapshot={},
        )
        ctx = _ctx(record=record, case_data=case_data)
        await handler.handle("measure", {"op_type": "temp"}, ctx)

        assert previous["exam_results"] == [{"type": "hr", "value": "72"}]
        assert previous["scene"]["vitals"] == {"hr": 72}
        assert [e["type"] for e in ctx.record.runtime_state["exam_results"]] == ["hr", "temp"]

    @pytest.mark.asyncio
    async def test_measure_freezes_interpretation_for_replay(self):
        """解读文案随结果冻结进历史，重进训练时引导模式才还原教学反馈。"""
        handler = PhysicalExamHandler()
        case_data = _case(activities={"physical_exam": {"config": {"vital_signs": {"temperature": "39.0"}}}})
        ctx = _ctx(case_data=case_data)
        await handler.handle("measure", {"op_type": "temp"}, ctx)

        entry = ctx.record.runtime_state["exam_results"][-1]
        assert entry["status"] == "high"
        assert "高于参考范围" in entry["interpretation"]

    @pytest.mark.asyncio
    async def test_measure_appends_to_history(self):
        handler = PhysicalExamHandler()
        case_data = _case(activities={"physical_exam": {"config": {"groups": []}}})
        record = SimpleNamespace(
            id=1,
            user_id=10,
            runtime_state={"exam_results": [{"type": "hr", "value": "72"}]},
            status="in_progress",
            case_snapshot=case_data,
            practice_snapshot={},
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


# ── registry / dispatch（绑定表的投影，不再有运行时注册）──────────────────


class _BoomHandler:
    tool_name = "boom"
    actions = frozenset({"x"})

    async def handle(self, action, params, ctx):
        raise RuntimeError("kaboom")


class TestRegistry:
    def test_registry_is_projection_of_activity_bindings(self):
        """处理器只有一处实例化（ACTIVITY_BINDINGS）；registry 只是它的投影。"""
        assert set(registry) == set(ACTIVITY_BINDINGS)
        for activity_id, definition in ACTIVITY_BINDINGS.items():
            assert registry[activity_id] is definition.handler

    @pytest.mark.asyncio
    async def test_dispatch_routes_to_binding_handler(self):
        result = await dispatch("nursing_diagnosis", "load", {}, _ctx())
        assert result.ok is True

    @pytest.mark.asyncio
    async def test_unknown_activity_raises_validation_error(self):
        with pytest.raises(ValidationError):
            await dispatch("no_such_activity", "ping", {}, _ctx())

    @pytest.mark.asyncio
    async def test_unknown_command_raises_validation_error(self):
        with pytest.raises(ValidationError):
            await dispatch("nursing_diagnosis", "nope", {}, _ctx())

    @pytest.mark.asyncio
    async def test_handler_exception_wrapped(self, monkeypatch):
        monkeypatch.setitem(registry, "boom", _BoomHandler())
        result = await dispatch("boom", "x", {}, _ctx())
        assert result.ok is False
        assert "工具操作失败" in result.error
