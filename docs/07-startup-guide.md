# 07 — 启动指南

> 适用版本: v2026.05.31 | 最后更新: 2026-05-31

## 环境要求

- Python 3.13+
- Node.js 18+
- PostgreSQL 15（Docker 或本地安装）
- [uv](https://docs.astral.sh/uv/)（Python 包管理）
- 可访问 LLM API（DeepSeek 等）

## Docker 部署（推荐）

```bash
# 1. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 SECRET_KEY 和 DEEPSEEK_API_KEY

# 2. 启动所有服务
docker compose up -d

# 3. 访问
# 前端: http://localhost （nginx 反向代理）
# 后端 API 文档: http://localhost:8000/docs
```

### Docker 服务说明

| 服务 | 端口 | 说明 |
|------|------|------|
| db | 5433 (host) → 5432 (container) | PostgreSQL 15 |
| backend | 8000 | FastAPI (uvicorn) |
| frontend | 80 | Nginx (SPA + API 代理) |

## 开发模式（本地）

### 1. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，至少配置：
```
SECRET_KEY=<随机字符串>
DEEPSEEK_API_KEY=sk-your-key
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/vptest
```

### 2. 启动 PostgreSQL

```bash
# 仅启动数据库容器
docker compose up -d db
```

或使用本地已安装的 PostgreSQL。

### 3. 启动后端

```bash
cd backend
uv sync                                              # 安装依赖
uv run uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

首次启动自动执行 Alembic 迁移并创建种子数据。

### 4. 启动前端

```bash
cd frontend
npm install
npm run dev
```

浏览器打开 `http://localhost:3000`

### 一键开发启动

项目根目录提供便捷脚本：

```bash
# 首次
npm install
cd backend && uv sync && cd ..
cd frontend && npm install && cd ..

# 启动（需先启动 PostgreSQL）
npm run dev
```

## 默认账号

| 角色 | 用户名 | 密码 |
|------|--------|------|
| 教师 | admin | admin123 |
| 学生1 | student1 | 123456 |
| 学生2 | student2 | 123456 |
| 学生3 | student3 | 123456 |
| 学生4 | student4 | 123456 |
| 学生5 | student5 | 123456 |

## 运行测试

### 后端 (pytest)
```bash
cd backend
uv run python -m pytest tests/ -v    # 40条测试
```

### 前端 (Vitest)
```bash
cd frontend
npx vitest run                       # 17条测试
```

总计 57 条测试，覆盖认证、训练流程、管理功能、前端组件。

## 环境变量完整列表

| 变量 | 默认值 | 说明 |
|------|--------|------|
| SECRET_KEY | (必填) | JWT签名密钥 + API Key 加密派生 |
| DEEPSEEK_API_KEY | (必填) | 首次启动自动 seed 为默认 Provider |
| DATABASE_URL | postgresql://postgres:postgres@localhost:5432/vptest | 数据库连接 |
| POSTGRES_PASSWORD | (Docker 必填) | Docker PostgreSQL 密码 |
| LLM_CHAT_TIMEOUT | 30 | 聊天请求超时(秒) |
| LLM_CHAT_MAX_TOKENS | 512 | 聊天最大输出token |
| LLM_SCORING_TIMEOUT | 120 | 评分请求超时(秒) |
| LLM_SCORING_MAX_TOKENS | 2048 | 评分最大输出token |
| LLM_CONCURRENT_LIMIT | 10 | LLM并发调用上限 |
| LLM_MAX_RETRIES | 3 | LLM调用失败最大重试次数 |
| LLM_CONNECTION_POOL_SIZE | 20 | HTTP连接池大小 |
| LLM_CONNECTION_KEEPALIVE | 10 | HTTP Keepalive连接数 |
| ACCESS_TOKEN_EXPIRE_MINUTES | 480 | JWT过期时间(分钟) |

> Provider、模型、定价等 LLM 参数均在教师管理面板「API 管理」中配置，无需环境变量。

## 常见问题

### 数据库重置

Docker 部署：
```bash
docker compose down -v
docker compose up -d
```

本地 PostgreSQL：
```bash
psql -U postgres -c "DROP DATABASE vptest"
psql -U postgres -c "CREATE DATABASE vptest"
```

### 前端 API 无法连接

开发模式确保 `frontend/vite.config.js` 代理配置正确：
```js
proxy: { "/api": "http://127.0.0.1:8000" }
```

### 添加新病例

**方式一（推荐）：教师后台在线管理**
1. 教师登录 → 管理后台 → 病例管理 → 添加病例
2. 填写结构化表单或上传 JSON 文件导入

**方式二：后端 JSON 文件**
1. 在 `backend/cases/` 下创建 `caseN.json`
2. 参照 `05-llm-design.md` 中的病例结构（含 `difficulty` 和 `time_limit` 字段）
3. 确保 `name` 为症状描述（不泄露诊断）
4. 重启后端自动导入
