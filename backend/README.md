# 虚拟患者训练系统 — 后端

FastAPI 后端服务，为护理学生病史采集训练提供 API。

## 技术栈

- Python 3.13+ / FastAPI
- PostgreSQL 15 + SQLAlchemy 2.0 ORM + Alembic
- JWT 认证 (python-jose) + bcrypt
- 多 LLM Provider 路由（DeepSeek / OpenAI 兼容）
- Fernet 加密 API Key 存储

## 快速启动

```bash
# 安装依赖
uv sync

# 启动开发服务器
uv run uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

API 文档自动生成：`http://localhost:8000/docs`

## 项目结构

```
backend/
├── main.py              # FastAPI 入口 + lifespan
├── config.py            # 全局配置
├── database.py          # 数据库连接
├── models.py            # ORM 模型 (11 张表)
├── schemas.py           # Pydantic 模型
├── auth.py              # JWT 认证
├── logger.py            # 审计日志
├── rate_limiter.py      # 速率限制
├── pagination.py        # 分页工具
├── routers/             # API 路由 (11 个模块)
├── services/            # 业务逻辑 (7 个模块)
├── rubrics/             # 评分标准
├── cases/               # 病例数据 (JSON)
├── migrations/          # Alembic 迁移
└── tests/               # pytest 测试 (40 条)
```

## 运行测试

```bash
uv run python -m pytest tests/ -v
```
