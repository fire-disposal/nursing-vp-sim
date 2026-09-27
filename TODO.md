# 训练架构重构 TODO（历史记录）

> **状态：历史记录 · 已收官（2026-06-29）**。本文件原为「训练架构重构」四个批次的执行清单，均已完成；
> 逐条改动由 git 历史回溯（关键字：`批次 A`、`profiles/triage`、`TriageScene`、`prompt_snapshot`），此处只留完成摘要。
> 本文件**不再维护路线或待办**。当前决策入口：
> - 训练体验下一代深化计划（**唯一当前训练实施计划**）：[`docs/19-training-experience-next-generation-plan.md`](docs/19-training-experience-next-generation-plan.md)
> - 临床推理（第二 workflow）的去向：[`docs/18-clinical-reasoning-disposition.md`](docs/18-clinical-reasoning-disposition.md)
> - 训练实现契约（基线/历史决策）：[`docs/15-workflow-activity-contract.md`](docs/15-workflow-activity-contract.md)
> - 单体架构约束：[`docs/16-v2-maintainable-monolith-objectives.md`](docs/16-v2-maintainable-monolith-objectives.md)

## 完成摘要（2026-06-29）

| 批次 | 目标 | 结果 |
|---|---|---|
| A | Profile 基础设施 + Case 解耦 | 建立 `TrainingProfile`/注册中心 `get_profile`，Case 解绑单 schema，现有代码经适配层继续工作；全量 429 测试通过 |
| B | 删除死基础设施 + 评分快照 | 删除 prompt/rubric registry、DB 表与兼容字段，评分前写入 `prompt_snapshot`/`rubric_snapshot`；397 测试通过 |
| C | 前端 Scene 架构 | 提取共享服务 Hook（`useSSE`/`useScoring`/`useTTS`/`useMessageBus`）、`TrainingEntry` 路由分发、`HistoryTakingScene`；管理表单按 `training_type` 渲染 |
| D | Triage 场景实现 | `profiles/triage`（schema/评分/生成 prompt）、分诊 operations、`TriageScene` 前端组件；397 backend 测试 + tsc 通过 |

## 已移除的失效项（2026-09-27 核验）

原文件里的以下内容**不再作为待办**；此处只留核验结论与去向，供回溯：

- **分诊（triage）“待完善”清单**（内嵌对话、结果提交 API、私有面板、vitals 表单字段）：对应的 triage 训练类型已退场 —— 前端无 `TriageScene`，后端仅剩 `scoring/runner.py` 注释与 `data/e6b2c3d4e5f6_backfill_case_revisions.py` 的占位还原逻辑，故整体作废。
- **生理模拟引擎（原标注“前瞻，非短期”）**：不再是训练域待办。相关能力已在**独立实验模块** `backend/modules/simulations/**`（`case.py` 的 `PhysiologySpec`：vol/svr/lactate/hb 四舱室差分推进 + 反馈环）落地，属实验素材、**不进入正式训练闭环**；其去留见 [`docs/18`](docs/18-clinical-reasoning-disposition.md)。
- **批次依赖图与“批次间可独立部署”发布编排**：属当时的一次性执行安排，重构已收官，不再适用。

> 训练域的当前目标只由 [`docs/19`](docs/19-training-experience-next-generation-plan.md)（体验深化）与 [`docs/16`](docs/16-v2-maintainable-monolith-objectives.md)（架构约束）决定；本文件不再是入口。
