# 03 — 数据库设计

> 适用版本: current | 最后更新: 2026-08-01

数据库：PostgreSQL 15，通过 SQLAlchemy 2.0 ORM + Alembic 管理迁移。

---

## 数据库配置

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 数据库 | PostgreSQL 15 | Docker Compose 部署 |
| ORM | SQLAlchemy 2.0 | 声明式映射 (Mapped[T])，UtcDateTime 时区保护 |
| 迁移 | Alembic | `--autogenerate` 自动生成 DDL |
| 开发连接 | `postgresql://postgres:<your-password>@localhost:5432/vptest` | 可通过 DATABASE_URL 覆盖 |
| Production 连接 | `postgresql://nursing:${PASSWORD}@db:5432/nursing_vp` | docker-compose.prod.yml（单实例唯一环境） |
| pool_pre_ping | True | 连接前检测有效性 |
| pool_recycle | 3600s | 每小时回收连接 |

---

## ER 关系

> 下面第一块是**历史快照**（含已删除的 `Practice`/`Note`/`Grade`/`UserClass` 形态），仅供回溯；
> 当前模型以第二块为准。

```
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


## ER 关系

```
Role (1) ──→ (N) RolePermission
Role (1) ──→ (N) User

Class (1) ──→ (N) ClassMembership ←── (N) User     # 表名 user_class；member_role = student | teacher，UNIQUE(user_id, class_id)

Case (1) ──→ (N) CaseRevision                       # 已发布内容不可变（docs/15 §六）
CaseRevision (1) ──→ (N) Assignment ──→ (N) TrainingRecord
CaseRevision (1) ──→ (N) TrainingRecord             # 训练钉住当时版本
Assignment (1) ──→ (N) AssignmentRecipient ←── (N) User   # 发布时固化的受众快照

TrainingRecord (1) ──→ (N) Message
TrainingRecord (1) ──→ (N) TrainingAction          # 审计链（工具调用/评分/状态事件）
TrainingRecord (1) ──→ (1) Score ──→ (N) ScoreReview
TrainingRecord (1) ──→ (1) NursingRecord
TrainingRecord (1) ──→ (1) TrainingSessionState
TrainingRecord (1) ──→ (1) TrainingSessionEmotionState ──→ (N) TrainingSessionEmotionEvent
TrainingRecord (1) ──→ (N) TrainingToolRequest
TrainingRecord (1) ──→ (N) LLMCallLog

User (1) ──→ (N) LLMCallLog
User (1) ──→ (N) QASession ──→ (N) QARecord
User (1) ──→ (N) Notification

ApiSecret (1) ──→ (N) LLMConfig
LLMConfig (1) ──→ (N) LLMCallLog

QuestionnaireTemplate (1) ──→ (N) QuestionnaireQuestion
QuestionnaireTemplate (1) ──→ (N) QuestionnaireResponse ──→ (N) QuestionnaireAnswer
QuestionnaireQuestion (1) ──→ (N) QuestionnaireAnswer
Case (N) ──→ (N) QuestionnaireTemplate  (via CaseQuestionnaire)

Feedback (1) ──→ (N) FeedbackImage
VoiceConfig / VoiceCallLog / RateLimitEntry / SystemNotification：独立表
```

> ER 图中已删除的遗留概念：Practice、Note、ApiProvider、Rubric 表（评分标准迁移为 rubrics/ JSON 文件 + 加载器）。

---

## 表结构（索引）

列级定义以 `backend/models/` 与 `backend/migrations/` 为唯一来源，此处仅维护表清单，避免双源腐化。

病例**元数据只在列**（`name`/`description`/`difficulty`/`time_limit_minutes`/`status`/`current_revision_id`）；
`cases.case_data` 只存临床与模拟数据，不再重复保存元数据；训练时限的唯一口径见
`backend/core/time_limits.py`（声明即生效，越界在校验层拒绝，不做静默改写）。

作业（`assignments`）的版本与受众各只有一个 owner：`case_revision_id`（**NOT NULL**，发布时钉住，
学员永远按该版本训练与复盘）与受众快照 `assignment_recipients`（旧 `student_ids` 列已随
ddl `f5a6b7c8d9e0` 删除）。

| 表名 | 来源模型 |
|------|----------|
| `assignment_recipients` | `models/assignment.py` · AssignmentRecipient（受众快照） |
| `case_questionnaires` | `models/questionnaire.py` · CaseQuestionnaire |
| `case_revisions` | `models/case.py` · CaseRevision（不可变内容版本） |
| `classes` | `models/school.py` · Class（含 `cohort_label`） |
| `feedback_images` | `models/feedback_image.py` · FeedbackImage |
| `feedbacks` | `models/feedback.py` · Feedback |
| `llm_call_logs` | `models/llm.py` · LLMCallLog |
| `messages` | `models/training.py` · Message |
| `notifications` | `models/notification.py` · Notification |
| `nursing_records` | `models/training.py` · NursingRecord |
| `qa_records` | `models/qa.py` · QARecord |
| `qa_sessions` | `models/qa.py` · QASession |
| `questionnaire_answers` | `models/questionnaire.py` · QuestionnaireAnswer |
| `questionnaire_questions` | `models/questionnaire.py` · QuestionnaireQuestion |
| `questionnaire_responses` | `models/questionnaire.py` · QuestionnaireResponse |
| `rate_limit_entries` | `models/rate_limit.py` · RateLimitEntry |
| `role_permissions` | `models/auth.py` · RolePermission |
| `roles` | `models/auth.py` · Role |
| `score_reviews` | `models/training.py` · ScoreReview |
| `scores` | `models/training.py` · Score |
| `training_actions` | `models/training.py` · TrainingAction |
| `training_records` | `models/training.py` · TrainingRecord |
| `training_session_emotion_event` | `models/training.py` · TrainingSessionEmotionEvent |
| `training_session_emotion_state` | `models/training.py` · TrainingSessionEmotionState |
| `training_session_state` | `models/training.py` · TrainingSessionState |
| `training_tool_requests` | `models/training.py` · TrainingToolRequest |
| `user_class` | `models/school.py` · ClassMembership（多班级成员 + `member_role`） |
| `users` | `models/auth.py` · User |
| `voice_call_logs` | `models/voice.py` · VoiceCallLog |
| `voice_configs` | `models/voice.py` · VoiceConfig |

---

- 迁移命令: `cd backend && alembic revision --autogenerate -m "描述变更"`
- 迁移纪律：`ddl/` 禁 `op.execute()`；`data/` 需 `# Manual override reason: data_only`（见 AGENTS.md）
- JSONB 写入纪律：`training_records.runtime_state` 没有变更追踪（裸 `JSONB`）。
  改嵌套结构（`list.append` / `dict.update`）必须先深拷贝——浅拷贝仍共享嵌套对象，
  就地修改会同时改掉 ORM 手里的旧值，flush 判定「未修改」而整条 UPDATE 被丢弃。
  工具侧用 `modules/training/tools/base.py:copy_runtime_state`。
- `questionnaire_responses` 唯一性按触发时点分域（迁移 `c9a7e2f4b6d8`）：训练前问卷
  一个 `(user, template, case)` 一行（`record_id IS NULL` 的部分唯一索引），评分后问卷
  按训练记录逐次一行（`record_id IS NOT NULL`）。`record_id` 外键为 `CASCADE`——删训练
  记录即删其评分后作答。**该迁移的 downgrade 会先删掉评分后作答行**，否则旧的
  `(user, template, case)` 唯一约束在回滚时创建失败，`deploy/rollback.sh` 会因此中止。
