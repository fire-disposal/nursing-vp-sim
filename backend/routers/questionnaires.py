import csv
import io
from collections import Counter, defaultdict
from datetime import UTC, datetime
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload

from core.database import get_db
from core.security import get_current_user, require_permission
from middleware.dependencies import resolve_school_filter
from models import (
    Case,
    CaseQuestionnaire,
    QuestionnaireAnswer,
    QuestionnaireQuestion,
    QuestionnaireResponse,
    QuestionnaireTemplate,
    TrainingRecord,
    User,
)
from schemas import (
    CaseAssignmentRequest,
    OkResponse,
    PaginatedResponse,
    QuestionnaireAnswerItem,
    QuestionnaireAnswerSubmit,
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
    QuestionStatsItem,
)
from services.pagination import paginate

router = APIRouter(prefix="/api", tags=["问卷"])


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


# ── Teacher/Admin: Template CRUD ──

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


@router.delete("/questionnaires/templates/{template_id}", response_model=OkResponse)
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


# ── Teacher/Admin: Question management within a template ──

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


@router.put("/questionnaires/questions/{question_id}", response_model=QuestionnaireQuestionResponse)
def update_question(
    question_id: int,
    req: QuestionnaireQuestionUpdate,
    current_user: Annotated[User, Depends(require_permission("questionnaire_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    q = db.query(QuestionnaireQuestion).filter(QuestionnaireQuestion.id == question_id).first()
    if not q:
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


@router.delete("/questionnaires/questions/{question_id}", response_model=OkResponse)
def delete_question(
    question_id: int,
    current_user: Annotated[User, Depends(require_permission("questionnaire_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    q = db.query(QuestionnaireQuestion).filter(QuestionnaireQuestion.id == question_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="题目不存在")
    db.delete(q)
    db.commit()
    return {"ok": True}


# ── Teacher/Admin: Case assignment ──

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


# ── Student: Check & Submit ──

@router.get("/questionnaires/check", response_model=QuestionnaireCheckResponse)
def check_questionnaire(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    case_id: Annotated[int | None, Query()] = None,
    record_id: Annotated[int | None, Query()] = None,
    trigger: Annotated[str | None, Query(description="触发事件: before_training / after_scoring / manual")] = None,
):
    if not case_id and not record_id:
        raise HTTPException(status_code=400, detail="请提供 case_id 或 record_id")

    if record_id:
        record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id, TrainingRecord.user_id == current_user.id).first()
        if not record:
            raise HTTPException(status_code=404, detail="训练记录不存在")
        case_id = record.case_id

    cq = (
        db.query(CaseQuestionnaire)
        .join(QuestionnaireTemplate, CaseQuestionnaire.template_id == QuestionnaireTemplate.id)
        .filter(
            CaseQuestionnaire.case_id == case_id,
            QuestionnaireTemplate.is_active == True,
        )
    )
    if trigger:
        cq = cq.filter(CaseQuestionnaire.trigger_event == trigger)
    cq = cq.order_by(CaseQuestionnaire.id).first()

    if not cq:
        return QuestionnaireCheckResponse(has_pending=False)

    existing = (
        db.query(QuestionnaireResponse)
        .filter(
            QuestionnaireResponse.user_id == current_user.id,
            QuestionnaireResponse.template_id == cq.template_id,
            QuestionnaireResponse.case_id == case_id,
            QuestionnaireResponse.status == "completed",
        )
        .first()
    )
    if existing:
        return QuestionnaireCheckResponse(has_pending=False)

    partial = (
        db.query(QuestionnaireResponse)
        .filter(
            QuestionnaireResponse.user_id == current_user.id,
            QuestionnaireResponse.template_id == cq.template_id,
            QuestionnaireResponse.case_id == case_id,
            QuestionnaireResponse.status == "pending",
        )
        .first()
    )

    t = db.query(QuestionnaireTemplate).filter(QuestionnaireTemplate.id == cq.template_id).first()

    return QuestionnaireCheckResponse(
        has_pending=True,
        template_id=cq.template_id,
        response_id=partial.id if partial else None,
        template=_template_to_detail(t) if t else None,
        is_required=cq.is_required,
        trigger_event=cq.trigger_event or "before_training",
    )


@router.post("/questionnaires/responses", response_model=QuestionnaireResponseItem)
def submit_questionnaire(
    req: QuestionnaireSubmitRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    t = db.query(QuestionnaireTemplate).filter(QuestionnaireTemplate.id == req.template_id).first()
    if not t or not t.is_active:
        raise HTTPException(status_code=404, detail="问卷模板不存在或已停用")

    response = (
        db.query(QuestionnaireResponse)
        .filter(
            QuestionnaireResponse.user_id == current_user.id,
            QuestionnaireResponse.template_id == req.template_id,
            QuestionnaireResponse.case_id == req.case_id,
            QuestionnaireResponse.status == "pending",
        )
        .first()
    )

    if response:
        db.query(QuestionnaireAnswer).filter(QuestionnaireAnswer.response_id == response.id).delete()
    else:
        response = QuestionnaireResponse(
            template_id=req.template_id,
            user_id=current_user.id,
            case_id=req.case_id,
            record_id=req.record_id,
            status="pending",
        )
        db.add(response)
        db.flush()

    for ans in req.answers:
        db.add(QuestionnaireAnswer(
            response_id=response.id,
            question_id=ans.question_id,
            answer_value=ans.answer_value,
        ))

    response.status = "completed"
    response.completed_at = datetime.now(UTC)
    db.commit()
    db.refresh(response)

    return _build_response_item(response, db)


def _build_response_item(response: QuestionnaireResponse, db: Session) -> QuestionnaireResponseItem:
    answers = db.query(QuestionnaireAnswer).filter(QuestionnaireAnswer.response_id == response.id).all()
    q_map = {
        q.id: q
        for q in db.query(QuestionnaireQuestion)
        .filter(QuestionnaireQuestion.template_id == response.template_id)
        .all()
    }
    return QuestionnaireResponseItem(
        id=response.id,
        template_id=response.template_id,
        template_title=response.template.title if response.template else "",
        user_id=response.user_id,
        user_name=response.user.display_name if response.user else "",
        case_id=response.case_id,
        record_id=response.record_id,
        status=response.status,
        answers=[
            QuestionnaireAnswerItem(
                question_id=a.question_id,
                question_content=q_map[a.question_id].content if a.question_id in q_map else "",
                question_type=q_map[a.question_id].question_type if a.question_id in q_map else "",
                options=q_map[a.question_id].options if a.question_id in q_map else None,
                answer_value=a.answer_value,
            )
            for a in answers
        ],
        completed_at=response.completed_at,
        created_at=response.created_at,
    )


# ── Student: My responses ──

@router.get("/questionnaires/my-responses", response_model=PaginatedResponse[QuestionnaireResponseItem])
def my_responses(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
):
    query = (
        db.query(QuestionnaireResponse)
        .filter(QuestionnaireResponse.user_id == current_user.id)
        .order_by(QuestionnaireResponse.created_at.desc())
    )
    rows, total = paginate(query, offset, limit)
    items = [_build_response_item(r, db) for r in rows]
    return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)


# ── Teacher/Admin: View responses ──

@router.get("/questionnaires/responses/{template_id}", response_model=PaginatedResponse[QuestionnaireResponseItem])
def list_responses(
    template_id: int,
    current_user: Annotated[User, Depends(require_permission("questionnaire_manage"))],
    db: Annotated[Session, Depends(get_db)],
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    school_id: Annotated[int | None, Query()] = None,
):
    effective_school = resolve_school_filter(current_user, school_id)
    query = (
        db.query(QuestionnaireResponse)
        .options(joinedload(QuestionnaireResponse.template), joinedload(QuestionnaireResponse.user))
        .filter(QuestionnaireResponse.template_id == template_id, QuestionnaireResponse.status == "completed")
    )
    if effective_school is not None:
        query = query.join(User, QuestionnaireResponse.user_id == User.id).filter(User.school_id == effective_school)
    query = query.order_by(QuestionnaireResponse.created_at.desc())

    rows, total = paginate(query, offset, limit)
    items = [_build_response_item(r, db) for r in rows]
    return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)


# ── Teacher/Admin: Stats ──

@router.get("/questionnaires/responses/{template_id}/stats", response_model=QuestionnaireStatsResponse)
def response_stats(
    template_id: int,
    current_user: Annotated[User, Depends(require_permission("questionnaire_manage"))],
    db: Annotated[Session, Depends(get_db)],
    school_id: Annotated[int | None, Query()] = None,
):
    t = db.query(QuestionnaireTemplate).filter(QuestionnaireTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="问卷模板不存在")

    effective_school = resolve_school_filter(current_user, school_id)
    resp_query = db.query(QuestionnaireResponse).filter(
        QuestionnaireResponse.template_id == template_id,
        QuestionnaireResponse.status == "completed",
    )
    if effective_school is not None:
        resp_query = resp_query.join(User, QuestionnaireResponse.user_id == User.id).filter(User.school_id == effective_school)

    completed_responses = resp_query.all()
    total_completed = len(completed_responses)

    cq_count = db.query(CaseQuestionnaire).filter(CaseQuestionnaire.template_id == template_id).count()

    questions = db.query(QuestionnaireQuestion).filter(
        QuestionnaireQuestion.template_id == template_id,
    ).order_by(QuestionnaireQuestion.sort_order).all()

    q_stats = []
    for qa in questions:
        ans_values = (
            db.query(QuestionnaireAnswer.answer_value)
            .filter(
                QuestionnaireAnswer.question_id == qa.id,
                QuestionnaireAnswer.response_id.in_([r.id for r in completed_responses]),
            )
            .all()
        )
        vals = [a.answer_value for a in ans_values if a.answer_value is not None]
        item = QuestionStatsItem(
            question_id=qa.id,
            content=qa.content,
            question_type=qa.question_type,
            response_count=len(vals),
        )

        if qa.question_type == "likert_5" and vals:
            numeric = []
            for v in vals:
                try:
                    numeric.append(float(v))
                except (ValueError, TypeError):
                    pass
            if numeric:
                item.avg_likert = sum(numeric) / len(numeric)
        elif qa.question_type == "multiple_choice":
            item.choice_distribution = dict(Counter(vals))
        elif qa.question_type == "short_text":
            item.text_answers = vals

        q_stats.append(item)

    return QuestionnaireStatsResponse(
        template_id=template_id,
        template_title=t.title,
        total_assigned=cq_count,
        total_completed=total_completed,
        completion_rate=(total_completed / cq_count * 100) if cq_count > 0 else 0.0,
        questions=q_stats,
    )


# ── Teacher/Admin: Export CSV ──

@router.get("/questionnaires/responses/{template_id}/export")
def export_responses(
    template_id: int,
    current_user: Annotated[User, Depends(require_permission("export_data"))],
    db: Annotated[Session, Depends(get_db)],
    school_id: Annotated[int | None, Query()] = None,
):
    t = db.query(QuestionnaireTemplate).filter(QuestionnaireTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="问卷模板不存在")

    effective_school = resolve_school_filter(current_user, school_id)
    resp_query = (
        db.query(QuestionnaireResponse)
        .options(joinedload(QuestionnaireResponse.user))
        .filter(QuestionnaireResponse.template_id == template_id, QuestionnaireResponse.status == "completed")
    )
    if effective_school is not None:
        resp_query = resp_query.join(User, QuestionnaireResponse.user_id == User.id).filter(User.school_id == effective_school)
    resp_query = resp_query.order_by(QuestionnaireResponse.created_at)

    responses = resp_query.all()
    questions = (
        db.query(QuestionnaireQuestion)
        .filter(QuestionnaireQuestion.template_id == template_id)
        .order_by(QuestionnaireQuestion.sort_order)
        .all()
    )

    output = io.StringIO()
    writer = csv.writer(output)
    header = ["学生姓名", "学号", "提交时间"]
    for q in questions:
        header.append(q.content)
    writer.writerow(header)

    for r in responses:
        ans_map = {}
        for ans in r.answers:
            ans_map[ans.question_id] = ans.answer_value or ""
        row = [
            r.user.display_name if r.user else "",
            r.user.student_id if r.user and r.user.student_id else "",
            r.completed_at.isoformat() if r.completed_at else "",
        ]
        for q in questions:
            row.append(ans_map.get(q.id, ""))
        writer.writerow(row)

    output.seek(0)
    filename = f"questionnaire_{template_id}_{t.title}.csv"
    encoded_filename = quote(filename.encode("utf-8"))
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"},
    )
