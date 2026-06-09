import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from core.database import get_db
from core.security import require_permission
from middleware.dependencies import resolve_school_filter
from models import (
    Case,
    CaseQuestionnaire,
    QuestionnaireQuestion,
    QuestionnaireTemplate,
    User,
)
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
from services.pagination import paginate

log = logging.getLogger(__name__)

router = APIRouter()


def _template_to_response(t: QuestionnaireTemplate) -> QuestionnaireTemplateResponse:
    return QuestionnaireTemplateResponse(
        id=t.id,
        title=t.title,
        type=t.type,
        description=t.description,
        is_active=t.is_active,
        question_count=len(t.questions) if t.questions else 0,
        response_count=0,
        school_id=t.school_id,
        created_at=t.created_at,
        updated_at=t.updated_at,
    )


def _template_to_detail(t: QuestionnaireTemplate) -> QuestionnaireTemplateDetailResponse:
    case_ids = [cq.case_id for cq in getattr(t, "case_links", [])]
    return QuestionnaireTemplateDetailResponse(
        id=t.id,
        title=t.title,
        type=t.type,
        description=t.description,
        is_active=t.is_active,
        question_count=len(t.questions) if t.questions else 0,
        response_count=getattr(t, "response_count", 0),
        school_id=t.school_id,
        created_at=t.created_at,
        updated_at=t.updated_at,
        questions=[
            QuestionnaireQuestionResponse(
                id=q.id,
                template_id=q.template_id,
                content=q.content,
                question_type=q.question_type,
                required=q.required,
                sort_order=q.sort_order,
                options=q.options,
            )
            for q in (t.questions or [])
        ],
        case_ids=case_ids,
    )


@router.get("/questionnaires/templates", response_model=PaginatedResponse[QuestionnaireTemplateResponse])
def list_templates(
    current_user: Annotated[User, Depends(require_permission("questionnaire_manage"))],
    db: Annotated[Session, Depends(get_db)],
    type: Annotated[str | None, Query()] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    school_id: Annotated[int | None, Query()] = None,
):
    effective_school = resolve_school_filter(current_user, school_id)
    query = db.query(QuestionnaireTemplate)
    if effective_school is not None:
        query = query.filter(QuestionnaireTemplate.school_id == effective_school)
    if type:
        query = query.filter(QuestionnaireTemplate.type == type)
    query = query.order_by(QuestionnaireTemplate.updated_at.desc())

    rows, total = paginate(query, offset, limit)
    items = [_template_to_response(r) for r in rows]
    return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)


@router.post("/questionnaires/templates", response_model=QuestionnaireTemplateDetailResponse)
def create_template(
    req: QuestionnaireTemplateCreate,
    current_user: Annotated[User, Depends(require_permission("questionnaire_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    t = QuestionnaireTemplate(
        title=req.title,
        type=req.type,
        description=req.description,
        is_active=req.is_active,
        school_id=current_user.school_id,
    )
    db.add(t)
    db.flush()

    for i, q in enumerate(req.questions):
        db.add(QuestionnaireQuestion(
            template_id=t.id,
            sort_order=q.sort_order if q.sort_order else i,
            content=q.content,
            question_type=q.question_type,
            required=q.required,
            options=q.options,
        ))

    db.commit()
    db.refresh(t)
    return _template_to_detail(t)


@router.get("/questionnaires/templates/{template_id}", response_model=QuestionnaireTemplateDetailResponse)
def get_template(
    template_id: int,
    current_user: Annotated[User, Depends(require_permission("questionnaire_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    t = db.query(QuestionnaireTemplate).filter(QuestionnaireTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="问卷模板不存在")
    cq_rows = db.query(CaseQuestionnaire).filter(CaseQuestionnaire.template_id == template_id).all()
    setattr(t, "case_links", cq_rows)
    return _template_to_detail(t)


@router.put("/questionnaires/templates/{template_id}", response_model=QuestionnaireTemplateDetailResponse)
def update_template(
    template_id: int,
    req: QuestionnaireTemplateUpdate,
    current_user: Annotated[User, Depends(require_permission("questionnaire_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    t = db.query(QuestionnaireTemplate).filter(QuestionnaireTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="问卷模板不存在")
    if req.title is not None:
        t.title = req.title
    if req.type is not None:
        t.type = req.type
    if req.description is not None:
        t.description = req.description
    if req.is_active is not None:
        t.is_active = req.is_active
    t.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(t)
    cq_rows = db.query(CaseQuestionnaire).filter(CaseQuestionnaire.template_id == template_id).all()
    setattr(t, "case_links", cq_rows)
    return _template_to_detail(t)


@router.delete("/questionnaires/templates/{template_id}", response_model=DeleteResponse)
def delete_template(
    template_id: int,
    current_user: Annotated[User, Depends(require_permission("questionnaire_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    t = db.query(QuestionnaireTemplate).filter(QuestionnaireTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="问卷模板不存在")
    db.delete(t)
    db.commit()
    return {"ok": True}


@router.put("/questionnaires/templates/{template_id}/case-assignments", response_model=OkResponse)
def assign_cases(
    template_id: int,
    req: CaseAssignmentRequest,
    current_user: Annotated[User, Depends(require_permission("questionnaire_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    t = db.query(QuestionnaireTemplate).filter(QuestionnaireTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="问卷模板不存在")

    db.query(CaseQuestionnaire).filter(CaseQuestionnaire.template_id == template_id).delete()

    for cid in req.case_ids:
        c = db.query(Case).filter(Case.id == cid).first()
        if not c:
            raise HTTPException(status_code=400, detail=f"病例 {cid} 不存在")
        db.add(CaseQuestionnaire(
            case_id=cid,
            template_id=template_id,
            is_required=req.is_required,
            trigger_event=req.trigger_event,
        ))

    db.commit()
    return {"ok": True}
