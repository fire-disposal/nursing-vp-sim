"""Questionnaire management — templates, questions, responses, stats."""

from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query

from core.deps import DbSession
from core.security import get_current_user, require_permission
from infrastructure.exporter import ColumnDef, export_response
from models import User
from schemas import (
    CaseAssignmentRequest,
    DeleteResponse,
    OkResponse,
    PaginatedResponse,
    QuestionnaireAnswerItem,
    QuestionnaireCheckResponse,
    QuestionnaireQuestionCreate,
    QuestionnaireQuestionResponse,
    QuestionnaireQuestionUpdate,
    QuestionnaireResponseItem,
    QuestionnaireStatsResponse,
    QuestionnaireSubmitRequest,
    QuestionnaireTemplateCreate,
    QuestionnaireTemplateDetailResponse,
    QuestionnaireTemplateResponse,
    QuestionnaireTemplateUpdate,
)
from services.questionnaire import (
    QuestionnaireQuestionService,
    QuestionnaireTemplateService,
    QuestionView,
    TemplateDetailView,
    TemplateView,
)
from services.questionnaire_response import QuestionnaireResponseService

router = APIRouter(prefix="/api", tags=["问卷"])
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


# ── Template CRUD ──


@router.get("/questionnaires/templates", response_model=PaginatedResponse[QuestionnaireTemplateResponse])
def list_templates(
    current_user: _Manager,
    db: DbSession,
    type: Annotated[str | None, Query()] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
):
    views, total = QuestionnaireTemplateService(db).list_all(type, offset, limit)
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


# ── Question CRUD (per template) ──


@router.post("/questionnaires/templates/{template_id}/questions", response_model=QuestionnaireQuestionResponse)
def add_question(
    template_id: int,
    req: QuestionnaireQuestionCreate,
    current_user: _Manager,
    db: DbSession,
):
    return _q_resp(
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
    return _q_resp(
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


# ── Response submit & list ──


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
    return export_response(responses, columns, filename=f"questionnaire_{template_id}_{safe_title}", format="csv")
