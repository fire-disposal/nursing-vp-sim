from sqlalchemy import func
from sqlalchemy.orm import joinedload

from core.pagination import paginate
from models import (
    Case,
    CaseQuestionnaire,
    QuestionnaireAnswer,
    QuestionnaireQuestion,
    QuestionnaireResponse,
    QuestionnaireTemplate,
    TrainingRecord,
)
from repositories.base import Repository


class QuestionnaireTemplateRepository(Repository[QuestionnaireTemplate]):
    model = QuestionnaireTemplate

    def list_filtered(self, type_: str | None, offset: int, limit: int) -> tuple[list[QuestionnaireTemplate], int]:
        return paginate(self._list_query(type_), offset, limit)

    def _list_query(self, type_: str | None = None):
        q = self.db.query(QuestionnaireTemplate)
        if type_:
            q = q.filter(QuestionnaireTemplate.type == type_)
        return q.order_by(QuestionnaireTemplate.updated_at.desc())

    def response_counts(self, template_ids: list[int]) -> dict[int, int]:
        if not template_ids:
            return {}
        rows = (
            self.db.query(QuestionnaireResponse.template_id, func.count(QuestionnaireResponse.id))
            .filter(
                QuestionnaireResponse.template_id.in_(template_ids),
                QuestionnaireResponse.status == "completed",
            )
            .group_by(QuestionnaireResponse.template_id)
            .all()
        )
        return {tid: cnt for tid, cnt in rows}

    def case_links_for(self, template_id: int) -> list[CaseQuestionnaire]:
        return self.db.query(CaseQuestionnaire).filter(CaseQuestionnaire.template_id == template_id).all()

    def delete_case_links(self, template_id: int) -> None:
        self.db.query(CaseQuestionnaire).filter(CaseQuestionnaire.template_id == template_id).delete()

    def case_exists(self, case_id: int) -> bool:
        q = self.db.query(Case).filter(Case.id == case_id)
        return bool(self.db.query(q.exists()).scalar())


class QuestionnaireQuestionRepository(Repository[QuestionnaireQuestion]):
    model = QuestionnaireQuestion

    def answer_count_for(self, question_id: int) -> int:
        return (
            self.db.query(func.count(QuestionnaireAnswer.id))
            .filter(QuestionnaireAnswer.question_id == question_id)
            .scalar()
        ) or 0


class QuestionnaireResponseRepository(Repository[QuestionnaireResponse]):
    model = QuestionnaireResponse

    def find_pending(self, user_id: int, template_id: int, case_id: int) -> QuestionnaireResponse | None:
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

    def find_completed(self, user_id: int, template_id: int, case_id: int) -> QuestionnaireResponse | None:
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

    def list_by_user(self, user_id: int, offset: int, limit: int) -> tuple[list[QuestionnaireResponse], int]:
        q = (
            self.db.query(QuestionnaireResponse)
            .options(joinedload(QuestionnaireResponse.template))
            .filter(QuestionnaireResponse.user_id == user_id)
            .order_by(QuestionnaireResponse.created_at.desc())
        )
        return paginate(q, offset, limit)

    def list_by_template(self, template_id: int, offset: int, limit: int) -> tuple[list[QuestionnaireResponse], int]:
        q = (
            self.db.query(QuestionnaireResponse)
            .options(joinedload(QuestionnaireResponse.template), joinedload(QuestionnaireResponse.user))
            .filter(QuestionnaireResponse.template_id == template_id, QuestionnaireResponse.status == "completed")
            .order_by(QuestionnaireResponse.created_at.desc())
        )
        return paginate(q, offset, limit)

    def delete_answers(self, response_id: int) -> None:
        self.db.query(QuestionnaireAnswer).filter(QuestionnaireAnswer.response_id == response_id).delete()

    def load_answers(self, response_ids: list[int]) -> dict[int, list[QuestionnaireAnswer]]:
        rows = self.db.query(QuestionnaireAnswer).filter(QuestionnaireAnswer.response_id.in_(response_ids)).all()
        m: dict[int, list[QuestionnaireAnswer]] = {}
        for a in rows:
            m.setdefault(a.response_id, []).append(a)
        return m

    def load_questions(self, template_ids: list[int]) -> dict[int, dict[int, QuestionnaireQuestion]]:
        rows = self.db.query(QuestionnaireQuestion).filter(QuestionnaireQuestion.template_id.in_(template_ids)).all()
        m: dict[int, dict[int, QuestionnaireQuestion]] = {}
        for q in rows:
            m.setdefault(q.template_id, {})[q.id] = q
        return m

    def case_questionnaires_for(self, case_id: int, trigger: str | None = None) -> list[CaseQuestionnaire]:
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

    def get_template(self, template_id: int) -> QuestionnaireTemplate | None:
        return self.db.query(QuestionnaireTemplate).filter(QuestionnaireTemplate.id == template_id).first()

    def get_training_record(self, record_id: int, user_id: int) -> TrainingRecord | None:
        return (
            self.db.query(TrainingRecord)
            .filter(TrainingRecord.id == record_id, TrainingRecord.user_id == user_id)
            .first()
        )
