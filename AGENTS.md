# AGENTS.md

> **Agent 初始化**：用 `git rev-parse --git-dir` 确认在仓库内，`git config core.hooksPath` 确认为 `.husky/_`。失效时执行 `pnpm install`。**禁止 `npx husky`**。

## Husky 钩子链

```
git commit → commit-msg: 格式校验 (validate-commit.js)
           → pre-commit: migration 目录检查 + ruff + lint-staged (biome + tsc)
git push   → pre-push: tag 格式 + alembic roundtrip（无 psql 时跳过，绝不 fallback 到 .env 库）+ 迁移链完整性
```

提交格式：`<emoji> <type>: <description>`（详见 `pnpm run check` 驳回时打印的 emoji 表）。

## 诊断端点 `/api/diagnose`

运维监控统一入口。Agent 故障诊断、日报脚本的数据源。token 鉴权。

```
GET /api/diagnose?token=<DIAGNOSE_TOKEN>
```

返回：版本、健康、LLM/评分/语音/TTS 统计、错误日志、告警列表。`summary.status` = `healthy` | `degraded`。

Token 在 `.env` 的 `DIAGNOSE_TOKEN`。未设置 → 404，错误 → 403。

```bash
# 快速检查
curl -s "http://127.0.0.1:9081/api/diagnose?token=$TOKEN" | python3 -m json.tool | head -20
# 只看告警
curl -s "...token=$TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)['alerts'])"
```

## 反馈 Bot API `/api/feedback/bot`

外部 AI 自动拉取反馈、分析、标记。通过 `?token=<FEEDBACK_BOT_TOKEN>` query param 鉴权（`.env`）。

```
GET  /api/feedback/bot?token=xxx&limit=50&include_fixed=false   # 读反馈（默认排除已修复）
PATCH /api/feedback/bot/{id}?token=xxx                            # 标记 auto_fix_attempted
PUT   /api/feedback/bot/{id}/reply?token=xxx&overwrite=false      # 直写开发者回复（body: {"reply": "..."}，署名 FEEDBACK_BOT_NAME 默认「系统助手」，已回复默认 409 防覆盖人工回复）
```

| 参数 | 说明 |
|------|------|
| `since` | ISO 时间过滤 |
| `version` | 版本号精确过滤 |
| `tag` | bug/feature/experience/content/ui/other |
| `replied` | true=已回复, false=未回复 |
| `include_fixed` | 默认 false，排除已尝试修复的 |

返回字段：`id`, `rating`(1-5), `tag`, `content`, `version`, `developer_reply`, `auto_fix_attempted`, `created_at`。

## 其他

| 主题 | 位置 |
|------|------|
| Tag/部署/CI | **发布请用 `pnpm run tag`**（`auto-tag.mjs --push`：自动算当天 `vYYYY.MM.DD-N` 序号，脏树/冗余门，推送 master+tag）；只建不推用 `pnpm run tag:local`；手动 `git tag` 亦可但需自算序号，pre-push 会校验格式/日期/序号。tag 触发 staging 部署，详见 `.github/workflows/` |
| Python | `cd backend && uv run <cmd>` |
| 测试 | `pnpm test:backend`（纯逻辑，无库约 4s；数据库相关测试已移除） |
| 迁移 | `ddl/` 禁 `op.execute()`；`data/` 需 `# Manual override reason: data_only` |
| API 类型 | `pnpm run api:update` 重新生成，禁止手改 `.gen.ts` |
| 完整文档 | `docs/README.md` |
