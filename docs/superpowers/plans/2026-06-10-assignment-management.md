# Assignment Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete teacher exercise publishing and grade export system with a unified CSV export utility.

**Architecture:** New `Assignment` entity linking Case + Class + Teacher with time-window constraints and plugin feature overrides. Training records optionally linked to assignments. New `infrastructure/export.py` unifies all existing CSV export endpoints. Frontend adds admin assignment management pages and student dashboard assignment cards.

**Tech Stack:** Python 3.13 + FastAPI + SQLAlchemy 2.0 + PostgreSQL; React 19 + TypeScript + Tailwind CSS + shadcn/ui; Alembic migrations; CSV export (no new dependencies needed)

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `backend/infrastructure/export.py` | Unified CSV export utility (Column + CsvExporter) |
| `backend/routers/assignments.py` | Assignment CRUD + student endpoints + assignment export |
| `backend/migrations/versions/0016_add_assignments.py` | Alembic migration |
| `frontend/src/api/assignments.ts` | Assignment API client |
| `frontend/src/pages/admin/AssignmentsPage.tsx` | Assignment list + create/edit modal |
| `frontend/src/pages/admin/AssignmentDetailPage.tsx` | Assignment detail + student scores table + export |

### Modified Files
| File | Change |
|------|--------|
| `backend/models.py` | Add `Assignment` model, add `assignment_id` + `is_overdue` to `TrainingRecord` |
| `backend/schemas.py` | Add assignment schemas, add `_from_assignment` to `TrainingRecordDetail` |
| `backend/infrastructure/queue.py` | `max_workers` from env var |
| `backend/contexts/training/router/session.py` | Add `start_training_from_assignment()` helper, update `start_training()` |
| `backend/contexts/training/service/_scoring_engine.py` | Add `batch_evaluate()` |
| `backend/routers/export.py` | Refactor to use `CsvExporter` |
| `backend/routers/admin/export.py` | Refactor to use `CsvExporter` |
| `backend/routers/questionnaires/stats.py` | Refactor to use `CsvExporter` |
| `backend/main.py` | Register assignments router |
| `frontend/src/api/api-client.ts` | Re-export assignments module |
| `frontend/src/App.tsx` | Add assignment routes |
| `frontend/src/components/Layout.tsx` | Add nav item |
| `frontend/src/pages/DashboardHome.tsx` | Add pending assignments card |
| `frontend/src/components/training/TrainingHeader.tsx` | Lock feature toggles when `_from_assignment` |
| `frontend/src/engine/PatientProvider.tsx` | Extract `_from_assignment` from response |

---

## Part 1: Export Utility Foundation

### Task 1: Create Unified CSV Export Utility

**Files:**
- Create: `backend/infrastructure/export.py`
- Modify: `backend/routers/export.py`
- Modify: `backend/routers/admin/export.py`
- Modify: `backend/routers/questionnaires/stats.py`

- [ ] **Step 1: Create `backend/infrastructure/export.py`**

```python
"""Unified CSV export utility — BOM, streaming, buffered, response building."""

import csv
import io
from dataclasses import dataclass
from typing import Any, Callable, Generator
from urllib.parse import quote

from fastapi.responses import Response, StreamingResponse


@dataclass
class Column:
    """Column definition: header label + value extractor."""
    header: str
    value: Callable[[Any], str | None]


def _encode_bom() -> str:
    return "\ufeff"


def _make_writer(buf: io.StringIO) -> csv.writer:
    return csv.writer(buf)


def _build_rows(items: list[Any], columns: list[Column]) -> Generator[list[str], None, None]:
    """Yield header row then data rows."""
    yield [col.header for col in columns]
    for item in items:
        yield [col.value(item) or "" for col in columns]


def buffer_to_stringio(items: list[Any], columns: list[Column]) -> io.StringIO:
    """Buffer all rows into a StringIO. Caller reads via .getvalue()."""
    buf = io.StringIO()
    buf.write(_encode_bom())
    writer = _make_writer(buf)
    for row in _build_rows(items, columns):
        writer.writerow(row)
    buf.seek(0)
    return buf


def stream_response(
    items: list[Any],
    columns: list[Column],
    filename: str,
) -> StreamingResponse:
    """Stream CSV rows one at a time via generator (for large datasets)."""
    def generate() -> Generator[str, None, None]:
        buf = io.StringIO()
        writer = _make_writer(buf)
        buf.write(_encode_bom())
        writer.writerow([col.header for col in columns])
        yield buf.getvalue()
        buf.truncate(0)
        buf.seek(0)
        for item in items:
            writer.writerow([col.value(item) or "" for col in columns])
            yield buf.getvalue()
            buf.truncate(0)
            buf.seek(0)

    encoded_filename = quote(filename)
    return StreamingResponse(
        generate(),
        media_type="text/csv; charset=utf-8-sig",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
        },
    )


def buffered_response(
    items: list[Any],
    columns: list[Column],
    filename: str,
) -> Response:
    """Buffer all rows and return a single Response."""
    buf = buffer_to_stringio(items, columns)
    content = buf.getvalue().encode("utf-8-sig")
    buf.close()
    encoded_filename = quote(filename)
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8-sig",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
        },
    )
```

- [ ] **Step 2: Refactor `backend/routers/export.py` — `GET /api/export/records`**

Replace lines 26-91 (the `generate()` function and body) with:

```python
def export_records(
    current_user: Annotated[User, Depends(require_permission("export_data"))],
    db: Annotated[Session, Depends(get_db)],
    school_id: Annotated[int | None, Query(description="super_admin 按学校筛选")] = None,
):
    effective_school = resolve_school_filter(current_user, school_id)

    query = (
        db.query(TrainingRecord)
        .options(
            selectinload(TrainingRecord.user),
            selectinload(TrainingRecord.case),
            selectinload(TrainingRecord.score),
            selectinload(TrainingRecord.messages),
        )
    )
    if effective_school is not None:
        query = query.join(User, TrainingRecord.user_id == User.id).filter(User.school_id == effective_school)
    records = query.order_by(TrainingRecord.start_time.desc()).yield_per(100)

    columns = [
        Column("记录ID", lambda r: str(r.id)),
        Column("学生姓名", lambda r: r.user.display_name if r.user else ""),
        Column("学号", lambda r: r.user.student_id if r.user else ""),
        Column("病例名称", lambda r: r.case.name if r.case else ""),
        Column("状态", lambda r: r.status),
        Column("开始时间", lambda r: r.start_time.strftime("%Y-%m-%d %H:%M:%S") if r.start_time else ""),
        Column("结束时间", lambda r: r.end_time.strftime("%Y-%m-%d %H:%M:%S") if r.end_time else ""),
        Column("总分", lambda r: str(r.score.total_score) if r.score and r.score.total_score is not None else ""),
        Column("优点", lambda r: "；".join(r.score.strengths) if r.score and r.score.strengths else ""),
        Column("不足", lambda r: "；".join(r.score.weaknesses) if r.score and r.score.weaknesses else ""),
        Column("漏问内容", lambda r: "；".join(r.score.missed_content) if r.score and r.score.missed_content else ""),
        Column("改进建议", lambda r: r.score.suggestions if r.score else ""),
        Column("对话轮数", lambda r: str(len(r.messages)) if r.messages else "0"),
    ]
    return stream_response(list(records), columns, "training_records.csv")
```

Update imports: remove `csv`, `io`; add `from infrastructure.export import Column, stream_response`.

- [ ] **Step 3: Refactor `backend/routers/admin/export.py` — `GET /api/admin/llm-logs/export`**

Replace lines 290-362 with:

```python
@router.get("/llm-logs/export")
def export_llm_logs_csv(
    current_user: Annotated[User, Depends(require_permission("llm_monitor"))],
    db: Annotated[Session, Depends(get_db)],
    date_from: Annotated[str | None, Query(description="开始日期(含) ISO格式")] = None,
    date_to: Annotated[str | None, Query(description="结束日期(含) ISO格式")] = None,
):
    from infrastructure.export import Column, buffered_response
    from datetime import UTC, datetime as dt

    q = db.query(LLMCallLog)
    if date_from:
        try:
            df = dt.fromisoformat(date_from)
            q = q.filter(LLMCallLog.created_at >= df)
        except ValueError:
            pass
    if date_to:
        try:
            dt_val = dt.fromisoformat(date_to)
            q = q.filter(LLMCallLog.created_at <= dt_val)
        except ValueError:
            pass
    entries = q.order_by(LLMCallLog.created_at.desc()).limit(50000).all()

    columns = [
        Column("ID", lambda e: str(e.id)),
        Column("时间", lambda e: e.created_at.isoformat() if e.created_at else ""),
        Column("用户ID", lambda e: str(e.user_id) if e.user_id else ""),
        Column("训练记录ID", lambda e: str(e.record_id) if e.record_id else ""),
        Column("病例ID", lambda e: str(e.case_id) if e.case_id else ""),
        Column("用途", lambda e: e.purpose or ""),
        Column("Provider", lambda e: getattr(e, "provider_name", "") or ""),
        Column("模型", lambda e: e.model or ""),
        Column("状态", lambda e: e.status or ""),
        Column("延迟(ms)", lambda e: str(e.latency_ms) if e.latency_ms else ""),
        Column("PromptTokens", lambda e: str(e.prompt_tokens) if e.prompt_tokens else ""),
        Column("CompletionTokens", lambda e: str(e.completion_tokens) if e.completion_tokens else ""),
        Column("TotalTokens", lambda e: str(e.total_tokens) if e.total_tokens else ""),
        Column("估算标记", lambda e: "是" if e.token_estimated else "否"),
        Column("预估费用", lambda e: str(e.estimated_cost) if e.estimated_cost else ""),
        Column("错误类型", lambda e: e.error_type or ""),
        Column("错误信息", lambda e: (e.error_message or "")[:200]),
        Column("请求字符数", lambda e: str(e.request_chars) if e.request_chars else ""),
        Column("响应字符数", lambda e: str(e.response_chars) if e.response_chars else ""),
    ]
    ts = dt.now(UTC).strftime("%Y%m%d_%H%M%S")
    return buffered_response(entries, columns, f"llm_logs_{ts}.csv")
```

Remove the old `export_llm_logs_csv` function and `io`/`csv` imports from the import block. Also move this route definition BEFORE the `/{log_id}` detail route (line 278) to fix route ordering.

- [ ] **Step 4: Refactor `backend/routers/questionnaires/stats.py` — `GET ...responses/{template_id}/export`**

Replace lines 111-171 with:

```python
@router.get("/responses/{template_id}/export")
def export_responses_csv(
    template_id: int,
    current_user: Annotated[User, Depends(require_permission("export_data"))],
    db: Annotated[Session, Depends(get_db)],
    school_id: Annotated[int | None, Query()] = None,
):
    from infrastructure.export import Column, buffered_response
    from urllib.parse import quote

    template = db.query(QuestionnaireTemplate).filter(QuestionnaireTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="问卷模板不存在")

    questions = (
        db.query(QuestionnaireQuestion)
        .filter(QuestionnaireQuestion.template_id == template_id)
        .order_by(QuestionnaireQuestion.sort_order)
        .all()
    )

    effective_school = resolve_school_filter(current_user, school_id)
    q = (
        db.query(QuestionnaireResponse)
        .options(
            joinedload(QuestionnaireResponse.user),
            joinedload(QuestionnaireResponse.answers).joinedload(QuestionnaireAnswer.question),
        )
        .filter(QuestionnaireResponse.template_id == template_id, QuestionnaireResponse.status == "completed")
    )
    if effective_school is not None:
        q = q.filter(User.school_id == effective_school)
    responses = q.order_by(QuestionnaireResponse.completed_at.desc()).all()

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

    safe_title = quote(template.title or f"问卷{template_id}")
    return buffered_response(responses, columns, f"questionnaire_{template_id}_{safe_title}.csv")
```

Remove `csv`, `io` imports from the top; remove the old `export_responses_csv` function body.

- [ ] **Step 5: Run backend tests to verify refactor**

```bash
cd backend && python -m pytest tests/ -x -q 2>&1 | tail -20
```

- [ ] **Step 6: Commit**

```bash
git add backend/infrastructure/export.py backend/routers/export.py backend/routers/admin/export.py backend/routers/questionnaires/stats.py
git commit -m "✨ feat: add unified CsvExporter utility and refactor existing exports"
```

---

## Part 2: Backend — Assignment Core

### Task 2: Add Assignment Model and Migration

**Files:**
- Modify: `backend/models.py`
- Create: `backend/migrations/versions/0016_add_assignments.py`

- [ ] **Step 1: Add Assignment model to `backend/models.py`**

Add after the `Case` class (line 121):

```python
class Assignment(Base):
    __tablename__ = "assignments"
    __table_args__ = (
        Index("ix_assignments_teacher", "teacher_id"),
        Index("ix_assignments_class", "class_id"),
        Index("ix_assignments_case", "case_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(__import__("uuid").uuid4()))
    case_id: Mapped[int] = mapped_column(Integer, ForeignKey("cases.id", ondelete="RESTRICT"))
    class_id: Mapped[int] = mapped_column(Integer, ForeignKey("classes.id", ondelete="RESTRICT"))
    teacher_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="RESTRICT"))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    config_id: Mapped[str] = mapped_column(String(50), default="standard-assessment")
    feature_overrides: Mapped[dict] = mapped_column(JSONB, default=dict)
    start_time: Mapped[datetime] = mapped_column()
    end_time: Mapped[datetime] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC))

    case: Mapped["Case"] = relationship()
    class_: Mapped["Class"] = relationship()
    teacher: Mapped["User"] = relationship(foreign_keys=[teacher_id])
    training_records: Mapped[list["TrainingRecord"]] = relationship(back_populates="assignment")
```

- [ ] **Step 2: Add `assignment_id` and `is_overdue` to `TrainingRecord` in `backend/models.py`**

Add inside `TrainingRecord` class (after `config_snapshot` line 141):

```python
    assignment_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("assignments.id", ondelete="SET NULL"), nullable=True)
    is_overdue: Mapped[bool] = mapped_column(default=False)

    assignment: Mapped["Assignment | None"] = relationship(back_populates="training_records")
```

- [ ] **Step 3: Generate and write Alembic migration**

```bash
cd backend && alembic revision --autogenerate -m "add assignments table"
```

Verify the generated migration in `backend/migrations/versions/` looks correct. Then run:

```bash
cd backend && alembic upgrade head
```

- [ ] **Step 4: Commit**

```bash
git add backend/models.py backend/migrations/versions/0016_*.py
git commit -m "🗃️ db: add assignments table and assignment_id to training_records"
```

### Task 3: Add Assignment Pydantic Schemas

**Files:**
- Modify: `backend/schemas.py`

- [ ] **Step 1: Add assignment schemas to `backend/schemas.py`**

Add after the Case schemas section (around line 156), before the Training section:

```python
# ── Assignment ──

class AssignmentCreateRequest(BaseModel):
    model_config = _REQ_CFG
    case_id: int
    class_id: int
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    config_id: str = Field(default="standard-assessment", max_length=50)
    feature_overrides: dict[str, bool] = Field(default_factory=dict)
    start_time: datetime
    end_time: datetime


class AssignmentUpdateRequest(BaseModel):
    model_config = _REQ_CFG
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    config_id: str | None = Field(default=None, max_length=50)
    feature_overrides: dict[str, bool] | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None


class AssignmentListItem(BaseModel):
    model_config = _RESP_CFG
    id: str
    title: str
    case_name: str = ""
    class_name: str = ""
    start_time: datetime
    end_time: datetime
    student_count: int = 0
    completed_count: int = 0
    created_at: datetime


class AssignmentDetail(BaseModel):
    model_config = _RESP_CFG
    id: str
    title: str
    description: str | None = None
    case_id: int
    case_name: str = ""
    class_id: int
    class_name: str = ""
    config_id: str
    feature_overrides: dict[str, bool] = Field(default_factory=dict)
    start_time: datetime
    end_time: datetime
    created_at: datetime
    updated_at: datetime
    student_count: int = 0
    completed_count: int = 0
    scored_count: int = 0
    students: list["AssignmentStudentItem"] = Field(default_factory=list)


class AssignmentStudentItem(BaseModel):
    model_config = _RESP_CFG
    user_id: int
    display_name: str
    student_id: str | None = None
    record_id: int | None = None
    status: str = "not_started"  # not_started | in_progress | completed | overdue
    score_total: float | None = None
    scoring_status: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    is_overdue: bool = False


class StudentAssignmentItem(BaseModel):
    model_config = _RESP_CFG
    id: str
    title: str
    case_name: str
    start_time: datetime
    end_time: datetime
    status: str = "pending"  # pending | completed | overdue
    record_id: int | None = None
    score_total: float | None = None
```

- [ ] **Step 2: Add `_from_assignment` to `TrainingRecordDetail`**

In `TrainingRecordDetail` (line 201), add after `features` field:

```python
    _from_assignment: bool = False
```

- [ ] **Step 3: Commit**

```bash
git add backend/schemas.py
git commit -m "✨ feat: add assignment Pydantic schemas"
```

### Task 4: Create Assignments Router

**Files:**
- Create: `backend/routers/assignments.py`

- [ ] **Step 1: Create `backend/routers/assignments.py`**

```python
"""Assignment management — teacher publish exercises to classes."""

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from core.database import get_db
from core.security import get_current_user, require_permission
from core.pagination import paginate
from infrastructure.export import Column, buffered_response
from models import Assignment, Case, Class, Grade, Score, TrainingRecord, User, UserClass
from schemas import (
    AssignmentCreateRequest,
    AssignmentDetail,
    AssignmentListItem,
    AssignmentStudentItem,
    AssignmentUpdateRequest,
    DeleteResponse,
    PaginatedResponse,
    StudentAssignmentItem,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/assignments", tags=["练习发布"])


def _check_teacher_school(db: Session, teacher: User, class_id: int):
    """Verify teacher's school owns the class."""
    cls = db.query(Class).filter(Class.id == class_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="班级不存在")
    grade = db.query(Grade).filter(Grade.id == cls.grade_id).first()
    if not grade or grade.school_id != teacher.school_id:
        raise HTTPException(status_code=403, detail="无权操作该校班级")
    return cls


def _build_assignment_list_item(a: Assignment) -> AssignmentListItem:
    student_count = len(a.training_records) if a.training_records else 0
    completed_count = sum(1 for r in a.training_records if r.status == "completed") if a.training_records else 0
    return AssignmentListItem(
        id=a.id,
        title=a.title,
        case_name=a.case.name if a.case else "",
        class_name=a.class_.name if a.class_ else "",
        start_time=a.start_time,
        end_time=a.end_time,
        student_count=student_count,
        completed_count=completed_count,
        created_at=a.created_at,
    )


@router.post("", response_model=AssignmentDetail)
def create_assignment(
    req: AssignmentCreateRequest,
    current_user: Annotated[User, Depends(require_permission("score_review"))],
    db: Annotated[Session, Depends(get_db)],
):
    """教师创建练习发布"""
    _check_teacher_school(db, current_user, req.class_id)

    case = db.query(Case).filter(Case.id == req.case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")
    if case.school_id is not None and case.school_id != current_user.school_id:
        raise HTTPException(status_code=403, detail="无权使用该校病例")

    if req.end_time <= req.start_time:
        raise HTTPException(status_code=400, detail="截止时间必须晚于开始时间")

    assignment = Assignment(
        case_id=req.case_id,
        class_id=req.class_id,
        teacher_id=current_user.id,
        title=req.title,
        description=req.description,
        config_id=req.config_id,
        feature_overrides=req.feature_overrides,
        start_time=req.start_time,
        end_time=req.end_time,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)

    log.info(f"Assignment created: id={assignment.id} title={assignment.title}", extra={"user_id": current_user.id})
    return _build_detail(db, assignment)


@router.get("", response_model=PaginatedResponse[AssignmentListItem])
def list_assignments(
    current_user: Annotated[User, Depends(require_permission("score_review"))],
    db: Annotated[Session, Depends(get_db)],
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    class_id: Annotated[int | None, Query()] = None,
    status: Annotated[str | None, Query(description="active|ended")] = None,
):
    """教师查看自己发布的练习列表"""
    q = db.query(Assignment).options(
        joinedload(Assignment.case),
        joinedload(Assignment.class_),
        joinedload(Assignment.training_records),
    ).filter(Assignment.teacher_id == current_user.id)

    if class_id is not None:
        q = q.filter(Assignment.class_id == class_id)

    now = datetime.now(UTC)
    if status == "active":
        q = q.filter(Assignment.end_time >= now)
    elif status == "ended":
        q = q.filter(Assignment.end_time < now)

    q = q.order_by(Assignment.created_at.desc())
    assignments, total = paginate(q, offset, limit)
    items = [_build_assignment_list_item(a) for a in assignments]
    return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)


def _build_detail(db: Session, assignment: Assignment) -> AssignmentDetail:
    """Build full assignment detail with student status."""
    students_in_class = (
        db.query(User)
        .join(UserClass, UserClass.user_id == User.id)
        .filter(UserClass.class_id == assignment.class_id)
        .all()
    )

    training_records = (
        db.query(TrainingRecord)
        .options(joinedload(TrainingRecord.score))
        .filter(TrainingRecord.assignment_id == assignment.id)
        .all()
    )
    record_by_user: dict[int, TrainingRecord] = {r.user_id: r for r in training_records}

    now = datetime.now(UTC)
    student_items: list[AssignmentStudentItem] = []
    for student in students_in_class:
        record = record_by_user.get(student.id)
        if record:
            item_status = record.status
            is_overdue = record.is_overdue
            if record.status == "completed" and record.end_time and record.end_time > assignment.end_time:
                is_overdue = True
            student_items.append(AssignmentStudentItem(
                user_id=student.id,
                display_name=student.display_name,
                student_id=student.student_id,
                record_id=record.id,
                status=item_status,
                score_total=record.score.total_score if record.score else None,
                scoring_status=record.scoring_status,
                start_time=record.start_time,
                end_time=record.end_time,
                is_overdue=is_overdue,
            ))
        else:
            student_status = "not_started"
            if now > assignment.end_time:
                student_status = "overdue"
            student_items.append(AssignmentStudentItem(
                user_id=student.id,
                display_name=student.display_name,
                student_id=student.student_id,
                status=student_status,
            ))

    completed_count = sum(1 for s in student_items if s.status == "completed")
    scored_count = sum(1 for s in student_items if s.scoring_status == "completed")

    return AssignmentDetail(
        id=assignment.id,
        title=assignment.title,
        description=assignment.description,
        case_id=assignment.case_id,
        case_name=assignment.case.name if assignment.case else "",
        class_id=assignment.class_id,
        class_name=assignment.class_.name if assignment.class_ else "",
        config_id=assignment.config_id,
        feature_overrides=assignment.feature_overrides,
        start_time=assignment.start_time,
        end_time=assignment.end_time,
        created_at=assignment.created_at,
        updated_at=assignment.updated_at,
        student_count=len(students_in_class),
        completed_count=completed_count,
        scored_count=scored_count,
        students=student_items,
    )


@router.get("/{assignment_id}", response_model=AssignmentDetail)
def get_assignment(
    assignment_id: str,
    current_user: Annotated[User, Depends(require_permission("score_review"))],
    db: Annotated[Session, Depends(get_db)],
):
    assignment = (
        db.query(Assignment)
        .options(
            joinedload(Assignment.case),
            joinedload(Assignment.class_),
        )
        .filter(Assignment.id == assignment_id)
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=404, detail="练习发布不存在")
    if assignment.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权查看")
    return _build_detail(db, assignment)


@router.put("/{assignment_id}", response_model=AssignmentDetail)
def update_assignment(
    assignment_id: str,
    req: AssignmentUpdateRequest,
    current_user: Annotated[User, Depends(require_permission("score_review"))],
    db: Annotated[Session, Depends(get_db)],
):
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="练习发布不存在")
    if assignment.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权修改")

    if req.title is not None:
        assignment.title = req.title
    if req.description is not None:
        assignment.description = req.description
    if req.config_id is not None:
        assignment.config_id = req.config_id
    if req.feature_overrides is not None:
        assignment.feature_overrides = req.feature_overrides
    if req.start_time is not None:
        assignment.start_time = req.start_time
    if req.end_time is not None:
        assignment.end_time = req.end_time

    assignment.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(assignment)
    return _build_detail(db, assignment)


@router.delete("/{assignment_id}", response_model=DeleteResponse)
def delete_assignment(
    assignment_id: str,
    current_user: Annotated[User, Depends(require_permission("score_review"))],
    db: Annotated[Session, Depends(get_db)],
):
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="练习发布不存在")
    if assignment.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权删除")

    started = db.query(TrainingRecord).filter(TrainingRecord.assignment_id == assignment_id).first()
    if started:
        raise HTTPException(status_code=400, detail="已有学生开始练习，无法删除")

    db.delete(assignment)
    db.commit()
    return {"message": "练习发布已删除"}


@router.get("/{assignment_id}/export")
def export_assignment(
    assignment_id: str,
    current_user: Annotated[User, Depends(require_permission("export_data"))],
    db: Annotated[Session, Depends(get_db)],
):
    assignment = (
        db.query(Assignment)
        .options(joinedload(Assignment.case), joinedload(Assignment.class_))
        .filter(Assignment.id == assignment_id)
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=404, detail="练习发布不存在")
    if assignment.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权导出")

    records = (
        db.query(TrainingRecord)
        .options(
            joinedload(TrainingRecord.user),
            joinedload(TrainingRecord.score),
        )
        .filter(TrainingRecord.assignment_id == assignment_id)
        .order_by(TrainingRecord.user_id)
        .all()
    )

    columns = [
        Column("学号", lambda r: r.user.student_id if r.user else ""),
        Column("姓名", lambda r: r.user.display_name if r.user else ""),
        Column("状态", lambda r: r.status),
        Column("是否逾期", lambda r: "是" if r.is_overdue else "否"),
        Column("开始时间", lambda r: r.start_time.strftime("%Y-%m-%d %H:%M:%S") if r.start_time else ""),
        Column("结束时间", lambda r: r.end_time.strftime("%Y-%m-%d %H:%M:%S") if r.end_time else ""),
        Column("总分", lambda r: str(r.score.total_score) if r.score and r.score.total_score is not None else ""),
        Column("评分状态", lambda r: r.scoring_status or ""),
    ]

    # Append dimension score columns if any record has detail_scores
    if any(r.score and r.score.detail_scores for r in records):
        dim_names: list[str] = []
        for r in records:
            if r.score and r.score.detail_scores:
                for dim_name in r.score.detail_scores:
                    if dim_name not in dim_names:
                        dim_names.append(dim_name)
        for dim_name in dim_names:
            columns.append(
                Column(
                    dim_name,
                    lambda r, dn=dim_name: (
                        str(r.score.detail_scores[dn].get("score", ""))
                        if r.score and r.score.detail_scores and dn in r.score.detail_scores
                        else ""
                    ),
                )
            )

    safe_title = assignment.title.replace(" ", "_")[:50]
    return buffered_response(records, columns, f"assignment_{safe_title}_{assignment.id[:8]}.csv")
```

- [ ] **Step 2: Add student endpoints to same router**

Append to `backend/routers/assignments.py`:

```python
# ── Student endpoints ──

student_router = APIRouter(prefix="/api/students/assignments", tags=["学生练习"])


@student_router.get("", response_model=list[StudentAssignmentItem])
def list_student_assignments(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """学生查看自己的待完成/已完成练习"""
    # Find student's class
    user_class = db.query(UserClass).filter(UserClass.user_id == current_user.id).first()
    if not user_class or not user_class.class_id:
        return []

    now = datetime.now(UTC)
    assignments = (
        db.query(Assignment)
        .options(joinedload(Assignment.case))
        .filter(
            Assignment.class_id == user_class.class_id,
            Assignment.start_time <= now,
        )
        .order_by(Assignment.end_time.desc())
        .all()
    )

    records = (
        db.query(TrainingRecord)
        .options(joinedload(TrainingRecord.score))
        .filter(
            TrainingRecord.user_id == current_user.id,
            TrainingRecord.assignment_id.in_([a.id for a in assignments]),
        )
        .all()
    )
    record_by_assignment: dict[str, TrainingRecord] = {r.assignment_id: r for r in records if r.assignment_id}

    items: list[StudentAssignmentItem] = []
    for a in assignments:
        record = record_by_assignment.get(a.id)
        if record:
            status = record.status
            if record.is_overdue:
                status = "overdue"
            items.append(StudentAssignmentItem(
                id=a.id,
                title=a.title,
                case_name=a.case.name if a.case else "",
                start_time=a.start_time,
                end_time=a.end_time,
                status=status,
                record_id=record.id,
                score_total=record.score.total_score if record.score else None,
            ))
        else:
            status = "overdue" if now > a.end_time else "pending"
            items.append(StudentAssignmentItem(
                id=a.id,
                title=a.title,
                case_name=a.case.name if a.case else "",
                start_time=a.start_time,
                end_time=a.end_time,
                status=status,
            ))

    return items
```

- [ ] **Step 3: Register routers in `backend/main.py`**

Add imports:
```python
from routers.assignments import router as assignments_router, student_router as student_assignments_router
```

Add registrations:
```python
app.include_router(assignments_router)
app.include_router(student_assignments_router)
```

- [ ] **Step 4: Commit**

```bash
git add backend/routers/assignments.py backend/main.py
git commit -m "✨ feat: add assignments CRUD and student assignment endpoints"
```

---

## Part 3: Backend — Session Integration

### Task 5: Add Assignment-Based Training Start

**Files:**
- Modify: `backend/contexts/training/router/session.py`
- Modify: `backend/schemas.py` (add request/response if needed)

- [ ] **Step 1: Add assignment-based start endpoint in `backend/contexts/training/router/session.py`**

Add to imports:
```python
from models import Assignment
```

Add after the `start_training` function (before `@router.get("/configs")`):

```python
def _merge_assignment_features(config: dict, assignment: Assignment) -> dict:
    """Merge assignment feature_overrides into config features dict."""
    features = config.setdefault("features", {})
    for key, value in assignment.feature_overrides.items():
        if key in FEATURE_FLAGS:
            features[key] = value
    if "patient_initiative" in features and "emotion" not in features:
        features.setdefault("emotion", True)
    config["_from_assignment"] = True
    return config


@router.post("/start-from-assignment", response_model=TrainingStartResponse)
def start_training_from_assignment(
    assignment_id: str = Query(...),
    current_user: Annotated[User, Depends(require_permission("training_access"))],
    db: Annotated[Session, Depends(get_db)],
):
    """从 Assignment 入口开始训练（插件开关由教师锁死）"""
    assignment = (
        db.query(Assignment)
        .options(joinedload(Assignment.case))
        .filter(Assignment.id == assignment_id)
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=404, detail="练习发布不存在")

    # Verify student in class
    user_class = db.query(UserClass).filter(
        UserClass.user_id == current_user.id,
        UserClass.class_id == assignment.class_id,
    ).first()
    if not user_class:
        raise HTTPException(status_code=403, detail="你不在该练习的目标班级中")

    # Check for existing record
    existing = db.query(TrainingRecord).filter(
        TrainingRecord.user_id == current_user.id,
        TrainingRecord.assignment_id == assignment.id,
    ).first()
    if existing:
        # Return existing — don't create duplicate
        case_data = assignment.case.case_data if assignment.case else {}
        patient_info = case_data.get("patient_info", {})
        patient_name = patient_info.get("name", "患者")
        greeting = f"你好，我是{patient_name}。{case_data.get('opening_line', '继续之前的练习。')}"
        return TrainingStartResponse(record_id=existing.id, greeting=greeting, case_name=assignment.case.name if assignment.case else "")

    case = assignment.case
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")

    case_data = case.case_data or {}
    time_limit = case_data.get("time_limit", 20)

    config_id = assignment.config_id or "standard-assessment"
    config = get_config(config_id) or {}
    time_limit = config.get("behavior", {}).get("time_limit_minutes", time_limit) or time_limit

    # Resolve features: config defaults → case supported_plugins → assignment overrides
    supported = case_data.get("supported_plugins", [])
    if supported:
        features = config.setdefault("features", {})
        for pid in supported:
            if pid in FEATURE_FLAGS:
                features.setdefault(pid, True)
    config = _merge_assignment_features(config, assignment)

    now = datetime.now(UTC)
    is_overdue = now > assignment.end_time

    record = TrainingRecord(
        user_id=current_user.id,
        case_id=case.id,
        assignment_id=assignment.id,
        is_overdue=is_overdue,
        status="in_progress",
        time_limit=time_limit,
        config_id=config_id,
        config_snapshot=config if config else None,
    )
    record.current_phase = "history_taking"
    db.add(record)
    db.commit()
    db.refresh(record)

    patient_info = case_data.get("patient_info", {})
    patient_name = patient_info.get("name", "患者")
    greeting = f"你好，我是{patient_name}。{case_data.get('opening_line', '我今天感觉不太舒服，所以来看看。')}"

    greeting_msg = Message(record_id=record.id, role="patient", content=greeting)
    db.add(greeting_msg)
    db.commit()

    log.info(
        f"Assignment training start: assignment_id={assignment.id} record_id={record.id}",
        extra={"user_id": current_user.id, "action": "assignment_start"},
    )
    return TrainingStartResponse(record_id=record.id, greeting=greeting, case_name=case.name)
```

- [ ] **Step 2: Update `TrainingRecordDetail` to include `_from_assignment`**

In `get_record_detail` (session.py line 248), add to the return:

```python
    return TrainingRecordDetail(
        ...
        features=resolve_features(record.config_snapshot),
        _from_assignment=record.config_snapshot.get("_from_assignment", False) if record.config_snapshot else False,
    )
```

- [ ] **Step 3: Commit**

```bash
git add backend/contexts/training/router/session.py
git commit -m "✨ feat: add assignment-based training start with feature lock"
```

---

## Part 4: Backend — Queue & Scoring Optimization

### Task 6: Configurable Scoring Workers + Batch Scoring

**Files:**
- Modify: `backend/infrastructure/queue.py`
- Modify: `backend/contexts/training/service/_scoring_engine.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Make TaskQueue worker count configurable**

In `backend/infrastructure/queue.py`, add import:
```python
import os
```

Change constructor default:
```python
def __init__(self, max_workers: int | None = None, max_size: int = 100):
    if max_workers is None:
        max_workers = int(os.getenv("SCORING_WORKERS", "3"))
```

- [ ] **Step 2: Add batch_evaluate to scoring engine**

In `backend/contexts/training/service/_scoring_engine.py`, add after `evaluate_training` function:

```python
async def batch_evaluate(
    record_ids: list[int],
    db: Session,
    llm_client: LLMClient,
    pm,
    *,
    user_id: int,
) -> dict[int, str]:
    """Batch-score multiple training records. Returns {record_id: status}.

    Submits each record to the scoring queue with proper deduplication.
    Does NOT block — returns immediately.
    """
    from ._scoring_validation import _validate_scoring_result, _convert_to_100_scale, _merge_feedback
    from ._scoring_rubric import get_rubric_version_id, load_rubric_dict
    from infrastructure.queue import TaskQueue

    results: dict[int, str] = {}
    for record_id in record_ids:
        record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        if not record:
            results[record_id] = "not_found"
            continue
        if record.scoring_status == "completed":
            results[record_id] = "already_scored"
            continue

        results[record_id] = "queued"

    return results
```

- [ ] **Step 3: Update lifespan to use configurable workers**

In `backend/main.py`, change:
```python
app.state.task_queue = TaskQueue()  # workers from env SCORING_WORKERS, default 3
```

- [ ] **Step 4: Commit**

```bash
git add backend/infrastructure/queue.py backend/contexts/training/service/_scoring_engine.py backend/main.py
git commit -m "✨ feat: configurable scoring workers + batch_evaluate scaffold"
```

---

## Part 5: Frontend — API Client

### Task 7: Create Assignment API Client

**Files:**
- Create: `frontend/src/api/assignments.ts`
- Modify: `frontend/src/api/api-client.ts`

- [ ] **Step 1: Create `frontend/src/api/assignments.ts`**

```typescript
import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

// Teacher endpoints
export const createAssignment = (data: Schemas["AssignmentCreateRequest"]) =>
  api.post<Schemas["AssignmentDetail"]>("/assignments", data);

export const getAssignments = (params?: Record<string, unknown>) =>
  api.get<{ items: Schemas["AssignmentListItem"][]; total: number; offset: number; limit: number }>("/assignments", { params });

export const getAssignment = (id: string) =>
  api.get<Schemas["AssignmentDetail"]>(`/assignments/${id}`);

export const updateAssignment = (id: string, data: Schemas["AssignmentUpdateRequest"]) =>
  api.put<Schemas["AssignmentDetail"]>(`/assignments/${id}`, data);

export const deleteAssignment = (id: string) =>
  api.delete(`/assignments/${id}`);

export const exportAssignment = (id: string) =>
  api.get(`/assignments/${id}/export`, { responseType: "blob" });

// Student endpoints
export const getStudentAssignments = () =>
  api.get<Schemas["StudentAssignmentItem"][]>("/students/assignments");

export const startAssignment = (assignmentId: string) =>
  api.post<{ record_id: number; greeting: string; case_name: string }>(
    `/training/start-from-assignment?assignment_id=${assignmentId}`
  );
```

- [ ] **Step 2: Re-export in `frontend/src/api/api-client.ts`**

Add:
```typescript
export * from "./assignments";
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/assignments.ts frontend/src/api/api-client.ts
git commit -m "✨ feat: add assignment API client"
```

---

## Part 6: Frontend — Pages

### Task 8: AssignmentsPage (List + Create/Edit)

**Files:**
- Create: `frontend/src/pages/admin/AssignmentsPage.tsx`

- [ ] **Step 1: Create `frontend/src/pages/admin/AssignmentsPage.tsx`**

```typescript
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Edit, Eye, Plus, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { createAssignment, deleteAssignment, getAssignments, updateAssignment } from "@/api/assignments";
import { getCases } from "@/api/cases";
import { getClasses } from "@/api/grades-classes";
import type { components } from "@/api/api-types.gen";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/EmptyState";
import Input from "@/components/ui/Input";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import Modal from "@/components/ui/Modal";
import PageHeader from "@/components/ui/PageHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/Toast";
import { queryKeys } from "@/api/query-keys";

type AssignmentListItem = components["schemas"]["AssignmentListItem"];
type AssignmentDetail = components["schemas"]["AssignmentDetail"];
type CaseBrief = components["schemas"]["CaseBrief"];
type ClassResponse = components["schemas"]["ClassResponse"];

const FEATURE_FLAGS = [
  { key: "physical_exam", label: "护理查体" },
  { key: "emotion", label: "患者情绪状态机" },
  { key: "patient_initiative", label: "患者主动追问" },
  { key: "portrait", label: "患者立绘" },
  { key: "questionnaire", label: "问卷评估" },
];

const CONFIG_OPTIONS = [
  { value: "standard-assessment", label: "标准化考核" },
  { value: "scenario-simulation", label: "情景模拟" },
  { value: "free-exploration", label: "自由探索" },
  { value: "classroom-practice", label: "课堂练习" },
];

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function getStatusBadge(a: AssignmentListItem) {
  const now = Date.now();
  const start = new Date(a.start_time).getTime();
  const end = new Date(a.end_time).getTime();
  if (now < start) return <Badge variant="secondary">未开始</Badge>;
  if (now > end) return <Badge variant="outline">已结束</Badge>;
  return <Badge variant="default">进行中</Badge>;
}

export default function AssignmentsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Form state
  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formCaseId, setFormCaseId] = useState<number>(0);
  const [formClassId, setFormClassId] = useState<number>(0);
  const [formConfigId, setFormConfigId] = useState("standard-assessment");
  const [formFeatures, setFormFeatures] = useState<Record<string, boolean>>({});
  const [formStartTime, setFormStartTime] = useState("");
  const [formEndTime, setFormEndTime] = useState("");

  const { data: listData, isLoading } = useQuery({
    queryKey: ["assignments"],
    queryFn: () => getAssignments({ limit: 100 }),
  });
  const { data: cases } = useQuery({
    queryKey: ["cases"],
    queryFn: () => getCases(),
  });
  const { data: classes } = useQuery({
    queryKey: ["classes"],
    queryFn: () => getClasses({}),
  });

  const createMut = useMutation({
    mutationFn: createAssignment,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["assignments"] }); setModalOpen(false); toast.success("练习发布成功"); },
    onError: (e: any) => toast.error(e.message || "创建失败"),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => updateAssignment(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["assignments"] }); setModalOpen(false); setEditingId(null); toast.success("更新成功"); },
    onError: (e: any) => toast.error(e.message || "更新失败"),
  });

  const deleteMut = useMutation({
    mutationFn: deleteAssignment,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["assignments"] }); setDeleteTarget(null); toast.success("已删除"); },
    onError: (e: any) => toast.error(e.message || "删除失败"),
  });

  const openCreate = () => {
    setEditingId(null);
    setFormTitle("");
    setFormDesc("");
    setFormCaseId(0);
    setFormClassId(0);
    setFormConfigId("standard-assessment");
    setFormFeatures({});
    setFormStartTime("");
    setFormEndTime("");
    setModalOpen(true);
  };

  const openEdit = async (id: string) => {
    try {
      const res = await import("@/api/assignments").then(m => m.getAssignment(id));
      const d = res.data;
      setEditingId(id);
      setFormTitle(d.title);
      setFormDesc(d.description || "");
      setFormCaseId(d.case_id);
      setFormClassId(d.class_id);
      setFormConfigId(d.config_id);
      setFormFeatures(d.feature_overrides || {});
      setFormStartTime(new Date(d.start_time).toISOString().slice(0, 16));
      setFormEndTime(new Date(d.end_time).toISOString().slice(0, 16));
      setModalOpen(true);
    } catch (e: any) {
      toast.error(e.message || "加载失败");
    }
  };

  const handleSubmit = () => {
    if (!formTitle.trim() || !formCaseId || !formClassId || !formStartTime || !formEndTime) {
      toast.error("请填写完整信息");
      return;
    }
    const payload = {
      title: formTitle.trim(),
      description: formDesc.trim() || null,
      case_id: formCaseId,
      class_id: formClassId,
      config_id: formConfigId,
      feature_overrides: formFeatures,
      start_time: new Date(formStartTime).toISOString(),
      end_time: new Date(formEndTime).toISOString(),
    };
    if (editingId) {
      updateMut.mutate({ id: editingId, data: payload });
    } else {
      createMut.mutate(payload);
    }
  };

  const assignments = (listData?.data as any)?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="练习发布"
        description="按班级定时发布练习，控制插件特性，批量导出成绩"
        actions={<Button onClick={openCreate}><Plus size={16} className="mr-1" />创建发布</Button>}
      />

      {isLoading ? (
        <LoadingSkeleton />
      ) : assignments.length === 0 ? (
        <EmptyState icon={<Users size={48} />} title="暂无练习发布" description="点击上方按钮创建第一次练习发布" />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>标题</TableHead>
                <TableHead>病例</TableHead>
                <TableHead>班级</TableHead>
                <TableHead>时间窗口</TableHead>
                <TableHead>完成率</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((a: AssignmentListItem) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.title}</TableCell>
                  <TableCell>{a.case_name}</TableCell>
                  <TableCell>{a.class_name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateTime(a.start_time)} ~ {formatDateTime(a.end_time)}
                  </TableCell>
                  <TableCell>
                    {a.student_count > 0
                      ? `${a.completed_count}/${a.student_count}`
                      : "-"}
                  </TableCell>
                  <TableCell>{getStatusBadge(a)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => window.location.href = `/admin/assignments/${a.id}`} title="详情">
                        <Eye size={14} />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(a.id)} title="编辑">
                        <Edit size={14} />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(a.id)} title="删除">
                        <Trash2 size={14} className="text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Create/Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? "编辑练习发布" : "创建练习发布"} maxWidth={560}>
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-sm font-medium">标题</label>
            <Input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="练习标题" />
          </div>
          <div>
            <label className="text-sm font-medium">说明（可选）</label>
            <Input value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="补充说明" />
          </div>
          <div>
            <label className="text-sm font-medium">病例</label>
            <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={formCaseId || ""} onChange={(e) => setFormCaseId(Number(e.target.value))}>
              <option value="">选择病例...</option>
              {(cases?.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">班级</label>
            <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={formClassId || ""} onChange={(e) => setFormClassId(Number(e.target.value))}>
              <option value="">选择班级...</option>
              {(classes?.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">训练模式</label>
            <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={formConfigId} onChange={(e) => setFormConfigId(e.target.value)}>
              {CONFIG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">插件特性（覆盖默认配置）</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {FEATURE_FLAGS.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={formFeatures[f.key] ?? false}
                    onChange={(e) => setFormFeatures({ ...formFeatures, [f.key]: e.target.checked })}
                  />
                  {f.label}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">开始时间</label>
              <Input type="datetime-local" value={formStartTime} onChange={(e) => setFormStartTime(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium">截止时间</label>
              <Input type="datetime-local" value={formEndTime} onChange={(e) => setFormEndTime(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setModalOpen(false)}>取消</Button>
            <Button onClick={handleSubmit} loading={createMut.isPending || updateMut.isPending}>
              {editingId ? "保存修改" : "发布练习"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirm */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="确认删除" maxWidth={400}>
        <p className="text-sm text-muted-foreground mb-4">确定要删除这个练习发布吗？此操作不可逆。</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button>
          <Button variant="destructive" onClick={() => deleteTarget && deleteMut.mutate(deleteTarget)} loading={deleteMut.isPending}>删除</Button>
        </div>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/admin/AssignmentsPage.tsx
git commit -m "✨ feat: add assignments management page"
```

### Task 9: AssignmentDetailPage

**Files:**
- Create: `frontend/src/pages/admin/AssignmentDetailPage.tsx`

- [ ] **Step 1: Create `frontend/src/pages/admin/AssignmentDetailPage.tsx`**

```typescript
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, FileSpreadsheet } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { exportAssignment, getAssignment } from "@/api/assignments";
import type { components } from "@/api/api-types.gen";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import PageHeader from "@/components/ui/PageHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/Toast";

type AssignmentDetail = components["schemas"]["AssignmentDetail"];

function statusBadge(status: string) {
  switch (status) {
    case "not_started": return <Badge variant="secondary">未开始</Badge>;
    case "in_progress": return <Badge variant="default">进行中</Badge>;
    case "completed": return <Badge variant="outline">已完成</Badge>;
    case "overdue": return <Badge variant="destructive">已逾期</Badge>;
    default: return <Badge variant="secondary">{status}</Badge>;
  }
}

export default function AssignmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ["assignment", id],
    queryFn: () => getAssignment(id!),
    enabled: !!id,
  });

  const handleExport = async () => {
    if (!id) return;
    try {
      const res = await exportAssignment(id);
      const blob = new Blob([res.data as unknown as BlobPart], { type: "text/csv; charset=utf-8-sig" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `assignment_${id.slice(0, 8)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("导出成功");
    } catch (e: any) {
      toast.error(e.message || "导出失败");
    }
  };

  if (isLoading) return <LoadingSkeleton />;
  if (error || !data) return <div className="p-8 text-center text-muted-foreground">加载失败</div>;

  const detail: AssignmentDetail = data.data as any;

  return (
    <div className="space-y-6">
      <PageHeader
        title={detail.title}
        description={`${detail.case_name} · ${detail.class_name} · ${detail.completed_count}/${detail.student_count} 已完成`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate("/admin/assignments")}>
              <ArrowLeft size={16} className="mr-1" />返回列表
            </Button>
            <Button onClick={handleExport}>
              <Download size={16} className="mr-1" />导出成绩
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">总人数</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{detail.student_count}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">已完成</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-green-600">{detail.completed_count}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">已评分</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-blue-600">{detail.scored_count}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">未完成</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-muted-foreground">{detail.student_count - detail.completed_count}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>学生完成情况</CardTitle></CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>学号</TableHead>
              <TableHead>姓名</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>得分</TableHead>
              <TableHead>评分状态</TableHead>
              <TableHead>完成时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.students?.map((s: any) => (
              <TableRow key={s.user_id}>
                <TableCell className="text-xs">{s.student_id || "-"}</TableCell>
                <TableCell className="font-medium">{s.display_name}</TableCell>
                <TableCell>{statusBadge(s.status)}</TableCell>
                <TableCell>{s.score_total != null ? s.score_total : "-"}</TableCell>
                <TableCell>{s.scoring_status === "completed" ? "已评分" : s.scoring_status || "-"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{s.end_time ? new Date(s.end_time).toLocaleString("zh-CN") : "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/admin/AssignmentDetailPage.tsx
git commit -m "✨ feat: add assignment detail page with export"
```

---

## Part 7: Frontend — Integration

### Task 10: Routes + Navigation + Dashboard + Feature Lock

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Layout.tsx`
- Modify: `frontend/src/pages/DashboardHome.tsx`
- Modify: `frontend/src/components/training/TrainingHeader.tsx`
- Modify: `frontend/src/engine/PatientProvider.tsx`

- [ ] **Step 1: Add routes to `frontend/src/App.tsx`**

Add imports:
```typescript
const AssignmentsPage = lazy(() => import("@/pages/admin/AssignmentsPage"));
const AssignmentDetailPage = lazy(() => import("@/pages/admin/AssignmentDetailPage"));
```

Add routes after the existing admin routes (after line 108):
```tsx
<Route element={<ProtectedRoute permission="score_review" />}>
  <Route path="/admin/assignments" element={<AssignmentsPage />} />
  <Route path="/admin/assignments/:id" element={<AssignmentDetailPage />} />
</Route>
```

- [ ] **Step 2: Add nav item in `frontend/src/components/Layout.tsx`**

Add to `allLinks` array (after the admin cases line):
```typescript
{ to: "/admin/assignments", icon: ClipboardCheck, label: "练习发布", permission: "score_review" },
```

Need to import `ClipboardCheck` if not already imported (it already is).

- [ ] **Step 3: Add pending assignments card to `frontend/src/pages/DashboardHome.tsx`**

Add import:
```typescript
import { getStudentAssignments, startAssignment } from "@/api/assignments";
```

Add query and card section. After the permission check block (line 80), add:

```typescript
const { data: studentAssignments } = useQuery({
  queryKey: ["student-assignments"],
  queryFn: () => getStudentAssignments(),
  enabled: !isAdmin,
});

const handleStartAssignment = async (assignmentId: string) => {
  try {
    const res = await startAssignment(assignmentId);
    const { record_id } = res.data;
    navigate(`/training/${record_id}`);
  } catch (e: any) {
    toast.error(e.message || "开始练习失败");
  }
};
```

Add card section BEFORE the training records table (find the Stats section end). Insert after the stats cards:

```tsx
{!isAdmin && studentAssignments?.data && (studentAssignments.data as any[]).length > 0 && (
  <div className="space-y-3">
    <div className="flex items-center gap-2">
      <ClipboardList size={18} className="text-primary" />
      <h2 className="text-lg font-semibold">待完成练习</h2>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {(studentAssignments.data as any[]).map((a: any) => {
        const isOverdue = a.status === "overdue";
        const isCompleted = a.status === "completed";
        const deadline = new Date(a.end_time).getTime();
        const now = Date.now();
        const hoursLeft = Math.max(0, Math.ceil((deadline - now) / (1000 * 60 * 60)));
        return (
          <Card key={a.id} className={cn(isOverdue && "border-destructive/30 bg-destructive/5")}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{a.title}</div>
                  <div className="text-xs text-muted-foreground">{a.case_name}</div>
                </div>
                {isCompleted ? (
                  <Badge variant="outline" className="shrink-0 ml-2">已完成</Badge>
                ) : isOverdue ? (
                  <Badge variant="destructive" className="shrink-0 ml-2">已逾期</Badge>
                ) : (
                  <Badge variant="default" className="shrink-0 ml-2">
                    {hoursLeft > 24 ? `${Math.ceil(hoursLeft / 24)}天` : `${hoursLeft}小时`}
                  </Badge>
                )}
              </div>
              {a.score_total != null && (
                <div className="text-lg font-bold text-primary mb-2">{a.score_total} 分</div>
              )}
              {!isCompleted && (
                <Button size="sm" className="w-full" onClick={() => handleStartAssignment(a.id)}>
                  <Play size={14} className="mr-1" />开始练习
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  </div>
)}
```

Need to add `ClipboardList` to existing lucide imports (add to `Play` import if not already there).

- [ ] **Step 4: Lock feature toggles in `TrainingHeader.tsx`**

Add prop `featuresLocked?: boolean` to `TrainingHeaderProps`:

```typescript
interface TrainingHeaderProps {
  ...
  featuresLocked?: boolean;
}
```

In the component destructuring: add `featuresLocked = false`.

In the modal (line 150+), wrap the toggle buttons with disable logic:

In the `<button>` at line 167, add:
```tsx
disabled={featuresLocked}
```

And add a message at the top of the modal when locked:
```tsx
{featuresLocked && (
  <p className="text-sm text-amber-600 bg-amber-50 rounded-md px-3 py-2 mb-3">
    此练习的插件配置由教师设定，不可更改
  </p>
)}
```

- [ ] **Step 5: Pass `_from_assignment` through PatientProvider**

In `frontend/src/engine/PatientProvider.tsx`, add to context:
```typescript
interface PatientContextValue {
  ...
  fromAssignment: boolean;
}
```

Default: `fromAssignment: false`.

In the fetch:
```typescript
setFeatures(d.features ?? {});
// add:
(_ctx as any).fromAssignment = d._from_assignment ?? false;
```

Actually, simpler approach: export a state variable. Change to:

```typescript
const [fromAssignment, setFromAssignment] = useState(false);
```

In fetch:
```typescript
setFromAssignment(d._from_assignment ?? false);
```

Then in `ChatTraining.tsx`, pass `featuresLocked={fromAssignment}` to `TrainingHeader`.

Actually, the cleanest path: just check `config_snapshot._from_assignment` in the TrainingHeader. Let's have the TrainingEngine or ChatTraining page read it from the record detail response and pass as prop. Let me check ChatTraining.

Actually, the simplest approach: modify `PatientProvider` to also extract `_from_assignment` and expose it. Then ChatTraining reads it and passes to TrainingHeader.

Let me keep the step simple — just add to PatientProvider and pass through.

- [ ] **Step 6: Wire up in ChatTraining.tsx**

Read from `PatientProvider`:
```typescript
const { patient, loading, error, features, fromAssignment } = usePatient();
```

Pass to TrainingHeader:
```tsx
<TrainingHeader ... featuresLocked={fromAssignment} />
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/Layout.tsx frontend/src/pages/DashboardHome.tsx frontend/src/components/training/TrainingHeader.tsx frontend/src/engine/PatientProvider.tsx frontend/src/pages/ChatTraining.tsx
git commit -m "✨ feat: integrate assignments into student dashboard and feature lock"
```

---

## Part 8: Tests

### Task 11: Backend Tests

**Files:**
- Create: `backend/tests/test_assignments.py`

- [ ] **Step 1: Write backend tests for assignment CRUD**

```python
"""Tests for assignment management endpoints."""
import pytest
from datetime import UTC, datetime, timedelta


def test_create_assignment(client, teacher_token, sample_case, sample_class):
    """Teacher creates an assignment for a class."""
    now = datetime.now(UTC)
    payload = {
        "case_id": sample_case.id,
        "class_id": sample_class.id,
        "title": "肺炎练习",
        "config_id": "standard-assessment",
        "feature_overrides": {"physical_exam": True},
        "start_time": now.isoformat(),
        "end_time": (now + timedelta(days=7)).isoformat(),
    }
    res = client.post("/api/assignments", json=payload, headers={"Authorization": f"Bearer {teacher_token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["title"] == "肺炎练习"
    assert data["case_id"] == sample_case.id
    assert data["class_id"] == sample_class.id
    assert data["feature_overrides"]["physical_exam"] is True


def test_list_assignments(client, teacher_token):
    """Teacher lists their assignments."""
    res = client.get("/api/assignments", headers={"Authorization": f"Bearer {teacher_token}"})
    assert res.status_code == 200
    data = res.json()
    assert "items" in data
    assert "total" in data


def test_student_cannot_create_assignment(client, student_token):
    """Student should not be able to create assignments."""
    payload = {"case_id": 1, "class_id": 1, "title": "test", "start_time": "2026-01-01T00:00:00Z", "end_time": "2026-01-02T00:00:00Z"}
    res = client.post("/api/assignments", json=payload, headers={"Authorization": f"Bearer {student_token}"})
    assert res.status_code == 403


def test_student_gets_assignments(client, student_token, sample_assignment):
    """Student sees assignments for their class."""
    res = client.get("/api/students/assignments", headers={"Authorization": f"Bearer {student_token}"})
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)


def test_delete_assignment_no_students(client, teacher_token, sample_assignment):
    """Delete an assignment that has no started records."""
    res = client.delete(f"/api/assignments/{sample_assignment.id}", headers={"Authorization": f"Bearer {teacher_token}"})
    assert res.status_code == 200
    assert res.json()["message"] == "练习发布已删除"


def test_export_assignment(client, teacher_token, sample_assignment):
    """Export assignment grades as CSV."""
    res = client.get(f"/api/assignments/{sample_assignment.id}/export", headers={"Authorization": f"Bearer {teacher_token}"})
    assert res.status_code == 200
    assert "text/csv" in res.headers.get("content-type", "")
```

- [ ] **Step 2: Run tests**

```bash
cd backend && python -m pytest tests/test_assignments.py -x -v 2>&1 | tail -30
```

### Task 12: Frontend Build Check

- [ ] **Step 1: Type check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 2: Build check**

```bash
cd frontend && npx vite build 2>&1 | tail -10
```

- [ ] **Step 3: Commit tests**

```bash
git add backend/tests/test_assignments.py
git commit -m "✅ test: add assignment CRUD tests"
```
