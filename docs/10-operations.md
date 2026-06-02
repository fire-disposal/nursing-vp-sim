# 10 — 运维安全指南

> 适用版本: v2026.05.31 | 最后更新: 2026-06-02

面向生产环境运维人员的操作手册，涵盖部署流程、回滚、备份、安全加固要点。

---

## CD 部署流程

### 两个流水线

| Workflow | 触发方式 | 目标 | 域名 |
|----------|---------|------|------|
| `staging.yml` | 推送 `v*` tag（自动） | 测试服 | `test.205716.xyz` |
| `cd.yml` | `workflow_dispatch`（手动） | 正式服 | `iomt.205716.xyz` |
| `rollback.yml` | `workflow_dispatch`（手动） | 回滚 | — |

### 日常发布流程

```
npm run tag → v2026.06.02-N
    │
    ▼ staging.yml 自动触发
  构建镜像 → 部署到测试服（60s）
    │
    ▼ 你验证通过
  Actions → Deploy to Production
  输入: 2026.06.02-N
    │
    ▼ cd.yml
  检查: staging 正跑着同一版本吗？
    ├─ ✗ 不匹配 → 拒绝（必须先经过测试服）
    └─ ✓ 匹配 → 备份DB → 拉镜像 → 部署 → 健康检查
                  ├─ healthy  → 完成
                  └─ unhealthy → 自动回滚旧版本
```

### 部署前检查清单

- [ ] `SECRET_KEY` 已设置为 ≥32 字符随机字符串（cd.yml 自动生成 `openssl rand -hex 32`，64 字符）
- [ ] `CORS_ORIGINS` 已改为实际生产域名（默认模板为 `http://localhost`）
- [ ] `DEEPSEEK_API_KEY` 已填入有效的 API Key
- [ ] `POSTGRES_PASSWORD` 不为默认值（cd.yml 自动生成 `openssl rand -hex 16`）
- [ ] 服务器上 `/opt/nursing-vp-sim/.env` 已编辑非模板值

### 首次部署

首次部署时 cd.yml 自动执行：

1. `sudo mkdir -p /opt/nursing-vp-sim/backups`
2. 生成 `.env` 模板（含随机 `SECRET_KEY` 和 `POSTGRES_PASSWORD`）
3. 生成 `docker-compose.yml`
4. 拉取镜像并启动

**首次部署后必须手动编辑 `.env`：**
- `DEEPSEEK_API_KEY=sk-xxx`（替换占位符）
- `CORS_ORIGINS=https://你的域名`（替换 `http://localhost`）

### Staging 测试服

独立于生产的数据和端口，但共用同一台服务器：

| 项目 | 生产 | Staging |
|------|------|---------|
| 目录 | `/opt/nursing-vp-sim/` | `/opt/nursing-vp-staging/` |
| Compose | `docker-compose.yml` | `docker-compose.staging.yml` |
| 前端端口 | 9000 | 9080 |
| 后端端口 | 9001 | 9081 |
| DB 端口 | 5433 | 5434 |
| DB 卷 | `ai_vp_pg_data` | `nursing_staging_pg_data` |

手动部署（当 CD 不可用时）：
```bash
cd /opt/nursing-vp-staging
IMAGE_VERSION=2026.06.02-4 docker compose -f docker-compose.staging.yml --env-file .env up -d
```

清理重建（数据库重置）：
```bash
docker compose -f docker-compose.staging.yml --env-file .env down -v
IMAGE_VERSION=2026.06.02-4 docker compose -f docker-compose.staging.yml --env-file .env up -d
```

---

## 紧急回滚

### 方式一：SSH 交互式（推荐）

```bash
ssh 用户名@服务器IP "cd /opt/nursing-vp-sim && bash rollback.sh"
```

交互流程：

```
  可用部署历史 (最近 5 次):
  ┌──────────────────────────────────────────────────────────┐
  │ [1] v1.2.3      2026-06-02T14:30:00Z   ← 当前
  │ [2] v1.2.2      2026-06-01T10:00:00Z
  │ [3] v1.2.1      2026-05-30T09:15:00Z
  └──────────────────────────────────────────────────────────┘

  请选择要回滚的版本 [1-3] (q 退出): 2

  将回滚到:
    版本:   v1.2.2
    后端:   ghcr.io/xxx/nursing-vp-sim-backend:v1.2.2
    前端:   ghcr.io/xxx/nursing-vp-sim-frontend:v1.2.2

  确认回滚? (y/n): y

  >> 拉取镜像...
  >> 更新 compose 配置...
  >> 重启服务...
  >> 回滚完成，服务已恢复至 v1.2.2
```

非交互参数：

```bash
# 直接回滚到指定版本，跳过确认
bash rollback.sh --yes v1.2.2

# 仅列出版本历史
bash rollback.sh --list
```

### 方式二：GitHub Actions

1. 打开仓库 Actions 页面
2. 选择 **Emergency Rollback**
3. 点击 "Run workflow"
4. 输入目标版本号（如 `1.2.2`）
5. 点击 "Run workflow" 执行

### 版本历史文件

服务器上 `/opt/nursing-vp-sim/.version-history`，格式为：

```
2026.06.02-3|2026-06-02T14:30:00Z|ghcr.io/owner/nursing-vp-sim-backend:v1.2.3|ghcr.io/owner/nursing-vp-sim-frontend:v1.2.3
```

每次成功部署追加一行，保留最近 5 次记录。手动维护：

```bash
# 查看历史
cat /opt/nursing-vp-sim/.version-history

# 清空重置
rm /opt/nursing-vp-sim/.version-history
```

---

## 日常运维

### 基础命令

```bash
# 服务状态
cd /opt/nursing-vp-sim && docker compose ps

# 查看日志
docker logs nursing-vp-sim-backend-1 --tail 100
docker logs nursing-vp-sim-frontend-1 --tail 100
docker logs nursing-db --tail 50

# 重启服务
docker compose restart

# 停止/启动
docker compose down
docker compose up -d
```

### 数据库管理

#### 数据卷与持久化

PostgreSQL 数据存储在 Docker 命名卷 `ai_vp_pg_data` 中，位于宿主机 `/var/lib/docker/volumes/` 下。容器删除重建后数据保留。

```bash
# 查看卷信息
docker volume inspect nursing-vp-sim_ai_vp_pg_data

# 检查磁盘占用
docker system df -v | grep ai_vp_pg_data
```

#### 连接信息

| 项目 | 值 |
|------|-----|
| 容器名 | `nursing-db` |
| 用户/数据库 | `nursing / nursing_vp` |
| 宿主机端口 | `127.0.0.1:5433` |
| 容器内端口 | `5432` |
| 密码来源 | `.env` 中 `POSTGRES_PASSWORD` |

```bash
# 从宿主机直连
docker exec -it nursing-db psql -U nursing -d nursing_vp

# 从宿主机端口连接（需 psql 客户端）
psql -h 127.0.0.1 -p 5433 -U nursing -d nursing_vp
```

#### 备份与恢复

**备份（SQL 转储）**

```bash
cd /opt/nursing-vp-sim
docker exec nursing-db pg_dump -U nursing -d nursing_vp > "backups/backup-$(date +%Y%m%d-%H%M%S).sql"

# 备份到远程（拉回本地）
rsync -avz 用户名@服务器:/opt/nursing-vp-sim/backups/ ./local-backups/
```

CD 流水线每次部署前也会自动执行备份，存放在 `backups/pre-deploy-*.sql`。

**恢复**

```bash
# 前提：目标数据库为空。如果已有数据，先清空
docker exec -i nursing-db psql -U nursing -d nursing_vp < backups/backup-20260602-143000.sql
```

**通过教师后台触发**

登录 → 管理后台 → 数据库备份（完整 admin.py:168）。

#### 迁移机制

后端启动时自动执行 Alembic 迁移（`main.py` 启动事件）。Schema 变更通过代码中的模型定义自动同步，无需手动运行迁移命令。

```bash
# 查看当前迁移版本
docker exec nursing-vp-sim-backend-1 bash -c "cd /app && alembic current"

# 手动生成迁移（开发时在本地执行）
cd backend && uv run alembic revision --autogenerate -m "描述"
cd backend && uv run alembic upgrade head
```

#### 常用诊断命令

```sql
-- 进入 psql
docker exec -it nursing-db psql -U nursing -d nursing_vp

-- 查看所有表
\dt

-- 各表行数
SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC;

-- 数据库大小
SELECT pg_size_pretty(pg_database_size('nursing_vp'));

-- 表大小排名
SELECT tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))
FROM pg_tables WHERE schemaname='public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- 当前连接
SELECT pid, usename, application_name, state FROM pg_stat_activity WHERE datname='nursing_vp';
```

#### 数据库重置（危险）

```bash
cd /opt/nursing-vp-sim
docker compose down -v   # 删除数据卷（含所有数据）
docker compose up -d      # 重新创建 → 触发 seed 数据 → 默认账号恢复
```

### 健康检查

```bash
# 后端 API
curl -s http://localhost:8000/api/health

# 通过 Docker healthcheck
docker inspect --format='{{.State.Health.Status}}' nursing-vp-sim-backend-1
```

---

## 安全加固要点

以下摘自安全审计报告，按优先级排列。

### 部署必做

| 事项 | 操作 |
|------|------|
| SECRET_KEY | 确保 ≥32 字符。cd.yml 自动生成强密钥，勿手动替换为弱密钥 |
| CORS_ORIGINS | 改为精确的生产域名，不要用 `*` |
| 禁用种子数据 | 生产环境设置 `ENV=production`（plan）或确保首次部署后不再重建空 DB |
| PostgreSQL 密码 | cd.yml 自动生成随机密码，不使用默认 `postgres` |

### 建议加固

| 事项 | 说明 | 影响 |
|------|------|------|
| 固定 SSH host key | 将服务器指纹存入 GitHub Secret，替换 `ssh-keyscan` TOFU 模式 | 防 MITM |
| 启用 SLSA 溯源 | cd.yml 中 `provenance: false` → `provenance: true` | 供应链安全 |
| 测试数据库端口绑定 | `docker-compose.test.yml` 端口改为 `127.0.0.1:5432:5432` | 防局域网暴露 |
| 备份端点环境隔离 | 缩小 `pg_dump` 子进程的环境变量传递 | 防密钥泄露 |

### GitHub Secrets 清单

| Secret | 用途 | 是否自动注入 .env |
|--------|------|-------------------|
| `GH_TOKEN` | GHCR 登录（默认可用 `GITHUB_TOKEN`） | 否 |
| `SSH_HOST` | 部署目标服务器 IP/域名 | — |
| `SSH_USER` | SSH 用户名 | — |
| `SSH_PRIVATE_KEY` | SSH 私钥 | — |
| `DEEPSEEK_API_KEY` | LLM API Key | 是（写入 `.env`） |

---

## 监控要点

### 关键指标

| 指标 | 检查方式 | 正常阈值 |
|------|----------|----------|
| 后端健康 | `curl /api/health` | 200 OK |
| 数据库连接 | `docker exec nursing-db pg_isready -U nursing` | accepting connections |
| 磁盘空间 | `df -h /opt` | < 80% |
| 备份完整性 | `ls -la /opt/nursing-vp-sim/backups/` | 有最近文件 |
| Docker 日志错误 | `docker logs nursing-vp-sim-backend-1 --tail 50 \| grep -i error` | 无 |

### 告警场景

| 场景 | 现象 | 处理 |
|------|------|------|
| 服务不可用 | 健康检查返回非 200 | 检查日志 → 重启 → 回滚 |
| 数据库满 | pg_dump 失败 | 清理旧备份 → 扩容 |
| LLM API 异常 | 学生端对话无响应 | 检查 API Key 余额 → 切换 Provider |
| 磁盘满 | Docker pull 失败 | `docker image prune -a` |
