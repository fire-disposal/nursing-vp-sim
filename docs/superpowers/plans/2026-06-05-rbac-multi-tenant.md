# RBAC 多租户 + 自定义角色 + 页面级权限 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将二元 teacher/student 角色系统升级为多租户隔离 + 可自定义角色 + 15个页面级权限控制的完整 RBAC 系统。

**Architecture:** 新增 schools 表做租户边界，重构 roles 表为 id 主键并关联 school_id，users/grades/cases 增加 school_id FK，用 `require_permission` 替代 `require_teacher` 做细粒度鉴权，前端 ProtectedRoute + Layout 动态菜单按权限渲染。

**Tech Stack:** Python 3.13 + FastAPI + SQLAlchemy 2.0 + Alembic + PostgreSQL + React 19 + TypeScript + Zustand

---

### Task 1: 重构数据模型 (models.py)

**Files:**
- Modify: `backend/models.py:1-100`

- [ ] **Step 1: 新增 School 模型**

在 `backend/models.py` 的 `Role` 类之前插入：

```python
class School(Base):
    __tablename__ = "schools"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(UTC))
```

- [ ] **Step 2: 重构 Role 模型**

替换现有 `Role` 类 (lines 10-15)：

```python
class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(20), unique=True)
    display_name: Mapped[str] = mapped_column(String(40))
    school_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("schools.id", ondelete="CASCADE"), nullable=True)
    is_system: Mapped[bool] = mapped_column(default=False)

    school: Mapped["School | None"] = relationship()
```

- [ ] **Step 3: 重构 RolePermission 模型**

替换现有 `RolePermission` 类 (lines 18-24)：

```python
class RolePermission(Base):
    __tablename__ = "role_permissions"
    __table_args__ = (UniqueConstraint("role_id", "permission", name="ix_rp_role_perm"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role_id: Mapped[int] = mapped_column(Integer, ForeignKey("roles.id", ondelete="CASCADE"))
    permission: Mapped[str] = mapped_column(String(40))
```

- [ ] **Step 4: 重构 User 模型 (role → role_id + school_id)**

替换现有的 role 和 has_permission 相关代码 (lines 65-88)：

```python
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role_id: Mapped[int] = mapped_column(Integer, ForeignKey("roles.id", ondelete="RESTRICT"))
    school_id: Mapped[int] = mapped_column(Integer, ForeignKey("schools.id", ondelete="RESTRICT"))
    display_name: Mapped[str] = mapped_column(String(50))
    student_id: Mapped[str | None] = mapped_column(String(30), nullable=True)
    wechat_openid: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(UTC))

    training_records: Mapped[list["TrainingRecord"]] = relationship(back_populates="user")
    user_class: Mapped["UserClass | None"] = relationship(back_populates="user", uselist=False, cascade="all, delete-orphan")
    role: Mapped["Role | None"] = relationship()
    school: Mapped["School | None"] = relationship()

    def has_permission(self, permission: str) -> bool:
        cache = getattr(self, "_permissions_cache", None)
        if cache is None:
            return False
        return permission in cache

    def set_permissions_cache(self, permissions: set[str]) -> None:
        self._permissions_cache = permissions
```

- [ ] **Step 5: 重构 Grade 模型 (unique → school_id + school FK)**

替换现有 `Grade` 类 (lines 27-34)：

```python
class Grade(Base):
    __tablename__ = "grades"
    __table_args__ = (UniqueConstraint("school_id", "name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(40))
    school_id: Mapped[int] = mapped_column(Integer, ForeignKey("schools.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(UTC))

    classes: Mapped[list["Class"]] = relationship(back_populates="grade", cascade="all, delete-orphan")
    school: Mapped["School | None"] = relationship()
```

- [ ] **Step 6: Case 模型新增 school_id**

在 Case 类中增加一个字段（在 `created_at` 之前，约 line 96）：

```python
class Case(Base):
    __tablename__ = "cases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    case_data: Mapped[dict] = mapped_column(JSONB)
    school_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("schools.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(UTC))

    school: Mapped["School | None"] = relationship()
```

- [ ] **Step 7: Commit**

```bash
git add backend/models.py
git commit -m "refactor: 重构数据模型 - School/Role/RolePermission/User/Grade/Case"
```


### Task 2: 创建数据库迁移脚本

**Files:**
- Create: `backend/migrations/versions/0003_rbac_multi_tenant.py`

- [ ] **Step 1: 创建迁移脚本**

```python
"""rbac multi-tenant

Revision ID: 0003
Revises: 4a48207defaf
Create Date: 2025-06-05
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0003"
down_revision: Union[str, Sequence[str], None] = "4a48207defaf"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "schools",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(80), unique=True, nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )

    op.execute("INSERT INTO schools (id, name) VALUES (1, '默认学校')")
    op.execute("SELECT setval(pg_get_serial_sequence('schools', 'id'), 1, true)")

    with op.batch_alter_table("roles") as batch:
        batch.drop_constraint("role_permissions_role_name_fkey", type_="foreignkey")
    with op.batch_alter_table("roles") as batch:
        batch.drop_constraint("users_role_fkey", type_="foreignkey")

    with op.batch_alter_table("roles") as batch:
        batch.add_column(sa.Column("id_new", sa.Integer(), autoincrement=True, nullable=True))
        batch.add_column(sa.Column("school_id", sa.Integer(), sa.ForeignKey("schools.id", ondelete="CASCADE"), nullable=True))

    op.execute("UPDATE roles SET id_new = CASE WHEN name = 'teacher' THEN 1 WHEN name = 'student' THEN 2 ELSE 3 END")
    op.execute("UPDATE roles SET school_id = NULL")

    with op.batch_alter_table("roles") as batch:
        batch.drop_constraint("roles_pkey", type_="primary")
        batch.create_primary_key("roles_pkey", ["id_new"])
        batch.alter_column("id_new", new_column_name="id", nullable=False)

    with op.batch_alter_table("role_permissions") as batch:
        batch.add_column(sa.Column("role_id_new", sa.Integer(), nullable=True))

    op.execute("""
        UPDATE role_permissions rp
        SET role_id_new = r.id_new
        FROM roles r
        WHERE rp.role_name = r.name
    """)

    with op.batch_alter_table("role_permissions") as batch:
        batch.drop_constraint("ix_rp_role_perm")
        batch.drop_constraint("role_permissions_role_name_fkey")
        batch.drop_column("role_name")
        batch.alter_column("role_id_new", new_column_name="role_id", nullable=False)
        batch.create_foreign_key("role_permissions_role_id_fkey", "roles", ["role_id"], ["id"], ondelete="CASCADE")
        batch.create_unique_constraint("ix_rp_role_perm", ["role_id", "permission"])

    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("school_id_new", sa.Integer(), sa.ForeignKey("schools.id", ondelete="RESTRICT"), nullable=True))
        batch.add_column(sa.Column("role_id_new", sa.Integer(), sa.ForeignKey("roles.id", ondelete="RESTRICT"), nullable=True))

    op.execute("UPDATE users SET school_id_new = 1")
    op.execute("""
        UPDATE users u
        SET role_id_new = r.id
        FROM roles r
        WHERE u.role = r.name
    """)

    with op.batch_alter_table("users") as batch:
        batch.drop_column("role")
        batch.alter_column("school_id_new", new_column_name="school_id", nullable=False)
        batch.alter_column("role_id_new", new_column_name="role_id", nullable=False)

    with op.batch_alter_table("grades") as batch:
        batch.drop_constraint("grades_name_key", type_="unique")
        batch.add_column(sa.Column("school_id_new", sa.Integer(), sa.ForeignKey("schools.id", ondelete="CASCADE"), nullable=True))

    op.execute("UPDATE grades SET school_id_new = 1")

    with op.batch_alter_table("grades") as batch:
        batch.alter_column("school_id_new", new_column_name="school_id", nullable=False)
        batch.create_unique_constraint("uq_grades_school_name", ["school_id", "name"])

    with op.batch_alter_table("cases") as batch:
        batch.add_column(sa.Column("school_id", sa.Integer(), sa.ForeignKey("schools.id", ondelete="SET NULL"), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("cases") as batch:
        batch.drop_column("school_id")

    with op.batch_alter_table("grades") as batch:
        batch.drop_constraint("uq_grades_school_name", type_="unique")
        batch.drop_column("school_id")
        batch.create_unique_constraint("grades_name_key", ["name"])

    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("role", sa.String(20), nullable=True))
        batch.drop_column("school_id")
        batch.drop_column("role_id")

    op.execute("""
        UPDATE users u
        SET role = r.name
        FROM roles r
        WHERE u.role_id_new = r.id
    """)

    with op.batch_alter_table("role_permissions") as batch:
        batch.add_column(sa.Column("role_name", sa.String(20), nullable=True))
        batch.drop_column("role_id")

    op.execute("""
        UPDATE role_permissions rp
        SET role_name = r.name
        FROM roles r
        WHERE rp.role_id_new = r.id_new
    """)

    with op.batch_alter_table("roles") as batch:
        batch.drop_column("school_id")
        batch.drop_column("id_new")

    op.drop_table("schools")
```

- [ ] **Step 2: Commit**

```bash
git add backend/migrations/versions/0003_rbac_multi_tenant.py
git commit -m "feat: RBAC多租户数据库迁移脚本"
```


### Task 3: 验证迁移

**Files:**
- No file changes

- [ ] **Step 1: 在测试数据库上运行迁移**

```bash
cd backend && uv run alembic upgrade head
```
期望: 迁移成功完成，无错误

- [ ] **Step 2: Commit**

无文件变更，无需提交。


### Task 4: 重写安全层 (core/security.py)

**Files:**
- Modify: `backend/core/security.py:1-57`

- [ ] **Step 1: 更新 get_current_user 和新增 require_permission**

覆盖 `backend/core/security.py` 全部内容：

```python
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session, joinedload

from core.config import ACCESS_TOKEN_EXPIRE_MINUTES, ALGORITHM, SECRET_KEY
from core.database import get_db
from models import RolePermission, User

security = HTTPBearer()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(UTC) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


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
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的认证令牌")

    user = (
        db.query(User)
        .options(joinedload(User.role), joinedload(User.school))
        .filter(User.id == user_id)
        .first()
    )
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")

    rows = db.query(RolePermission.permission).filter(RolePermission.role_id == user.role_id).all()
    user.set_permissions_cache({r.permission for r in rows})

    return user


def require_permission(permission: str):
    def checker(current_user: User = Depends(get_current_user)) -> User:
        if not current_user.has_permission(permission):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="权限不足")
        return current_user
    return checker
```

- [ ] **Step 2: Commit**

```bash
git add backend/core/security.py
git commit -m "refactor: get_current_user支持school/Role + require_permission替代require_teacher"
```


### Task 5: 更新所有路由的鉴权引用

**Files:**
- Modify: `backend/routers/auth.py:1-216` (imports + JWT payload + get_me)
- Modify: `backend/routers/admin.py:1-729` (require_teacher → require_permission + school_id 过滤)
- Modify: `backend/routers/admin_grades.py` (require_teacher → require_permission + school_id)
- Modify: `backend/routers/admin_classes.py` (require_teacher → require_permission)
- Modify: `backend/routers/admin_api.py` (require_teacher → require_permission)
- Modify: `backend/routers/admin_prompts.py` (require_teacher → require_permission)
- Modify: `backend/routers/training.py` (require_teacher → require_permission)
- Modify: `backend/routers/stats.py` (require_teacher → require_permission + school_id)
- Modify: `backend/routers/cases.py` (require_teacher → require_permission + school_id)
- Modify: `backend/routers/feedback.py` (require_teacher → require_permission)
- Modify: `backend/routers/export.py` (require_teacher → require_permission)
- Modify: `backend/routers/notes.py` (require_teacher → require_permission)
- Modify: `backend/routers/qa.py` (require_teacher → require_permission)

- [ ] **Step 1: 更新 auth.py**

修改 import (line 11)：

```python
from core.security import create_access_token, get_current_user, require_permission, hash_password, verify_password
```

修改 login() (line 44)：JWT payload 新增 school_id 和 role_id

```python
token = create_access_token({"user_id": user.id, "role_id": user.role_id, "school_id": user.school_id, "role": user.role.name if user.role else ""})
```

修改返回 (lines 48-53)：

```python
return TokenResponse(
    access_token=token,
    role=user.role.name if user.role else "",
    display_name=user.display_name,
    user_id=user.id,
)
```

修改 register() 鉴权 (line 59) 和内部逻辑：

```python
def register(
    req: RegisterRequest,
    current_user: Annotated[User, Depends(require_permission("user_manage"))],
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[None, Depends(register_rate_limit)],
):
    ...
    if req.role not in ("student", "teacher"):
        raise HTTPException(...)
    role_name = req.role
    role = db.query(Role).filter(Role.name == role_name, Role.school_id == current_user.school_id).first()
    if not role:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="角色不存在")

    user = User(
        username=req.username,
        password_hash=hash_password(req.password),
        role_id=role.id,
        school_id=current_user.school_id,
        display_name=req.display_name,
        student_id=req.student_id,
    )
    ...
    return TokenResponse(
        access_token=create_access_token({"user_id": user.id, "role_id": user.role_id, "school_id": user.school_id, "role": role_name}),
        role=role_name,
        display_name=user.display_name,
        user_id=user.id,
    )
```

修改 wechat_login() 和 wechat_register() 中的 `user.role` → `user.role.name`（除非 role 为 None）：

```python
# wechat_login line 123-128:
token = create_access_token({"user_id": user.id, "role_id": user.role_id, "school_id": user.school_id, "role": user.role.name if user.role else ""})
role_name = user.role.name if user.role else ""

# wechat_register 创建 User 时需要 role_id 和 school_id:
default_school = db.query(School).filter(School.name == "默认学校").first()
student_role = db.query(Role).filter(Role.name == "student", Role.school_id == default_school.id).first()
user = User(
    username=username,
    password_hash=hash_password(random_password),
    role_id=student_role.id,
    school_id=default_school.id,
    display_name=req.display_name,
    wechat_openid=openid,
)
```

在 wechat_login/wechat_register 函数顶部增加 import：
```python
from models import Role, School
```

修改 get_me() (line 215-216)：需要返回 role 名称和 school 信息

```python
@router.get("/me", response_model=UserBrief)
def get_me(current_user: Annotated[User, Depends(get_current_user)]):
    return current_user
```

UserBrief schema 后续会更新以兼容 role_id 变更 —— 暂时此处依赖 schema 的 model_validate 自动转换。

- [ ] **Step 2: 更新 admin.py**

全部 `require_teacher` → `require_permission("user_manage")` / `require_permission("llm_monitor")` / `require_permission("stats_view")`：

在文件顶部 import：
```python
from core.security import hash_password, require_permission
```

逐一替换：

| 原代码 | 新代码 |
|-------|--------|
| `Depends(require_teacher)` on list_users (line 43) | `Depends(require_permission("user_manage"))` |
| `Depends(require_teacher)` on update_user (line 98) | `Depends(require_permission("user_manage"))` |
| `Depends(require_teacher)` on get_user_detail (line 166) | `Depends(require_permission("user_manage"))` |
| `Depends(require_teacher)` on delete_user (line 270) | `Depends(require_permission("user_manage"))` |
| `Depends(require_teacher)` on batch_create_users (line 300) | `Depends(require_permission("user_manage"))` |
| `Depends(require_teacher)` on get_stats (line 352) | `Depends(require_permission("stats_view"))` |
| `Depends(require_teacher)` on get_llm_stats (line 414) | `Depends(require_permission("llm_monitor"))` |
| `Depends(require_teacher)` on get_llm_logs (line 502) | `Depends(require_permission("llm_monitor"))` |
| `Depends(require_teacher)` on get_llm_log_detail (line 643) | `Depends(require_permission("llm_monitor"))` |
| `Depends(require_teacher)` on export_llm_logs_csv (line 657) | `Depends(require_permission("llm_monitor"))` |

user.role 字符串字段不再存在，替换所有 `User.role` 查询和 `user.role` 访问为 role_id:

- list_users 的 `role` 过滤 (line 63-64)：改为 role_id 过滤
```python
if role:
    role_obj = db.query(Role).filter(Role.name == role, Role.school_id == current_user.school_id).first()
    if role_obj:
        q = q.filter(User.role_id == role_obj.id)
```

- list_users 返回的 `role=u.role` → 需要预加载 Role 关系
```python
q = q.options(
    joinedload(User.role),
    joinedload(User.user_class).joinedload(UserClass.class_).joinedload(Class.grade)
)
```
然后在 items.append 中使用 `role=u.role.name if u.role else ""`

- update_user 的 req.role 处理 (lines 109-112)：
```python
if req.role is not None:
    role_obj = db.query(Role).filter(Role.name == req.role, Role.school_id == current_user.school_id).first()
    if not role_obj:
        raise HTTPException(status_code=400, detail="角色不存在")
    user.role_id = role_obj.id
```

- get_stats 的 User.role 查询 (line 353)：
```python
student_role = db.query(Role).filter(Role.name == "student", Role.school_id == current_user.school_id).first()
student_role_id = student_role.id if student_role else None
total_students = db.query(User).filter(User.role_id == student_role_id, User.school_id == current_user.school_id).count() if student_role_id else 0
```

- get_user_detail 的 User.role 查询 (line 169)：
```python
student_role = db.query(Role).filter(Role.name == "student", Role.school_id == current_user.school_id).first()
user = db.query(User).options(joinedload(User.role)).filter(User.id == user_id, User.role_id == student_role.id if student_role else -1, User.school_id == current_user.school_id).first()
```
返回中 `role=user.role.name if user.role else ""`

- 所有 `extra={"user_role": current_user.role}` 日志改为：
```python
extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""}
```

- 所有列表查询增加 `school_id` 过滤：
```python
q = q.filter(User.school_id == current_user.school_id)
```

- batch_create_users 中创建 User 时增加 role_id 和 school_id：
```python
role_obj = db.query(Role).filter(Role.name == u.role, Role.school_id == current_user.school_id).first()
if not role_obj:
    errors.append(f"第{i}行跳过 {u.username}: 角色不存在")
    skipped += 1
    continue
user = User(
    username=u.username,
    password_hash=hash_password(u.password),
    display_name=u.display_name,
    role_id=role_obj.id,
    school_id=current_user.school_id,
    student_id=u.student_id or None,
)
```

- [ ] **Step 3: 更新 admin_grades.py 和 admin_classes.py**

需要先读取这两个文件。替换 `require_teacher` → `require_permission("grade_class_manage")`，所有 CRUD 操作增加 school_id 过滤。

- [ ] **Step 4: 更新 admin_api.py**

替换 `require_teacher` → `require_permission("api_manage")`

- [ ] **Step 5: 更新 admin_prompts.py**

替换 `require_teacher` → `require_permission("prompt_manage")`

- [ ] **Step 6: 更新 training.py, stats.py, cases.py, feedback.py, export.py, notes.py, qa.py**

每个文件：替换 import 中的 `require_teacher` → `require_permission("对应权限")`，并替换所有 `require_teacher` 调用。

权限映射：
- training.py → `require_permission("score_review")`
- stats.py → `require_permission("stats_view")`
- cases.py → `require_permission("case_manage")`
- feedback.py → `require_permission("feedback_review")`
- export.py → `require_permission("export_data")`
- notes.py → `require_permission("record_notes")`
- qa.py → `require_permission("stats_view")` (admin QA 历史用的教师权限)

- [ ] **Step 7: Commit**

```bash
git add backend/routers/
git commit -m "refactor: 所有路由 require_teacher → require_permission + school_id过滤"
```


### Task 6: 更新 Pydantic Schemas

**Files:**
- Modify: `backend/schemas.py`

- [ ] **Step 1: TokenResponse 增加字段**

在 `TokenResponse` (line 39-45) 中增加 `school_id`, `school_name`：

```python
class TokenResponse(BaseModel):
    model_config = _RESP_CFG
    access_token: str
    token_type: str = "bearer"
    role: str
    display_name: str
    user_id: int
    school_id: int | None = None
    school_name: str | None = None
```

- [ ] **Step 2: WechatLoginResponse 增加字段**

```python
class WechatLoginResponse(BaseModel):
    model_config = _RESP_CFG
    access_token: str | None = None
    token_type: str = "bearer"
    role: str | None = None
    display_name: str | None = None
    user_id: int | None = None
    school_id: int | None = None
    school_name: str | None = None
    need_bind: bool = False
```

- [ ] **Step 3: 新增 School/Role 管理 Schema**

在文件末尾（General schemas 之前）添加：

```python
# ── School ──

class SchoolCreate(BaseModel):
    model_config = _REQ_CFG
    name: str = Field(min_length=1, max_length=80)
    admin_username: str = Field(min_length=1, max_length=50)
    admin_password: str = Field(min_length=6)
    admin_display_name: str = Field(min_length=1, max_length=50)


class SchoolResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    teacher_count: int = 0
    student_count: int = 0
    created_at: datetime


# ── Role ──

class RoleCreateRequest(BaseModel):
    model_config = _REQ_CFG
    name: str = Field(min_length=1, max_length=20)
    display_name: str = Field(min_length=1, max_length=40)
    permissions: list[str] = Field(default_factory=list)


class RoleUpdateRequest(BaseModel):
    model_config = _REQ_CFG
    display_name: str | None = Field(default=None, max_length=40)
    permissions: list[str] | None = None


class RoleResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    display_name: str
    is_system: bool = False
    school_id: int | None = None
    permissions: list[str] = []
    user_count: int = 0
```

- [ ] **Step 4: 更新 RegisterRequest 角色验证**

```python
class RegisterRequest(BaseModel):
    model_config = _REQ_CFG
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=6)
    role: str = Field(default="student", min_length=1, max_length=20)
    display_name: str = Field(min_length=1, max_length=50)
    student_id: str | None = None
    class_id: int | None = None
```

- [ ] **Step 5: 更新 BatchUserItem 角色验证**

```python
class BatchUserItem(BaseModel):
    model_config = _REQ_CFG
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=6)
    display_name: str = Field(min_length=1, max_length=50)
    role: str = Field(default="student", min_length=1, max_length=20)
    student_id: str | None = None
    class_id: int | None = None
```

- [ ] **Step 6: Commit**

```bash
git add backend/schemas.py
git commit -m "feat: 更新Pydantic schemas — 新增School/Role管理 + TokenResponse增加school信息"
```


### Task 7: 重写种子数据 (main.py)

**Files:**
- Modify: `backend/main.py:57-125`

- [ ] **Step 1: 重写 _seed_data 函数**

覆盖 `backend/main.py` 中的 `_seed_data` (lines 57-125)：

```python
def _seed_data():
    from core.database import SessionLocal
    from core.security import hash_password
    from models import Case, Role, RolePermission, Rubric, School, User

    SYSTEM_PERMISSIONS = {
        "super_admin": [
            "user_manage", "role_manage", "grade_class_manage", "case_manage",
            "training_access", "score_review", "stats_view", "qa_access",
            "llm_monitor", "api_manage", "prompt_manage", "feedback_review",
            "export_data", "record_notes", "school_manage",
        ],
        "school_admin": [
            "user_manage", "role_manage", "grade_class_manage", "case_manage",
            "training_access", "score_review", "stats_view", "qa_access",
            "llm_monitor", "feedback_review", "export_data", "record_notes",
        ],
        "teacher": [
            "grade_class_manage", "case_manage", "training_access",
            "score_review", "stats_view", "feedback_review",
            "export_data", "record_notes",
        ],
        "student": [
            "training_access", "qa_access",
        ],
    }

    SYSTEM_ROLES = [
        ("super_admin", "超级管理员"),
        ("school_admin", "学校管理员"),
        ("teacher", "教师"),
        ("student", "学生"),
    ]

    db = SessionLocal()
    try:
        school = db.query(School).filter(School.name == "默认学校").first()
        if not school:
            school = School(name="默认学校")
            db.add(school)
            db.flush()
            log.info("默认学校已创建")

        template_roles = {}
        existing_templates = db.query(Role).filter(Role.school_id.is_(None)).all()
        if not existing_templates:
            for name, display_name in SYSTEM_ROLES:
                template = Role(name=name, display_name=display_name, school_id=None, is_system=True)
                db.add(template)
                db.flush()
                template_roles[name] = template.id
                for perm in SYSTEM_PERMISSIONS.get(name, []):
                    db.add(RolePermission(role_id=template.id, permission=perm))
            db.commit()
            log.info("系统模板角色已初始化")
        else:
            for r in existing_templates:
                template_roles[r.name] = r.id

        school_roles = db.query(Role).filter(Role.school_id == school.id).all()
        school_role_ids = {}
        if not school_roles:
            for name, display_name in SYSTEM_ROLES:
                role = Role(name=name, display_name=display_name, school_id=school.id, is_system=True)
                db.add(role)
                db.flush()
                school_role_ids[name] = role.id
            db.commit()
            for name, perms in SYSTEM_PERMISSIONS.items():
                rid = school_role_ids.get(name)
                if rid:
                    for perm in perms:
                        db.add(RolePermission(role_id=rid, permission=perm))
            db.commit()
            log.info("默认学校角色已初始化")
        else:
            for r in school_roles:
                school_role_ids[r.name] = r.id

        if db.query(Rubric).count() == 0:
            rubric_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "rubrics", "nursing_history_v1.json")
            if os.path.isfile(rubric_path):
                import json as _json
                with open(rubric_path, encoding="utf-8") as f:
                    data = _json.load(f)
                db.add(Rubric(
                    name=data.get("id", "nursing_history_v1"),
                    version=data.get("version", "1.0"),
                    description=data.get("name", ""),
                    total_max=data.get("total_max", 100),
                    raw_max=data.get("raw_max", 57),
                    raw_scale=data.get("raw_scale", 3),
                    dimensions=data.get("dimensions", []),
                    is_active=True,
                ))
                db.commit()
                log.info("评分标准已导入")

        username = os.environ.get("SEED_ADMIN_USERNAME", "admin")
        password = os.environ.get("SEED_ADMIN_PASSWORD", "admin123")
        if not os.environ.get("SEED_ADMIN_USERNAME"):
            log.warning("SEED_ADMIN_* 未设置，使用默认 admin/admin123")
        if not db.query(User).filter(User.username == username).first():
            sa_role_id = school_role_ids.get("super_admin")
            db.add(User(
                username=username,
                password_hash=hash_password(password),
                role_id=sa_role_id,
                school_id=school.id,
                display_name="超级管理员",
            ))
            db.commit()
            log.info("超级管理员已创建 (%s)", username)

        if db.query(User).filter(User.username != username).count() == 0:
            student_role_id = school_role_ids.get("student")
            for i in range(1, 6):
                db.add(User(
                    username=f"student{i}",
                    password_hash=hash_password("123456"),
                    role_id=student_role_id,
                    school_id=school.id,
                    display_name=f"学生{i}",
                    student_id=f"202400{i:02d}",
                ))
            log.info("测试学生已创建 (student1-5 / 123456)")

            cases_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "cases")
            case_count = 0
            for fname in sorted(os.listdir(cases_dir)):
                if fname.endswith(".json"):
                    import json as _json
                    with open(os.path.join(cases_dir, fname), encoding="utf-8") as f:
                        d = _json.load(f)
                    db.add(Case(name=d.get("name", fname), description=d.get("description", ""), case_data=d, school_id=None))
                    case_count += 1
            db.commit()
            log.info("内置病例已导入 (%d)", case_count)
    finally:
        db.close()
```

- [ ] **Step 2: Commit**

```bash
git add backend/main.py
git commit -m "feat: 重写种子数据 — 多租户+四层系统角色+学校管理员"
```


### Task 8: 新增 admin_schools.py 和 admin_roles.py

**Files:**
- Create: `backend/routers/admin_schools.py`
- Create: `backend/routers/admin_roles.py`

- [ ] **Step 1: 创建 admin_schools.py**

```python
"""学校管理 (仅 super_admin 可访问)"""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from core.database import get_db
from core.security import hash_password, require_permission
from models import Case, Role, RolePermission, School, User
from schemas import (
    MessageResponse,
    PaginatedResponse,
    SchoolCreate,
    SchoolResponse,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/schools", tags=["学校管理"])

SYSTEM_PERMISSIONS = {
    "super_admin": [
        "user_manage", "role_manage", "grade_class_manage", "case_manage",
        "training_access", "score_review", "stats_view", "qa_access",
        "llm_monitor", "api_manage", "prompt_manage", "feedback_review",
        "export_data", "record_notes", "school_manage",
    ],
    "school_admin": [
        "user_manage", "role_manage", "grade_class_manage", "case_manage",
        "training_access", "score_review", "stats_view", "qa_access",
        "llm_monitor", "feedback_review", "export_data", "record_notes",
    ],
    "teacher": [
        "grade_class_manage", "case_manage", "training_access",
        "score_review", "stats_view", "feedback_review",
        "export_data", "record_notes",
    ],
    "student": [
        "training_access", "qa_access",
    ],
}

SYSTEM_ROLES = [
    ("super_admin", "超级管理员"),
    ("school_admin", "学校管理员"),
    ("teacher", "教师"),
    ("student", "学生"),
]


@router.get("", response_model=PaginatedResponse[SchoolResponse])
def list_schools(
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    current_user: User = Depends(require_permission("school_manage")),
    db: Session = Depends(get_db),
):
    total = db.query(func.count(School.id)).scalar() or 0
    schools = db.query(School).order_by(School.created_at.desc()).offset(offset).limit(limit).all()

    items = []
    for s in schools:
        teacher_role = db.query(Role).filter(Role.name == "teacher", Role.school_id == s.id).first()
        student_role = db.query(Role).filter(Role.name == "student", Role.school_id == s.id).first()
        teacher_count = db.query(func.count(User.id)).filter(User.school_id == s.id, User.role_id == teacher_role.id).scalar() if teacher_role else 0
        student_count = db.query(func.count(User.id)).filter(User.school_id == s.id, User.role_id == student_role.id).scalar() if student_role else 0
        items.append(SchoolResponse(
            id=s.id, name=s.name,
            teacher_count=teacher_count, student_count=student_count,
            created_at=s.created_at,
        ))

    return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)


@router.post("", response_model=SchoolResponse, status_code=status.HTTP_201_CREATED)
def create_school(
    req: SchoolCreate,
    current_user: User = Depends(require_permission("school_manage")),
    db: Session = Depends(get_db),
):
    if db.query(School).filter(School.name == req.name).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="学校名称已存在")

    school = School(name=req.name)
    db.add(school)
    db.flush()

    role_map = {}
    for name, display_name in SYSTEM_ROLES:
        role = Role(name=name, display_name=display_name, school_id=school.id, is_system=True)
        db.add(role)
        db.flush()
        role_map[name] = role.id
        for perm in SYSTEM_PERMISSIONS.get(name, []):
            db.add(RolePermission(role_id=role.id, permission=perm))

    admin_role_id = role_map.get("school_admin")
    db.add(User(
        username=req.admin_username,
        password_hash=hash_password(req.admin_password),
        role_id=admin_role_id,
        school_id=school.id,
        display_name=req.admin_display_name,
    ))
    db.commit()
    db.refresh(school)

    log.info("学校已创建: name=%s", req.name, extra={
        "user_id": current_user.id,
        "school_id": school.id,
    })

    return SchoolResponse(
        id=school.id, name=school.name,
        teacher_count=0, student_count=0,
        created_at=school.created_at,
    )


@router.delete("/{school_id}", response_model=MessageResponse)
def delete_school(
    school_id: int,
    current_user: User = Depends(require_permission("school_manage")),
    db: Session = Depends(get_db),
):
    if school_id == current_user.school_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能删除自己所在的学校")

    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(status_code=404, detail="学校不存在")

    name = school.name
    db.delete(school)
    db.commit()

    log.info("学校已删除: name=%s", name, extra={
        "user_id": current_user.id,
    })
    return {"message": f"学校 '{name}' 已删除"}
```

- [ ] **Step 2: 创建 admin_roles.py**

```python
"""角色管理 (school_admin 可管理本校角色)"""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import require_permission
from models import Role, RolePermission, User
from schemas import (
    MessageResponse,
    RoleCreateRequest,
    RoleResponse,
    RoleUpdateRequest,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/roles", tags=["角色管理"])


@router.get("", response_model=list[RoleResponse])
def list_roles(
    current_user: User = Depends(require_permission("role_manage")),
    db: Session = Depends(get_db),
):
    roles = db.query(Role).filter(Role.school_id == current_user.school_id).order_by(Role.id).all()

    result = []
    for r in roles:
        perms = db.query(RolePermission.permission).filter(RolePermission.role_id == r.id).all()
        user_count = db.query(func.count(User.id)).filter(User.role_id == r.id).scalar() or 0
        result.append(RoleResponse(
            id=r.id, name=r.name, display_name=r.display_name,
            is_system=r.is_system, school_id=r.school_id,
            permissions=[p.permission for p in perms],
            user_count=user_count,
        ))
    return result


@router.post("", response_model=RoleResponse, status_code=status.HTTP_201_CREATED)
def create_role(
    req: RoleCreateRequest,
    current_user: User = Depends(require_permission("role_manage")),
    db: Session = Depends(get_db),
):
    if db.query(Role).filter(Role.name == req.name, Role.school_id == current_user.school_id).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="角色名已存在")

    role = Role(name=req.name, display_name=req.display_name, school_id=current_user.school_id, is_system=False)
    db.add(role)
    db.flush()

    for perm in req.permissions:
        db.add(RolePermission(role_id=role.id, permission=perm))
    db.commit()
    db.refresh(role)

    log.info("角色已创建: name=%s", req.name, extra={
        "user_id": current_user.id, "school_id": current_user.school_id,
    })

    return RoleResponse(
        id=role.id, name=role.name, display_name=role.display_name,
        is_system=role.is_system, school_id=role.school_id,
        permissions=req.permissions, user_count=0,
    )


@router.put("/{role_id}", response_model=RoleResponse)
def update_role(
    role_id: int,
    req: RoleUpdateRequest,
    current_user: User = Depends(require_permission("role_manage")),
    db: Session = Depends(get_db),
):
    role = db.query(Role).filter(Role.id == role_id, Role.school_id == current_user.school_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="角色不存在")

    if req.display_name is not None:
        role.display_name = req.display_name

    if req.permissions is not None:
        db.query(RolePermission).filter(RolePermission.role_id == role.id).delete()
        for perm in req.permissions:
            db.add(RolePermission(role_id=role.id, permission=perm))

    db.commit()
    db.refresh(role)

    perms = db.query(RolePermission.permission).filter(RolePermission.role_id == role.id).all()
    user_count = db.query(func.count(User.id)).filter(User.role_id == role.id).scalar() or 0

    log.info("角色已更新: name=%s", role.name, extra={
        "user_id": current_user.id, "school_id": current_user.school_id,
    })

    return RoleResponse(
        id=role.id, name=role.name, display_name=role.display_name,
        is_system=role.is_system, school_id=role.school_id,
        permissions=[p.permission for p in perms],
        user_count=user_count,
    )


@router.delete("/{role_id}", response_model=MessageResponse)
def delete_role(
    role_id: int,
    current_user: User = Depends(require_permission("role_manage")),
    db: Session = Depends(get_db),
):
    role = db.query(Role).filter(Role.id == role_id, Role.school_id == current_user.school_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="角色不存在")

    if role.is_system:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="系统角色不可删除")

    user_count = db.query(func.count(User.id)).filter(User.role_id == role.id).scalar() or 0
    if user_count > 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"该角色下还有 {user_count} 个用户，无法删除")

    name = role.name
    db.delete(role)
    db.commit()

    log.info("角色已删除: name=%s", name, extra={
        "user_id": current_user.id, "school_id": current_user.school_id,
    })
    return {"message": f"角色 '{name}' 已删除"}
```

- [ ] **Step 3: Commit**

```bash
git add backend/routers/admin_schools.py backend/routers/admin_roles.py
git commit -m "feat: 新增学校管理和角色管理 API"
```


### Task 9: 注册新路由

**Files:**
- Modify: `backend/main.py:14-17` (imports)
- Modify: `backend/main.py:331-334` (router registration)

- [ ] **Step 1: 添加 import**

在 `backend/main.py` line 15 添加：
```python
from routers.admin_schools import router as admin_schools_router
from routers.admin_roles import router as admin_roles_router
```

- [ ] **Step 2: 注册路由**

在 line 332-334 的 for loop 和 include_router 之后添加：
```python
app.include_router(admin_schools_router)
app.include_router(admin_roles_router)
```

- [ ] **Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat: 注册学校和角色管理路由"
```


### Task 10: 后端测试验证

**Files:**
- No code changes — verify and fix

- [ ] **Step 1: Run existing tests**

```bash
cd backend && uv run pytest -q
```
期望: 大部分测试通过。关注失败情况，修复因模型变更导致的测试报错。

- [ ] **Step 2: 修复测试中的 role 字符串引用**

测试文件 `tests/test_admin.py` 等可能引用了 `User.role` 字符串字段，需要改为 `User.role_id` 或查询 Role 表。常见模式修复：
```python
# 旧: user.role == "student"
# 新: user.role_id == student_role.id

# 旧: User.role == "student"
# 新: User.role_id == student_role.id
```

- [ ] **Step 3: Run tests again**

```bash
cd backend && uv run pytest -q
```
期望: 全部通过

- [ ] **Step 4: Commit**

```bash
git add tests/ backend/routers/ backend/models.py backend/schemas.py backend/core/security.py backend/main.py
git commit -m "fix: 修复测试中User.role字段引用为role_id + school_id过滤"
```

(Note: 这一步可能需要多次迭代，如果测试量大，可以创建一个包含全部修复的 commit)


### Task 11: 更新前端类型定义

**Files:**
- Modify: `frontend/src/types/store.ts:1-53`

- [ ] **Step 1: 更新 User 和新增类型**

覆盖 `frontend/src/types/store.ts`：

```typescript
export interface User {
  user_id: number;
  username?: string;
  role: string;
  display_name: string;
  avatar?: string;
  grade?: string;
  className?: string;
  school_id?: number;
  school_name?: string;
}

export interface School {
  id: number;
  name: string;
  teacher_count: number;
  student_count: number;
  created_at: string;
}

export interface RoleItem {
  id: number;
  name: string;
  display_name: string;
  is_system: boolean;
  school_id: number | null;
  permissions: string[];
  user_count: number;
}

export interface Grade {
  id: number;
  name: string;
  class_count?: number;
  student_count?: number;
  created_at?: string;
}

export interface ClassItem {
  id: number;
  name: string;
  grade_id: number;
  grade_name?: string;
  student_count?: number;
  created_at?: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<User>;
  refreshUser: () => Promise<void>;
  logout: () => void;
}

export interface GradesClassesState {
  grades: Grade[];
  classes: ClassItem[];
  loading: boolean;
  fetchGrades: () => Promise<void>;
  createGrade: (name: string) => Promise<Grade>;
  updateGrade: (id: number, name: string) => Promise<Grade>;
  deleteGrade: (id: number) => Promise<void>;
  fetchClasses: (gradeId?: number) => Promise<ClassItem[]>;
  createClass: (gradeId: number, name: string) => Promise<ClassItem>;
  updateClass: (id: number, body: Partial<ClassItem>) => Promise<ClassItem>;
  deleteClass: (id: number) => Promise<void>;
}

export interface LLMState {
  tab: string;
  setTab: (tab: string) => void;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/types/store.ts
git commit -m "refactor: 前端类型更新 — User增加school字段 + 新增School/RoleItem类型"
```


### Task 12: 更新前端 Auth Store

**Files:**
- Modify: `frontend/src/stores/authStore.ts:1-56`

- [ ] **Step 1: 更新 login 和 refreshUser**

覆盖 `frontend/src/stores/authStore.ts`：

```typescript
import { create } from "zustand";
import { login as apiLogin, getMe } from "@/api/api-client";
import type { AuthState, User } from "../types/store";

const useAuthStore = create<AuthState>((set, get) => ({
  user: ((): User | null => {
    const userStr = localStorage.getItem("user");
    if (userStr) {
      try {
        const parsed = JSON.parse(userStr);
        if (parsed.id && !parsed.user_id) {
          parsed.user_id = parsed.id;
          delete parsed.id;
          localStorage.setItem("user", JSON.stringify(parsed));
        }
        return parsed as User;
      } catch {
        return null;
      }
    }
    return null;
  })(),
  token: ((): string | null => {
    return localStorage.getItem("token") || null;
  })(),

  login: async (username: string, password: string): Promise<User> => {
    const { data } = await apiLogin(username, password);
    localStorage.setItem("token", data.access_token);
    const user: User = {
      user_id: data.user_id,
      role: data.role,
      display_name: data.display_name,
      school_id: data.school_id ?? undefined,
      school_name: data.school_name ?? undefined,
    };
    localStorage.setItem("user", JSON.stringify(user));
    set({ user, token: data.access_token });
    return user;
  },

  refreshUser: async (): Promise<void> => {
    try {
      const { data } = await getMe();
      const user: User = {
        user_id: data.id,
        role: data.role,
        display_name: data.display_name,
      };
      localStorage.setItem("user", JSON.stringify(user));
      set({ user });
    } catch {
      console.warn("[authStore] refreshUser 失败，强制登出");
      get().logout();
    }
  },

  logout: (): void => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    set({ user: null, token: null });
  },
}));

export default useAuthStore;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/stores/authStore.ts
git commit -m "refactor: authStore — login时保存school_id + 更新User类型"
```


### Task 13: 更新前端 API Client

**Files:**
- Modify: `frontend/src/api/api-client.ts`

- [ ] **Step 1: 新增学校和角色 API 调用**

在 `frontend/src/api/api-client.ts` 末尾追加：

```typescript
// Schools
export const getSchools = (params: Record<string, unknown> = {}) =>
  api.get<Record<string, unknown>>("/admin/schools", { params });

export const createSchool = (data: Record<string, unknown>) =>
  api.post<Record<string, unknown>>("/admin/schools", data);

export const deleteSchool = (id: number) =>
  api.delete<Record<string, unknown>>(`/admin/schools/${id}`);

// Roles
export const getRoles = () =>
  api.get<Record<string, unknown>[]>("/admin/roles");

export const createRole = (data: Record<string, unknown>) =>
  api.post<Record<string, unknown>>("/admin/roles", data);

export const updateRole = (id: number, data: Record<string, unknown>) =>
  api.put<Record<string, unknown>>(`/admin/roles/${id}`, data);

export const deleteRole = (id: number) =>
  api.delete<Record<string, unknown>>(`/admin/roles/${id}`);
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api/api-client.ts
git commit -m "feat: 前端 API — 新增学校和角色管理接口"
```


### Task 14: 更新 ProtectedRoute (App.tsx)

**Files:**
- Modify: `frontend/src/App.tsx:40-46`

- [ ] **Step 1: 将 ProtectedRoute 改为 permission 检查**

替换 ProtectedRoute 组件 (lines 40-46)：

```tsx
function ProtectedRoute({ children, role, permission }: { children: ReactNode; role?: string; permission?: string }) {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  if (!token || !user) return <Navigate to="/login" replace />;

  if (permission) {
    const permsStr = localStorage.getItem("user_permissions");
    if (!permsStr) return <Navigate to="/login" replace />;
    try {
      const perms: string[] = JSON.parse(permsStr);
      if (!perms.includes(permission)) return <Navigate to="/login" replace />;
    } catch {
      return <Navigate to="/login" replace />;
    }
  }

  if (role && user.role !== role) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
```

- [ ] **Step 2: 更新所有路由保护**

| 路由 | 旧 | 新 |
|------|-----|-----|
| `/home` | `<ProtectedRoute>` | `<ProtectedRoute>` |
| `/cases` | `role="student"` | `permission="training_access"` |
| `/training/:recordId` | `role="student"` | `permission="training_access"` |
| `/history` | `<ProtectedRoute>` | `<ProtectedRoute>` |
| `/record/:id` | `<ProtectedRoute>` | `<ProtectedRoute>` |
| `/qa` | `<ProtectedRoute>` | `<ProtectedRoute>` |
| `/stats` | `<ProtectedRoute>` | `<ProtectedRoute>` |
| `/admin` | `role="teacher"` | `permission="score_review"` |
| `/admin/llm` | `role="teacher"` | `permission="llm_monitor"` |
| `/admin/cases` | `role="teacher"` | `permission="case_manage"` |
| `/admin/users/:userId` | `role="teacher"` | `permission="user_manage"` |
| `/admin/users` | `role="teacher"` | `permission="user_manage"` |
| `/admin/grades-classes` | `role="teacher"` | `permission="grade_class_manage"` |
| `/admin/feedback` | `role="teacher"` | `permission="feedback_review"` |

新增路由：
```tsx
<Route path="/admin/schools" element={<ProtectedRoute permission="school_manage"><AdminSchools /></ProtectedRoute>} />
<Route path="/admin/roles" element={<ProtectedRoute permission="role_manage"><AdminRoles /></ProtectedRoute>} />
```

在文件顶部添加 lazy imports：
```tsx
const AdminSchools = lazy(() => import("@/pages/admin/SchoolsPage"));
const AdminRoles = lazy(() => import("@/pages/admin/RolesPage"));
```

- [ ] **Step 3: 在 authStore 的 login 中持久化 permissions**

修改 `frontend/src/stores/authStore.ts` login 方法，在 TokenResponse 返回后，需要调用 `/api/auth/me` 获取 permissions 列表并缓存。但更简单的方式是将 permissions 直接放在 login 响应中。

回到 Task 6，更新 backend 的 `auth.py` login 端点，在 TokenResponse 中返回 permissions：

在 `routers/auth.py` login 中添加：
```python
rows = db.query(RolePermission.permission).filter(RolePermission.role_id == user.role_id).all()
permissions = [r.permission for r in rows]
```

然后在 TokenResponse 返回中添加 permissions 字段。先更新 schemas.py 的 TokenResponse：
```python
class TokenResponse(BaseModel):
    ...
    permissions: list[str] = []
```

然后 auth.py login 中：
```python
return TokenResponse(
    access_token=token,
    role=user.role.name if user.role else "",
    display_name=user.display_name,
    user_id=user.id,
    school_id=user.school_id,
    school_name=user.school.name if user.school else None,
    permissions=permissions,
)
```

最后在 authStore.ts login 中：
```typescript
const perms = data.permissions || [];
localStorage.setItem("user_permissions", JSON.stringify(perms));
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/stores/authStore.ts backend/schemas.py backend/routers/auth.py
git commit -m "refactor: ProtectedRoute改为permission检查 + login返回permissions"
```


### Task 15: 更新 Layout 动态菜单

**Files:**
- Modify: `frontend/src/components/Layout.tsx`

- [ ] **Step 1: 按权限动态渲染导航**

将 `studentLinks` 和 `teacherLinks` 替换为统一的 link 定义 + 权限过滤：

```tsx
import { Shield } from "lucide-react";

interface NavLinkItem {
  to: string;
  icon: typeof Home;
  label: string;
  permission?: string;
}

const allLinks: NavLinkItem[] = [
  { to: "/home", icon: Home, label: "首页" },
  { to: "/cases", icon: Stethoscope, label: "病例训练", permission: "training_access" },
  { to: "/history", icon: ClipboardList, label: "训练记录" },
  { to: "/qa", icon: HelpCircle, label: "护理问答" },
  { to: "/stats", icon: BarChart3, label: "训练统计" },
  { to: "/admin", icon: Settings, label: "训练管理", permission: "score_review" },
  { to: "/admin/users", icon: Users, label: "用户管理", permission: "user_manage" },
  { to: "/admin/grades-classes", icon: GraduationCap, label: "班级管理", permission: "grade_class_manage" },
  { to: "/admin/cases", icon: UserSearch, label: "病例管理", permission: "case_manage" },
  { to: "/admin/roles", icon: Shield, label: "角色管理", permission: "role_manage" },
  { to: "/admin/llm", icon: Server, label: "LLM 管理", permission: "llm_monitor" },
  { to: "/admin/feedback", icon: MessageSquare, label: "用户反馈", permission: "feedback_review" },
  { to: "/admin/schools", icon: GraduationCap, label: "学校管理", permission: "school_manage" },
];
```

然后在 Layout 组件中：
```tsx
function getVisibleLinks(): NavLinkItem[] {
  const permsStr = localStorage.getItem("user_permissions");
  if (!permsStr) return allLinks.slice(0, 5);
  try {
    const perms: string[] = JSON.parse(permsStr);
    return allLinks.filter((link) => !link.permission || perms.includes(link.permission));
  } catch {
    return allLinks.slice(0, 5);
  }
}

const links = getVisibleLinks();
```

移除基于 `isTeacher` 的角色名称显示：
```tsx
// 旧: <div className="text-xs text-muted-foreground">{isTeacher ? "教师" : "学生"}</div>
// 新:
<div className="text-xs text-muted-foreground">{user?.role || "用户"}</div>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/Layout.tsx
git commit -m "feat: Layout导航菜单按权限动态渲染"
```


### Task 16: 新增前端页面 (SchoolsPage, RolesPage)

**Files:**
- Create: `frontend/src/pages/admin/SchoolsPage.tsx`
- Create: `frontend/src/pages/admin/RolesPage.tsx`

- [ ] **Step 1: 创建 SchoolsPage.tsx**

```tsx
import { useState } from "react";
import { Building, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { createSchool, deleteSchool, getSchools } from "@/api/api-client";
import Modal from "@/components/ui/Modal";

interface SchoolItem {
  id: number;
  name: string;
  teacher_count: number;
  student_count: number;
  created_at: string;
}

export default function SchoolsPage() {
  const [schools, setSchools] = useState<SchoolItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminDisplayName, setAdminDisplayName] = useState("");

  const loadSchools = async () => {
    setLoading(true);
    try {
      const { data } = await getSchools({ limit: 100 }) as { data: { items: SchoolItem[] } };
      setSchools(data.items || []);
    } catch {
      toast.error("加载学校列表失败");
    } finally {
      setLoading(false);
    }
  };

  useState(() => { loadSchools(); });

  const handleCreate = async () => {
    if (!name.trim() || !adminUsername.trim() || !adminPassword || !adminDisplayName.trim()) {
      toast.error("请填写所有字段");
      return;
    }
    try {
      await createSchool({ name, admin_username: adminUsername, admin_password: adminPassword, admin_display_name: adminDisplayName });
      toast.success("学校创建成功");
      setName(""); setAdminUsername(""); setAdminPassword(""); setAdminDisplayName("");
      setShowCreate(false);
      loadSchools();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "创建失败");
    }
  };

  const handleDelete = async (id: number, schoolName: string) => {
    if (!window.confirm(`确定要删除学校「${schoolName}」？此操作不可恢复。`)) return;
    try {
      await deleteSchool(id);
      toast.success("学校已删除");
      loadSchools();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "删除失败");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">学校管理</h1>
        <Button onClick={() => setShowCreate(true)}><Plus size={16} /> 新建学校</Button>
      </div>

      <div className="rounded-xl border bg-card">
        <table className="w-full">
          <thead>
            <tr className="border-b text-left text-sm text-muted-foreground">
              <th className="px-4 py-3">学校名称</th>
              <th className="px-4 py-3">教师数</th>
              <th className="px-4 py-3">学生数</th>
              <th className="px-4 py-3">创建时间</th>
              <th className="px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {schools.map((s) => (
              <tr key={s.id} className="border-b last:border-0 text-sm">
                <td className="px-4 py-3 font-medium">{s.name}</td>
                <td className="px-4 py-3">{s.teacher_count}</td>
                <td className="px-4 py-3">{s.student_count}</td>
                <td className="px-4 py-3 text-muted-foreground">{s.created_at ? new Date(s.created_at).toLocaleDateString() : ""}</td>
                <td className="px-4 py-3">
                  <Button variant="ghost" size="sm" className="text-destructive h-8" onClick={() => handleDelete(s.id, s.name)}>
                    <Trash2 size={14} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="新建学校">
        <div className="space-y-4 py-2">
          <div>
            <Label>学校名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：北京护理学院" />
          </div>
          <div>
            <Label>管理员用户名</Label>
            <Input value={adminUsername} onChange={(e) => setAdminUsername(e.target.value)} placeholder="学校管理员账号" />
          </div>
          <div>
            <Label>管理员密码</Label>
            <Input type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="至少6位" />
          </div>
          <div>
            <Label>管理员显示名</Label>
            <Input value={adminDisplayName} onChange={(e) => setAdminDisplayName(e.target.value)} placeholder="管理员姓名" />
          </div>
          <Button className="w-full" onClick={handleCreate}>创建学校</Button>
        </div>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 2: 创建 RolesPage.tsx**

```tsx
import { useEffect, useState } from "react";
import { Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { createRole, deleteRole, getRoles, updateRole } from "@/api/api-client";
import Modal from "@/components/ui/Modal";

interface RoleItem {
  id: number;
  name: string;
  display_name: string;
  is_system: boolean;
  permissions: string[];
  user_count: number;
}

const ALL_PERMISSIONS = [
  { key: "user_manage", label: "用户管理" },
  { key: "role_manage", label: "角色管理" },
  { key: "grade_class_manage", label: "班级管理" },
  { key: "case_manage", label: "病例管理" },
  { key: "training_access", label: "训练功能" },
  { key: "score_review", label: "成绩查看" },
  { key: "stats_view", label: "数据统计" },
  { key: "qa_access", label: "护理问答" },
  { key: "llm_monitor", label: "LLM 监控" },
  { key: "api_manage", label: "API 管理" },
  { key: "prompt_manage", label: "Prompt 管理" },
  { key: "feedback_review", label: "反馈管理" },
  { key: "export_data", label: "数据导出" },
  { key: "record_notes", label: "训练批注" },
  { key: "school_manage", label: "学校管理" },
];

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editPerms, setEditPerms] = useState<string[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");

  const loadRoles = async () => {
    setLoading(true);
    try {
      const { data } = await getRoles() as { data: RoleItem[] };
      setRoles(data || []);
    } catch {
      toast.error("加载角色列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRoles(); }, []);

  const togglePerm = (perm: string) => {
    setEditPerms((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  const startEdit = (role: RoleItem) => {
    setEditId(role.id);
    setEditPerms([...role.permissions]);
  };

  const saveEdit = async (roleId: number, displayName: string) => {
    try {
      await updateRole(roleId, { permissions: editPerms });
      toast.success("权限已保存");
      setEditId(null);
      loadRoles();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "保存失败");
    }
  };

  const handleCreate = async () => {
    if (!newName.trim() || !newDisplayName.trim()) {
      toast.error("请填写角色名和显示名");
      return;
    }
    try {
      await createRole({ name: newName, display_name: newDisplayName, permissions: [] });
      toast.success("角色已创建，请编辑权限");
      setNewName(""); setNewDisplayName(""); setShowCreate(false);
      loadRoles();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "创建失败");
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`确定要删除角色「${name}」？`)) return;
    try {
      await deleteRole(id);
      toast.success("角色已删除");
      loadRoles();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "删除失败");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">角色管理</h1>
        <Button onClick={() => setShowCreate(true)}><Plus size={16} /> 新建角色</Button>
      </div>

      <div className="space-y-3">
        {roles.map((role) => (
          <div key={role.id} className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="font-semibold">{role.display_name}</span>
                <code className="ml-2 text-xs text-muted-foreground">{role.name}</code>
                {role.is_system && <span className="ml-2 text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">系统</span>}
                <span className="ml-2 text-xs text-muted-foreground">{role.user_count} 用户</span>
              </div>
              <div className="flex gap-2">
                {editId === role.id ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => saveEdit(role.id, role.display_name)}><Save size={14} /> 保存</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditId(null)}><X size={14} /></Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="outline" onClick={() => startEdit(role)}>编辑权限</Button>
                    {!role.is_system && (
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(role.id, role.name)}>
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
            {editId === role.id ? (
              <div className="grid grid-cols-3 gap-2 mt-3">
                {ALL_PERMISSIONS.map((p) => (
                  <label key={p.key} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <Checkbox checked={editPerms.includes(p.key)} onCheckedChange={() => togglePerm(p.key)} />
                    {p.label}
                  </label>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {role.permissions.length === 0 && <span className="text-xs text-muted-foreground">无权限</span>}
                {role.permissions.map((p) => (
                  <span key={p} className="text-xs bg-muted px-1.5 py-0.5 rounded">{ALL_PERMISSIONS.find((ap) => ap.key === p)?.label || p}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="新建角色">
        <div className="space-y-4 py-2">
          <div>
            <Label>角色标识</Label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="英文标识，如：intern_teacher" />
          </div>
          <div>
            <Label>显示名称</Label>
            <Input value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} placeholder="如：见习教师" />
          </div>
          <Button className="w-full" onClick={handleCreate}>创建角色</Button>
        </div>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/admin/SchoolsPage.tsx frontend/src/pages/admin/RolesPage.tsx
git commit -m "feat: 新增学校管理和角色管理前端页面"
```


### Task 17: 最终验证

**Files:**
- No new files

- [ ] **Step 1: 后端测试**

```bash
cd backend && uv run pytest -q
```
期望: 全部通过

- [ ] **Step 2: 后端 lint**

```bash
cd backend && uv run ruff check .
```
期望: 零错误

- [ ] **Step 3: 前端 TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```
期望: 零错误

- [ ] **Step 4: 前端 lint**

```bash
cd frontend && npx biome check src/
```
期望: 无问题（或仅 pre-existing warnings）

- [ ] **Step 5: Commit (如有修正)**

```bash
git add -A
git commit -m "fix: 最终验证 — 修复lint和测试问题"
```

---

### 完成核查清单

- [ ] 所有 `require_teacher` 已替换为 `require_permission("具体权限")` — 共约 12 个文件
- [ ] `backend/models.py` 中不再有 `user.role` 字符串字段
- [ ] 所有 `current_user.role` 改为 `current_user.role.name` 或 `current_user.role_id`
- [ ] 所有管理端点列表查询增加了 `school_id` 过滤
- [ ] seed 数据幂等：可重复启动，不重复创建
- [ ] 学校创建时自动复制 4 个系统角色和权限
- [ ] 角色管理页面支持创建/编辑/删除
- [ ] 前端菜单按权限动态显示
- [ ] 默认 admin 变为 super_admin 角色
- [ ] 迁移脚本完整 — upgrade 和 downgrade 均可执行
- [ ] 测试全部通过
