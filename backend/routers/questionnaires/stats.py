from collections import Counter
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from core.database import get_db
from core.security import require_permission
from infrastructure.export import Column, buffered_response
from models import (
    CaseQuestionnaire,
    QuestionnaireAnswer,
    QuestionnaireQuestion,
    QuestionnaireResponse,
    QuestionnaireTemplate,
    User,
)
from schemas import (
    QuestionnaireStatsResponse,
    QuestionStatsItem,
)

router = APIRouter()


@router.get("/questionnaires/responses/{template_id}/stats", response_model=QuestionnaireStatsResponse)
def response_stats(
    template_id: int,
    current_user: Annotated[User, Depends(require_permission("questionnaire_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    t = db.query(QuestionnaireTemplate).filter(QuestionnaireTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="问卷模板不存在")

    resp_query = db.query(QuestionnaireResponse).filter(
        QuestionnaireResponse.template_id == template_id,
        QuestionnaireResponse.status == "completed",
    )

    completed_responses = resp_query.all()
    total_completed = len(completed_responses)

    cq_count = db.query(CaseQuestionnaire).filter(CaseQuestionnaire.template_id == template_id).count()

    questions = (
        db.query(QuestionnaireQuestion)
        .filter(
            QuestionnaireQuestion.template_id == template_id,
        )
        .order_by(QuestionnaireQuestion.sort_order)
        .all()
    )

    question_ids = [qa.id for qa in questions]
    response_ids = [r.id for r in completed_responses]

    all_answers = (
        db.query(QuestionnaireAnswer.question_id, QuestionnaireAnswer.answer_value)
        .filter(
            QuestionnaireAnswer.question_id.in_(question_ids),
            QuestionnaireAnswer.response_id.in_(response_ids),
        )
        .all()
    )

    answers_by_question = {}
    for qid, val in all_answers:
        answers_by_question.setdefault(qid, []).append(val)

    q_stats = []
    for qa in questions:
        ans_values = answers_by_question.get(qa.id, [])
        vals = [v for v in ans_values if v is not None]
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


@router.post("/questionnaires/responses/{template_id}/export")
def export_responses(
    template_id: int,
    current_user: Annotated[User, Depends(require_permission("export_data"))],
    db: Annotated[Session, Depends(get_db)],
):
    t = db.query(QuestionnaireTemplate).filter(QuestionnaireTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="问卷模板不存在")

    resp_query = (
        db.query(QuestionnaireResponse)
        .options(
            joinedload(QuestionnaireResponse.user),
            joinedload(QuestionnaireResponse.answers).joinedload(QuestionnaireAnswer.question),
        )
        .filter(QuestionnaireResponse.template_id == template_id, QuestionnaireResponse.status == "completed")
    )
    resp_query = resp_query.order_by(QuestionnaireResponse.completed_at.desc())

    responses = resp_query.all()
    questions = (
        db.query(QuestionnaireQuestion)
        .filter(QuestionnaireQuestion.template_id == template_id)
        .order_by(QuestionnaireQuestion.sort_order)
        .all()
    )

    ans_map_cache: dict[int, dict[int, str]] = {}
    for r in responses:
        amap: dict[int, str] = {}
        for a in r.answers:
            amap[a.question_id] = a.answer_value or ""
        ans_map_cache[r.id] = amap

    columns = [
        Column("学生姓名", lambda r: r.user.display_name if r.user else ""),
        Column("学号", lambda r: r.user.student_id if r.user else ""),
        Column("提交时间", lambda r: r.completed_at.isoformat() if r.completed_at else ""),
    ]
    for q in questions:
        qid = q.id
        qcontent = q.content or ""
        columns.append(Column(qcontent, lambda r, qid=qid: ans_map_cache[r.id].get(qid, "")))

    safe_title = quote(t.title or f"问卷{template_id}")
    return buffered_response(responses, columns, f"questionnaire_{template_id}_{safe_title}.csv")
