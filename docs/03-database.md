# 03 — 数据库设计

> 适用版本: v2026.06.12 | 最后更新: 2026-06-12

数据库：PostgreSQL 15，通过 SQLAlchemy 2.0 ORM + Alembic 管理迁移。

---

## 数据库配置

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 数据库 | PostgreSQL 15 | Docker Compose 部署 |
| ORM | SQLAlchemy 2.0 | 声明式映射 (Mapped[T])，UtcDateTime 时区保护 |
| 迁移 | Alembic | `--autogenerate` 自动生成 DDL |
| 开发连接 | `postgresql://postgres:postgres@localhost:5432/vptest` | 可通过 DATABASE_URL 覆盖 |
| Staging 连接 | `postgresql://nursing:${PASSWORD}@db:5432/nursing_vp` | docker-compose.staging.yml |
| Production 连接 | `postgresql://nursing:${PASSWORD}@db:5432/nursing_vp` | docker-compose.prod.yml |
| pool_pre_ping | True | 连接前检测有效性 |
| pool_recycle | 3600s | 每小时回收连接 |

---

## ER 关系

```
School (1) ──→ (N) User
School (1) ──→ (N) Grade
School (1) ──→ (N) Case
School (1) ──→ (N) Practice

Role (1) ──→ (N) RolePermission
Role (1) ──→ (N) User

Grade (1) ──→ (N) Class ──→ (N) UserClass ←── (N) User

Case (1) ──→ (N) Practice ──→ (N) Assignment ──→ (N) TrainingRecord
Practice (1) ──→ (N) TrainingRecord

TrainingRecord (1) ──→ (N) Message
TrainingRecord (1) ──→ (1) Score ──→ (N) ScoreReview
TrainingRecord (1) ──→ (N) Note
TrainingRecord (1) ──→ (1) NursingRecord
TrainingRecord (1) ──→ (N) LLMCallLog

User (1) ──→ (N) LLMCallLog
User (1) ──→ (N) QASession ──→ (N) QARecord

ApiSecret (1) ──→ (N) LLMConfig
LLMConfig (1) ──→ (N) LLMCallLog

QuestionnaireTemplate (1) ──→ (N) QuestionnaireQuestion
QuestionnaireTemplate (1) ──→ (N) QuestionnaireResponse ──→ (N) QuestionnaireAnswer
QuestionnaireQuestion (1) ──→ (N) QuestionnaireAnswer

Case (N) ──→ (N) QuestionnaireTemplate  (via CaseQuestionnaire)

[# DEPRECATED] ApiProvider (独立，将被删除)
```

---

## 表结构

### schools — 学校表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 学校ID |
| name | VARCHAR(80) | UNIQUE | 学校名称 |
| created_at | DATETIME (UTC) | DEFAULT NOW | 创建时间 |

### roles — 角色表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 角色ID |
| name | VARCHAR(20) | NOT NULL | 角色标识 (如 student, teacher, admin) |
| display_name | VARCHAR(40) | NOT NULL | 显示名称 |
| school_id | INTEGER | FK→schools.id, NULLABLE | 所属学校 (NULL=系统角色) |
| is_system | BOOLEAN | DEFAULT FALSE | 是否系统预置角色 |

唯一约束: `(school_id, name)`

### role_permissions — 角色权限表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | |
| role_id | INTEGER | FK→roles.id, CASCADE | 角色ID |
| permission | VARCHAR(40) | NOT NULL | 权限标识 |

唯一约束: `(role_id, permission)` — 每个角色的权限不重复

### users — 用户表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 用户ID |
| username | VARCHAR(50) | UNIQUE, INDEX, NOT NULL | 登录账号 |
| password_hash | VARCHAR(255) | NOT NULL | bcrypt哈希密码 |
| role_id | INTEGER | FK→roles.id, RESTRICT | 角色ID |
| school_id | INTEGER | FK→schools.id, RESTRICT | 学校ID |
| display_name | VARCHAR(50) | NOT NULL | 显示姓名 |
| student_id | VARCHAR(30) | INDEX, NULLABLE | 学号 |
| email | VARCHAR(120) | NULLABLE | 邮箱 |
| gender | VARCHAR(4) | NULLABLE | 性别 |
| avatar | VARCHAR(255) | NULLABLE | 头像URL |
| wechat_openid | VARCHAR(64) | UNIQUE, INDEX, NULLABLE | 微信OpenID |
| is_active | BOOLEAN | DEFAULT TRUE | 是否激活 |
| token_version | INTEGER | DEFAULT 1 | Token版本 (递增可强制全量下线) |
| last_login_at | DATETIME (UTC) | NULLABLE | 最后登录时间 |
| created_at | DATETIME (UTC) | DEFAULT NOW | 创建时间 |
| updated_at | DATETIME (UTC) | DEFAULT NOW, ON UPDATE | 更新时间 |

索引: `ix_users_school_id`, `ix_users_student_id`

### grades — 年级表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 年级ID |
| name | VARCHAR(40) | NOT NULL | 年级名称 |
| academic_year | VARCHAR(9) | NULLABLE | 学年 (如 "2025-2026") |
| school_id | INTEGER | FK→schools.id, CASCADE | 学校ID |
| created_at | DATETIME (UTC) | DEFAULT NOW | 创建时间 |

唯一约束: `(school_id, name)` — 同一学校年级名唯一
关联: `classes` (一对多)

### classes — 班级表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 班级ID |
| grade_id | INTEGER | FK→grades.id, CASCADE | 年级ID |
| name | VARCHAR(60) | NOT NULL | 班级名称 |
| created_at | DATETIME (UTC) | DEFAULT NOW | 创建时间 |

唯一约束: `(grade_id, name)`
索引: `ix_classes_grade_id`
关联: `user_classes` (一对多)

### user_class — 用户-班级关联表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | |
| user_id | INTEGER | FK→users.id, CASCADE | 用户ID |
| class_id | INTEGER | FK→classes.id, SET NULL, NULLABLE | 班级ID |
| joined_at | DATETIME (UTC) | DEFAULT NOW | 加入时间 |

索引: `ix_user_class_class_id`

### cases — 病例表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 病例ID |
| name | VARCHAR(100) | NOT NULL | 病例名称 |
| description | TEXT | NULLABLE | 病例简介 |
| case_data | JSONB | NOT NULL | 完整病例数据（患者信息/病史/难度/时限等） |
| school_id | INTEGER | FK→schools.id, SET NULL, NULLABLE | 所属学校 |
| created_at | DATETIME (UTC) | DEFAULT NOW | |
| updated_at | DATETIME (UTC) | DEFAULT NOW, ON UPDATE | |

关联: `practices` (一对多), `school`

### practices — 练习表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 练习ID |
| name | VARCHAR(100) | NOT NULL | 练习名称 |
| description | TEXT | NULLABLE | 练习说明 |
| case_id | INTEGER | FK→cases.id, RESTRICT | 所属病例 |
| school_id | INTEGER | FK→schools.id, SET NULL, NULLABLE | 所属学校 |
| mode | VARCHAR(20) | DEFAULT "training" | 练习模式: training / assessment / free_play |
| features | JSONB | DEFAULT {} | 功能开关配置 (如启用体检、护理记录等) |
| behavior | JSONB | DEFAULT {} | 行为配置 (时限、患者行为等) |
| assessment | JSONB | NULLABLE | 考核配置 (评分标准、通过线等) |
| is_active | BOOLEAN | DEFAULT TRUE | 是否启用 |
| created_at | DATETIME (UTC) | DEFAULT NOW | |
| updated_at | DATETIME (UTC) | DEFAULT NOW, ON UPDATE | |

CheckConstraint: `mode IN ('training', 'assessment', 'free_play')`
索引: `ix_practices_case_id`, `ix_practices_school_id`
关联: `case`, `school`, `assignments`, `training_records`

### assignments — 作业表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | VARCHAR(36) | PK, UUID | 作业ID (UUID字符串) |
| practice_id | INTEGER | FK→practices.id, RESTRICT | 练习ID |
| class_id | INTEGER | FK→classes.id, RESTRICT | 班级ID |
| teacher_id | INTEGER | FK→users.id, RESTRICT | 教师ID |
| title | VARCHAR(200) | NOT NULL | 作业标题 |
| description | TEXT | NULLABLE | 作业说明 |
| start_time | DATETIME (UTC) | NOT NULL | 开始时间 |
| end_time | DATETIME (UTC) | NOT NULL | 截止时间 |
| created_at | DATETIME (UTC) | DEFAULT NOW | |
| updated_at | DATETIME (UTC) | DEFAULT NOW, ON UPDATE | |

索引: `ix_assignments_teacher`, `ix_assignments_class`, `ix_assignments_practice`
关联: `practice`, `class_`, `teacher`, `training_records`

### training_records — 训练记录表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 记录ID |
| user_id | INTEGER | FK→users.id | 学生ID |
| case_id | INTEGER | FK→cases.id | 病例ID |
| practice_id | INTEGER | FK→practices.id, NULLABLE | 练习ID |
| practice_snapshot | JSONB | NULLABLE | 练习配置快照（记录开始时的配置） |
| status | VARCHAR(20) | DEFAULT "in_progress" | in_progress / completed / abandoned |
| scoring_status | VARCHAR(20) | NULLABLE | pending / processing / completed / failed |
| scoring_error | TEXT | NULLABLE | 评分失败原因 |
| time_limit | INTEGER | DEFAULT 20 | 时间限制（分钟） |
| current_phase | VARCHAR(50) | NULLABLE | 当前阶段: history_taking / physical_exam / ending |
| assignment_id | VARCHAR(36) | FK→assignments.id, SET NULL, NULLABLE | 关联作业 |
| is_overdue | BOOLEAN | DEFAULT FALSE | 是否超时 |
| start_time | DATETIME (UTC) | DEFAULT NOW | 开始时间 |
| end_time | DATETIME (UTC) | NULLABLE | 结束时间 |

CheckConstraint:
- `status IN ('in_progress', 'completed', 'abandoned')`
- `scoring_status IN ('pending', 'processing', 'completed', 'failed')`
- `current_phase IN ('history_taking', 'physical_exam', 'ending')`

索引: `ix_tr_user_status`, `ix_tr_status`, `ix_tr_start_time`, `ix_tr_case_id`, `ix_tr_practice_id`
关联: `user`, `case`, `practice`, `assignment`, `messages`, `score`

### messages — 对话消息表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 消息ID |
| record_id | INTEGER | FK→training_records.id | 所属训练 |
| role | VARCHAR(10) | NOT NULL | student / patient / system |
| content | TEXT | NOT NULL | 消息内容 |
| created_at | DATETIME (UTC) | DEFAULT NOW | 时间戳 |

CheckConstraint: `role IN ('student', 'patient', 'system')`
复合索引: `ix_msg_record_created (record_id, created_at)` — 对话加载热路径
索引: `ix_msg_role`

### scores — 评分表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 评分ID |
| record_id | INTEGER | FK→training_records.id, UNIQUE | 所属训练（一对一） |
| total_score | FLOAT | NOT NULL | 总分 (100分制) |
| detail_scores | JSONB | NULLABLE | 分项得分（含逐项评分 + evidence/reason） |
| strengths | JSONB | NULLABLE | 优点列表 |
| weaknesses | JSONB | NULLABLE | 不足列表 |
| missed_content | JSONB | NULLABLE | 漏问内容列表 |
| suggestions | TEXT | NULLABLE | 改进建议文本 |
| rubric_version | VARCHAR(40) | NULLABLE | 评分标准版本 |
| model_name | VARCHAR(80) | NULLABLE | 评分所用模型 |
| prompt_version | INTEGER | DEFAULT 1 | Prompt 模板版本号 |
| score_scale | INTEGER | DEFAULT 100 | 评分制 (100 = 百分制) |
| created_at | DATETIME (UTC) | DEFAULT NOW | |

关联: `record`, `reviews` (一对多 → ScoreReview)

> 教师复核字段 (review_status, reviewed_by, reviewed_at, review_detail_scores, review_comment) 已移至独立的 `score_reviews` 表。

detail_scores 结构（100分制）：

```json
{
  "沟通技能": {
    "score": 65,
    "max": 74,
    "items": [
      {"id": "comm_01", "name": "学生与病人打招呼并问候", "score": 3, "evidence": "对话中的具体证据", "reason": "评分理由"},
      {"id": "comm_02", "name": "学生询问病人的姓名和个人信息", "score": 2, "evidence": "...", "reason": "..."}
    ]
  },
  "病史采集": {
    "score": 21,
    "max": 26,
    "items": [...]
  }
}
```

### score_reviews — 评分复核表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 复核ID |
| score_id | INTEGER | FK→scores.id, CASCADE | 评分ID |
| reviewed_by | INTEGER | FK→users.id, SET NULL, NULLABLE | 复核人 |
| detail_scores | JSONB | NULLABLE | 复核后的分项得分 |
| comment | TEXT | NULLABLE | 复核备注 |
| created_at | DATETIME (UTC) | DEFAULT NOW | 复核时间 |

索引: `ix_score_reviews_score_id`
关联: `score`, `reviewer`

> 支持多次复核：同一 Score 可有多条 ScoreReview 记录，按 created_at 排序。

### notes — 笔记表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 笔记ID |
| record_id | INTEGER | FK→training_records.id | 所属训练 |
| user_id | INTEGER | FK→users.id | 作者 |
| content | TEXT | NOT NULL | 笔记内容 |
| created_at | DATETIME (UTC) | DEFAULT NOW | |
| updated_at | DATETIME (UTC) | DEFAULT NOW, ON UPDATE | |

索引: `ix_notes_record_id`

> 后端保留，前端已移除。可后续恢复或清理。

### nursing_records — 护理记录表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | |
| record_id | INTEGER | FK→training_records.id, CASCADE, UNIQUE | 训练记录ID (一对一) |
| user_id | INTEGER | FK→users.id, CASCADE | 填写用户 |
| sheet_data | JSONB | DEFAULT {} | 结构化护理记录单数据 |
| status | VARCHAR(20) | DEFAULT "draft" | 状态: draft / submitted |
| created_at | DATETIME (UTC) | DEFAULT NOW | |
| updated_at | DATETIME (UTC) | DEFAULT NOW, ON UPDATE | |

索引: `ix_nr_record_id`
关联: `record`, `user`

### rubrics — 评分标准表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | |
| name | VARCHAR(80) | UNIQUE | 评分标准名称 |
| version | VARCHAR(40) | NOT NULL | 版本号 |
| description | TEXT | NULLABLE | 说明 |
| total_max | INTEGER | DEFAULT 100 | 显示总分上限 (100分制) |
| raw_max | INTEGER | DEFAULT 57 | 原始总分上限 (57分制) |
| raw_scale | INTEGER | DEFAULT 3 | 原始分每项满分 (3分制) |
| dimensions | JSONB | NOT NULL | 评分维度定义 (含条目、锚点、示例) |
| is_active | BOOLEAN | DEFAULT FALSE | 是否激活 |
| created_at | DATETIME (UTC) | DEFAULT NOW | |
| updated_at | DATETIME (UTC) | DEFAULT NOW, ON UPDATE | |

### llm_call_logs — LLM调用审计日志表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 日志ID |
| user_id | INTEGER | FK→users.id, NULLABLE, INDEX | 触发调用的用户 |
| record_id | INTEGER | FK→training_records.id, NULLABLE, INDEX | 关联训练记录 |
| case_id | INTEGER | FK→cases.id, NULLABLE, INDEX | 关联病例 |
| purpose | VARCHAR(40) | INDEX, NOT NULL | 调用目的 (chat / scoring / qa 等) |
| provider_name | VARCHAR(40) | DEFAULT "deepseek" | LLM Provider名称 |
| api_key_id | INTEGER | NULLABLE | 使用的 API Key ID |
| config_id | INTEGER | FK→llm_configs.id, NULLABLE, INDEX | LLM配置ID |
| model | VARCHAR(80) | NOT NULL | 模型名 |
| temperature | FLOAT | NULLABLE | 温度参数 |
| max_tokens | INTEGER | NULLABLE | 最大 token 数 |
| prompt_tokens | INTEGER | NULLABLE | 实际 Prompt tokens |
| completion_tokens | INTEGER | NULLABLE | 实际 Completion tokens |
| total_tokens | INTEGER | NULLABLE | 实际总 tokens |
| token_estimated | INTEGER | DEFAULT 1 | 是否估算 (1=估算, 0=API返回) |
| estimated_cost | FLOAT | NULLABLE | 估算费用 |
| cost_currency | VARCHAR(10) | DEFAULT "CNY" | 费用币种 |
| latency_ms | INTEGER | INDEX, NULLABLE | 调用延迟(毫秒) |
| status | VARCHAR(20) | INDEX, NOT NULL | success / error |
| error_type | VARCHAR(80) | INDEX, NULLABLE | 错误类型 |
| error_message | TEXT | NULLABLE | 错误信息 |
| request_chars | INTEGER | NULLABLE | 请求字符数 |
| response_chars | INTEGER | NULLABLE | 响应字符数 |
| request_text | TEXT | NULLABLE | 完整请求文本 |
| response_text | TEXT | NULLABLE | 完整响应文本 |
| meta | JSONB | NULLABLE | 附加元数据 |
| created_at | DATETIME (UTC) | INDEX, DEFAULT NOW | |

关联: `config` (→ LLMConfig)

### qa_sessions — 问答会话表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 会话ID |
| user_id | INTEGER | FK→users.id | 用户ID |
| title | VARCHAR(80) | NOT NULL | 会话标题 |
| created_at | DATETIME (UTC) | DEFAULT NOW | |
| updated_at | DATETIME (UTC) | DEFAULT NOW, ON UPDATE | |

索引: `ix_qa_sessions_user_updated (user_id, updated_at)`
关联: `user`, `records` (一对多 → QARecord)

### qa_records — 问答消息记录表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 记录ID |
| session_id | INTEGER | FK→qa_sessions.id, INDEX | 所属会话 |
| user_id | INTEGER | FK→users.id, INDEX | 用户ID |
| role | VARCHAR(20) | NOT NULL | 角色 |
| content | TEXT | NOT NULL | 消息内容 |
| created_at | DATETIME (UTC) | INDEX, DEFAULT NOW | |

索引: `ix_qa_session_created (session_id, created_at)`
关联: `user`, `session`

### api_secrets — API密钥加密存储表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | Secret ID |
| label | VARCHAR(80) | NOT NULL | 标签名 (如 "DeepSeek 办公") |
| encrypted_key | TEXT | NOT NULL | Fernet 加密的 API Key |
| key_suffix | VARCHAR(8) | NOT NULL | Key 后4位 (用于识别) |
| base_url | VARCHAR(200) | DEFAULT "" | API 基础地址 |
| status | VARCHAR(20) | DEFAULT "active" | active / degraded / disabled |
| degraded_reason | VARCHAR(40) | NULLABLE | 降级原因 (over_limit, circuit_open 等) |
| degraded_until | DATETIME (UTC) | NULLABLE | 降级恢复时间 |
| price_input_per_1m | NUMERIC(10,6) | DEFAULT 0 | 输入价格 ($/1M tokens) |
| price_output_per_1m | NUMERIC(10,6) | DEFAULT 0 | 输出价格 ($/1M tokens) |
| monthly_cost_limit | NUMERIC(12,6) | NULLABLE | 月费用上限 |
| call_count_today | INTEGER | DEFAULT 0 | 今日调用次数 |
| total_tokens_today | BIGINT | DEFAULT 0 | 今日总 tokens |
| total_cost_today | NUMERIC(12,6) | DEFAULT 0 | 今日总费用 |
| monthly_cost_used | NUMERIC(12,6) | DEFAULT 0 | 本月已用费用 |
| stats_date | DATETIME (UTC) | NULLABLE | 统计日期 |
| stats_month | VARCHAR(7) | NULLABLE | 统计月份 (如 "2026-06") |
| consecutive_failures | INTEGER | DEFAULT 0 | 连续失败计数 |
| last_used_at | DATETIME (UTC) | NULLABLE | 最后使用时间 |
| created_at | DATETIME (UTC) | DEFAULT NOW | |
| updated_at | DATETIME (UTC) | DEFAULT NOW, ON UPDATE | |

唯一约束: `(encrypted_key, key_suffix)`
关联: `configs` (一对多 → LLMConfig)

### llm_configs — LLM模型配置表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 配置ID |
| secret_id | INTEGER | FK→api_secrets.id | 所属 Secret |
| label | VARCHAR(80) | DEFAULT "" | 配置标签 |
| model | VARCHAR(80) | NOT NULL | 模型名 |
| purpose | VARCHAR(40) | NOT NULL | 用途 (chat / scoring / qa / guard 等) |
| priority | INTEGER | DEFAULT 10 | 路由优先级 (越大越优先) |
| weight | INTEGER | DEFAULT 10 | 路由权重 |
| status | VARCHAR(20) | DEFAULT "active" | active / disabled |
| price_input_per_1m | NUMERIC(10,6) | DEFAULT 0 | 输入价格 (覆盖 Secret 级别) |
| price_output_per_1m | NUMERIC(10,6) | DEFAULT 0 | 输出价格 |
| monthly_cost_limit | NUMERIC(12,6) | NULLABLE | 月费用上限 |
| created_at | DATETIME (UTC) | DEFAULT NOW | |
| updated_at | DATETIME (UTC) | DEFAULT NOW, ON UPDATE | |

唯一约束: `(secret_id, purpose)` — 每个 Secret 同一用途只有一个激活配置
关联: `secret`

### prompt_templates — Prompt 模板表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 模板ID |
| purpose | VARCHAR(40) | INDEX | 用途 (chat / scoring / qa / guard) |
| version | INTEGER | DEFAULT 1 | 版本号 |
| name | VARCHAR(80) | NULLABLE | 模板名称 |
| system_prompt | TEXT | NOT NULL | 系统Prompt内容 |
| user_prompt | TEXT | NULLABLE | 用户Prompt内容 |
| template_engine | VARCHAR(20) | DEFAULT "format" | 模板引擎 (format / jinja2) |
| variables | JSONB | NULLABLE | 变量列表 |
| is_active | BOOLEAN | DEFAULT FALSE | 是否当前激活版本 |
| created_by | VARCHAR(80) | NULLABLE | 创建者 |
| remark | TEXT | NULLABLE | 备注 |
| created_at | DATETIME (UTC) | DEFAULT NOW | |
| updated_at | DATETIME (UTC) | DEFAULT NOW, ON UPDATE | |

### questionnaire_templates — 问卷模板表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 模板ID |
| school_id | INTEGER | FK→schools.id, SET NULL, NULLABLE, INDEX | 学校ID |
| title | VARCHAR(120) | NOT NULL | 问卷标题 |
| type | VARCHAR(20) | NOT NULL | 问卷类型 |
| description | TEXT | NULLABLE | 问卷说明 |
| is_active | BOOLEAN | DEFAULT TRUE | 是否启用 |
| created_at | DATETIME (UTC) | DEFAULT NOW | |
| updated_at | DATETIME (UTC) | DEFAULT NOW, ON UPDATE | |

关联: `questions`, `school`

### questionnaire_questions — 问卷题目表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 题目ID |
| template_id | INTEGER | FK→questionnaire_templates.id, CASCADE, INDEX | 模板ID |
| sort_order | INTEGER | DEFAULT 0 | 排序 |
| content | TEXT | NOT NULL | 题目内容 |
| question_type | VARCHAR(20) | NOT NULL | 题目类型 |
| required | BOOLEAN | DEFAULT TRUE | 是否必答 |
| options | JSONB | NULLABLE | 选项列表 (选择题) |

关联: `template`, `answers`

### questionnaire_responses — 问卷作答记录表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 作答ID |
| template_id | INTEGER | FK→questionnaire_templates.id, CASCADE | 模板ID |
| user_id | INTEGER | FK→users.id, CASCADE | 作答用户 |
| case_id | INTEGER | FK→cases.id, SET NULL, NULLABLE | 关联病例 |
| record_id | INTEGER | FK→training_records.id, SET NULL, NULLABLE | 关联训练记录 |
| status | VARCHAR(20) | DEFAULT "pending" | pending / completed |
| completed_at | DATETIME (UTC) | NULLABLE | 完成时间 |
| created_at | DATETIME (UTC) | DEFAULT NOW | |

索引: `ix_qr_user_template (user_id, template_id)`, `ix_qr_record_id`
关联: `template`, `user`, `case`, `record`, `answers`

### questionnaire_answers — 问卷答案表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 答案ID |
| response_id | INTEGER | FK→questionnaire_responses.id, CASCADE, INDEX | 作答ID |
| question_id | INTEGER | FK→questionnaire_questions.id, CASCADE | 题目ID |
| answer_value | TEXT | NULLABLE | 答案值 |

唯一约束: `(response_id, question_id)` — 同一作答中每道题只有一个答案
关联: `response`, `question`

### case_questionnaires — 病例-问卷关联表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | |
| case_id | INTEGER | FK→cases.id, CASCADE | 病例ID |
| template_id | INTEGER | FK→questionnaire_templates.id, CASCADE | 问卷模板ID |
| is_required | BOOLEAN | DEFAULT TRUE | 是否必填 |
| trigger_event | VARCHAR(30) | DEFAULT "before_training" | 触发时机 |

唯一约束: `(case_id, template_id)` — 同一病例不与同一问卷重复关联
关联: `case`, `template`

### feedbacks — 用户反馈表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | |
| user_id | INTEGER | FK→users.id | 用户ID |
| rating | INTEGER | NOT NULL | 评分 |
| tag | VARCHAR(20) | NOT NULL | 反馈标签 |
| content | TEXT | NULLABLE | 反馈内容 |
| created_at | DATETIME (UTC) | DEFAULT NOW | |

索引: `ix_feedback_user_id`, `ix_feedback_tag`, `ix_feedback_created_at`
关联: `user`
> **DEPRECATED**: `api_providers` 表已被 `api_secrets` + `llm_configs` 替代，保留仅用于迁移兼容。

## 种子数据

| 步骤 | 操作 | 数据源 |
|------|------|--------|
| Alembic | `alembic upgrade head` | 迁移版本文件 |
| School | 创建默认学校 | 硬编码 |
| Role | 创建 admin/teacher/student | 硬编码 |
| User | 默认管理员 + 测试学生 | 空表时创建 |
| Grade/Class | 默认年级班级 | 硬编码 |
| Case | Upsert | `data/cases/*.json` |
| Rubric | 加载评分标准 | `data/rubrics/*.json` |
| ApiSecret | 创建默认 Secret | `.env` → `DEEPSEEK_API_KEY` |

## 数据迁移规范

- DDL 使用 `--autogenerate`；数据迁移必须分离并标注 `# Manual override reason: data_only`
- Husky pre-commit hook（`check-migration-autogen.js`）自动校验以上规则
- 迁移命令: `cd backend && alembic revision --autogenerate -m "描述变更"`
