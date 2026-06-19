# 虚拟患者训练系统

基于大语言模型的护理学生病史采集训练平台。

学生与 LLM 驱动的虚拟患者进行自然语言对话，模拟真实病史采集。系统自动评分（19 项细粒度，100 分制），提供证据化反馈。教师可复核修改评分，管理用户和病例，监控 LLM 调用与成本。

## 快速开始

```bash
pnpm install && cd backend && uv sync && cd .. && cd frontend && pnpm install && cd ..
pnpm run dev
```

- 后端: http://localhost:8000（Swagger: `/docs`）
- 前端: http://localhost:3000
- 默认账号: 教师 `admin`/`admin123` · 学生 `student1~5`/`123456`

> 完整搭建流程见 **[docs/00-dev-onboarding.md](docs/00-dev-onboarding.md)**

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Python 3.13 / FastAPI / SQLAlchemy 2.0 / PostgreSQL |
| 前端 | React 19 / Vite / react-router-dom v7 / Tailwind CSS v4 |
| LLM | 多 Provider 路由（DeepSeek / OpenAI 兼容），流式 SSE |
| 认证 | JWT + bcrypt · 加密: Fernet（SECRET_KEY 派生） |
| 测试 | pytest + Vitest |
| CI/CD | GitHub Actions → Docker → GHCR → VPS |

## 核心功能

- **虚拟患者对话** — LLM 角色扮演，隐藏信息按关键词触发逐步披露
- **自动评分** — 19 项标准，每项附带对话证据 + 评分理由
- **教师复核** — 逐项修改 AI 评分 + 复核备注 + 复核徽章
- **流式 SSE** — 逐字显示，支持重试与故障转移
- **多 Provider 管理** — 优先级加权路由、熔断、限流、健康检查
- **Prompt 管理** — 数据库模板化，变量渲染、版本激活、热重载
- **LLM 监控** — 调用日志、费用估算、趋势图、CSV 导出

## 项目结构

```
├── backend/                  # FastAPI
│   ├── routers/              # API 路由
│   ├── contexts/             # 业务上下文（training / patient / qa）
│   ├── infrastructure/       # 基础设施（LLM、缓存、队列）
│   ├── models.py / schemas.py # ORM 模型 / Pydantic schema
│   └── tests/
├── frontend/                 # React SPA
│   ├── src/pages/ / src/components/ / src/engine/ / src/plugins/
│   └── src/api/              # API 客户端
├── docs/ / .github/workflows/ / deploy/
├── docker-compose.yml / Dockerfile.*
└── package.json              # 根 pnpm scripts
```

## 文档导航

| 文档 | 说明 |
|------|------|
| **[00-dev-onboarding](docs/00-dev-onboarding.md)** | 零基础入口 |
| [01-系统架构](docs/01-architecture.md) | 技术栈与架构 |
| [03-数据库设计](docs/03-database.md) | 表结构与字段 |
| [04-前端设计](docs/04-frontend.md) | 组件与路由 |
| [05-LLM与评分](docs/05-llm-design.md) | Prompt 与评分 |
| [09-运维指南](docs/09-operations.md) | 部署、备份、应急预案 |
| [10-功能审计](docs/10-functional-audit.md) | 功能矩阵、缺口、未来方向 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 分支模型、PR 规范 |
| [plans/](docs/plans/) | 待完成功能计划 |

## 提交规范

`<emoji> <type>: <描述>`，Husky 强制校验。格式表见 [AGENTS.md](AGENTS.md#commit-format)。

## 许可

MIT
