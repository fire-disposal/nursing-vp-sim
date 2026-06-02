# RBAC + 年级班级管理 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为虚拟患者训练系统建立 RBAC 权限基础设施 + 年级/班级组织模型，使系统可被卫校实际部署使用。

**Architecture:** 新增 `roles`/`role_permissions` 表构建权限基础，`grades`/`classes`/`user_class` 表构建组织层级。User.role 改为 FK 指向 roles.name，权限通过 `has_permission()` 检查。班级仅作筛选维度（方案 A），不做权限隔离。

**Tech Stack:** Python 3.13 / FastAPI / SQLAlchemy 2.0 / Alembic / PostgreSQL 15 / React 19

---

## 文件结构

| 文件 | 职责 | 操作 |
|------|------|------|
| `backend/models.py` | ORM 模型定义 | 修改 |
| `backend/schemas.py` | Pydantic 请求/响应 schema | 修改 |
| `backend/auth.py` | 认证 + 权限守卫 | 修改 |
| `backend/main.py` | FastAPI 入口 + seed data | 修改 |
| `backend/routers/admin_grades.py` | 年级 CRUD API | **新建** |
| `backend/routers/admin_classes.py` | 班级 CRUD API | **新建** |
| `backend/routers/admin.py` | 用户管理 API（增强） | 修改 |
| `backend/routers/stats.py` | 统计 API（增强） | 修改 |
| `backend/routers/training.py` | 训练记录 API（增强） | 修改 |
| `backend/migrations/versions/<hash>_rbac_classes_init.py` | Alembic 迁移 | **新建** |
| `frontend/src/api.js` | 前端 API 客户端 | 修改 |
| `frontend/src/App.jsx` | 路由配置 | 修改 |
| `frontend/src/components/AppShell.jsx` | 侧边栏导航 | 修改 |
| `frontend/src/components/teacher/ClassFilter.jsx` | 班级筛选器组件 | **新建** |
| `frontend/src/components/teacher/UsersTab.jsx` | 用户管理 Tab | 修改 |
| `frontend/src/pages/admin/GradesClassesPage.jsx` | 年级班级管理页面 | **新建** |
| `frontend/src/pages/DashboardHome.jsx` | 教师仪表盘增强 | 修改 |

---

### Task 1: Alembic 迁移脚本 — RBAC + 年级班级表

**Files:**
- Create: `backend/migrations/versions/<hash>_rbac_classes_init.py`

> 注意: 迁移 revision ID 和 down_revision 需要在实际生成时确定。以下为完整迁移内容。

- [ ] **Step 1: 创建迁移文件**

先确认当前最新迁移版本:

```bash
cd backend; alembic heads
```

输出最新的 revision ID，记为 `<head>`。然后:

```bash
cd backend; alembic revision -m "rbac_classes_init"
```

- [ ] **Step 2: 编写迁移 upgrade()**

将生成的空文件替换为以下内容（注意 `down_revision` 改为查到的 `<head>`）：

```python
"""rbac_classes_init

Revision ID: <auto>
Revises: <head>
Create Date: <auto>
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '<auto>'
down_revision: Union[str, Sequence[str], None] = '<head>'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(table_name: str) -> bool:
    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_name=:name AND table_schema=current_schema()"
    ), {"name": table_name}).fetchall()
    return len(rows) > 0


def _index_exists(table_name: str, index_name: str) -> bool:
    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT indexname FROM pg_indexes "
        "WHERE tablename=:tbl AND indexname=:idx AND schemaname=current_schema()"
    ), {"tbl": table_name, "idx": index_name}).fetchall()
    return len(rows) > 0


def upgrade() -> None:
    # 1. 创建 roles 表
    if not _table_exists("roles"):
        op.create_table("roles",
            sa.Column("name", sa.String(20), nullable=False),
            sa.Column("display_name", sa.String(40), nullable=False),
            sa.Column("is_system", sa.Boolean(), nullable=False, server_default="false"),
            sa.PrimaryKeyConstraint("name"),
        )

    # 2. 创建 role_permissions 表
    if not _table_exists("role_permissions"):
        op.create_table("role_permissions",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("role_name", sa.String(20), sa.ForeignKey("roles.name", ondelete="CASCADE"), nullable=False),
            sa.Column("permission", sa.String(40), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        if not _index_exists("role_permissions", "ix_rp_role_perm"):
            op.create_index("ix_rp_role_perm", "role_permissions", ["role_name", "permission"], unique=True)

    # 3. 创建 grades 表
    if not _table_exists("grades"):
        op.create_table("grades",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(40), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("name"),
        )

    # 4. 创建 classes 表
    if not _table_exists("classes"):
        op.create_table("classes",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("grade_id", sa.Integer(), sa.ForeignKey("grades.id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.String(60), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("grade_id", "name"),
        )
        if not _index_exists("classes", "ix_classes_grade_id"):
            op.create_index("ix_classes_grade_id", "classes", ["grade_id"])

    # 5. 创建 user_class 表
    if not _table_exists("user_class"):
        op.create_table("user_class",
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("class_id", sa.Integer(), sa.ForeignKey("classes.id", ondelete="SET NULL"), nullable=True),
            sa.Column("joined_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("user_id"),
        )
        if not _index_exists("user_class", "ix_user_class_class_id"):
            op.create_index("ix_user_class_class_id", "user_class", ["class_id"])

    # 6. Seed: 插入角色和权限（必须在 users.role FK 之前，因为已有用户 role 值需存在于 roles 表）
    op.execute(
        "INSERT INTO roles (name, display_name, is_system) VALUES "
        "('teacher', '\\u6559\\u5e08', true), "
        "('student', '\\u5b66\\u751f', true) "
        "ON CONFLICT (name) DO NOTHING"
    )

    teacher_perms = [
        "teacher_access", "user_manage", "case_manage", "score_review",
        "llm_monitor", "api_manage", "prompt_manage",
        "grade_class_manage", "backup_manage",
    ]
    student_perms = ["training_access", "qa_access"]

    for perm in teacher_perms:
        op.execute(sa.text(
            "INSERT INTO role_permissions (role_name, permission) VALUES ('teacher', :p) ON CONFLICT DO NOTHING"
        ).bindparams(p=perm))

    for perm in student_perms:
        op.execute(sa.text(
            "INSERT INTO role_permissions (role_name, permission) VALUES ('student', :p) ON CONFLICT DO NOTHING"
        ).bindparams(p=perm))

    # 7. 放宽 users.role 列 — String(10)→String(20) + FK→roles.name
    #    此时 roles 表已有 teacher/student 行，FK 不会因已有数据而失败
    conn = op.get_bind()
    fk_rows = conn.execute(sa.text(
        "SELECT conname FROM pg_constraint "
        "WHERE conrelid='users'::regclass AND contype='f' AND conname LIKE '%role%'"
    )).fetchall()
    for r in fk_rows:
        op.drop_constraint(r[0], "users", type_="foreignkey")

    op.alter_column("users", "role",
        existing_type=sa.String(10),
        type_=sa.String(20),
        existing_nullable=False,
        existing_server_default=None,
    )

    op.create_foreign_key(
        "fk_users_role", "users", "roles",
        ["role"], ["name"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.drop_constraint("fk_users_role", "users", type_="foreignkey")
    op.execute("DELETE FROM role_permissions")
    op.execute("DELETE FROM roles")
    op.drop_index("ix_user_class_class_id", table_name="user_class")
    op.drop_table("user_class")
    op.drop_index("ix_classes_grade_id", table_name="classes")
    op.drop_table("classes")
    op.drop_table("grades")
    op.drop_index("ix_rp_role_perm", table_name="role_permissions")
    op.drop_table("role_permissions")
    op.drop_table("roles")
```

- [ ] **Step 3: 运行迁移验证**

```bash
cd backend; alembic upgrade head
```
预期: 迁移成功执行，无报错。

- [ ] **Step 4: 验证表已创建**

```bash
cd backend; python -c "from database import engine; from sqlalchemy import inspect; insp = inspect(engine); print([t for t in insp.get_table_names() if t in ('roles','role_permissions','grades','classes','user_class')])"
```
预期: `['classes', 'grades', 'role_permissions', 'roles', 'user_class']`

- [ ] **Step 5: 验证 seed 数据**

```bash
cd backend; python -c "from database import SessionLocal; from models import Role, RolePermission; db = SessionLocal(); print(db.query(Role).all()); print(db.query(RolePermission).count())"
```
预期: 2 个角色, 11 条权限记录。

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/versions/<hash>_rbac_classes_init.py
git commit -m "🗃️ db: add RBAC roles/permissions + grades/classes/user_class tables"
```

---

### Task 2: ORM 模型 — models.py 新增角色/权限/年级/班级

**Files:**
- Modify: `backend/models.py`

- [ ] **Step 1: 在 models.py 顶部（User 类之前）新增 5 个模型类**

在 `class User(Base):` 之前插入:

```python
class Role(Base):
    __tablename__ = "roles"

    name = Column(String(20), primary_key=True)
    display_name = Column(String(40), nullable=False)
    is_system = Column(Boolean, nullable=False, default=False)


class RolePermission(Base):
    __tablename__ = "role_permissions"
    __table_args__ = (
        UniqueConstraint("role_name", "permission", name="ix_rp_role_perm"),
    )

    id = Column(Integer, primary_key=True)
    role_name = Column(String(20), ForeignKey("roles.name", ondelete="CASCADE"), nullable=False)
    permission = Column(String(40), nullable=False)


class Grade(Base):
    __tablename__ = "grades"

    id = Column(Integer, primary_key=True)
    name = Column(String(40), unique=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    classes = relationship("Class", back_populates="grade", cascade="all, delete-orphan")


class Class(Base):
    __tablename__ = "classes"
    __table_args__ = (
        UniqueConstraint("grade_id", "name"),
        Index("ix_classes_grade_id", "grade_id"),
    )

    id = Column(Integer, primary_key=True)
    grade_id = Column(Integer, ForeignKey("grades.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(60), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    grade = relationship("Grade", back_populates="classes")
    user_classes = relationship("UserClass", back_populates="class_", cascade="all, delete-orphan")


class UserClass(Base):
    __tablename__ = "user_class"
    __table_args__ = (
        Index("ix_user_class_class_id", "class_id"),
    )

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    class_id = Column(Integer, ForeignKey("classes.id", ondelete="SET NULL"), nullable=True)
    joined_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="user_class")
    class_ = relationship("Class", back_populates="user_classes")
```

- [ ] **Step 2: 在 models.py 底部新增 prompt_templates 后面追加**

确定插入位置在 `PromptTemplate` 类之后、文件末尾之前。

- [ ] **Step 3: 验证 models 加载无误**

```bash
cd backend; python -c "from models import Role, RolePermission, Grade, Class, UserClass; print('OK')"
```
预期: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/models.py
git commit -m "🗃️ feat: add Role/RolePermission/Grade/Class/UserClass ORM models"
```

---

### Task 3: User 模型改造 — role FK + has_permission 方法

**Files:**
- Modify: `backend/models.py`

- [ ] **Step 1: 修改 User 类 role 字段**

将 `models.py` 中 `User` 类的:
```python
role = Column(String(10), nullable=False, default="student")  # student / teacher
```
改为:
```python
role = Column(String(20), ForeignKey("roles.name", ondelete="RESTRICT"), nullable=False, default="student")
```

- [ ] **Step 2: 新增 User 模型的关系和辅助方法**

在 `User` 类中的 `training_records` 关系后面添加:

```python
    user_class = relationship("UserClass", back_populates="user", uselist=False, cascade="all, delete-orphan")

    def has_permission(self, permission: str) -> bool:
        cache = getattr(self, "_permissions_cache", None)
        if cache is None:
            return False
        return permission in cache

    def set_permissions_cache(self, permissions: set[str]) -> None:
        self._permissions_cache = permissions
```

- [ ] **Step 3: 验证**

```bash
cd backend; python -c "from models import User; u = User(); u.set_permissions_cache({'teacher_access'}); print(u.has_permission('teacher_access'))"
```
预期: `True`

- [ ] **Step 4: Commit**

```bash
git add backend/models.py
git commit -m "🗃️ feat: make User.role FK to roles, add has_permission/set_permissions_cache"
```

---

### Task 4: auth.py 改造 — get_current_user 预加载权限

**Files:**
- Modify: `backend/auth.py`

- [ ] **Step 1: 修改 get_current_user 预加载权限**

在 `auth.py` 顶部 import 加入 `RolePermission`:

```python
from models import User, RolePermission
```

修改 `get_current_user` 函数，在查询 user 后加载权限缓存:

```python
def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: int = payload.get("user_id")
        if user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的认证令牌")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的认证令牌")

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")

    rows = db.query(RolePermission.permission).filter(
        RolePermission.role_name == user.role
    ).all()
    user.set_permissions_cache({r.permission for r in rows})

    return user
```

- [ ] **Step 2: 修改 require_teacher / require_student 使用权限检查**

`require_teacher` 改为:

```python
def require_teacher(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.has_permission("teacher_access"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要教师权限")
    return current_user
```

`require_student` 改为:

```python
def require_student(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.has_permission("training_access"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要学生权限")
    return current_user
```

- [ ] **Step 3: 验证**

```bash
cd backend; python -c "from auth import hash_password; print(hash_password('test'))"
```
预期: bcrypt hash 字符串。

- [ ] **Step 4: Commit**

```bash
git add backend/auth.py
git commit -m "✨ feat: preload permissions cache in get_current_user, use has_permission in guards"
```

---

### Task 5: Pydantic schemas 新增年级/班级/用户增强

**Files:**
- Modify: `backend/schemas.py`

- [ ] **Step 1: 在 schemas.py 末尾追加新 schema 类**

```python
# ── 年级管理 ──

class GradeCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=40)

class GradeUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=40)

class GradeResponse(BaseModel):
    id: int
    name: str
    class_count: int = 0
    student_count: int = 0
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── 班级管理 ──

class ClassCreate(BaseModel):
    grade_id: int
    name: str = Field(..., min_length=1, max_length=60)

class ClassUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=60)
    grade_id: Optional[int] = None

class ClassResponse(BaseModel):
    id: int
    grade_id: int
    grade_name: str = ""
    name: str
    student_count: int = 0
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── 班级统计 ──

class ClassSummaryItem(BaseModel):
    class_id: int
    class_name: str
    grade_name: str
    student_count: int
    avg_score: Optional[float] = None
    completion_rate: float = 0.0
    total_sessions: int = 0
    total_minutes: int = 0
```

- [ ] **Step 2: UserBrief 增加班级字段**

在 `schemas.py` `UserBrief` 类中增加:

```python
    class_id: Optional[int] = None
    class_name: Optional[str] = None
    grade_name: Optional[str] = None
```

- [ ] **Step 3: RegisterRequest / BatchUserItem / UserUpdateRequest 增加 class_id**

在 `RegisterRequest` 中添加:
```python
    class_id: Optional[int] = None
```

在 `BatchUserItem` 中添加:
```python
    class_id: Optional[int] = None
```

在 `UserUpdateRequest` 中添加:
```python
    class_id: Optional[int] = None
```

- [ ] **Step 4: 验证**

```bash
cd backend; python -c "from schemas import GradeCreate, ClassCreate, ClassSummaryItem, UserBrief; print('OK')"
```
预期: `OK`

- [ ] **Step 5: Commit**

```bash
git add backend/schemas.py
git commit -m "✨ feat: add Grade/Class Pydantic schemas, enhance UserBrief with class fields"
```

---

### Task 6: 年级 CRUD API 路由

**Files:**
- Create: `backend/routers/admin_grades.py`

- [ ] **Step 1: 创建 `backend/routers/admin_grades.py`**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models import User, Grade, Class, UserClass
from schemas import GradeCreate, GradeUpdate, GradeResponse
from auth import require_teacher

router = APIRouter(prefix="/api/admin/grades", tags=["年级管理"])


@router.get("", response_model=list[GradeResponse])
def list_grades(
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    grades = db.query(Grade).order_by(Grade.name).all()
    result = []
    for g in grades:
        class_count = db.query(func.count(Class.id)).filter(Class.grade_id == g.id).scalar() or 0
        student_count = (
            db.query(func.count(UserClass.user_id))
            .join(Class, Class.id == UserClass.class_id)
            .filter(Class.grade_id == g.id)
            .scalar()
        ) or 0
        result.append(GradeResponse(
            id=g.id, name=g.name,
            class_count=class_count, student_count=student_count,
            created_at=g.created_at,
        ))
    return result


@router.post("", response_model=GradeResponse)
def create_grade(
    body: GradeCreate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    existing = db.query(Grade).filter(Grade.name == body.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="年级已存在")
    grade = Grade(name=body.name)
    db.add(grade)
    db.commit()
    db.refresh(grade)
    return GradeResponse(
        id=grade.id, name=grade.name,
        class_count=0, student_count=0,
        created_at=grade.created_at,
    )


@router.put("/{grade_id}", response_model=GradeResponse)
def update_grade(
    grade_id: int,
    body: GradeUpdate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    grade = db.query(Grade).filter(Grade.id == grade_id).first()
    if not grade:
        raise HTTPException(status_code=404, detail="年级不存在")
    if body.name != grade.name:
        dup = db.query(Grade).filter(Grade.name == body.name).first()
        if dup:
            raise HTTPException(status_code=400, detail="年级名称重复")
    grade.name = body.name
    db.commit()
    db.refresh(grade)
    class_count = db.query(func.count(Class.id)).filter(Class.grade_id == grade.id).scalar() or 0
    student_count = (
        db.query(func.count(UserClass.user_id))
        .join(Class, Class.id == UserClass.class_id)
        .filter(Class.grade_id == grade.id)
        .scalar()
    ) or 0
    return GradeResponse(
        id=grade.id, name=grade.name,
        class_count=class_count, student_count=student_count,
        created_at=grade.created_at,
    )


@router.delete("/{grade_id}")
def delete_grade(
    grade_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    grade = db.query(Grade).filter(Grade.id == grade_id).first()
    if not grade:
        raise HTTPException(status_code=404, detail="年级不存在")
    class_count = db.query(func.count(Class.id)).filter(Class.grade_id == grade_id).scalar() or 0
    db.execute(
        UserClass.__table__.update()
        .where(UserClass.class_id.in_(
            db.query(Class.id).filter(Class.grade_id == grade_id)
        ))
        .values(class_id=None)
    )
    db.delete(grade)
    db.commit()
    return {"message": f"已删除年级及其下 {class_count} 个班级"}
```

- [ ] **Step 2: 在 main.py 注册路由**

在 `backend/main.py` 中添加:
```python
from routers import admin_grades
```
在 `app.include_router` 区域添加:
```python
app.include_router(admin_grades.router)
```

- [ ] **Step 3: 验证**

```bash
cd backend; python -c "from routers.admin_grades import router; print('OK')"
```
预期: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/routers/admin_grades.py backend/main.py
git commit -m "✨ feat: add grade CRUD API (list/create/update/delete)"
```

---

### Task 7: 班级 CRUD API 路由

**Files:**
- Create: `backend/routers/admin_classes.py`

- [ ] **Step 1: 创建 `backend/routers/admin_classes.py`**

```python
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models import User, Grade, Class, UserClass
from schemas import ClassCreate, ClassUpdate, ClassResponse
from auth import require_teacher

router = APIRouter(prefix="/api/admin/classes", tags=["班级管理"])


@router.get("", response_model=list[ClassResponse])
def list_classes(
    grade_id: int | None = Query(None),
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    q = db.query(Class, Grade.name.label("grade_name"))
    q = q.join(Grade, Grade.id == Class.grade_id)
    if grade_id is not None:
        q = q.filter(Class.grade_id == grade_id)
    rows = q.order_by(Grade.name, Class.name).all()

    result = []
    for cls, grade_name in rows:
        student_count = db.query(func.count(UserClass.user_id)).filter(
            UserClass.class_id == cls.id
        ).scalar() or 0
        result.append(ClassResponse(
            id=cls.id, grade_id=cls.grade_id, grade_name=grade_name,
            name=cls.name, student_count=student_count,
            created_at=cls.created_at,
        ))
    return result


@router.post("", response_model=ClassResponse)
def create_class(
    body: ClassCreate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    grade = db.query(Grade).filter(Grade.id == body.grade_id).first()
    if not grade:
        raise HTTPException(status_code=404, detail="年级不存在")
    dup = db.query(Class).filter(
        Class.grade_id == body.grade_id, Class.name == body.name
    ).first()
    if dup:
        raise HTTPException(status_code=400, detail="该年级下班级名称重复")
    cls = Class(grade_id=body.grade_id, name=body.name)
    db.add(cls)
    db.commit()
    db.refresh(cls)
    return ClassResponse(
        id=cls.id, grade_id=cls.grade_id, grade_name=grade.name,
        name=cls.name, student_count=0, created_at=cls.created_at,
    )


@router.put("/{class_id}", response_model=ClassResponse)
def update_class(
    class_id: int,
    body: ClassUpdate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    cls = db.query(Class).filter(Class.id == class_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="班级不存在")
    if body.grade_id is not None:
        grade = db.query(Grade).filter(Grade.id == body.grade_id).first()
        if not grade:
            raise HTTPException(status_code=404, detail="年级不存在")
        cls.grade_id = body.grade_id
    if body.name is not None:
        dup = db.query(Class).filter(
            Class.grade_id == cls.grade_id, Class.name == body.name,
            Class.id != class_id,
        ).first()
        if dup:
            raise HTTPException(status_code=400, detail="该年级下班级名称重复")
        cls.name = body.name
    db.commit()
    db.refresh(cls)
    grade = db.query(Grade).filter(Grade.id == cls.grade_id).first()
    student_count = db.query(func.count(UserClass.user_id)).filter(
        UserClass.class_id == cls.id
    ).scalar() or 0
    return ClassResponse(
        id=cls.id, grade_id=cls.grade_id, grade_name=grade.name if grade else "",
        name=cls.name, student_count=student_count, created_at=cls.created_at,
    )


@router.delete("/{class_id}")
def delete_class(
    class_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    cls = db.query(Class).filter(Class.id == class_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="班级不存在")
    db.execute(
        UserClass.__table__.update()
        .where(UserClass.class_id == class_id)
        .values(class_id=None)
    )
    db.delete(cls)
    db.commit()
    return {"message": f"已删除班级 {cls.name}"}
```

- [ ] **Step 2: 在 main.py 注册路由**

```python
from routers import admin_classes
```
并在 include_router 区域添加:
```python
app.include_router(admin_classes.router)
```

- [ ] **Step 3: Commit**

```bash
git add backend/routers/admin_classes.py backend/main.py
git commit -m "✨ feat: add class CRUD API (list/create/update/delete)"
```

---

### Task 8: admin.py — 用户列表/创建/更新/详情 增强班级支持

**Files:**
- Modify: `backend/routers/admin.py`

- [ ] **Step 1: 导入新模型**

在 `admin.py` 顶部 import 区域追加:

```python
from models import User, TrainingRecord, Score, LLMCallLog, Case as CaseModel, ApiProvider, UserClass, Class, Grade
```

- [ ] **Step 2: list_users 增加 class_id/grade_id 筛选和班级字段返回**

修改 `list_users` 函数，在函数体内增加筛选逻辑，并构建带班级信息的返回:

```python
@router.get("/users", response_model=PaginatedResponse[UserBrief])
def list_users(
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    search: str = Query(None, description="搜索用户名/姓名/学号"),
    role: str = Query(None, description="角色筛选 student/teacher"),
    class_id: int | None = Query(None),
    grade_id: int | None = Query(None),
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    q = db.query(User)
    
    # 班级/年级筛选
    if class_id is not None or grade_id is not None:
        q = q.join(UserClass, UserClass.user_id == User.id, isouter=True)
        if class_id is not None:
            q = q.filter(UserClass.class_id == class_id)
        elif grade_id is not None:
            q = q.join(Class, Class.id == UserClass.class_id)
            q = q.filter(Class.grade_id == grade_id)

    if search:
        search_term = f"%{search}%"
        q = q.filter(
            or_(
                User.username.ilike(search_term),
                User.display_name.ilike(search_term),
                User.student_id.ilike(search_term),
            )
        )
    if role:
        q = q.filter(User.role == role)
    total = q.count()
    users = q.order_by(User.created_at.desc()).offset(offset).limit(limit).all()

    items = []
    for u in users:
        uc = db.query(UserClass).filter(UserClass.user_id == u.id).first()
        class_name = None; grade_name = None; cid = None
        if uc and uc.class_id:
            cls = db.query(Class).filter(Class.id == uc.class_id).first()
            if cls:
                cid = cls.id
                class_name = cls.name
                grade = db.query(Grade).filter(Grade.id == cls.grade_id).first()
                grade_name = grade.name if grade else None
        items.append(UserBrief(
            id=u.id, username=u.username, role=u.role,
            display_name=u.display_name, student_id=u.student_id,
            created_at=u.created_at,
            class_id=cid, class_name=class_name, grade_name=grade_name,
        ))
    return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)
```

- [ ] **Step 3: update_user 增加 class_id 处理**

在 `update_user` 函数中，密码检查之后添加:

```python
    if req.class_id is not None:
        uc = db.query(UserClass).filter(UserClass.user_id == user_id).first()
        if req.class_id == 0:
            if uc:
                db.delete(uc)
        else:
            if not uc:
                uc = UserClass(user_id=user_id)
                db.add(uc)
            uc.class_id = req.class_id
```

- [ ] **Step 4: batch_create_users 增加 class_id 处理**

在 `batch_create_users` 循环中 `db.add(User(...))` 之后:

```python
        db.flush()
        if u.class_id:
            db.add(UserClass(user_id=user.id, class_id=u.class_id))
```

注意: 需要先 `db.flush()` 才能获取 `user.id`。

- [ ] **Step 5: get_user_detail 增加班级字段**

在 `get_user_detail` 返回的 `StudentDetail` 构造中不变（已有结构），但可以在日志或后续处理中用。

- [ ] **Step 6: Commit**

```bash
git add backend/routers/admin.py
git commit -m "✨ feat: add class_id/grade_id filter to list_users, support class_id in create/update/batch"
```

---

### Task 9: stats.py — 班级维度统计 + 增强筛选

**Files:**
- Modify: `backend/routers/stats.py`

- [ ] **Step 1: 导入新模型**

```python
from models import User, TrainingRecord, Score, UserClass, Class, Grade
```

- [ ] **Step 2: ranking 和 teacher_summary 增加 class_id 筛选**

在 `ranking` 函数签名中增加:
```python
class_id: int | None = Query(None),
```
在 `base = db.query(...)` 之后、`.group_by(User.id)` 之前插入:
```python
    if class_id is not None:
        base = base.join(UserClass, UserClass.user_id == User.id).filter(UserClass.class_id == class_id)
```

同样修改 `teacher_summary`。

- [ ] **Step 3: 新增 class-summary 端点**

在 `stats.py` 末尾追加:

```python
@router.get("/class-summary", response_model=list[dict])
def class_summary(
    grade_id: int | None = Query(None),
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    q = db.query(Class, Grade.name.label("grade_name"))
    q = q.join(Grade, Grade.id == Class.grade_id)
    if grade_id is not None:
        q = q.filter(Class.grade_id == grade_id)
    rows = q.order_by(Grade.name, Class.name).all()

    result = []
    for cls, grade_name in rows:
        student_count = db.query(func.count(UserClass.user_id)).filter(
            UserClass.class_id == cls.id
        ).scalar() or 0

        sub = db.query(TrainingRecord).join(
            UserClass, UserClass.user_id == TrainingRecord.user_id
        ).filter(
            UserClass.class_id == cls.id,
            TrainingRecord.status == "completed",
        )
        total_sessions = sub.count()
        total_minutes = sub.filter(
            TrainingRecord.end_time.isnot(None),
            TrainingRecord.start_time.isnot(None),
        ).with_entities(
            func.sum(
                func.extract('epoch', TrainingRecord.end_time - TrainingRecord.start_time) / 60
            )
        ).scalar() or 0

        avg_score = sub.join(Score, Score.record_id == TrainingRecord.id).with_entities(
            func.avg(Score.total_score)
        ).scalar()

        completion_rate = total_sessions / student_count if student_count > 0 else 0

        result.append({
            "class_id": cls.id,
            "class_name": cls.name,
            "grade_name": grade_name,
            "student_count": student_count,
            "avg_score": round(float(avg_score), 1) if avg_score else None,
            "completion_rate": round(float(completion_rate), 1),
            "total_sessions": total_sessions,
            "total_minutes": round(float(total_minutes)),
        })
    return result
```

- [ ] **Step 4: Commit**

```bash
git add backend/routers/stats.py
git commit -m "✨ feat: add class_id filter to ranking/teacher-summary, add /stats/class-summary endpoint"
```

---

### Task 10: training.py — 训练记录筛选增强

**Files:**
- Modify: `backend/routers/training.py`

- [ ] **Step 1: 导入新模型**

在 `training.py` 顶部 import 追加:
```python
from models import User, Case, TrainingRecord, Message, Score, Note, LLMCallLog, UserClass
```

- [ ] **Step 2: get_records 增加 class_id 筛选**

找到 `get_records` 函数（约在 training.py 后半部分），在函数签名中增加:
```python
class_id: int | None = Query(None),
```

在查询构建中，增加班级筛选:
```python
    if class_id is not None:
        q = q.join(UserClass, UserClass.user_id == TrainingRecord.user_id).filter(UserClass.class_id == class_id)
```

> 注意: 仅教师端允许此筛选，需在已有 `if current_user.role == "teacher"` 块内。

- [ ] **Step 3: Commit**

```bash
git add backend/routers/training.py
git commit -m "✨ feat: add class_id filter to training records list"
```

---

### Task 11: main.py — seed data 更新

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: seed data 中创建角色和权限（如果尚未存在）**

在 `main.py` 的 `_seed_data()` 函数开始处（检查 `db.query(User).count() > 0` 之前），添加角色和权限创建:

```python
        # 确保角色和权限存在
        from models import Role, RolePermission
        if db.query(Role).count() == 0:
            db.add(Role(name="teacher", display_name="教师", is_system=True))
            db.add(Role(name="student", display_name="学生", is_system=True))
            db.flush()

            teacher_perms = [
                "teacher_access", "user_manage", "case_manage", "score_review",
                "llm_monitor", "api_manage", "prompt_manage",
                "grade_class_manage", "backup_manage",
            ]
            student_perms = ["training_access", "qa_access"]
            for p in teacher_perms:
                db.add(RolePermission(role_name="teacher", permission=p))
            for p in student_perms:
                db.add(RolePermission(role_name="student", permission=p))
```

- [ ] **Step 2: 验证完整启动**

```bash
cd backend; python -c "from main import app; print('App loaded OK')"
```
预期: `App loaded OK`

- [ ] **Step 3: Commit**

```bash
git add backend/main.py
git commit -m "✨ feat: seed roles and permissions in startup data"
```

---

### Task 12: 前端 api.js — 新增 API 函数

**Files:**
- Modify: `frontend/src/api.js`

- [ ] **Step 1: 在 api.js 末尾追加以下函数**

```javascript
// ── 年级管理 ──

export async function getGrades() {
  const res = await api.get("/admin/grades");
  return res.data;
}

export async function createGrade(data) {
  const res = await api.post("/admin/grades", data);
  return res.data;
}

export async function updateGrade(id, data) {
  const res = await api.put(`/admin/grades/${id}`, data);
  return res.data;
}

export async function deleteGrade(id) {
  const res = await api.delete(`/admin/grades/${id}`);
  return res.data;
}

// ── 班级管理 ──

export async function getClasses(params) {
  const res = await api.get("/admin/classes", { params });
  return res.data;
}

export async function createClass(data) {
  const res = await api.post("/admin/classes", data);
  return res.data;
}

export async function updateClass(id, data) {
  const res = await api.put(`/admin/classes/${id}`, data);
  return res.data;
}

export async function deleteClass(id) {
  const res = await api.delete(`/admin/classes/${id}`);
  return res.data;
}

// ── 班级统计 ──

export async function getClassSummary(params) {
  const res = await api.get("/stats/class-summary", { params });
  return res.data;
}
```

- [ ] **Step 2: 修改 getUsers 支持 class_id/grade_id**

`getUsers` 函数已支持 params 透传，无需改动（调用方传入 `class_id` 即可）。

- [ ] **Step 3: 修改 batchCreateUsers 和 updateUser 不变**

这些函数透传 data，调用方传入 `class_id` 即可。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api.js
git commit -m "✨ feat: add grades/classes/class-summary API functions"
```

---

### Task 13: 前端 ClassFilter 组件

**Files:**
- Create: `frontend/src/components/teacher/ClassFilter.jsx`

- [ ] **Step 1: 创建 ClassFilter 组件**

```jsx
import { useState, useEffect, useRef } from "react";
import { getGrades, getClasses } from "../../api";

export default function ClassFilter({ gradeId, classId, onChange, className = "" }) {
  const [grades, setGrades] = useState([]);
  const [classes, setClasses] = useState([]);
  const [selGrade, setSelGrade] = useState(gradeId || "");
  const [selClass, setSelClass] = useState(classId || "");
  const firstRun = useRef(true);

  useEffect(() => {
    getGrades().then(setGrades).catch(() => {});
  }, []);

  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    onChange?.({ grade_id: selGrade || null, class_id: null });
    setSelClass("");
    setClasses([]);
  }, [selGrade]);

  const handleGradeChange = (e) => {
    const gid = e.target.value;
    setSelGrade(gid);
    if (gid) {
      getClasses({ grade_id: Number(gid) }).then(setClasses).catch(() => {});
    }
  };

  const handleClassChange = (e) => {
    const cid = e.target.value;
    setSelClass(cid);
    onChange?.({ grade_id: selGrade || null, class_id: cid ? Number(cid) : null });
  };

  return (
    <div className={`class-filter ${className}`} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
      <select value={selGrade} onChange={handleGradeChange} className="filter-select">
        <option value="">全部年级</option>
        {grades.map((g) => (
          <option key={g.id} value={g.id}>{g.name}</option>
        ))}
      </select>
      <select value={selClass} onChange={handleClassChange} className="filter-select" disabled={!selGrade}>
        <option value="">全部班级</option>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/teacher/ClassFilter.jsx
git commit -m "✨ feat: add ClassFilter component (grade→class cascade select)"
```

---

### Task 14: 前端 GradesClassesPage — 年级班级管理页

**Files:**
- Create: `frontend/src/pages/admin/GradesClassesPage.jsx`

- [ ] **Step 1: 创建管理页面**

```jsx
import { useState, useEffect } from "react";
import PageHeader from "../../components/ui/PageHeader";
import Modal from "../../components/ui/Modal";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import Table from "../../components/ui/Table";
import Button from "../../components/ui/Button";
import FormField from "../../components/ui/FormField";
import { getGrades, createGrade, updateGrade, deleteGrade, getClasses, createClass, updateClass, deleteClass } from "../../api";
import { useToast } from "../../components/Toast";

const GRADE_COLUMNS = [
  { key: "name", label: "年级名称" },
  { key: "class_count", label: "班级数" },
  { key: "student_count", label: "学生数" },
  { key: "created_at", label: "创建时间", render: (v) => v ? new Date(v).toLocaleDateString("zh-CN") : "" },
];

const CLASS_COLUMNS = [
  { key: "grade_name", label: "所属年级" },
  { key: "name", label: "班级名称" },
  { key: "student_count", label: "学生数" },
  { key: "created_at", label: "创建时间", render: (v) => v ? new Date(v).toLocaleDateString("zh-CN") : "" },
];

export default function GradesClassesPage({ user, onLogout }) {
  const [tab, setTab] = useState("grades");
  const [grades, setGrades] = useState([]);
  const [classes, setClasses] = useState([]);
  const [gradeFilter, setGradeFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [editId, setEditId] = useState(null);
  const [formName, setFormName] = useState("");
  const [formGradeId, setFormGradeId] = useState("");
  const toast = useToast();

  const loadGrades = () => getGrades().then(setGrades).catch(() => {});
  const loadClasses = () => {
    const params = gradeFilter ? { grade_id: Number(gradeFilter) } : {};
    getClasses(params).then(setClasses).catch(() => {});
  };

  useEffect(() => { loadGrades(); }, []);
  useEffect(() => { loadClasses(); }, [gradeFilter]);

  const openCreate = () => { setEditId(null); setFormName(""); setFormGradeId(""); setModalOpen(true); };
  const openEdit = (item) => {
    setEditId(item.id);
    setFormName(item.name);
    if (tab === "classes") {
      setFormGradeId(String(item.grade_id));
    }
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) { toast.error("名称不能为空"); return; }
    try {
      if (tab === "grades") {
        if (editId) { await updateGrade(editId, { name: formName.trim() }); }
        else { await createGrade({ name: formName.trim() }); }
        loadGrades();
      } else {
        if (!formGradeId) { toast.error("请选择所属年级"); return; }
        const data = { name: formName.trim(), grade_id: Number(formGradeId) };
        if (editId) { await updateClass(editId, data); }
        else { await createClass(data); }
        loadClasses();
      }
      setModalOpen(false);
      toast.success(editId ? "已更新" : "已创建");
    } catch (e) {
      toast.error(e.response?.data?.detail || "操作失败");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (tab === "grades") {
        await deleteGrade(deleteTarget.id);
        loadGrades();
      } else {
        await deleteClass(deleteTarget.id);
        loadClasses();
      }
      toast.success("已删除");
    } catch (e) {
      toast.error(e.response?.data?.detail || "删除失败");
    }
    setDeleteTarget(null);
  };

  const tabs = [
    { key: "grades", label: "年级管理" },
    { key: "classes", label: "班级管理" },
  ];

  return (
    <div>
      <PageHeader
        title="班级管理"
        subtitle="管理年级和班级，组织学生归属"
        actions={<Button onClick={openCreate} icon="plus">新建{tab === "grades" ? "年级" : "班级"}</Button>}
      />

      <div style={{ display: "flex", gap: 0, marginBottom: "1rem", borderBottom: "2px solid var(--border)" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: "0.5rem 1.25rem", border: "none", background: "none",
              cursor: "pointer", fontWeight: tab === t.key ? 600 : 400,
              color: tab === t.key ? "var(--primary)" : "var(--text-secondary)",
              borderBottom: tab === t.key ? "2px solid var(--primary)" : "2px solid transparent",
              marginBottom: -2,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "classes" && (
        <div style={{ marginBottom: "1rem" }}>
          <select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)} className="filter-select">
            <option value="">全部年级</option>
            {grades.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
          </select>
        </div>
      )}

      <Table
        columns={tab === "grades" ? GRADE_COLUMNS : CLASS_COLUMNS}
        data={tab === "grades" ? grades : classes}
        rowKey="id"
        actions={(item) => (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>编辑</Button>
            <Button variant="ghost" size="sm" className="danger" onClick={() => setDeleteTarget(item)}>删除</Button>
          </div>
        )}
      />

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editId ? `编辑${tab === "grades" ? "年级" : "班级"}` : `新建${tab === "grades" ? "年级" : "班级"}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>取消</Button>
            <Button onClick={handleSave}>{editId ? "保存" : "创建"}</Button>
          </>
        }
      >
        {tab === "classes" && (
          <FormField label="所属年级">
            <select value={formGradeId} onChange={(e) => setFormGradeId(e.target.value)} className="form-input">
              <option value="">请选择年级</option>
              {grades.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
            </select>
          </FormField>
        )}
        <FormField label="名称">
          <input className="form-input" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder={tab === "grades" ? "如: 2024级" : "如: 护理1班"} />
        </FormField>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
        title={`删除${tab === "grades" ? "年级" : "班级"}`}
        message={tab === "grades"
          ? `确定要删除年级「${deleteTarget?.name}」吗？将同时删除该年级下所有班级，学生班级归属将被清除。`
          : `确定要删除班级「${deleteTarget?.name}」吗？该班级中学生将变为无归属状态。`}
        danger
      />
    </div>
  );
}
```

- [ ] **Step 2: 在 App.jsx 注册路由**

```jsx
const GradesClassesPage = lazy(() => import("./pages/admin/GradesClassesPage"));
```
并添加路由（teacher 保护）:
```jsx
<Route path="/admin/grades-classes" element={
  <ProtectedRoute role="teacher">
    <GradesClassesPage user={user} onLogout={handleLogout} />
  </ProtectedRoute>
} />
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/admin/GradesClassesPage.jsx frontend/src/App.jsx
git commit -m "✨ feat: add GradesClassesPage with grade/class CRUD Tabs"
```

---

### Task 15: AppShell — 侧边栏增加班级管理入口

**Files:**
- Modify: `frontend/src/components/AppShell.jsx`

- [ ] **Step 1: 在教师链接中增加班级管理入口**

在 `teacherLinks` 数组中添加（放在合适位置，如用户管理之后）:

```jsx
  { to: "/admin/grades-classes", icon: GraduationCap, label: "班级管理" },
```

页面顶部 import 需要:
```jsx
import { LayoutDashboard, Users, FileText, BarChart3, MessageSquare, Settings, GraduationCap } from "lucide-react";
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/AppShell.jsx
git commit -m "✨ feat: add GradesClasses nav entry in teacher sidebar"
```

---

### Task 16: UsersTab — 用户管理增加班级字段

**Files:**
- Modify: `frontend/src/components/teacher/UsersTab.jsx`

- [ ] **Step 1: 新增 import 和状态**

在文件顶部 import 行追加:
```jsx
import ClassFilter from "./ClassFilter";
import { getClasses } from "../../api";
```

在 `const [roleFilter, setRoleFilter] = useState("");` 之后添加:
```jsx
  const [classParam, setClassParam] = useState(null);
```

- [ ] **Step 2: loadUsers 增加班级筛选参数**

修改 `loadUsers` 函数:

```jsx
  const loadUsers = useCallback(
    (_offset) => {
      const params = { offset: _offset != null ? _offset : offset, limit: LIMIT };
      if (search) params.search = search;
      if (roleFilter) params.role = roleFilter;
      if (classParam?.class_id) params.class_id = classParam.class_id;
      else if (classParam?.grade_id) params.grade_id = classParam.grade_id;
      getUsers(params)
        .then(({ data }) => {
          setUsers(data.items);
          setUserTotal(data.total);
        })
        .catch(() => toast.error("加载用户列表失败"));
    },
    [offset, search, roleFilter, classParam, toast],
  );
```

并在底部修改 useEffect 重置 offset:
```jsx
  useEffect(() => {
    setOffset(0);
  }, [search, roleFilter, classParam]);
```

- [ ] **Step 3: 搜索区域添加 ClassFilter**

在 `</select>` 角色筛选器之后、`<span>共 {userTotal} 人</span>` 之前插入:

```jsx
          <ClassFilter onChange={setClassParam} />
```

- [ ] **Step 4: 表格增加班级列**

在 `<th>学号</th>` 之前插入:
```jsx
              <th>班级</th>
```

在 `<td style={{ color: "var(--text-secondary)" }}>{u.student_id || "-"}</td>` 之前插入:
```jsx
                <td>{u.class_name ? `${u.grade_name || ""} ${u.class_name}` : "-"}</td>
```

- [ ] **Step 5: 注册表单增加班级选择**

在 `regForm` state 初始化中添加:
```jsx
  const [regForm, setRegForm] = useState({ username: "", password: "", role: "student", display_name: "", student_id: "", class_id: "" });
```

在注册表单的学号字段之后、提交按钮之前添加:
```jsx
            <div className="form-group" style={{ flex: "1 1 120px", marginBottom: 0 }}>
              <label>班级ID（可选）</label>
              <input value={regForm.class_id} onChange={(e) => setRegForm({ ...regForm, class_id: e.target.value })} placeholder="数字ID" />
            </div>
```

并在 handleRegister 的 payload 中添加 class_id 透传:
```jsx
      if (regForm.class_id) payload.class_id = Number(regForm.class_id);
```

- [ ] **Step 6: 编辑用户 Modal 增加班级选择**

在 `editUserForm` state 初始化中添加:
```jsx
  const [editUserForm, setEditUserForm] = useState({ display_name: "", student_id: "", role: "", password: "", class_id: "" });
```

在 `openEditUser` 中增加:
```jsx
    setEditUserForm({ display_name: u.display_name, student_id: u.student_id || "", role: u.role, password: "", class_id: u.class_id || "" });
```

在编辑 Modal 表单的角色选择之后添加:
```jsx
          <div className="form-group">
            <label>班级ID（数字，0表示清除）</label>
            <input value={editUserForm.class_id} onChange={(e) => setEditUserForm((f) => ({ ...f, class_id: e.target.value }))} placeholder="数字ID或0" />
          </div>
```

并在 `handleSaveUser` 的 payload 中添加:
```jsx
    if (editUserForm.class_id !== undefined && editUserForm.class_id !== "") payload.class_id = Number(editUserForm.class_id);
```

- [ ] **Step 7: 批量导入支持班级字段**

修改 `parseBatchText` 中的行解析，parts 增加第 6 列 class_id:
```jsx
      users.push({ username: parts[0], password: parts[1], display_name: parts[2], role: parts[3] || "student", student_id: parts[4] || null, class_id: parts[5] ? Number(parts[5]) : null });
```

修改模板 CSV:
```jsx
    const csvContent = "﻿用户名,密码,姓名,角色,学号,班级ID\nstudent6,123456,赵六,student,2024006,\nstudent7,123456,钱七,student,2024007,";
```

修改预览表格在学号列后增加班级ID列头部和行渲染。

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/teacher/UsersTab.jsx
git commit -m "✨ feat: add class/grade columns and filter to UsersTab"
```

---

### Task 17: 全链路验证测试

**Files:**
- Create: `backend/tests/test_grades_classes.py`

- [ ] **Step 1: 编写后端测试**

```python
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.database import SessionLocal

client = TestClient(app)

TEACHER_HEADERS = {}

@pytest.fixture(autouse=True)
def setup():
    global TEACHER_HEADERS
    resp = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    if resp.status_code == 200:
        TEACHER_HEADERS = {"Authorization": f"Bearer {resp.json()['access_token']}"}


def test_create_and_list_grades():
    # 创建
    resp = client.post("/api/admin/grades", json={"name": "2024级"}, headers=TEACHER_HEADERS)
    assert resp.status_code == 200
    grade_id = resp.json()["id"]

    # 列表
    resp = client.get("/api/admin/grades", headers=TEACHER_HEADERS)
    assert resp.status_code == 200
    assert any(g["name"] == "2024级" for g in resp.json())

    # 重复创建
    resp = client.post("/api/admin/grades", json={"name": "2024级"}, headers=TEACHER_HEADERS)
    assert resp.status_code == 400

    return grade_id


def test_create_and_list_classes():
    # 先确保有年级
    resp = client.post("/api/admin/grades", json={"name": "2025级"}, headers=TEACHER_HEADERS)
    grade_id = resp.json()["id"] if resp.status_code == 200 else None
    if grade_id is None:
        resp = client.get("/api/admin/grades", headers=TEACHER_HEADERS)
        for g in resp.json():
            if g["name"] == "2025级":
                grade_id = g["id"]
                break
    if grade_id is None:
        pytest.skip("No grade available")

    # 创建班级
    resp = client.post("/api/admin/classes", json={
        "grade_id": grade_id, "name": "护理1班"
    }, headers=TEACHER_HEADERS)
    assert resp.status_code == 200

    # 列表
    resp = client.get("/api/admin/classes", headers=TEACHER_HEADERS)
    assert resp.status_code == 200
    assert any(c["name"] == "护理1班" for c in resp.json())


def test_user_with_class():
    resp = client.get("/api/admin/users", params={"limit": 5}, headers=TEACHER_HEADERS)
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert "class_id" in items[0] if items else True
    assert "class_name" in items[0] if items else True


def test_class_summary():
    resp = client.get("/api/stats/class-summary", headers=TEACHER_HEADERS)
    assert resp.status_code == 200
```

- [ ] **Step 2: 运行测试**

```bash
cd backend; python -m pytest tests/test_grades_classes.py -v
```
预期: 所有测试通过。

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_grades_classes.py
git commit -m "✅ test: add integration tests for grades/classes/class-summary APIs"
```

---

### Task 18: 前后端联调验证

- [ ] **Step 1: 启动系统**

```bash
npm run dev
```
预期: 后端 8000 端口 + 前端 3000 端口启动成功。

- [ ] **Step 2: 手动测试流程**

1. 教师登录 (admin / admin123)
2. 进入"班级管理" — 创建年级 "2024级"
3. 在 2024级 下创建班级 "护理1班"
4. 进入"用户管理" — 使用班级筛选器验证筛选生效
5. 编辑一个学生，分配班级，验证保存成功
6. 进入 Dashboard 验证班级维度数据显示

- [ ] **Step 3: Commit (如有修正)**

---

### Task 19: 最终检查

- [ ] **Step 1: 运行全量后端测试**

```bash
cd backend; python -m pytest tests/ -v
```

- [ ] **Step 2: 运行前端 lint 和 build**

```bash
cd frontend; npx biome check src/ --apply; npm run build
```

- [ ] **Step 3: 检查 git status**

```bash
git status
```

确认所有变更已提交。
