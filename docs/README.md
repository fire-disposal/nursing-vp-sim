# 文档

**只写代码里看不到的事实**：运维步骤、外部约束、决策与理由、跨系统契约。
不要复述代码结构、字段、行为——读代码就有；**过时的复述比没有更糟**。

| 文件 | 内容 |
|---|---|
| [onboarding.md](onboarding.md) | 环境搭建、提交格式、测试、发版流程 |
| [architecture.md](architecture.md) | 技术栈、目录边界、浏览器下限 |
| [database.md](database.md) | 迁移规则（`ddl/` 与 `data/` 目录约定）、备份 |
| [llm.md](llm.md) | 模型档位与用途映射、成本与降级口径 |
| [operations.md](operations.md) | 部署、备份、监控、应急预案 |
| [scenario.md](scenario.md) | 情境训练：内容在库里、时间语义、DM 权限待定 |
| [cases/](cases/) | 五个病例的可读文本（由 `backend/scripts/render_cases.py` 生成的派生物） |
| [ops/](ops/) | 排障与运维速查：诊断契约、语音/LLM 排障、事故复盘 |
| [calibration/](calibration/) | 判例与校准资产（研究用） |
| [CHANGELOG.md](CHANGELOG.md) | 历史 |

历史设计文档已于 2026-09-29 删除（编号 11–23、`superpowers/`、`ideas/`、`review/`）：
它们只被 AI 读过，且让后续每个进场者先把自己绑在旧契约上。原文在 git 历史里可查。
