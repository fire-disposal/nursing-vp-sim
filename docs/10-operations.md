# 10 — 运维安全指南

> 适用版本: v2026.05.31 | 最后更新: 2026-06-02

面向生产环境运维人员的操作手册，涵盖部署流程、回滚、备份、安全加固要点。

---

## CD 部署流程

推送 `v*` tag（如 `v1.2.3`）自动触发 `cd.yml`：

```
推送 v1.2.3 tag
  → Docker Build & Push (backend + frontend) → GHCR
  → SSH 到 VPS → 备份数据库
  → docker compose up -d（使用新镜像）
  → 30 次健康检查轮询（每次 2s）
     ├─ healthy  → 写入 .version-history → 清理旧镜像 → 完成
     └─ unhealthy → 自动回滚到部署前版本 → 失败退出
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
v1.2.3|2026-06-02T14:30:00Z|ghcr.io/owner/nursing-vp-sim-backend:v1.2.3|ghcr.io/owner/nursing-vp-sim-frontend:v1.2.3
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

### 数据库备份

```bash
# 手动备份（SSH 到服务器）
cd /opt/nursing-vp-sim
docker exec nursing-db pg_dump -U nursing -d nursing_vp > "backups/manual-$(date +%Y%m%d-%H%M%S).sql"

# 通过教师后台触发备份
# 登录 → 管理后台 → 数据库备份按钮
```

### 健康检查

```bash
# 后端 API
curl -s http://localhost:8000/api/health

# 通过 Docker healthcheck
docker inspect --format='{{.State.Health.Status}}' nursing-vp-sim-backend-1
```

### 数据库重置（危险）

```bash
cd /opt/nursing-vp-sim
docker compose down -v   # 删除数据卷
docker compose up -d      # 重新创建（触发 seed 数据）
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
