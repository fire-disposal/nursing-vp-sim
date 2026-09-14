# 已归档的 CI/CD（不激活）

> 归档日期：2026-09-14。原因：双栈（staging `test.205716.xyz` + prod `iomt.205716.xyz`）
> 收敛为**单实例部署**，见 `.github/workflows/deploy.yml` 与 `.github/workflows/rollback.yml`。

## 为什么放在子目录就等于「不激活」

GitHub Actions 只会从 `.github/workflows/` **顶层**读取工作流；子目录里的 YAML 不会被
任何事件触发，也不会出现在 Actions 列表里。所以这里的文件是**可回滚的历史存档**，
不是被禁用的配置——需要时 `git mv` 回上一层即可恢复。

## 归档清单与它们的实际职责

| 文件 | 原职责 | 保留特性去向 |
|---|---|---|
| `deploy-staging.yml` | tag/dispatch → 构建推送 GHCR → 部署 staging → 健康检查 + 自动回滚 | 迁移门禁、健康检查、自动回滚（含 alembic 回退）、镜像清理、部署横幅、钉钉通知、开发报告发布 → 全部进入 `deploy.yml` |
| `deploy-production.yml` | 手动 dispatch → 部署 prod | **部署前数据库备份（失败即停）**、版本历史文件、生产 nginx/监控脚本下发 → 进入 `deploy.yml` |
| `rollback-production.yml` | 手动选择环境 + 版本 → 执行 `deploy/rollback.sh` | 全部保留，去掉 environment 二选一 → `rollback.yml` |
| `piops-auto-deploy.yml` | `piops/*` PR 合并后自动打 tag 并部署 staging | **刻意不保留**：单实例下它等价于「AI 直接发版到正式服」，与 AGENTS.md 部署红线冲突。若要恢复自动化发版，必须改成「开 PR / 通知人工」，不得直接触发部署 |
| `piops-fix.yml` | 按线上错误窗口采集 `/api/diagnose` 上下文 → LLM 生成修复 PR | 未进入部署流水线；作为平台能力原样存档。恢复时请注意它只应产出 PR，不应触发部署 |

## 单实例流水线新增/保留的约定

1. **人工闸门机制化**：`deploy.yml` / `rollback.yml` 都绑定 GitHub Environment `production`。
   必须在仓库 Settings → Environments → `production` 配置 **Required reviewers**，
   否则 tag 推送会直接发版（旧流程靠「prod 用 workflow_dispatch」表达人工确认）。
2. **部署前必须备份成功**：`pg_dump` 失败即终止部署（继承自旧 prod 流水线）。
3. **版本历史文件统一为 `.version-history-prod`**：`deploy/rollback.sh` 依赖该文件名。
4. **部署后冒烟**：`/api/diagnose` 必须返回 `healthy|degraded`；未配置 `DIAGNOSE_TOKEN` 时跳过并提示。
5. **镜像存在性校验**：部署前 `docker manifest inspect` 两个镜像，避免部署不存在的 tag。

## 相关文档

- 运维手册：`docs/09-operations.md`（双栈相关段落需要同步改写，见本次迁移任务）
- 回滚脚本：`deploy/rollback.sh`、`deploy/db-restore.sh`、`deploy/db-backup.sh`
- 迁移方案：`docs/ops/single-instance-migration.md`
