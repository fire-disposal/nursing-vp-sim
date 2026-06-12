# 全数据模型重构方案

> 版本: draft-1 | 2026-06-12

---

## 设计原则

1. **实体职责单一** — 每个表只做一件事，不混不借
2. **保持现有架构** — 不改 FastAPI/React 框架，不改部署方式
3. **可增量实施** — 每次迁移只动最少表，保持向后兼容
4. **微企业规模** — 不做分布式事务、不做事件溯源、不做 CQRS

---

## 一、核心改动：引入 Practice 实体

### 1.1 当前问题回顾

```
Case ────→ session_config.json ────→ Assignment.feature_overrides
  │              │                           │
  └─supported_plugins              三层开关叠加，运行时硬合并
```

### 1.2 新设计

```
Case (纯医学数据，不再包含任何"怎么练"的信息)
  │
  └──→ Practice (练习模板 — 一等公民)
        ├── 绑定哪个 Case
        ├── 启用哪些 Feature
        ├── 时间/轮次/行为参数
        └── 评分配置
              │
              ├──→ 学生自由练习 (选 Practice 直接开始)
              │
              └──→ Assignment (教师把 Practice 分发给班级)
                    └── 只有: Practice + Class + 时间窗口
```

### 1.3 Practice 表结构

```python
class Practice(Base):
    __tablename__ = "practices"

    id: int                          PK
    name: str(100)                   练习名称（如"情境模拟考核"）
    description: str | None          描述
    case_id: int                     FK → cases
    school_id: int | None            FK → schools (NULL=全局共享)
    mode: str(20)                    "training" | "assessment" | "free_play"
    features: dict                   JSONB  {physical_exam: true, emotion: false, ...}
    behavior: dict                   JSONB  {time_limit_minutes: 30, max_rounds: 45}
    assessment: dict | None          JSONB  {rubric_id: 1, auto_settlement: true}
    is_active: bool                  default=True
    created_at: datetime
    updated_at: datetime              ← 补全
```

**字段解释：**

| 字段 | 来源 | 说明 |
|------|------|------|
| `features` | 原 session_config JSON + Case.supported_plugins | 唯一定义功能开关的地方 |
| `behavior` | 原 session_config JSON | 时长、轮次等行为参数 |
| `assessment` | 原 session_config JSON | 评分配置（可选，没配置就不自动评分） |
| `mode` | 原 session_config JSON | 训练/考核/自由探索，影响前端展示和评分策略 |
| `school_id` | 新增 | NULL 的 Practice 全校共享（出厂自带），有值的是学校自建 |

---

## 二、Case 表简化

```python
class Case(Base):
    __tablename__ = "cases"

    id: int                          PK
    name: str(100)
    description: str | None
    case_data: dict                  JSONB (保留，但移除 supported_plugins)
    school_id: int | None            FK → schools (NULL=全局共享)
    created_at: datetime
    updated_at: datetime              ← 补全
```

**变更：**
- `case_data` JSONB 中移除 `supported_plugins` 字段
- `case_data` JSONB 中移除 `time_limit` 字段（已在 Practice.behavior 里）
- 补 `updated_at`

---

## 三、Assignment 表简化

```python
class Assignment(Base):
    __tablename__ = "assignments"

    id: uuid                         PK
    practice_id: int                 FK → practices          ← 替代 case_id + config_id
    class_id: int                    FK → classes
    teacher_id: int                  FK → users
    title: str(200)
    description: str | None
    start_time: datetime
    end_time: datetime
    created_at: datetime
    updated_at: datetime
```

**删除字段：** `case_id`、`config_id`、`feature_overrides`

---

## 四、TrainingRecord 表简化

```python
class TrainingRecord(Base):
    __tablename__ = "training_records"

    id: int                          PK
    user_id: int                     FK → users
    case_id: int                     FK → cases (冗余，方便查询)
    practice_id: int | None          FK → practices          ← 替代 config_id
    practice_snapshot: dict | None   JSONB (创建时快照整个 Practice)
    assignment_id: uuid | None       FK → assignments
    status: str(20)                  "in_progress" | "completed" | "abandoned"
    scoring_status: str | None       "pending" | "processing" | "completed" | "failed"
    scoring_error: str | None
    time_limit: int                  训练时长限制(分钟)
    current_phase: str | None        "history_taking" | "physical_exam" | "ending"
    is_overdue: bool
    start_time: datetime
    end_time: datetime | None
```

**删除字段：** `config_id`、`config_snapshot`

**新增字段：** `practice_id`、`practice_snapshot`（替代 config_snapshot，职责单一：仅快照，不给运行时当草稿纸）

**运行时状态另存：** `practice_snapshot` 不再被 `persister.py`/`plugins.py` 写入 `_phase_op_count` 等临时数据。临时状态存入内存（app.state 缓存）或单独的 `training_state` JSONB 字段。

---

## 五、Score + 拆出 ScoreReview

```python
class Score(Base):
    __tablename__ = "scores"

    id: int                          PK
    record_id: int                   FK → training_records (unique)
    total_score: float
    detail_scores: dict | None       JSONB
    strengths: list | None           JSONB
    weaknesses: list | None          JSONB
    missed_content: list | None      JSONB
    suggestions: str | None
    rubric_version: str | None
    model_name: str | None
    prompt_version: int | None
    score_scale: int | None
    created_at: datetime


class ScoreReview(Base):
    __tablename__ = "score_reviews"

    id: int                          PK
    score_id: int                    FK → scores
    reviewed_by: int | None          FK → users
    detail_scores: dict | None       JSONB (复核修改后的分项)
    comment: str | None
    created_at: datetime
```

**变更：**
- Score 表移除 `review_status`、`reviewed_by`、`reviewed_at`、`review_detail_scores`、`review_comment`
- 新增 ScoreReview 表。一次复核一条记录，多次复核多条记录，可追溯历史
- Score 的"是否有复核"通过 `SELECT EXISTS(SELECT 1 FROM score_reviews WHERE score_id=?)` 判定

---

## 六、User 表补全

```python
class User(Base):
    __tablename__ = "users"

    id: int                          PK
    username: str(50)                unique
    password_hash: str(255)
    role_id: int                     FK → roles
    school_id: int                   FK → schools
    display_name: str(50)
    student_id: str | None           (加索引)
    email: str | None                ← 新增 (用于通知/找回密码)
    gender: str | None
    avatar: str | None
    wechat_openid: str | None        unique
    is_active: bool                  ← 新增 (default=True, 禁用不删号)
    token_version: int
    last_login_at: datetime | None   ← 新增
    created_at: datetime
    updated_at: datetime              ← 补全
```

---

## 七、UserClass 放开多对多

```python
class UserClass(Base):
    __tablename__ = "user_class"

    id: int                          PK ← 改：从联合主键改为独立主键
    user_id: int                     FK → users
    class_id: int                    FK → classes
    joined_at: datetime
```

**变更：** 加独立 `id` 列，移除 `primary_key=True` 的联合主键。User 的 `user_class` relationship 改为 `uselist=True`。

---

## 八、Grade 补学年

```python
class Grade(Base):
    __tablename__ = "grades"

    id: int                          PK
    name: str(40)
    academic_year: str | None        ← 新增 (如 "2024-2025")
    school_id: int                   FK → schools
    created_at: datetime
```

---

## 九、全局补全清单

| 表 | 加 `updated_at` | 加 `deleted_at`(软删除) | 加索引 |
|----|:---:|:---:|:---:|
| users | ✓ | — | `student_id`、`school_id` |
| cases | ✓ | — | — |
| practices | ✓ | — | `case_id`、`school_id` |
| assignments | 已有 | — | — |
| training_records | — | — | `practice_id` |
| scores | — | — | — |
| score_reviews | ✓ | — | `score_id` |
| grades | — | — | — |
| classes | — | — | — |
| rubrics | — | — | — |
| messages | — | — | `role` |

软删除仅对核心业务实体（Case、Practice、Assignment）有价值，用户和训练记录不删。

---

## 十、字符串枚举约束

为以下字段加 PostgreSQL CHECK 约束：

| 表 | 列 | 允许值 |
|----|-----|--------|
| practices | mode | `training`, `assessment`, `free_play` |
| training_records | status | `in_progress`, `completed`, `abandoned` |
| training_records | scoring_status | `pending`, `processing`, `completed`, `failed` |
| training_records | current_phase | `history_taking`, `physical_exam`, `ending` |
| messages | role | `student`, `patient`, `system` |
| scores | — | 不在此次改动范围 |

---

## 十一、数据迁移路径

### Step 1: 新建表 + 补字段（无破坏性）

```
Practice        ← 新建
ScoreReview     ← 新建
users           ← 加 email, is_active, last_login_at, updated_at
cases           ← 加 updated_at
grades          ← 加 academic_year
user_class      ← 加 id PK, 改联合主键
全局索引         ← 补全
CHECK 约束       ← 补全
```

### Step 2: 数据迁移（从 JSON 文件 / 旧字段 → Practice）

```
session_config JSON 文件 → Practice 表 seed
  standard-assessment.json  →  Practice(id=1, name="标准评估", mode="assessment", ...)
  scenario-simulation.json  →  Practice(id=2, name="情境模拟", mode="training", ...)
  free-exploration.json     →  Practice(id=3, name="自由探索", mode="free_play", ...)
  classroom-practice.json   →  Practice(id=4, name="课堂练习", mode="training", ...)

Assignment.config_id → 查 Practice(name=config_id) → 填 practice_id
TrainingRecord.config_id → 同上
```

### Step 3: 废弃旧字段 + 代码切换

```
删除: Assignment.config_id, Assignment.feature_overrides
删除: TrainingRecord.config_id, TrainingRecord.config_snapshot
删除: Case.case_data 中的 supported_plugins, time_limit
新增: Assignment.practice_id, TrainingRecord.practice_id, TrainingRecord.practice_snapshot
切换所有后端引用
```

### Step 4: 清理

```
删除 admin/scenarios.py 内存 stub (被 Practice CRUD 替代)
删除 ApiProvider 废弃模型（如果安全）
删除前端 scenarios.ts 死代码
删除 useScenario.ts 死代码
```

---

## 十二、受影响代码范围

| 文件 | 改动 |
|------|------|
| `backend/models.py` | 新增 Practice/ScoreReview，修改 Case/Assignment/TrainingRecord/User/UserClass/Grade/Score |
| `backend/schemas.py` | 对应请求/响应模型调整 |
| `backend/routers/cases.py` | 移除 supported_plugins 相关逻辑 |
| `backend/routers/assignments.py` | case_id → practice_id |
| `backend/routers/admin/scenarios.py` | 删除，改为 Practice CRUD |
| `backend/contexts/training/config_loader.py` | 从 DB 加载 Practice，JSON 文件作为 seed fallback |
| `backend/contexts/training/router/session.py` | config_id → practice_id，_create_record 重写 |
| `backend/contexts/training/router/_config.py` | 重写配置端点 |
| `backend/core/feature_flags.py` | resolve_features 改为从 practice_snapshot 读取 |
| `backend/contexts/training/pipeline/middleware/persister.py` | 临时状态不写 snapshot |
| `backend/contexts/training/plugins.py` | 临时状态不写 snapshot |
| `frontend/src/api/scenarios.ts` | 删除死路由，改为 Practice API |
| `frontend/src/pages/admin/ScenarioComposer.tsx` | 重写为 Practice CRUD 页面 |
| `frontend/src/api/api-client.ts` | 重新生成 |
| `frontend/src/App.tsx` | /admin/scenarios 路由保留但页面重写 |

---

## 十三、不变的部分

以下实体本轮不动：
- School / Role / RolePermission — 已合理
- Rubric — 全局唯一激活版本够用
- LLMCallLog / ApiSecret / LLMConfig — 等有实际痛点再改
- PromptTemplate — 结构合理
- QASession / QARecord — 设计干净
- Feedback — 简洁够用
- QuestionnaireTemplate 体系 — 结构完整，等有使用量再优化
- Note / NursingRecord / Message — 无结构问题

---

## 十四、废除清单

| 废除项 | 原因 |
|--------|------|
| `backend/routers/admin/scenarios.py` | 被 Practice CRUD 替代 |
| `backend/data/session_configs/*.json` | 迁移到 Practice 表 seed |
| `frontend/src/api/scenarios.ts` | 死代码，调不存在的路由 |
| `frontend/src/hooks/useScenario.ts` | 全项目无引用 |
| `backend/models.py:ApiProvider` | 已标注 DEPRECATED |
| Case.case_data 中的 `supported_plugins` | 职责迁移到 Practice |
| Assignment 中的 `config_id`、`feature_overrides` | 职责迁移到 Practice |
| TrainingRecord 中的 `config_id`、`config_snapshot` | 职责迁移到 Practice |
