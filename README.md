# 虚拟患者训练系统

基于大语言模型的护理学生病史采集训练平台。

## 概览

学生与 LLM 驱动的虚拟患者进行自然语言对话，模拟真实病史采集。系统自动对沟通技能（14项）和病史采集（5项）进行 19 项细粒度评分（100分制），提供证据化反馈。教师可复核修改 AI 评分，管理用户和病例，监控 LLM 调用与成本。

> **版本:** v2026.05.29 · **状态:** 生产就绪

## 快速启动

```bash
# 后端（端口 8000）
cd backend
uv sync
uv run uvicorn main:app --host 127.0.0.1 --port 8000 --reload

# 前端（端口 3000）
cd frontend
npm install
npm run dev
```

### 默认账号

| 角色   | 用户名     | 密码    |
|--------|-----------|---------|
| 教师   | admin     | admin123 |
| 学生   | student1~5 | 123456  |

## 技术栈

| 层级     | 技术 |
|----------|------|
| 后端     | Python 3.13 / FastAPI / SQLAlchemy 2.0 / SQLite WAL |
| 前端     | React 19 / Vite 8 / react-router-dom v7 / recharts |
| LLM      | DeepSeek Chat API（流式 SSE + JSON 模式） |
| 认证     | JWT（python-jose）+ bcrypt |
| 测试     | pytest（42条）+ Vitest（17条） |
| CI/CD    | GitHub Actions → Docker → GHCR → VPS 部署 |

## 核心功能

- **虚拟患者对话** — LLM 角色扮演，隐藏信息按关键词触发逐步披露
- **自动评分** — 19 项评分标准，每项附带对话证据 + 评分理由
- **教师复核** — 逐项修改 AI 评分 + 复核备注 + 复核徽章
- **流式对话** — SSE 逐字显示，首字延迟 <1s，打字光标动画
- **采集进度** — 客户端关键词匹配，追踪关键问询覆盖
- **LLM 监控** — 按用途统计调用次数/延迟/费用，训练级聚合
- **时长统计** — 每日趋势、累计分钟、学生排名
- **CSV 导出** — 流式导出训练记录
- **14 个 UI 组件** — CSS 变量设计体系，统一视觉风格

## 项目结构

```
├── backend/           # FastAPI（routers/、services/、models.py、schemas.py）
├── frontend/          # React SPA（pages/、components/ui/、styles/）
├── docs/              # 架构、API、数据库、前端设计文档
├── .github/workflows/ # CI（测试+构建）+ CD（Docker 推送+VPS 部署，v* tag 触发）
├── docker-compose.yml
├── Dockerfile.backend / Dockerfile.frontend
└── nginx.conf
```

## 环境变量

在项目根目录将 `.env.example` 复制为 `.env`：

```bash
# 必填
DEEPSEEK_API_KEY=sk-your-key
SECRET_KEY=<随机字符串>

# 可选
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com
CORS_ORIGINS=http://localhost:3000,http://localhost:8000
DATABASE_URL=sqlite:///data.db
```

## 仓库 Secrets（GitHub Actions）

CI/CD 流水线所需配置：

| Secret            | 用途                        |
|-------------------|----------------------------|
| `DEEPSEEK_API_KEY`| LLM API 密钥（注入 .env）    |
| `SSH_HOST`        | 部署服务器地址                |
| `SSH_USER`        | 部署服务器用户名              |
| `SSH_PRIVATE_KEY` | SSH 私钥（用于部署认证）       |

## 提交规范

Husky + commitlint 强制校验格式：`<emoji> <type>: <描述>`

| Emoji | Type     | 说明   |
|-------|----------|--------|
| ✨     | feat     | 新功能 |
| 🐛     | fix      | 修复   |
| 📝     | docs     | 文档   |
| ♻️     | refactor | 重构   |
| 🔧     | chore    | 杂项   |
| ✅     | test     | 测试   |
| 💄     | style    | 样式   |
| 🚀     | ci       | 部署   |
| 📦     | build    | 构建   |
| ⚡     | perf     | 性能   |

示例：`✨ feat: 添加患者评分模块`

## 文档

- [系统架构](docs/01-architecture.md)
- [API 接口](docs/02-api-reference.md)
- [数据库设计](docs/03-database.md)
- [前端设计](docs/04-frontend.md)
- [LLM 与评分](docs/05-llm-design.md)
- [启动指南](docs/07-startup-guide.md)

## 许可

MIT — 已获原作者同意独立开发。
