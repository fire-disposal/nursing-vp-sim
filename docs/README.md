# 项目文档

## 核心文档

| 文档 | 说明 |
|------|------|
| **[00-开发入门](00-dev-onboarding.md)** | 环境搭建 · 提交规范 · 发版流程 · 测试 |
| [01-系统架构](01-architecture.md) | 技术栈 · 项目结构 · 路由设计 |
| [03-数据库设计](03-database.md) | 表结构 · 字段 · 索引 · 迁移规则 |
| [04-前端设计](04-frontend.md) | 组件架构 · 页面路由 · 状态管理 |
| [05-LLM 与评分](05-llm-design.md) | Prompt 体系 · Provider 路由 · 评分流程 |
| [09-运维指南](09-operations.md) | 部署 · 备份 · 监控 · 应急预案 |
| [11-后端组织结构收敛](11-backend-organization-plan.md) | 可导航单体定案 · 目录职责 · 训练域边界 |
| **[15-训练协约](15-workflow-activity-contract.md)** | Workflow/Activity、病例版本、成员与受众、上下文装配（当前实现基线） |
| **[16-2.0可维护单体目标](16-v2-maintainable-monolith-objectives.md)** | 2.0 架构约束、最小产品闭环、技术栈取舍与发布切片 |
| [17-训练域身份与状态概念契约](17-training-identity-and-state-contract.md) | 身份/形状/并发/快照/运行态的命名权威 · 已发现冲突与处置 · 命名规则 |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | 分支模型 · PR 规范 · 冲突处理 |

## 项目演进

| 文档 | 说明 |
|------|------|
| [CHANGELOG.md](CHANGELOG.md) | 项目里程碑汇总（按功能领域非时间线） |

## 评审与审计

| 文档 | 说明 |
|------|------|
| [技术债合并清单（2026-09-14）](review/tech-debt-audit-2026-09-14.md) | 9 份只读审计报告合并；`path:line` 锚点、严重度与闭环成本口径的来源 |
| [UI 审计清单（2026-09-26）](review/ui-audit-2026-09-26.md) | 线上全路由实测（双角色、双视口、浅/深色）+ 静态代码审计；含探针数值、已核实无问题清单与修复批次 |
| [缺陷清单](review/defect-list.md) · [发布检查表](review/release-checklist.md) | 历史登记与发布前核对 |

## 运维速查手册

| 文档 | 说明 |
|------|------|
| [TTS / 语音排障](ops/tts-troubleshooting.md) | 语音播报异常、ASR 识别失败的逐层排查 |
| [服务器故障恢复](ops/server-recovery.md) | 容器 unhealthy、磁盘满、内存不足的应急操作 |
| [LLM 调用排查](ops/llm-troubleshooting.md) | LLM 无响应、评分失败、成本异常诊断 |
| [数据库备份恢复](ops/backup-restore.md) | 手动备份/恢复/跨环境数据同步命令 |
| [事故报告 2026-07-26](ops/incident-2026-07-26-timeout.md) | 评分超时事故复盘 |
| [事故报告 2026-09-26](ops/incident-2026-09-26-deploy-silent-truncation.md) | 部署脚本被 stdin 吞掉 → 静默「成功」（迁移跑了、服务未切换） |
| [反馈核查清单](ops/feedback-checklist-20260727.md) | 2026-07-27 用户反馈回复与测试方法 |

## 设计文档（历史归档）

设计规格存放在 `superpowers/specs/`，按日期命名。包含架构重构、插件系统、训练引擎、情感系统、UI 重设计、打分优化等历史设计快照，供回溯参考。

## 点子草稿（未实现/论证中）

存放在 [ideas/](ideas/README.md)。未实现或论证中的想法、可行性调研，**无决策约束力**；被采纳时转正为正式编号文档。

| 文档 | 状态 | 要点 |
|------|------|------|
| [电话式纯语音采集可行性](ideas/voice-call-feasibility.md) | 论证文档（非决策） | 半双工对讲机 MVP；PSTN 明确不做 |


