# ruff: noqa: UP035, UP006

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Any, List

from fastapi import Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.audit import (
    ACTION_QUESTIONNAIRE_TEMPLATE_CREATED,
    ACTION_QUESTIONNAIRE_TEMPLATE_DELETED,
    ACTION_QUESTIONNAIRE_TEMPLATE_UPDATED,
    TARGET_TYPE_QUESTIONNAIRE_TEMPLATE,
    record,
)
from core.exceptions import NotFoundError, ValidationError
from core.pagination import paginate
from core.statuses import QuestionnaireTrigger
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


def _questions_digest(questions: list[dict] | None) -> str | None:
    """题目集合的稳定指纹（sha256 前 12 位）。

    正文改了但条数不变时也必须能留一行审计，可 payload 又不允许落正文 —— 于是落指纹：
    键排序 + 类型归一化，并丢掉 `id` 这类纯身份字段，使「同一份内容」在任何一次 PUT 后
    得到同一个值（幂等反例才有判据）。
    """
    if questions is None:
        return None
    normalized = [
        {
            "content": str(q["content"]),
            "question_type": str(q["question_type"]),
            "required": bool(q.get("required", True)),
            "sort_order": int(q.get("sort_order", 0)),
            "options": [str(o) for o in q["options"]] if q.get("options") is not None else None,
        }
        for q in questions
    ]
    blob = json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:12]


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


@dataclass(slots=True)
class QuestionnaireTemplateFilters:
    """问卷模板列表的筛选（唯一事实来源）。

    以 `Depends()` 注入，端点不再自行声明筛选参数 —— 前端传的 search / is_active
    不会再是死控件（见审计 UI-CRD-2）。
    """

    type: Annotated[str | None, Query()] = None
    search: Annotated[str | None, Query(max_length=50, description="标题模糊搜索")] = None
    is_active: Annotated[bool | None, Query(description="启用状态筛选")] = None


class QuestionnaireTemplateService:
    def __init__(self, db: Session):
        self.db = db

    def _filtered_query(self, filters: QuestionnaireTemplateFilters):
        """模板列表查询的谓词（过滤表达式只此一处）。"""
        q = self.db.query(QuestionnaireTemplate)
        if filters.type:
            q = q.filter(QuestionnaireTemplate.type == filters.type)
        if filters.search:
            q = q.filter(QuestionnaireTemplate.title.ilike(f"%{filters.search}%"))
        if filters.is_active is not None:
            q = q.filter(QuestionnaireTemplate.is_active.is_(filters.is_active))
        return q

    def list_filtered(
        self, filters: QuestionnaireTemplateFilters, *, offset: int, limit: int
    ) -> tuple[list[QuestionnaireTemplate], int]:
        q = self._filtered_query(filters).order_by(QuestionnaireTemplate.updated_at.desc())
        return paginate(q, offset, limit)

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
        *,
        request: Request | None = None,
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
            # 题目正文不入 payload（量大），只记条数与指纹摘要
            record(
                self.db,
                action=ACTION_QUESTIONNAIRE_TEMPLATE_CREATED,
                target_type=TARGET_TYPE_QUESTIONNAIRE_TEMPLATE,
                target_id=t.id,
                target_label=title,
                request=request,
                payload={
                    "type": type_,
                    "description": description,
                    "is_active": is_active,
                    "questions_count": len(questions),
                    "questions_digest": self._stored_questions_digest(t.id),
                },
            )
        self.db.refresh(t)
        return _template_detail_view(t)

    def _question_count(self, template_id: int) -> int:
        return (
            self.db.query(func.count(QuestionnaireQuestion.id))
            .filter(QuestionnaireQuestion.template_id == template_id)
            .scalar()
        ) or 0

    def _stored_questions_digest(self, template_id: int) -> str | None:
        """按库内实况取题目指纹：before/after 两侧都从库里读，形态必然一致。"""
        rows = (
            self.db.query(QuestionnaireQuestion)
            .filter(QuestionnaireQuestion.template_id == template_id)
            .order_by(QuestionnaireQuestion.sort_order, QuestionnaireQuestion.id)
            .all()
        )
        return _questions_digest(
            [
                {
                    "content": q.content,
                    "question_type": q.question_type,
                    "required": q.required,
                    "sort_order": q.sort_order,
                    "options": q.options,
                }
                for q in rows
            ]
        )

    def update(
        self,
        template_id: int,
        title: str | None,
        type_: str | None,
        description: str | None,
        is_active: bool | None,
        questions: List[dict] | None,
        *,
        request: Request | None = None,
    ) -> TemplateDetailView:
        t = self.db.get(QuestionnaireTemplate, template_id)
        if t is None:
            raise NotFoundError("问卷模板不存在")

        changes: dict[str, dict[str, Any]] = {}
        before_q_count = self._question_count(template_id) if questions is not None else 0
        before_q_digest = self._stored_questions_digest(template_id) if questions is not None else None
        with unit_of_work(self.db, conflict_detail="更新问卷模板失败"):
            # before 在写之前读，after 取本次请求的目标值（不依赖 ORM 脏状态）
            for field, new_value in (
                ("title", title),
                ("type", type_),
                ("description", description),
                ("is_active", is_active),
            ):
                if new_value is None:
                    continue
                old_value = getattr(t, field)
                if old_value == new_value:
                    continue
                changes[field] = {"before": old_value, "after": new_value}
                setattr(t, field, new_value)

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
            self.db.flush()
            if questions is not None:
                # 题目正文不入 payload，只留条数与指纹摘要
                after_q_count = self._question_count(template_id)
                if after_q_count != before_q_count:
                    changes["questions_count"] = {"before": before_q_count, "after": after_q_count}
                after_q_digest = self._stored_questions_digest(template_id)
                if after_q_digest != before_q_digest:
                    changes["questions_digest"] = {"before": before_q_digest, "after": after_q_digest}
            if changes:
                record(
                    self.db,
                    action=ACTION_QUESTIONNAIRE_TEMPLATE_UPDATED,
                    target_type=TARGET_TYPE_QUESTIONNAIRE_TEMPLATE,
                    target_id=t.id,
                    target_label=t.title,
                    request=request,
                    payload=changes,
                )

        self.db.refresh(t)
        cq_rows = self.case_links_for(template_id)
        case_ids = [cq.case_id for cq in cq_rows]
        return _template_detail_view(t, case_ids=case_ids)

    def delete(self, template_id: int, *, request: Request | None = None) -> None:
        t = self.db.get(QuestionnaireTemplate, template_id)
        if t is None:
            raise NotFoundError("问卷模板不存在")
        title = t.title
        # 绑定行随模板 CASCADE 消失，故删除前先取实况
        bound_case_count = (
            self.db.query(func.count(CaseQuestionnaire.id))
            .filter(CaseQuestionnaire.template_id == template_id)
            .scalar()
        ) or 0
        q_count = self._question_count(template_id)
        q_digest = self._stored_questions_digest(template_id)
        with unit_of_work(self.db, conflict_detail="删除问卷模板失败"):
            record(
                self.db,
                action=ACTION_QUESTIONNAIRE_TEMPLATE_DELETED,
                target_type=TARGET_TYPE_QUESTIONNAIRE_TEMPLATE,
                target_id=template_id,
                target_label=title,
                request=request,
                payload={
                    "case_bound": bound_case_count > 0,
                    "bound_case_count": bound_case_count,
                    "questions_count": q_count,
                    "questions_digest": q_digest,
                },
            )
            self.db.delete(t)
            self.db.flush()

    def assign_cases(
        self,
        template_id: int,
        case_ids: List[int],
        is_required: bool,
        trigger_event: QuestionnaireTrigger,
        *,
        request: Request | None = None,
    ) -> None:
        t = self.db.get(QuestionnaireTemplate, template_id)
        if t is None:
            raise NotFoundError("问卷模板不存在")
        before = sorted(cq.case_id for cq in self.case_links_for(template_id))
        target = sorted(case_ids)
        with unit_of_work(self.db, conflict_detail="病例分配失败"):
            self.delete_case_links(template_id)
            for cid in target:
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
            self.db.flush()
            # 病例绑定决定"学生什么时候被要求答题" → 集合变化必须留痕（A5）
            if before != target:
                record(
                    self.db,
                    action=ACTION_QUESTIONNAIRE_TEMPLATE_UPDATED,
                    target_type=TARGET_TYPE_QUESTIONNAIRE_TEMPLATE,
                    target_id=template_id,
                    target_label=t.title,
                    request=request,
                    payload={"case_ids": {"before": before, "after": target}},
                )

    def list_all(
        self, filters: QuestionnaireTemplateFilters, *, offset: int, limit: int
    ) -> tuple[List[TemplateView], int]:
        rows, total = self.list_filtered(filters, offset=offset, limit=limit)
        template_ids = [r.id for r in rows]
        counts = self.response_counts(template_ids)
        views = [_template_view(r, counts.get(r.id, 0)) for r in rows]
        return views, total
