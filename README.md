# Nursing VP Sim

> 护理学生虚拟患者训练平台 — LLM 角色扮演问诊 · 自动评分 · 教师复核 · 语音交互

📦 **Staging** [test.205716.xyz](https://test.205716.xyz) · 🚀 **Production** [iomt.205716.xyz](https://iomt.205716.xyz)

---

## 核心能力

- **虚拟患者对话** — LLM 角色扮演，隐藏背景语义披露 + 出站泄漏守卫，SSE 流式输出
- **自动评分** — 逐条目 0-2 分制（含护理记录维度），Σ条目映射 100 分制；每条附对话证据 + 评分理由；评分故障（LLM 兜底/维度丢失）显式标记，不进排行榜
- **教师复核** — 逐项改分工作台，对话回放 ↔ 证据点击联动；复核结果写回成绩单
- **计时硬截止** — 30 分钟纯墙钟训练窗口，到点自动交卷（离开页面不停表）
- **情感系统** — 4D 情绪模型（信任/焦虑/烦躁/配合）驱动患者行为，实时指示条 + 结果页轨迹图（事件标注）
- **语音交互** — 火山引擎 TTS 情感合成；**ASR 语音输入规划中**（对话通道已预留：文本/语音/通话共用单一出口）
- **工具指令面** — 查体/护理记录走 HTTP 指令 + revision 乐观并发 + 单一审计时间线
- **病例体系** — 内置病例 + AI 生成，统一校验器（时间线/症状/医学事实断言）守护内容质量
- **多 Provider 路由** — 优先级加权、熔断、限流、健康检查；env 兜底同源记账

---

## 快速开始

```bash
pnpm install && cd backend && uv sync && cd ../frontend && pnpm install && cd ..
cp .env.example .env   # 填入 DEEPSEEK_API_KEY 等配置
pnpm run dev            # 后端 :8000 + 前端 :3000
```

> 详细搭建见 **[开发入门指南](docs/00-dev-onboarding.md)** · 运维见 [docs/09-operations.md](docs/09-operations.md)

---

## 架构

**可导航单体**：普通业务 router/service/model；训练业务收敛于 `modules/training` 单一复杂域；外部依赖在 `infra`；核心规则在 `core`。

- 前端 React 19 + **Mantine v9**（TypeScript · Vite）
- 后端 Python 3.13 · FastAPI · SQLAlchemy 2.0 · PostgreSQL 15
- 状态分层：正式产物（Message/Score）失败即业务失败；工具审计（TrainingAction）失败即工具失败；运行态（情绪/追问）可降级；指标 best-effort
- 提交规范 `<emoji> <type>: <description>`（Husky 校验，详见 [AGENTS.md](AGENTS.md)）

> 架构文档见 [docs/11-backend-organization-plan.md](docs/11-backend-organization-plan.md) · 评分设计见 [docs/05-llm-design.md](docs/05-llm-design.md)

---

## 在线环境

| 环境 | 地址 | 部署 |
|------|------|------|
| Staging | [test.205716.xyz](https://test.205716.xyz) | Tag push 自动 |
| Production | [iomt.205716.xyz](https://iomt.205716.xyz) | 人工执行 |

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
