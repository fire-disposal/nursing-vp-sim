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
| Staging 连接 | `postgresql://nursing:${PASSWORD}@db:5432/nursing_vp` | docker-compose.staging.yml |
| Production 连接 | `postgresql://nursing:${PASSWORD}@db:5432/nursing_vp` | docker-compose.prod.yml |
| pool_pre_ping | True | 连接前检测有效性 |
| pool_recycle | 3600s | 每小时回收连接 |

---

## ER 关系

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

Grade (1) ──→ (N) Class ──→ (N) UserClass ←── (N) User

Case (1) ──→ (N) Assignment ──→ (N) TrainingRecord

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

| 表名 | 来源模型 |
|------|----------|
| `case_questionnaires` | `models/questionnaire.py` · CaseQuestionnaire |
| `classes` | `models/school.py` · Class |
| `feedback_images` | `models/feedback_image.py` · FeedbackImage |
| `feedbacks` | `models/feedback.py` · Feedback |
| `grades` | `models/school.py` · Grade |
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
| `user_class` | `models/school.py` · UserClass |
| `users` | `models/auth.py` · User |
| `voice_call_logs` | `models/voice.py` · VoiceCallLog |
| `voice_configs` | `models/voice.py` · VoiceConfig |

---

- 迁移命令: `cd backend && alembic revision --autogenerate -m "描述变更"`
- 迁移纪律：`ddl/` 禁 `op.execute()`；`data/` 需 `# Manual override reason: data_only`（见 AGENTS.md）
