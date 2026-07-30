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

---

### 🚀 快速开始

```bash
pnpm install && cd backend && uv sync && cd ../frontend && pnpm install && cd ..
cp .env.example .env   # 填入 DEEPSEEK_API_KEY 等配置
pnpm run dev            # 后端 :8000 + 前端 :3000
```

> 详细搭建见 **[开发入门指南](docs/00-dev-onboarding.md)**

---

### 🏗 架构哲学

**可导航单体（bounded modular monolith）**——少量维护者 + 高频 AI agent 改动。目标不是企业级分层，而是可导航、可诊断、低跳转。

```text
普通业务：简单 router/service/model
训练业务：唯一复杂领域岛 modules/training
外部依赖：infra
核心内核：core
数据契约：models + schemas 顶层保留
```

**文件粒度**：1-15KB 理想，>25KB 按业务阶段拆分，>35KB 必须拆分。拆分按业务阶段（`session.py` / `session_views.py`），不按抽象层级（禁止 `manager.py` / `processor.py` / `helper.py`）。

**状态分层**：

| 层级 | 例子 | 存储 | 失败语义 |
|---|---|---|---|
| 正式产物 | Message, Score | PostgreSQL | 失败即业务失败 |
| 工具审计 | TrainingToolRequest | PostgreSQL | 失败即工具失败 |
| 运行态 | emotion, initiative | PostgreSQL 短期 | 可降级 |
| 指标日志 | metrics, LLM logs | memory / file | best-effort |

> 完整架构文档见 [docs/11-backend-organization-plan.md](docs/11-backend-organization-plan.md)

---

### 📂 项目结构

```
├── backend/
│   ├── main.py
│   ├── seed.py                # DB 种子（启动时调用）
│   ├── core/                  # 横跨全项目基础规则：config, db, auth, exceptions
│   ├── models/                # SQLAlchemy ORM — 顶层全局可见
│   ├── schemas/               # Pydantic API contract — 顶层全局可见
│   ├── modules/               # 业务入口，每模块 = 一个产品领域
│   │   ├── auth/              # router + service
│   │   ├── cases/             # 病例管理
│   │   ├── assignments/       # 练习发布
│   │   ├── training/          # 唯一复杂领域岛（7 子目录）
│   │   ├── qa/                # 护理学问答（router 子目录 + knowledge_base）
│   │   ├── voice/             # TTS 语音合成
│   │   ├── admin/             # 管理面板（15 文件，router+service 合并）
│   │   ├── feedback/          # 用户反馈
│   │   └── questionnaires/    # 随堂问卷
│   ├── infra/                 # 外部系统与运行设施
│   │   ├── bootstrap.py       # 启动编排
│   │   ├── diagnose.py        # 错误收集 + 诊断快照
│   │   ├── queue.py           # 评分队列
│   │   ├── realtime.py        # WebSocket 实时推送
│   │   ├── llm/               # LLM client, router, circuit, logging
│   │   ├── tts/               # TTS client, pool, circuit, mapper
│   │   └── volc/              # 火山引擎认证
│   ├── migrations/            # Alembic
│   ├── scripts/               # 代码生成器（permissions.ts, capabilities.ts）
│   └── tests/
├── frontend/                  # React 19, TypeScript, Vite, shadcn/ui
├── docs/                      # 项目文档
├── deploy/                    # docker-compose, nginx, 监控, 备份/回滚
├── .github/workflows/         # CI/CD
└── scripts/                   # 迁移模板, 部署通知, 开发报告生成
```

---

### 🛠 技术栈

| 层 | 技术 |
|---|------|
| 后端 | Python 3.13 · FastAPI · SQLAlchemy 2.0 · PostgreSQL 15 |
| 前端 | React 19 · TypeScript · Vite · Tailwind CSS v4 · shadcn/ui |
| LLM | DeepSeek / OpenAI 兼容 · 多 Provider 路由 · SSE 流式 |
| 认证 | JWT + bcrypt · 角色权限 (RBAC) |
| CI/CD | GitHub Actions → Docker → GHCR → VPS |

---

### 📖 文档

| | |
|---|---|
| **[开发入门](docs/00-dev-onboarding.md)** | 环境搭建 · 提交规范 · 发版流程 |
| [系统架构](docs/01-architecture.md) | 技术栈 · 路由 · 目录结构 |
| [后端组织](docs/11-backend-organization-plan.md) | 架构哲学 · 目录设计 · 迁移历史 |
| [数据库设计](docs/03-database.md) | 表结构 · 字段 · 索引 |
| [前端设计](docs/04-frontend.md) | 组件 · 路由 · 状态管理 |
| [LLM 与评分](docs/05-llm-design.md) | Prompt · Provider · 评分标准 |
| [运维指南](docs/09-operations.md) | 部署 · 备份 · 监控 · 回滚 |
| [功能审计](docs/10-functional-audit.md) | 功能矩阵 · 缺口 · 未来计划 |

---

### 📝 提交规范

`<emoji> <type>: <description>` — Husky 校验 + PR Gate 云端复核

`✨ feat` `🐛 fix` `♻️ refactor` `📝 docs` `🚀 ci` `🔧 chore` … 详见 [AGENTS.md](AGENTS.md)

---

### 🔗 在线环境

| 环境 | 地址 | 部署 |
|------|------|------|
| Staging | [test.205716.xyz](https://test.205716.xyz) | Tag push 自动 |
| Production | [iomt.205716.xyz](https://iomt.205716.xyz) | 手动触发 |
| Dev Report | [test.205716.xyz/report.html](https://test.205716.xyz/report.html) | Staging 部署后自动生成 |

---

MIT
