# 训练架构历史决策备忘

> 原始讨论日期：2026-06-29；2026-09-27 清除过时目标与实施路线。
> 本文件不是当前代码结构说明，也不是待执行任务。原设计细节可从 Git 历史回溯。

## 保留的历史决策

- 曾以 Profile / Scene 分离不同训练形态，并尝试预检分诊；这不构成继续扩张训练类型的理由。
- prompt/rubric 从伪动态数据库配置回到代码管理，训练记录冻结所用内容。
- 病例、患者上下文、工具动作、评分证据应有明确归属；当前契约已经演进，旧类型名与目录不再作为实现依据。

## 已删除的过时路线

删除分诊补齐、插件化扩张、生理引擎前瞻、旧 PromptCollection/Scene 草案、兼容迁移步骤与逐批发布编排。它们不再是当前待办；已实现的历史里程碑见 [CHANGELOG](docs/CHANGELOG.md)。

## 当前入口

- [19 — 正式训练流程下一代深化计划](docs/19-training-experience-next-generation-plan.md)：唯一当前训练实施计划，含评分与等第校准。
- [18 — 临床推理模块去向](docs/18-clinical-reasoning-disposition.md)：保留实验资产，冻结扩展，退出正式训练交付承诺。
- [15 — 训练实现契约](docs/15-workflow-activity-contract.md)、[16 — 单体架构约束](docs/16-v2-maintainable-monolith-objectives.md)、[17 — 身份与状态](docs/17-training-identity-and-state-contract.md)。

本次只修改文档，不删除上述历史代码或数据，不开放第二工作流。
