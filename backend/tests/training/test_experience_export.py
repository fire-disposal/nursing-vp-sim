"""体验记录导出（``experience_export``）纯逻辑测试。

被测不变量：时间线按时间排序且覆盖各类事件；无成绩不伪造分；缺情绪事件如实点名；
``is_student_practice`` 与实验批次原样带出；评分量尺与逐项判定不被导出改写。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from modules.training.experience_export import (
    GAP_EXAM_RESULT_WITHOUT_TIMESTAMP,
    GAP_NO_CASE_REVISION,
    GAP_NO_EMOTION_EVENTS,
    GAP_NO_EXAM_RESULTS,
    GAP_NO_EXPERIMENT_BATCH,
    GAP_NO_SCORE,
    GAP_NURSING_RECORD_NOT_SUBMITTED,
    GAP_SCORE_ITEMS_RECONSTRUCTED,
    KIND_ARTIFACT,
    KIND_EMOTION_EVENT,
    KIND_EXAM,
    KIND_MESSAGE,
    KIND_TERMINAL,
    SCHEMA,
    SCHEMA_VERSION,
    build_experience_record,
)

T0 = datetime(2026, 9, 27, 9, 0, tzinfo=UTC)


def _codes(payload) -> set[str]:
    return {gap["code"] for gap in payload["gaps"]}


def _record(**over):
    base = dict(
        id=101,
        user_id=7,
        case_id=1,
        workflow_id="history_taking",
        practice_snapshot={
            "behavior": {"mode": "guided"},
            "experiment": {"batch": "usability-u0", "arm": "A"},
        },
        runtime_state={},
        case_snapshot={"title": "急性阑尾炎"},
        status="completed",
        scoring_status="completed",
        scoring_error=None,
        time_limit=20,
        is_student_practice=True,
        start_time=T0,
        end_time=T0 + timedelta(minutes=12),
        case_revision_id=3,
        user=SimpleNamespace(display_name="张三", student_id="2026001"),
    )
    base.update(over)
    return SimpleNamespace(**base)


def _message(message_id: int, role: str, content: str, minutes: int):
    return SimpleNamespace(id=message_id, role=role, content=content, created_at=T0 + timedelta(minutes=minutes))


def _exam_action(action_id: int, op_type: str, value: str, minutes: int, *, label="体温", unit="℃"):
    return SimpleNamespace(
        id=action_id,
        kind="physical_exam",
        created_at=T0 + timedelta(minutes=minutes),
        result={
            "data": {
                "op_type": op_type,
                "result": {
                    "label": label,
                    "value": value,
                    "unit": unit,
                    "interpretation": {"status": "abnormal", "text": "体温升高"},
                },
                "all_results": [],
            },
            "scene": {},
        },
    )


def _emotion_event(minutes: int, *, after_state=None, event_type="trust_up"):
    return SimpleNamespace(
        id="evt-1",
        turn_id="turn-1",
        created_at=T0 + timedelta(minutes=minutes),
        event_type=event_type,
        confidence=0.9,
        evidence="谢谢护士",
        delta={"trust": 0.05},
        before_state={"trust": 0.5, "anxiety": 0.5, "irritation": 0.3, "cooperation": 0.5},
        after_state=(
            {"trust": 0.6, "anxiety": 0.4, "irritation": 0.2, "cooperation": 0.7}
            if after_state is None
            else after_state
        ),
    )


def _score(**over):
    base = dict(
        total_score=76.0,
        effective_total=76.0,
        raw_total=21.0,
        reviewed_total=None,
        fallback=None,
        rubric_version="history_taking@2026.1",
        mapping_version=1,
        detail_scores={},
        raw_detail_scores={
            "病史采集": {
                "score": 3,
                "items": [
                    {
                        "id": "h1",
                        "name": "主诉",
                        "score": 2,
                        "max": 2,
                        "status": "scored",
                        "reason": "问到了",
                        "evidence": "咳嗽三天了",
                        "evidence_refs": [{"kind": "message", "id": 11, "role": "student"}],
                        "evidence_verified": True,
                    },
                    {
                        "id": "h2",
                        "name": "诱因",
                        "score": 1,
                        "max": 2,
                        "status": "scored",
                        "reason": "未追问诱因",
                        "evidence": None,
                        "evidence_refs": [],
                        "evidence_verified": False,
                    },
                ],
            }
        },
        score_meta={
            "applicable_raw_max": 28.0,
            "not_applicable_items": ["h9"],
            "incomplete": {"unscored_items": ["h2"], "dims": [], "count": 1},
            "feedback_note": "没有明确不足，因为记录不完整",
        },
        strengths=["问诊有条理"],
        weaknesses=[],
        missed_content=["诱因"],
        suggestions="继续练习",
        model_name="deepseek-v4",
        created_at=T0 + timedelta(minutes=13),
    )
    base.update(over)
    return SimpleNamespace(**base)


class TestEnvelope:
    def test_schema_and_required_sections(self):
        payload = build_experience_record(_record(), [], None, [], [], case_name="急性阑尾炎")
        assert payload["schema"] == SCHEMA
        assert payload["schema_version"] == SCHEMA_VERSION
        assert set(payload) >= {"schema", "schema_version", "session", "timeline", "affect", "score", "gaps"}


class TestTimeline:
    def test_covers_all_event_kinds_in_time_order(self):
        messages = [
            _message(12, "patient", "我肚子疼", 2),
            _message(11, "student", "哪里疼", 1),
        ]
        payload = build_experience_record(
            _record(runtime_state={"exam_results": [{"type": "temperature", "value": "38.5"}]}),
            messages,
            _score(),
            [_emotion_event(4)],
            [_exam_action(31, "temperature", "38.5", 3)],
            case_name="急性阑尾炎",
            nursing_record=SimpleNamespace(
                submitted_at=T0 + timedelta(minutes=6), updated_at=T0 + timedelta(minutes=5)
            ),
        )

        timeline = payload["timeline"]
        assert [event["kind"] for event in timeline] == [
            KIND_MESSAGE,
            KIND_MESSAGE,
            KIND_EXAM,
            KIND_EMOTION_EVENT,
            KIND_ARTIFACT,
            KIND_TERMINAL,
        ]
        stamps = [event["at"] for event in timeline]
        assert stamps == sorted(stamps)  # 按时间升序
        assert timeline[0]["role"] == "student"
        assert timeline[0]["message_id"] == 11
        assert timeline[1]["role"] == "patient"
        exam = timeline[2]
        # 审计行是查体时刻与可链接 id 的来源；运行态里有同一结果的重复条目不再产出一行
        assert exam["source"] == "action_log"
        assert exam["action_id"] == 31
        assert (exam["op_type"], exam["value"], exam["unit"]) == ("temperature", "38.5", "℃")
        assert exam["status"] == "abnormal"
        artifact = timeline[4]
        assert artifact == {
            "kind": KIND_ARTIFACT,
            "at": (T0 + timedelta(minutes=6)).isoformat(),
            "artifact_kind": "nursing_record",
            "state": "submitted",
            "required": False,
            "submitted_at": (T0 + timedelta(minutes=6)).isoformat(),
            "updated_at": (T0 + timedelta(minutes=5)).isoformat(),
        }
        assert timeline[5]["kind"] == KIND_TERMINAL
        assert timeline[5]["reason"] is None

    def test_draft_artifact_and_runtime_only_exam_are_named_and_last(self):
        payload = build_experience_record(
            _record(runtime_state={"exam_results": [{"type": "temperature", "value": "38.5", "label": "体温"}]}),
            [_message(11, "student", "哪里疼", 1)],
            None,
            [],
            [],  # 没有任何查体审计行
            nursing_record=SimpleNamespace(submitted_at=None, updated_at=T0 + timedelta(minutes=5)),
        )
        timeline = payload["timeline"]
        untimed = [event for event in timeline if event["kind"] == KIND_EXAM]
        assert len(untimed) == 1
        assert untimed[0]["at"] is None
        assert untimed[0]["source"] == "runtime_state"
        # 无时间戳的事件排在末尾，哪怕它事实上发生在终局之前（顺序不可知就不假装知道）
        assert timeline[-1] is untimed[0]
        assert timeline[-2]["kind"] == KIND_TERMINAL
        assert GAP_EXAM_RESULT_WITHOUT_TIMESTAMP in _codes(payload)
        assert GAP_NURSING_RECORD_NOT_SUBMITTED in _codes(payload)


class TestHonesty:
    def test_no_score_does_not_fabricate_one(self):
        payload = build_experience_record(
            _record(status="completed", scoring_status="failed", scoring_error="LLM 解析失败"),
            [_message(11, "student", "哪里疼", 1)],
            None,
            [_emotion_event(2)],
            [],
        )
        assert payload["score"] is None
        gap = next(g for g in payload["gaps"] if g["code"] == GAP_NO_SCORE)
        assert gap["scoring_status"] == "failed"
        assert gap["scoring_error"] == "LLM 解析失败"

    def test_missing_affect_is_null_and_named(self):
        payload = build_experience_record(_record(), [_message(11, "student", "哪里疼", 1)], _score(), [], [])
        assert payload["affect"]["events"] == []
        assert payload["affect"]["event_count"] == 0
        assert payload["affect"]["final"] is None
        assert payload["affect"]["comfort_source"] is None
        assert GAP_NO_EMOTION_EVENTS in _codes(payload)
        assert GAP_NO_EXAM_RESULTS in _codes(payload)

    def test_missing_case_revision_and_batch_are_named(self):
        payload = build_experience_record(
            _record(case_revision_id=None, practice_snapshot={"behavior": {"mode": "assessment"}}),
            [],
            None,
            [],
            [],
        )
        assert payload["session"]["case"]["case_revision_id"] is None
        assert payload["session"]["case"]["revision_no"] is None
        assert payload["session"]["experiment"] is None
        assert payload["session"]["experiment_label"] is None
        assert {GAP_NO_CASE_REVISION, GAP_NO_EXPERIMENT_BATCH} <= _codes(payload)

    def test_affect_final_is_last_state_with_comfort(self):
        payload = build_experience_record(
            _record(),
            [],
            None,
            [
                _emotion_event(2),
                _emotion_event(5, after_state={"trust": 0.2, "anxiety": 0.8, "irritation": 0.6, "cooperation": 0.1}),
            ],
            [],
        )
        final = payload["affect"]["final"]
        assert final["trust"] == 20
        assert final["anxiety"] == 80
        assert final["irritation"] == 60
        assert final["comfort"] == round(100 - 0.5 * 80 - 0.5 * 60)
        assert payload["affect"]["comfort_source"] == "initiative_mood"
        assert payload["affect"]["event_count"] == 2


class TestSession:
    def test_practice_identity_and_batch_are_carried_verbatim(self):
        session = build_experience_record(_record(), [], None, [], [], case_name="急性阑尾炎")["session"]
        assert session["is_student_practice"] is True
        assert session["mode"] == "guided"
        assert session["experiment"] == {"batch": "usability-u0", "arm": "A"}
        assert session["experiment_label"] == "usability-u0/A"
        assert session["workflow"] == {"id": "history_taking", "label": "病史采集"}
        assert session["case"] == {
            "case_id": 1,
            "name": "急性阑尾炎",
            "case_revision_id": 3,
            "revision_no": None,
        }
        assert session["duration_seconds"] == 12 * 60
        assert session["start_time"] == T0.isoformat()
        assert session["end_time"] == (T0 + timedelta(minutes=12)).isoformat()

    def test_teacher_trial_is_not_a_student_practice(self):
        payload = build_experience_record(
            _record(is_student_practice=False, practice_snapshot={"behavior": {"mode": "free"}}), [], None, [], []
        )
        assert payload["session"]["is_student_practice"] is False

    def test_unfinished_session_has_no_duration_and_is_named(self):
        from modules.training.experience_export import GAP_SESSION_NOT_FINISHED

        payload = build_experience_record(
            _record(status="in_progress", scoring_status=None, end_time=None), [], None, [], []
        )
        assert payload["session"]["duration_seconds"] is None
        assert payload["session"]["end_time"] is None
        assert GAP_SESSION_NOT_FINISHED in _codes(payload)


class TestScore:
    def test_raw_items_scale_and_flags_are_projected(self):
        score = build_experience_record(_record(), [], _score(), [], [])["score"]
        assert score["display_total"] == 76.0
        assert score["raw_total"] == 21.0
        assert score["raw_max"] == 28.0
        assert score["rubric_version"] == "history_taking@2026.1"
        assert score["mapping_version"] == 1
        assert score["source"] == "ai"
        assert score["fallback"] is None
        assert score["incomplete"] == {"unscored_items": ["h2"], "dims": [], "count": 1}
        assert score["not_applicable_items"] == ["h9"]
        assert score["items_source"] == "raw_detail_scores"
        assert score["items"][0]["evidence_refs"] == [{"kind": "message", "id": 11, "role": "student"}]
        assert score["items"][0]["evidence_verified"] is True
        assert score["items"][1]["score"] == 1.0
        assert score["items"][1]["reason"] == "未追问诱因"
        assert score["grade"]["policy"]["id"]

    def test_degraded_score_keeps_fallback_and_source(self):
        score = build_experience_record(
            _record(), [], _score(fallback={"kind": "llm_empty", "note": "双次失败"}), [], []
        )["score"]
        assert score["fallback"] == {"kind": "llm_empty", "note": "双次失败"}
        assert score["source"] == "fallback"

    def test_legacy_score_items_are_reconstructed_and_named(self):
        legacy = _score(
            raw_detail_scores=None,
            score_meta={"applicable_raw_max": 28.0},
            detail_scores={
                "病史采集": {
                    "score": 71,
                    "max": 100,
                    "items": [{"id": "h1", "name": "主诉", "score": 71, "max": 100}],
                }
            },
        )
        payload = build_experience_record(_record(), [], legacy, [], [], rubric={"raw_max": 28, "raw_scale": 2})
        score = payload["score"]
        assert score["items_source"] == "reconstructed_from_display"
        assert score["items"][0]["score"] == 20.0  # 71 ÷ (100/28) ≈ 20（原始刻度）
        assert score["items"][0]["dimension"] == "病史采集"
        assert GAP_SCORE_ITEMS_RECONSTRUCTED in _codes(payload)
        assert "evidence_refs" in score["items"][0]
