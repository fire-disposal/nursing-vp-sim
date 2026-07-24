# LLM 调用排查

> 训练对话无响应、评分失败、QA 回答异常时的 LLM 侧排查。

## 快速诊断

```bash
# 诊断快照（含 LLM 成功率、限流、错误数）
ssh yecaoyun "curl -sf 'http://127.0.0.1:9081/api/diagnose?token=AVEDEUSMECHANICUSBENEDICTUSMACHINA' | python3 -m json.tool | grep -A20 '\"llm\"'"

# LLM 调用日志（最近错误）
ssh yecaoyun "docker logs nursing-backend-staging --tail 100 2>&1 | grep -iE 'llm|deepseek|api_key|rate.limit|timeout'"
```

## 排查链路

```
训练对话无响应
  → 管理后台 → 成本管理 → LLM API Tab → secret 状态是否为 active？
      → 否（degraded/unassigned）→ 检查用途分配，激活密钥
  → 点击"测试 LLM"连通性
      → 失败 → API Key 是否过期 / 余额不足
  → API Key 有效但仍失败
      → ssh 查看 LLM 成功率（diagnose 端点）
      → 检查 DeepSeek 服务状态页
      → 查看限流情况（llm.rate_limit_hits）
```

## 常见问题

| 现象 | 原因 | 操作 |
|------|------|------|
| 患者无回复 | API Key 失效 | 管理后台更换 Key |
| 评分失败 | Token 超限 / 模型超时 | 检查 prompt 长度，SCORING_TIMEOUT_SECONDS (300s) |
| 频繁 429 限流 | 并发过高 | 降低并发，或增加备用 Key |
| 随机拒绝 | 内容安全拦截 | 调整 prompt 中的安全护栏配置 |
| 响应为空 | 模型输出被截断 | 增加 max_tokens 配置 |

## 密钥管理

- **密钥轮换**：管理后台新建一条 API 档案 → 切换用途绑定 → 确认新档案 `call_count_today` 上升 → 删除旧档案
- **降级链**：DB 中的密钥 → `.env` 中的 `DEEPSEEK_API_KEY` 兜底
- **熔断**：连续失败触发 circuit breaker，前端会自动降级到兜底回复

## 成本异常排查

```bash
# Top 消耗用户
ssh yecaoyun "docker exec nursing-db-staging psql -U nursing -d nursing_vp -c \"
  SELECT u.username, COUNT(*) AS calls, SUM(estimated_cost) AS total_cost
  FROM llm_call_logs l JOIN users u ON l.user_id = u.id
  WHERE l.created_at > NOW() - INTERVAL '7 days'
  GROUP BY u.username ORDER BY total_cost DESC LIMIT 10\""

# 检查是否有死循环训练
ssh yecaoyun "docker exec nursing-db-staging psql -U nursing -d nursing_vp -c \"
  SELECT id, user_id, current_phase, message_count, scoring_status
  FROM training_records WHERE state = 'in_progress' AND created_at < NOW() - INTERVAL '2 hours'\""
```

## 降级模式

LLM 不可用时系统自动降级：
- 患者回复变为预设兜底文本
- 评分进入 pending 队列等待恢复
- 前端显示降级状态提示

排查恢复后：新训练自动恢复正常，队列中的评分会逐个重试。
