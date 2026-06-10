from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from core.database import get_db
from core.pagination import paginate
from core.security import get_current_user, require_permission
from middleware.dependencies import resolve_school_filter
from models import (
    CaseQuestionnaire,
    QuestionnaireAnswer,
    QuestionnaireQuestion,
    QuestionnaireResponse,
    QuestionnaireTemplate,
    TrainingRecord,
    User,
)
from schemas import (
    PaginatedResponse,
    QuestionnaireAnswerItem,
    QuestionnaireCheckResponse,
    QuestionnaireResponseItem,
    QuestionnaireSubmitRequest,
)

from .templates import _template_to_detail

router = APIRouter()


def _build_response_item(response: QuestionnaireResponse, db: Session, answers_map=None, questions_map=None) -> QuestionnaireResponseItem:
    if answers_map is not None:
        answers = answers_map.get(response.id, [])
    else:
        answers = db.query(QuestionnaireAnswer).filter(QuestionnaireAnswer.response_id == response.id).all()

    if questions_map is not None:
        q_map = questions_map.get(response.template_id, {})
    else:
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

    response_ids = [r.id for r in rows]
    template_ids = list(set(r.template_id for r in rows))

    all_answers = db.query(QuestionnaireAnswer).filter(
        QuestionnaireAnswer.response_id.in_(response_ids)
    ).all()
    answers_map = {}
    for a in all_answers:
        answers_map.setdefault(a.response_id, []).append(a)

    all_questions = db.query(QuestionnaireQuestion).filter(
        QuestionnaireQuestion.template_id.in_(template_ids)
    ).all()
    questions_map = {}
    for q in all_questions:
        questions_map.setdefault(q.template_id, {})[q.id] = q

    items = [_build_response_item(r, db, answers_map, questions_map) for r in rows]
    return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)


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

    response_ids = [r.id for r in rows]
    template_ids = list(set(r.template_id for r in rows))

    all_answers = db.query(QuestionnaireAnswer).filter(
        QuestionnaireAnswer.response_id.in_(response_ids)
    ).all()
    answers_map = {}
    for a in all_answers:
        answers_map.setdefault(a.response_id, []).append(a)

    all_questions = db.query(QuestionnaireQuestion).filter(
        QuestionnaireQuestion.template_id.in_(template_ids)
    ).all()
    questions_map = {}
    for q in all_questions:
        questions_map.setdefault(q.template_id, {})[q.id] = q

    items = [_build_response_item(r, db, answers_map, questions_map) for r in rows]
    return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)
