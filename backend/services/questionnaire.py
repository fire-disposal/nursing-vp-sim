# ruff: noqa: UP035, UP006

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import List

from sqlalchemy.orm import Session

from core.exceptions import ValidationError
from core.unit_of_work import unit_of_work
from models import CaseQuestionnaire, QuestionnaireQuestion, QuestionnaireTemplate
from repositories.questionnaire import QuestionnaireQuestionRepository, QuestionnaireTemplateRepository


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
        self.repo = QuestionnaireTemplateRepository(db)

    def get_detail(self, template_id: int) -> TemplateDetailView:
        t = self.repo.get_or_404(template_id, "问卷模板不存在")
        cq_rows = self.repo.case_links_for(template_id)
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
            t = self.repo.add(
                QuestionnaireTemplate(
                    title=title,
                    type=type_,
                    description=description,
                    is_active=is_active,
                )
            )
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
        t = self.repo.get_or_404(template_id, "问卷模板不存在")
        q_repo = QuestionnaireQuestionRepository(self.db)

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
                    if q_repo.answer_count_for(qid) == 0:
                        self.db.delete(q)

            t.updated_at = datetime.now(UTC)
            self.db.flush()

        self.db.refresh(t)
        cq_rows = self.repo.case_links_for(template_id)
        case_ids = [cq.case_id for cq in cq_rows]
        return _template_detail_view(t, case_ids=case_ids)

    def delete(self, template_id: int) -> None:
        t = self.repo.get_or_404(template_id, "问卷模板不存在")
        with unit_of_work(self.db, conflict_detail="删除问卷模板失败"):
            self.repo.delete(t)

    def assign_cases(
        self,
        template_id: int,
        case_ids: List[int],
        is_required: bool,
        trigger_event: str,
    ) -> None:
        self.repo.get_or_404(template_id, "问卷模板不存在")
        with unit_of_work(self.db, conflict_detail="病例分配失败"):
            self.repo.delete_case_links(template_id)
            for cid in case_ids:
                if not self.repo.case_exists(cid):
                    raise ValidationError(f"病例 {cid} 不存在")
                self.db.add(
                    CaseQuestionnaire(
                        case_id=cid,
                        template_id=template_id,
                        is_required=is_required,
                        trigger_event=trigger_event,
                    )
                )

    def list(self, type_: str | None = None, offset: int = 0, limit: int = 20) -> tuple[List[TemplateView], int]:
        rows, total = self.repo.list_filtered(type_, offset, limit)
        template_ids = [r.id for r in rows]
        counts = self.repo.response_counts(template_ids)
        views = [_template_view(r, counts.get(r.id, 0)) for r in rows]
        return views, total


class QuestionnaireQuestionService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = QuestionnaireTemplateRepository(db)
        self.q_repo = QuestionnaireQuestionRepository(db)

    def create(
        self,
        template_id: int,
        sort_order: int,
        content: str,
        question_type: str,
        required: bool,
        options: List[str] | None,
    ) -> QuestionView:
        self.repo.get_or_404(template_id, "问卷模板不存在")
        with unit_of_work(self.db, conflict_detail="添加题目失败"):
            q = self.q_repo.add(
                QuestionnaireQuestion(
                    template_id=template_id,
                    sort_order=sort_order,
                    content=content,
                    question_type=question_type,
                    required=required,
                    options=options,
                )
            )
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
        q = self.q_repo.get_or_404(question_id, "题目不存在")
        self.repo.get_or_404(q.template_id, "问卷模板不存在")
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
            self.db.flush()
        self.db.refresh(q)
        return _question_view(q)

    def delete(self, template_id: int, question_id: int) -> None:
        q = self.q_repo.get_or_404(question_id, "题目不存在")
        self.repo.get_or_404(q.template_id, "问卷模板不存在")
        with unit_of_work(self.db, conflict_detail="删除题目失败"):
            self.q_repo.delete(q)
