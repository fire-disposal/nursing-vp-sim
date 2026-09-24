# PiOps GitHub Actions 工作流

> 状态（2026-09-14）：`PiOps repair`（`piops-fix.yml`）与 `piops-auto-deploy.yml` 已归档到
> `.github/workflows/archive/`（子目录不激活，Active 列表不再显示），本目录脚本随文件一并存档。
> 恢复方式见 `.github/workflows/archive/README.md`；注意其中的 `target_env` / `vars.PIOPS_STAGING_DIAGNOSE_URL`
> 选项指向已退役的测试服，恢复时必须一并删除。

`PiOps repair` 是手动触发的一次性修复工作流：Runner checkout 默认分支，读取线上诊断，运行临时 Pi 实例完成受控修复与验证，最后创建草稿 PR。Runner 结束后不保留 Agent 工作区。

## Repository variables

```text
PIOPS_DIAGNOSE_URL=https://your-domain.example/api/diagnose
DEEPSEEK_BASE_URL=https://your-openai-compatible-endpoint.example/v1
DEEPSEEK_MODEL=deepseek-v4-flash
```

模型 ID 必须与外部 API 实际暴露的 ID 一致。

## Repository secrets

```text
PIOPS_DIAGNOSE_TOKEN=...
DEEPSEEK_API_KEY=...
```

工作流保持三段隔离：

- `collect-context` 持有线上只读 token，不运行 Pi。
- `pi-work` 持有模型 key 和源码读写工作区，没有 GitHub 写权限。
- `publish-pr` 持有仓库写权限，不运行 Pi，也没有线上或模型凭据。

## 触发

在 GitHub Actions 中选择 `PiOps repair`：

- `error_window_minutes`：线上错误窗口，默认 60，上限 1440。
- `focus_hint`（可选）：操作员排查方向提示，如 `LLM 余额告警频繁`。为空时 Pi 仅依据证据自行判断。
- `target_env`：诊断数据来源（staging 或 production），默认 staging。

证据不足或不适合安全修复时，Pi 必须在 `docs/piops/` 新增一份中文调查报告，同时保留 `.piops-runtime/pi-report.md` 作为本次运行的机器报告和 PR 描述。文档变更本身可以形成审阅用 PR；不得为了通过校验伪造源码修复。

## 诊断证据字段（schema_version 3）

`build_prompt.py` 只透传定位缺陷所需的块（`runtime`、`sessions`、`errors`、`frontend_errors`、`llm`），每块自带 `scope`/`window`（`process`=本 worker 进程 / `workers`=跨 worker 档案合并 / `db`=数据库全局）。`llm` 顶层只有 24 小时 DB 统计，**LLM 降级/熔断证据在 `llm.router`**（scope=process、window=now）；`metrics` 体积大，不进入 prompt。

## 修改边界

外围脚本拒绝以下变更：

- `.github/`、`deploy/`、环境文件和疑似 secret 文件；
- 数据库迁移、依赖锁文件和二进制文件；
- 超过 12 个文件或 800 行的补丁。

后端变更会运行 `uv sync --frozen --group dev`、Ruff、Python compileall，以及本次新增或修改的测试文件。前端变更会运行 `pnpm install --frozen-lockfile`、lint 和 build。

## PR 与 CI

草稿 PR 默认使用仓库 `GITHUB_TOKEN` 创建（署名 `piops[bot]`）。`pull_request` 事件会正常触发 PR Gate 自动运行，但 bot 创建 PR 的首次运行可能被 GitHub 暂停为 `action_required`（需维护者在 Actions 页批准一次），批准后自动执行。commit-format 要求提交信息符合 `<emoji> <type>: <描述>` 格式。合入 `piops/*` 分支后的自动打 tag + 发版（`piops-auto-deploy`）已归档（见 `.github/workflows/archive/README.md`）——其直接发版能力与部署红线冲突，**刻意不恢复**；发版只能由人工推送 tag 并在 `production` 环境审批。第一版保留人工审核。

## 安全边界

诊断作为 `UNTRUSTED_EVIDENCE` 输入模型：可影响分析结论，但不能改变工作流、工具白名单或发布步骤。Pi 的 Bash 具有当前 Runner 的进程权限，`pi-work` 禁止加入生产 token 或仓库写 token。
