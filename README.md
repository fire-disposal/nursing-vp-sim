# Nursing VP Sim

> 基于 LLM 的护理学生虚拟患者训练平台 — 自然语言病史采集 · 自动评分 · 教师复核

📦 **Staging** [test.205716.xyz](https://test.205716.xyz) · 🚀 **Production** [iomt.205716.xyz](https://iomt.205716.xyz) · 📊 [开发报告](https://test.205716.xyz/report.html)

---

### ✨ 核心能力

- **虚拟患者对话** — LLM 角色扮演，隐藏信息关键词触发逐步披露，SSE 流式逐字显示
- **自动评分** — 19 项细粒度标准（100 分制），每项附带对话证据 + 评分理由
- **教师复核** — 逐项修改 AI 评分，复核徽章区分初评/已复核
- **情感追踪** — 实时情绪模型 + 轨迹可视化 + AI 行为驱动
- **语音交互** — 火山引擎 TTS/ASR，情感语音合成
- **护理记录** — 6 种可配置记录项，本地草稿 + 持久化
- **成本管理** — LLM + Voice 分项追踪，趋势图，预算对比
- **多 Provider 路由** — 优先级加权、熔断、限流、健康检查
- **Bounded Contexts** — `contexts/training/` `contexts/patient/` `contexts/qa/`

---

### 🚀 快速开始

```bash
pnpm install && cd backend && uv sync && cd ../frontend && pnpm install && cd ..
cp .env.example .env   # 填入 DEEPSEEK_API_KEY 等配置
pnpm run dev            # 后端 :8000 + 前端 :3000
```

> 详细搭建见 **[开发入门指南](docs/00-dev-onboarding.md)**

---

### 🛠 技术栈

| 层 | 技术 |
|---|------|
| 后端 | Python 3.13 · FastAPI · SQLAlchemy 2.0 · PostgreSQL 15 |
| 前端 | React 19 · TypeScript · Vite · Tailwind CSS v4 · shadcn/ui |
| LLM | DeepSeek / OpenAI 兼容 · 多 Provider 路由 · SSE 流式 |
| 认证 | JWT + bcrypt · Fernet 加密 · 角色权限 (RBAC) |
| 测试 | pytest · Vitest |
| CI/CD | GitHub Actions → Docker → GHCR → VPS |

---

### 📂 项目结构

```
├── backend/               # FastAPI (routers / contexts / infrastructure)
├── frontend/              # React SPA (pages / components / engine / plugins)
├── docs/                  # 项目文档
├── deploy/                # Docker Compose · Nginx · 监控脚本
├── .github/workflows/     # PR 门禁 · Staging · Production · 回滚
└── scripts/               # 迁移模板 · API 生成 · 开发报告
```

---

### 📖 文档

| | |
|---|---|
| **[开发入门](docs/00-dev-onboarding.md)** | 环境搭建 · 提交规范 · 发版流程 |
| [系统架构](docs/01-architecture.md) | 技术栈 · 路由 · 目录结构 |
| [数据库设计](docs/03-database.md) | 表结构 · 字段 · 索引 |
| [前端设计](docs/04-frontend.md) | 组件 · 路由 · 状态管理 |
| [LLM 与评分](docs/05-llm-design.md) | Prompt · Provider · 评分标准 |
| [运维指南](docs/09-operations.md) | 部署 · 备份 · 监控 · 回滚 |
| [功能审计](docs/10-functional-audit.md) | 功能矩阵 · 缺口 · 未来计划 |

---

### 📝 提交规范

`<emoji> <type>: <描述>` — Husky 校验 + PR Gate 云端复核

`✨ feat` `🐛 fix` `♻️ refactor` `📝 docs` `🚀 ci` `🔧 chore` … 详见 [AGENTS.md](AGENTS.md#commit-format)

---

### 🔗 在线环境

| 环境 | 地址 | 部署 |
|------|------|------|
| Staging | [test.205716.xyz](https://test.205716.xyz) | Tag push 自动 |
| Production | [iomt.205716.xyz](https://iomt.205716.xyz) | 手动触发 |
| Dev Report | [test.205716.xyz/report.html](https://test.205716.xyz/report.html) | Staging 部署后自动生成 |

---

MIT
