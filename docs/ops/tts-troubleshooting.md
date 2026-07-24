# TTS / ASR 语音服务排障

> 当训练页患者不发声、语音识别失败时，逐层排查。

## 快速诊断

```bash
# 检测后端健康
ssh yecaoyun "curl -sf http://127.0.0.1:9081/api/health"

# 查看 TTS 相关日志
ssh yecaoyun "docker logs nursing-backend-staging --tail 50 2>&1 | grep -iE 'tts|asr|volc|voice'"

# 测试连通性
ssh yecaoyun "curl -sf 'http://127.0.0.1:9081/api/admin/voice/test?service=tts'"
```

## 排查链路

```
学生端听不到语音
  → 训练页 TTS 开关是否开启？（右上角按钮）
  → 管理后台 → 语音服务 → App ID / Token 是否已配置？
      → 否 → 火山引擎控制台获取 → 填入
  → 点击"测试 TTS"是否通过？
      → 否 → 检查火山引擎余额/配额/Token 过期
  → 前端已显示黄色降级指示灯？
      → 预算耗尽或熔断中，系统已自动切浏览器 TTS 兜底
```

## 常见问题

| 现象 | 原因 | 操作 |
|------|------|------|
| 语音变成浏览器机械音 | 预算 ≥ 100% 或熔断 | 正常降级，无需干预；检查管理后台调高预算 |
| 语音识别不准 | 噪音 / 网络 / 采样率 | 安静环境使用，管理后台降低 ASR 采样率到 8000 |
| ASR 报 401 | Token 过期 | 火山引擎控制台重新生成 Access Token → 填入 |
| TTS 报 connection refused | 火山引擎服务异常 | 等待恢复（前端自动切换浏览器兜底） |

## 密钥配置位置

- **TTS/ASR Token**：管理后台 → 成本管理 → 语音服务 Tab
- **LLM API Key**：管理后台 → 成本管理 → LLM API Tab
- **后端兜底**：`.env` 中的 `DEEPSEEK_API_KEY`

## 熔断机制

连续 3 次调用失败 → 熔断器打开 5 分钟 → 前端自动降级浏览器 TTS。
熔断恢复后自动切回火山音色，无需人工干预。
