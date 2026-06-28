# Questionnaire Response Service 改造计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 将 `routers/questionnaires/responses.py` 从 258 行内联 fat router 改造为 thin router → service → repository 模式，对齐已有 `templates.py` 架构。

**Architecture:** questionnaire 域已有 `QuestionnaireTemplateService`/`QuestionnaireQuestionService` + `QuestionnaireTemplateRepository`/`QuestionnaireQuestionRepository` + thin router 模式。改造新增 `QuestionnaireResponseService` + `QuestionnaireResponseRepository`，保持同域内一致。

**Tech Stack:** FastAPI, SQLAlchemy, Repository[T] 基类, unit_of_work 事务管理

---

### Task 1: 新增 QuestionnaireResponseRepository

**Files:**
- Modify: `backend/repositories/questionnaire.py`

在文件末尾新增 `QuestionnaireResponseRepository`：

```python
class QuestionnaireResponseRepository(Repository[QuestionnaireResponse]):
    model = QuestionnaireResponse

    def find_pending(self, user_id: int, template_id: int, case_id: int) -> QuestionnaireResponse | None:
        return (
            self.db.query(QuestionnaireResponse)
            .filter(
                QuestionnaireResponse.user_id == user_id,
                QuestionnaireResponse.template_id == template_id,
                QuestionnaireResponse.case_id == case_id,
                QuestionnaireResponse.status == "pending",
            )
            .first()
        )

    def find_completed(self, user_id: int, template_id: int, case_id: int) -> QuestionnaireResponse | None:
        return (
            self.db.query(QuestionnaireResponse)
            .filter(
                QuestionnaireResponse.user_id == user_id,
                QuestionnaireResponse.template_id == template_id,
                QuestionnaireResponse.case_id == case_id,
                QuestionnaireResponse.status == "completed",
            )
            .first()
        )

    def list_by_user(self, user_id: int, offset: int, limit: int) -> tuple[list[QuestionnaireResponse], int]:
        q = (
            self.db.query(QuestionnaireResponse)
            .options(joinedload(QuestionnaireResponse.template))
            .filter(QuestionnaireResponse.user_id == user_id)
            .order_by(QuestionnaireResponse.created_at.desc())
        )
        return paginate(q, offset, limit)

    def list_by_template(self, template_id: int, offset: int, limit: int) -> tuple[list[QuestionnaireResponse], int]:
        q = (
            self.db.query(QuestionnaireResponse)
            .options(joinedload(QuestionnaireResponse.template), joinedload(QuestionnaireResponse.user))
            .filter(QuestionnaireResponse.template_id == template_id, QuestionnaireResponse.status == "completed")
            .order_by(QuestionnaireResponse.created_at.desc())
        )
        return paginate(q, offset, limit)

    def delete_answers(self, response_id: int) -> None:
        self.db.query(QuestionnaireAnswer).filter(QuestionnaireAnswer.response_id == response_id).delete()

    def load_answers(self, response_ids: list[int]) -> dict[int, list[QuestionnaireAnswer]]:
        rows = self.db.query(QuestionnaireAnswer).filter(QuestionnaireAnswer.response_id.in_(response_ids)).all()
        m: dict[int, list[QuestionnaireAnswer]] = {}
        for a in rows:
            m.setdefault(a.response_id, []).append(a)
        return m

    def load_questions(self, template_ids: list[int]) -> dict[int, dict[int, QuestionnaireQuestion]]:
        rows = self.db.query(QuestionnaireQuestion).filter(QuestionnaireQuestion.template_id.in_(template_ids)).all()
        m: dict[int, dict[int, QuestionnaireQuestion]] = {}
        for q in rows:
            m.setdefault(q.template_id, {})[q.id] = q
        return m

    def case_questionnaires_for(self, case_id: int, trigger: str | None = None) -> list[CaseQuestionnaire]:
        q = (
            self.db.query(CaseQuestionnaire)
            .join(QuestionnaireTemplate, CaseQuestionnaire.template_id == QuestionnaireTemplate.id)
            .filter(
                CaseQuestionnaire.case_id == case_id,
                QuestionnaireTemplate.is_active == True,
            )
        )
        if trigger:
            q = q.filter(CaseQuestionnaire.trigger_event == trigger)
        return q.order_by(CaseQuestionnaire.id).all()

    def get_template(self, template_id: int) -> QuestionnaireTemplate | None:
        return self.db.query(QuestionnaireTemplate).filter(QuestionnaireTemplate.id == template_id).first()

    def get_user(self, user_id: int) -> User | None:
        return self.db.query(User).filter(User.id == user_id).first()

    def get_training_record(self, record_id: int, user_id: int) -> TrainingRecord | None:
        return (
            self.db.query(TrainingRecord)
            .filter(TrainingRecord.id == record_id, TrainingRecord.user_id == user_id)
            .first()
        )
```

新增 import：

```python
from sqlalchemy.orm import joinedload

from models import (  # add: TrainingRecord, User
    Case,
    CaseQuestionnaire,
    QuestionnaireAnswer,
    QuestionnaireQuestion,
    QuestionnaireResponse,
    QuestionnaireTemplate,
    TrainingRecord,
    User,
)
```

- [ ] **Step 1: 编辑文件**

  打开 `backend/repositories/questionnaire.py`，在 `QuestionnaireQuestionRepository` 之后追加 `QuestionnaireResponseRepository`，并补充 import。

---

### Task 2: 新增 view dataclass + QuestionnaireResponseService

**Files:**
- Modify: `backend/services/questionnaire.py`

在文件末尾新增 dataclass 和 service：

```python
@dataclass
class AnswerView:
    question_id: int
    question_content: str
    question_type: str
    options: list[str] | None = None
    answer_value: str | None = None


@dataclass
class ResponseView:
    id: int
    template_id: int
    template_title: str
    user_id: int
    user_name: str
    case_id: int | None
    record_id: int | None
    status: str
    answers: list[AnswerView]
    completed_at: datetime | None
    created_at: datetime


class QuestionnaireResponseService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = QuestionnaireResponseRepository(db)

    def _build_response_item(
        self,
        response: QuestionnaireResponse,
        answers_map: dict[int, list[QuestionnaireAnswer]] | None = None,
        questions_map: dict[int, dict[int, QuestionnaireQuestion]] | None = None,
    ) -> ResponseView:
        if answers_map is not None:
            answers = answers_map.get(response.id, [])
        else:
            answers = self.repo.load_answers([response.id]).get(response.id, [])

        if questions_map is not None:
            q_map = questions_map.get(response.template_id, {})
        else:
            q_map = self.repo.load_questions([response.template_id]).get(response.template_id, {})

        return ResponseView(
            id=response.id,
            template_id=response.template_id,
            template_title=response.template.title if response.template else "",
            user_id=response.user_id,
            user_name=response.user.display_name if response.user else "",
            case_id=response.case_id,
            record_id=response.record_id,
            status=response.status,
            answers=[
                AnswerView(
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

    def check(
        self,
        user_id: int,
        case_id: int | None,
        record_id: int | None,
        trigger: str | None,
    ) -> QuestionnaireCheckResponse:
        if not case_id and not record_id:
            raise ValidationError("请提供 case_id 或 record_id")

        if record_id:
            record = self.repo.get_training_record(record_id, user_id)
            if not record:
                raise NotFoundError("训练记录不存在")
            case_id = record.case_id

        cqs = self.repo.case_questionnaires_for(case_id, trigger)

        for cq in cqs:
            existing = self.repo.find_completed(user_id, cq.template_id, case_id)
            if existing:
                continue

            partial = self.repo.find_pending(user_id, cq.template_id, case_id)
            t = self.repo.get_template(cq.template_id)
            return QuestionnaireCheckResponse(
                has_pending=True,
                template_id=cq.template_id,
                response_id=partial.id if partial else None,
                template=_template_to_detail(t) if t else None,
                is_required=cq.is_required,
                trigger_event=cq.trigger_event or "before_training",
            )

        return QuestionnaireCheckResponse(has_pending=False)

    def submit(
        self,
        user_id: int,
        template_id: int,
        case_id: int | None,
        record_id: int | None,
        answers_data: list[dict],
    ) -> ResponseView:
        t = self.repo.get_template(template_id)
        if not t or not t.is_active:
            raise NotFoundError("问卷模板不存在或已停用")

        response = self.repo.find_pending(user_id, template_id, case_id)

        with unit_of_work(self.db, conflict_detail="提交问卷失败"):
            if response:
                self.repo.delete_answers(response.id)
            else:
                response = QuestionnaireResponse(
                    template_id=template_id,
                    user_id=user_id,
                    case_id=case_id,
                    record_id=record_id,
                    status="pending",
                )
                self.repo.add(response)

            for ans in answers_data:
                self.db.add(
                    QuestionnaireAnswer(
                        response_id=response.id,
                        question_id=ans["question_id"],
                        answer_value=ans.get("answer_value"),
                    )
                )

            response.status = "completed"
            response.completed_at = datetime.now(UTC)

        self.db.refresh(response)
        return self._build_response_item(response)

    def list_my_responses(self, user_id: int, offset: int, limit: int) -> tuple[list[ResponseView], int]:
        rows, total = self.repo.list_by_user(user_id, offset, limit)
        response_ids = [r.id for r in rows]
        template_ids = list({r.template_id for r in rows})
        answers_map = self.repo.load_answers(response_ids)
        questions_map = self.repo.load_questions(template_ids)
        items = [self._build_response_item(r, answers_map, questions_map) for r in rows]
        return items, total

    def list_responses(self, template_id: int, offset: int, limit: int) -> tuple[list[ResponseView], int]:
        t = self.repo.get_template(template_id)
        if not t:
            raise NotFoundError("问卷模板不存在")

        rows, total = self.repo.list_by_template(template_id, offset, limit)
        response_ids = [r.id for r in rows]
        template_ids = [template_id]
        answers_map = self.repo.load_answers(response_ids)
        questions_map = self.repo.load_questions(template_ids)
        items = [self._build_response_item(r, answers_map, questions_map) for r in rows]
        return items, total
```

同时将 `_template_to_detail` 从 `routers/questionnaires/templates.py` 移到 `services/questionnaire.py`（消除 cross-import 耦合），并在 `templates.py` 中改为从 service 导入。

新增 import：

```python
from datetime import UTC, datetime
from typing import List

from core.exceptions import ValidationError, NotFoundError
from core.unit_of_work import unit_of_work
from models import (
    CaseQuestionnaire,
    QuestionnaireAnswer,
    QuestionnaireQuestion,
    QuestionnaireResponse,
    QuestionnaireTemplate,
    TrainingRecord,
    User,
)
from repositories.questionnaire import QuestionnaireQuestionRepository, QuestionnaireTemplateRepository, QuestionnaireResponseRepository
from schemas.questionnaire import (
    QuestionnaireCheckResponse,
    QuestionnaireQuestionResponse,
    QuestionnaireTemplateDetailResponse,
)
```

- [ ] **Step 1: 将 `_template_to_detail` 从 `routers/questionnaires/templates.py` 移到 services**

  从 `backend/routers/questionnaires/templates.py` 剪切 `_template_to_detail` 函数（lines 73-98），粘贴到 `backend/services/questionnaire.py` 的 import 区域之后、`QuestionnaireTemplateService` 之前。

  ```python
  def _template_to_detail(t: QuestionnaireTemplate | None) -> QuestionnaireTemplateDetailResponse | None:
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
  ```

  在 `templates.py` 中改为从 service 导入：

  ```python
  from services.questionnaire import _template_to_detail
  ```

  删除 `templates.py` 中原有的 `_template_to_detail` 函数定义。

- [ ] **Step 2: 添加 import**（到 `services/questionnaire.py`）

- [ ] **Step 3: 在 `_template_to_detail` 之后追加 `AnswerView`、`ResponseView` dataclass 和 `QuestionnaireResponseService`**

---

### Task 3: Refactor 路由层

**Files:**
- Modify: `backend/routers/questionnaires/responses.py`

将整个文件替换为 thin router：

```python
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from core.deps import DbSession
from core.security import get_current_user, require_permission
from models import User
from schemas import (
    PaginatedResponse,
    QuestionnaireAnswerItem,
    QuestionnaireCheckResponse,
    QuestionnaireResponseItem,
    QuestionnaireSubmitRequest,
)
from services.questionnaire import QuestionnaireResponseService

router = APIRouter()

_Manager = Annotated[User, Depends(require_permission("questionnaire_manage"))]


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
```

- [ ] **Step 1: 替换整个文件内容**

- [ ] **Step 2: 确认 `templates.py` 中已正确从 service 导入 `_template_to_detail`**

  上一步 Task 2 中已将 `_template_to_detail` 移入 services，确认 `templates.py` 改为 `from services.questionnaire import _template_to_detail` 且原函数定义已删除。

---

### Task 4: 验证

- [ ] **Step 1: 跑 compile 和 ruff**

```bash
cd backend
uv run python -m compileall -q .
uv run ruff check
uv run ruff format
```

- [ ] **Step 2: 跑 questionnaire 测试**

```bash
cd backend
uv run python -m pytest tests/admin/test_questionnaires.py -x -q
```

- [ ] **Step 3: 跑 assignment 测试（因 export 共用 exporter）**

```bash
cd backend
uv run python -m pytest tests/admin/test_assignment_flow.py -x -q
```

- [ ] **Step 4: 提价**

```bash
git add -A
git commit -m "♻️ refactor: questionnaires/responses 分层重构为 service→repository"
```
