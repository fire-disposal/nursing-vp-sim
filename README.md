# 虚拟患者训练系统

基于大语言模型的护理学生病史采集训练平台。

## 概览

学生与 LLM 驱动的虚拟患者进行自然语言对话，模拟真实病史采集。系统自动对沟通技能（14项）和病史采集（5项）进行 19 项细粒度评分（100分制），提供证据化反馈。教师可复核修改 AI 评分，管理用户和病例，监控 LLM 调用与成本。

> **版本:** v2026.06.04-5 · **数据库:** PostgreSQL · **部署:** Docker Compose

## 快速开始

```bash
# 首次安装
npm install
cd backend && uv sync && cd ..
cd frontend && npm install && cd ..

# 开发模式（一键启动前后端）
npm run dev
```

- 后端: http://localhost:8000 （API 文档: /docs）
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

- [完整文档中心](docs/README.md) — 架构、API、数据库、前端、运维等全部文档
- [开发入门](docs/00-dev-onboarding.md) — 环境搭建、提交规范、OpenCode 使用
- [系统架构](docs/01-architecture.md) — 技术栈与架构设计
- [API 接口](docs/02-api-reference.md) — 完整 API 端点
- [数据库设计](docs/03-database.md) — 表结构与关系映射
- [前端设计](docs/04-frontend.md) — 组件、路由、布局系统
- [开发日志](docs/06-dev-log.md) — 完整开发进度与历史
- [交接记录](docs/07-polish-handoff.md) — 当前状态与待完善问题
- [运维指南](docs/09-operations.md) — 部署、回滚、备份、应急预案
- [Git/CI 指南](GIT-GUIDE.md) — 提交规范与 CI/CD 流程
- [团队协作](CONTRIBUTING.md) — 分支模型、PR 规范、协作流程
- [设计规格](docs/superpowers/specs/) — 各功能模块设计文档
- [实施计划](docs/superpowers/plans/) — 各模块实施计划

## 项目结构

```
├── backend/                  # FastAPI
│   ├── routers/              # API 路由
│   ├── services/             # LLM 路由、评分、Prompt 管理
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

## 提交规范

Husky + commitlint 强制校验格式：`<emoji> <type>: <描述>`

| Emoji | Type     | 说明         |
|-------|----------|-------------|
| ✨     | feat     | 新功能        |
| 🐛     | fix      | 修复 bug     |
| 📝     | docs     | 文档         |
| ♻️     | refactor | 重构         |
| 🔧     | chore    | 杂项/配置     |
| ✅     | test     | 测试         |
| 🎨     | style    | UI/样式      |
| 🚀     | ci       | 部署/CI      |
| 📦     | build    | 构建         |
| ⚡     | perf     | 性能优化      |
| 🔀     | merge    | 分支合并      |
| 🔒     | security | 安全加固      |
| 🗃️     | db       | 数据库/迁移   |
| ⏪     | revert   | 回退         |
| 🔥     | remove   | 删除功能      |

> 完整规范见 [Git/Husky/CI/CD 快速入门](GIT-GUIDE.md)

## 许可

MIT — 已获原作者同意独立开发。
