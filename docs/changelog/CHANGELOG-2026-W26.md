# 项目更新记录 — 2026.06.13 ~ 2026.06.19

> 第 26 周：稳定化与文档重构。训练模型重设计、AI 核心重构、基础设施加固、文档体系聚合。

## 数据模型升级
- Practice/ScoreReview 模型新增：独立练习实体 + 教师评分复核表，TrainingRecord 关联 practice_id
- CaseDataSchema 类型化病例数据：Phase 1-5 (schema → validation → runtime_state 分离)
- 系统通知表 + 定时发布 + 前端通知铃铛 UI
- 迁移 idempotency guard：rubric_frozen 列存在性检查

## AI 核心重构
- NoteCollector pipeline：ContextSource 可组合列表 → 中间件管道统一上下文采集
- QA RAG 系统：pgvector + 教材知识库 + 检索注入 + 异步化
- Emotion 系统 LLM 化：移除关键词匹配，改为 LLM 意图分析 + anxious 情绪 + 32 情绪变体头像
- 身份泄漏检测扩展至 23 模式 + 连问纠正上限

## 插件架构简化
- 移除 PluginRegistry/discovery/manifest → 静态 PANEL_CONFIGS + getActivePanels()
- 前后端面板内置化到 components/training/panels/
- emotion/physical-exam 吸收为 pipeline 中间件

## 评分系统
- 评分进度 DB 持久化：评分通知模型 + Excel 导出 + 训练存档/续训
- 浮点成本统一计费：router/client/logging 三处同源 _estimate_cost
- 中文 token 低估修复 + 流式 API 不计费修复

## 后端性能与稳定性
- N+1 查询批量优化：admin_schools/grades/classes + export + 通知 bulk insert
- 基础设施竞态修复：Score 重复行、计数器丢失、同步 DB 阻塞、孤儿消息
- TTL 剪枝冷却 + prompt_builder 静态数据缓存

## 前端修复与优化
- 内存泄漏修复：panelPluginsWrapped memoize + QA AbortController + useDebouncedSearch 清理
- UX 过渡动画：Welcome/Chat 渐变切换、Emotion/Initiative 高度动画、PracticeSelect 淡入
- 骨架屏替代文字加载态：CaseSelect/TrainingEngine/RecordDetail

## 运维与 DevOps
- 监控脚本解离 config.py → 统一 .env 环境变量读取
- SMTP 密钥从 git history 清除
- Staging 路径修正 + 监控脚本文档化 + crontab 安全清理
- 新增 `pnpm run check:full` + `test:backend` 一键扫描脚本
- migration hook 堵漏手写 DDL+data 混合检查

## 文档体系
- AGENTS.md 精简重构（234→112 行）+ 全仓 npm→pnpm 统一
- 5 文档删除 + 3 文档合并 → 10-functional-audit 唯一状态文档
- CONTRIBUTING/README/SECURITY 对齐精简（-50%+ 行数）
- UML 类图更新（增补 Practice/ScoreReview）+ 09-operations 薄弱点去重

## 分支清理
- 8 个已合入分支删除 + 空文件夹清理
