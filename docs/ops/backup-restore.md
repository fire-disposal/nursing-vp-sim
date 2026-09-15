# 数据库备份与恢复

> 手动备份、恢复、迁移的完整操作步骤。
> 单实例部署：唯一目标为正式服（容器 `nursing-db`，库 `nursing_vp`）；staging 已于 2026-09-14 退役。

## 手动备份

```bash
# 生产库备份
ssh yecaoyun "docker exec nursing-db pg_dump -U nursing -d nursing_vp | gzip > /opt/nursing-vp-sim/backups/prod/prod_\$(date +%Y%m%d-%H%M%S).sql.gz"

# 推荐：封装脚本（容器检查 + 备份记录 + 过期清理，退出码明确）
ssh yecaoyun "cd /opt/nursing-vp-sim && bash deploy/db-backup.sh prod"
```

## 部署前自动备份（fail-closed）

`deploy.yml` 在拉取新镜像前调用版本化脚本（`deploy/pre-deploy-backup.sh`，随部署 scp 到服务器）。
应用源码始终来自待部署 tag；备份脚本单独从执行本次工作流的不可变 `github.workflow_sha`
稀疏检出到 `.deploy-ops/` 后上传，不从浮动分支获取，也不因历史 tag 缺少脚本而跳过备份。
两次 checkout 后立即检查本地部署输入文件是否存在、可读且非空，并以 `bash -n` 检查待上传的
Shell 脚本；失败会在构建、镜像发布和任何远程写入前中止。远端部署正文明确由 `bash -s` 执行，
不依赖 SSH 用户的默认 zsh。

```bash
ssh yecaoyun "cd /opt/nursing-vp-sim && bash deploy/pre-deploy-backup.sh backup"   # 备份 + 裁剪
```

- 正式发布备份文件前检查：`pg_dump` 与 gzip 的退出码 → 非空 → `gzip -t` → 头部是 `PostgreSQL database dump`。任一不过即非零退出，**部署中止**。这些检查只验证导出过程和文件基本完整性，**不证明可以成功恢复**。
- 产物命名 `backups/pre-deploy-<YYYYmmdd-HHMMSS>.sql.gz`（gzip 明文，约 5× 压缩），完整路径写入 `backups/.last-pre-deploy` 供流水线的回滚提示引用。
- 写入操作持有同一备份维护锁；同秒已有同名 `.sql` 或 `.sql.gz` 时拒绝覆盖。历史明文转码须解压后以 `cmp` 逐字节对比原件，成功后才删除原 `.sql`；已有目标不覆盖。这也不是数据库恢复验证。
- 裁剪失败**不**中止已成功完成备份的部署（清理是维护动作）；备份失败**一定**中止。`.pre-deploy-keep` 缺失或不可读时拒绝裁剪，不自动补清单，也不影响成功备份。

### 保留策略

每次备份成功后尝试自动裁剪，前提是 `backups/.pre-deploy-keep` 存在且可读；满足前提后，规则为「任一条命中即保留」：

| 保留 | 说明 |
|---|---|
| 最新 `KEEP_N=10` 份 | 覆盖最近若干次部署 |
| `backups/.pre-deploy-keep` 里的锚点 | 永不删除，与名次/时间无关 |
| 6 小时内新建 | 防并发部署互踩 |

长周期（30 天）由每 3 天的周期备份 `backups/prod/` 覆盖，所以这里不需要留很多份。

```bash
# 看当前判定（谁留、为什么留）：最左是名次或 keep 原因
ssh yecaoyun "cd /opt/nursing-vp-sim && bash deploy/pre-deploy-backup.sh list"

# 只预览要删什么（严格零写入）
ssh yecaoyun "cd /opt/nursing-vp-sim && bash deploy/pre-deploy-backup.sh prune --dry-run"

# 历史明文 .sql 压缩成 .sql.gz（此处只预览；实际转码逐字节核对后才删原件）
ssh yecaoyun "cd /opt/nursing-vp-sim && bash deploy/pre-deploy-backup.sh transcode --dry-run"
```

### 锚点清单（`backups/.pre-deploy-keep`）

按**基准名**匹配，`.sql` 与 `.sql.gz` 通用；清单解析会去掉 `#` 起始的注释及空白，忽略空行。以下 nursing 锚点是单实例合并期的**部署检查点**，
不是迁移前原始数据的证明（迁移背景见
[`single-instance-migration.md`](single-instance-migration.md)）：

| 锚点 | 是什么 |
|---|---|
| `pre-deploy-20260913-224143` | v2026.09.14-1 的部署检查点；不是合并／迁移前原始数据 |
| `pre-deploy-20260914-030300` | 合并后首次部署（v2026.09.14-2，03:03）的部署前状态 |

跨结构性变更（库迁移、大版本 schema 重写）时往这个文件里加一行即可；移除清单条目会失去锚点保护，之后可能被裁剪。不要用空清单替代缺失清单：nursing 与 twinsia 的已登记锚点仍须逐项保留，只有无必需锚点的 emoguard 允许显式空清单。

> 合并期手工导出的 `backups/prod-20260913-222758.dump`（旧 prod，155 KB）与
> `backups/staging-20260913-222758.dump`（真正的迁移前 staging 数据，16 MB）、以及 `backups/staging/`
> 里的旧周期备份**不是** `pre-deploy-*` 命名，**不在保留策略作用域内** —— 不会被自动删除。
> `staging-20260913-222758.dump` 必须保留，不得删除、转码或覆盖；不要用部署检查点替代它。

## 备份审计（CI 定时）

`.github/workflows/backup-audit.yml` 每天 09:30 UTC（05:30 EDT，晚于 04:00/04:10 的备份任务）
只读运行一次 `deploy/backup-audit.sh`，失败令 CI 置红，通过 Actions 日志查看原因。
备份通知扩展已取消：不发送备份／审计钉钉告警，不提供通知自测；原有部署钉钉通知不变。检查项：
定时任务是否还在（crontab 被重写删掉是本机发生过的事故）、各类备份新鲜度、
三个已接入栈的备份目录与部署前备份是否存在、必需锚点是否仍受保护、体积预算、退役实例冷备概览。

缺少 nursing、twinsia 或 emoguard 的备份目录直接失败。nursing 必需锚点为
`pre-deploy-20260913-224143`、`pre-deploy-20260914-030300`；twinsia 必需锚点为
`pre-deploy-20260914-234844`。审计按确切基准名逐个检查去注释、去空白后的
`.pre-deploy-keep` 条目，以及对应 `.sql` 或 `.sql.gz` 文件是否存在；缺清单、清单不可读、
条目或文件缺失均失败，不能以其他条目凑数。emoguard 允许无锚点，缺失或不可读的清单会警告；
审计不自动生成清单、不写备份文件。存在性检查同样不证明可恢复。

```bash
# 本地手动跑一遍（纯只读）
bash deploy/backup-audit.sh yecaoyun
```

## 手动恢复

```bash
# 周期 prod_* 备份的直接导入示例（会修改目标库；须先人工准备干净目标）
ssh yecaoyun "gunzip -c /opt/nursing-vp-sim/backups/prod/prod_20260724-030000.sql.gz | docker exec -i nursing-db psql -U nursing -d nursing_vp"

# 仅适用周期 prod_* 备份的封装；不是 pre-deploy-* 的恢复入口
ssh yecaoyun "cd /opt/nursing-vp-sim && bash deploy/db-restore.sh backups/prod/prod_20260724-030000.sql.gz --yes"
```

**恢复前务必**：确认备份文件与目标库正确，生产库恢复不可逆。`db-restore.sh` 仅接收周期
`prod_*` 备份，会先清表再导入，且当前 `psql` 未启用 `ON_ERROR_STOP`；不能把脚本结束或
gzip 校验通过当作完整恢复成功的证明，也不能直接用它恢复 `pre-deploy-*`。

`pre-deploy-*.sql.gz` 是压缩的 SQL 文本，须先解压，使用与导出时同大版本的 PostgreSQL
工具导入人工预先准备的干净目标库，并以遇错即停方式执行、独立核验恢复结果。
各栈均在自己的数据库容器内运行 `pg_dump`（现场版本：nursing 15.19、twinsia 17.11、
emoguard 15.19），不跨大版本借用导出工具。部署回滚仅回滚应用，**不会自动回滚数据库**；
这里的文件与转码校验不替代恢复演练。

## 自动备份（Crontab）

服务器上已配置的定时备份（crontab: `0 4 */3 * *`）：

| 目标 | 时间 | 路径 | 保留 |
|------|------|------|------|
| Production | 每 3 天 04:00 | `backups/prod/` | 30 天 |

```bash
# 查看备份文件
ssh yecaoyun "ls -lh /opt/nursing-vp-sim/backups/prod/"

# 查看备份大小
ssh yecaoyun "du -sh /opt/nursing-vp-sim/backups/"
```

## 数据库直连

```bash
# 进入 psql
ssh yecaoyun "docker exec -it nursing-db psql -U nursing -d nursing_vp"

# 快速查询示例
ssh yecaoyun "docker exec nursing-db psql -U nursing -d nursing_vp -c '\dt'"
ssh yecaoyun "docker exec nursing-db psql -U nursing -d nursing_vp -c 'SELECT count(*) FROM training_records'"
ssh yecaoyun "docker exec nursing-db psql -U nursing -d nursing_vp -c 'SELECT id, username, role FROM users LIMIT 10'"
```

## 迁移状态

```bash
# 当前迁移版本
ssh yecaoyun "docker exec nursing-vp-sim-backend-1 alembic current"

# 迁移历史
ssh yecaoyun "docker exec nursing-vp-sim-backend-1 alembic history"

# 升级到最新
ssh yecaoyun "docker exec nursing-vp-sim-backend-1 alembic upgrade head"
```
