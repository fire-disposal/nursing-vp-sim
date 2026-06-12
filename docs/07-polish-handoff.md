# 07 — 交接记录

> 适用版本: v2026.06.12 | 最后更新: 2026-06-12

本文档用于记录当前版本状态，作为下次继续开发时的快速上下文。

---

## 当前版本概要

**v2026.06.12** — 数据模型全面升级 (Practice/ScoreReview) + 训练引擎插件化 + 迁移安全体系 + 前端 API 层重构。

系统已进入稳定化阶段：核心业务模型完成重设计，训练页完成引擎化架构改造，前后端分离的 API 层已组织为按领域的文件结构。当前重点是数据迁移的完整性和生产部署准备。

---

## 最新改动 (最近 10 次提交)

### 数据模型升级 (Practice/ScoreReview)
- `791ab4a` **db: add Practice, ScoreReview, simplify Assignment/TrainingRecord, enrich User/UserClass**
  新增 Practice (练习) 和 ScoreReview (评分复核) 模型；简化 Assignment 为发布实体、TrainingRecord 为执行实体；User 增加 school/role 关联，UserClass 增加 active 标记
- `45f0743` **db: DDL migration for Practice/ScoreReview, data migration for seed and legacy data conversion**
  自动生成的 DDL 迁移 + 独立数据迁移，完成种子数据和旧数据转换
- `ae69299` **refactor: adapt all backend routers and contexts to new Practice/ScoreReview models**
  所有后端路由器和上下文适配新模型，包括 training、assignment、scoring、settlement 等
- `4c46690` **test: update assignment and pipeline tests for new models**
  更新测试以覆盖新的 Practice/ScoreReview 模型和结算流水线

### 前端实践选择流 + API 重生
- `2e6314e` **feat: practice selection flow, sidebar UX, patient avatar, API regen**
  前端新增 PracticeSelectModal 练习选择弹窗；侧边栏 UX 优化；患者头像支持；API 类型重新生成

### 迁移安全体系
- `ee8a4bf` **fix: data migration roundtrip — path, JSONB cast, user_class downgrade + pre-push gate**
  修复数据迁移双向回滚问题 (path 修正、JSONB 类型转换、user_class 降级)；新增 pre-push hook 检查迁移合规性
- `8b0d766` **fix: migration path parents[3]→parents[2], seed query uses ORDER BY id**
  修复迁移文件路径计算和种子查询排序
- `9c1a606` **fix: setval COALESCE fallback 0→1 to avoid out-of-bounds on empty table**
  修复序列值设置对空表的边界情况

### 工作流清理 + 格式化
- `784caa0` **fix: migration — move scores column drop to data migration, delete auto-diagnose workflow**
  将 DDL 操作从 autogenerate 迁移正确移至数据迁移，删除不再使用的 auto-diagnose workflow
- `a298c2a` **style: biome format all frontend files**
  全量 Biome 格式化，统一前端代码风格

### 此前重要改动 (已在之前版本合并)

| 改动 | 说明 |
|------|------|
| 评分并行化 | `asyncio.gather` 两阶段并行评分，~50% 提速 |
| 评分超时统一 | `SCORING_TIMEOUT_SECONDS` 常量 (300s) 统一管理 |
| 训练 UX 改善 | 确认弹窗/计时重构/暂停特性/自动结束缓冲 |
| 插件体系重构 | 2D 情绪模型 + 提示词工程优化 + 插件生命周期管理 |

---

## 压缩上下文摘要

虚拟患者训练系统。FastAPI + PostgreSQL 15 + React 19 + Vite 8。Docker Compose 部署。

**当前架构状态:**

**后端数据模型 (PostgreSQL):**
- `users` + `students` + `teachers` — 用户 (含 school_id, role_id)
- `schools` / `roles` / `permissions` / `role_permissions` — 多学校 + RBAC
- `grades` / `classes` / `user_classes` — 年级班级管理
- `cases` — 病例 (JSON case_data)
- `practices` — 练习 (关联 case，定义训练参数)
- `assignments` — 作业发布 (多对多关联 classes/students)
- `training_records` — 训练执行记录 (关联 practice/assignment/student)
- `messages` — 对话消息
- `scores` — 评分结果
- `score_reviews` — 评分复核 (教师审阅)
- `nursing_records` — 护理记录 (结构化表单)
- `api_providers` / `api_keys` — 多 LLM Provider 管理
- `prompt_templates` — Prompt 模板 (版本化)
- `qa_records` — 问答历史
- `questionnaires` / `questionnaire_attempts` — 问卷系统
- `feedbacks` — 用户反馈

**后端路由 (按上下文组织):**
- `auth.py`, `users.py`, `admin.py`, `admin_api.py`, `admin_prompts.py`
- `training.py` (核心训练流程), `chat.py` (SSE 流式对话)
- `cases.py`, `assignments.py`, `rubrics.py`, `questionnaires.py`
- `qa.py`, `stats.py`, `feedback.py`, `export.py`, `nursing_records.py`
- 上下文模块: `contexts/training/` (TrainingContext, Pipeline 等)

**前端架构:**
- **引擎系统**: TrainingEngine + MessageBus + PluginRegistry + StreamManager + ScoreManager + TTS
- **插件 (9 个)**: emotion, initiative, inquiry, nursing-record, patient-info, physical-exam, portrait, questionnaire, scoring-display
- **API 层**: 按领域拆分 18 文件 + admin/ 子目录
- **Hooks (6 个)**: useNetworkStatus, useQuestionnaire, useScorePolling, useScoreProgress, useTrainingTimer, useVoice
- **Stores (3 个)**: authStore, gradesClassesStore, schoolStore
- **路由**: 26 条路由，包括 12 个 admin 子页

**LLM 服务**: 多 Provider 优先级加权路由 (熔断+健康检查) + 流式 SSE + 评分并行化 (asyncio.gather) + API Keys Fernet 加密 + Prompt 模板版本化

**基础设施**: PostgreSQL 15 + SQLAlchemy 2.0 + Alembic 迁移 (autogenerate + 数据分离) + Docker Compose (DB+Backend+Frontend+Nginx) + CI/CD (GitHub Actions → GHCR → VPS) + 速率限制 + 审计日志 + /health

**迁移安全**: pre-push hook (`check-migration-autogen.js`) 强制 DDL 使用 `--autogenerate`，禁止 autogenerate 文件中含 `op.execute()`，数据迁移必须标注 `# Manual override reason: data_only`

**部署**: staging (test.205716.xyz, tag push 触发) + production (iomt.205716.xyz, 手动 dispatch) + maintenance mode + emergency rollback

**关键文件定位**: 前端 `App.tsx` → 路由 + Providers; `engine/` → 训练引擎; `plugins/` → 插件系统; `api/` → API 客户端; 后端 `main.py` → 应用入口; `contexts/training/` → 核心业务逻辑; `models.py` → ORM; `schemas.py` → Pydantic。启动看 [00-参与开发快速指南](00-dev-onboarding.md)。

---

## 待完善问题

### 数据迁移验证
| # | 问题 | 状态 |
|---|------|------|
| 1 | staging 数据库迁移 upgrade/downgrade 完整循环验证 | 待测试 |
| 2 | 旧练习数据迁移到新 Practice 模型的完整性 | 待验证 |
| 3 | ScoreReview 从旧 scores 表迁移数据 | 待验证 |

### 前端完善
| # | 问题 | 状态 |
|---|------|------|
| 4 | PracticesPage 练习管理功能是否完整 | 待确认 |
| 5 | 问卷系统 (QuestionnaireModal + MyResponses + AdminQuestionnaires) 端到端测试 | 待测试 |
| 6 | 插件生命周期 (init/destroy) 内存泄漏排查 | 待测试 |

### 训练引擎
| # | 问题 | 状态 |
|---|------|------|
| 7 | StreamManager SSE 断流重连 | 待验证 |
| 8 | ScoreManager 评分超时后自动重试策略 | 待确认 |
| 9 | 暂停功能与计时器同步 (服务端状态) | 待确认 |

### 生产部署准备
| # | 问题 | 状态 |
|---|------|------|
| 10 | 生产环境数据库迁移执行 | 待执行 |
| 11 | nginx 配置更新 (新 admin 路由) | 待检查 |
| 12 | 环境变量同步 (staging vs production) | 待对比 |

---

## 下一步建议

1. **迁移验证**: 在 staging 环境执行 `alembic upgrade head` → `alembic downgrade -1` 完整循环
2. **功能测试**: PracticesPage + 问卷系统端到端测试
3. **生产部署**: 确认迁移和生产环境配置 → 手动 dispatch `cd.yml`
4. **文档整理**: 更新 00-dev-onboarding.md 中的启动步骤和项目结构
5. **性能测试**: 评分并行化效果验证 (目标 <15s)
