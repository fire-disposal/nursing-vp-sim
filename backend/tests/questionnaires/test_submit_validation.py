"""问卷提交的服务端校验回归（纯逻辑，无数据库）。

守护评审报告 mess-domain-crud.md 第 10/11 条：
- 必答校验与题目归属校验原本只在前端，服务端照单全收；
- trigger_event 曾有 after_training 这个永不触发的后台默认值。
"""

import pytest
from pydantic import ValidationError as PydanticValidationError

from core.exceptions import ValidationError
from core.statuses import QuestionnaireTrigger, normalize_questionnaire_trigger
from models import QuestionnaireQuestion
from modules.questionnaires.response_service import validate_submitted_answers
from schemas.questionnaire import CaseAssignmentRequest

TEMPLATE_ID = 7


def _questions(*specs: tuple[int, bool, str]) -> dict[int, QuestionnaireQuestion]:
    """(id, required, content) → {id: question}（内存实例，不经数据库）。"""
    return {
        qid: QuestionnaireQuestion(id=qid, template_id=TEMPLATE_ID, content=content, required=required)
        for qid, required, content in specs
    }


QUESTIONS = _questions((1, True, "姓名"), (2, True, "满意度"), (3, False, "补充说明"))


def _answers(*pairs: tuple[int, str | None]) -> list[dict]:
    return [{"question_id": qid, "answer_value": value} for qid, value in pairs]


class TestRequiredAnswers:
    def test_missing_required_question_rejected(self):
        with pytest.raises(ValidationError, match="必答题未作答"):
            validate_submitted_answers(QUESTIONS, _answers((1, "张三")))

    def test_blank_required_answer_rejected(self):
        with pytest.raises(ValidationError, match="必答题未作答"):
            validate_submitted_answers(QUESTIONS, _answers((1, "   "), (2, "5")))

    def test_all_required_answered_passes(self):
        result = validate_submitted_answers(QUESTIONS, _answers((1, "张三"), (2, "5")))
        assert dict(result) == {1: "张三", 2: "5"}

    def test_optional_question_may_be_blank(self):
        result = validate_submitted_answers(QUESTIONS, _answers((1, "张三"), (2, "5"), (3, None)))
        assert dict(result)[3] is None

    def test_optional_question_may_be_omitted(self):
        result = validate_submitted_answers(QUESTIONS, _answers((1, "张三"), (2, "5")))
        assert [qid for qid, _ in result] == [1, 2]


class TestQuestionOwnership:
    def test_foreign_question_rejected(self):
        with pytest.raises(ValidationError, match="不属于该问卷"):
            validate_submitted_answers(QUESTIONS, _answers((1, "张三"), (2, "5"), (99, "越权")))

    def test_duplicate_question_rejected(self):
        with pytest.raises(ValidationError, match="重复作答"):
            validate_submitted_answers(QUESTIONS, _answers((1, "张三"), (2, "5"), (2, "4")))

    def test_template_without_required_questions_accepts_empty_payload(self):
        assert validate_submitted_answers(_questions((9, False, "备注")), []) == []


class TestTriggerVocabulary:
    def test_legacy_and_unknown_values_fall_back(self):
        assert normalize_questionnaire_trigger("after_training") == QuestionnaireTrigger.BEFORE_TRAINING.value
        assert normalize_questionnaire_trigger(None) == QuestionnaireTrigger.BEFORE_TRAINING.value
        assert normalize_questionnaire_trigger("manual") == QuestionnaireTrigger.BEFORE_TRAINING.value

    def test_known_values_are_preserved(self):
        assert normalize_questionnaire_trigger("before_training") == "before_training"
        assert normalize_questionnaire_trigger("after_scoring") == "after_scoring"

    def test_request_accepts_only_real_trigger_points(self):
        req = CaseAssignmentRequest(case_ids=[1], trigger_event=QuestionnaireTrigger.AFTER_SCORING)
        assert req.trigger_event is QuestionnaireTrigger.AFTER_SCORING

        # 历史后台默认值 after_training 无触发点，必须被拒
        with pytest.raises(PydanticValidationError):
            CaseAssignmentRequest.model_validate({"case_ids": [1], "trigger_event": "after_training"})

    def test_request_defaults_to_before_training(self):
        assert CaseAssignmentRequest(case_ids=[1]).trigger_event is QuestionnaireTrigger.BEFORE_TRAINING
