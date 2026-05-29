# SQLite → PostgreSQL 迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 nursing-vp-sim 从 SQLite 迁移至 PostgreSQL 15（Docker Compose service），端口仅绑 127.0.0.1:5433，SSH 转发访问。

**Architecture:** PG 作为 compose 独立 service 运行，backend 通过 docker 网络 `postgresql://nursing:${POSTGRES_PASSWORD}@db:5432/nursing_vp` 连接。移除 SQLite 特定代码（PRAGMA、UtcDateTime、exec_driver_sql），重新生成 PG 原生 Alembic 迁移。

**Tech Stack:** Python 3.13 / FastAPI / SQLAlchemy 2.0 / Alembic / psycopg2-binary / PostgreSQL 15 / Docker Compose

**参考设计:** `docs/superpowers/specs/2026-05-29-sqlite-to-pgsql-migration-design.md`

---

### Task 1: 添加 psycopg2-binary 依赖

**Files:**
- Modify: `backend/pyproject.toml`

- [ ] **Step 1: 在 dependencies 中添加 psycopg2-binary**

将 `backend/pyproject.toml` 的 dependencies 列表末尾新增一行：

```toml
    "psycopg2-binary>=2.9",
```

插入位置在 `"sqlalchemy>=2.0.50",` 之后、`"uvicorn>=0.48.0",` 之前。

- [ ] **Step 2: 同步依赖锁文件**

```bash
uv sync
```

Run from `backend/` directory.

Expected: `uv.lock` 更新，新增 psycopg2-binary 及其依赖项。

- [ ] **Step 3: 验证依赖安装**

```bash
uv run python -c "import psycopg2; print(psycopg2.__version__)"
```

Expected: 输出版本号（如 `2.9.10`），无报错。

- [ ] **Step 4: Commit**

```bash
git add backend/pyproject.toml backend/uv.lock
git commit -m "📦 build: 添加 psycopg2-binary 依赖用于 PostgreSQL 迁移"
```

---

### Task 2: 修改 database.py — 移除 SQLite 特定代码

**Files:**
- Modify: `backend/database.py`

- [ ] **Step 1: 重写 database.py**

将 `backend/database.py` 替换为以下内容：

```python
import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import QueuePool

from config import DATABASE_URL

logger = logging.getLogger("alembic")

engine = create_engine(
    DATABASE_URL,
    poolclass=QueuePool,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=3600,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    import models  # noqa: F401

    try:
        from alembic.config import Config
        from alembic import command
        import os
        alembic_ini = os.path.join(os.path.dirname(__file__), "alembic.ini")
        if os.path.isfile(alembic_ini):
            alembic_cfg = Config(alembic_ini)
            command.upgrade(alembic_cfg, "head")
            return
    except Exception as e:
        logger.warning("Alembic 迁移失败，回退到 create_all: %s", e)

    Base.metadata.create_all(bind=engine)
```

与旧版相比移除的内容：
- `connect_args={"check_same_thread": False}` — SQLite 特有
- `@event.listens_for(engine, "connect")` PRAGMA 监听器 — SQLite 特有
- `_ensure_indexes()` 函数及 `init_db()` 中的调用 — 索引由 Alembic 管理
- 所有 `from sqlalchemy import event` 和 `cursor.execute(...)` 相关代码

与旧版相比的改动：
- `pool_size` 5→10, `max_overflow` 15→20 — PG 支持真正并发

- [ ] **Step 2: Commit**

```bash
git add backend/database.py
git commit -m "♻️ refactor: 移除 SQLite 特定代码，适配 PostgreSQL 连接池"
```

---

### Task 3: 修改 models.py — 移除 UtcDateTime，使用原生 DateTime(timezone=True)

**Files:**
- Modify: `backend/models.py`

- [ ] **Step 1: 删除 UtcDateTime 类定义**

删除第 8-21 行（整个 `class UtcDateTime(TypeDecorator):` 定义）：

```python
class UtcDateTime(TypeDecorator):
    """确保 SQLite 读写时 UTC 时区信息不丢失，Pydantic 序列化时带 Z/+00:00 后缀"""
    impl = SAType
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and value.tzinfo is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    def process_result_value(self, value, dialect):
        if value is not None:
            return value.replace(tzinfo=timezone.utc)
        return value
```

- [ ] **Step 2: 替换所有 Column 中的 UtcDateTime 为 DateTime(timezone=True)**

将文件中所有 `Column(UtcDateTime, ...)` 替换为 `Column(DateTime(timezone=True), ...)`。

涉及位置：
- `User.created_at`（第 33 行）
- `Case.created_at`（第 45 行）
- `TrainingRecord.start_time`（第 61 行）
- `TrainingRecord.end_time`（第 62 行）
- `Message.created_at`（第 80 行）
- `Score.reviewed_at`（第 106 行）
- `Score.created_at`（第 109 行）
- `Note.created_at`（第 119 行）
- `Note.updated_at`（第 120 行）
- `LLMCallLog.created_at`（第 149 行）

- [ ] **Step 3: 清理不再需要的 import**

将第 2 行的 import：

```python
from sqlalchemy import Column, Integer, String, Text, Float, DateTime as SAType, ForeignKey, JSON, Index
from sqlalchemy.types import TypeDecorator
```

改为：

```python
from sqlalchemy import Column, Integer, String, Text, Float, DateTime, ForeignKey, JSON, Index
```

移除 `as SAType` 别名和 `from sqlalchemy.types import TypeDecorator`。

同时移除第 1 行的 `from datetime import datetime, timezone` 中的 `timezone`（如果不再被其他地方引用的话——检查后发现 `datetime.now(timezone.utc)` 仍在用于 default 值，所以保留 `timezone`）。

- [ ] **Step 4: Commit**

```bash
git add backend/models.py
git commit -m "♻️ refactor: 移除 UtcDateTime type decorator，改用 PG 原生 TIMESTAMPTZ"
```

---

### Task 4: 修改 config.py — 更新默认 DATABASE_URL

**Files:**
- Modify: `backend/config.py`

- [ ] **Step 1: 修改默认 DATABASE_URL**

将第 16 行：

```python
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{os.path.join(BASE_DIR, 'data.db')}")
```

改为：

```python
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://nursing:nursing123@localhost:5433/nursing_vp")
```

- [ ] **Step 2: Commit**

```bash
git add backend/config.py
git commit -m "🔧 chore: 默认 DATABASE_URL 改为 PostgreSQL 连接串"
```

---

### Task 5: 重新生成 Alembic 迁移

**Files:**
- Delete: `backend/migrations/versions/a3512635829c_initial_schema.py`
- Delete: `backend/migrations/versions/b2c3d4e5f6g7_add_scoring_status.py`
- Delete: `backend/migrations/versions/c3d4e5f6g7h8_add_llm_call_logs.py`
- Delete: `backend/migrations/versions/d4e5f6g7h8i9_add_rubric_fields.py`
- Delete: `backend/migrations/versions/e5f6g7h8i9j0_add_score_review.py`
- Delete: `backend/migrations/versions/__pycache__/` (if exists)
- Create: `backend/migrations/versions/<rev>_initial_pg.py`

- [ ] **Step 1: 删除旧迁移文件**

```bash
Remove-Item -LiteralPath "backend\migrations\versions\a3512635829c_initial_schema.py" -Force
Remove-Item -LiteralPath "backend\migrations\versions\b2c3d4e5f6g7_add_scoring_status.py" -Force
Remove-Item -LiteralPath "backend\migrations\versions\c3d4e5f6g7h8_add_llm_call_logs.py" -Force
Remove-Item -LiteralPath "backend\migrations\versions\d4e5f6g7h8i9_add_rubric_fields.py" -Force
Remove-Item -LiteralPath "backend\migrations\versions\e5f6g7h8i9j0_add_score_review.py" -Force
```

(如果 `__pycache__/` 目录存在也一并删除)

- [ ] **Step 2: 生成 PG 原生初始迁移**

```bash
uv run alembic revision --autogenerate -m "initial_pg"
```

Run from `backend/` directory.

Expected: 在 `backend/migrations/versions/` 下生成新的迁移文件（如 `xxxx_initial_pg.py`），包含所有 7 张表的 CREATE TABLE 语句以及复合索引。

- [ ] **Step 3: 审查生成的迁移文件**

打开生成的文件，确认：
- 所有 `DateTime` 列使用了 `sa.DateTime(timezone=True)`（TIMESTAMPTZ）
- 复合索引存在（`ix_msg_record_created`、`ix_tr_user_status`、`ix_tr_status`）
- 无 SQLite 特定语法残留

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/versions/
git commit -m "🗃️ db: 重新生成 PostgreSQL 原生初始 Alembic 迁移"
```

---

### Task 6: 修改 docker-compose.yml（本地/开发）

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: 重写 docker-compose.yml**

将 `docker-compose.yml` 替换为：

```yaml
services:
  db:
    image: postgres:15
    container_name: nursing-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: nursing
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: nursing_vp
      TZ: Asia/Shanghai
    volumes:
      - ai_vp_pg_data:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5433:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U nursing -d nursing_vp"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s

  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    ports:
      - "8000:8000"
    volumes:
      - ./backend/cases:/app/cases:ro
    env_file:
      - .env
    environment:
      - DATABASE_URL=postgresql://nursing:${POSTGRES_PASSWORD}@db:5432/nursing_vp
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
    ports:
      - "80:80"
    depends_on:
      backend:
        condition: service_healthy
    restart: unless-stopped

volumes:
  ai_vp_pg_data:
```

与旧版相比：
- 新增 `db` service（PG 15，端口 127.0.0.1:5433）
- backend 新增 `depends_on: db` + 更新 `DATABASE_URL`
- backend 移除 `db_data` volume 挂载
- 移除 `db_data` 卷，新增 `ai_vp_pg_data` 卷

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "🐳 docker: 新增 PostgreSQL service，端口 127.0.0.1:5433"
```

---

### Task 7: 修改 docker-compose.prod.yml（生产）

**Files:**
- Modify: `docker-compose.prod.yml`

- [ ] **Step 1: 重写 docker-compose.prod.yml**

将 `docker-compose.prod.yml` 替换为：

```yaml
# 生产部署：使用 GHCR 预构建镜像
#
# === 使用方式 ===
#
# 方式一：deploy.sh 脚本（推荐）
#   ./deploy.sh --setup              # 首次：创建目录 + 生成 .env
#   ./deploy.sh --prod v1.17.0       # 部署指定版本
#
# === 数据库持久化 ===
# PostgreSQL 数据持久化于命名卷 ai_vp_pg_data。
# 容器重建、镜像更新均不会清空数据库。

services:
  db:
    image: postgres:15
    container_name: nursing-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: nursing
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: nursing_vp
      TZ: Asia/Shanghai
    volumes:
      - ai_vp_pg_data:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5433:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U nursing -d nursing_vp"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s

  backend:
    image: ghcr.io/${GITHUB_REPOSITORY_OWNER:-fire-disposal}/nursing-vp-sim-backend:${VERSION:-latest}
    ports:
      - "127.0.0.1:9001:8000"
    volumes:
      - ./cases:/app/cases:ro
    env_file:
      - .env
    environment:
      - DATABASE_URL=postgresql://nursing:${POSTGRES_PASSWORD}@db:5432/nursing_vp
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s

  frontend:
    image: ghcr.io/${GITHUB_REPOSITORY_OWNER:-fire-disposal}/nursing-vp-sim-frontend:${VERSION:-latest}
    ports:
      - "9000:80"
    depends_on:
      backend:
        condition: service_healthy
    restart: unless-stopped

volumes:
  ai_vp_pg_data:
```

与旧版相比：
- 新增 `db` service
- backend 新增 `depends_on: db` + 更新 `DATABASE_URL`
- backend 移除 `db_data` volume 挂载
- 移除 `db_data` 卷，新增 `ai_vp_pg_data` 卷

- [ ] **Step 2: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "🐳 docker: 生产 compose 新增 PostgreSQL service 和 ai_vp_pg_data 卷"
```

---

### Task 8: 修改 deploy.sh — 动态 compose 含 PG

**Files:**
- Modify: `deploy.sh`

- [ ] **Step 1: 修改 --setup 模式的 .env 模板**

将第 31-37 行改为：

```bash
  if [ ! -f .env ]; then
    echo "# 请填入你的 DeepSeek API Key 和数据库密码" > .env
    echo "DEEPSEEK_API_KEY=sk-your-key-here" >> .env
    echo "SECRET_KEY=$(openssl rand -hex 32)" >> .env
    echo "CORS_ORIGINS=https://你的域名.com" >> .env
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" >> .env
    echo ">> .env 已生成，请编辑填入正确的 DEEPSEEK_API_KEY、CORS_ORIGINS 和 POSTGRES_PASSWORD（如需）"
  fi
```

- [ ] **Step 2: 修改 --prod 模式的动态 compose 生成**

将第 83-104 行的 printf 段替换为：

```bash
  printf '%s\n' \
    'services:' \
    '  db:' \
    '    image: postgres:15' \
    '    container_name: nursing-db' \
    '    restart: unless-stopped' \
    '    environment:' \
    '      POSTGRES_USER: nursing' \
    '      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}' \
    '      POSTGRES_DB: nursing_vp' \
    '      TZ: Asia/Shanghai' \
    '    volumes:' \
    '      - ai_vp_pg_data:/var/lib/postgresql/data' \
    '    ports: ["127.0.0.1:5433:5432"]' \
    '    healthcheck:' \
    '      test: ["CMD-SHELL", "pg_isready -U nursing -d nursing_vp"]' \
    '      interval: 10s' \
    '      timeout: 5s' \
    '      retries: 5' \
    '      start_period: 20s' \
    '  backend:' \
    "    image: $IMG_BACKEND" \
    '    ports: ["127.0.0.1:9001:8000"]' \
    '    volumes:' \
    '      - ./cases:/app/cases:ro' \
    '    env_file: [.env]' \
    '    environment:' \
    '      - DATABASE_URL=postgresql://nursing:${POSTGRES_PASSWORD}@db:5432/nursing_vp' \
    '    depends_on:' \
    '      db:' \
    '        condition: service_healthy' \
    '    restart: unless-stopped' \
    '  frontend:' \
    "    image: $IMG_FRONTEND" \
    '    ports: ["9000:80"]' \
    '    depends_on:' \
    '      backend:' \
    '        condition: service_healthy' \
    '    restart: unless-stopped' \
    'volumes:' \
    '  ai_vp_pg_data:' \
    > docker-compose.yml
```

注意：应将文件中的 `${POSTGRES_PASSWORD}` 引用展开为实际值（部署脚本在 SSH 远程执行时，`.env` 已被 source）。

- [ ] **Step 3: 在 deploy 段前添加 env 加载**

在 `cd "$DEPLOY_DIR"` 之后、docker pull 之前，添加加载 .env 的代码——检查现有脚本是否已加载。当前脚本中 `docker compose down` 和 `docker compose up -d` 会从 `.env` 文件自动读取变量（compose 默认行为），所以无需显式 source。

- [ ] **Step 4: Commit**

```bash
git add deploy.sh
git commit -m "🚀 ci: deploy.sh 动态 compose 生成包含 PostgreSQL service"
```

---

### Task 9: 修改 .env.example — 新增 POSTGRES_PASSWORD

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: 追加 POSTGRES_PASSWORD 和更新 DATABASE_URL**

将 `.env.example` 文件末尾追加两行：

```
POSTGRES_PASSWORD=nursing123
DATABASE_URL=postgresql://nursing:nursing123@localhost:5433/nursing_vp
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "🔧 chore: .env.example 新增 POSTGRES_PASSWORD 和 PG DATABASE_URL"
```

---

### Task 10: 本地 .env 追加 POSTGRES_PASSWORD

**Files:**
- Modify: `.env`（本地，不入 git）

- [ ] **Step 1: 追加 PG 配置到本地 .env**

将以下两行追加到项目根目录的 `.env` 文件末尾：

```
POSTGRES_PASSWORD=nursing123
DATABASE_URL=postgresql://nursing:nursing123@db:5432/nursing_vp
```

注意：本地 Docker Compose 使用 `postgresql://nursing:nursing123@db:5432/nursing_vp`（host 为 db），非 Docker 裸机运行时使用 `postgresql://nursing:nursing123@localhost:5433/nursing_vp`。

- [ ] **Step 2: 无需 commit（.env 在 .gitignore 中）**

---

### Task 11: 本地 Docker Compose 验证

- [ ] **Step 1: 停止旧容器并清理旧卷**

```bash
docker compose down -v
```

- [ ] **Step 2: 构建并启动**

```bash
docker compose up -d --build
```

- [ ] **Step 3: 等待 PG 健康检查通过**

```bash
docker compose ps
```

Expected: `nursing-db` 状态为 `healthy`。

- [ ] **Step 4: 等待 backend 健康检查通过**

```bash
docker compose ps
```

Expected: backend 状态为 `healthy`。

- [ ] **Step 5: 验证 API**

```bash
curl -s http://localhost:8000/api/health
```

Expected: `{"status":"healthy","database":"connected","version":"..."}`

- [ ] **Step 6: 验证种子数据**

```bash
curl -s -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"admin123"}'
```

Expected: 返回 access_token。

- [ ] **Step 7: 验证 PG 数据持久化**

```bash
docker compose down
docker compose up -d
curl -s -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"admin123"}'
```

Expected: 重启后仍可登录（数据未丢失）。

- [ ] **Step 8: 清理本地验证环境**

```bash
docker compose down -v
```

---

### Task 12: 运行测试套件

- [ ] **Step 1: 运行后端测试**

```bash
uv run pytest tests/ -v --tb=short
```

Run from `backend/` directory.

Expected: 42 tests passed。测试使用 `conftest.py` 中硬编码的 `sqlite:///:memory:`，不受 PG 迁移影响。

- [ ] **Step 2: 运行前端测试**

```bash
npm run test -- --run
```

Run from `frontend/` directory.

Expected: 17 tests passed。

- [ ] **Step 3: Commit（如有修复）**

```bash
git add -A
git commit -m "✅ test: 确认 57 条测试全通过（SQLite → PG 迁移后）"
```

---

### Task 13: 服务器部署验证

> **前置条件：** SSH 到 yecaoyun 服务器

- [ ] **Step 1: 拉取最新代码**

```bash
ssh yecaoyun "cd /opt/nursing-vp-sim && git pull"
```

- [ ] **Step 2: 更新 .env**

确保服务器 `.env` 包含：
```
POSTGRES_PASSWORD=nursing123
DATABASE_URL=postgresql://nursing:nursing123@db:5432/nursing_vp
```

- [ ] **Step 3: 重新构建并部署**

```bash
ssh yecaoyun "cd /opt/nursing-vp-sim && docker compose down --timeout 30 && docker compose up -d --build"
```

- [ ] **Step 4: 验证服务**

```bash
ssh yecaoyun "curl -s http://localhost:9001/api/health"
```

Expected: healthy with database connected。

- [ ] **Step 5: 验证 SSH 转发连接 PG**

```bash
ssh -L 5432:localhost:5433 yecaoyun
```

在另一个终端：
```bash
psql -h localhost -p 5432 -U nursing -d nursing_vp
# 密码: nursing123
# 执行: \dt  — 应列出 7 张表
```

---

### Task 14: 清理旧 SQLite 卷（服务器）

> **前置条件：** 确认 PG 数据正常、种子数据正确后执行

- [ ] **Step 1: 删除旧 Docker 卷**

```bash
ssh yecaoyun "docker volume rm nursing-vp-sim_db_data"
```

- [ ] **Step 2: 验证卷已删除**

```bash
ssh yecaoyun "docker volume ls | grep nursing-vp-sim"
```

Expected: 只显示 `ai_vp_pg_data`，无 `db_data`。
