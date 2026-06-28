"""Questionnaire stats — thin router."""

from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends

from core.deps import DbSession
from core.security import require_permission
from infrastructure.exporter import ColumnDef, export_response
from models import User
from schemas import QuestionnaireStatsResponse
from services.questionnaire import QuestionnaireResponseService

router = APIRouter()

_Manager = Annotated[User, Depends(require_permission("questionnaire_manage"))]


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
