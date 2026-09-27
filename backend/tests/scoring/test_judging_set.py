"""判例集入选规则（docs/19 W0）：把"没资格当判例的记录"挡在判例集之外。

教师判定内容不在这里，也**不能**在这里 —— 本文件只钉住机械可判的那部分：
单回合、系统终止、系统降级、缺原始身份、重复导出，都不得混作完整能力判例。
"""

from __future__ import annotations

from modules.training.scoring.judging_set import (
    EXCLUDE_DUPLICATE_SOURCE,
    EXCLUDE_IDENTITY_UNKNOWN,
    EXCLUDE_SINGLE_TURN,
    EXCLUDE_SYSTEM_DEGRADED,
    EXCLUDE_TRAINING_NOT_FINISHED,
    REQUIRED_CASE_KINDS,
    coverage_gaps,
    eligible_for_judging,
)

META = {
    "applicable_raw_max": 46.0,
    "rubric_content_id": "nursing_history_v1@abc123",
    "grade_policy": {"id": "nursing_history_grade", "version": 1},
}


def _evaluate(**overrides):
    params = {
        "student_turns": 12,
        "training_status": "completed",
        "terminal_reason": "user_end",
        "score_fallback": None,
        "score_meta": META,
    }
    params.update(overrides)
    return eligible_for_judging(**params)


def test_complete_record_is_eligible():
    result = _evaluate()
    assert result.eligible is True
    assert result.reasons == ()


def test_single_turn_conversation_is_not_a_capability_case():
    result = _evaluate(student_turns=1)
    assert result.eligible is False
    assert EXCLUDE_SINGLE_TURN in result.reasons


def test_system_terminated_training_is_not_a_case():
    assert EXCLUDE_TRAINING_NOT_FINISHED in _evaluate(terminal_reason="timeout").reasons
    assert EXCLUDE_TRAINING_NOT_FINISHED in _evaluate(terminal_reason="patient_walkout").reasons
    assert EXCLUDE_TRAINING_NOT_FINISHED in _evaluate(training_status="in_progress").reasons


def test_degraded_system_score_is_not_a_case():
    result = _evaluate(score_fallback={"kind": "items_unscored", "items": ["沟通技能:c0"]})
    assert EXCLUDE_SYSTEM_DEGRADED in result.reasons


def test_record_without_raw_identity_is_not_a_case():
    result = _evaluate(score_meta=None)
    assert EXCLUDE_IDENTITY_UNKNOWN in result.reasons


def test_duplicate_export_is_caught():
    result = _evaluate(seen_record_ids={7}, record_id=7)
    assert EXCLUDE_DUPLICATE_SOURCE in result.reasons


def test_reasons_are_deduplicated_and_labelled():
    result = _evaluate(student_turns=0, score_meta=None, score_fallback={"kind": "llm_empty"})
    assert len(result.reasons) == len(set(result.reasons))
    assert len(result.labels) == len(result.reasons)
    assert all(label for label in result.labels)


def test_required_case_kinds_cover_the_documented_boundaries():
    kinds = {kind for kind, _ in REQUIRED_CASE_KINDS}
    assert coverage_gaps(kinds) == []
    assert coverage_gaps({"mechanical_coverage"}) == [kind for kind, _ in REQUIRED_CASE_KINDS[1:]]
