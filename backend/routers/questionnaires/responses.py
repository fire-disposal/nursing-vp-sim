from typing import Annotated

from fastapi import APIRouter, Depends, Query

from core.deps import DbSession
from core.security import get_current_user, require_permission
from models import User
from schemas import (
    PaginatedResponse,
    QuestionnaireAnswerItem,
    QuestionnaireCheckResponse,
    QuestionnaireResponseItem,
    QuestionnaireSubmitRequest,
)
from services.questionnaire import QuestionnaireResponseService

router = APIRouter()

_Manager = Annotated[User, Depends(require_permission("questionnaire_manage"))]


def _answer_resp(v) -> QuestionnaireAnswerItem:
    return QuestionnaireAnswerItem(
        question_id=v.question_id,
        question_content=v.question_content,
        question_type=v.question_type,
        options=v.options,
        answer_value=v.answer_value,
    )


def _resp_item(v) -> QuestionnaireResponseItem:
    return QuestionnaireResponseItem(
        id=v.id,
        template_id=v.template_id,
        template_title=v.template_title,
        user_id=v.user_id,
        user_name=v.user_name,
        case_id=v.case_id,
        record_id=v.record_id,
        status=v.status,
        answers=[_answer_resp(a) for a in v.answers],
        completed_at=v.completed_at,
        created_at=v.created_at,
    )


@router.get("/questionnaires/check", response_model=QuestionnaireCheckResponse)
def check_questionnaire(
    current_user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
    case_id: Annotated[int | None, Query()] = None,
    record_id: Annotated[int | None, Query()] = None,
    trigger: Annotated[str | None, Query(description="触发事件: before_training / after_scoring / manual")] = None,
):
    return QuestionnaireResponseService(db).check(
        user_id=current_user.id,
        case_id=case_id,
        record_id=record_id,
        trigger=trigger,
    )


@router.post("/questionnaires/responses", response_model=QuestionnaireResponseItem)
def submit_questionnaire(
    req: QuestionnaireSubmitRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
):
    return _resp_item(
        QuestionnaireResponseService(db).submit(
            user_id=current_user.id,
            template_id=req.template_id,
            case_id=req.case_id,
            record_id=req.record_id,
            answers_data=[a.model_dump() for a in req.answers],
        )
    )


@router.get("/questionnaires/my-responses", response_model=PaginatedResponse[QuestionnaireResponseItem])
def my_responses(
    current_user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
):
    items, total = QuestionnaireResponseService(db).list_my_responses(
        user_id=current_user.id,
        offset=offset,
        limit=limit,
    )
    return PaginatedResponse(items=[_resp_item(v) for v in items], total=total, offset=offset, limit=limit)


@router.get("/questionnaires/responses/{template_id}", response_model=PaginatedResponse[QuestionnaireResponseItem])
def list_responses(
    template_id: int,
    current_user: _Manager,
    db: DbSession,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
):
    items, total = QuestionnaireResponseService(db).list_responses(
        template_id=template_id,
        offset=offset,
        limit=limit,
    )
    return PaginatedResponse(items=[_resp_item(v) for v in items], total=total, offset=offset, limit=limit)
