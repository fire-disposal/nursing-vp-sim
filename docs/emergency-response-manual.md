# 应急预案手册 (Emergency Response Manual)

> 版本: v1.0 | 适用: nursing-vp-sim v2026.05.31 | 最后更新: 2026-06-06

---

## 0. 部署拓扑速查

| 环境 | 地址 | 服务器 | 数据库 |
|------|------|--------|--------|
| 生产 | `iomt.205716.xyz:9000` | VPS (nginx + Docker) | PostgreSQL 15 (volume: `ai_vp_pg_data`) |
| 预发布 | `test.205716.xyz:9080` | 同一 VPS | 独立 DB (volume: `staging_pg_data`) |

**关键端口**: 前端 9000/9080, 后端 9001/9081, DB 5432 (内网)
**SSH**: 通过 GitHub Actions CI/CD 自动化操作，手动登录参考 `deploy/` 下脚本

---

## 1. P0 场景应急响应

### 场景 1.1: 系统完全不可访问 (HTTP 5xx / 连接超时)

**可能原因**: Docker 容器崩溃 / 宿主机资源耗尽 / Nginx 异常 / 磁盘满

**诊断步骤**:
```bash
# SSH 到服务器
ssh user@<server_ip>

# 检查容器状态
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# 检查资源
free -h && df -h && docker stats --no-stream

# 检查日志
docker logs nursing-vp-sim-backend-1 --tail 50
docker logs nursing-vp-sim-frontend-1 --tail 50
docker logs nursing-db --tail 50
```

**应急措施**:
```bash
# 方案 A: 重启所有服务
cd /opt/nursing-vp-sim  # 或实际部署目录
docker compose -f docker-compose.prod.yml up -d --force-recreate

# 方案 B: 仅重启后端
docker restart nursing-vp-sim-backend-1

# 方案 C: 回滚到最近的稳定版本
# 查看历史版本
cat .version-history
# 回滚
bash rollback.sh --yes <上一个版本号>
```

**恢复验证**: `curl -f http://localhost:9001/api/health`

---

### 场景 1.2: LLM API 不可用 (DeepSeek 服务中断 / Key 失效 / 余额耗尽)

**症状**:
- 聊天返回固定兜底回复 (如 "嗯……这个我也不太清楚")
- 评分任务全部失败 (status = "failed")
- `/api/health` 返回 `llm: "unavailable"`

**诊断步骤**:
```bash
# 检查 LLM 连通性
curl -I https://api.deepseek.com/v1/models
# 检查 API Key 余额
curl https://api.deepseek.com/v1/models \
  -H "Authorization: Bearer <YOUR_KEY>" | jq .

# 查看后端日志
docker logs nursing-vp-sim-backend-1 2>&1 | grep -i "deepseek\|llm\|401\|429\|403"
```

**应急措施**:
1. **检查环境变量**: 确认 `DEEPSEEK_API_KEY` 未过期且有余额
2. **检查数据库密钥**: 登录管理面板 → LLM 管理 → 检查密钥状态 (是否 degraded)
3. **手动重置降级状态**: 管理面板中将被 circuit-breaker 标记的密钥恢复为 active
4. **备用方案**: 在管理面板添加一个新的 API Key 并设为激活
5. **如果完全不可恢复**: 系统会自动使用环境变量兜底 (`_SyntheticConfig`) —— 但需确认 `.env` 中 key 有效

**影响范围**:
- 学生训练对话 → 返回兜底回复 (可继续但无 AI 应答)
- 自动评分 → 全部失败，需手动评分
- 问答模块 → 返回兜底回复

---

### 场景 1.3: 数据库宕机 / 连接拒绝

**症状**:
- 所有 API 返回 500 (数据库连接失败)
- 容器日志大量 `sqlalchemy.exc.OperationalError`

**诊断步骤**:
```bash
# 检查 DB 容器
docker ps | grep nursing-db

# 检查 DB 日志
docker logs nursing-db --tail 50

# 检查磁盘
df -h /var/lib/docker/volumes/
```

**应急措施**:
```bash
# 重启数据库
docker restart nursing-db
# 等待 10 秒后重启后端
sleep 10 && docker restart nursing-vp-sim-backend-1
```

**数据恢复** (如重启无效):
```bash
# 检查最近的备份
ls -la /tmp/nursing_db_backup_*.sql.gz
# 恢复备份
gunzip -c /tmp/nursing_db_backup_<date>.sql.gz | \
  docker exec -i nursing-db psql -U nursing -d nursing_production
```

---

### 场景 1.4: 磁盘空间耗尽

**影响**: 数据库无法写入 → 系统不可用; Docker 日志爆炸 → docker 失败

**诊断**:
```bash
df -h
du -sh /var/lib/docker/containers/*/
du -sh /var/lib/docker/volumes/*
```

**应急措施**:
```bash
# 清理 Docker 无用资源
docker system prune -af --filter "until=48h"

# 清理旧日志 (至少保留 3 天)
docker logs nursing-vp-sim-backend-1 --since 72h | head -1000 > /tmp/backup_logs.txt
truncate -s 0 $(docker inspect --format='{{.LogPath}}' nursing-vp-sim-backend-1)

# 如果数据库过大
docker exec nursing-db psql -U nursing -d nursing_production -c \
  "SELECT pg_size_pretty(pg_database_size('nursing_production'));"
# 考虑清理 llm_call_logs 历史数据
docker exec nursing-db psql -U nursing -d nursing_production -c \
  "DELETE FROM llm_call_logs WHERE created_at < NOW() - INTERVAL '30 days';"
```

---

### 场景 1.5: 内存逐渐耗尽 (Rate Limiter 泄漏)

**症状**: 服务器内存持续增长, OOM Killer 杀掉容器

**已修复**: `cleanup()` 方法已在 `_rate_limiter_cleanup` 任务中每 600 秒调用

**监控命令**:
```bash
# 查看内存趋势
docker stats --no-stream nursing-vp-sim-backend-1
# 如果后端内存超过 500MB 持续增长 → 可能存在额外泄漏
```

**临时措施**:
```bash
docker restart nursing-vp-sim-backend-1  # 重启释放内存
```

---

### 场景 1.6: HTTPS 证书过期

**症状**: 浏览器 SSL 警告, API 不可用

**诊断**:
```bash
echo | openssl s_client -servername iomt.205716.xyz -connect iomt.205716.xyz:443 2>/dev/null | \
  openssl x509 -noout -dates
```

**应急措施**:
```bash
# 续期证书 (Let's Encrypt certbot)
sudo certbot renew --force-renewal
# 重新加载 nginx
sudo nginx -s reload
```

---

### 场景 1.7: CI/CD 部署失败 (GHCR 不可用 / 推送失败)

**症状**: GitHub Actions staging/prod 流水线失败

**应急措施**:
1. 检查 GitHub Container Registry 状态: https://www.githubstatus.com/
2. 如果仅 GHCR 不可用 → 直接 SSH 到服务器手动构建部署
3. 如果部署中断导致服务不可用 → 执行回滚 (见场景 1.1 方案 C)

---

### 场景 1.8: 需要紧急维护通知

**开启维护模式** (通过 GitHub Actions):

1. 前往 GitHub Actions → "Maintenance Mode Toggle" → Run workflow
2. 选择环境 (staging / production) 和动作 (enable)
3. 所有用户访问将显示维护页面，API 返回 503

**手动开启** (如果 Action 不可用):
```bash
# SSH 到服务器
ssh user@<server_ip>

# 开启生产维护
sudo touch /opt/nursing-vp-sim/maintenance.on && sudo nginx -t && sudo nginx -s reload

# 开启预发布维护
sudo touch /opt/nursing-vp-sim/maintenance.staging.on && sudo nginx -t && sudo nginx -s reload

# 关闭维护
sudo rm -f /opt/nursing-vp-sim/maintenance.on && sudo nginx -t && sudo nginx -s reload
```

**维护页面**: 部署在 `/opt/nursing-vp-sim/maintenance.html`

**注意**: 维护模式在 Nginx 层面拦截，后端容器可正常操作（部署、评分、备份等）。

---

## 2. 已知薄弱点 (不完善/半成品) 及应对

以下模块存在已知不完善或功能缺失，应在值班期间重点关注。

### 2.1 患者角色守卫 (patient_guard) —— **直通模式**

- **文件**: `backend/services/patient_guard.py:189`
- **状态**: 整个守卫系统被硬编码为直通 (`return reply, [], False`)
- **风险**: 虚拟患者可能泄露自己是 AI、直接给出诊断、暴露教学内容
- **影响**: 对话质量下降, 学生可能获得不公平的评分优势
- **监控**: 抽取对话记录抽查, 关注患者是否说出 "AI"、"模型"、"糖尿病" 等敏感词
- **修复优先级**: 高 (但需要重新设计守卫逻辑)

### 2.2 Docker 容器无资源限制

- **文件**: `deploy/docker-compose.prod.yml`, `deploy/docker-compose.staging.yml`
- **风险**: 任一容器可耗尽宿主机 CPU/内存, 拖垮整个系统
- **应对**: 
  - 生产环境添加 `deploy.resources.limits` (建议 backend: 2GB/2CPU, frontend: 512MB/0.5CPU)
  - 设置 Docker daemon 日志 rotation 防止磁盘爆满
  - 监控: `docker stats` 定期输出到日志

### 2.3 无 Nginx 级速率限制

- **文件**: `deploy/nginx/` (宿主机 nginx 配置)
- **风险**: 仅 Python 层 rate limit (内存型), 大流量攻击仍能消耗 FastAPI 资源
- **应对**: 在 `deploy/nginx/snippets/` 中添加 rate limit snippet

### 2.4 Nginx 安全头（外部已完善，容器 nginx 已补充）

- **宿主机**: `deploy/nginx/iomt.205716.xyz.conf` 包含 X-Frame-Options, X-Content-Type-Options, Referrer-Policy, HSTS
- **容器**: `nginx.conf` 包含安全头 + gzip
- **Staging**: 无 HSTS（合理，避免浏览器缓存影响切换）

### 2.5 JWT Token 无主动撤销机制

- **文件**: `backend/core/security.py`
- **风险**: 无法在用户角色变更后立即撤销旧 token, 最长 8 小时有效期内权限变更不生效
- **应对**: 紧急情况下需改 `SECRET_KEY` (使所有 token 失效, 所有人重新登录)

### 2.6 Token 存储在 localStorage

- **文件**: `frontend/src/api/axios-instance.ts:26`
- **风险**: XSS 攻击可窃取 token
- **缓解**: 目前依赖 React 的 XSS 防护 + CSP (但 CSP 不完整), 迁移到 HttpOnly Cookie 为长期方案

### 2.7 DB 备份不可靠 (CI/CD 中)

- **文件**: `.github/workflows/cd.yml:46-47`
- **风险**: 生产部署前 DB 备份使用 `|| echo "  (skip)"`, 备份失败会被静默忽略
- **应对**: 部署前手动确认备份有效: `ls -la /tmp/nursing_db_backup_*.sql.gz`

### 2.8 Staging 共用生产 SSL 证书

- **文件**: `deploy/nginx/test.205716.xyz.conf:24`
- **现状**: Staging 引用 `iomt.205716.xyz` 的 Let's Encrypt 证书
- **风险**: 若生产证书到期 Staging 也受影响；CN 不匹配浏览器可能有警告但不影响功能
- **应对**: 可接受（Staging 为内部测试环境），生产证书续期后 Staging 自动恢复

### 2.9 LLM 环境变量兜底无限额

- **文件**: `backend/services/llm_router.py:149-158`
- **风险**: 当所有数据库密钥失效时, 回退到 `.env` 中的 key, 该兜底 `_SyntheticConfig` 无 monthly_cost_limit
- **应对**: 监控 LLM 调用费用, 在 DeepSeek 控制台设置硬限额

### 2.10 自动结算线程生命周期不可控

- **文件**: `backend/services/auto_settlement.py:103-109`
- **风险**: daemon 线程进程终止时被强制 kill, 可能导致评分半途而废, DB 事务悬空
- **应对**: 服务重启前确保无活跃评分 (查看 `scoring_status == "pending"` 的记录)

---

## 3. 常用运维命令

### 服务管理
```bash
# Staging
cd /opt/nursing-vp-sim-staging
docker compose -f deploy/docker-compose.staging.yml up -d
docker compose -f deploy/docker-compose.staging.yml restart backend

# Production
cd /opt/nursing-vp-sim
docker compose -f deploy/docker-compose.prod.yml up -d
docker compose -f deploy/docker-compose.prod.yml logs -f --tail 100 backend

# 健康检查
curl -f http://localhost:9001/api/health   # 生产
curl -f http://localhost:9081/api/health   # staging
```

### 数据库操作
```bash
# 进入到 DB 命令行
docker exec -it nursing-db psql -U nursing -d nursing_production

# 紧急查询
docker exec nursing-db psql -U nursing -d nursing_production -c \
  "SELECT id, status, scoring_status, start_time FROM training_records ORDER BY id DESC LIMIT 10;"

docker exec nursing-db psql -U nursing -d nursing_production -c \
  "SELECT id, label, status, call_count_today, monthly_cost_used FROM api_secrets;"

# 清除僵尸评分状态
docker exec nursing-db psql -U nursing -d nursing_production -c \
  "UPDATE training_records SET scoring_status = 'not_started' WHERE scoring_status = 'pending' AND start_time < NOW() - INTERVAL '30 minutes';"
```

### 日志排查
```bash
# 实时错误
docker logs -f nursing-vp-sim-backend-1 2>&1 | grep -i "error\|exception\|traceback"

# 慢请求 (>3s)
docker logs nursing-vp-sim-backend-1 2>&1 | grep -E "[0-9]{4,}ms"

# LLM 调用统计
docker logs nursing-vp-sim-backend-1 2>&1 | grep "patient_chat" | tail -20
```

### 回滚
```bash
# 查看可用版本
cat .version-history

# 执行回滚
bash rollback.sh --yes v2026.05.30

# 手动回滚 (如果 rollback.sh 失败)
BACKEND_IMG="ghcr.io/<org>/nursing-vp-sim-backend:v2026.05.30"
FRONTEND_IMG="ghcr.io/<org>/nursing-vp-sim-frontend:v2026.05.30"
sed -i "s|image: .*nursing-vp-sim-backend:.*|image: ${BACKEND_IMG}|" docker-compose.prod.yml
sed -i "s|image: .*nursing-vp-sim-frontend:.*|image: ${FRONTEND_IMG}|" docker-compose.prod.yml
docker compose -f docker-compose.prod.yml up -d --force-recreate
```

---

## 4. 监控建议 (未实现，推荐)

当前系统无内建监控。建议：

| 监控项 | 方法 | 告警条件 |
|--------|------|----------|
| 服务存活 | `curl /api/health` 每 30s | 连续 3 次非 200 |
| LLM 可用 | `/api/health` 中 `llm` 字段 | `unavailable` > 5min |
| 磁盘使用 | `df -h /` | > 85% |
| 内存使用 | `free -m` | 可用 < 200MB |
| DB 连接 | `pg_isready` | 连续失败 |
| SSL 证书 | `certbot certificates` | < 7 天过期 |
| LLM 费用 | 管理面板或 `api_secrets.monthly_cost_used` | 超过限额 80% |

---

## 5. 联系人与资源

| 资源 | 地址 |
|------|------|
| DeepSeek 状态 | https://status.deepseek.com |
| GitHub 状态 | https://www.githubstatus.com |
| 项目仓库 | (填入 GitHub repo URL) |
| CI/CD | `.github/workflows/` |
| 服务器 SSH | (填入) |
| API Key 管理 | DeepSeek 控制台: https://platform.deepseek.com |

---

## 6. 部署前检查清单

每次部署到生产前：
- [ ] Staging 健康检查通过 (`curl test.205716.xyz:9081/api/health`)
- [ ] DB 备份已生成且文件大小 > 0
- [ ] `.version-history` 中存在当前版本号
- [ ] LLM API Key 有足够余额
- [ ] 通知相关人员部署窗口
- [ ] 准备回滚命令 (复制到剪贴板)
- [ ] Staging 和 Production 版本号一致确认
