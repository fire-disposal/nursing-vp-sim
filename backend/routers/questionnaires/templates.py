from typing import Annotated

from fastapi import APIRouter, Depends, Query

from core.deps import DbSession
from core.security import require_permission
from models import User
from schemas import (
    CaseAssignmentRequest,
    DeleteResponse,
    OkResponse,
    PaginatedResponse,
    QuestionnaireQuestionResponse,
    QuestionnaireTemplateCreate,
    QuestionnaireTemplateDetailResponse,
    QuestionnaireTemplateResponse,
    QuestionnaireTemplateUpdate,
)
from services.questionnaire import (
    QuestionnaireTemplateService,
    QuestionView,
    TemplateDetailView,
    TemplateView,
    _template_to_detail,
)

router = APIRouter()

_Manager = Annotated[User, Depends(require_permission("questionnaire_manage"))]


def _q_resp(view: QuestionView) -> QuestionnaireQuestionResponse:
    return QuestionnaireQuestionResponse(
        id=view.id,
        template_id=view.template_id,
        content=view.content,
        question_type=view.question_type,
        required=view.required,
        sort_order=view.sort_order,
        options=view.options,
    )


def _resp(view: TemplateView) -> QuestionnaireTemplateResponse:
    return QuestionnaireTemplateResponse(
        id=view.id,
        title=view.title,
        type=view.type,
        description=view.description,
        is_active=view.is_active,
        question_count=view.question_count,
        response_count=view.response_count,
        created_at=view.created_at,
        updated_at=view.updated_at,
    )


def _resp_detail(view: TemplateDetailView) -> QuestionnaireTemplateDetailResponse:
    return QuestionnaireTemplateDetailResponse(
        id=view.id,
        title=view.title,
        type=view.type,
        description=view.description,
        is_active=view.is_active,
        question_count=view.question_count,
        response_count=view.response_count,
        created_at=view.created_at,
        updated_at=view.updated_at,
        questions=[_q_resp(q) for q in view.questions],
        case_ids=view.case_ids,
    )


@router.get("/questionnaires/templates", response_model=PaginatedResponse[QuestionnaireTemplateResponse])
def list_templates(
    current_user: _Manager,
    db: DbSession,
    type: Annotated[str | None, Query()] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
):
    views, total = QuestionnaireTemplateService(db).list(type, offset, limit)
    return PaginatedResponse(items=[_resp(v) for v in views], total=total, offset=offset, limit=limit)


@router.post("/questionnaires/templates", response_model=QuestionnaireTemplateDetailResponse)
def create_template(
    req: QuestionnaireTemplateCreate,
    current_user: _Manager,
    db: DbSession,
):
    return _resp_detail(
        QuestionnaireTemplateService(db).create(
            title=req.title,
            type_=req.type,
            description=req.description,
            is_active=req.is_active,
            questions=[q.model_dump() for q in req.questions],
        )
    )


@router.get("/questionnaires/templates/{template_id}", response_model=QuestionnaireTemplateDetailResponse)
def get_template(
    template_id: int,
    current_user: _Manager,
    db: DbSession,
):
    return _resp_detail(QuestionnaireTemplateService(db).get_detail(template_id))


@router.put("/questionnaires/templates/{template_id}", response_model=QuestionnaireTemplateDetailResponse)
def update_template(
    template_id: int,
    req: QuestionnaireTemplateUpdate,
    current_user: _Manager,
    db: DbSession,
):
    return _resp_detail(
        QuestionnaireTemplateService(db).update(
            template_id=template_id,
            title=req.title,
            type_=req.type,
            description=req.description,
            is_active=req.is_active,
            questions=[q.model_dump() for q in req.questions] if req.questions is not None else None,
        )
    )


@router.delete("/questionnaires/templates/{template_id}", response_model=DeleteResponse)
def delete_template(
    template_id: int,
    current_user: _Manager,
    db: DbSession,
):
    QuestionnaireTemplateService(db).delete(template_id)
    return {"ok": True}


@router.put("/questionnaires/templates/{template_id}/case-assignments", response_model=OkResponse)
def assign_cases(
    template_id: int,
    req: CaseAssignmentRequest,
    current_user: _Manager,
    db: DbSession,
):
    QuestionnaireTemplateService(db).assign_cases(
        template_id=template_id,
        case_ids=req.case_ids,
        is_required=req.is_required,
        trigger_event=req.trigger_event,
    )
    return {"ok": True}
