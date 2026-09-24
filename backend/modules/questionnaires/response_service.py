"""Questionnaire response business logic — submit, list, stats, export."""

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.orm import Session, joinedload

from core.exceptions import NotFoundError, ValidationError
from core.pagination import paginate
from core.statuses import QuestionnaireTrigger, normalize_questionnaire_trigger
from core.unit_of_work import unit_of_work
from models import (
    CaseQuestionnaire,
    QuestionnaireAnswer,
    QuestionnaireQuestion,
    QuestionnaireResponse,
    QuestionnaireTemplate,
    TrainingRecord,
)
from modules.questionnaires.service import template_to_detail
from schemas.questionnaire import (
    QuestionnaireCheckResponse,
    QuestionnaireStatsResponse,
    QuestionStatsItem,
)


def validate_submitted_answers(
    questions: Mapping[int, QuestionnaireQuestion],
    answers_data: Sequence[dict],
) -> list[tuple[int, str | None]]:
    """校验提交答案：题目归属本模板、不得重复、必答题不得留空。

    服务端是必答契约的唯一权威（前端 ``QuestionnaireModal`` 的校验只是体验优化）；
    「留空」的判定与前端一致：``None`` 或全空白串视为未作答。
    返回 ``(question_id, answer_value)`` 列表，失败抛 ``ValidationError``。
    """
    submitted: dict[int, str | None] = {}
    for ans in answers_data:
        question_id = ans["question_id"]
        if question_id not in questions:
            raise ValidationError(f"题目 {question_id} 不属于该问卷")
        if question_id in submitted:
            raise ValidationError(f"题目 {question_id} 重复作答")
        submitted[question_id] = ans.get("answer_value")

    missing = [q.content for qid, q in questions.items() if q.required and not (submitted.get(qid) or "").strip()]
    if missing:
        preview = "、".join(missing[:3]) + ("..." if len(missing) > 3 else "")
        raise ValidationError(f"必答题未作答：{preview}")

    return list(submitted.items())


def count_pending_required(db: Session, user_id: int, case_id: int) -> int:
    """该学生在该病例下「仍需作答」的必做问卷数。

    与 ``check()`` 同一判定：仅统计训练前、启用、必做，且该学生尚未完成的问卷。
    训练入口据此决定是否冻结倒计时并阻止训练场景挂载。
    """
    if not case_id:
        return 0

    template_ids = [
        row[0]
        for row in db.query(CaseQuestionnaire.template_id)
        .join(QuestionnaireTemplate, CaseQuestionnaire.template_id == QuestionnaireTemplate.id)
        .filter(
            CaseQuestionnaire.case_id == case_id,
            CaseQuestionnaire.is_required == True,
            CaseQuestionnaire.trigger_event == QuestionnaireTrigger.BEFORE_TRAINING.value,
            QuestionnaireTemplate.is_active == True,
        )
        .all()
    ]
    if not template_ids:
        return 0

    completed = {
        row[0]
        for row in db.query(QuestionnaireResponse.template_id)
        .filter(
            QuestionnaireResponse.user_id == user_id,
            QuestionnaireResponse.case_id == case_id,
            QuestionnaireResponse.template_id.in_(template_ids),
            QuestionnaireResponse.record_id.is_(None),
            QuestionnaireResponse.status == "completed",
        )
        .all()
    }
    return sum(1 for tid in template_ids if tid not in completed)


@dataclass
class AnswerView:
    question_id: int
    question_content: str
    question_type: str
    options: list[str] | None = None
    answer_value: str | None = None


@dataclass
class ResponseView:
    id: int
    template_id: int
    template_title: str
    user_id: int
    user_name: str
    case_id: int | None
    record_id: int | None
    status: str
    answers: list[AnswerView]
    completed_at: datetime | None
    created_at: datetime


class QuestionnaireResponseService:
    def __init__(self, db: Session):
        self.db = db

    # ── inlined repository methods ──

    def _find_response(
        self,
        user_id: int,
        template_id: int,
        case_id: int,
        record_id: int | None,
    ) -> QuestionnaireResponse | None:
        q = self.db.query(QuestionnaireResponse).filter(
            QuestionnaireResponse.user_id == user_id,
            QuestionnaireResponse.template_id == template_id,
            QuestionnaireResponse.case_id == case_id,
        )
        if record_id is None:
            q = q.filter(QuestionnaireResponse.record_id.is_(None))
        else:
            q = q.filter(QuestionnaireResponse.record_id == record_id)
        return q.first()

    def _list_by_user(self, user_id: int, offset: int, limit: int) -> tuple[list[QuestionnaireResponse], int]:
        q = (
            self.db.query(QuestionnaireResponse)
            .options(joinedload(QuestionnaireResponse.template))
            .filter(QuestionnaireResponse.user_id == user_id)
            .order_by(QuestionnaireResponse.created_at.desc())
        )
        return paginate(q, offset, limit)

    def _list_by_template(self, template_id: int, offset: int, limit: int) -> tuple[list[QuestionnaireResponse], int]:
        q = (
            self.db.query(QuestionnaireResponse)
            .options(joinedload(QuestionnaireResponse.template), joinedload(QuestionnaireResponse.user))
            .filter(QuestionnaireResponse.template_id == template_id, QuestionnaireResponse.status == "completed")
            .order_by(QuestionnaireResponse.created_at.desc())
        )
        return paginate(q, offset, limit)

    def _delete_answers(self, response_id: int) -> None:
        self.db.query(QuestionnaireAnswer).filter(QuestionnaireAnswer.response_id == response_id).delete(
            synchronize_session="fetch"
        )

    def _load_answers(self, response_ids: list[int]) -> dict[int, list[QuestionnaireAnswer]]:
        rows = self.db.query(QuestionnaireAnswer).filter(QuestionnaireAnswer.response_id.in_(response_ids)).all()
        m: dict[int, list[QuestionnaireAnswer]] = {}
        for a in rows:
            m.setdefault(a.response_id, []).append(a)
        return m

    def _load_questions(self, template_ids: list[int]) -> dict[int, dict[int, QuestionnaireQuestion]]:
        rows = self.db.query(QuestionnaireQuestion).filter(QuestionnaireQuestion.template_id.in_(template_ids)).all()
        m: dict[int, dict[int, QuestionnaireQuestion]] = {}
        for q in rows:
            m.setdefault(q.template_id, {})[q.id] = q
        return m

    def _case_questionnaires_for(self, case_id: int, trigger: str | None = None) -> list[CaseQuestionnaire]:
        q = (
            self.db.query(CaseQuestionnaire)
            .join(QuestionnaireTemplate, CaseQuestionnaire.template_id == QuestionnaireTemplate.id)
            .filter(
                CaseQuestionnaire.case_id == case_id,
                QuestionnaireTemplate.is_active == True,
            )
        )
        if trigger:
            q = q.filter(CaseQuestionnaire.trigger_event == trigger)
        return q.order_by(CaseQuestionnaire.id).all()

    def _get_template(self, template_id: int) -> QuestionnaireTemplate | None:
        return self.db.query(QuestionnaireTemplate).filter(QuestionnaireTemplate.id == template_id).first()

    def _get_training_record(self, record_id: int, user_id: int) -> TrainingRecord | None:
        return (
            self.db.query(TrainingRecord)
            .filter(TrainingRecord.id == record_id, TrainingRecord.user_id == user_id)
            .first()
        )

    # ── business methods ──

    def _build_response_item(
        self,
        response: QuestionnaireResponse,
        answers_map: dict[int, list[QuestionnaireAnswer]] | None = None,
        questions_map: dict[int, dict[int, QuestionnaireQuestion]] | None = None,
    ) -> ResponseView:
        if answers_map is not None:
            answers = answers_map.get(response.id, [])
        else:
            answers = self._load_answers([response.id]).get(response.id, [])

        if questions_map is not None:
            q_map = questions_map.get(response.template_id, {})
        else:
            q_map = self._load_questions([response.template_id]).get(response.template_id, {})

        return ResponseView(
            id=response.id,
            template_id=response.template_id,
            template_title=response.template.title if response.template else "",
            user_id=response.user_id,
            user_name=response.user.display_name if response.user else "",
            case_id=response.case_id,
            record_id=response.record_id,
            status=response.status,
            answers=[
                AnswerView(
                    question_id=a.question_id,
                    question_content=q_map[a.question_id].content if a.question_id in q_map else "",
                    question_type=q_map[a.question_id].question_type if a.question_id in q_map else "",
                    options=q_map[a.question_id].options if a.question_id in q_map else None,
                    answer_value=a.answer_value,
                )
                for a in answers
            ],
            completed_at=response.completed_at,
            created_at=response.created_at,
        )

    def check(
        self,
        user_id: int,
        case_id: int | None,
        record_id: int | None,
        trigger: str | None,
    ) -> QuestionnaireCheckResponse:
        if not case_id and not record_id:
            raise ValidationError("请提供 case_id 或 record_id")

        normalized_trigger = normalize_questionnaire_trigger(trigger)
        response_record_id: int | None = None
        if record_id is not None:
            record = self._get_training_record(record_id, user_id)
            if not record:
                raise NotFoundError("训练记录不存在")
            case_id = record.case_id
            if normalized_trigger == QuestionnaireTrigger.AFTER_SCORING.value:
                if record.scoring_status != "completed":
                    return QuestionnaireCheckResponse(has_pending=False)
                response_record_id = record_id
        elif normalized_trigger == QuestionnaireTrigger.AFTER_SCORING.value:
            return QuestionnaireCheckResponse(has_pending=False)

        if case_id is None:
            return QuestionnaireCheckResponse(has_pending=False)

        cqs = self._case_questionnaires_for(case_id, normalized_trigger)
        for cq in cqs:
            response = self._find_response(user_id, cq.template_id, case_id, response_record_id)
            if response is not None and response.status == "completed":
                continue

            t = self._get_template(cq.template_id)
            return QuestionnaireCheckResponse(
                has_pending=True,
                template_id=cq.template_id,
                response_id=response.id if response else None,
                template=template_to_detail(t) if t else None,
                is_required=cq.is_required,
                trigger_event=normalize_questionnaire_trigger(cq.trigger_event),
            )

        return QuestionnaireCheckResponse(has_pending=False)

    def _resolve_submit_scope(
        self,
        user_id: int,
        case_id: int | None,
        record_id: int | None,
    ) -> int:
        """校验提交作用域并返回病例 ID：训练记录归属、病例匹配与评分状态。"""
        if record_id is None:
            if case_id is None:
                raise ValidationError("请提供病例ID")
            return case_id
        record = self._get_training_record(record_id, user_id)
        if record is None:
            raise NotFoundError("训练记录不存在")
        if case_id is not None and case_id != record.case_id:
            raise ValidationError("病例与训练记录不匹配")
        if record.scoring_status != "completed":
            raise ValidationError("训练尚未完成评分")
        return record.case_id

    def submit(
        self,
        user_id: int,
        template_id: int,
        case_id: int | None,
        record_id: int | None,
        answers_data: list[dict],
    ) -> ResponseView:
        t = self._get_template(template_id)
        if not t or not t.is_active:
            raise NotFoundError("问卷模板不存在或已停用")
        case_id = self._resolve_submit_scope(user_id, case_id, record_id)

        trigger = (
            QuestionnaireTrigger.AFTER_SCORING.value
            if record_id is not None
            else QuestionnaireTrigger.BEFORE_TRAINING.value
        )
        assignment = (
            self.db.query(CaseQuestionnaire)
            .filter(
                CaseQuestionnaire.case_id == case_id,
                CaseQuestionnaire.template_id == template_id,
                CaseQuestionnaire.trigger_event == trigger,
            )
            .first()
        )
        if assignment is None:
            raise ValidationError("该问卷未分配到当前训练阶段")

        questions = {
            q.id: q
            for q in self.db.query(QuestionnaireQuestion).filter(QuestionnaireQuestion.template_id == template_id).all()
        }
        answers = validate_submitted_answers(questions, answers_data)
        response = self._find_response(user_id, template_id, case_id, record_id)

        with unit_of_work(self.db, conflict_detail="提交问卷失败"):
            if response:
                self._delete_answers(response.id)
                if record_id is not None:
                    response.record_id = record_id
            else:
                response = QuestionnaireResponse(
                    template_id=template_id,
                    user_id=user_id,
                    case_id=case_id,
                    record_id=record_id,
                    status="pending",
                )
                self.db.add(response)
                self.db.flush()

            for question_id, answer_value in answers:
                self.db.add(
                    QuestionnaireAnswer(
                        response_id=response.id,
                        question_id=question_id,
                        answer_value=answer_value,
                    )
                )

            response.status = "completed"
            response.completed_at = datetime.now(UTC)

        self.db.refresh(response)
        return self._build_response_item(response)

    def list_my_responses(self, user_id: int, offset: int, limit: int) -> tuple[list[ResponseView], int]:
        rows, total = self._list_by_user(user_id, offset, limit)
        response_ids = [r.id for r in rows]
        template_ids = list({r.template_id for r in rows})
        answers_map = self._load_answers(response_ids)
        questions_map = self._load_questions(template_ids)
        items = [self._build_response_item(r, answers_map, questions_map) for r in rows]
        return items, total

    def list_responses(self, template_id: int, offset: int, limit: int) -> tuple[list[ResponseView], int]:
        t = self._get_template(template_id)
        if not t:
            raise NotFoundError("问卷模板不存在")

        rows, total = self._list_by_template(template_id, offset, limit)
        response_ids = [r.id for r in rows]
        template_ids = [template_id]
        answers_map = self._load_answers(response_ids)
        questions_map = self._load_questions(template_ids)
        items = [self._build_response_item(r, answers_map, questions_map) for r in rows]
        return items, total

    def get_stats(self, template_id: int) -> QuestionnaireStatsResponse:
        t = self._get_template(template_id)
        if not t:
            raise NotFoundError("问卷模板不存在")

        completed = (
            self.db.query(QuestionnaireResponse)
            .filter(
                QuestionnaireResponse.template_id == template_id,
                QuestionnaireResponse.status == "completed",
            )
            .all()
        )
        total_completed = len(completed)

        cq_count = self.db.query(CaseQuestionnaire).filter(CaseQuestionnaire.template_id == template_id).count()

        questions = (
            self.db.query(QuestionnaireQuestion)
            .filter(QuestionnaireQuestion.template_id == template_id)
            .order_by(QuestionnaireQuestion.sort_order)
            .all()
        )

        question_ids = [qa.id for qa in questions]
        response_ids = [r.id for r in completed]

        all_answers = (
            self.db.query(QuestionnaireAnswer.question_id, QuestionnaireAnswer.answer_value)
            .filter(
                QuestionnaireAnswer.question_id.in_(question_ids),
                QuestionnaireAnswer.response_id.in_(response_ids),
            )
            .all()
        )

        answers_by_question: dict[int, list[str]] = {}
        for qid, val in all_answers:
            answers_by_question.setdefault(qid, []).append(val)

        q_stats = []
        for qa in questions:
            ans_values = answers_by_question.get(qa.id, [])
            vals = [v for v in ans_values if v is not None]
            item = QuestionStatsItem(
                question_id=qa.id,
                content=qa.content,
                question_type=qa.question_type,
                response_count=len(vals),
            )

            if qa.question_type in {"likert_5", "satisfaction_5"} and vals:
                numeric = []
                for v in vals:
                    try:
                        numeric.append(float(v))
                    except (ValueError, TypeError):
                        pass
                if numeric:
                    item.avg_likert = sum(numeric) / len(numeric)
            elif qa.question_type == "multiple_choice":
                item.choice_distribution = dict(Counter(vals))
            elif qa.question_type == "short_text":
                item.text_answers = vals

            q_stats.append(item)

        return QuestionnaireStatsResponse(
            template_id=template_id,
            template_title=t.title,
            total_assigned=cq_count,
            total_completed=total_completed,
            completion_rate=(total_completed / cq_count * 100) if cq_count > 0 else 0.0,
            questions=q_stats,
        )

    def export_data(
        self, template_id: int
    ) -> tuple[QuestionnaireTemplate, list[QuestionnaireResponse], list[QuestionnaireQuestion]]:
        """Return (template, responses, questions) for export formatting."""
        t = self._get_template(template_id)
        if not t:
            raise NotFoundError("问卷模板不存在")

        responses = (
            self.db.query(QuestionnaireResponse)
            .options(
                joinedload(QuestionnaireResponse.user),
                joinedload(QuestionnaireResponse.answers),
            )
            .filter(
                QuestionnaireResponse.template_id == template_id,
                QuestionnaireResponse.status == "completed",
            )
            .order_by(QuestionnaireResponse.completed_at.desc())
            .all()
        )

        questions = (
            self.db.query(QuestionnaireQuestion)
            .filter(QuestionnaireQuestion.template_id == template_id)
            .order_by(QuestionnaireQuestion.sort_order)
            .all()
        )

        return t, responses, questions
