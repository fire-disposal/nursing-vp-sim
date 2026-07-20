# AGENTS.md

> **Agent 初始化**: 任何 AI 在开始工作前，用 `git rev-parse --git-dir` 确认在 Git 仓库内，并用 `git config core.hooksPath` 确认其值为 `.husky/_`（Husky v9 钩子目录）。若钩子失效，执行 `pnpm install`（其 `prepare` 脚本会运行 `husky` 正确重装钩子）恢复。**切勿执行 `npx husky --version` 或 `npx husky install`** —— Husky v9 会把首个参数当作 hooks 目录，从而把 `core.hooksPath` 写坏（如 `--version/_`）导致全部钩子失效。提交格式不合规会被 `commit-msg` 钩子驳回。

> **硬约束**: 禁止主动执行 `git tag` / `git push --tags` / `git push origin v*`。新建标签和推送标签必须在用户明确指示后才能执行。打标签使用 `pnpm run tag`。若因网络等原因需手动打版，必须**同时推送 master 和 tag**：`git push origin HEAD:master vX.Y.Z-N`，禁止分开推送导致本地/远端分支不同步。

## Hook Chain

```
git commit → commit-msg 格式校验 via validate-commit.js
           → pre-commit: migration 目录检查(check-migration-autogen.js)
                        + ruff format+check (staged backend)
                        + lint-staged: biome lint + tsc (staged frontend)
git push   → pre-push: tag 格式校验 + checklist 验证 + alembic roundtrip + 迁移链完整性
```

- **lint-staged**: `tsc` + `biome lint` 只跑 staged frontend；迁移检查只跑 staged `migrations/versions/`
- **Alembic roundtrip**: 临时库 → upgrade → downgrade → upgrade → drop（验证所有迁移可逆）
- **Checklist**: 仅 `feat`/`fix` 版本需要；refactor/docs/ci/test/chore/build 无需
- 驳回的提交打印 emoji 格式表

## Cloud CI Gate (PR → master)

在线 PR 门禁 `.github/workflows/commit-format.yml` 与本地 Husky 行为精确对齐（仅检查 changed files）。本地通过则云端必过。额外校验：`api:spec` + `api:generate` diff 检查（openapi.json / api-types.gen.ts 同步）。需手动触发 `pnpm run check:api` 验证 `capabilities.gen.ts` 同步。

## pnpm Scripts

All run from monorepo root.

| Script | Does |
|--------|------|
| `pnpm run dev` | Backend (:8000) + frontend (:3000) concurrently |
| `pnpm run check` | ruff + ty + biome + tsc (no pytest) |
| `pnpm run check:full` | check + pytest |
| `pnpm run db:migrate` | `alembic upgrade head` |
| `pnpm run db:downgrade` | `alembic downgrade -1` |
| `pnpm run db:migration -- "name"` | `alembic revision --autogenerate -m "name"` |
| `pnpm run db:data -- "name"` | Scaffold data-only migration (`scripts/create-data-migration.js`) |
| `pnpm run api:update` | `api:spec` + `api:generate` + `cap:generate` |
| `pnpm run api:update:all` | `api:spec` + `api:generate` + `cap:generate`（与 `api:update` 相同） |
| `pnpm run tag` | Auto-generate date-based tag + push → triggers staging deploy |

> **After any backend schema/route change, run `pnpm run api:update:all` from monorepo root.** Never manually edit `.gen.ts` files. Never dump openapi.json via curl/SSH.

## Auto-Generated Files — NEVER EDIT

| File | Generator | Update command |
|------|-----------|----------------|
| `frontend/src/api/api-types.gen.ts` | `openapi-typescript` | `pnpm run api:update` |
| `frontend/src/engine/capabilities.gen.ts` | `backend/scripts/gen_capabilities_ts.py` | `pnpm run api:update` |
| `openapi.json` | `pnpm run api:spec` | `pnpm run api:spec` |

**These files are read-only for humans.** Editing them causes `pnpm run check:api` to fail CI and will be overwritten on next regeneration. Any type mismatch means the backend schema changed — regenerate, don't patch.

## File Naming Convention

Router 文件使用复数命名（对应 URL 路径），Service / Repository / Model 文件使用单数命名（对应业务实体）。

| Layer | Convention | Examples |
|-------|-----------|----------|
| `routers/` | **plural** | `cases.py`, `users.py`, `records.py`, `assignments.py`, `stats.py` |
| `services/` | **singular** | `case.py`, `user.py`, `record.py`, `assignment.py`, `stats.py` |
| `repositories/` | **singular** | `case.py`, `user.py` (training/log 类使用 `llm_log.py`, `voice_log.py`) |
| `models/` | **domain** | `auth.py`, `case_practice.py`, `training.py`, `llm.py`, `voice.py` |

## Python Environment

Always `uv run` from `backend/`. Never call `.venv/Scripts/python.exe` directly.

```bash
cd backend
uv run ruff check
uv run alembic upgrade head
uv run ty check
uv run python -m pytest -x -q
```

## Testing

**Do NOT run full pytest on every edit.** Target the affected file or domain.

| Scope | Command | Time |
|-------|---------|------|
| One file | `pytest tests/auth/test_security.py -x -q` | ~2s |
| One domain | `pytest tests/training/ -x -q` | ~10s |
| Full suite | `pytest -x -q` or `pnpm run check:full` | ~140s |

## Migration Rules

判定基于**目录**，而非"自动生成标记"（迁移可 `--autogenerate` 或 AI/手写，标记非安全属性、不做强制）。

| Directory | Contains | 硬约束 |
|-----------|----------|--------|
| `ddl/` | CREATE/ALTER/DROP, add_column, indexes | **禁止 `op.execute()`**（无数据操作） |
| `data/` | INSERT, UPDATE, seed, `op.execute()` | docstring 须含 `# Manual override reason: data_only` |

- **DDL 与数据分离**：`ddl/` 只做结构变更、不得含 `op.execute()`；数据操作放 `data/`（`pnpm run db:data -- "name"`）
- **优先 `--autogenerate`**（省事、贴合模型），但手写/AI 写的纯 DDL 同样合法——只要在 `ddl/` 且无 `op.execute()`
- **Don't commit empty migrations**
- **`0001_initial` is the base** — do not hand-edit it
- **可逆性**：每个迁移须有可用 `downgrade`（pre-push 做 base→head→base→head 往返校验）
- **单一 head**：CI 与 `check-migration-chain.py` 校验

> ~~已知技术债：`ddl/edc17425a5f4_batch_a_case_schema.py` 含 `op.execute()`（历史遗留、已应用），违反 DDL/数据分离。因已入链应用，需专项拆分处理，勿直接改写。~~ **已修复**（2026-07-07）：数据操作已拆至 `data/mrac4bzvuq7d_batch_a_backfill_data.py`，`ddl/edc17425a5f4` 现为纯 DDL。

## Commit Format

`<emoji> <type>: <description>` — enforced by `commit-msg` hook + Cloud CI.

| Emoji | Type | | Emoji | Type |
|-------|------|-|-------|------|
| ✨ | feat | | 🔒 | security |
| 🐛 | fix | | ⚡ | perf |
| ♻️ | refactor | | 🗃️ | db |
| 📝 | docs | | 🚀 | ci |
| ✅ | test | | 🔧 | chore |
| 🎨 | style | | 🔥 | remove |
| 📦 | build | | ⏪ | revert |

## Tag Naming

使用 `pnpm run tag` 自动生成并推送（北京时间日期 + 当日递增序号）。不建议手动执行 `git tag` / `git push --tags`。

格式: `vYYYY.MM.DD-N`。Push tag 触发 staging 部署。

## Testing Checklist

Every tag push needs `docs/testing/{YYYY-MM}/checklist-{tag}.md` (pre-push hook enforces; 当前通过 `ENFORCE_CHECKLIST=false` 临时关闭，重构阶段恢复后启用)。

**"无需测试" only if all commits are non-user-facing** (refactor/docs/ci/test/chore/build). Any `feat` or `fix` commit requires a real checklist.

Ask opencode in this repo — it will:

1. `ssh yecaoyun` fetch current prod version from `.version-history-prod`
2. `git log prod_ver..staging_ver` extract user-visible commits (feat, fix)
3. Analyze the diff and write a scene-level checklist to `docs/testing/{YYYY-MM}/checklist-{tag}.md`

## Deployment

SSH: `ssh yecaoyun`。工作流文件见 `.github/workflows/`，详细配置见 `deploy/`。

| 环境 | Domain | Backend | Frontend | DB | 触发方式 |
|------|--------|---------|----------|-----|----------|
| Staging | test.205716.xyz | 9081 | 9080 | 5434 | Tag push |
| Production | iomt.205716.xyz | 9001 | 9000 | 5433 | `gh workflow run deploy-production.yml -f version=vX` |

- 生产部署前 staging 版本必须一致
- 自动备份 → 部署 → 健康检查 → 失败则回滚
- 部署成功时钉钉 Webhook 播报（`scripts/notify-deploy.mjs`，从 `secrets.DINGTALK_WEBHOOK` 读取）

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
| `version` | 无 | 按版本号精确过滤，如 `2026.07.14-10` |
| `tag` | 无 | 按反馈类型过滤：`bug`/`feature`/`experience`/`content`/`ui`/`other` |
| `replied` | 无 | 按回复状态过滤：`true`=已回复，`false`=未回复 |
| `include_fixed` | `false` | 是否包含已尝试自动修复的反馈（默认排除） |
| `limit` | 50 | 每页条数（1-200） |
| `offset` | 0 | 分页偏移 |

**默认排除已修复项**：未指定 `include_fixed=true` 时，只返回 `auto_fix_attempted=false` 的反馈，防止 AI 重复处理已修复问题。

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

## Path Type Safety

`ApiPath` is derived from generated types. All paths must use `satisfies ApiPath`:

```typescript
api.get("/auth/login" satisfies ApiPath as string);
const RECORD = "/training/records/{record_id}" satisfies ApiPath;
```

## Environment

项目根目录 `.env`（git-ignored），从 `.env.example` 复制。所有密钥和数据库配置均在其中。运行前确保 `.env` 存在且 `backend/core/config.py` 中的 `validate_config()` 通过。

**Bot Token**: 设置 `FEEDBACK_BOT_TOKEN=your-secret` 以启用 Feedback Bot API。
