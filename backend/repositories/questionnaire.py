from sqlalchemy import func

from core.pagination import paginate
from models import (
    Case,
    CaseQuestionnaire,
    QuestionnaireAnswer,
    QuestionnaireQuestion,
    QuestionnaireResponse,
    QuestionnaireTemplate,
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
