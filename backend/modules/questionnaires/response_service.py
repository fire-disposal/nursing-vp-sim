"""Questionnaire response business logic — submit, list, stats, export."""

from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.orm import Session, joinedload

from core.exceptions import NotFoundError, ValidationError
from core.pagination import paginate
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

    def _find_pending(self, user_id: int, template_id: int, case_id: int) -> QuestionnaireResponse | None:
        return (
            self.db.query(QuestionnaireResponse)
            .filter(
                QuestionnaireResponse.user_id == user_id,
                QuestionnaireResponse.template_id == template_id,
                QuestionnaireResponse.case_id == case_id,
                QuestionnaireResponse.status == "pending",
            )
            .first()
        )

    def _find_completed(self, user_id: int, template_id: int, case_id: int) -> QuestionnaireResponse | None:
        return (
            self.db.query(QuestionnaireResponse)
            .filter(
                QuestionnaireResponse.user_id == user_id,
                QuestionnaireResponse.template_id == template_id,
                QuestionnaireResponse.case_id == case_id,
                QuestionnaireResponse.status == "completed",
            )
            .first()
        )

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

        if record_id:
            record = self._get_training_record(record_id, user_id)
            if not record:
                raise NotFoundError("训练记录不存在")
            case_id = record.case_id

        if case_id is None:
            return QuestionnaireCheckResponse(has_pending=False)

        cqs = self._case_questionnaires_for(case_id, trigger)

        for cq in cqs:
            existing = self._find_completed(user_id, cq.template_id, case_id)
            if existing:
                continue

            partial = self._find_pending(user_id, cq.template_id, case_id)
            t = self._get_template(cq.template_id)
            return QuestionnaireCheckResponse(
                has_pending=True,
                template_id=cq.template_id,
                response_id=partial.id if partial else None,
                template=template_to_detail(t) if t else None,
                is_required=cq.is_required,
                trigger_event=cq.trigger_event or "before_training",
            )

        return QuestionnaireCheckResponse(has_pending=False)

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
        if case_id is None:
            raise ValidationError("请提供病例ID")

        response = self._find_pending(user_id, template_id, case_id)

        with unit_of_work(self.db, conflict_detail="提交问卷失败"):
            if response:
                self._delete_answers(response.id)
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

            for ans in answers_data:
                self.db.add(
                    QuestionnaireAnswer(
                        response_id=response.id,
                        question_id=ans["question_id"],
                        answer_value=ans.get("answer_value"),
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
