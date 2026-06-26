# SQLite → PostgreSQL 迁移设计

> 状态: 设计评审通过 · 日期: 2026-05-29

## 1. 背景与目标

将 nursing-vp-sim 从 SQLite 迁移至 PostgreSQL，提升并发写入能力、原生时区支持、生产级可靠性。

**约束：**
- PG 密码明文存放于 `.env`，端口仅绑 `127.0.0.1` 不暴露公网
- 需要时通过 SSH 端口转发访问：`ssh -L 5432:localhost:5433 user@server`
- 不迁移现有数据，重新初始化种子数据（admin + student1~5 + 病例）
- PG 作为 Docker Compose service 运行，参考 emoguard_project 模式

## 2. 架构变更

```
Before:                          After:
┌──────────┐                    ┌──────────┐  ┌──────────┐
│ backend  │                    │ backend  │  │    PG    │
│  :8000   │                    │  :8000   │──│  :5432   │
│  SQLite  │                    │   (app)  │  │ (容器)   │
│  文件DB  │                    └──────────┘  └──────────┘
└──────────┘                         │              │
                              ┌──────┴──────┐       │
                              │  frontend   │       │
                              │   :80       │       │
                              └─────────────┘       │
                                           Docker Network
                                            (ai_vp_pg_data 命名卷持久化)
```

- Backend 通过 docker compose 内部网络 `postgresql://nursing:${POSTGRES_PASSWORD}@db:5432/nursing_vp` 连接
- PG 端口仅映射 `127.0.0.1:5433`（5432 已被 emoguard 占用），公网不可达
- 数据持久化：命名卷 `ai_vp_pg_data` → `/var/lib/postgresql/data`

## 3. 代码改动

### 3.1 database.py

| 改动 | 说明 |
|------|------|
| 移除 `connect_args={"check_same_thread": False}` | SQLite 特有 |
| 移除 `@event.listens_for(engine, "connect")` PRAGMA 监听器 | 全部 SQLite 特有 |
| `pool_size` 5→10, `max_overflow` 15→20 | PG 支持真正并发 |
| 移除整个 `_ensure_indexes()` 函数及 `init_db()` 中的调用 | 索引已在 models.py 的 `__table_args__` 定义，由 Alembic 管理；`exec_driver_sql()` 跨方言行为不可靠 |

### 3.2 models.py

- 删除 `UtcDateTime(TypeDecorator)` 类（约 20 行）
- 所有 `Column(UtcDateTime, ...)` → `Column(DateTime(timezone=True), ...)`
- `Integer` 主键保持不变（PG `SERIAL` 等价）

### 3.3 config.py

```python
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://nursing:nursing123@localhost:5433/nursing_vp")
```

### 3.4 pyproject.toml

新增依赖：
```
"psycopg2-binary>=2.9",
```

### 3.5 无需改动的文件

- `routers/*.py` — 全部使用 SQLAlchemy ORM，无原始 SQL（除 `SELECT 1` 兼容 PG）
- `services/*.py` — 全部 ORM 操作
- `main.py` — `text("SELECT 1")` 标准 SQL，PG 兼容
- `alembic.ini` — 动态读取 `DATABASE_URL`
- `migrations/env.py` — 动态读取 `DATABASE_URL`，无需改动
- `Dockerfile.backend` — psycopg2-binary 通过 uv 安装，curl 已存在

## 4. Alembic 迁移

- 删除现有 5 个 SQLite 迁移文件
- 生成 PG 原生初始迁移（`TIMESTAMPTZ`、`SERIAL PK`、`CREATE INDEX`）
- `migrations/env.py` 无需改动

## 5. Docker Compose 改动

### 5.1 新增 PG service

```yaml
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
```

### 5.2 Backend service 改动

- 新增 `depends_on: db: { condition: service_healthy }`
- `DATABASE_URL=postgresql://nursing:${POSTGRES_PASSWORD}@db:5432/nursing_vp`
- 移除 `db_data` volume 挂载
- 移除 `networks: [app-net]`（使用 compose 默认网络即可，无需自定义）

### 5.3 Volumes

```yaml
volumes:
  ai_vp_pg_data:
```

### 5.4 影响文件

- `docker-compose.yml` — 本地/开发
- `docker-compose.prod.yml` — 生产
- `deploy.sh` — 动态生成 compose 的 printf 段

## 6. CD 部署改动

### 6.1 deploy-production.yml

无需改动 GitHub Actions 文件。部署 compose 由 `deploy.sh` 动态生成。

### 6.2 deploy.sh

`--setup` 模式的 `.env` 模板新增：
```
POSTGRES_PASSWORD=<随机生成或手动填入>
```

动态 compose 生成新增 PG service（端口 `127.0.0.1:5433`）和 `ai_vp_pg_data` volume。

### 6.3 GitHub Secrets

无需新增。`POSTGRES_PASSWORD` 存储在服务器 `.env` 本地，不进入 CI/CD。

## 7. 环境变量

### .env.example 新增

```
POSTGRES_PASSWORD=nursing123
DATABASE_URL=postgresql://nursing:nursing123@localhost:5433/nursing_vp
```

### GitHub Actions 无需额外 Secrets

| Secret | 用途 | 变更 |
|--------|------|------|
| `SSH_HOST` | 部署服务器 IP | 不变 |
| `SSH_USER` | SSH 用户名 | 不变 |
| `SSH_PRIVATE_KEY` | SSH 私钥 | 不变 |

## 8. 开发模式

**Docker 开发：**
```bash
docker compose up -d   # 启动 backend + frontend + db
```

**裸机开发（不启动 backend 容器）：**
```bash
docker compose up -d db    # 仅启动 PG
cd backend && uv run uvicorn main:app --reload  # 手动启动后端
```

**连接 PG 调试（SSH 转发）：**
```bash
ssh -L 5432:localhost:5433 user@server
# 本地用 pgAdmin / psql 连接 localhost:5432（转发到远程 5433）
```

## 9. 迁移步骤（实施顺序）

1. 修改 `pyproject.toml` 添加 `psycopg2-binary`
2. 修改 `database.py` — 移除 SQLite 特定代码
3. 修改 `models.py` — 移除 `UtcDateTime`，改用 `DateTime(timezone=True)`
4. 修改 `config.py` — 更新默认 `DATABASE_URL`
5. 删除旧 Alembic 迁移，生成 PG 原生初始迁移
6. 修改 `docker-compose.yml`、`docker-compose.prod.yml` — 新增 PG service
7. 修改 `deploy.sh` — 动态 compose 含 PG
8. 修改 `.env.example` — 新增 `POSTGRES_PASSWORD`
9. 本地验证：`docker compose up -d` → 测试 API
10. 验证 SSH 转发连接 PG

## 10. 风险与回滚

- **风险低**：改动集中在基础设施层，router/service 无变更
- **回滚**：切换 `DATABASE_URL` 回 `sqlite:///` + 恢复旧 `database.py` + 移除 compose PG service
- **测试覆盖**：57 条测试（42 pytest + 17 vitest），迁移后必须全部通过
