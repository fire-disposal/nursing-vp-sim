# 虚拟患者训练系统

基于大语言模型的护理学生病史采集训练平台。

## 概览

学生与 LLM 驱动的虚拟患者进行自然语言对话，模拟真实病史采集。系统自动对沟通技能（14项）和病史采集（5项）进行 19 项细粒度评分（100分制），提供证据化反馈。教师可复核修改 AI 评分，管理用户和病例，监控 LLM 调用与成本。

> **数据库:** PostgreSQL · **部署:** Docker Compose

## 快速开始

> 零基础用户请先看 **[docs/00-dev-onboarding.md](docs/00-dev-onboarding.md)** — 工具安装、提交规范、部署流程，全程手把手。

```bash
# 首次安装
npm install
cd backend && uv sync && cd ..
cd frontend && npm install && cd ..

# 开发模式（一键启动前后端）
npm run dev
```

- 后端: http://localhost:8000（Swagger API 文档: /docs）
- 前端: http://localhost:3000
- 默认账号: 教师 `admin` / `admin123` | 学生 `student1~5` / `123456`

> 完整环境搭建和变量配置见 [参与开发快速指南](docs/00-dev-onboarding.md)

## 技术栈

| 层级     | 技术 |
|----------|------|
| 后端     | Python 3.13 / FastAPI / SQLAlchemy 2.0 / PostgreSQL |
| 前端     | React 19 / Vite 8 / react-router-dom v7 / recharts |
| LLM      | 多 Provider 路由（DeepSeek / OpenAI 兼容），流式 SSE |
| 认证     | JWT（python-jose）+ bcrypt |
| 加密     | Fernet 对称加密（SECRET_KEY 派生） |
| 测试     | pytest + Vitest |
| CI/CD    | GitHub Actions → Docker → GHCR → VPS 部署 |

## 核心功能

- **虚拟患者对话** — LLM 角色扮演，隐藏信息按关键词触发逐步披露
- **自动评分** — 19 项评分标准，每项附带对话证据 + 评分理由
- **教师复核** — 逐项修改 AI 评分 + 复核备注 + 复核徽章
- **流式对话** — SSE 逐字显示，支持重试与故障转移
- **多 API 管理** — 多 Provider/Key 优先级加权路由、熔断、限流、健康检查
- **Prompt 管理** — 数据库模板化，支持变量渲染、版本激活、热重载
- **LLM 监控** — 调用日志、费用估算、30天趋势、CSV 导出

## 文档导航

| 顺序 | 文档 | 说明 |
|------|------|------|
| **0** | **[docs/00-dev-onboarding.md](docs/00-dev-onboarding.md)** | 零基础入口：工具安装、提交规范、Git 工作流、CI/CD、OpenCode 用法 |
| | | |
| | [docs/01-architecture.md](docs/01-architecture.md) | 系统架构与技术栈 |
| | [API 文档](#api-文档) | Swagger UI（`/docs`）+ OpenAPI 自动生成类型 |
| | [docs/03-database.md](docs/03-database.md) | 数据库设计 |
| | [docs/04-frontend.md](docs/04-frontend.md) | 前端组件与路由 |
| | [docs/07-polish-handoff.md](docs/07-polish-handoff.md) | 当前状态与待完善问题 |
| | [docs/09-operations.md](docs/09-operations.md) | 运维、回滚、备份、应急预案 |
| | [CONTRIBUTING.md](CONTRIBUTING.md) | 分支模型、PR 规范 |
| | [docs/superpowers/specs/](docs/superpowers/specs/) | 各功能设计文档 |
| | [docs/superpowers/plans/](docs/superpowers/plans/) | 各功能实施计划 |

## 项目结构

```
├── backend/                  # FastAPI
│   ├── routers/              # API 路由
│   ├── contexts/             # 业务上下文（training / patient / qa）
│   ├── infrastructure/       # 基础设施（LLM、Prompt、缓存）
│   └── tests/
├── frontend/                 # React SPA
│   ├── src/pages/            # 页面组件
│   ├── src/components/       # UI 组件
│   └── src/api/              # API 客户端
├── docs/                     # 项目文档
├── .github/workflows/        # CI/CD 流水线
├── docker-compose.yml
├── Dockerfile.backend / Dockerfile.frontend
└── package.json              # 根 npm scripts
```

## API 文档

后端运行时访问 `http://localhost:8000/docs`（Swagger UI）。前端类型定义由 OpenAPI spec 自动生成到 `frontend/src/api/api-types.gen.ts`，API 客户端函数按领域拆分在 `frontend/src/api/*.ts`。

## 提交规范

Husky + commitlint 强制校验格式：`<emoji> <type>: <描述>`

> 完整格式表和使用说明见 **[docs/00-dev-onboarding.md](docs/00-dev-onboarding.md)**

## 许可

MIT — 已获原作者同意独立开发。
