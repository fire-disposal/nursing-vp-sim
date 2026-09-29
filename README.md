# Nursing VP Sim

> 护理学生虚拟患者训练平台 — LLM 角色扮演问诊 · 自动评分 · 教师复核 · 语音交互

🚀 **Production** [iomt.205716.xyz](https://iomt.205716.xyz)（单实例部署）

---

## 核心能力

- **虚拟患者对话** — LLM 角色扮演，隐藏背景语义披露 + 出站泄漏守卫，SSE 流式输出
- **自动评分** — 逐条目 0-2 分制（含护理记录维度），Σ条目映射 100 分制；每条附对话证据 + 评分理由；评分故障（LLM 兜底/维度丢失）显式标记，不进排行榜
- **教师复核** — 逐项改分工作台，对话回放 ↔ 证据点击联动；复核结果写回成绩单
- **训练计时与结束** — 病例时限、训练状态、提交与评分由服务端契约约束；终态持久化、暂离与恢复使用真实服务端状态
- **情感系统** — 4D 情绪模型（信任/焦虑/烦躁/配合）驱动患者行为，实时指示条 + 结果页轨迹图（事件标注）
- **语音交互** — 火山引擎 TTS 情感合成，**句子级流式分块**（低延迟首音）与会话级 `abort`（打断）；失败与降级状态显式呈现。双工对谈（持续拾音 + 端点检测 + 打断）是大版本目标中的下一项
- **工具指令面** — 查体/护理记录走 HTTP 指令 + revision 乐观并发 + 单一审计时间线
- **病例体系** — 内置病例 + AI 生成，统一校验器（时间线/症状/医学事实断言）守护内容质量
- **多 Provider 路由** — 优先级加权、熔断、限流、健康检查；env 兜底同源记账

## 大版本目标

**我们是训练上下文的发布与管理平台：为用户带来一次体验，并记录该次体验。**

| 腿 | 含义 | 现在的样子 |
|---|---|---|
| **一次体验** | 在场（患者在场感）+ 时间（会变的情境）+ 对话（双工语音） | 场景可更新、情绪有状态、流式 TTS 分块与 `abort` 已就绪；**表现层与双工待做** |
| **记录该次体验** | 一次会话产出一份可导出的**体验记录**：时间线 + 对话 + 体征 + 情感轨迹 + 判读与证据 | 数据都在（`messages` / `exam_results` / 情绪事件 / 动作日志 / 评分证据），**差一个导出面** |
| **发布与管理** | 场景 = 声明式上下文 + 变体 + 分组，版本化下发 | 骨架完整：`CaseRevision` + 指纹 + 批次 + 问卷/SUS |

推进顺序与每个方向的最小切片见 **[下一阶段方向](docs/ideas/next-phase-directions-2026-09-27.md)**；本版本的验收场景是 U0 可用性研究；训练实现契约见 [docs/15](docs/15-workflow-activity-contract.md)。


---

## 快速开始

```bash
pnpm install && cd backend && uv sync && cd ../frontend && pnpm install && cd ..
cp .env.example .env   # 填入 DEEPSEEK_API_KEY 等配置
pnpm run dev            # 后端 :8000 + 前端 :3000
```

> 详细搭建见 **[开发入门指南](docs/onboarding.md)** · 运维见 [docs/operations.md](docs/operations.md)

---

## 架构

**可导航单体**：普通业务 router/service/model；训练业务收敛于 `modules/training` 单一复杂域；外部依赖在 `infra`；核心规则在 `core`。

- 前端 React 19 + **Mantine v9**（TypeScript · Vite）
- 后端 Python 3.13 · FastAPI · SQLAlchemy 2.0 · PostgreSQL 15
- 状态分层：正式产物（Message/Score）失败即业务失败；工具审计（TrainingAction）失败即工具失败；运行态（情绪/追问）可降级；指标 best-effort
- 提交规范 `<emoji> <type>: <description>`（Husky 校验，详见 [AGENTS.md](AGENTS.md)）

> 架构文档见 [docs/11-backend-organization-plan.md](docs/11-backend-organization-plan.md) · 评分设计见 [docs/llm.md](docs/llm.md)

---

## 在线环境

唯一部署实例（staging 已于 2026-09-14 退役，见 [docs/ops/single-instance-migration.md](docs/ops/single-instance-migration.md)）：

| 环境 | 地址 | 部署 |
|------|------|------|
| Production | [iomt.205716.xyz](https://iomt.205716.xyz) | 获得发布授权后使用 `pnpm run tag`；tag 触发 `deploy.yml`。当前 `production` 未配置 Required reviewers，推 tag 即发版，无人工审批等待 |

---

## 项目结构

```
backend/   main.py · core/ · models/ · schemas/ · modules/ · infra/ · migrations/
frontend/  React 19 + Mantine v9
docs/      架构/运维/重构文档（docs/review/ 为重构行动追踪）
deploy/    docker-compose · nginx · 监控 · 备份/回滚
scripts/   迁移模板 · 部署通知 · 开发报告 · case-audit 病例健康诊断
```

MIT
