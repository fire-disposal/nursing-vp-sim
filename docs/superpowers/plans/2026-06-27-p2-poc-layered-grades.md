# Plan 2 (P2 PoC)：分层范式基座 + grades 域改造 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 落地「约定优于配置的分层」范式的可复用基座（`ValidationError` 异常、`unit_of_work` 事务、`Repository[T]` 基类、DI 别名、新增 `services/` 层），并以 `grades` 域为 PoC 完成「薄路由 → service → repository」改造，移除其 `tenant_scope`，冻结基类设计供后续域复用。

**Architecture:** 三层 + 横切。路由只解析入参/调 service/返回 schema；`GradeService` 持业务规则（唯一性、删除守卫、计数）并用 `unit_of_work` 管理事务与 `IntegrityError→ConflictError` 映射；`GradeRepository(Repository[Grade])` 持数据访问（`db.flush()` 不 commit）。错误统一抛 `core/exceptions` 类型（404/400/409），由 FastAPI 异常处理映射。

**Tech Stack:** FastAPI + SQLAlchemy 2.0（`Mapped`/`db.get`/`db.query`）+ Pydantic v2；后端 `uv run` from `backend/`。

**关联:** 设计 `docs/superpowers/specs/2026-06-27-multi-tenant-removal-and-layered-refactor-design.md` §3-§5 P2。分支 `refactor/strip-multi-tenancy`（当前分支直接开干）。

> 重要约束（行为保持）：`grades` 单租户下 `tenant_scope` 本就是 no-op（super_admin→None 无过滤；其余→school_id=1 全匹配），移除后结果不变；状态码必须保持（400 业务校验 / 404 不存在 / 409 竞态）。Windows PowerShell：串行用 `;`。
> 范围：本 PoC **仅改 grades**；`classes`/其余域留待后续 plan；`make_crud_router` 工厂暂不实现；`tenant_scope` 定义保留（仍有其他调用者）。

---

### Task 1: 新增 `ValidationError`(400) 异常 + 注册处理器

**Files:**
- Modify: `backend/core/exceptions.py`
- Modify: `backend/main.py`（异常处理器注册处，约 387-399 行）
- Test: `backend/tests/core/test_exceptions.py`

- [ ] **Step 1: 写失败测试**

在 `backend/tests/core/test_exceptions.py` 末尾追加：
```python
def test_validation_error_is_400():
    from core.exceptions import ValidationError

    err = ValidationError("名称重复")
    assert err.status_code == 400
    assert err.detail == "名称重复"
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend; uv run python -m pytest tests/core/test_exceptions.py::test_validation_error_is_400 -q`
Expected: FAIL（`ImportError`/`AttributeError: ValidationError`）。

- [ ] **Step 3: 实现 `ValidationError`**

在 `backend/core/exceptions.py` 的 `ConflictError` 类之后插入：
```python
class ValidationError(HTTPException):
    """Business-rule validation failure (400)."""

    def __init__(self, detail: str = "请求无效"):
        super().__init__(status_code=400, detail=detail)
```
并在文件「Exception handlers」区追加处理器（紧邻 `conflict_handler` 之后）：
```python
async def validation_error_handler(request: Request, exc: ValidationError):
    return await _log_and_respond(request, exc.status_code, exc.detail)
```

- [ ] **Step 4: 注册处理器**

在 `backend/main.py` 注册自定义异常处理器处（与 `conflict_handler` 等并列），读取该文件确认现有 `app.add_exception_handler(ConflictError, conflict_handler)` 一行，在其后追加：
```python
    app.add_exception_handler(ValidationError, validation_error_handler)
```
并确保该函数已在 main.py 的 `from core.exceptions import (...)` 导入列表中加入 `ValidationError, validation_error_handler`。

- [ ] **Step 5: 运行通过**

Run: `cd backend; uv run python -m pytest tests/core/test_exceptions.py -q; uv run ruff check core/exceptions.py main.py; uv run python -c "from main import app; print('app ok')"`
Expected: 测试 PASS；ruff clean；打印 `app ok`。

- [ ] **Step 6: 提交**
```bash
git add backend/core/exceptions.py backend/main.py backend/tests/core/test_exceptions.py
git commit -m "✨ feat: 新增 ValidationError(400) 异常及处理器"
```

---

### Task 2: 新增 `unit_of_work` 事务上下文

**Files:**
- Create: `backend/core/unit_of_work.py`
- Test: `backend/tests/core/test_unit_of_work.py`

- [ ] **Step 1: 写失败测试**

Create `backend/tests/core/test_unit_of_work.py`:
```python
import pytest
from sqlalchemy.exc import IntegrityError

from core.exceptions import ConflictError
from core.unit_of_work import unit_of_work


class _FakeSession:
    def __init__(self):
        self.committed = False
        self.rolled_back = False

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True


def test_commits_on_success():
    db = _FakeSession()
    with unit_of_work(db):
        pass
    assert db.committed and not db.rolled_back


def test_rolls_back_and_reraises_on_error():
    db = _FakeSession()
    with pytest.raises(RuntimeError):
        with unit_of_work(db):
            raise RuntimeError("boom")
    assert db.rolled_back and not db.committed


def test_maps_integrity_error_to_conflict():
    db = _FakeSession()
    with pytest.raises(ConflictError):
        with unit_of_work(db, conflict_detail="dup"):
            raise IntegrityError("stmt", {}, Exception("orig"))
    assert db.rolled_back
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend; uv run python -m pytest tests/core/test_unit_of_work.py -q`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

Create `backend/core/unit_of_work.py`:
```python
"""Transactional unit-of-work for the request path.

Wrap a mutation block: commit on success; on failure roll back and map
DB integrity violations to a ConflictError (409) so handlers stay clean.
"""

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.exceptions import ConflictError


@contextmanager
def unit_of_work(db: Session, *, conflict_detail: str = "资源冲突") -> Iterator[Session]:
    try:
        yield db
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise ConflictError(conflict_detail) from e
    except Exception:
        db.rollback()
        raise
```

- [ ] **Step 4: 运行通过**

Run: `cd backend; uv run python -m pytest tests/core/test_unit_of_work.py -q; uv run ruff check core/unit_of_work.py; uv run ty check core/unit_of_work.py`
Expected: 3 passed；ruff/ty clean。

- [ ] **Step 5: 提交**
```bash
git add backend/core/unit_of_work.py backend/tests/core/test_unit_of_work.py
git commit -m "✨ feat: 新增 unit_of_work 事务上下文（commit/rollback + IntegrityError→ConflictError）"
```

---

### Task 3: `Repository[TModel]` 同步请求路径基类

**Files:**
- Modify: `backend/repositories/base.py`（**追加** `Repository` 类，保留现有 `SyncRepository`）
- Test: `backend/tests/core/test_repository_base.py`

> 说明：现有 `SyncRepository` 是异步线程池基类（后台任务用），与请求路径不同。新增的同步 `Repository[T]` 才是路由层用的基类。

- [ ] **Step 1: 写失败测试**（用内存 sqlite 验证泛型 CRUD）

Create `backend/tests/core/test_repository_base.py`:
```python
import pytest
from sqlalchemy import Integer, String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from core.exceptions import NotFoundError
from repositories.base import Repository


class _Base(DeclarativeBase):
    pass


class _Widget(_Base):
    __tablename__ = "widgets"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(40))


class _WidgetRepo(Repository[_Widget]):
    model = _Widget


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    _Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()


def test_add_get_exists_delete(db):
    repo = _WidgetRepo(db)
    w = repo.add(_Widget(name="a"))
    db.commit()
    assert repo.get(w.id).name == "a"
    assert repo.exists(_Widget.name == "a") is True
    assert repo.exists(_Widget.name == "zzz") is False
    repo.delete(w)
    db.commit()
    assert repo.get(w.id) is None


def test_get_or_404_raises(db):
    repo = _WidgetRepo(db)
    with pytest.raises(NotFoundError):
        repo.get_or_404(999, "没有")
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend; uv run python -m pytest tests/core/test_repository_base.py -q`
Expected: FAIL（`ImportError: Repository`）。

- [ ] **Step 3: 实现**（在 `backend/repositories/base.py` 末尾追加）
```python
from typing import Generic, TypeVar

from core.exceptions import NotFoundError

TModel = TypeVar("TModel")


class Repository(Generic[TModel]):
    """Synchronous request-path repository base.

    Subclasses set ``model`` and receive a request-scoped ``Session``.
    Methods ``flush`` (never ``commit``) — committing is the caller's
    ``unit_of_work`` responsibility.
    """

    model: type[TModel]

    def __init__(self, db: Session):
        self.db = db

    def get(self, id_: int) -> TModel | None:
        return self.db.get(self.model, id_)

    def get_or_404(self, id_: int, detail: str = "资源不存在") -> TModel:
        obj = self.get(id_)
        if obj is None:
            raise NotFoundError(detail)
        return obj

    def query(self):
        return self.db.query(self.model)

    def list(self, *criteria, order_by=None) -> list[TModel]:
        q = self.query()
        if criteria:
            q = q.filter(*criteria)
        if order_by is not None:
            q = q.order_by(order_by)
        return q.all()

    def exists(self, *criteria) -> bool:
        return bool(self.db.query(self.query().filter(*criteria).exists()).scalar())

    def add(self, obj: TModel) -> TModel:
        self.db.add(obj)
        self.db.flush()
        return obj

    def delete(self, obj: TModel) -> None:
        self.db.delete(obj)
        self.db.flush()
```
（`base.py` 顶部已 `from sqlalchemy.orm import Session`；若 `TypeVar` 已导入则勿重复。）

- [ ] **Step 4: 运行通过**

Run: `cd backend; uv run python -m pytest tests/core/test_repository_base.py -q; uv run ruff check repositories/base.py; uv run ty check repositories/base.py`
Expected: 2 passed；ruff/ty clean。

- [ ] **Step 5: 提交**
```bash
git add backend/repositories/base.py backend/tests/core/test_repository_base.py
git commit -m "✨ feat: 新增同步请求路径 Repository[T] 基类"
```

---

### Task 4: DI 别名 `DbSession` / `CurrentUser`

**Files:**
- Create: `backend/core/deps.py`

- [ ] **Step 1: 实现**

Create `backend/core/deps.py`:
```python
"""Standard FastAPI dependency aliases for thin routers."""

from typing import Annotated

from fastapi import Depends
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import get_current_user
from models import User

DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]
```

- [ ] **Step 2: 校验**

Run: `cd backend; uv run ruff check core/deps.py; uv run ty check core/deps.py; uv run python -c "from core.deps import DbSession, CurrentUser; print('deps ok')"`
Expected: clean；打印 `deps ok`。

- [ ] **Step 3: 提交**
```bash
git add backend/core/deps.py
git commit -m "✨ feat: 新增 DbSession/CurrentUser 依赖别名"
```

---

### Task 5: `GradeRepository`

**Files:**
- Create: `backend/repositories/grade.py`
- Test: `backend/tests/admin/test_grade_repository.py`

- [ ] **Step 1: 写失败测试**

Create `backend/tests/admin/test_grade_repository.py`:
```python
from models import Grade

from repositories.grade import GradeRepository


def test_name_exists_and_counts(db_session):
    repo = GradeRepository(db_session)

    g = repo.add(Grade(name="2024级", school_id=1))
    db_session.commit()
    assert repo.name_exists("2024级") is True
    assert repo.name_exists("2024级", exclude_id=g.id) is False
    assert repo.name_exists("不存在") is False
    assert repo.class_counts([g.id]) == {}
    assert repo.list_ordered()[0].name == "2024级"
```
> 已确认（conftest.py）：会话 fixture = `db_session`（yields `Session`）；`engine` fixture 已插入 `schools` id=1（"默认学校"）+ roles(teacher id=1 含 `grade_class_manage`、student id=2)。直接用 `school_id=1`。各测试用例的 engine 独立（每用例 drop/create），无跨用例污染。

- [ ] **Step 2: 运行确认失败**

Run: `cd backend; uv run python -m pytest tests/admin/test_grade_repository.py -q`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

Create `backend/repositories/grade.py`:
```python
from sqlalchemy import func

from models import Assignment, Class, Grade, UserClass
from repositories.base import Repository


class GradeRepository(Repository[Grade]):
    model = Grade

    def list_ordered(self) -> list[Grade]:
        return self.db.query(Grade).order_by(Grade.name).all()

    def name_exists(self, name: str, exclude_id: int | None = None) -> bool:
        q = self.db.query(Grade).filter(Grade.name == name)
        if exclude_id is not None:
            q = q.filter(Grade.id != exclude_id)
        return bool(self.db.query(q.exists()).scalar())

    def class_counts(self, grade_ids: list[int]) -> dict[int, int]:
        if not grade_ids:
            return {}
        rows = (
            self.db.query(Class.grade_id, func.count(Class.id))
            .filter(Class.grade_id.in_(grade_ids))
            .group_by(Class.grade_id)
            .all()
        )
        return {gid: c for gid, c in rows}

    def student_counts(self, grade_ids: list[int]) -> dict[int, int]:
        if not grade_ids:
            return {}
        rows = (
            self.db.query(Class.grade_id, func.count(UserClass.user_id))
            .join(UserClass, Class.id == UserClass.class_id)
            .filter(Class.grade_id.in_(grade_ids))
            .group_by(Class.grade_id)
            .all()
        )
        return {gid: c for gid, c in rows}

    def class_ids_for(self, grade_id: int) -> list[int]:
        return [row[0] for row in self.db.query(Class.id).filter(Class.grade_id == grade_id).all()]

    def assignment_count_for_classes(self, class_ids: list[int]) -> int:
        if not class_ids:
            return 0
        return self.db.query(func.count(Assignment.id)).filter(Assignment.class_id.in_(class_ids)).scalar() or 0
```

- [ ] **Step 4: 运行通过**

Run: `cd backend; uv run python -m pytest tests/admin/test_grade_repository.py -q; uv run ruff check repositories/grade.py; uv run ty check repositories/grade.py`
Expected: PASS；clean。

- [ ] **Step 5: 提交**
```bash
git add backend/repositories/grade.py backend/tests/admin/test_grade_repository.py
git commit -m "✨ feat: 新增 GradeRepository"
```

---

### Task 6: `GradeService`（新增 `services/` 层）

**Files:**
- Create: `backend/services/__init__.py`（空文件）
- Create: `backend/services/grade.py`
- Test: `backend/tests/admin/test_grade_service.py`

- [ ] **Step 1: 写失败测试**

Create `backend/tests/admin/test_grade_service.py`:
```python
import pytest

from core.exceptions import ConflictError, NotFoundError, ValidationError
from services.grade import GradeService

SCHOOL_ID = 1  # conftest 已插入 id=1 的默认学校


def test_create_list_update(db_session):
    svc = GradeService(db_session)
    v = svc.create("2024级", school_id=SCHOOL_ID)
    assert v.name == "2024级" and v.class_count == 0
    assert any(g.name == "2024级" for g in svc.list())
    v2 = svc.update(v.id, "2025级")
    assert v2.name == "2025级"


def test_create_duplicate_raises_validation(db_session):
    svc = GradeService(db_session)
    svc.create("重复级", school_id=SCHOOL_ID)
    with pytest.raises(ValidationError):
        svc.create("重复级", school_id=SCHOOL_ID)


def test_update_missing_raises_not_found(db_session):
    svc = GradeService(db_session)
    with pytest.raises(NotFoundError):
        svc.update(99999, "x")


def test_delete_empty_grade(db_session):
    svc = GradeService(db_session)
    v = svc.create("待删级", school_id=SCHOOL_ID)
    assert svc.delete(v.id) == 0
```
> 若 conftest 的会话 fixture 名不是 `db_session`，按实际名替换（读取 conftest 确认）。

- [ ] **Step 2: 运行确认失败**

Run: `cd backend; uv run python -m pytest tests/admin/test_grade_service.py -q`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

Create `backend/services/__init__.py`（空）。
Create `backend/services/grade.py`:
```python
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import update as sa_update
from sqlalchemy.orm import Session

from core.exceptions import ValidationError
from core.unit_of_work import unit_of_work
from models import Grade, UserClass
from repositories.grade import GradeRepository


@dataclass
class GradeView:
    id: int
    name: str
    class_count: int
    student_count: int
    created_at: datetime


class GradeService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = GradeRepository(db)

    def _view(self, grade: Grade, class_count: int = 0, student_count: int = 0) -> GradeView:
        return GradeView(grade.id, grade.name, class_count, student_count, grade.created_at)

    def list(self) -> list[GradeView]:
        grades = self.repo.list_ordered()
        ids = [g.id for g in grades]
        cc = self.repo.class_counts(ids)
        sc = self.repo.student_counts(ids)
        return [self._view(g, cc.get(g.id, 0), sc.get(g.id, 0)) for g in grades]

    def create(self, name: str, *, school_id: int) -> GradeView:
        # school_id 为 P3 前的过渡参数（grades.school_id 仍 NOT NULL）
        if self.repo.name_exists(name):
            raise ValidationError("年级已存在")
        with unit_of_work(self.db, conflict_detail="年级已存在"):
            grade = self.repo.add(Grade(name=name, school_id=school_id))
        return self._view(grade)

    def update(self, grade_id: int, name: str) -> GradeView:
        grade = self.repo.get_or_404(grade_id, "年级不存在")
        if name != grade.name and self.repo.name_exists(name, exclude_id=grade_id):
            raise ValidationError("年级名称重复")
        with unit_of_work(self.db, conflict_detail="年级名称重复"):
            grade.name = name
            self.db.flush()
        cc = self.repo.class_counts([grade.id])
        sc = self.repo.student_counts([grade.id])
        return self._view(grade, cc.get(grade.id, 0), sc.get(grade.id, 0))

    def delete(self, grade_id: int) -> int:
        grade = self.repo.get_or_404(grade_id, "年级不存在")
        class_ids = self.repo.class_ids_for(grade_id)
        assignment_count = self.repo.assignment_count_for_classes(class_ids)
        if assignment_count > 0:
            raise ValidationError(f"该年级下有 {assignment_count} 个作业引用，无法删除。请先删除相关作业。")
        class_count = len(class_ids)
        with unit_of_work(self.db, conflict_detail="操作冲突：该年级下在删除过程中新增了关联资源，请刷新后重试。"):
            if class_ids:
                self.db.execute(sa_update(UserClass).where(UserClass.class_id.in_(class_ids)).values(class_id=None))
            self.repo.delete(grade)
        return class_count
```

- [ ] **Step 4: 运行通过**

Run: `cd backend; uv run python -m pytest tests/admin/test_grade_service.py -q; uv run ruff check services/; uv run ty check services/`
Expected: PASS；clean。

- [ ] **Step 5: 提交**
```bash
git add backend/services/__init__.py backend/services/grade.py backend/tests/admin/test_grade_service.py
git commit -m "✨ feat: 新增 services 层 + GradeService（含删除守卫/唯一性/事务）"
```

---

### Task 7: 重写 `grades.py` 为薄路由（移除 tenant_scope）

**Files:**
- Modify: `backend/routers/admin/grades.py`（整体重写）
- Verify: `backend/tests/admin/test_grades_classes.py`（既有集成测试，**必须保持绿**）

- [ ] **Step 1: 先跑既有集成测试建立基线**

Run: `cd backend; uv run python -m pytest tests/admin/test_grades_classes.py -q`
Expected: 记录当前 PASS 数（基线）。

- [ ] **Step 2: 重写路由**

将 `backend/routers/admin/grades.py` 整个替换为：
```python
from typing import Annotated

from fastapi import APIRouter, Depends

from core.deps import DbSession
from core.security import require_permission
from models import User
from schemas import DeleteResponse, GradeCreate, GradeResponse, GradeUpdate
from services.grade import GradeService

router = APIRouter(prefix="/api/admin/grades", tags=["年级管理"])

_Manager = Annotated[User, Depends(require_permission("grade_class_manage"))]


def _resp(view) -> GradeResponse:
    return GradeResponse(
        id=view.id,
        name=view.name,
        class_count=view.class_count,
        student_count=view.student_count,
        created_at=view.created_at,
    )


@router.get("", response_model=list[GradeResponse])
def list_grades(current_user: _Manager, db: DbSession):
    return [_resp(v) for v in GradeService(db).list()]


@router.post("", response_model=GradeResponse)
def create_grade(body: GradeCreate, current_user: _Manager, db: DbSession):
    return _resp(GradeService(db).create(body.name, school_id=current_user.school_id))


@router.put("/{grade_id}", response_model=GradeResponse)
def update_grade(grade_id: int, body: GradeUpdate, current_user: _Manager, db: DbSession):
    return _resp(GradeService(db).update(grade_id, body.name))


@router.delete("/{grade_id}", response_model=DeleteResponse)
def delete_grade(grade_id: int, current_user: _Manager, db: DbSession):
    class_count = GradeService(db).delete(grade_id)
    return {"message": f"已删除年级及其下 {class_count} 个班级"}
```
> 注意：不再 import `tenant_scope`/`func`/`Grade`/`Class` 等；路由不再直接 commit。`current_user` 仅用于权限与 `school_id`（过渡）。

- [ ] **Step 3: 既有集成测试保持绿**

Run: `cd backend; uv run python -m pytest tests/admin/test_grades_classes.py -q`
Expected: PASS 数 ≥ Step 1 基线，**0 失败**。若出现失败：
- 若是状态码差异（如期望 400 实得 409 或反之），核对 service 的异常类型（业务校验=`ValidationError`/400，竞态=`ConflictError`/409，不存在=`NotFoundError`/404），调整 service 而非测试。
- 若是断言 `school_id` 过滤行为（多校隔离），属预期移除——但单租户测试不应存在此类用例；若存在请报告，勿擅改测试语义。

- [ ] **Step 4: 局部校验**

Run: `cd backend; uv run ruff check routers/admin/grades.py; uv run ty check routers/admin/grades.py; uv run python -c "from main import app; print('app ok')"`
Expected: clean；`app ok`。

- [ ] **Step 5: 提交**
```bash
git add backend/routers/admin/grades.py
git commit -m "♻️ refactor: grades 改为薄路由→service→repository 并移除 tenant_scope"
```

---

### Task 8: PoC 全量校验 + 契约确认

- [ ] **Step 1: 全量 check**

Run: `cd backend; uv run ruff format --check .; uv run ruff check .; uv run ty check .`
Expected: 全绿。

- [ ] **Step 2: 后端测试（grades 域 + 新增单测 + 全量）**

Run: `cd backend; uv run python -m pytest tests/admin/ tests/core/ -x -q`
Then: `cd backend; uv run python -m pytest -x -q`
Expected: 全 PASS（与 P1 基线 432 起，新增本 PoC 单测后数量增加，0 失败）。

- [ ] **Step 2.5: API 契约未变**

Run: `pnpm run check:api`
Expected: 退出 0（GradeResponse/端点契约未变，gen 文件无 diff）。若有 diff 说明意外改了契约——排查（不应发生）。

- [ ] **Step 3: 前端不受影响确认**

Run: `cd frontend; npx tsc --noEmit`
Expected: TSC 0 errors（本 PoC 不动前端）。

- [ ] **Step 4: PoC 基类冻结说明（不提交代码，仅核对）**

确认 PoC 产出的可复用基座已就位且自洽：`core/exceptions.ValidationError`、`core/unit_of_work.unit_of_work`、`repositories/base.Repository[T]`、`core/deps.{DbSession,CurrentUser}`、`services/` 层 + `GradeService` 模式、薄路由模板（grades）。这套即后续域复用的「冻结模板」。

---

## Self-Review 注记

- **Spec 覆盖**：落地设计 §3 支柱①（Repository[T]，工厂延后）、②（unit_of_work 事务 + 异常词汇 + DI 别名）、③（薄路由 + services 层）；collapse `tenant_scope` 于 grades（设计 §5 P2 首域 PoC）。
- **行为保持**：状态码 400/404/409 与原一致（新增 `ValidationError`=400 对应原 400 业务校验）；单租户下移除 tenant_scope 为 no-op；`create` 过渡保留 `school_id` 以满足 NOT NULL（P3 移除）。
- **非目标**：未实现 `make_crud_router`（待 ≥2 域）；未改 `classes`/其余 16 文件；`tenant_scope` 定义保留；不动前端/DDL/迁移；不重生类型（契约未变）。
- **类型一致**：`GradeView` 字段与 `GradeResponse` 字段对齐；`Repository.model` 类属性 + `db.get`/`db.query` 一致；`unit_of_work` 签名与 service 调用一致。
- **复审点**：PoC 完成后向用户呈现冻结基类，确认后再开 Plan 3 推广（classes 起）。
