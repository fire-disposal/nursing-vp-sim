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

`deploy.yml` 在拉取新镜像前通过**宿主备份层**做部署前备份，远端执行：

```bash
( cd /opt/server-ops && /usr/bin/python3 backup/cli.py run nursing-predeploy --kind pre-deploy --notify )
```

CLI 按 `datasets.toml` 的 `nursing-predeploy` 声明执行 `bash deploy/pre-deploy-backup.sh backup`
（`cwd=/opt/nursing-vp-sim`）、**代记**账本（子进程收到 `BK_RECORD=0`，脚本自身行为不变），
并跑声明的 `verify`（`gzip -t`）；任一环节非零即中止部署——远端正文是 `set -e`，fail-closed
语义与迁移前一致，只是入口收敛到宿主一处。子 shell 的 `cd` 不会改变部署正文自身的工作目录。
宿主备份层缺失（`/opt/server-ops/backup/cli.py` 不存在）是**显式失败**：远端打印
`::error::` 并 `exit 1`，提示「请先在 yecaoyun 执行 `bash ops.sh sync` 再发布」，不静默跳过备份。

应用源码始终来自待部署 tag；备份脚本单独从执行本次工作流的不可变 `github.workflow_sha`
稀疏检出到 `.deploy-ops/` 后上传，不从浮动分支获取，也不因历史 tag 缺少脚本而跳过备份。
两次 checkout 后立即检查本地部署输入文件是否存在、可读且非空，并以 `bash -n` 检查待上传的
Shell 脚本；失败会在构建、镜像发布和任何远程写入前中止。远端部署正文明确由 `bash -s` 执行，
不依赖 SSH 用户的默认 zsh。

手动重跑同一个脚本（直接调脚本、不经宿主 CLI，因此不写宿主账本）：

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

长周期（30 天）由**每日**的周期备份 `backups/prod/` 覆盖（30 份 × ~2.6MB ≈ 80MB），所以这里不需要留很多份。

**周期备份的内容口径（2026-09-25 起）**：`pg_dump --exclude-table-data=public.llm_call_logs`
—— 排除 LLM 调用日志的**行数据**、保留建表语句（恢复后该表存在但为空，不会 schema 漂移）。
原因：该表占未压缩 dump 的约 81%（实测 70.2MB / 86.3MB），是分析性日志、恢复价值低；
业务数据（训练记录/评分/消息/图片/情绪事件）合计约 14MB，压缩后 ~2.6MB。
需要日志时按需单独导出：`docker exec nursing-db pg_dump -U nursing -d nursing_vp --no-owner -t llm_call_logs | gzip > /tmp/logs.sql.gz`。

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
**宿主 canonical 审计**、各栈备份日志末行、三个已接入栈的备份目录与部署前备份是否存在、
必需锚点是否仍受保护、体积预算、退役实例冷备概览。

其中「定时任务是否还在」一节**已改为转发宿主审计**（原为
`crontab -l | grep 'db-backup.sh prod'` 之类的断言）：远端直接执行

```bash
cd /opt/server-ops && /usr/bin/python3 backup/cli.py audit
```

新鲜度／完整性／配平／未记账产物／预算以宿主 `datasets.toml` 的数据集声明为唯一判据，非零即
CI 失败，未通过时原样透出该审计的输出；**不带** `--notify`——宿主每日 09:15 已用自己的审计
负责通知（受静音约束），CI 这里只需要置红。原 crontab 断言删除的原因：周期备份自 2026-09-21
起由宿主 `cli run` 统一执行并代记账本，项目自装的周期 cron 全部退役、crontab 里只剩退役注释，
继续 grep 只会在「命中退役注释而假通过」和「注释清掉后假报警」之间摇摆。

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
ssh yecaoyun "gunzip -c /opt/nursing-vp-sim/backups/prod/prod_20260724-030000.sql.gz | docker exec -i nursing-db psql -U nursing -d nursing_vp -v ON_ERROR_STOP=1"

# 封装脚本：接受周期 prod_* 与发布前 pre-deploy-*
ssh yecaoyun "cd /opt/nursing-vp-sim && bash deploy/db-restore.sh backups/prod/prod_20260724-030000.sql.gz --yes"
ssh yecaoyun "cd /opt/nursing-vp-sim && bash deploy/db-restore.sh backups/pre-deploy-20260914-030300.sql.gz --yes"
```

**恢复前务必**：确认备份文件与目标库正确，生产库恢复不可逆。`db-restore.sh` 接受周期
`prod_*` **和**发布前 `pre-deploy-*`（`nursing-predeploy` 的产物；2026-09-21 起），一律先清表
再导入，并已启用 `-v ON_ERROR_STOP=1`：任一条 SQL 失败即中止并以 3 退出。此前 psql 默认「遇错
继续」——部分失败的恢复会被当成成功，这是本脚本修掉的一个真实缺陷。即便如此，脚本末尾的
`SELECT 1` 只证明连接可用，不能把脚本结束或 gzip 校验通过当作完整恢复成功的证明。

不经封装脚本手工导入 `pre-deploy-*.sql.gz` 时，同样须先解压，使用与导出时同大版本的
PostgreSQL 工具导入人工预先准备的干净目标库，并显式加上 `-v ON_ERROR_STOP=1` 后独立核验结果。
各栈均在自己的数据库容器内运行 `pg_dump`（现场版本：nursing 15.19、twinsia 17.11、
emoguard 15.19），不跨大版本借用导出工具。部署回滚仅回滚应用，**不会自动回滚数据库**；
这里的文件与转码校验不替代恢复演练。

## 自动备份（宿主 Crontab）

2026-09-21 起周期备份不再由项目自装 cron 触发，而由宿主 `/opt/server-ops` 的**受管 crontab**
执行 `cli run`（受管区块由 `ops.sh sync` 安装；手改 crontab 会在下次 sync 被覆盖，且 `doctor`
会报漂移）。nursing 相关行：

| 目标 | 时间 | 宿主 crontab 命令 | 数据集 → 路径 | 保留 |
|------|------|------|------|------|
| Production DB（周期） | 每日 04:00 | `cd /opt/server-ops && /usr/bin/python3 backup/cli.py run nursing-db --notify` | `nursing-db` → `backups/prod/`（`prod_*.sql.gz`） | 30 天（不含 `llm_call_logs` 行数据） |
| 备份审计 | 每日 09:15 | `cd /opt/server-ops && /usr/bin/python3 backup/cli.py audit --notify` | 全部数据集（新鲜度/完整性/配平/未记账/预算） | — |

部署前快照（`nursing-predeploy`，`backups/pre-deploy-*.sql.gz`）**不在这张表里**：它由部署
流程触发（见上文「部署前自动备份」），保留由脚本 `KEEP_N=10` + `.pre-deploy-keep` 锚点自管。
CLI 代记 `backup/events.jsonl` 账本，产物可追溯到来源、哈希与 `.meta.json`；项目自装的
nursing/emoguard/twinsia 周期 cron 与 `[S2]` 退役注释同批清退（旧脚本只读保留 7 天）。

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
