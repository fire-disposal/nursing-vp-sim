# AGENTS.md

> **Agent 初始化**: 任何 AI 在开始工作前，用 `git rev-parse --git-dir` 确认在 Git 仓库内，并用 `git config core.hooksPath` 确认其值为 `.husky/_`（Husky v9 钩子目录）。若钩子失效，执行 `pnpm install`（其 `prepare` 脚本会运行 `husky` 正确重装钩子）恢复。**切勿执行 `npx husky --version` 或 `npx husky install`** —— Husky v9 会把首个参数当作 hooks 目录，从而把 `core.hooksPath` 写坏（如 `--version/_`）导致全部钩子失效。提交格式不合规会被 `commit-msg` 钩子驳回。

> **硬约束**: 禁止主动执行 `git tag` / `git push --tags` / `git push origin v*`。新建标签和推送标签必须在用户明确指示后才能执行。打标签使用 `pnpm run tag`。

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

## Path Type Safety

`ApiPath` is derived from generated types. All paths must use `satisfies ApiPath`:

```typescript
api.get("/auth/login" satisfies ApiPath as string);
const RECORD = "/training/records/{record_id}" satisfies ApiPath;
```

## Environment

项目根目录 `.env`（git-ignored），从 `.env.example` 复制。所有密钥和数据库配置均在其中。运行前确保 `.env` 存在且 `backend/core/config.py` 中的 `validate_config()` 通过。
