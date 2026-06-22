# v2026.06.22-16 测试清单

**版本**: v2026.06.22-15 → v2026.06.22-16
**环境**: https://test.205716.xyz

### 1. 运维诊断接口数据完整性
**操作**: 使用诊断令牌访问 `https://test.205716.xyz/api/ops/dashboard?token=AVEDEUSMECHANICUSBENEDICTUSMACHINA` → 检查返回 JSON
**预期**: 返回数据包含新增字段：`voice`（TTS/ASR 统计）、`voice_budget`（月度预算）、`sse`（连接数）、`scoring.in_progress`（进行中评分数）；无 LLM 调用时 `alerts` 不包含"LLM 成功率 0%"

### 2. 运维日报告警准确性
**操作**: 访问 `https://test.205716.xyz/api/ops/report?token=AVEDEUSMECHANICUSBENEDICTUSMACHINA` → 检查 `alerts` 和 `status`
**预期**: 无 LLM 调用时 `status` 为 `healthy` 且无 LLM 成功率告警；告警包含 TTS/ASR 相关阈值判断

### 3. 训练评分流程正常
**操作**: 学生登录 → 开始训练 → 完成对话 → 结束训练 → 观察评分窗口
**预期**: 评分评估弹出、双窗口滚动、评分结果正常生成，与 v2026.06.22-15 行为一致
