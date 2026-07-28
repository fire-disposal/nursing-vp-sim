# 服务器故障恢复

> 服务器不可达、容器异常退出、磁盘/内存告警时的应急操作。

## 快速诊断

```bash
# 服务器可达性
ssh yecaoyun "uptime; free -h; df -h /"

# 容器状态
ssh yecaoyun "docker ps --format 'table {{.Names}}\t{{.Status}}'"

# 所有容器日志（最近 30 行）
ssh yecaoyun "docker logs nursing-backend-staging --tail 30"
ssh yecaoyun "docker logs nursing-db-staging --tail 30"

# 综合诊断快照
ssh yecaoyun 'curl -sf "http://127.0.0.1:9081/api/diagnose?token=$DIAGNOSE_TOKEN"'
```

## 常见场景

### 服务不可达

```
ssh 失败 / 超时
  → 确认服务器 IP 和 SSH 端口
  → 联系云服务商查看实例状态
  → ping 服务器 IP 确认网络
```

### 容器 unhealthy

```bash
# 查看失败原因
ssh yecaoyun "docker inspect nursing-backend-staging --format '{{json .State.Health}}' | python3 -m json.tool"

# 重启问题容器
ssh yecaoyun "cd /opt/nursing-vp-sim && docker compose -f docker-compose.staging.yml --env-file .env restart"

# 日志中搜索关键错误
ssh yecaoyun "docker logs nursing-backend-staging 2>&1 | grep -iE 'error|fail|panic|traceback' | tail -20"
```

### 磁盘空间不足

```bash
# 清理未使用的 Docker 资源
ssh yecaoyun "docker system prune -af --volumes"

# 检查大文件
ssh yecaoyun "du -sh /opt/nursing-vp-sim/backups/*"
ssh yecaoyun "find /var/lib/docker -size +100M -type f 2>/dev/null | head -10"

# 清理旧备份（保留最近 7 天）
ssh yecaoyun "find /opt/nursing-vp-sim/backups -mtime +7 -delete"
```

### 内存不足 / OOM

```bash
# 查看内存使用
ssh yecaoyun "docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.MemPct}}'"

# 重启所有容器
ssh yecaoyun "cd /opt/nursing-vp-sim && docker compose -f docker-compose.staging.yml --env-file .env down && docker compose -f docker-compose.staging.yml --env-file .env up -d"
```

### 数据库连接拒绝

```bash
# DB 容器是否在运行
ssh yecaoyun "docker ps | grep nursing-db"

# 测试 DB 连接
ssh yecaoyun "docker exec nursing-db-staging psql -U nursing -d nursing_vp -c 'SELECT 1'"

# DB 日志
ssh yecaoyun "docker logs nursing-db-staging --tail 30"
```

## DNS / Nginx

```bash
# 检查 nginx 配置
ssh yecaoyun "nginx -t"

# 重载 nginx
ssh yecaoyun "nginx -s reload"

# 测试域名解析
ssh yecaoyun "curl -sI https://test.205716.xyz | head -5"
```

## 告警触发条件

诊断端点自动计算告警（每 15 分钟 crontab）：
- LLM 成功率 < 90%
- 近 24h 错误 > 50 次
- LLM 5min 突发错误 > 5 次
- 评分成功率 < 80%
- 活跃会话 > 50 个

告警通过钉钉 Webhook + SMTP 邮件双通道发送。
