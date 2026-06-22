# 项目更新记录 — 2026.06.20 ~ 2026.06.22

> 第 27 周：患者自主追问体系、流式评分体验、运维诊断增强、移除遗留 SystemConfig。

## 患者自主追问 (Initiative)
- 纯 LLM 驱动的患者主动追问，带重试，移除模板兜底
- 重写 InitiativeBar：发送即重置、回复即开始、TTS 暂停、达上限停止、过渡动画
- 指数退避策略：最多 2 次触发、自动停表、按触发次数施加情绪惩罚
- 触发响应携带 emotion，即时更新 EmotionIndicator
- 数据库：`training_session_state` 新增 `initiative_count` 字段

## 评分体验
- 流式 LLM 评分：thinking 模式 + 0.3s 推送间隔
- 推送式评分浮层：自动滚动、高度减半
- 修复：异步入队评分、思考过程推送、评分显示兜底（max fallback）

## 运维与诊断
- 新增 admin ops 端点 `/api/ops/dashboard` `/api/ops/errors` `/api/ops/report`（api_manage / DIAGNOSE_TOKEN 认证）
- ops 诊断增强：voice/TTS/ASR 统计、SSE 连接数、进行中评分、更智能的告警阈值

## 移除与清理
- 移除遗留 SystemConfig：model / router / seed / schema 全量删除
- 删除前端 SystemConfigsPage 及其 api client
- 数据库迁移 drop `system_configs` 表（幂等守卫）

## 前端体验
- WelcomeScreen 点击关闭 + 患者气泡内打字点动画
- 通知面板打开时批量标记已读

## 修复
- 种子数据 `health_literacy` 赋值
- 静默过滤未知插件 ID
- 移除 prompt 中的 portrait 字段
