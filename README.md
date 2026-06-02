# 虚拟患者训练系统

基于大语言模型的护理学生病史采集训练平台。

## 概览

学生与 LLM 驱动的虚拟患者进行自然语言对话，模拟真实病史采集。系统自动对沟通技能（14项）和病史采集（5项）进行 19 项细粒度评分（100分制），提供证据化反馈。教师可复核修改 AI 评分，管理用户和病例，监控 LLM 调用与成本。

> **版本:** v2026.05.31 · **数据库:** PostgreSQL · **部署:** Docker Compose

## 快速启动

```bash
# 首次安装
npm install
cd backend && uv sync && cd ..
cd frontend && npm install && cd ..

# 开发模式（一键启动前后端，Ctrl+C 停止）
npm run dev
```

- 后端: http://localhost:8000 （API 文档: /docs）
- 前端: http://localhost:3000

### 默认账号

| 角色   | 用户名      | 密码    |
|--------|-----------|---------|
| 教师   | admin     | admin123 |
| 学生   | student1~5 | 123456  |

## Docker 部署

```bash
# 根目录 .env 配置 DEEPSEEK_API_KEY 和 SECRET_KEY 后
docker compose up -d
```

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
- **DeepSeek 一键添加** — 仅需 API Key，自动配置官方参数
- **LLM 监控** — 调用日志、费用估算（per-key）、30天趋势、CSV 导出
- **采集进度** — 客户端关键词匹配，追踪关键问询覆盖
- **时长统计** — 每日趋势、累计分钟、学生排名

## 项目结构

```
├── backend/                  # FastAPI
│   ├── routers/              # API 路由（admin, chat, qa, training, ...）
│   ├── services/             # LLM 路由、日志、Prompt 管理、评分
│   ├── models.py / schemas.py
│   └── tests/
├── frontend/                 # React SPA
│   ├── src/pages/            # 页面组件
│   ├── src/components/       # UI 组件（teacher/, ui/）
│   └── src/api/              # API 客户端
├── docs/                     # 架构、API、数据库、前端设计文档
├── .github/workflows/        # CI（测试+构建）+ CD（v* tag 触发部署）
├── docker-compose.yml
├── Dockerfile.backend / Dockerfile.frontend
├── nginx.conf
└── package.json              # 根 npm scripts（npm run dev）
```

## 环境变量

将 `.env.example` 复制为 `.env`，按需配置：

```bash
# 必填
SECRET_KEY=<随机字符串>                   # JWT 签名 + API Key 加密派生
DEEPSEEK_API_KEY=sk-your-key            # 首次启动自动 seed 到数据库

# 数据库（Docker 部署自动使用容器内地址）
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/vptest

# 可选调参
LLM_CONCURRENT_LIMIT=10                 # 并发上限
LLM_MAX_RETRIES=3
POSTGRES_PASSWORD=postgres              # Docker PostgreSQL 密码
```

> Provider 配置、模型、定价等均在教师管理面板的「API 管理」中操作，无需通过环境变量。

## 仓库 Secrets（GitHub Actions）

| Secret            | 用途                        |
|-------------------|----------------------------|
| `DEEPSEEK_API_KEY`| LLM API 密钥（注入 .env）    |
| `SSH_HOST`        | 部署服务器地址                |
| `SSH_USER`        | 部署服务器用户名              |
| `SSH_PRIVATE_KEY` | SSH 私钥（用于部署认证）       |

## 部署与回滚

### CD 流水线

推送 `v*` tag 触发 Docker Build → GHCR → VPS 自动部署。部署前自动备份数据库，部署后健康检查，失败自动退回旧版本。

### 紧急回滚

**方式一：SSH 交互式回滚**（推荐，无需 GitHub 可用）

```bash
ssh <user>@<host> "cd /opt/nursing-vp-sim && bash rollback.sh"
# 交互界面列出最近 5 次部署，数字选择 → y/n 确认
```

**方式二：GitHub Actions**

Actions 页面 → Emergency Rollback → 输入版本号 → Run。

详见 [运维安全指南](docs/10-operations.md)。

## 提交规范

Husky + commitlint 强制校验格式：`<emoji> <type>: <描述>`

| Emoji | Type     | 说明       |
|-------|----------|-----------|
| ✨     | feat     | 新功能     |
| 🐛     | fix      | 修复       |
| 🚑     | hotfix   | 紧急线上修复 |
| 📝     | docs     | 文档       |
| ♻️     | refactor | 重构       |
| 🔧     | chore    | 杂项       |
| ✅     | test     | 测试       |
| 💄     | style    | 样式/UI    |
| 🎨     | ux       | 交互/体验   |
| 🚀     | ci       | 部署/CI    |
| 📦     | build    | 构建       |
| ⚡     | perf     | 性能       |
| 🔒     | security | 安全加固   |
| 🗃️     | db       | 数据库/迁移 |
| 🌐     | i18n    | 国际化     |
| 🔥     | revert   | 回滚/移除  |
| 🔀     | merge    | 分支合并   |
| ♿     | a11y    | 无障碍     |

示例：`✨ feat: 添加患者评分模块`

## 文档

- [系统架构](docs/01-architecture.md)
- [API 接口](docs/02-api-reference.md)
- [数据库设计](docs/03-database.md)
- [前端设计](docs/04-frontend.md)
- [LLM 与评分](docs/05-llm-design.md)
- [启动指南](docs/07-startup-guide.md)
- [运维安全指南](docs/10-operations.md)

## 许可

MIT — 已获原作者同意独立开发。
