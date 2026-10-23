# nursing-vp-sim（虚拟护理教学病人系统）

给护理专业学生进行问诊与治疗性沟通训练的虚拟患者平台：学生与大模型驱动的标准化病人多轮对话、按需开具床旁检查、记录护理评估，结束后由服务端逐条目打分并支持教师人工复核改分。

**状态**：可用（生产单实例稳定运行，M1 演练已跑通；双工对谈与结构化表现层待做）；**入口**：https://iomt.205716.xyz；**仓库**：[fire-disposal/nursing-vp-sim](https://github.com/fire-disposal/nursing-vp-sim)

## 本质

把自然语言护患问诊与查体操作转为结构化临床决策流，并由服务端完成证据抽取与条目级评分的教学仿真系统。

## 选型

基于 FastAPI + React 的前后端分离可导航单体，前端 Mantine v9，后端模块化领域设计，数据落 PostgreSQL，部署为单机 Docker Compose 容器。

- 运行时
  - Python 3.13 / Node 22
- 前端
  - React 19
    - Mantine v9
    - Vite
    - TypeScript
- 后端
  - FastAPI
    - SQLAlchemy 2.0
    - Pydantic v2
    - SSE 流式输出
- 数据
  - PostgreSQL 15 + Alembic 迁移
- 外部服务
  - 模型：DeepSeek / OpenAI 兼容 Provider（多 Provider 熔断与加权路由）
  - 语音：火山引擎 TTS（句子级流式分块合成与打断 abort）
- 部署
  - Docker Compose + Nginx + GitHub Actions

## 功能

- 虚拟患者对话：LLM 角色扮演，隐藏背景语义披露控制 + 出站泄漏守卫，SSE 逐字流式推送。
- 自动评分与证据链：19 项细粒度条目 0–2 分制（含护理记录），映射 100 分制；每项强绑定对话证据原句与扣分理由。
- 教师复核工作台：逐项改分、对话历史回放与证据高亮双向联动，复核结果写回持久化成绩单。
- 4D 情绪演化模型：信任、焦虑、烦躁、配合四维状态实时驱动患者回复语气与指示条，会话结束输出情绪轨迹。
- 查体与护理记录：HTTP 指令面 + revision 乐观并发控制 + 单一时间线审计。
- 多 Provider 路由：优先级加权、健康检查、熔断降级与 token 消耗记账。
- 未完成：双工实时语音对谈（持续拾音 + VAD 端点检测）；结构化视频化患者表现层。

## 启动流程

```bash
pnpm install && cd backend && uv sync && cd ../frontend && pnpm install && cd ..
cp .env.example .env
pnpm run dev            # 后端 :8000 + 前端 :3000
pnpm run test           # 单元测试与端点测试
```

前置：PostgreSQL 15（本机 5432 或 Docker）；运行时密钥以根目录 `.env` 为唯一权威，必需 `DATABASE_URL` 与 `DEEPSEEK_API_KEY`；首次启动由 Alembic 自动迁移数据库并载入内置标准病例。

## 边界与已知问题

- 结构假设：单实例内存缓存管理会话生命周期（空闲 30 分钟回收），不支持多实例水平扩展。
- 失败模式：LLM 上游超时或限流时触发降级兜底评分，该次评分显式标记为故障并移出排行榜。
- 表现层降级：写实头像仅支持内置几位患者（王建国/张美华等），未绑定患者降级为静态 SVG 占位。
- 文档漂移：部分历史文档仍提及 staging 环境，实际已于 2026-09-14 退役并下线，生产唯一实例为 `iomt.205716.xyz`。
- 训练结束契约：训练超时由客户端定时器与服务端判定双重守护，网络断连时终态以服务端收到的最后一条有效消息为准。

## 文档索引

- [docs/11-backend-organization-plan.md](docs/11-backend-organization-plan.md) — 后端架构与分层设计
- [docs/15-workflow-activity-contract.md](docs/15-workflow-activity-contract.md) — 训练工作流与状态机契约
- [docs/llm.md](docs/llm.md) — 评分机制与 Prompt 规范
- [docs/operations.md](docs/operations.md) — 生产环境运维与监控
- [TODO.md](TODO.md) — 当前迭代待办
