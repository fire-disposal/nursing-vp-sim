"""Questionnaire management — templates, questions, responses, stats."""

from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Request

from core.deps import DbSession
from core.security import get_current_user, require_permission
from core.statuses import QuestionnaireTrigger
from infra.exporter import ColumnDef, ExportAudit, export_response
from models import User
from modules.questionnaires.response_service import QuestionnaireResponseService
from modules.questionnaires.service import QuestionnaireTemplateFilters, QuestionnaireTemplateService
from schemas import (
    CaseAssignmentRequest,
    DeleteResponse,
    OkResponse,
    PaginatedResponse,
    QuestionnaireCheckResponse,
    QuestionnaireResponseItem,
    QuestionnaireStatsResponse,
    QuestionnaireSubmitRequest,
    QuestionnaireTemplateCreate,
    QuestionnaireTemplateDetailResponse,
    QuestionnaireTemplateResponse,
    QuestionnaireTemplateUpdate,
)

router = APIRouter(prefix="/api", tags=["问卷"])
_Manager = Annotated[User, Depends(require_permission("questionnaire_manage"))]


# ── Template CRUD ──


@router.get("/questionnaires/templates", response_model=PaginatedResponse[QuestionnaireTemplateResponse])
def list_templates(
    current_user: _Manager,
    db: DbSession,
    filters: Annotated[QuestionnaireTemplateFilters, Depends()],
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 20,
):
    views, total = QuestionnaireTemplateService(db).list_all(filters, offset=offset, limit=limit)
    return PaginatedResponse(
        items=[QuestionnaireTemplateResponse.model_validate(v) for v in views],
        total=total,
        offset=offset,
        limit=limit,
    )


@router.post("/questionnaires/templates", response_model=QuestionnaireTemplateDetailResponse)
def create_template(
    req: QuestionnaireTemplateCreate,
    current_user: _Manager,
    db: DbSession,
):
    return QuestionnaireTemplateDetailResponse.model_validate(
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
    return QuestionnaireTemplateDetailResponse.model_validate(QuestionnaireTemplateService(db).get_detail(template_id))


@router.put("/questionnaires/templates/{template_id}", response_model=QuestionnaireTemplateDetailResponse)
def update_template(
    template_id: int,
    req: QuestionnaireTemplateUpdate,
    current_user: _Manager,
    db: DbSession,
):
    return QuestionnaireTemplateDetailResponse.model_validate(
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


# ── Response submit & list ──


@router.get("/questionnaires/check", response_model=QuestionnaireCheckResponse)
def check_questionnaire(
    current_user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
    case_id: Annotated[int | None, Query()] = None,
    record_id: Annotated[int | None, Query()] = None,
    trigger: Annotated[
        QuestionnaireTrigger | None,
        Query(description="触发时点: before_training / after_scoring"),
    ] = None,
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
    return QuestionnaireResponseItem.model_validate(
        QuestionnaireResponseService(db).submit(
            user_id=current_user.id,
            template_id=req.template_id,
            case_id=req.case_id,
            record_id=req.record_id,
            answers_data=[a.model_dump() for a in req.answers],
        )
    )


@router.get("/questionnaires/responses/{template_id}", response_model=PaginatedResponse[QuestionnaireResponseItem])
def list_responses(
    template_id: int,
    current_user: _Manager,
    db: DbSession,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 20,
):
    items, total = QuestionnaireResponseService(db).list_responses(
        template_id=template_id,
        offset=offset,
        limit=limit,
    )
    return PaginatedResponse(
        items=[QuestionnaireResponseItem.model_validate(v) for v in items],
        total=total,
        offset=offset,
        limit=limit,
    )


# ── Stats & Export ──


@router.get("/questionnaires/responses/{template_id}/stats", response_model=QuestionnaireStatsResponse)
def response_stats(
    template_id: int,
    current_user: _Manager,
    db: DbSession,
):
    return QuestionnaireResponseService(db).get_stats(template_id)


@router.post("/questionnaires/responses/{template_id}/export")
def export_responses(
    template_id: int,
    current_user: Annotated[User, Depends(require_permission("export_data"))],
    db: DbSession,
    request: Request,
):
    svc = QuestionnaireResponseService(db)
    t, responses, questions = svc.export_data(template_id)

    ans_map_cache: dict[int, dict[int, str]] = {}
    for r in responses:
        amap: dict[int, str] = {}
        for a in r.answers:
            amap[a.question_id] = a.answer_value or ""
        ans_map_cache[r.id] = amap

    columns = [
        ColumnDef(header="学生姓名", value=lambda r: r.user.display_name if r.user else ""),
        ColumnDef(header="学号", value=lambda r: r.user.student_id if r.user else ""),
        ColumnDef(header="提交时间", value=lambda r: r.completed_at.isoformat() if r.completed_at else ""),
    ]
    for q in questions:
        qid = q.id
        qcontent = q.content or ""
        columns.append(ColumnDef(header=qcontent, value=lambda r, qid=qid: ans_map_cache[r.id].get(qid, "")))

    safe_title = quote(t.title or f"问卷{template_id}")
    return export_response(
        responses,
        columns,
        filename=f"questionnaire_{template_id}_{safe_title}",
        format="csv",
        audit=ExportAudit(request=request, target_label=f"问卷答卷 #{template_id}"),
    )
