# 项目文档

## 当前方向与实施入口

- **[19-正式训练流程下一代深化计划](19-training-experience-next-generation-plan.md)**：唯一当前训练实施计划；病例与变式、响应性互动、评分校准、复盘与迁移，含代码落点、W0–W6、验收与整批切换。
- **[18-临床推理模块去向](18-clinical-reasoning-disposition.md)**：独立实验面与仅作者面 workflow 保留、冻结扩展、退出正式训练交付承诺；不是删代码或开放第二工作流。
- **[评分校准工作区](calibration/README.md)**：判例集格式与入选规则（可执行）、教师工作流程、预先登记的验收阈值模板，以及**当前阻塞**（无教师判例与签字阈值 → 不启用能力等第）。
- 上述计划**代码侧已实施**（W0–W6 见 19 的「实施状态」）：锚点送达、原始精度与溯源、等第政策、可比性分组、可信链路、病例蓝图与迁移变式、响应性互动、复盘—重练—迁移闭环均已落地并有回归与真实验收证据。**教师校准未完成**，因此未启用能力等第，也未宣称教学有效性；架构约束、当前实现与未来计划分别阅读。

## 核心文档

| 文档 | 说明 |
|------|------|
| **[00-开发入门](00-dev-onboarding.md)** | 环境搭建 · 提交规范 · 发版流程 · 测试 |
| [01-系统架构](01-architecture.md) | 技术栈 · **浏览器下限与垫片** · 项目结构 · 布局系统 · 数据流 |
| [03-数据库设计](03-database.md) | 表结构 · 字段 · 索引 · 迁移规则 |
| [05-LLM 与评分](05-llm-design.md) | 当前代码入口 · 评分数据流与量尺 · 已知校准缺口（不是教学有效性声明） |
| [09-运维指南](09-operations.md) | 部署 · 备份 · 监控 · 应急预案 |
| [11-后端组织结构收敛](11-backend-organization-plan.md) | 可导航单体定案 · 目录职责 · 训练域边界 |
| **[15-训练协约](15-workflow-activity-contract.md)** | Workflow/Activity、病例版本、成员与受众、上下文装配（当前实现基线） |
| **[16-可维护单体约束](16-v2-maintainable-monolith-objectives.md)** | 持久架构边界与技术栈取舍；不再维护发布切片 |
| [17-训练域身份与状态概念契约](17-training-identity-and-state-contract.md) | 身份/形状/并发/快照/运行态的命名权威 · 已发现冲突与处置 · 命名规则 |
| **[评分校准工作区](calibration/README.md)** | 判例集格式与入选规则 · 教师流程 · 预先登记阈值模板 · 当前阻塞（等第启用前提） |
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
| [UI 改善记录（2026-09-26 起）](review/ui-improvement-plan-2026-09-26.md) | 已完成改动与条件维护清单；保留查询范式（§6.4），不是下一批次产品路线 |
| [审计日志与 RBAC 分析（2026-09-26）](review/audit-log-and-rbac-analysis-2026-09-26.md) | 只读调查：审计落点现状、RB-1…RB-9 风险条目、A1–A6 切片草案（含 `path:line` 证据） |
| [功能优化与重构记录（2026-09-26）](review/refactor-plan-2026-09-26.md) | 历史改动与维护约束；后续训练工作以 19 为准 |
| [训练体验调查（2026-09-27）](review/training-experience-analysis-2026-09-27.md) | 发现、证据与未验证边界；原竞争路线已删除，问题映射到 19 工作包 |
| [训练深化批次验收记录（2026-09-27）](review/training-deepening-verification-2026-09-27.md) | W0–W6 的**实际**执行结果（含真实 LLM 端到端、迁移链路、终态不落库 P0 的根因与回归），以及未执行项与用户可复制的走查命令 |
| [缺陷清单](review/defect-list.md) · [发布检查表](review/release-checklist.md) | 历史登记与发布前核对 |

## 运维速查手册

| 文档 | 说明 |
|------|------|
| [TTS / 语音排障](ops/tts-troubleshooting.md) | 语音播报异常、ASR 识别失败的逐层排查 |
| [服务器故障恢复](ops/server-recovery.md) | 容器 unhealthy、磁盘满、内存不足的应急操作 |
| [LLM 调用排查](ops/llm-troubleshooting.md) | LLM 无响应、评分失败、成本异常诊断 |
| [数据库备份恢复](ops/backup-restore.md) | 手动备份/恢复/跨环境数据同步命令 |
| [诊断端点与指标](ops/diagnostics.md) | `/api/diagnose` 各块（健康/LLM/评分/语音/作业队列/告警）的字段契约与消费方 |
| [审计日志保留与归档](ops/audit-log-retention.md) | 12 个月保留 + 按月「导出→校验→受控删月」规程；只追加不变式与触发器例外 |
| [时区对齐](ops/timezone-alignment.md) | timestamptz 迁移后的线上只读定位 SQL、修正步骤、锁/重写注意 |
| [单实例迁移](ops/single-instance-migration.md) | 双栈收敛为单实例的过程、`test.` 域退役与运维依赖 |
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


