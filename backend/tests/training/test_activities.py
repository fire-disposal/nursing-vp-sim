"""Activity 协约测试：唯一登记表、病例声明解析、可用性与内置特性开关。

取代旧 capabilities 的「病例字段即能力」：能力由病例显式声明
``activities.<id>.config``，可用性只在服务端解析（docs/15 §三/§四）。
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import BaseModel

from modules.training.activities import (
    ACTIVITY_BINDINGS,
    ACTIVITY_CONFIG_KEY,
    ACTIVITY_IDS,
    REASON_DISABLED,
    REASON_NOT_CONFIGURED,
    REASON_SESSION_ENDED,
    REASON_WORKFLOW_DENIED,
    STATE_AVAILABLE,
    STATE_UNAVAILABLE,
    activity_availability,
    activity_config,
    declared_activity_ids,
    is_activity_enabled,
    resolve_activities,
    resolve_activity_flags,
)
from modules.training.features import (
    BUILTIN_FEATURES,
    is_feature_enabled,
    resolve_builtin_features,
)
from modules.training.profile import HISTORY_TAKING
from modules.training.tools.base import ToolContext
from modules.training.tools.registry import dispatch
from tests._fakes import FakeSession

CASES_DIR = Path(__file__).resolve().parents[2] / "data" / "cases"


def _declare(**configs) -> dict:
    """病例声明形状：``{"activities": {<id>: {"config": …}}}``。"""
    return {"activities": {activity_id: {ACTIVITY_CONFIG_KEY: config} for activity_id, config in configs.items()}}


def _cases() -> dict[str, dict]:
    return {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in sorted(CASES_DIR.glob("*.json"))}


def _ctx(case_data: dict, *, runtime_state: dict | None = None) -> ToolContext:
    record = SimpleNamespace(
        id=1,
        user_id=10,
        runtime_state=runtime_state,
        status="in_progress",
        case_snapshot=case_data,
        practice_snapshot={},
    )
    return ToolContext(
        record=record,
        case_data=case_data,
        current_user=SimpleNamespace(id=10, has_permission=lambda _p: True),
        db=FakeSession(),
    )


# ── 唯一登记表（Step 1 验收）──────────────────────────────────────────────


class TestRegistry:
    def test_activity_ids_are_unique_and_match_bindings(self):
        assert len(set(ACTIVITY_IDS)) == len(ACTIVITY_IDS)
        assert tuple(ACTIVITY_BINDINGS) == ACTIVITY_IDS

    def test_handler_id_matches_binding_key(self):
        for activity_id, definition in ACTIVITY_BINDINGS.items():
            assert definition.handler.tool_name == activity_id

    def test_every_activity_declares_commands(self):
        for definition in ACTIVITY_BINDINGS.values():
            assert definition.commands, definition.id
            assert definition.commands <= definition.handler.actions | definition.commands

    def test_schemas_are_pydantic_models(self):
        for definition in ACTIVITY_BINDINGS.values():
            assert issubclass(definition.inputs_schema, BaseModel), definition.id
            assert issubclass(definition.outputs_schema, BaseModel), definition.id

    def test_ui_renderer_declared(self):
        for definition in ACTIVITY_BINDINGS.values():
            assert definition.ui_renderer
            assert definition.ui_placement
            assert definition.ui_order > 0

    def test_case_declaration_is_the_only_case_side_switch(self):
        """当前所有 Activity 都必须由病例显式声明（docs/15 §四：无声明即不可达）。"""
        for definition in ACTIVITY_BINDINGS.values():
            assert definition.availability.requires_case_config is True, definition.id

    def test_workflow_whitelist_covers_every_registered_activity(self):
        """Workflow 白名单必须与登记表一致：多一个或少一个都是「配了但不可达」。"""
        assert set(HISTORY_TAKING.activities) == set(ACTIVITY_IDS)

    def test_only_nursing_record_produces_a_completion_gating_artifact(self):
        artifacts = {
            definition.id: definition.artifact_kind
            for definition in ACTIVITY_BINDINGS.values()
            if definition.artifact_kind
        }
        assert artifacts == {"nursing_record": "nursing_record"}
        assert ACTIVITY_BINDINGS["nursing_record"].requires_submission_for_completion is True
        assert HISTORY_TAKING.completion.required_artifacts == ("nursing_record",)

    def test_unproductized_activities_do_not_claim_evidence(self):
        """quiz / nursing_diagnosis 只写 runtime_state → 不得声称进评分证据（docs/15 §三）。"""
        for activity_id in ("quiz", "nursing_diagnosis"):
            definition = ACTIVITY_BINDINGS[activity_id]
            assert definition.artifact_kind is None
            assert definition.evidence_kind is None

    def test_context_contributions_have_unique_keys(self):
        for definition in ACTIVITY_BINDINGS.values():
            keys = [contribution.key for contribution in definition.context_contribution]
            assert len(keys) == len(set(keys)), definition.id
            assert all(contribution.kind for contribution in definition.context_contribution)


# ── 病例声明解析 ──────────────────────────────────────────────────────────


class TestCaseDeclaration:
    def test_config_read_from_declaration(self):
        case = _declare(quiz={"title": "测验"})
        assert activity_config(case, "quiz") == {"title": "测验"}

    def test_boolean_config_preserved_verbatim(self):
        assert activity_config(_declare(nursing_record=True), "nursing_record") is True

    def test_declared_activity_ids_follow_case_order(self):
        case = {"activities": {"quiz": {"config": {}}, "physical_exam": {"config": {}}}}
        assert declared_activity_ids(case) == ("quiz", "physical_exam")

    def test_legacy_tools_namespace_is_not_a_source(self):
        assert activity_config({"tools": {"quiz": {"title": "旧"}}}, "quiz") is None
        assert declared_activity_ids({"tools": {"quiz": {}}}) == ()

    def test_undeclared_activity_is_not_enabled(self):
        assert is_activity_enabled({}, "quiz") is False
        assert is_activity_enabled(_declare(quiz={}), "quiz") is True

    def test_override_can_disable_but_not_enable(self):
        """作业覆盖只能关（病例没配置的能力不能凭空打开，docs/15 §四）。"""
        assert is_activity_enabled(_declare(quiz={}), "quiz", overrides={"quiz": False}) is False
        assert is_activity_enabled({}, "quiz", overrides={"quiz": True}) is False

    def test_workflow_whitelist_intersects(self):
        case = _declare(quiz={})
        assert is_activity_enabled(case, "quiz", allowed=("quiz",)) is True
        assert is_activity_enabled(case, "quiz", allowed=("physical_exam",)) is False

    def test_flags_cover_every_registered_activity(self):
        flags = resolve_activity_flags(_declare(quiz={}))
        assert set(flags) == set(ACTIVITY_IDS)
        assert flags["quiz"] is True
        assert flags["physical_exam"] is False


class TestAvailability:
    def test_declared_is_available(self):
        availability = activity_availability(_declare(quiz={}), "quiz")
        assert availability.state == STATE_AVAILABLE
        assert availability.reason_code is None
        assert availability.available is True

    def test_missing_declaration_reports_reason(self):
        availability = activity_availability({}, "quiz")
        assert availability.state == STATE_UNAVAILABLE
        assert availability.reason_code == REASON_NOT_CONFIGURED

    def test_workflow_denied_reports_reason(self):
        availability = activity_availability(_declare(quiz={}), "quiz", allowed=())
        assert availability.reason_code == REASON_WORKFLOW_DENIED

    def test_session_ended_reports_reason(self):
        availability = activity_availability(_declare(quiz={}), "quiz", session_active=False)
        assert availability.reason_code == REASON_SESSION_ENDED

    def test_overrides_block(self):
        availability = activity_availability(_declare(quiz={}), "quiz", overrides={"quiz": False})
        assert availability.state == STATE_UNAVAILABLE
        assert availability.reason_code == REASON_DISABLED

    def test_unknown_activity_id(self):
        assert activity_availability(_declare(quiz={}), "telepathy").state == STATE_UNAVAILABLE

    def test_resolve_activities_shape(self):
        resolved = resolve_activities(_declare(quiz={}), allowed=HISTORY_TAKING.activities)
        assert [item.definition.id for item in resolved] == list(ACTIVITY_IDS)
        quiz = next(item for item in resolved if item.definition.id == "quiz")
        assert quiz.availability.available is True
        assert quiz.config == {}
        physical = next(item for item in resolved if item.definition.id == "physical_exam")
        assert physical.availability.reason_code == REASON_NOT_CONFIGURED


# ── 内置特性开关（不是 Activity）──────────────────────────────────────────


class TestFeatureFlags:
    def test_builtins_default_on(self):
        assert resolve_builtin_features() == dict.fromkeys(BUILTIN_FEATURES, True)

    def test_explicit_false_wins(self):
        assert resolve_builtin_features({"emotion": False})["emotion"] is False

    def test_non_bool_override_ignored(self):
        assert resolve_builtin_features({"emotion": "yes"})["emotion"] is True

    def test_is_feature_enabled_reads_practice_snapshot(self):
        record = SimpleNamespace(practice_snapshot={"features": {"patient_initiative": False}})
        assert is_feature_enabled(record, "patient_initiative") is False
        assert is_feature_enabled(record, "emotion") is True
        assert is_feature_enabled(record, "nursing_record") is False  # Activity 不是 feature

    def test_workflow_features_merge_builtins_and_activities(self):
        flags = HISTORY_TAKING.resolve_features(_declare(quiz={}), overrides={"emotion": False})
        assert flags["emotion"] is False
        assert flags["quiz"] is True
        assert flags["physical_exam"] is False
        assert set(BUILTIN_FEATURES) <= set(flags)


# ── 病例库（Step 2/3 验收）────────────────────────────────────────────────


class TestCaseCorpus:
    def test_all_seeded_cases_declare_activities(self):
        for name, case in _cases().items():
            assert declared_activity_ids(case), name
            assert set(declared_activity_ids(case)) <= set(ACTIVITY_IDS), name

    def test_legacy_tools_key_is_gone(self):
        for path in sorted(CASES_DIR.glob("*.json")):
            assert '"tools"' not in path.read_text(encoding="utf-8"), path.name

    def test_activity_enablement_counts(self):
        """11 例声明 physical_exam/nursing_record；quiz 只有 1 例；nursing_diagnosis 0 例。"""
        counts = dict.fromkeys(ACTIVITY_IDS, 0)
        for case in _cases().values():
            for activity_id, enabled in resolve_activity_flags(case).items():
                if enabled:
                    counts[activity_id] += 1
        assert counts == {
            "physical_exam": 11,
            "nursing_record": 11,
            "quiz": 1,
            "nursing_diagnosis": 0,
        }

    @pytest.mark.parametrize("name", sorted(p.stem for p in CASES_DIR.glob("*.json")))
    def test_every_case_resolves(self, name):
        case = _cases()[name]
        resolved = resolve_activities(case, allowed=HISTORY_TAKING.activities)
        assert any(item.availability.available for item in resolved), name


# ── 输出 schema 与 handler 实际载荷一致（契约不漂移）──────────────────────


class TestDeclaredOutputsMatchHandlers:
    @pytest.mark.asyncio
    async def test_physical_exam_measure(self):
        case = _declare(physical_exam={"vital_signs": {"temperature": "39.0"}})
        result = await dispatch("physical_exam", "measure", {"op_type": "temp"}, _ctx(case))
        payload = ACTIVITY_BINDINGS["physical_exam"].outputs_schema.model_validate(result.data)
        assert payload.op_type == "temp"
        assert payload.result["value"] == "39.0"
        assert payload.all_results[-1]["type"] == "temp"

    @pytest.mark.asyncio
    async def test_nursing_record_load(self):
        case = _declare(nursing_record=True)
        result = await dispatch("nursing_record", "load", {}, _ctx(case))
        payload = ACTIVITY_BINDINGS["nursing_record"].outputs_schema.model_validate(result.data)
        assert payload.status == "draft"
        assert set(payload.sheet_data) >= {"subjective", "objective", "assessment", "plan", "evaluation"}
        assert payload.editable is True

    @pytest.mark.asyncio
    async def test_quiz_submit(self):
        case = _declare(quiz={"questions": [{"id": "q1", "stem": "题干", "options": ["A"], "answer": "A"}]})
        result = await dispatch("quiz", "submit", {"question_id": "q1", "answer": "A"}, _ctx(case))
        payload = ACTIVITY_BINDINGS["quiz"].outputs_schema.model_validate(result.data)
        assert payload.question_id == "q1"
        assert payload.correct is True

    @pytest.mark.asyncio
    async def test_nursing_diagnosis_load(self):
        case = _declare(nursing_diagnosis={})
        result = await dispatch("nursing_diagnosis", "load", {}, _ctx(case))
        payload = ACTIVITY_BINDINGS["nursing_diagnosis"].outputs_schema.model_validate(result.data)
        assert payload.diagnoses == []
        assert payload.stems
