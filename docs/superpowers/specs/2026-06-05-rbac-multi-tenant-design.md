# RBAC 多租户 + 自定义角色 + 页面级权限 设计文档

## 概述

将当前二元角色系统（teacher/student）升级为多租户隔离 + 可自定义角色 + 页面级权限控制。系统目前处于原型阶段，采用一次性干净迁移，不做向后兼容。

## 需求摘要

- **多租户**：多个学校独立隔离，各自拥有教师、学生、年级、班级
- **可自定义角色**：学校管理员可创建角色，为角色分配权限组合
- **页面级权限**：每个页面/路由由独立权限控制，替代当前的 `require_teacher` 二元检查
- **保留现有结构**：Grade → Class → User 层级不变
- **快速升级**：原型阶段，一次性迁移，无需渐进过渡

---

## 一、数据模型

### 1.1 新增表

```python
class School(Base):
    __tablename__ = "schools"
    id: int (PK)
    name: str (unique)
    created_at: datetime
```

### 1.2 重构表

**roles** — 主键从 name 改为 id，角色归属到学校：

```python
class Role(Base):
    __tablename__ = "roles"
    id: int (PK, auto-increment)
    name: str (unique)
    display_name: str
    school_id: int | None (FK → schools.id, nullable)
    is_system: bool
    # school_id = NULL 表示系统模板角色
    # school_id = 具体学校 表示该校自定义或复制的角色
```

**role_permissions** — FK 从 role_name 改为 role_id：

```python
class RolePermission(Base):
    __tablename__ = "role_permissions"
    id: int (PK)
    role_id: int (FK → roles.id, ondelete CASCADE)
    permission: str
    UniqueConstraint(role_id, permission)
```

**users** — role 字符串替换为 role_id，新增 school_id：

```python
class User(Base):
    __tablename__ = "users"
    id: int (PK)
    username: str
    password_hash: str
    role_id: int (FK → roles.id, ondelete RESTRICT)
    school_id: int (FK → schools.id, ondelete RESTRICT)
    display_name: str
    student_id: str | None
    wechat_openid: str | None
    created_at: datetime
    # 移除旧字段: role (str)
```

**grades** — 唯一约束从 name 改为 (school_id, name)，归属学校：

```python
class Grade(Base):
    __tablename__ = "grades"
    id: int (PK)
    name: str
    school_id: int (FK → schools.id, ondelete CASCADE)
    created_at: datetime
    UniqueConstraint(school_id, name)
```

**cases** — 新增可选学校归属（NULL=全局共享）：

```python
class Case(Base):
    ... (现有字段)
    school_id: int | None (FK → schools.id, nullable)
    # NULL = 全局共享病例，非NULL = 学校私有病例
```

### 1.3 不变表

`classes`, `user_class`, `training_records`, `messages`, `scores`, `notes`, `rubrics`, `llm_call_logs`, `api_secrets`, `llm_configs`, `qa_sessions`, `qa_records`, `feedbacks`, `prompt_templates` — 结构不变。

---

## 二、角色体系

### 2.1 系统模板角色（school_id = NULL）

| 角色名 | 显示名 | 用途 |
|--------|--------|------|
| super_admin | 超级管理员 | 跨学校管理，唯一能创建学校和管理 API 的角色 |
| school_admin | 学校管理员 | 管理本校用户、角色、年级、班级 |
| teacher | 教师 | 管理班级、病例、评分、统计 |
| student | 学生 | 训练和问答 |

### 2.2 学校角色（school_id = 具体学校）

创建学校时，自动将 4 个模板角色的 name/display_name/is_system + 权限集复制到该校。学校管理员可在此基础上创建新角色或编辑现有角色的权限。

### 2.3 角色编辑规则

- `is_system=True` 的角色不可删除，不可改名，但可编辑权限
- 学校管理员只能编辑自己学校的角色
- 超级管理员只能编辑系统模板角色

---

## 三、权限定义（15 个页面级权限）

| 权限标识 | 对应功能/页面 | 默认拥有者 |
|---------|-------------|-----------|
| `user_manage` | 用户管理（增删改查、批量导入） | super_admin, school_admin |
| `role_manage` | 角色管理（创建/编辑角色和权限） | super_admin, school_admin |
| `grade_class_manage` | 年级和班级管理 | super_admin, school_admin, teacher |
| `case_manage` | 病例库管理 | super_admin, school_admin, teacher |
| `training_access` | 训练功能入口 | 全部 |
| `score_review` | 查看评分和训练记录 | super_admin, school_admin, teacher |
| `stats_view` | 统计面板 | super_admin, school_admin, teacher |
| `qa_access` | 问答功能 | 全部 |
| `llm_monitor` | LLM调用监控和日志 | super_admin, school_admin |
| `api_manage` | API密钥和模型配置 | super_admin |
| `prompt_manage` | Prompt模板管理 | super_admin |
| `feedback_review` | 反馈管理 | super_admin, school_admin, teacher |
| `export_data` | 数据导出 | super_admin, school_admin, teacher |
| `record_notes` | 训练记录批注 | super_admin, school_admin, teacher |
| `school_manage` | 学校管理（创建/管理学校） | super_admin |

### 默认权限分配

```
super_admin:  全部 15 个
school_admin: 12 个 (不含 api_manage, prompt_manage, school_manage)
teacher:      7 个  (grade_class_manage, case_manage, training_access,
                     score_review, stats_view, feedback_review,
                     export_data, record_notes)
student:      2 个  (training_access, qa_access)
```

---

## 四、后端鉴权改造

### 4.1 新的 require_permission 依赖项

```python
def require_permission(permission: str):
    def checker(current_user: User = Depends(get_current_user)) -> User:
        if not current_user.has_permission(permission):
            raise HTTPException(status_code=403, detail="权限不足")
        return current_user
    return checker
```

### 4.2 JWT 改造

JWT payload 新增字段：
```json
{
  "user_id": 1,
  "school_id": 1,
  "role_id": 1,
  "exp": 1234567890
}
```

### 4.3 get_current_user 改造

- 从 JWT 解析 user_id + school_id
- 查询 user 及其 role_id
- 查询该 role_id 的所有 permission
- 缓存到 user 对象

### 4.4 路由鉴权替换

所有 `Depends(require_teacher)` 替换为 `Depends(require_permission("具体权限"))`：

| 模块 | 旧检查 | 新检查 |
|------|--------|--------|
| admin.py 用户管理 | require_teacher | user_manage |
| admin.py LLM日志 | require_teacher | llm_monitor |
| admin_grades.py | require_teacher | grade_class_manage |
| admin_classes.py | require_teacher | grade_class_manage |
| admin_api.py | require_teacher | api_manage |
| admin_prompts.py | require_teacher | prompt_manage |
| training.py 管理端点 | require_teacher | score_review |
| stats.py | require_teacher | stats_view |
| feedback.py 管理 | require_teacher | feedback_review |
| export.py | require_teacher | export_data |
| notes.py | require_teacher | record_notes |
| cases.py 管理端点 | require_teacher | case_manage |

---

## 五、前端改造

### 5.1 ProtectedRoute

```tsx
// 旧: <ProtectedRoute role="teacher">
// 新: <ProtectedRoute permission="user_manage">
```

从 JWT 或 /api/auth/me 获取用户权限列表，检查是否包含所需 permission。

### 5.2 导航菜单

左侧菜单按权限动态渲染。用户只能看到自己有权限的菜单项。

### 5.3 新增页面

- **角色管理页** (`/admin/roles`)：学校管理员可查看、创建、编辑角色，勾选权限
- **学校管理页** (`/admin/schools`)：超管可创建、查看所有学校

### 5.4 用户类型扩展

```typescript
type Role = "super_admin" | "school_admin" | "teacher" | "student" | string;
interface User {
  id: number;
  username: string;
  role: Role;
  displayName: string;
  schoolId: number;
  schoolName: string;
  permissions: string[];
}
```

---

## 六、种子数据

启动时 `_seed_data()` 执行流程：

```
1. 学校不存在 → 创建"默认学校"
2. 默认学校没有系统角色 → 从模板复制 4 个角色 + 权限
3. 无超管 → 创建 super_admin (SEED_ADMIN_USERNAME/SEED_ADMIN_PASSWORD)
   - 属于默认学校
   - 角色 = super_admin
4. 无其他用户 → 创建 5 个测试学生 (角色=student，属于默认学校)
   + 导入病例 (school_id=NULL)
```

每步独立判断（idempotent），可重复执行不重复创建。

---

## 七、数据迁移

一次性迁移脚本，执行顺序：

```
1. CREATE TABLE schools
2. INSERT 默认学校 "默认学校"
3. 重构 roles 表:
   - 添加 id (PK, serial), school_id (FK nullable)
   - 迁移现有 role_permissions FK: role_name → role_id
   - 移除 roles.name 主键约束，改为 unique
4. users 表:
   - 添加 school_id (FK, 设默认值=默认学校ID)
   - 添加 role_id (FK, 从原 role 字符串映射)
   - 删除 role 字符串列
5. grades 表:
   - 添加 school_id (FK, 设默认值=默认学校ID)
   - 移除 name unique，改为 (school_id, name) unique
6. cases 表:
   - 添加 school_id (FK nullable, 默认 NULL)
```

现有 admin 用户的 role 从 "teacher" 迁移为 super_admin 角色。

---

## 八、API 变更

### 新增端点

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | /api/admin/schools | school_manage | 学校列表 |
| POST | /api/admin/schools | school_manage | 创建学校 |
| GET | /api/admin/roles | role_manage | 角色列表（按 school_id 过滤） |
| POST | /api/admin/roles | role_manage | 创建自定义角色 |
| PUT | /api/admin/roles/{id} | role_manage | 编辑角色（含权限） |
| DELETE | /api/admin/roles/{id} | role_manage | 删除角色（仅非系统角色） |

### 改造端点

- `POST /api/auth/login` — JWT 返回新增 school_id, role_id, permissions
- `GET /api/auth/me` — 返回新增 school_id, school_name, permissions 列表
- 所有管理端点的 `require_teacher` → `require_permission`
- 所有列表查询端点自动按 `current_user.school_id` 过滤
