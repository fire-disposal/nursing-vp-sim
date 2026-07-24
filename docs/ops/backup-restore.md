# 数据库备份与恢复

> 手动备份、恢复、迁移的完整操作步骤。

## 手动备份

```bash
# 生产库备份
ssh yecaoyun "docker exec nursing-db pg_dump -U nursing -d nursing_vp | gzip > /opt/nursing-vp-sim/backups/prod/prod_\$(date +%Y%m%d-%H%M%S).sql.gz"

# 测试库备份
ssh yecaoyun "docker exec nursing-db-staging pg_dump -U nursing -d nursing_vp | gzip > /opt/nursing-vp-sim/backups/staging/staging_\$(date +%Y%m%d-%H%M%S).sql.gz"
```

## 部署前自动备份

生产部署 (`deploy-production.yml`) 在拉取新镜像前自动执行：
```
pg_dump nursing_vp → backups/pre-deploy-{timestamp}.sql
```
备份成功才继续部署，失败则中止。

## 手动恢复

```bash
# 解压并恢复到生产库（⚠ 会覆盖现有数据）
ssh yecaoyun "gunzip -c /opt/nursing-vp-sim/backups/prod/prod_20260724-030000.sql.gz | docker exec -i nursing-db psql -U nursing -d nursing_vp"

# 恢复到测试库
ssh yecaoyun "gunzip -c /opt/nursing-vp-sim/backups/staging/staging_20260724-030000.sql.gz | docker exec -i nursing-db-staging psql -U nursing -d nursing_vp"
```

**恢复前务必**：确认目标库是否正确，生产库恢复不可逆。

## 自动备份（Crontab）

服务器上已配置的定时备份：

| 环境 | 时间 | 路径 | 保留 |
|------|------|------|------|
| Staging | 每天 03:00 | `backups/staging/` | 30 天 |
| Production | 每天 04:00 | `backups/prod/` | 30 天 |

```bash
# 查看备份文件
ssh yecaoyun "ls -lh /opt/nursing-vp-sim/backups/staging/"
ssh yecaoyun "ls -lh /opt/nursing-vp-sim/backups/prod/"

# 查看备份大小
ssh yecaoyun "du -sh /opt/nursing-vp-sim/backups/"
```

## 跨环境数据同步

将生产数据导入测试环境（用于排查生产问题）：

```bash
# 1. 导出生产库
ssh yecaoyun "docker exec nursing-db pg_dump -U nursing -d nursing_vp --no-owner --no-privileges | gzip > /tmp/prod_sync.sql.gz"

# 2. 清空并恢复到测试库
ssh yecaoyun "gunzip -c /tmp/prod_sync.sql.gz | docker exec -i nursing-db-staging psql -U nursing -d nursing_vp"
```

## 数据库直连

```bash
# 进入 psql
ssh yecaoyun "docker exec -it nursing-db-staging psql -U nursing -d nursing_vp"

# 快速查询示例
ssh yecaoyun "docker exec nursing-db-staging psql -U nursing -d nursing_vp -c '\dt'"
ssh yecaoyun "docker exec nursing-db-staging psql -U nursing -d nursing_vp -c 'SELECT count(*) FROM training_records'"
ssh yecaoyun "docker exec nursing-db-staging psql -U nursing -d nursing_vp -c 'SELECT id, username, role FROM users LIMIT 10'"
```

## 迁移状态

```bash
# 当前迁移版本
ssh yecaoyun "docker exec nursing-backend-staging alembic current"

# 迁移历史
ssh yecaoyun "docker exec nursing-backend-staging alembic history"

# 升级到最新
ssh yecaoyun "docker exec nursing-backend-staging alembic upgrade head"
```
