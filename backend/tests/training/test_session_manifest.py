"""Resolved Manifest（projection=session）测试 —— 前端只消费、不推断。

覆盖：activities[].availability、artifacts(draft/submitted)、
completion(eligible/conditions/blockers)、actions[].enabled。
"""

from __future__ import annotations

from core.statuses import TrainingStatus
from modules.training.manifest import (
    ACTION_COMPLETE_SESSION,
    ARTIFACT_DRAFT,
    ARTIFACT_EMPTY,
    ARTIFACT_SUBMITTED,
    CODE_ARTIFACT_NOT_SUBMITTED,
    CODE_SESSION_NOT_ACTIVE,
    PROJECTION_SESSION,
    SCHEMA,
    ArtifactState,
    build_session_manifest,
)
from modules.training.profile import HISTORY_TAKING

_CASE = {
    # 覆盖"门禁"路径：显式要求先提交护理记录（默认不设门禁）
    "completion": {"required_artifacts": ["nursing_record"]},
    "activities": {
        "physical_exam": {"config": {"vital_signs": {"temperature": "39.0"}}},
        "nursing_record": {"config": True},
    },
}


def _artifact(state: str) -> ArtifactState:
    return ArtifactState(
        kind="nursing_record",
        state=state,
        required=True,
        submitted_at="2026-09-25T10:00:00+00:00" if state == ARTIFACT_SUBMITTED else None,
    )


def _manifest(*, status: str = TrainingStatus.IN_PROGRESS, artifact_state: str = ARTIFACT_EMPTY, case_data=_CASE):
    return build_session_manifest(
        session_id=123,
        status=status,
        revision=13,
        case_data=case_data,
        workflow=HISTORY_TAKING,
        case_id=7,
        artifacts={"nursing_record": _artifact(artifact_state)},
    )


class TestEnvelope:
    def test_projection_and_references(self):
        manifest = _manifest()
        assert manifest["schema"] == SCHEMA
        assert manifest["projection"] == PROJECTION_SESSION
        assert manifest["workflow"]["id"] == "history_taking"
        assert manifest["session"] == {"session_id": 123, "status": TrainingStatus.IN_PROGRESS, "revision": 13}
        assert manifest["case"] == {"case_id": 7, "revision_id": None, "revision_no": None}

    def test_activity_entries_carry_availability_and_ui(self):
        activities = {item["id"]: item for item in _manifest()["activities"]}
        assert set(activities) == set(HISTORY_TAKING.activities)
        assert activities["physical_exam"]["availability"] == {"state": "available", "reason_code": None}
        assert activities["physical_exam"]["ui"]["renderer"] == "physical_exam"
        assert activities["physical_exam"]["commands"] == ["measure"]
        assert activities["quiz"]["availability"] == {
            "state": "unavailable",
            "reason_code": "case_not_configured",
        }

    def test_artifacts_carry_state_and_required(self):
        artifacts = _manifest(artifact_state=ARTIFACT_DRAFT)["artifacts"]
        assert artifacts["nursing_record"]["state"] == ARTIFACT_DRAFT
        assert artifacts["nursing_record"]["required"] is True


class TestCompletion:
    def test_draft_blocks_completion(self):
        manifest = _manifest(artifact_state=ARTIFACT_DRAFT)
        completion = manifest["completion"]
        assert completion["eligible"] is False
        assert completion["conditions"] == [
            {"id": "nursing_record_submitted", "label": "提交护理记录", "satisfied": False}
        ]
        blocker = completion["blockers"][0]
        assert blocker["code"] == CODE_ARTIFACT_NOT_SUBMITTED
        assert blocker["target"] == {"type": "artifact", "id": "nursing_record"}
        assert "护理记录" in blocker["message"]

    def test_missing_record_is_not_eligible(self):
        manifest = build_session_manifest(
            session_id=1, status=TrainingStatus.IN_PROGRESS, revision=0, case_data=_CASE, workflow=HISTORY_TAKING
        )
        assert manifest["artifacts"]["nursing_record"]["state"] == ARTIFACT_EMPTY
        assert manifest["completion"]["eligible"] is False

    def test_submitted_is_eligible_and_enables_action(self):
        manifest = _manifest(artifact_state=ARTIFACT_SUBMITTED)
        assert manifest["completion"] == {
            "eligible": True,
            "conditions": [{"id": "nursing_record_submitted", "label": "提交护理记录", "satisfied": True}],
            "blockers": [],
        }
        assert manifest["actions"] == [{"id": ACTION_COMPLETE_SESSION, "label": "结束训练", "enabled": True}]

    def test_ended_session_is_never_eligible(self):
        manifest = _manifest(status=TrainingStatus.COMPLETED, artifact_state=ARTIFACT_SUBMITTED)
        completion = manifest["completion"]
        assert completion["eligible"] is False
        assert completion["blockers"] == [
            {"code": CODE_SESSION_NOT_ACTIVE, "message": "训练已结束，无法再次提交完成", "target": None}
        ]
        assert manifest["actions"][0]["enabled"] is False
        assert all(item["availability"]["state"] == "unavailable" for item in manifest["activities"])

    def test_case_without_nursing_record_has_nothing_to_block(self):
        """病例没声明护理记录 → 完成条件为空，eligible 只取决于会话状态。"""
        case = {"activities": {"quiz": {"config": {"questions": [{"id": "q1"}]}}}}
        manifest = _manifest(case_data=case)
        assert manifest["completion"]["eligible"] is True
        assert manifest["completion"]["conditions"] == []


class TestCompletionDeclarationPerCase:
    """交卷门禁按**病例**解析：

    护理评估是评分产物，但不是每个病例的教学任务都要求学生先提交它才能交卷。
    病例用 ``completion.required_artifacts`` 声明；不声明就用 workflow 默认。
    """

    _WAIVED = {**_CASE, "completion": {"required_artifacts": []}}
    _NO_GATE = {k: val for k, val in _CASE.items() if k != "completion"}

    def test_default_has_no_gate(self):
        """默认**不设**交卷门禁：护理记录是可选工作产物，未提交也能结束（不暗扣分）。"""
        manifest = _manifest(case_data=self._NO_GATE, artifact_state=ARTIFACT_EMPTY)
        assert manifest["artifacts"]["nursing_record"]["required"] is False
        assert manifest["completion"]["blockers"] == []
        assert manifest["completion"]["eligible"] is True

    def test_case_can_waive_the_submission_gate(self):
        """声明不要求提交：产物仍在（可写可评），但不再拦交卷。"""
        manifest = _manifest(case_data=self._WAIVED, artifact_state=ARTIFACT_EMPTY)
        assert manifest["artifacts"]["nursing_record"]["required"] is False
        assert manifest["completion"]["blockers"] == []
        assert manifest["completion"]["conditions"] == []
        assert manifest["completion"]["eligible"] is True
        complete = next(a for a in manifest["actions"] if a["id"] == ACTION_COMPLETE_SESSION)
        assert complete["enabled"] is True

    def test_waiver_does_not_hide_the_artifact(self):
        """豁免的是门禁，不是产物本身：草稿/已提交状态照旧投影给前端。"""
        manifest = _manifest(case_data=self._WAIVED, artifact_state=ARTIFACT_SUBMITTED)
        assert manifest["artifacts"]["nursing_record"]["state"] == ARTIFACT_SUBMITTED

    def test_unknown_kind_is_dropped_by_the_resolver(self):
        """白名单过滤：病例写错产物名不会凭空造出第二个门禁（发布门禁另外点名学生认错）。"""
        case = {**_CASE, "completion": {"required_artifacts": ["not_a_real_artifact"]}}
        manifest = _manifest(case_data=case, artifact_state=ARTIFACT_EMPTY)
        assert manifest["artifacts"]["nursing_record"]["required"] is False
        assert manifest["completion"]["blockers"] == []
