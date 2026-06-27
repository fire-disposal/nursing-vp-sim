from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import require_permission
from models import QuestionnaireQuestion, QuestionnaireTemplate, User
from schemas import (
    DeleteResponse,
    QuestionnaireQuestionCreate,
    QuestionnaireQuestionResponse,
    QuestionnaireQuestionUpdate,
)

router = APIRouter()


@router.post("/questionnaires/templates/{template_id}/questions", response_model=QuestionnaireQuestionResponse)
def add_question(
    template_id: int,
    req: QuestionnaireQuestionCreate,
    current_user: Annotated[User, Depends(require_permission("questionnaire_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    t = db.query(QuestionnaireTemplate).filter(QuestionnaireTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="问卷模板不存在")
    q = QuestionnaireQuestion(
        template_id=template_id,
        sort_order=req.sort_order,
        content=req.content,
        question_type=req.question_type,
        required=req.required,
        options=req.options,
    )
    db.add(q)
    db.commit()
    db.refresh(q)
    return QuestionnaireQuestionResponse(
        id=q.id,
        template_id=q.template_id,
        content=q.content,
        question_type=q.question_type,
        required=q.required,
        sort_order=q.sort_order,
        options=q.options,
    )


@router.put(
    "/questionnaires/templates/{template_id}/questions/{question_id}", response_model=QuestionnaireQuestionResponse
)
def update_question(
    template_id: int,
    question_id: int,
    req: QuestionnaireQuestionUpdate,
    current_user: Annotated[User, Depends(require_permission("questionnaire_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    q = db.query(QuestionnaireQuestion).filter(QuestionnaireQuestion.id == question_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="题目不存在")
    t = db.query(QuestionnaireTemplate).filter(QuestionnaireTemplate.id == q.template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="题目不存在")
    if req.content is not None:
        q.content = req.content
    if req.question_type is not None:
        q.question_type = req.question_type
    if req.required is not None:
        q.required = req.required
    if req.sort_order is not None:
        q.sort_order = req.sort_order
    if req.options is not None:
        q.options = req.options
    db.commit()
    db.refresh(q)
    return QuestionnaireQuestionResponse(
        id=q.id,
        template_id=q.template_id,
        content=q.content,
        question_type=q.question_type,
        required=q.required,
        sort_order=q.sort_order,
        options=q.options,
    )


@router.delete("/questionnaires/templates/{template_id}/questions/{question_id}", response_model=DeleteResponse)
def delete_question(
    template_id: int,
    question_id: int,
    current_user: Annotated[User, Depends(require_permission("questionnaire_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    q = db.query(QuestionnaireQuestion).filter(QuestionnaireQuestion.id == question_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="题目不存在")
    t = db.query(QuestionnaireTemplate).filter(QuestionnaireTemplate.id == q.template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="题目不存在")
    db.delete(q)
    db.commit()
    return {"ok": True}
