# PiOps GitHub Actions 工作流

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

证据不足时工作流应失败而不是创建空 PR。

## 修改边界

外围脚本拒绝以下变更：

- `.github/`、`deploy/`、环境文件和疑似 secret 文件；
- 数据库迁移、依赖锁文件和二进制文件；
- 超过 12 个文件或 800 行的补丁。

后端变更会运行 `uv sync --frozen --group dev`、Ruff、Python compileall，以及本次新增或修改的测试文件。前端变更会运行 `npm ci`、lint 和 build。

## PR 与 CI

草稿 PR 默认使用仓库 `GITHUB_TOKEN` 创建。GitHub 会抑制由该 token 触发的部分递归工作流事件，因此自动创建的 PR 可能不会立即触发现有 PR CI。第一版保留人工审核；需要完整自动触发时，再把发布 Job 切换为最小权限 GitHub App installation token，而不改变 Pi 运行流程。

## 安全边界

诊断作为 `UNTRUSTED_EVIDENCE` 输入模型：可影响分析结论，但不能改变工作流、工具白名单或发布步骤。Pi 的 Bash 具有当前 Runner 的进程权限，`pi-work` 禁止加入生产 token 或仓库写 token。
