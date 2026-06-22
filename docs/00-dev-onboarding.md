# 00 — 参与开发快速指南

> 5 分钟完成环境搭建 + 掌握提交流程。详细规范见 AGENTS.md / CONTRIBUTING.md。

## 环境搭建

### 前置工具

| 工具 | 用途 | 安装 |
|------|------|------|
| uv | Python 环境 + 包管理（自动装 Python 3.13） | [docs.astral.sh/uv](https://docs.astral.sh/uv/getting-started/installation/) |
| Node.js ≥18 LTS | 前端 + pnpm scripts | [nodejs.org](https://nodejs.org/) |
| PostgreSQL 15 | 数据库 | [EDB Installer](https://www.enterprisedb.com/downloads/postgres-postgresql-downloads) (Windows) |
| Git ≥2.40 | 版本控制 | [git-scm.com](https://git-scm.com/) |
| DBeaver | 数据库 GUI（推荐） | [dbeaver.io](https://dbeaver.io/download/) |

> Python 不需单独安装——`uv sync` 会自动下载项目所需的 Python 3.13。Windows 用户安装 Git 时勾选 "Git Bash Here"。

### 克隆安装

```bash
git clone git@github.com:fire-disposal/nursing-vp-sim.git && cd nursing-vp-sim
pnpm install
cd backend && uv sync && cd ..
cd frontend && pnpm install && cd ..
```

### PostgreSQL（Windows 快速版）

1. 安装 PostgreSQL 15，组件勾选 **Server + Command Line Tools**，密码设为 `postgres`（与默认配置一致）
2. 创建数据库：`& "C:\Program Files\PostgreSQL\15\bin\createdb.exe" -U postgres vptest`
3. DBeaver 连接：Host=`localhost` / Port=`5432` / Database=`vptest` / User=`postgres`

### 环境变量

```bash
cp .env.example .env    # 填入 JWT_SECRET_KEY、FERNET_KEY、DEEPSEEK_API_KEY
```

```bash
# 核心变量
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/vptest
TEST_DB_URL=postgresql://postgres:postgres@localhost:5432/nursing_test
```

### 启动

```bash
pnpm run dev            # :8000 (backend) + :3000 (frontend)
```

默认账号：教师 `admin`/`admin123` · 学生 `student1~5`/`123456`

### 常见问题

| 症状 | 解决 |
|------|------|
| PostgreSQL 没运行 | `Start-Service postgresql-x64-15` (PowerShell) |
| 数据库连不上 | DBeaver 确认 `vptest` 库已建、密码正确 |
| `uv` 未找到 | 安装 uv → 重启终端 |
| 想清空数据库 | DBeaver 执行 `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` → 重启后端 |

## OpenCode + Superpowers

```bash
pnpm install -g @anthropic/opencode
# 启动后输入以下指令安装 Skills：
# Fetch and follow instructions from https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/.opencode/INSTALL.md
```

OpenCode 在本项目中自动遵循 Emoji 提交格式、`/api/` 路径前缀、ruff/Biome 风格。

## 提交与发版

| 操作 | 命令 |
|------|------|
| 提交 | `<emoji> <type>: <描述>`（Husky 强制校验） |
| 发版 | `pnpm run tag`（自动 tag + push → Staging 部署） |
| 正式服 | GitHub Actions → Deploy to Production（手动触发） |
| 回滚 | Actions → Emergency Rollback |

完整 Emoji 格式表见 [AGENTS.md](../AGENTS.md#commit-format)，分支流程见 [CONTRIBUTING.md](../CONTRIBUTING.md)。

## 测试

```bash
cd backend && uv run python -m pytest    # 后端
cd frontend && pnpm vitest run           # 前端
```

## 部署流水线

| 环境 | 域名 | 触发 | DB 端口 |
|------|------|------|---------|
| Staging | `test.205716.xyz` | 推送 `v*` tag | 5434 |
| Production | `iomt.205716.xyz` | `workflow_dispatch` | 5433 |

部署详情与运维见 [09-运维安全指南](09-operations.md)。

## 快速参考

```
┌─ 环境 ─────────────────────────────────────┐
│  pnpm install && uv sync && pnpm install     │
│  cp .env.example .env                        │
│  pnpm run dev                                │
├─ 提交 ─────────────────────────────────────┤
│  ✨ feat: 描述    🐛 fix: 描述               │
├─ 发版 ─────────────────────────────────────┤
│  pnpm run tag                                │
│  GitHub Actions → Deploy to Production       │
├─ 应急 ─────────────────────────────────────┤
│  Actions → Emergency Rollback                │
│  Actions → Maintenance Mode                  │
└─────────────────────────────────────────────┘
```

## 进一步阅读

| 文档 | 说明 |
|------|------|
| [AGENTS.md](../AGENTS.md) | 完整提交格式、pnpm scripts、Hook Chain |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | 分支模型、PR 规范 |
| [01-系统架构](01-architecture.md) | 技术栈与架构设计 |
| [09-运维安全指南](09-operations.md) | 部署、备份、应急预案 |
