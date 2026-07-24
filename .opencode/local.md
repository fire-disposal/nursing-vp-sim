# 项目本地提示词

## 项目概要

护理虚拟患者模拟训练系统 (Nursing VP Sim)，前后端分离架构。

- **前端**: React 19 + TypeScript + Vite + Tailwind css v4 + TanStack Query + shadcn/ui 风格组件
- **后端**: FastAPI + SQLAlchemy ORM + PostgreSQL 15 + Alembic 迁移
- **容器化**: Docker + docker compose
- **LLM**: DeepSeek API
- **仓库**: github.com/fire-disposal/nursing-vp-sim

## 关键目录

```
frontend/src/pages/admin/   — 管理后台页面
frontend/src/api/           — API 客户端层 (axios-instance 含 auth/retry 拦截器 + useApiQuery 统一解包)
frontend/src/engine/        — 训练引擎 (TrainingEngine, MessageBus, PluginRegistry)
frontend/src/plugins/       — 训练 UI 插件 (emotion, inquiry, nursing-record, physical-exam 等)
backend/routers/            — API 路由
backend/models/            — ORM 模型（按域分文件的包）
backend/schemas/            — Pydantic 请求/响应模型（按域分文件）
backend/repositories/       — 数据访问层（Repository[T] 基类，只 flush 不 commit）
backend/services/            — 业务逻辑层（唯一性校验、守卫、事务编排）
backend/core/config.py      — 全局配置常量 (SCORING_TIMEOUT_SECONDS 等)
backend/core/exceptions.py  — 标准错误词汇 (AuthError/NotFoundError/ConflictError/ValidationError)
backend/core/unit_of_work.py — 事务管理 (commit/rollback + IntegrityError→ConflictError)
backend/core/deps.py         — DI 依赖 (DbSession, CurrentUser)
backend/contexts/training/  — 训练上下文（核心业务逻辑 + pipeline 管道）
backend/infrastructure/     — 基础设施（LLM 客户端、缓存、队列、结算循环）
deploy/                     — docker-compose.staging/prod.yml + nginx 配置
.github/workflows/          — GitHub Actions 工作流
scripts/                    — 辅助脚本 (create-data-migration.js, notify-deploy.mjs)
```

## 可用的外部工具

### GitHub CLI (`gh`)
已登录可用。随时使用 `gh` 查看 Action 运行状态、日志、PR 等。

### SSH 到服务器 (`yecaoyun`)
本地 `~/.ssh/config` 已配置别名 `yecaoyun`，可直接连接。

常用命令:
```bash
ssh yecaoyun "docker ps --format 'table {{.Names}}\t{{.Status}}'"
ssh yecaoyun "docker logs nursing-backend-staging --tail 30"
ssh yecaoyun "curl -sf http://127.0.0.1:9081/api/health"
```

服务器用户 root，项目路径 `/opt/nursing-vp-sim/`，staging 后端端口 9081。

## Tag 版本号规则

格式: `vYYYY.MM.DD-N`，按北京时间日期 + 当日递增序号。仅 tag push 触发 staging 部署。

```bash
# 查已有 tag
git tag --sort=-creatordate | head -5
# 创建并推送
git tag -a v2026.06.12-7 -m "描述改动"
git push origin v2026.06.12-7
```

## GitHub Actions 工作流

| 工作流 | 触发 | 用途 |
|--------|------|------|
| `deploy-staging.yml` | push `v*` tag | 构建镜像 + 部署到 test.205716.xyz + 钉钉通知 |
| `deploy-production.yml` | `workflow_dispatch` | 部署到 iomt.205716.xyz（版本门禁） |
| `maintenance.yml` | `workflow_dispatch` | 开启/关闭维护模式 |
| `rollback.yml` | `workflow_dispatch` | 紧急回滚 |

## 推送前检查（必须全绿）

Windows PowerShell 环境，`;` 串行命令:

```bash
# 1) Python 语法 + 单元测试 + lint + format + 类型检查
cd backend; uv run python -m compileall -q .; uv run python -m pytest -x -q; uv run ruff check; uv run ruff format; uv run ty check

# 2) TypeScript 类型检查 + 前端 lint
cd frontend; npx tsc --noEmit; npx biome check
```

## 服务器端口映射

| 环境 | db | backend | frontend |
|------|-----|---------|----------|
| Staging | 5434 | 9081 | 9080 |
| Production | 5433 | 9001 | 9000 |

所有端口绑定 127.0.0.1，nginx 宿主机监听 80/443 反代。

## 响应编码规范

后端使用标准 HTTP 状态码 + JSON body，不再使用业务信封包装。成功响应直接返回数据体，错误响应返回 `{"detail": "错误描述"}`（FastAPI 标准）。
前端 `useApiQuery` hook 自动消解 `AxiosResponse.data`，`useQuery` 的 `data` 即为后端返回的原始数据体。

## 分页约定

列表接口返回 `PaginatedResponse`:
```json
{"items": [...], "total": 50, "offset": 0, "limit": 20}
```
前端取列表用 `data?.items ?? []`。

## 数据库模型核心表

- `roles` / `role_permissions` — 角色与权限
- `users` — 用户（含 wechat_openid, avatar, gender）
- `cases` — 病例（JSON 字段 case_data）
- `practices` — 练习（关联病例，含 mode/features/behavior/assessment JSONB）
- `grades` / `classes` / `user_classes` — 年级/班级/关联
- `assignments` — 作业发布（关联 practice + class）
- `training_records` — 训练记录（含 scoring_status, current_phase, practice_snapshot）
- `messages` — 对话消息（role: student/patient/system）
- `scores` — 评分结果
- `score_reviews` — 教师评分复核（独立表）
- `nursing_records` — 护理记录（JSONB sheet_data）
- `api_secrets` / `llm_configs` — LLM API 密钥与配置
- `prompt_templates` — Prompt 模板（版本化管理）
- `rubrics` — 评分标准（JSONB dimensions）
- `llm_call_logs` — LLM 调用日志
- `feedback` — 学生反馈
- `notes` — 学习笔记
- `questionnaire_*` — 问卷调查 (templates/questions/responses/answers/case_questionnaires)
- `qa_sessions` / `qa_records` — 护理问答（会话模式）

## 后端开发模式

新增/改后端资源域遵循分层模式：**thin router** → **service**（业务规则 + `unit_of_work` 事务）→ **repository**（`Repository[T]` 子类，只 flush 不 commit）。错误用 `core/exceptions` 的 `ValidationError`/`NotFoundError`/`ConflictError`/`AuthError`；依赖用 `core/deps` 的 `DbSession`/`CurrentUser`。analytics/流式/导出路由保持胖路由。

## 运维诊断端点

综合诊断快照 `/api/diagnose`，单端点聚合，使用 `DIAGNOSE_TOKEN` 查询参数认证。

系统运维密钥: `AVEDEUSMECHANICUSBENEDICTUSMACHINA`

| 端点 | 用途 | 示例 |
|------|------|------|
| `/api/diagnose` | 综合诊断快照（健康/LLM/评分/语音/指标/错误/告警全部聚合） | `curl -sf 'https://test.205716.xyz/api/diagnose?token=AVEDEUSMECHANICUSBENEDICTUSMACHINA'` |

返回字段: `version`, `health`, `summary`, `llm`, `scoring`, `voice`, `voice_budget`, `metrics`, `errors`, `alerts`。

生产环境域名: `https://iomt.205716.xyz`

也可通过 SSH 在服务器本地直接访问: `ssh yecaoyun "curl -sf 'http://127.0.0.1:9081/api/diagnose?token=AVEDEUSMECHANICUSBENEDICTUSMACHINA'"`

自动生成告警：LLM 成功率 < 90%、近 24h 错误 > 50 次、卡住评分 > 5 条、活跃会话 > 50 个。

## Feedback Bot API（外部 AI 接入）

独立于用户认证体系，通过 `FEEDBACK_BOT_TOKEN` 环境变量鉴权。用于外部 AI Agent 自动拉取反馈、分析问题、标记处理。

### 认证

在服务器 `.env` 中设置 `FEEDBACK_BOT_TOKEN=your-secret`。所有 bot 请求通过 `?token=xxx` query param 鉴权。未设置时端点返回 404，token 错误返回 403。

### 读取反馈列表

```
GET /api/feedback/bot?token=xxx&since=2026-07-01T00:00:00&limit=50&offset=0
```

| 参数 | 默认 | 说明 |
|------|------|------|
| `token` | (必填) | Bot 令牌 |
| `since` | 无 | ISO 时间过滤（仅返回此时间之后的反馈） |
| `limit` | 50 | 每页条数（1-200） |
| `offset` | 0 | 分页偏移 |

返回格式：
```json
{
  "items": [
    {
      "id": 1,
      "rating": 3,
      "tag": "bug",
      "content": "登录按钮连点导致页面卡死",
      "version": "2026.07.14-10",
      "developer_reply": null,
      "replied_at": null,
      "auto_fix_attempted": false,
      "auto_fix_at": null,
      "created_at": "2026-07-14T06:00:00"
    }
  ],
  "total": 5,
  "offset": 0,
  "limit": 50
}
```

**字段语义：**
- `rating` — 1-5 满意度（1=很不满意，3=一般，5=很满意）
- `tag` — 反馈类型：`bug`/`feature`/`experience`/`content`/`ui`/`other`
- `version` — 提交时的系统版本号（APP_VERSION 环境变量）
- `developer_reply` — 管理员回复（null=未回复）
- `auto_fix_attempted` — 自动化修复是否已尝试（默认 false）
- `auto_fix_at` — 修复尝试时间（null=未尝试）

### 标记已尝试自动修复

```
PATCH /api/feedback/bot/{id}?token=xxx
```

将指定反馈的 `auto_fix_attempted` 设为 true，`auto_fix_at` 设为当前 UTC 时间。幂等操作，可重复调用。

返回：
```json
{"id": 1, "auto_fix_attempted": true, "auto_fix_at": "2026-07-14T07:00:00"}
```

### AI Agent 典型工作流

```
1. GET /api/feedback/bot?since=<上次检查时间> → 获取新反馈
2. 按 tag 分类：bug 优先处理，feature/experience 次之
3. 对每个 bug 反馈：
   a. 分析 content 中的问题描述 + version 定位代码范围
   b. 尝试生成修复方案并实施
   c. PATCH /api/feedback/bot/{id} 标记 auto_fix_attempted=true
4. 开发者审核：通过管理页或 /my-feedback 查看回复状态
```

### 监控告警双通道

| 通道 | 用途 | 触发 |
|------|------|------|
| 钉钉 Webhook | 部署通知 + 服务器告警 | CI 部署成功 / crontab 每 15 分 |
| SMTP 邮件 | 服务器告警（HTML） | crontab 每 15 分 |

告警类型（`compute_alerts` → `/api/diagnose` → `monitor.py`）：
LLM 成功率/限流/错误数、评分卡住/排队、活跃会话、TTS/ASR 成功率/错误数、语音预算、inode
自动生成告警：LLM 成功率 < 90%、近 24h 错误 > 50 次、卡住评分 > 5 条、活跃会话 > 50 个。

## 常见问题排查

1. **部署失败**: `gh run list --repo fire-disposal/nursing-vp-sim --limit 5` → `gh run view <id> --log-failed`
2. **容器 unhealthy**: `ssh yecaoyun "docker logs nursing-backend-staging --tail 30"`
3. **前端页面崩溃**: 浏览器 DevTools → Console 看报错堆栈
4. **API 返回非预期格式**: `ssh yecaoyun "curl -sf http://127.0.0.1:9081/api/端点"`
5. **数据库状态**: `ssh yecaoyun "docker exec nursing-db-staging psql -U nursing -d nursing_vp -c '查询'"`

## Shell 环境约束

- **禁止使用 PowerShell (`pwsh`) 执行脚本编辑、编码转换等文件操作** — 乱码风险。
- **优先使用 `uv run python`** 进行所有脚本、文件编辑、文本处理任务。
- Git 交互式操作（如 `rebase -i`）的编辑器应使用 `uv run python -c "..."` 注入。
