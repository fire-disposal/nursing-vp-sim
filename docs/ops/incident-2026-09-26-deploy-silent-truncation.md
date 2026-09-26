# 部署脚本被 stdin 吞掉 → 静默"成功"（2026-09-26）

## 症状

发布 `v2026.09.26-1` 后 GitHub Actions 全绿（含 `Smoke check /api/diagnose` 与 `✅ Deployed`），
但宿主上：

| 检查 | 实测 |
|---|---|
| 运行镜像 | `nursing-vp-sim-backend:2026.09.25-1`（**旧版本**，容器已 Up 40 小时从未重建） |
| `/api/health` | `{"status":"ok","version":"2026.09.25-1"}` |
| 数据库 schema | **已迁到 head**（`jobs` 表、`prompt_schema_version`、`context_policy_version` 全部存在） |
| `.version-history-prod` | 没有本次版本的记录 |

即：**迁移用新镜像跑了，服务却仍是旧代码** —— 旧代码 + 已重命名的列（`prompt_version` →
`prompt_schema_version`）意味着任何评分写入都会失败。当晚生产空闲（0 会话、24h 内 0 次 LLM 调用），
未造成实际数据损失。

## 根因

Deploy 步骤把脚本经 stdin 送给远端：`ssh "$USER@$HOST" 'bash -s' << DEPLOY`，而脚本第 453 行是

```bash
docker compose ... run --rm --no-deps backend alembic upgrade head
```

`docker compose run` **默认接管 stdin**（未加 `-T`）。它把脚本剩余部分一并读走，于是：

```text
迁移执行完 → bash 在 stdin 上读到 EOF → 脚本"正常"结束（退出码 0）
→ 后续 up -d / 健康检查 / 版本历史 全部没跑 → ssh 返回 0 → 步骤 ✓ → 工作流 ✓
```

日志里的判据（Deploy 步骤的运行期输出到迁移那条数据迁移日志就**戛然而止**，既没有
`✓ schema at head` 也没有 `up -d` 输出），以及 compose 的
`The "IMAGE_VERSION" variable is not set` 警告（另一处未传变量的调用），共同指向这一点。

## 修复（`.github/workflows/deploy.yml`）

1. **不再吞 stdin**：迁移命令加 `-T` 与 `</dev/null`（双保险）。
2. **成功必须断言版本**：原先只 `curl -sf /api/health && echo ">> v$VER ✓"` —— 容器没被重建时
   它照样 200。现在解析响应里的 `version` 并与本次发布版本比对，不一致即回滚 + 非零退出。
3. **完成哨兵**：脚本首行设 `DEPLOY_COMPLETED=no`，末行置 `yes`，用 EXIT trap 把"没跑到最后一行"
   变成非零退出 —— 这一类"被截断却报成功"的失败模式从此不再静默。
4. **转义纪律**：该 heredoc **不带引号**，body 里的 `$VAR` 一律由 runner 侧展开 —— 脚本局部变量
   必须写成 `\$VAR`。（修复过程中我自己就踩了一次：`$rc` / `$DEPLOY_COMPLETED` / `$RUNNING_VER`
   未转义会被展开成空值，哨兵会把每次成功部署误判为失败。）
5. 消噪：`up -d db` 也传 `IMAGE_VERSION`，避免 compose 警告掩盖真实告警。

## 验证

- 手动 `IMAGE_VERSION=2026.09.26-1 docker compose up -d` 确认镜像与 schema 一致后，
  `/api/health` = `2026.09.26-1`、`alembic current` = `d9f3b4c5e6a7 (head)`、新路由
  `/api/admin/versions/attribution` 在位。
- 以 `workflow_dispatch` 重放同版本部署验证修复：Deploy 步骤现在跑完
  `✓ schema at head` → `✓ healthy` → 版本断言，并在 `.version-history-prod` 写入
  `2026.09.26-1|…|d9f3b4c5e6a7`（即脚本确实到达末行）。

## 教训

- **"步骤退出码 0"不等于"脚本跑完了"**：stdin 驱动的脚本一旦被任何子命令吞掉 stdin，就会
  静默截断。要么改用文件传递脚本，要么给每个可能读 stdin 的命令加 `-T`/`</dev/null`，
  并保留完成哨兵。
- **署后校验必须断言身份**（版本号），而不是"端点有响应"。这次正是靠发布后手动核对版本才发现，
  流水线自身的"冒烟"完全没看出来。
- 迁移与服务启动的顺序使这个 bug 特别危险：schema 已经变了，旧代码却还在跑。
