from sqlalchemy import func

from models import QuestionnaireAnswer, QuestionnaireQuestion
from repositories.base import Repository


class QuestionnaireQuestionRepository(Repository[QuestionnaireQuestion]):
    model = QuestionnaireQuestion

    def answer_count_for(self, question_id: int) -> int:
        return (
            self.db.query(func.count(QuestionnaireAnswer.id))
            .filter(QuestionnaireAnswer.question_id == question_id)
            .scalar()
        ) or 0
