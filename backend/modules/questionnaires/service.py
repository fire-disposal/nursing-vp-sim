# ruff: noqa: UP035, UP006

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import List

from sqlalchemy import func
from sqlalchemy.orm import Session

from core.exceptions import NotFoundError, ValidationError
from core.pagination import paginate
from core.unit_of_work import unit_of_work
from models import (
    Case,
    CaseQuestionnaire,
    QuestionnaireAnswer,
    QuestionnaireQuestion,
    QuestionnaireResponse,
    QuestionnaireTemplate,
)
from schemas.questionnaire import (
    QuestionnaireQuestionResponse,
    QuestionnaireTemplateDetailResponse,
)


def template_to_detail(t: QuestionnaireTemplate | None) -> QuestionnaireTemplateDetailResponse | None:
    if t is None:
        return None
    return QuestionnaireTemplateDetailResponse(
        id=t.id,
        title=t.title,
        type=t.type,
        description=t.description,
        is_active=t.is_active,
        question_count=len(t.questions) if t.questions else 0,
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
        case_ids=[cq.case_id for cq in getattr(t, "case_links", [])],
    )


@dataclass
class QuestionView:
    id: int
    template_id: int
    content: str
    question_type: str
    required: bool
    sort_order: int
    options: list[str] | None


@dataclass
class TemplateView:
    id: int
    title: str
    type: str
    description: str | None
    is_active: bool
    question_count: int
    response_count: int
    created_at: datetime
    updated_at: datetime


@dataclass
class TemplateDetailView:
    id: int
    title: str
    type: str
    description: str | None
    is_active: bool
    question_count: int
    response_count: int
    created_at: datetime
    updated_at: datetime
    questions: list[QuestionView]
    case_ids: list[int]


def _question_view(q: QuestionnaireQuestion) -> QuestionView:
    return QuestionView(
        id=q.id,
        template_id=q.template_id,
        content=q.content,
        question_type=q.question_type,
        required=q.required,
        sort_order=q.sort_order,
        options=q.options,
    )


def _template_view(t: QuestionnaireTemplate, response_count: int = 0) -> TemplateView:
    return TemplateView(
        id=t.id,
        title=t.title,
        type=t.type,
        description=t.description,
        is_active=t.is_active,
        question_count=len(t.questions) if t.questions else 0,
        response_count=response_count,
        created_at=t.created_at,
        updated_at=t.updated_at,
    )


def _template_detail_view(
    t: QuestionnaireTemplate,
    response_count: int = 0,
    case_ids: list[int] | None = None,
) -> TemplateDetailView:
    questions = [_question_view(q) for q in (t.questions or [])]
    return TemplateDetailView(
        id=t.id,
        title=t.title,
        type=t.type,
        description=t.description,
        is_active=t.is_active,
        question_count=len(questions),
        response_count=response_count,
        created_at=t.created_at,
        updated_at=t.updated_at,
        questions=questions,
        case_ids=case_ids or [],
    )


class QuestionnaireTemplateService:
    def __init__(self, db: Session):
        self.db = db

    def _list_query(self, type_: str | None = None):
        q = self.db.query(QuestionnaireTemplate)
        if type_:
            q = q.filter(QuestionnaireTemplate.type == type_)
        return q.order_by(QuestionnaireTemplate.updated_at.desc())

    def list_filtered(self, type_: str | None, offset: int, limit: int) -> tuple[list[QuestionnaireTemplate], int]:
        return paginate(self._list_query(type_), offset, limit)

    def response_counts(self, template_ids: list[int]) -> dict[int, int]:
        if not template_ids:
            return {}
        rows = (
            self.db.query(QuestionnaireResponse.template_id, func.count(QuestionnaireResponse.id))
            .filter(
                QuestionnaireResponse.template_id.in_(template_ids),
                QuestionnaireResponse.status == "completed",
            )
            .group_by(QuestionnaireResponse.template_id)
            .all()
        )
        return {tid: cnt for tid, cnt in rows}

    def case_links_for(self, template_id: int) -> list[CaseQuestionnaire]:
        return self.db.query(CaseQuestionnaire).filter(CaseQuestionnaire.template_id == template_id).all()

    def delete_case_links(self, template_id: int) -> None:
        self.db.query(CaseQuestionnaire).filter(CaseQuestionnaire.template_id == template_id).delete(
            synchronize_session="fetch"
        )

    def case_exists(self, case_id: int) -> bool:
        q = self.db.query(Case).filter(Case.id == case_id)
        return bool(self.db.query(q.exists()).scalar())

    def get_detail(self, template_id: int) -> TemplateDetailView:
        t = self.db.get(QuestionnaireTemplate, template_id)
        if t is None:
            raise NotFoundError("问卷模板不存在")
        cq_rows = self.case_links_for(template_id)
        case_ids = [cq.case_id for cq in cq_rows]
        return _template_detail_view(t, case_ids=case_ids)

    def create(
        self,
        title: str,
        type_: str,
        description: str | None,
        is_active: bool,
        questions: List[dict],
    ) -> TemplateDetailView:
        with unit_of_work(self.db, conflict_detail="创建问卷模板失败"):
            t = QuestionnaireTemplate(
                title=title,
                type=type_,
                description=description,
                is_active=is_active,
            )
            self.db.add(t)
            self.db.flush()
            for i, q_data in enumerate(questions):
                self.db.add(
                    QuestionnaireQuestion(
                        template_id=t.id,
                        sort_order=q_data.get("sort_order", i),
                        content=q_data["content"],
                        question_type=q_data["question_type"],
                        required=q_data.get("required", True),
                        options=q_data.get("options"),
                    )
                )
        self.db.refresh(t)
        return _template_detail_view(t)

    def update(
        self,
        template_id: int,
        title: str | None,
        type_: str | None,
        description: str | None,
        is_active: bool | None,
        questions: List[dict] | None,
    ) -> TemplateDetailView:
        t = self.db.get(QuestionnaireTemplate, template_id)
        if t is None:
            raise NotFoundError("问卷模板不存在")

        with unit_of_work(self.db, conflict_detail="更新问卷模板失败"):
            if title is not None:
                t.title = title
            if type_ is not None:
                t.type = type_
            if description is not None:
                t.description = description
            if is_active is not None:
                t.is_active = is_active

            if questions is not None:
                existing = {q.id: q for q in (t.questions or [])}
                seen_ids: set[int] = set()
                for i, q_data in enumerate(questions):
                    q_id = q_data.get("id")
                    if q_id is not None and q_id in existing:
                        q = existing[q_id]
                        q.content = q_data["content"]
                        q.question_type = q_data["question_type"]
                        q.required = q_data.get("required", True)
                        q.sort_order = q_data.get("sort_order", i)
                        q.options = q_data.get("options")
                        seen_ids.add(q_id)
                    else:
                        self.db.add(
                            QuestionnaireQuestion(
                                template_id=t.id,
                                content=q_data["content"],
                                question_type=q_data["question_type"],
                                required=q_data.get("required", True),
                                sort_order=q_data.get("sort_order", i),
                                options=q_data.get("options"),
                            )
                        )
                for qid, q in existing.items():
                    if qid in seen_ids:
                        continue
                    answer_count = (
                        self.db.query(func.count(QuestionnaireAnswer.id))
                        .filter(QuestionnaireAnswer.question_id == qid)
                        .scalar()
                    ) or 0
                    if answer_count == 0:
                        self.db.delete(q)

            t.updated_at = datetime.now(UTC)

        self.db.refresh(t)
        cq_rows = self.case_links_for(template_id)
        case_ids = [cq.case_id for cq in cq_rows]
        return _template_detail_view(t, case_ids=case_ids)

    def delete(self, template_id: int) -> None:
        t = self.db.get(QuestionnaireTemplate, template_id)
        if t is None:
            raise NotFoundError("问卷模板不存在")
        with unit_of_work(self.db, conflict_detail="删除问卷模板失败"):
            self.db.delete(t)
            self.db.flush()

    def assign_cases(
        self,
        template_id: int,
        case_ids: List[int],
        is_required: bool,
        trigger_event: str,
    ) -> None:
        t = self.db.get(QuestionnaireTemplate, template_id)
        if t is None:
            raise NotFoundError("问卷模板不存在")
        with unit_of_work(self.db, conflict_detail="病例分配失败"):
            self.delete_case_links(template_id)
            for cid in case_ids:
                if not self.case_exists(cid):
                    raise ValidationError(f"病例 {cid} 不存在")
                self.db.add(
                    CaseQuestionnaire(
                        case_id=cid,
                        template_id=template_id,
                        is_required=is_required,
                        trigger_event=trigger_event,
                    )
                )

    def list_all(self, type_: str | None = None, offset: int = 0, limit: int = 20) -> tuple[List[TemplateView], int]:
        rows, total = self.list_filtered(type_, offset, limit)
        template_ids = [r.id for r in rows]
        counts = self.response_counts(template_ids)
        views = [_template_view(r, counts.get(r.id, 0)) for r in rows]
        return views, total


class QuestionnaireQuestionService:
    def __init__(self, db: Session):
        self.db = db

    def create(
        self,
        template_id: int,
        sort_order: int,
        content: str,
        question_type: str,
        required: bool,
        options: List[str] | None,
    ) -> QuestionView:
        t = self.db.get(QuestionnaireTemplate, template_id)
        if t is None:
            raise NotFoundError("问卷模板不存在")
        with unit_of_work(self.db, conflict_detail="添加题目失败"):
            q = QuestionnaireQuestion(
                template_id=template_id,
                sort_order=sort_order,
                content=content,
                question_type=question_type,
                required=required,
                options=options,
            )
            self.db.add(q)
            self.db.flush()
        self.db.refresh(q)
        return _question_view(q)

    def update(
        self,
        template_id: int,
        question_id: int,
        content: str | None,
        question_type: str | None,
        required: bool | None,
        sort_order: int | None,
        options: List[str] | None,
    ) -> QuestionView:
        q = self.db.get(QuestionnaireQuestion, question_id)
        if q is None:
            raise NotFoundError("题目不存在")
        t = self.db.get(QuestionnaireTemplate, q.template_id)
        if t is None:
            raise NotFoundError("问卷模板不存在")
        with unit_of_work(self.db, conflict_detail="更新题目失败"):
            if content is not None:
                q.content = content
            if question_type is not None:
                q.question_type = question_type
            if required is not None:
                q.required = required
            if sort_order is not None:
                q.sort_order = sort_order
            if options is not None:
                q.options = options
        self.db.refresh(q)
        return _question_view(q)

    def delete(self, template_id: int, question_id: int) -> None:
        q = self.db.get(QuestionnaireQuestion, question_id)
        if q is None:
            raise NotFoundError("题目不存在")
        t = self.db.get(QuestionnaireTemplate, q.template_id)
        if t is None:
            raise NotFoundError("问卷模板不存在")
        with unit_of_work(self.db, conflict_detail="删除题目失败"):
            self.db.delete(q)
            self.db.flush()
