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

## 部署前自动备份

`deploy.yml` 在拉取新镜像前自动执行：
```
docker exec nursing-db pg_dump -U nursing -d nursing_vp > backups/pre-deploy-{timestamp}.sql
```
备份成功才继续部署，失败即停（fail-closed）。

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
