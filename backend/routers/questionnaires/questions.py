from typing import Annotated

from fastapi import APIRouter, Depends

from core.deps import DbSession
from core.security import require_permission
from models import User
from schemas import (
    DeleteResponse,
    QuestionnaireQuestionCreate,
    QuestionnaireQuestionResponse,
    QuestionnaireQuestionUpdate,
)
from services.questionnaire import QuestionnaireQuestionService, QuestionView

router = APIRouter()

_Manager = Annotated[User, Depends(require_permission("questionnaire_manage"))]


def _resp(view: QuestionView) -> QuestionnaireQuestionResponse:
    return QuestionnaireQuestionResponse(
        id=view.id,
        template_id=view.template_id,
        content=view.content,
        question_type=view.question_type,
        required=view.required,
        sort_order=view.sort_order,
        options=view.options,
    )


@router.post("/questionnaires/templates/{template_id}/questions", response_model=QuestionnaireQuestionResponse)
def add_question(
    template_id: int,
    req: QuestionnaireQuestionCreate,
    current_user: _Manager,
    db: DbSession,
):
    return _resp(
        QuestionnaireQuestionService(db).create(
            template_id=template_id,
            sort_order=req.sort_order,
            content=req.content,
            question_type=req.question_type,
            required=req.required,
            options=req.options,
        )
    )


@router.put(
    "/questionnaires/templates/{template_id}/questions/{question_id}",
    response_model=QuestionnaireQuestionResponse,
)
def update_question(
    template_id: int,
    question_id: int,
    req: QuestionnaireQuestionUpdate,
    current_user: _Manager,
    db: DbSession,
):
    return _resp(
        QuestionnaireQuestionService(db).update(
            template_id=template_id,
            question_id=question_id,
            content=req.content,
            question_type=req.question_type,
            required=req.required,
            sort_order=req.sort_order,
            options=req.options,
        )
    )


@router.delete("/questionnaires/templates/{template_id}/questions/{question_id}", response_model=DeleteResponse)
def delete_question(
    template_id: int,
    question_id: int,
    current_user: _Manager,
    db: DbSession,
):
    QuestionnaireQuestionService(db).delete(template_id, question_id)
    return {"ok": True}
