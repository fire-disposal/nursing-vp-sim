# 09 — 运维安全指南

> 适用版本: v2026.06.22-16 | 最后更新: 2026-06-22

面对生产环境运维人员的操作手册，涵盖部署流程、回滚、备份、安全加固要点、应急预案。

---

## CD 部署流程

### 两个流水线

| Workflow | 触发方式 | 目标 | 域名 |
|----------|---------|------|------|
| `deploy-pr-staging.yml` | PR 合并到 master（自动） | 自动打 date tag → 触发 staging | — |
| `deploy-staging.yml` | 推送 `v*` tag（自动） | 测试服 | `test.205716.xyz` |
| `deploy-production.yml` | `workflow_dispatch`（手动） | 正式服 | `iomt.205716.xyz` |
| `rollback-production.yml` | `workflow_dispatch`（手动） | 回滚 | — |

### 日常发布流程

```
pnpm run tag → v2026.06.02-N
    │
    ▼ deploy-staging.yml 自动触发
  构建镜像 → 部署到测试服（60s）
    │
    ▼ 你验证通过
  Actions → Deploy to Production
  输入: 2026.06.02-N
    │
    ▼ deploy-production.yml
  检查: staging 正跑着同一版本吗？
    ├─ ✗ 不匹配 → 拒绝（必须先经过测试服）
    └─ ✓ 匹配 → 备份DB → 拉镜像 → 部署 → 健康检查
                  ├─ healthy  → 完成
                  └─ unhealthy → 自动回滚旧版本
```

### 部署前检查清单

- [ ] `JWT_SECRET_KEY` 已手动设置为 ≥32 字符随机字符串（deploy-production.yml **不**自动生成，须手动写入 `.env`；可用 `python -c "import secrets; print(secrets.token_urlsafe(32))"` 生成）
- [ ] `CORS_ORIGINS` 已改为实际生产域名（默认模板为 `http://localhost`）
- [ ] `DEEPSEEK_API_KEY` 已填入有效的 API Key
- [ ] `POSTGRES_PASSWORD` 不为默认值（deploy-production.yml 自动生成 `openssl rand -hex 16`）
- [ ] 服务器上 `/opt/nursing-vp-sim/.env` 已编辑非模板值

### 首次部署

首次部署时 deploy-production.yml 自动执行：

1. `sudo mkdir -p /opt/nursing-vp-sim/backups`
2. 生成 `.env` 模板（含随机 `POSTGRES_PASSWORD`；`JWT_SECRET_KEY` / `FERNET_KEY` 不自动生成，须手动写入）
3. 生成 `docker-compose.yml`
4. 拉取镜像并启动

**首次部署后必须手动编辑 `.env`：**
- `DEEPSEEK_API_KEY=sk-xxx`（替换占位符）
- `CORS_ORIGINS=https://你的域名`（替换 `http://localhost`）

### Staging 测试服

独立于生产的数据和端口，但共用同一台服务器：

| 项目 | 生产 | Staging |
|------|------|---------|
| 目录 | `/opt/nursing-vp-sim/` | `/opt/nursing-vp-sim/`（共目录，compose 文件用 `-f docker-compose.staging.yml -p nursing-vp-staging` 隔离） |
| Compose (来源) | `deploy/docker-compose.prod.yml` | `deploy/docker-compose.staging.yml` |
| 前端端口 | 9000 | 9080 |
| 后端端口 | 9001 | 9081 |
| DB 端口 | 5433 | 5434 |
| DB 卷 | `ai_vp_pg_data` | `nursing_staging_pg_data` |

手动部署（当 CD 不可用时）：
```bash
cd /opt/nursing-vp-sim
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
  │ [1] v2026.06.02-3      2026-06-02T14:30:00Z   ← 当前
  │ [2] v2026.06.02-2      2026-06-01T10:00:00Z
  │ [3] v2026.06.02-1      2026-05-30T09:15:00Z
  └──────────────────────────────────────────────────────────┘

  请选择要回滚的版本 [1-3] (q 退出): 2

  将回滚到:
    版本:   v2026.06.02-2
    后端:   ghcr.io/xxx/nursing-vp-sim-backend:v2026.06.02-2
    前端:   ghcr.io/xxx/nursing-vp-sim-frontend:v2026.06.02-2

  确认回滚? (y/n): y

  >> 拉取镜像...
  >> 更新 compose 配置...
  >> 重启服务...
  >> 回滚完成，服务已恢复至 v2026.06.02-2
```

非交互参数：

```bash
# 直接回滚到指定版本，跳过确认
bash rollback.sh --yes 2026.06.02-2

# 仅列出版本历史
bash rollback.sh --list
```

### 方式二：GitHub Actions

1. 打开仓库 Actions 页面
2. 选择 **Emergency Rollback**
3. 点击 "Run workflow"
4. 输入目标版本号（如 `2026.06.02-2`）
5. 点击 "Run workflow" 执行

### 版本历史文件

服务器上 `/opt/nursing-vp-sim/.version-history`，字段格式（`|` 分隔）：

```
2026.06.02-3|2026-06-02T14:30:00Z|ghcr.io/owner/nursing-vp-sim-backend:...|ghcr.io/owner/nursing-vp-sim-frontend:...|abc123def
```

字段含义：`版本号 | 部署时间 | 后端镜像 | 前端镜像 | alembic revision`（第 5 字段为可选，用于精确多版本回滚）

每次成功部署追加一行，保留最近 10 次记录。

```bash
# 查看历史
cat /opt/nursing-vp-sim/.version-history

# 清空重置
rm /opt/nursing-vp-sim/.version-history
```

---

## 日常运维

### 环境参数速查

| 项目 | 生产 (iomt) | Staging (test) |
|------|-------------|----------------|
| 工作目录 | `/opt/nursing-vp-sim` | `/opt/nursing-vp-sim`（compose `-p nursing-vp-staging` 隔离） |
| Compose 文件 | `docker-compose.prod.yml` | `docker-compose.staging.yml` |
| 后端端口 | 9001 | 9081 |
| 前端端口 | 9000 | 9080 |
| DB 端口 | 5433 | 5434 |
| DB 容器名 | `nursing-db` | `nursing-db-staging` |
| 后端容器名 | `nursing-vp-sim-backend-1` | `nursing-backend-staging` |
| 前端容器名 | `nursing-vp-sim-frontend-1` | `nursing-frontend-staging` |
| DB 用户/库 | `nursing / nursing_vp` | 同 |
| DB 密码 | `.env` → `POSTGRES_PASSWORD` | 同 |
| 健康检查 | `curl localhost:9001/api/health` | `curl localhost:9081/api/health` |

### 常用命令（以 prod 为例，替换参数即可用于 staging）

```bash
# 服务状态
cd /opt/nursing-vp-sim && docker compose ps

# 查看日志
docker logs nursing-vp-sim-backend-1 --tail 100
docker logs nursing-db --tail 50

# 重启 / 停止 / 启动
docker compose restart
docker compose down
docker compose up -d

# 数据库: 进入 psql / 备份 / 恢复
docker exec -it nursing-db psql -U nursing -d nursing_vp

# 封装脚本（位于仓库 deploy/，手动部署到服务器或从 checkout 执行）
ssh yecaoyun "cd /opt/nursing-vp-sim && bash deploy/db-backup.sh staging"
ssh yecaoyun "cd /opt/nursing-vp-sim && bash deploy/db-backup.sh prod"
ssh yecaoyun "cd /opt/nursing-vp-sim && bash deploy/db-restore.sh backups/prod/prod_*.sql.gz --yes"

# 自动备份: crontab 每 3 天 (staging 03:00 / prod 04:00)
# 备份路径: backups/{staging,prod}/，保留 30 天

# 迁移版本
docker exec nursing-vp-sim-backend-1 bash -c "cd /app && alembic current"

# 健康检查
curl -s http://localhost:9001/api/health
docker inspect --format='{{.State.Health.Status}}' nursing-vp-sim-backend-1

# 数据卷
docker volume inspect nursing-vp-sim_ai_vp_pg_data

# 数据库重置（危险 — 清空所有数据）
cd /opt/nursing-vp-sim && docker compose down -v && docker compose up -d
```

### 常用诊断 SQL

```sql
\dt
SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC;
SELECT pg_size_pretty(pg_database_size('nursing_vp'));
SELECT tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))
  FROM pg_tables WHERE schemaname='public'
  ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
SELECT pid, usename, application_name, state FROM pg_stat_activity WHERE datname='nursing_vp';
```

### 迁移规范

后端启动时自动执行 Alembic 迁移。pre-commit hook（`check-migration-autogen.js`）强制：
- autogenerate 文件不含 `op.execute()`
- 数据迁移须标注 `# Manual override reason: data_only`
- 空迁移不允许提交

手动命令：`cd backend && uv run alembic revision --autogenerate -m "描述"`

---

## 安全加固要点

以下摘自安全审计报告，按优先级排列。

### 部署必做

| 事项 | 操作 |
|------|------|
| JWT_SECRET_KEY | 须手动写入 `.env`，确保 ≥32 字符随机串。deploy-production.yml **不**自动生成 |
| CORS_ORIGINS | 改为精确的生产域名，不要用 `*` |
| 禁用种子数据 | 生产环境设置 `ENV=production`（plan）或确保首次部署后不再重建空 DB |
| PostgreSQL 密码 | deploy-production.yml 自动生成随机密码，不使用默认 `postgres` |

### 建议加固

| 事项 | 说明 | 影响 |
|------|------|------|
| 固定 SSH host key | 将服务器指纹存入 GitHub Secret，替换 `ssh-keyscan` TOFU 模式 | 防 MITM |
| 启用 SLSA 溯源 | deploy-production.yml 中 `provenance: false` → `provenance: true` | 供应链安全 |
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

## P0 应急预案

### 系统完全不可访问 (HTTP 5xx / 连接超时)

**可能原因**: Docker 容器崩溃 / 宿主机资源耗尽 / Nginx 异常 / 磁盘满

**诊断步骤**:
```bash
ssh user@<server_ip>
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
free -h && df -h && docker stats --no-stream
# 生产
docker logs nursing-vp-sim-backend-1 --tail 50
docker logs nursing-vp-sim-frontend-1 --tail 50
docker logs nursing-db --tail 50
# Staging
docker logs nursing-backend-staging --tail 50
docker logs nursing-frontend-staging --tail 50
docker logs nursing-db-staging --tail 50
```

**应急措施**:
```bash
# 方案 A: 重启所有服务
cd /opt/nursing-vp-sim
docker compose -f docker-compose.yml up -d --force-recreate

# Staging
cd /opt/nursing-vp-sim
docker compose -f docker-compose.staging.yml --env-file .env -p nursing-vp-staging up -d --force-recreate

# 方案 B: 仅重启后端
docker restart nursing-vp-sim-backend-1

# 方案 C: 回滚到最近的稳定版本
cat .version-history
bash rollback.sh --yes <上一个版本号>
```

**恢复验证**: `curl -f http://localhost:9001/api/health`

---

### LLM API 不可用 (DeepSeek 服务中断 / Key 失效 / 余额耗尽)

**症状**: 聊天返回兜底回复、评分任务全部失败、`/api/health` 返回 `llm: "unavailable"`

**诊断步骤**:
```bash
curl -I https://api.deepseek.com/v1/models
docker logs nursing-vp-sim-backend-1 2>&1 | grep -i "deepseek\|llm\|401\|429\|403"
```

**应急措施**:
1. 确认 `DEEPSEEK_API_KEY` 未过期且有余额
2. 登录管理面板 → API 管理 → 检查密钥状态 (是否 degraded)
3. 管理面板中将被熔断标记的密钥恢复为 active
4. 备用方案：在管理面板添加新 API Key 并激活
5. 如果完全不可恢复，系统自动使用环境变量兜底

**影响范围**: 学生训练对话返回兜底回复、自动评分全部失败需手动评分、问答模块返回兜底回复

---

### 数据库宕机 / 连接拒绝

**症状**: 所有 API 返回 500、容器日志大量 `sqlalchemy.exc.OperationalError`

**应急措施**:
```bash
docker restart nursing-db
sleep 10 && docker restart nursing-vp-sim-backend-1
```

**数据恢复** (如重启无效):
```bash
ls /opt/nursing-vp-sim/backups/prod/
gunzip -c /opt/nursing-vp-sim/backups/prod/prod_<date>.sql.gz | \
  docker exec -i nursing-db psql -U nursing -d nursing_vp
```

---

### 磁盘空间耗尽

**影响**: 数据库无法写入 → 系统不可用; Docker 日志爆炸

**诊断**:
```bash
df -h
du -sh /var/lib/docker/containers/*/
```

**应急措施**:
```bash
docker system prune -af --filter "until=48h"
# 清理旧日志 (保留3天)
truncate -s 0 $(docker inspect --format='{{.LogPath}}' nursing-vp-sim-backend-1)
# 考虑清理 llm_call_logs 历史数据 (>30天)
docker exec nursing-db psql -U nursing -d nursing_vp -c \
  "DELETE FROM llm_call_logs WHERE created_at < NOW() - INTERVAL '30 days';"
```

---

### HTTPS 证书过期

**诊断**:
```bash
echo | openssl s_client -servername iomt.205716.xyz -connect iomt.205716.xyz:443 2>/dev/null | \
  openssl x509 -noout -dates
```

**应急措施**:
```bash
sudo certbot renew --force-renewal
sudo nginx -s reload
```

---

---

### 内存逐渐耗尽 (Rate Limiter 泄漏)

**症状**: 服务器内存持续增长, OOM Killer 杀掉容器

**注意**: `cleanup()` 方法已在 `_rate_limiter_cleanup` 任务中每 600 秒调用

**监控**: `docker stats --no-stream nursing-vp-sim-backend-1`（如果后端内存超过 500MB 持续增长则重启）

---

## 已知薄弱点

| # | 薄弱点 | 风险 | 分类 | 应对 |
|---|--------|------|------|------|
| 2 | **Docker 容器无资源限制** | 任一容器可耗尽宿主机资源 | 🔧 可修复 | 添加 `deploy.resources.limits` |
| 3 | **无 Nginx 级速率限制** | 仅 Python 层 `rate_limits.py`（按 user_id），大流量 DDoS 可消耗 FastAPI 资源 | 🏛️ 已充分 | Python 层覆盖高危端点；当前流量低无需 nginx 层 |
| 4 | **JWT Token 无主动撤销机制** | 角色变更后旧 token 仍有效（最长 8h） | 🏛️ 固有约束 | 紧急改 JWT_SECRET_KEY 全局失效 |
| 5 | **Token 存储在 localStorage** | XSS 可窃取 | 🏛️ 固有约束 | CSP + React XSS 防护；长期向 HttpOnly Cookie |
| 7 | **LLM 环境变量兜底无限额** | 所有 DB 密钥失效后回退 `.env` key | ⚠️ 已缓解 | DeepSeek 控制台已设硬限额 |

---

## 监控体系

### 监控脚本

位于仓库 `deploy/monitor/`，部署到 `/opt/monitor/`，由 crontab 驱动。

| 脚本 | 频率 | 用途 |
|------|------|------|
| `monitor.py` | `*/15 * * * *` | 系统监控：Docker 容器状态、磁盘/CPU/内存、HTTP 端点健康、异常告警邮件 |
| `daily_report.py` | `0 9 * * *` | 每日运维报告：调用 `/api/ops/report` 汇总两环境数据，HTML 邮件 |
| `weekly_report.py` | `0 9 * * 1` | 周报：赛博朋克主题 HTML 邮件，含容器/资源/告警汇总 |

**配置方式：** 所有 SMTP 和端口配置通过环境变量读取（不再使用 `config.py`），从 `/opt/nursing-vp-sim/.env` 中读取：

```bash
SMTP_HOST=smtp.qq.com
SMTP_PORT=587
SMTP_USER=your-email@qq.com
SMTP_PASS=your-authorization-code
MAIL_FROM=your-email@qq.com
MAIL_TO=your-email@qq.com
# 可选：DISK_THRESHOLD_PCT=85 CPU_LOAD_MULTIPLIER=1.5 MEM_MIN_MB=500
```

**Crontab 参考：**
```
*/15 * * * * cd /opt/monitor && /usr/bin/python3 monitor.py >> /opt/monitor/cron.log 2>&1
0 9 * * 1 cd /opt/monitor && /usr/bin/python3 weekly_report.py >> /opt/monitor/cron.log 2>&1
0 9 * * * cd /opt/monitor && /usr/bin/python3 daily_report.py >> /opt/monitor/cron.log 2>&1
0 3 */3 * * cd /opt/nursing-vp-sim && bash deploy/db-backup.sh staging >> /var/log/db-backup.log 2>&1
0 4 */3 * * cd /opt/nursing-vp-sim && bash deploy/db-backup.sh prod >> /var/log/db-backup.log 2>&1
```

### 诊断端点

生产/测试服部署后可通过 `/api/diagnose` 端点查询系统实时状态：

```bash
curl "https://test.205716.xyz/api/diagnose?token=***"
```

返回信息包括：

| 字段 | 说明 |
|------|------|
| `server.version` | 当前部署版本 |
| `server.uptime_seconds` | 后端进程已运行时间 |
| `database` | DB 连接池状态（pool_size / checked_out / connected） |
| `llm` | LLM Provider 降级状态 |
| `errors.last_5min` | 过去 5 分钟错误数 |
| `errors.last_hour` | 过去 1 小时错误数 |
| `errors.recent` | 最近 20 条 ERROR+ 日志（含时间/日志名/消息） |
| `active_sessions` | 当前活跃训练会话数 |

**安全配置：** 在 `.env` 中设置 `DIAGNOSE_TOKEN` 为随机字符串。未设置时端点自动隐藏（返回 404）。

### 运维 API 端点

共四个运维端点，均用 `DIAGNOSE_TOKEN` query 参数认证（如 `?token=***`）；另有 admin 端 `/admin/ops/*` 系列，改用登录态 + `api_manage` 权限。

| 端点 | 用途 | 主要内容 |
|------|------|----------|
| `/api/diagnose` | 低层诊断快照 | server / DB / LLM / errors / active_sessions |
| `/api/ops/dashboard` | 统一运维面板 | LLM 24h 统计 / 评分队列 / 活跃会话 / 语音统计 / SSE / 指标 / 通知 / 预算 |
| `/api/ops/errors` | 错误环缓冲 | 错误计数 + 最近错误列表 |
| `/api/ops/report` | 运维日报 | 汇总摘要 + 自动告警 |

`/api/ops/report` 自动告警阈值：

| 指标 | 触发阈值 |
|------|----------|
| LLM 成功率 | < 90% |
| LLM 24h 错误数 | > 50 |
| 卡住评分 | > 5 条 |
| 活跃会话 | > 50 个 |
| TTS 成功率 | < 90% |
| ASR 成功率 | < 80% |
| TTS 24h 错误数 | > 20 |

## 关键指标

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
