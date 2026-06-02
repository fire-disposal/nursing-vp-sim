# RBAC 权限架构 + 年级班级管理 设计文档

> 日期: 2026-06-02 | 分支: feature/rbac-classes-management | 阶段: Phase 1 可部署性

## 一、背景与动机

当前系统为生产级 MVP，但缺乏组织机构模型：

- 用户是扁平的，仅通过 `role` 字符串区分 teacher/student
- 无班级、年级、学期等组织维度
- 600 学生的卫校场景下，教师面对一个无分组的大列表
- 权限系统仅为 `if user.role == "teacher"` 的硬编码判断

**目标：** 建立 RBAC 权限基础设施 + 年级/班级组织模型，使系统可被学校真正部署使用。

## 二、设计原则

1. **渐进式重构** — 本次只建基础设施，不改变现有 teacher/student 行为
2. **向后兼容** — `User.role` 字段保留，旧代码中 `user.role == "teacher"` 继续有效
3. **方案 A 权限策略** — 教师全局可见所有学生，班级仅作筛选/分组维度，不做权限隔离
4. **DB schema 预留方案 C 扩展位** — 年级/班级结构天然支持未来多机构扩展

## 三、数据模型设计

### 3.1 RBAC 权限系统

```
┌──────────┐     ┌──────────────────┐
│   roles  │────<│ role_permissions │
│          │     │                  │
│ name (PK)│     │ role_name (FK)   │
│ disp_name│     │ permission       │
│ is_system│     └──────────────────┘
└──────────┘
     │
     │ FK
     ▼
┌──────────┐
│   users  │
│ role (FK)│
└──────────┘
```

#### `roles` 表

| 列 | 类型 | 说明 |
|----|------|------|
| name | VARCHAR(20) PK | 角色标识符 `super_admin` / `teacher` / `student` |
| display_name | VARCHAR(40) | 中文展示名 |
| is_system | BOOLEAN | 系统内置角色不可删除 |

#### `role_permissions` 表

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK | |
| role_name | VARCHAR(20) FK → roles.name | |
| permission | VARCHAR(40) | 权限标识符字符串 |

#### `User` 模型变更

- `role` 字段从 `String(10)` 改为 `String(20)`，加 FK → `roles.name`
- 新增 `permissions_cache` transient 属性（非持久化）
- 新增 `has_permission(permission: str) -> bool` 方法
- 新增 `get_permissions(db: Session) -> set[str]` 方法

#### 种子权限清单

| 权限标识符 | 说明 | 授予角色 |
|------------|------|---------|
| `teacher_access` | 教师端全部功能 | teacher |
| `user_manage` | 用户管理 CRUD | teacher |
| `case_manage` | 病例管理 | teacher |
| `score_review` | 评分复核 | teacher |
| `llm_monitor` | LLM 调用监控 | teacher |
| `api_manage` | API 配置管理 | teacher |
| `prompt_manage` | Prompt 模板管理 | teacher |
| `grade_class_manage` | 年级班级管理 | teacher |
| `backup_manage` | 数据库备份 | teacher |
| `training_access` | 学生训练功能 | student |
| `qa_access` | 问答功能 | student |

### 3.2 年级班级模型

```
┌──────────┐
│  grades  │
│          │
│ name (UK)│──────────────┐
│ created  │              │ FK
└──────────┘              ▼
                    ┌──────────┐
                    │ classes  │
                    │          │
                    │ grade_id │──────┐
                    │ name     │      │ FK
                    │ created  │      ▼
                    └──────────┘  ┌────────────┐
                                  │ user_class  │
                                  │             │
                                  │ user_id (UK)│
                                  │ class_id    │
                                  │ joined_at   │
                                  └────────────┘
```

#### `grades` 表

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK | |
| name | VARCHAR(40) UNIQUE | 年级名称，如 "2024级" |
| created_at | TIMESTAMPTZ | |

#### `classes` 表

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK | |
| grade_id | INTEGER FK → grades.id NOT NULL | |
| name | VARCHAR(60) | 班级名称，如 "护理1班" |
| created_at | TIMESTAMPTZ | |

UNIQUE 约束: `(grade_id, name)`

#### `user_class` 表

| 列 | 类型 | 说明 |
|----|------|------|
| user_id | INTEGER PK → users.id | 一个用户只能属于一个班级 |
| class_id | INTEGER FK → classes.id NOT NULL | |
| joined_at | TIMESTAMPTZ | |

### 3.3 删除行为

| 操作 | 级联影响 |
|------|---------|
| 删除年级 | CASCADE 删除下所有班级 → user_class SET NULL |
| 删除班级 | SET NULL user_class.class_id |
| 删除用户 | CASCADE 删除 user_class 关联 |

## 四、API 设计

### 4.1 年级管理 (`/api/admin/grades`)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/api/admin/grades` | require_teacher | 年级列表 |
| POST | `/api/admin/grades` | require_teacher | 创建年级 `{name}` |
| PUT | `/api/admin/grades/{id}` | require_teacher | 编辑年级 `{name}` |
| DELETE | `/api/admin/grades/{id}` | require_teacher | 删除年级 |

### 4.2 班级管理

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/api/admin/classes` | require_teacher | 班级列表，支持 `?grade_id=` |
| POST | `/api/admin/classes` | require_teacher | 创建班级 `{grade_id, name}` |
| PUT | `/api/admin/classes/{id}` | require_teacher | 编辑班级 `{name, grade_id}` |
| DELETE | `/api/admin/classes/{id}` | require_teacher | 删除班级 |

### 4.3 现有端点增强

| 端点 | 变更 |
|------|------|
| `GET /api/admin/users` | 新增 `?class_id=` `?grade_id=` 查询参数 |
| `POST /api/admin/users/batch` | BatchUserItem 新增 `class_id` 可选字段 |
| `PUT /api/admin/users/{id}` | UserUpdateRequest 新增 `class_id` 可选字段 |
| `POST /auth/register` | RegisterRequest 新增 `class_id` 可选字段 |
| `GET /api/stats/ranking` | 新增 `?class_id=` 筛选 |
| `GET /api/stats/teacher-summary` | 新增 `?class_id=` 筛选 |
| `GET /api/stats/class-summary` | **新增** — 按班级聚合：班级人数、平均分、完成率 |

### 4.4 UserBrief 响应增强

```python
class UserBrief(BaseModel):
    # ... 现有字段 ...
    class_id: Optional[int] = None
    class_name: Optional[str] = None
    grade_name: Optional[str] = None
```

## 五、权限检查改造

### 5.1 当前

```python
def require_teacher(current_user):
    if current_user.role != "teacher":
        raise 403
```

### 5.2 改造后

```python
def require_teacher(current_user, db):
    if not current_user.has_permission("teacher_access"):
        raise 403
```

`has_permission` 方法：
```python
def has_permission(self, permission: str, db: Session = None) -> bool:
    cache = getattr(self, "_permissions_cache", None)
    if cache is None and db is not None:
        rows = db.query(RolePermission.permission).filter(
            RolePermission.role_name == self.role
        ).all()
        cache = {r.permission for r in rows}
        self._permissions_cache = cache
    return permission in (cache or set())
```

### 5.3 兼容性担保

- `User.role` 列保留，值仍是 `"teacher"` / `"student"`
- 所有旧代码中 `user.role == "teacher"` 判断继续有效（前端侧）
- `require_student` 同理改造
- 前端 `ProtectedRoute` 不变

## 六、前端设计

### 6.1 年级班级管理页 `GradesClassesPage.jsx`

**布局:** Tabs 切换 "年级管理" / "班级管理"

**年级 Tab:**
- Table: 年级名称 / 班级数量 / 学生数量 / 创建时间 / 操作(编辑/删除)
- 新建年级：inline form 或 Modal
- 删除年级：ConfirmDialog 警告 "将级联删除下所有班级，学生归属将被清除"

**班级 Tab:**
- 筛选：年级下拉选择器
- Table: 班级名称 / 所属年级 / 学生数量 / 创建时间 / 操作
- 新建班级：Modal 选所属年级 + 填班级名

### 6.2 班级筛选器 `ClassFilter.jsx`

可复用组件，输入 `(gradeId, classId, onChange)`：
- 级联两个 Select：先选年级，班级列表自动刷新
- 用于：UsersPage, History, Stats, Dashboard

### 6.3 改造点

| 页面/组件 | 变更 |
|-----------|------|
| `AppShell.jsx` | 教师导航 + "班级管理" |
| `UsersPage.jsx` | 页面级班级筛选器 + 表格 "班级" 列 |
| `UsersTab.jsx` | 新增/编辑 → 班级选择下拉；批量导入 → 支持班级字段 |
| `DashboardHome.jsx` | 教师 Dashboard 新增一个班级维度 StatCard |
| `History.jsx` | 教师端列表顶部新增班级筛选器 |
| `Stats.jsx` | 教师端新增班级排名对比视图 |
| `api.js` | 新增 `getGrades`, `createGrade`, `updateGrade`, `deleteGrade`, `getClasses`, `createClass`, `updateClass`, `deleteClass`, `getClassSummary` |

## 七、Alembic 迁移

### 迁移顺序

1. 创建 `roles` 表
2. 创建 `role_permissions` 表
3. 创建 `grades` 表
4. 创建 `classes` 表 (FK → grades)
5. 创建 `user_class` 表 (FK → users, FK → classes)
6. 增加 `users.role` 长度到 VARCHAR(20)，加 FK → roles.name
7. Seed: INSERT teacher/student 角色 + 对应权限
8. 确保现有用户 role 值兼容

### 迁移 ID

```
<timestamp>_rbac_classes_init
```

## 八、测试要点

| 测试范围 | 检查项 |
|---------|--------|
| RBAC | 创建角色、分配权限、has_permission 正确性 |
| 年级 CRUD | 创建/编辑/删除/列表，唯一性约束 |
| 班级 CRUD | 创建/编辑/删除/列表，年级筛选 |
| 用户-班级 | 分配班级、切换班级、班级筛选 |
| 统计 | 班级维度统计正确性（平均分、完成率） |
| 向后兼容 | 旧 API 行为不变，role 字段兼容 |
| 级联删除 | 删除年级→班级→user_class 正确 |

## 九、不在本期范围

- 教师归属班级（权限隔离）— 作为第二阶段
- 多机构隔离 — 作为第三阶段
- 班主任/年级组长等新角色 — 基于本次 RBAC 基础设施，后续插入角色+权限即可
- 学期管理 — 年级名已隐含学期信息，无需独立模型
