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

`deploy.yml` 在拉取新镜像前调用版本化脚本（`deploy/pre-deploy-backup.sh`，随部署 scp 到服务器）：

```bash
ssh yecaoyun "cd /opt/nursing-vp-sim && bash deploy/pre-deploy-backup.sh backup"   # 备份 + 裁剪
```

- **三道校验**后才把文件放进正式位置：`pg_dump` 自身退出码（不能只看 gzip 的）→ 非空 → `gzip -t` → 头部是 `PostgreSQL database dump`。任一不过即非零退出，**部署中止**（绝不带着不可回退的状态上车）。
- 产物命名 `backups/pre-deploy-<YYYYmmdd-HHMMSS>.sql.gz`（gzip 明文，约 5× 压缩），完整路径写入 `backups/.last-pre-deploy` 供流水线的回滚提示引用。
- 裁剪失败**不**中止部署（清理是维护动作）；备份失败**一定**中止。

### 保留策略

每次备份后自动裁剪，规则为「任一条命中即保留」：

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

# 历史明文 .sql 压缩成 .sql.gz（先解压核对字节数一致才删原件）
ssh yecaoyun "cd /opt/nursing-vp-sim && bash deploy/pre-deploy-backup.sh transcode --dry-run"
```

### 锚点清单（`backups/.pre-deploy-keep`）

按**基准名**匹配，`.sql` 与 `.sql.gz` 通用。当前锚点 = 单实例合并的分界点
（2026-09-14 把 staging 的 82 MB 真数据集灌进正式栈并退役 staging，见
[`single-instance-migration.md`](single-instance-migration.md)）：

| 锚点 | 是什么 |
|---|---|
| `pre-deploy-20260913-224143` | 合并那次部署（v2026.09.14-1，22:42）的部署前状态 |
| `pre-deploy-20260914-030300` | 合并后首次部署（v2026.09.14-2，03:03）的部署前状态 |

跨结构性变更（库迁移、大版本 schema 重写）时往这个文件里加一行即可；删锚点不可逆。

> 合并期手工导出的 `backups/prod-20260913-222758.dump`（旧 prod，155 KB）与
> `backups/staging-20260913-222758.dump`（staging 数据，16 MB）、以及 `backups/staging/`
> 里的旧周期备份**不是** `pre-deploy-*` 命名，**不在保留策略作用域内** —— 不会被自动删除。

## 备份审计（CI 定时）

`.github/workflows/backup-audit.yml` 每天 09:30 UTC（05:30 EDT，晚于 04:00/04:10 的备份任务）
跑一次 `deploy/backup-audit.sh`，失败即置红并推钉钉。检查项：
定时任务是否还在（crontab 被重写删掉是本机发生过的事故）、各类备份新鲜度、
部署前备份是否存在与锚点条数、体积预算、退役实例冷备是否还在。

```bash
# 本地手动跑一遍（纯只读）
bash deploy/backup-audit.sh yecaoyun
```

## 手动恢复

```bash
# 解压并恢复到生产库（⚠ 会覆盖现有数据）
ssh yecaoyun "gunzip -c /opt/nursing-vp-sim/backups/prod/prod_20260724-030000.sql.gz | docker exec -i nursing-db psql -U nursing -d nursing_vp"

# 推荐：封装脚本（恢复前自动建急救快照 + gzip 完整性校验 + 恢复后验证）
ssh yecaoyun "cd /opt/nursing-vp-sim && bash deploy/db-restore.sh backups/prod/prod_20260724-030000.sql.gz --yes"
```

**恢复前务必**：确认备份文件与目标库正确，生产库恢复不可逆。

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
