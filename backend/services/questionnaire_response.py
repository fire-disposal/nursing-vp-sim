"""Questionnaire response business logic — submit, list, stats, export."""

from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.orm import Session, joinedload

from core.exceptions import NotFoundError, ValidationError
from core.unit_of_work import unit_of_work
from models import (
    CaseQuestionnaire,
    QuestionnaireAnswer,
    QuestionnaireQuestion,
    QuestionnaireResponse,
    QuestionnaireTemplate,
)
from repositories.questionnaire import QuestionnaireResponseRepository
from schemas.questionnaire import (
    QuestionnaireCheckResponse,
    QuestionnaireStatsResponse,
    QuestionStatsItem,
)
from services.questionnaire import _template_to_detail


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
        self.repo = QuestionnaireResponseRepository(db)

    def _build_response_item(
        self,
        response: QuestionnaireResponse,
        answers_map: dict[int, list[QuestionnaireAnswer]] | None = None,
        questions_map: dict[int, dict[int, QuestionnaireQuestion]] | None = None,
    ) -> ResponseView:
        if answers_map is not None:
            answers = answers_map.get(response.id, [])
        else:
            answers = self.repo.load_answers([response.id]).get(response.id, [])

        if questions_map is not None:
            q_map = questions_map.get(response.template_id, {})
        else:
            q_map = self.repo.load_questions([response.template_id]).get(response.template_id, {})

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
            record = self.repo.get_training_record(record_id, user_id)
            if not record:
                raise NotFoundError("训练记录不存在")
            case_id = record.case_id

        if case_id is None:
            return QuestionnaireCheckResponse(has_pending=False)

        cqs = self.repo.case_questionnaires_for(case_id, trigger)

        for cq in cqs:
            existing = self.repo.find_completed(user_id, cq.template_id, case_id)
            if existing:
                continue

            partial = self.repo.find_pending(user_id, cq.template_id, case_id)
            t = self.repo.get_template(cq.template_id)
            return QuestionnaireCheckResponse(
                has_pending=True,
                template_id=cq.template_id,
                response_id=partial.id if partial else None,
                template=_template_to_detail(t) if t else None,
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
        t = self.repo.get_template(template_id)
        if not t or not t.is_active:
            raise NotFoundError("问卷模板不存在或已停用")
        if case_id is None:
            raise ValidationError("请提供病例ID")

        response = self.repo.find_pending(user_id, template_id, case_id)

        with unit_of_work(self.db, conflict_detail="提交问卷失败"):
            if response:
                self.repo.delete_answers(response.id)
            else:
                response = QuestionnaireResponse(
                    template_id=template_id,
                    user_id=user_id,
                    case_id=case_id,
                    record_id=record_id,
                    status="pending",
                )
                self.repo.add(response)

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
        rows, total = self.repo.list_by_user(user_id, offset, limit)
        response_ids = [r.id for r in rows]
        template_ids = list({r.template_id for r in rows})
        answers_map = self.repo.load_answers(response_ids)
        questions_map = self.repo.load_questions(template_ids)
        items = [self._build_response_item(r, answers_map, questions_map) for r in rows]
        return items, total

    def list_responses(self, template_id: int, offset: int, limit: int) -> tuple[list[ResponseView], int]:
        t = self.repo.get_template(template_id)
        if not t:
            raise NotFoundError("问卷模板不存在")

        rows, total = self.repo.list_by_template(template_id, offset, limit)
        response_ids = [r.id for r in rows]
        template_ids = [template_id]
        answers_map = self.repo.load_answers(response_ids)
        questions_map = self.repo.load_questions(template_ids)
        items = [self._build_response_item(r, answers_map, questions_map) for r in rows]
        return items, total

    def get_stats(self, template_id: int) -> QuestionnaireStatsResponse:
        t = self.repo.get_template(template_id)
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

            if qa.question_type == "likert_5" and vals:
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
        t = self.repo.get_template(template_id)
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
