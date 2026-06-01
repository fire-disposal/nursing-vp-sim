# API 管理简化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Provider→Key 两层模型简化为 ApiSecret + LLMConfig 两实体，每个用途按 priority 降级路由，完善状态模型含自动恢复。

**Architecture:** 后端替换 `LLMRouter.select_key()` 为基于 LLMConfig 的 priority 遍历逻辑；前端 ApiManagementTab 拆为 Secrets + Configs 两个子标签页，Config 编辑器支持表单/JSON 双模式。

**Tech Stack:** Python/FastAPI/SQLAlchemy/Alembic (backend), React/JSX (frontend)

---

### Task 1: 新建 ApiSecret + LLMConfig 模型

**Files:**
- Modify: `backend/models.py` — 在 ApiKey 模型前插入新模型，保留旧模型标记 deprecated

- [ ] **Step 1: 添加 ApiSecret 模型**

在 `backend/models.py` 中 `class ApiProvider` 之前插入：

```python
class ApiSecret(Base):
    """API 密钥凭证（纯认证容器，不参与路由）"""
    __tablename__ = "api_secrets"

    id = Column(Integer, primary_key=True)
    label = Column(String(80), nullable=False)
    encrypted_key = Column(Text, nullable=False)
    key_suffix = Column(String(8), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    configs = relationship("LLMConfig", back_populates="secret", cascade="all, delete-orphan")
```

- [ ] **Step 2: 添加 LLMConfig 模型**

在 `ApiSecret` 之后插入：

```python
class LLMConfig(Base):
    """用途配置（计费单位 + 路由单位）"""
    __tablename__ = "llm_configs"
    __table_args__ = (
        UniqueConstraint("purpose", "priority", name="uq_llmconfig_purpose_priority"),
        Index("ix_llmconfig_purpose_priority", "purpose", "priority"),
    )

    id = Column(Integer, primary_key=True)
    secret_id = Column(Integer, ForeignKey("api_secrets.id"), nullable=False)
    label = Column(String(80), nullable=False)
    base_url = Column(String(200), nullable=False)
    model = Column(String(80), nullable=False)
    purpose = Column(String(40), nullable=False)
    priority = Column(Integer, nullable=False, default=100)

    status = Column(String(20), nullable=False, default="active")
    degraded_reason = Column(String(40), nullable=True)
    degraded_until = Column(DateTime(timezone=True), nullable=True)

    price_input_per_1m = Column(Numeric(10, 6), nullable=False, default=0)
    price_output_per_1m = Column(Numeric(10, 6), nullable=False, default=0)
    monthly_cost_limit = Column(Numeric(12, 6), nullable=True)

    call_count_today = Column(Integer, nullable=False, default=0)
    total_tokens_today = Column(BigInteger, nullable=False, default=0)
    total_cost_today = Column(Numeric(12, 6), nullable=False, default=0)
    monthly_cost_used = Column(Numeric(12, 6), nullable=False, default=0)
    stats_date = Column(Date, nullable=True)
    stats_month = Column(String(7), nullable=True)

    consecutive_failures = Column(Integer, nullable=False, default=0)
    last_used_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    secret = relationship("ApiSecret", back_populates="configs")
```

- [ ] **Step 3: 标记旧模型 deprecated**

在 `class ApiProvider` 和 `class ApiKey` 上方各添加警告注释，将 `__tablename__` 保持不变但增加标记：

```python
# DEPRECATED: 将被 ApiSecret + LLMConfig 取代，保留数据不下线
class ApiProvider(Base):
    ...

# DEPRECATED: 将被 ApiSecret + LLMConfig 取代，保留数据不下线
class ApiKey(Base):
    ...
```

- [ ] **Step 4: Commit**

```bash
git add backend/models.py
git commit -m "feat: add ApiSecret and LLMConfig models, deprecate old models"
```

---

### Task 2: 新建 Pydantic Schemas

**Files:**
- Modify: `backend/schemas.py`

- [ ] **Step 1: 添加 ApiSecret schemas**

```python
class ApiSecretCreate(BaseModel):
    label: str = Field(..., max_length=80)
    raw_key: str = Field(..., min_length=10, max_length=500)

class ApiSecretUpdate(BaseModel):
    label: Optional[str] = Field(None, max_length=80)

class ApiSecretResponse(BaseModel):
    id: int
    label: str
    key_suffix: str
    config_count: int = 0
    total_cost_today: float = 0
    monthly_cost_used: float = 0
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
```

- [ ] **Step 2: 添加 LLMConfig schemas**

```python
class LLMConfigCreate(BaseModel):
    secret_id: int
    label: str = Field(..., max_length=80)
    base_url: str = Field(..., max_length=200)
    model: str = Field(..., max_length=80)
    purpose: str = Field(..., max_length=40)
    priority: int = Field(default=100, ge=1, le=10000)
    price_input_per_1m: float = 0
    price_output_per_1m: float = 0
    monthly_cost_limit: Optional[float] = None

class LLMConfigUpdate(BaseModel):
    label: Optional[str] = Field(None, max_length=80)
    base_url: Optional[str] = Field(None, max_length=200)
    model: Optional[str] = Field(None, max_length=80)
    purpose: Optional[str] = Field(None, max_length=40)
    priority: Optional[int] = Field(None, ge=1, le=10000)
    status: Optional[str] = Field(None, pattern="^(active|disabled)$")
    price_input_per_1m: Optional[float] = None
    price_output_per_1m: Optional[float] = None
    monthly_cost_limit: Optional[float] = None

class LLMConfigResponse(BaseModel):
    id: int
    secret_id: int
    secret_label: str = ""
    secret_suffix: str = ""
    label: str
    base_url: str
    model: str
    purpose: str
    priority: int
    status: str
    degraded_reason: Optional[str] = None
    degraded_until: Optional[datetime] = None
    price_input_per_1m: float
    price_output_per_1m: float
    monthly_cost_limit: Optional[float] = None
    call_count_today: int
    total_tokens_today: int
    total_cost_today: float
    monthly_cost_used: float
    consecutive_failures: int
    last_used_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
```

- [ ] **Step 3: Commit**

```bash
git add backend/schemas.py
git commit -m "feat: add ApiSecret and LLMConfig pydantic schemas"
```

---

### Task 3: 创建 Alembic 迁移

**Files:**
- Create: `backend/migrations/versions/<timestamp>_api_management_simplification.py`

- [ ] **Step 1: 生成迁移文件**

```bash
cd backend
python -m alembic revision --autogenerate -m "api_management_simplification"
```

- [ ] **Step 2: 添加数据迁移逻辑**

生成的迁移文件中，在 upgrade() 的 create_tables 之后手动补充数据迁移：

```python
def upgrade() -> None:
    # auto-generated creates api_secrets + llm_configs tables
    # ... (autogenerated code) ...

    # Data migration: merge api_providers + api_keys → api_secrets + llm_configs
    conn = op.get_bind()

    # Step A: Insert into api_secrets from unique (encrypted_key, key_suffix) combos
    rows = conn.execute(sa.text("""
        INSERT INTO api_secrets (label, encrypted_key, key_suffix, created_at, updated_at)
        SELECT DISTINCT
            p.display_name || ' - Account',
            k.encrypted_key,
            k.key_suffix,
            k.created_at,
            k.updated_at
        FROM api_keys k
        JOIN api_providers p ON k.provider_id = p.id
    """)).rowcount
    print(f"  -> migrated {rows} secrets")

    # Step B: Insert into llm_configs from api_keys
    rows = conn.execute(sa.text("""
        INSERT INTO llm_configs (
            secret_id, label, base_url, model, purpose, priority, status,
            price_input_per_1m, price_output_per_1m, monthly_cost_limit,
            call_count_today, total_tokens_today, total_cost_today,
            monthly_cost_used, stats_date, stats_month,
            consecutive_failures, last_used_at, created_at, updated_at
        )
        SELECT
            s.id,
            COALESCE(k.label, p.display_name || '-' || k.key_suffix),
            p.base_url,
            COALESCE(k.model, p.default_model),
            k.purpose,
            COALESCE(k.priority, 100),
            k.status,
            k.price_input_per_1m, k.price_output_per_1m, k.monthly_cost_limit,
            k.call_count_today, k.total_tokens_today, k.total_cost_today,
            k.monthly_cost_used, k.stats_date, k.stats_month,
            k.consecutive_failures, k.last_used_at, k.created_at, k.updated_at
        FROM api_keys k
        JOIN api_providers p ON k.provider_id = p.id
        JOIN api_secrets s ON s.encrypted_key = k.encrypted_key AND s.key_suffix = k.key_suffix
    """)).rowcount
    print(f"  -> migrated {rows} configs")
```

- [ ] **Step 3: 在 upgrade() 末尾添加唯一约束**

```python
    op.create_unique_constraint("uq_llmconfig_purpose_priority", "llm_configs", ["purpose", "priority"])
```

- [ ] **Step 4: 测试迁移**

```bash
cd backend
python -m alembic upgrade head
python -m alembic downgrade -1
python -m alembic upgrade head
```

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/versions/
git commit -m "feat: add alembic migration for api_management_simplification"
```

---

### Task 4: 重写 LLMRouter 为基于 LLMConfig 的路由

**Files:**
- Modify: `backend/services/llm_router.py` — 完整重写
- Modify: `backend/services/llm_service.py:83` — 适配新 router 接口

- [ ] **Step 1: 重写 llm_router.py**

```python
"""LLM 路由调度器 —— 基于 LLMConfig priority 降级 + 熔断自动恢复"""
import asyncio
import logging
from datetime import datetime, timezone, timedelta

_logger = logging.getLogger("nursing")

CIRCUIT_BREAKER_THRESHOLD = 5
RATE_LIMIT_COOLDOWN_SECONDS = 60
DEGRADED_TTL_SECONDS = 300  # 5 min for consecutive_failures
GLOBAL_DEGRADED_TTL_SECONDS = 30


class ConfigRouter:
    def __init__(self):
        self._cache: list | None = None
        self._cache_by_purpose: dict[str, list] = {}
        self._global_degraded_until: datetime | None = None
        self._state_lock = asyncio.Lock()

    async def load_from_db(self):
        from database import SessionLocal
        from models import LLMConfig as LC
        from sqlalchemy import and_

        db = SessionLocal()
        try:
            now = datetime.now(timezone.utc)
            rows = db.query(LC).order_by(LC.purpose, LC.priority).all()

            # 自动恢复过期的 degraded 状态
            recovered = 0
            for r in rows:
                if r.status == "degraded" and r.degraded_until and r.degraded_until <= now:
                    r.status = "active"
                    r.degraded_reason = None
                    r.degraded_until = None
                    r.consecutive_failures = 0
                    recovered += 1
            if recovered:
                db.commit()

            by_purpose: dict[str, list] = {}
            for r in rows:
                by_purpose.setdefault(r.purpose, []).append(r)

            async with self._state_lock:
                self._cache = rows
                self._cache_by_purpose = by_purpose
                self._global_degraded_until = None

            _logger.info("ConfigRouter loaded: %d configs across %d purposes",
                         len(rows), len(by_purpose))
        except Exception:
            _logger.exception("ConfigRouter load failed")
            raise
        finally:
            db.close()

    def select_key(self, purpose: str):
        configs = self._cache_by_purpose.get(purpose, [])

        if self._global_degraded_until and datetime.now(timezone.utc) < self._global_degraded_until:
            raise RuntimeError("所有配置不可用，全局降级中")

        for cfg in configs:
            if cfg.status == "disabled":
                continue
            if cfg.status == "degraded":
                if cfg.degraded_until and datetime.now(timezone.utc) < cfg.degraded_until:
                    continue

            return cfg

        self._global_degraded_until = datetime.now(timezone.utc) + timedelta(seconds=GLOBAL_DEGRADED_TTL_SECONDS)
        raise RuntimeError(f"purpose={purpose} 无可用配置")

    def get_decrypted_key(self, config) -> str:
        from services.crypto_utils import decrypt_api_key
        return decrypt_api_key(config.secret.encrypted_key)

    def report_result(self, config, *, success: bool, tokens: int,
                      latency_ms: int, error: str | None):
        now = datetime.now(timezone.utc)

        if success:
            config.consecutive_failures = 0
            if config.status == "degraded":
                config.status = "active"
                config.degraded_reason = None
                config.degraded_until = None
            self._update_stats(config, tokens)
        else:
            if error and "429" in error:
                config.status = "degraded"
                config.degraded_reason = "rate_limited"
                config.degraded_until = now + timedelta(seconds=RATE_LIMIT_COOLDOWN_SECONDS)
                _logger.warning("LLMConfig %d rate limited, degraded for %ds", config.id, RATE_LIMIT_COOLDOWN_SECONDS)
            else:
                config.consecutive_failures += 1
                if config.consecutive_failures >= CIRCUIT_BREAKER_THRESHOLD:
                    config.status = "degraded"
                    config.degraded_reason = "consecutive_failures"
                    config.degraded_until = now + timedelta(seconds=DEGRADED_TTL_SECONDS)
                    _logger.warning("LLMConfig %d circuit broken: %d consecutive failures, degraded for %ds",
                                   config.id, CIRCUIT_BREAKER_THRESHOLD, DEGRADED_TTL_SECONDS)

            monthly = float(config.monthly_cost_used or 0)
            limit = float(config.monthly_cost_limit or 0)
            if limit > 0 and monthly >= limit:
                config.status = "degraded"
                config.degraded_reason = "cost_exceeded"
                next_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
                if now.month == 12:
                    next_month = next_month.replace(year=now.year + 1, month=1)
                else:
                    next_month = next_month.replace(month=now.month + 1)
                config.degraded_until = next_month

    def _update_stats(self, config, tokens: int):
        today = datetime.now(timezone.utc).date()
        month = today.strftime("%Y-%m")

        if config.stats_date is None or config.stats_date < today:
            config.call_count_today = 0
            config.total_tokens_today = 0
            config.total_cost_today = float(0)
            config.stats_date = today
        if config.stats_month is None or config.stats_month < month:
            config.monthly_cost_used = float(0)
            config.stats_month = month

        config.call_count_today = (config.call_count_today or 0) + 1
        config.total_tokens_today = (config.total_tokens_today or 0) + tokens
        avg_price = (float(config.price_input_per_1m or 0) + float(config.price_output_per_1m or 0)) / 2
        cost = avg_price * tokens / 1_000_000
        config.total_cost_today = float(config.total_cost_today or 0) + cost
        config.monthly_cost_used = float(config.monthly_cost_used or 0) + cost
        config.last_used_at = datetime.now(timezone.utc)

        # 超支检测
        limit = float(config.monthly_cost_limit or 0)
        if limit > 0 and float(config.monthly_cost_used) >= limit:
            config.status = "degraded"
            config.degraded_reason = "cost_exceeded"
            if config.degraded_until is None:
                now = datetime.now(timezone.utc)
                next_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
                if now.month == 12:
                    next_month = next_month.replace(year=now.year + 1, month=1)
                else:
                    next_month = next_month.replace(month=now.month + 1)
                config.degraded_until = next_month

        if config.call_count_today % 5 == 0:
            self._persist_config_stats(config)

    @staticmethod
    def _persist_config_stats(config):
        from database import SessionLocal
        from models import LLMConfig as LC
        db = SessionLocal()
        try:
            db_cfg = db.query(LC).filter(LC.id == config.id).first()
            if db_cfg:
                db_cfg.call_count_today = config.call_count_today
                db_cfg.total_tokens_today = config.total_tokens_today
                db_cfg.total_cost_today = float(config.total_cost_today or 0)
                db_cfg.monthly_cost_used = float(config.monthly_cost_used or 0)
                db_cfg.stats_date = config.stats_date
                db_cfg.stats_month = config.stats_month
                db_cfg.last_used_at = config.last_used_at
                db_cfg.status = config.status
                db_cfg.degraded_reason = config.degraded_reason
                db_cfg.degraded_until = config.degraded_until
                db_cfg.consecutive_failures = config.consecutive_failures
                db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()


_router: ConfigRouter | None = None
_router_lock = asyncio.Lock()


async def get_router() -> ConfigRouter:
    global _router
    if _router is not None:
        return _router
    async with _router_lock:
        if _router is None:
            _router = ConfigRouter()
            await _router.load_from_db()
    return _router


async def refresh_router():
    global _router
    if _router is None:
        _router = ConfigRouter()
    await _router.load_from_db()
```

- [ ] **Step 2: 适配 llm_service.py**

在 `call_llm` 函数（第 83 行附近）修改 `router.select_key(purpose)` 的调用方式，从 `(key, provider)` 元组改为返回 `config` 对象：

```python
    # Before: key, provider = router.select_key(purpose)
    # After:
    config = router.select_key(purpose)
    api_key = router.get_decrypted_key(config)
    provider_name = config.label  # 用于日志
    model = config.model
```

完整修改 `call_llm` 第 82-86 行附近：

```python
            config = router.select_key(purpose)
            api_key = router.get_decrypted_key(config)
            provider_name = config.label
            model = config.model

            payload = {
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }

            async with _sema:
                resp = await _client.post(
                    f"{config.base_url}/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                    timeout=httpx.Timeout(timeout, connect=15.0),
                )
```

同时更新 `report_result` 调用（第 107-108 行附近）：

```python
            if resp.status_code == 429:
                router.report_result(config, success=False, tokens=0,
                                     latency_ms=0, error=f"HTTP 429: {resp.text[:200]}")
```

以及成功分支（第 137-138 行）：

```python
            router.report_result(config, success=True, tokens=total_tokens,
                                 latency_ms=latency_ms, error=None)
```

- [ ] **Step 3: 更新 call_llm_stream 同理适配**

在 `call_llm_stream` 中同样替换 `router.select_key()` 调用。第 238-239 行和后续 key/url 引用。

- [ ] **Step 4: Commit**

```bash
git add backend/services/llm_router.py backend/services/llm_service.py
git commit -m "feat: rewrite router for ConfigRouter, adapt call_llm"
```

---

### Task 5: 重写 admin_api.py — Secrets + Configs CRUD

**Files:**
- Modify: `backend/routers/admin_api.py` — 完整替换

- [ ] **Step 1: 替换 imports 和 router 定义**

```python
"""API 管理 CRUD —— ApiSecret + LLMConfig"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models import User, ApiSecret, LLMConfig
from schemas import (
    ApiSecretCreate, ApiSecretUpdate, ApiSecretResponse,
    LLMConfigCreate, LLMConfigUpdate, LLMConfigResponse,
)
from auth import require_teacher
from services.llm_router import refresh_router
from services.crypto_utils import encrypt_api_key, decrypt_api_key
from datetime import datetime, timezone
import httpx

router = APIRouter(prefix="/api/admin/api", tags=["API管理"])
```

- [ ] **Step 2: 实现 ApiSecret CRUD**

```python
@router.get("/secrets", response_model=list[ApiSecretResponse])
def list_secrets(
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    secrets = db.query(ApiSecret).order_by(ApiSecret.created_at.desc()).all()
    result = []
    for s in secrets:
        config_count = db.query(LLMConfig).filter(LLMConfig.secret_id == s.id).count()
        cost_agg = db.query(
            func.coalesce(func.sum(LLMConfig.total_cost_today), 0),
            func.coalesce(func.sum(LLMConfig.monthly_cost_used), 0),
        ).filter(LLMConfig.secret_id == s.id).first()
        result.append(ApiSecretResponse(
            id=s.id, label=s.label, key_suffix=s.key_suffix,
            config_count=config_count,
            total_cost_today=float(cost_agg[0]),
            monthly_cost_used=float(cost_agg[1]),
            created_at=s.created_at, updated_at=s.updated_at,
        ))
    return result


@router.post("/secrets", status_code=201)
async def create_secret(
    data: ApiSecretCreate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    suffix = data.raw_key[-4:] if len(data.raw_key) >= 4 else "****"
    s = ApiSecret(
        label=data.label,
        encrypted_key=encrypt_api_key(data.raw_key),
        key_suffix=suffix,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return {"id": s.id, "key_suffix": s.key_suffix}


@router.put("/secrets/{secret_id}")
def update_secret(
    secret_id: int,
    data: ApiSecretUpdate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    s = db.query(ApiSecret).filter(ApiSecret.id == secret_id).first()
    if not s:
        raise HTTPException(404, "Secret 不存在")
    if data.label is not None:
        s.label = data.label
    db.commit()
    return {"ok": True}


@router.delete("/secrets/{secret_id}")
async def delete_secret(
    secret_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    s = db.query(ApiSecret).filter(ApiSecret.id == secret_id).first()
    if not s:
        raise HTTPException(404, "Secret 不存在")
    config_count = db.query(LLMConfig).filter(LLMConfig.secret_id == secret_id).count()
    if config_count > 0:
        raise HTTPException(400, f"该 Secret 关联了 {config_count} 个配置，请先删除配置")
    db.delete(s)
    db.commit()
    return {"ok": True}
```

- [ ] **Step 3: 实现 LLMConfig CRUD**

```python
@router.get("/configs", response_model=list[LLMConfigResponse])
def list_configs(
    purpose: str | None = Query(None),
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    q = db.query(LLMConfig)
    if purpose:
        q = q.filter(LLMConfig.purpose == purpose)
    configs = q.order_by(LLMConfig.purpose, LLMConfig.priority).all()
    result = []
    for c in configs:
        secret = db.query(ApiSecret).filter(ApiSecret.id == c.secret_id).first()
        result.append(LLMConfigResponse(
            id=c.id, secret_id=c.secret_id,
            secret_label=secret.label if secret else "",
            secret_suffix=secret.key_suffix if secret else "",
            label=c.label, base_url=c.base_url, model=c.model,
            purpose=c.purpose, priority=c.priority,
            status=c.status,
            degraded_reason=c.degraded_reason,
            degraded_until=c.degraded_until,
            price_input_per_1m=float(c.price_input_per_1m),
            price_output_per_1m=float(c.price_output_per_1m),
            monthly_cost_limit=float(c.monthly_cost_limit) if c.monthly_cost_limit else None,
            call_count_today=c.call_count_today or 0,
            total_tokens_today=c.total_tokens_today or 0,
            total_cost_today=float(c.total_cost_today or 0),
            monthly_cost_used=float(c.monthly_cost_used or 0),
            consecutive_failures=c.consecutive_failures or 0,
            last_used_at=c.last_used_at,
            created_at=c.created_at, updated_at=c.updated_at,
        ))
    return result


@router.post("/configs", status_code=201)
async def create_config(
    data: LLMConfigCreate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    secret = db.query(ApiSecret).filter(ApiSecret.id == data.secret_id).first()
    if not secret:
        raise HTTPException(404, "Secret 不存在")

    existing = db.query(LLMConfig).filter(
        LLMConfig.purpose == data.purpose,
        LLMConfig.priority == data.priority,
    ).first()
    if existing:
        raise HTTPException(400, f"purpose={data.purpose} priority={data.priority} 已存在")

    cfg = LLMConfig(
        secret_id=data.secret_id,
        label=data.label or f"{secret.label}-{data.purpose}",
        base_url=data.base_url,
        model=data.model,
        purpose=data.purpose,
        priority=data.priority,
        price_input_per_1m=data.price_input_per_1m,
        price_output_per_1m=data.price_output_per_1m,
        monthly_cost_limit=data.monthly_cost_limit,
    )
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    await refresh_router()
    return {"id": cfg.id}


@router.put("/configs/{config_id}")
async def update_config(
    config_id: int,
    data: LLMConfigUpdate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(404, "Config 不存在")

    update_data = data.model_dump(exclude_none=True)
    for k, v in update_data.items():
        setattr(cfg, k, v)

    db.commit()
    await refresh_router()
    return {"ok": True}


@router.delete("/configs/{config_id}")
async def delete_config(
    config_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(404, "Config 不存在")
    db.delete(cfg)
    db.commit()
    await refresh_router()
    return {"ok": True}


@router.post("/configs/{config_id}/toggle")
async def toggle_config(
    config_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(404, "Config 不存在")
    if cfg.status == "disabled":
        cfg.status = "active"
        cfg.degraded_reason = None
        cfg.degraded_until = None
        cfg.consecutive_failures = 0
    else:
        cfg.status = "disabled"
    db.commit()
    await refresh_router()
    return {"ok": True, "status": cfg.status}


@router.post("/configs/{config_id}/reset")
async def reset_config(
    config_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(404, "Config 不存在")
    cfg.status = "active"
    cfg.degraded_reason = None
    cfg.degraded_until = None
    cfg.consecutive_failures = 0
    db.commit()
    await refresh_router()
    return {"ok": True}


@router.post("/configs/{config_id}/test")
async def test_config(
    config_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(404, "Config 不存在")
    secret = db.query(ApiSecret).filter(ApiSecret.id == cfg.secret_id).first()
    api_key = decrypt_api_key(secret.encrypted_key)

    import time
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10)) as client:
            t0 = time.monotonic()
            resp = await client.get(
                f"{cfg.base_url}/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            latency = int((time.monotonic() - t0) * 1000)
            return {"ok": True, "status_code": resp.status_code, "latency_ms": latency}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}
```

- [ ] **Step 4: 保留 reload + health + stats 端点**

```python
@router.post("/reload")
async def reload_router(current_user: User = Depends(require_teacher)):
    await refresh_router()
    return {"ok": True}


@router.get("/health")
async def health_check(
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    configs = db.query(LLMConfig).distinct(LLMConfig.base_url).all()
    results = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(5)) as client:
        for c in configs:
            import time
            try:
                t0 = time.monotonic()
                resp = await client.get(f"{c.base_url}/v1/models")
                latency = int((time.monotonic() - t0) * 1000)
                results.append({
                    "base_url": c.base_url,
                    "status": "ok" if resp.status_code < 500 else "error",
                    "latency_ms": latency,
                    "error": None,
                })
            except Exception as e:
                results.append({
                    "base_url": c.base_url,
                    "status": "error",
                    "latency_ms": None,
                    "error": str(e)[:200],
                })
    return results
```

- [ ] **Step 5: 移除旧端点**

删除所有原 `providers` 和 `keys` 相关的路由处理函数（`list_providers`, `create_provider`, `update_provider`, `delete_provider`, `list_keys`, `create_key`, `create_deepseek_key`, `update_key`, `delete_key`, `toggle_key`, `reset_key`, `test_key`, `key_stats`, `api_aggregate_stats`）。保留 `reload` + `health`。

- [ ] **Step 6: Commit**

```bash
git add backend/routers/admin_api.py
git commit -m "feat: rewrite admin API for ApiSecret + LLMConfig CRUD"
```

---

### Task 6: 更新 seed 数据和 main.py 启动逻辑

**Files:**
- Modify: `backend/main.py` — lifespan 中的 seed 和 router 初始化

- [ ] **Step 1: 更新 LLMRouter 初始化**

在 `main.py` 的 `lifespan` 中将 seed 逻辑改为基于新模型：

```python
    try:
        from services.llm_router import refresh_router
        from services.crypto_utils import encrypt_api_key
        from config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL
        from database import SessionLocal
        from models import ApiSecret, LLMConfig

        db = SessionLocal()
        try:
            if DEEPSEEK_API_KEY and db.query(LLMConfig).count() == 0:
                suffix = DEEPSEEK_API_KEY[-4:] if len(DEEPSEEK_API_KEY) >= 4 else "****"
                secret = ApiSecret(
                    label=f"DeepSeek-{suffix}",
                    encrypted_key=encrypt_api_key(DEEPSEEK_API_KEY),
                    key_suffix=suffix,
                )
                db.add(secret)
                db.flush()

                purposes = ["qa", "patient_chat", "scoring", "case_generation"]
                for p in purposes:
                    cfg = LLMConfig(
                        secret_id=secret.id,
                        label=f"DeepSeek - {p}",
                        base_url=DEEPSEEK_BASE_URL,
                        model=DEEPSEEK_MODEL,
                        purpose=p,
                        priority=10,
                        price_input_per_1m=1,
                        price_output_per_1m=2,
                    )
                    db.add(cfg)
                db.commit()
                _startup_logger.info("已从 .env seed 默认 DeepSeek Secret + 4用途 Config")
        finally:
            db.close()

        await refresh_router()
    except Exception as e:
        _startup_logger.error("ConfigRouter 初始化失败: %s", e)
```

- [ ] **Step 2: Commit**

```bash
git add backend/main.py
git commit -m "feat: update seed data for ApiSecret + LLMConfig"
```

---

### Task 7: 重写 test_llm_router.py

**Files:**
- Modify: `backend/tests/test_llm_router.py`

- [ ] **Step 1: 重写测试**

```python
"""tests for ConfigRouter priority-based degradation routing"""
import pytest
from datetime import datetime, timezone, timedelta
from services.llm_router import ConfigRouter
from models import LLMConfig, ApiSecret


def _make_secret(id=1, label="test-secret", key="sk-xxxx", suffix="xxxx"):
    s = ApiSecret(id=id, label=label, encrypted_key=key, key_suffix=suffix)
    return s


def _make_config(id, secret, purpose="qa", priority=10, status="active",
                 model="test-model", base_url="https://test.api",
                 consecutive_failures=0, degraded_reason=None,
                 degraded_until=None):
    c = LLMConfig(
        id=id, secret_id=secret.id, label=f"cfg-{id}",
        base_url=base_url, model=model,
        purpose=purpose, priority=priority, status=status,
        consecutive_failures=consecutive_failures,
        degraded_reason=degraded_reason,
        degraded_until=degraded_until,
    )
    c.secret = secret
    return c


def test_select_key_single_config():
    router = ConfigRouter()
    secret = _make_secret()
    cfg = _make_config(1, secret)
    router._cache_by_purpose = {"qa": [cfg]}

    result = router.select_key("qa")
    assert result.id == 1


def test_select_key_skips_disabled():
    router = ConfigRouter()
    secret = _make_secret()
    cfg1 = _make_config(1, secret, priority=10, status="disabled")
    cfg2 = _make_config(2, secret, priority=20, status="active")
    router._cache_by_purpose = {"qa": [cfg1, cfg2]}

    result = router.select_key("qa")
    assert result.id == 2


def test_select_key_skips_degraded_in_cooldown():
    router = ConfigRouter()
    secret = _make_secret()
    cfg1 = _make_config(1, secret, priority=10, status="degraded",
                        degraded_until=datetime.now(timezone.utc) + timedelta(minutes=5))
    cfg2 = _make_config(2, secret, priority=20, status="active")
    router._cache_by_purpose = {"qa": [cfg1, cfg2]}

    result = router.select_key("qa")
    assert result.id == 2


def test_select_key_uses_degraded_after_ttl():
    router = ConfigRouter()
    secret = _make_secret()
    cfg1 = _make_config(1, secret, priority=10, status="degraded",
                        degraded_until=datetime.now(timezone.utc) - timedelta(seconds=1))
    cfg2 = _make_config(2, secret, priority=20, status="active")
    router._cache_by_purpose = {"qa": [cfg1, cfg2]}

    result = router.select_key("qa")
    assert result.id == 1


def test_select_key_all_unavailable():
    router = ConfigRouter()
    secret = _make_secret()
    cfg = _make_config(1, secret, status="disabled")
    router._cache_by_purpose = {"qa": [cfg]}

    with pytest.raises(RuntimeError, match="无可用配置"):
        router.select_key("qa")


def test_report_result_consecutive_failures_circuit_break():
    router = ConfigRouter()
    secret = _make_secret()
    cfg = _make_config(1, secret)
    router._cache_by_purpose = {"qa": [cfg]}

    for i in range(5):
        router.report_result(cfg, success=False, tokens=0, latency_ms=0, error="timeout")
    assert cfg.status == "degraded"
    assert cfg.degraded_reason == "consecutive_failures"


def test_report_result_429_sets_rate_limited():
    router = ConfigRouter()
    secret = _make_secret()
    cfg = _make_config(1, secret)
    router._cache_by_purpose = {"qa": [cfg]}

    router.report_result(cfg, success=False, tokens=0, latency_ms=0, error="HTTP 429")
    assert cfg.status == "degraded"
    assert cfg.degraded_reason == "rate_limited"


def test_report_result_success_clears_degraded():
    router = ConfigRouter()
    secret = _make_secret()
    cfg = _make_config(1, secret, status="degraded", degraded_reason="rate_limited",
                       degraded_until=datetime.now(timezone.utc) + timedelta(minutes=5),
                       consecutive_failures=3)
    router._cache_by_purpose = {"qa": [cfg]}

    router.report_result(cfg, success=True, tokens=100, latency_ms=50, error=None)
    assert cfg.status == "active"
    assert cfg.degraded_reason is None
    assert cfg.consecutive_failures == 0


def test_select_key_no_config_for_purpose():
    router = ConfigRouter()
    router._cache_by_purpose = {"qa": []}

    with pytest.raises(RuntimeError, match="无可用配置"):
        router.select_key("scoring")
```

- [ ] **Step 2: 运行测试确认通过**

```bash
cd backend
python -m pytest tests/test_llm_router.py -v
```

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_llm_router.py
git commit -m "test: rewrite LLM router tests for ConfigRouter"
```

---

### Task 8: 新增 backend Config API 集成测试

**Files:**
- Create: `backend/tests/test_llm_configs_api.py`

- [ ] **Step 1: 编写 CRUD 集成测试**

```python
"""integration tests for ApiSecret + LLMConfig CRUD endpoints"""
import pytest
from fastapi.testclient import TestClient
from main import app
from database import get_db, SessionLocal

client = TestClient(app)

TEST_USER_TOKEN = None


@pytest.fixture(scope="module", autouse=True)
def setup_token():
    global TEST_USER_TOKEN
    db = SessionLocal()
    try:
        from models import User
        from auth import hash_password, create_access_token
        user = db.query(User).filter(User.username == "admin").first()
        if not user:
            user = User(username="admin", password_hash=hash_password("admin123"),
                       role="teacher", display_name="Admin", student_id=None)
            db.add(user)
            db.commit()
            db.refresh(user)
        token = create_access_token(data={"user_id": user.id, "role": user.role})
        TEST_USER_TOKEN = f"Bearer {token}"
    finally:
        db.close()


def auth_header():
    return {"Authorization": TEST_USER_TOKEN}


def test_create_and_list_secret():
    resp = client.post("/api/admin/api/secrets", json={
        "label": "Test Secret",
        "raw_key": "sk-test1234567890abcdef",
    }, headers=auth_header())
    assert resp.status_code == 201
    secret_id = resp.json()["id"]

    resp = client.get("/api/admin/api/secrets", headers=auth_header())
    assert resp.status_code == 200
    secrets = resp.json()
    assert any(s["id"] == secret_id for s in secrets)


def test_create_config_with_purpose_priority_conflict():
    resp = client.post("/api/admin/api/configs", json={
        "secret_id": 1,
        "label": "QA-primary",
        "base_url": "https://api.test.com",
        "model": "test-model",
        "purpose": "qa",
        "priority": 10,
    }, headers=auth_header())
    assert resp.status_code == 201

    resp2 = client.post("/api/admin/api/configs", json={
        "secret_id": 1,
        "label": "QA-primary-duplicate",
        "base_url": "https://api.test.com",
        "model": "test-model-2",
        "purpose": "qa",
        "priority": 10,
    }, headers=auth_header())
    assert resp2.status_code == 400


def test_toggle_config():
    resp = client.get("/api/admin/api/configs?purpose=qa", headers=auth_header())
    configs = resp.json()
    assert len(configs) > 0
    cfg_id = configs[0]["id"]

    resp = client.post(f"/api/admin/api/configs/{cfg_id}/toggle", headers=auth_header())
    assert resp.status_code == 200
    assert resp.json()["status"] in ("active", "disabled")

    resp2 = client.post(f"/api/admin/api/configs/{cfg_id}/toggle", headers=auth_header())
    assert resp2.status_code == 200


def test_reset_config():
    resp = client.get("/api/admin/api/configs?purpose=qa", headers=auth_header())
    configs = resp.json()
    cfg_id = configs[0]["id"]

    resp = client.post(f"/api/admin/api/configs/{cfg_id}/reset", headers=auth_header())
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_delete_config():
    resp = client.get("/api/admin/api/configs", headers=auth_header())
    configs = resp.json()
    cfg_id = configs[-1]["id"]

    resp = client.delete(f"/api/admin/api/configs/{cfg_id}", headers=auth_header())
    assert resp.status_code == 200


def test_cannot_delete_secret_with_configs():
    resp = client.delete("/api/admin/api/secrets/1", headers=auth_header())
    assert resp.status_code == 400
    assert "配置" in resp.json()["detail"]
```

- [ ] **Step 2: 运行测试**

```bash
cd backend
python -m pytest tests/test_llm_configs_api.py -v
```

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_llm_configs_api.py
git commit -m "test: add ApiSecret + LLMConfig CRUD integration tests"
```

---

### Task 9: 更新前端 apiManagement.js

**Files:**
- Modify: `frontend/src/api/apiManagement.js` — 完整重写

- [ ] **Step 1: 替换为新的 API 函数**

```javascript
import { api } from "../api.js";

export function fetchSecrets() {
  return api.get("/admin/api/secrets");
}
export function createSecret(data) {
  return api.post("/admin/api/secrets", data);
}
export function updateSecret(id, data) {
  return api.put(`/admin/api/secrets/${id}`, data);
}
export function deleteSecret(id) {
  return api.delete(`/admin/api/secrets/${id}`);
}

export function fetchConfigs(purpose) {
  const params = {};
  if (purpose) params.purpose = purpose;
  return api.get("/admin/api/configs", { params });
}
export function createConfig(data) {
  return api.post("/admin/api/configs", data);
}
export function updateConfig(id, data) {
  return api.put(`/admin/api/configs/${id}`, data);
}
export function deleteConfig(id) {
  return api.delete(`/admin/api/configs/${id}`);
}
export function toggleConfig(id) {
  return api.post(`/admin/api/configs/${id}/toggle`);
}
export function resetConfig(id) {
  return api.post(`/admin/api/configs/${id}/reset`);
}
export function testConfig(id) {
  return api.post(`/admin/api/configs/${id}/test`);
}

export function reloadRouter() {
  return api.post("/admin/api/reload");
}
export function checkHealth() {
  return api.get("/admin/api/health");
}

export function fetchPrompts(purpose) {
  const params = {};
  if (purpose) params.purpose = purpose;
  return api.get("/admin/prompts", { params });
}
export function createPrompt(data) {
  return api.post("/admin/prompts", data);
}
export function updatePrompt(id, data) {
  return api.put(`/admin/prompts/${id}`, data);
}
export function deletePrompt(id) {
  return api.delete(`/admin/prompts/${id}`);
}
export function activatePrompt(id) {
  return api.post(`/admin/prompts/${id}/activate`);
}
export function validatePrompt(data) {
  return api.post("/admin/prompts/validate", data);
}
export function reloadPrompts() {
  return api.post("/admin/prompts/reload");
}
export function previewActivePrompt(purpose) {
  return api.get("/admin/prompts/active/preview", { params: { purpose } });
}
export function fetchSampleVars(purpose) {
  return api.get("/admin/prompts/sample-vars", { params: { purpose } });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api/apiManagement.js
git commit -m "feat: rewrite frontend API module for secrets + configs"
```

---

### Task 10: 新建 SecretModal.jsx

**Files:**
- Create: `frontend/src/components/teacher/SecretModal.jsx`

- [ ] **Step 1: 实现 SecretModal 组件**

```jsx
import { useEffect, useState } from "react";
import { createSecret, updateSecret } from "../../api/apiManagement";
import Modal from "../ui/Modal";
import { useToast } from "../Toast";

export default function SecretModal({ open, secret, onClose, onSaved }) {
  const [label, setLabel] = useState("");
  const [rawKey, setRawKey] = useState("");
  const [saving, setSaving] = useState(false);
  const { success, error } = useToast();
  const isEdit = secret != null;

  useEffect(() => {
    if (open) {
      setLabel(secret?.label || "");
      setRawKey("");
    }
  }, [open, secret]);

  const handleSave = async () => {
    if (!label.trim()) return;
    if (!isEdit && !rawKey.trim()) return;
    setSaving(true);
    try {
      if (isEdit) {
        await updateSecret(secret.id, { label: label.trim() });
        success("Secret 已更新");
      } else {
        await createSecret({ label: label.trim(), raw_key: rawKey.trim() });
        success("Secret 已创建");
      }
      onSaved();
      onClose();
    } catch (e) {
      error(e.response?.data?.detail || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "编辑密钥凭证" : "添加密钥凭证"}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <label>
          <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>标签</div>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="如: DeepSeek 个人账号"
            style={{
              width: "100%", padding: "var(--space-2) var(--space-3)",
              border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)",
              fontSize: "0.85rem", boxSizing: "border-box",
            }}
          />
        </label>
        {!isEdit && (
          <label>
            <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>API Key</div>
            <input
              type="password"
              value={rawKey}
              onChange={(e) => setRawKey(e.target.value)}
              placeholder="sk-..."
              style={{
                width: "100%", padding: "var(--space-2) var(--space-3)",
                border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)",
                fontSize: "0.85rem", boxSizing: "border-box",
              }}
            />
          </label>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
          <button onClick={onClose} className="btn btn-secondary">取消</button>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary">
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/teacher/SecretModal.jsx
git commit -m "feat: add SecretModal component"
```

---

### Task 11: 新建 ConfigModal.jsx（含 JSON 视图）

**Files:**
- Create: `frontend/src/components/teacher/ConfigModal.jsx`

- [ ] **Step 1: 实现表单视图 + JSON 视图双模编辑器**

```jsx
import { useEffect, useState } from "react";
import { createConfig, updateConfig, fetchSecrets } from "../../api/apiManagement";
import Modal from "../ui/Modal";
import { useToast } from "../Toast";

const PURPOSES = [
  { value: "qa", label: "问答 (QA)" },
  { value: "patient_chat", label: "患者对话" },
  { value: "scoring", label: "评分" },
  { value: "case_generation", label: "病例生成" },
];

export default function ConfigModal({ open, configData, onClose, onSaved }) {
  const [mode, setMode] = useState("form");
  const [secrets, setSecrets] = useState([]);
  const [saving, setSaving] = useState(false);
  const { success, error } = useToast();
  const isEdit = configData != null;

  const [form, setForm] = useState({
    secret_id: "", label: "", base_url: "", model: "",
    purpose: "qa", priority: 10,
    price_input_per_1m: 1, price_output_per_1m: 2,
    monthly_cost_limit: "",
  });
  const [jsonText, setJsonText] = useState("");

  useEffect(() => {
    if (open) {
      fetchSecrets()
        .then(({ data }) => setSecrets(data))
        .catch(() => {});
      if (configData) {
        const f = {
          secret_id: String(configData.secret_id || ""),
          label: configData.label || "",
          base_url: configData.base_url || "",
          model: configData.model || "",
          purpose: configData.purpose || "qa",
          priority: configData.priority || 10,
          price_input_per_1m: configData.price_input_per_1m ?? 1,
          price_output_per_1m: configData.price_output_per_1m ?? 2,
          monthly_cost_limit: configData.monthly_cost_limit ?? "",
        };
        setForm(f);
        setJsonText(JSON.stringify(configData, null, 2));
      } else {
        setForm({
          secret_id: secrets[0]?.id || "", label: "", base_url: "", model: "",
          purpose: "qa", priority: 10,
          price_input_per_1m: 1, price_output_per_1m: 2,
          monthly_cost_limit: "",
        });
        setJsonText("");
      }
    }
  }, [open, configData]);

  const updateField = (name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    let data;
    try {
      data = mode === "json" ? JSON.parse(jsonText) : { ...form };
    } catch {
      error("JSON 格式无效");
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await updateConfig(configData.id, data);
        success("配置已更新");
      } else {
        await createConfig(data);
        success("配置已创建");
      }
      onSaved();
      onClose();
    } catch (e) {
      error(e.response?.data?.detail || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const switchToJson = () => {
    setJsonText(JSON.stringify(form, null, 2));
    setMode("json");
  };
  const switchToForm = () => {
    try {
      const parsed = JSON.parse(jsonText);
      setForm((prev) => ({ ...prev, ...parsed }));
      setMode("form");
    } catch {
      error("当前 JSON 格式无效，无法切换");
    }
  };

  const inputStyle = {
    width: "100%", padding: "var(--space-2) var(--space-3)",
    border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)",
    fontSize: "0.85rem", boxSizing: "border-box",
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "编辑用途配置" : "添加用途配置"}>
      <div style={{ marginBottom: "var(--space-3)" }}>
        <button
          onClick={() => switchToForm()}
          style={{
            padding: "var(--space-1) var(--space-3)",
            border: mode === "form" ? "2px solid var(--color-primary)" : "2px solid var(--border-color)",
            background: "none", borderRadius: "var(--radius-md)", cursor: "pointer",
            fontWeight: mode === "form" ? 600 : 400, marginRight: 8,
          }}
        >
          表单视图
        </button>
        <button
          onClick={() => switchToJson()}
          style={{
            padding: "var(--space-1) var(--space-3)",
            border: mode === "json" ? "2px solid var(--color-primary)" : "2px solid var(--border-color)",
            background: "none", borderRadius: "var(--radius-md)", cursor: "pointer",
            fontWeight: mode === "json" ? 600 : 400,
          }}
        >
          JSON 视图
        </button>
      </div>

      {mode === "form" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <label>
            <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>密钥凭证</div>
            <select value={form.secret_id} onChange={(e) => updateField("secret_id", e.target.value)} style={inputStyle}>
              <option value="">选择...</option>
              {secrets.map((s) => (
                <option key={s.id} value={s.id}>{s.label} (sk-...{s.key_suffix})</option>
              ))}
            </select>
          </label>
          <label>
            <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>配置标签</div>
            <input value={form.label} onChange={(e) => updateField("label", e.target.value)} placeholder="如: QA用Pro模型" style={inputStyle} />
          </label>
          <label>
            <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>Base URL</div>
            <input value={form.base_url} onChange={(e) => updateField("base_url", e.target.value)} placeholder="https://api.deepseek.com" style={inputStyle} />
          </label>
          <div style={{ display: "flex", gap: "var(--space-3)" }}>
            <label style={{ flex: 1 }}>
              <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>模型</div>
              <input value={form.model} onChange={(e) => updateField("model", e.target.value)} placeholder="deepseek-v4-pro" style={inputStyle} />
            </label>
            <label style={{ flex: 1 }}>
              <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>用途</div>
              <select value={form.purpose} onChange={(e) => updateField("purpose", e.target.value)} style={inputStyle}>
                {PURPOSES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: "flex", gap: "var(--space-3)" }}>
            <label style={{ flex: 1 }}>
              <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>优先级 (越小越优先)</div>
              <input type="number" value={form.priority} onChange={(e) => updateField("priority", parseInt(e.target.value) || 10)} style={inputStyle} />
            </label>
            <label style={{ flex: 1 }}>
              <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>月度费用上限 (¥)</div>
              <input type="number" step="0.01" value={form.monthly_cost_limit} onChange={(e) => updateField("monthly_cost_limit", e.target.value)} placeholder="不限" style={inputStyle} />
            </label>
          </div>
          <div style={{ display: "flex", gap: "var(--space-3)" }}>
            <label style={{ flex: 1 }}>
              <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>入价/百万token</div>
              <input type="number" step="0.01" value={form.price_input_per_1m} onChange={(e) => updateField("price_input_per_1m", parseFloat(e.target.value) || 0)} style={inputStyle} />
            </label>
            <label style={{ flex: 1 }}>
              <div style={{ marginBottom: 4, fontWeight: 600, fontSize: "0.85rem" }}>出价/百万token</div>
              <input type="number" step="0.01" value={form.price_output_per_1m} onChange={(e) => updateField("price_output_per_1m", parseFloat(e.target.value) || 0)} style={inputStyle} />
            </label>
          </div>
        </div>
      ) : (
        <textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          style={{
            width: "100%", height: 360,
            padding: "var(--space-3)", border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-md)", fontSize: "0.8rem",
            fontFamily: "monospace", boxSizing: "border-box",
            resize: "vertical",
          }}
          placeholder='{"secret_id":1,"label":"...","base_url":"...","model":"...","purpose":"qa","priority":10}'
        />
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
        <button onClick={onClose} className="btn btn-secondary">取消</button>
        <button onClick={handleSave} disabled={saving} className="btn btn-primary">
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/teacher/ConfigModal.jsx
git commit -m "feat: add ConfigModal with form + JSON dual-view editor"
```

---

### Task 12: 重写 ApiManagementTab.jsx

**Files:**
- Modify: `frontend/src/components/teacher/ApiManagementTab.jsx` — 完整替换

- [ ] **Step 1: 重写为 Secrets + Configs 双标签页**

```jsx
import { Activity, Edit3, Plus, RefreshCw, Server, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkHealth, deleteConfig, deleteSecret, fetchConfigs, fetchSecrets,
  reloadRouter, resetConfig, testConfig, toggleConfig,
} from "../../api/apiManagement";
import { useToast } from "../Toast";
import { useConfirm } from "../ui/ConfirmDialog";
import ConfigModal from "./ConfigModal";
import SecretModal from "./SecretModal";

const STATUS_COLORS = {
  active: { bg: "var(--green-100)", color: "var(--green-700)" },
  degraded: { bg: "var(--amber-100)", color: "var(--amber-700)" },
  disabled: { bg: "var(--red-100)", color: "var(--red-700)" },
};
const STATUS_LABELS = { active: "正常", degraded: "熔断", disabled: "手动关闭" };
const PURPOSE_LABELS = { patient_chat: "患者对话", scoring: "评分", qa: "问答", case_generation: "病例生成" };

export default function ApiManagementTab() {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [subTab, setSubTab] = useState("configs");
  const [secrets, setSecrets] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [health, setHealth] = useState([]);
  const [healthAutoRefresh, setHealthAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [editingSecret, setEditingSecret] = useState(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [editingConfig, setEditingConfig] = useState(null);
  const toastRef = useRef(toast);

  useEffect(() => { toastRef.current = toast; }, [toast]);

  const loadSecrets = useCallback(() => {
    fetchSecrets()
      .then(({ data }) => setSecrets(data))
      .catch((err) => toastRef.current.error(err.response?.data?.detail || "加载密钥失败"));
  }, []);
  const loadConfigs = useCallback(() => {
    setLoading(true);
    fetchConfigs(null)
      .then(({ data }) => setConfigs(data))
      .catch((err) => toastRef.current.error(err.response?.data?.detail || "加载配置失败"))
      .finally(() => setLoading(false));
  }, []);
  const loadHealth = useCallback(() => {
    setLoading(true);
    checkHealth()
      .then(({ data }) => setHealth(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (subTab === "secrets") loadSecrets();
    else if (subTab === "configs") loadConfigs();
    else if (subTab === "health") loadHealth();
  }, [subTab]);

  useEffect(() => {
    if (!healthAutoRefresh || subTab !== "health") return;
    const timer = setInterval(loadHealth, 30000);
    return () => clearInterval(timer);
  }, [healthAutoRefresh, subTab]);

  const handleDeleteSecret = async (s) => {
    if (s.config_count > 0) {
      toastRef.current.error(`该密钥关联了 ${s.config_count} 个配置，请先删除配置`);
      return;
    }
    if (!(await confirm({ title: "删除密钥", message: `删除 "${s.label}"？`, confirmText: "删除", danger: true }))) return;
    try {
      await deleteSecret(s.id);
      toast.success("密钥已删除");
      loadSecrets();
    } catch (err) {
      toast.error(err.response?.data?.detail || "删除失败");
    }
  };

  const handleDeleteConfig = async (c) => {
    if (!(await confirm({ title: "删除配置", message: `删除 "${c.label}"？`, confirmText: "删除", danger: true }))) return;
    try {
      await deleteConfig(c.id);
      toast.success("配置已删除");
      loadConfigs();
    } catch (err) {
      toast.error(err.response?.data?.detail || "删除失败");
    }
  };

  const handleToggle = async (c) => {
    if (!(await confirm({ title: c.status === "active" ? "停用" : "启用", message: `${c.status === "active" ? "停用" : "启用"} "${c.label}"？`, confirmText: c.status === "active" ? "停用" : "启用" }))) return;
    try {
      await toggleConfig(c.id);
      loadConfigs();
    } catch (err) {
      toast.error(err.response?.data?.detail || "操作失败");
    }
  };
  const handleReset = async (c) => {
    try {
      await resetConfig(c.id);
      toast.success("已恢复");
      loadConfigs();
    } catch (err) {
      toast.error(err.response?.data?.detail || "恢复失败");
    }
  };
  const handleTest = async (c) => {
    try {
      const { data } = await testConfig(c.id);
      if (data.ok) toast.success(`${c.label} 连接正常 · ${data.latency_ms}ms`);
      else toast.error(data.error || "连接失败");
    } catch { toast.error("测试请求失败"); }
  };

  const groupedConfigs = {};
  configs.forEach((c) => {
    const p = c.purpose;
    if (!groupedConfigs[p]) groupedConfigs[p] = [];
    groupedConfigs[p].push(c);
  });

  const S = {};
  S.table = { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" };
  S.th = { padding: "var(--space-2) var(--space-3)", textAlign: "left", color: "var(--text-secondary)", fontWeight: 600, borderBottom: "2px solid var(--border-color)", fontSize: "0.75rem", textTransform: "uppercase" };
  S.td = { padding: "var(--space-2) var(--space-3)", borderBottom: "1px solid var(--border-color)" };
  S.btn = { background: "none", border: "none", cursor: "pointer", padding: "var(--space-1) var(--space-2)", borderRadius: "var(--radius-sm)", fontSize: "0.75rem", display: "inline-flex", alignItems: "center", gap: 4 };
  S.badge = (bg, c) => ({ padding: "2px 8px", borderRadius: "var(--radius-full)", fontSize: "0.75rem", background: bg, color: c });
  S.tabBtn = (active) => ({ padding: "var(--space-2) var(--space-4)", border: "none", background: "none", fontSize: "0.85rem", fontWeight: active ? 600 : 400, color: active ? "var(--color-primary)" : "var(--text-secondary)", cursor: "pointer", borderBottom: active ? "2px solid var(--color-primary)" : "2px solid transparent", marginBottom: -1, fontFamily: "inherit" });
  S.primaryBtn = { padding: "var(--space-2) var(--space-4)", border: "none", borderRadius: "var(--radius-md)", background: "var(--color-primary)", color: "#fff", cursor: "pointer", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "var(--space-1)" };

  return (
    <>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border-color)", marginBottom: "var(--space-5)" }}>
        {[
          { k: "configs", l: "用途配置" },
          { k: "secrets", l: "密钥凭证" },
          { k: "health", l: "连通性" },
        ].map((t) => (
          <button key={t.k} onClick={() => setSubTab(t.k)} style={S.tabBtn(subTab === t.k)}>{t.l}</button>
        ))}
      </div>

      {subTab === "secrets" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
            <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: 0 }}>密钥凭证</h3>
            <button onClick={() => { setEditingSecret(null); setShowSecretModal(true); }} style={S.primaryBtn}>
              <Plus size={14} /> 添加密钥
            </button>
          </div>
          <div className="card" style={{ overflow: "auto" }}>
            <table style={S.table}>
              <thead><tr><th style={S.th}>标签</th><th style={S.th}>Key</th><th style={S.th}>配置数</th><th style={S.th}>今日费用</th><th style={S.th}>本月费用</th><th style={S.th}>操作</th></tr></thead>
              <tbody>
                {secrets.length === 0 ? <tr><td colSpan={6} style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--text-tertiary)" }}>暂无密钥</td></tr> :
                  secrets.map((s) => (
                    <tr key={s.id}>
                      <td style={S.td}>{s.label}</td>
                      <td style={{ ...S.td, fontFamily: "monospace" }}>sk-...{s.key_suffix}</td>
                      <td style={S.td}>{s.config_count}</td>
                      <td style={S.td}>{s.total_cost_today ? `¥${Number(s.total_cost_today).toFixed(4)}` : "-"}</td>
                      <td style={S.td}>{s.monthly_cost_used ? `¥${Number(s.monthly_cost_used).toFixed(4)}` : "-"}</td>
                      <td style={S.td}>
                        <button onClick={() => { setEditingSecret(s); setShowSecretModal(true); }} style={{ ...S.btn, color: "var(--color-primary)" }}><Edit3 size={12} /></button>
                        <button onClick={() => handleDeleteSecret(s)} style={{ ...S.btn, color: "var(--red-400)" }}><Trash2 size={12} /></button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === "configs" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
            <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: 0 }}>用途配置</h3>
            <button onClick={() => { setEditingConfig(null); setShowConfigModal(true); }} style={S.primaryBtn}>
              <Plus size={14} /> 添加配置
            </button>
          </div>
          {loading ? <div style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--text-secondary)" }}>Loading...</div> :
            configs.length === 0 ? <div className="card" style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--text-tertiary)" }}>暂无配置</div> :
            Object.entries(groupedConfigs).map(([purpose, group]) => (
              <div key={purpose} style={{ border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", marginBottom: "var(--space-4)", overflow: "hidden" }}>
                <div style={{ padding: "var(--space-3) var(--space-4)", background: "var(--bg-surface-subtle)", borderBottom: "1px solid var(--border-color)", fontSize: "0.85rem", fontWeight: 600 }}>
                  {PURPOSE_LABELS[purpose] || purpose} ({group.length} 个配置)
                </div>
                <table style={S.table}>
                  <thead><tr><th style={S.th}>优先级</th><th style={S.th}>标签</th><th style={S.th}>Secret</th><th style={S.th}>模型</th><th style={S.th}>状态</th><th style={S.th}>调用</th><th style={S.th}>今日费用</th><th style={S.th}>操作</th></tr></thead>
                  <tbody>
                    {group.sort((a, b) => (a.priority || 0) - (b.priority || 0)).map((c) => {
                      const sc = STATUS_COLORS[c.status] || STATUS_COLORS.disabled;
                      const displayStatus = c.status === "degraded" ? `熔断·${c.degraded_reason || "unknown"}` : STATUS_LABELS[c.status];
                      return (
                        <tr key={c.id}>
                          <td style={S.td}>{c.priority}</td>
                          <td style={S.td}>{c.label}</td>
                          <td style={{ ...S.td, fontFamily: "monospace", fontSize: "0.8rem" }}>{c.secret_label || `sk-...${c.secret_suffix}`}</td>
                          <td style={S.td}>{c.model}</td>
                          <td style={S.td}><span style={S.badge(sc.bg, sc.color)} title={c.degraded_reason ? `原因: ${c.degraded_reason}\n恢复: ${c.degraded_until}` : ""}>{displayStatus}</span></td>
                          <td style={S.td}>{c.call_count_today ?? "-"}</td>
                          <td style={S.td}>{c.total_cost_today != null ? `¥${Number(c.total_cost_today).toFixed(4)}` : "-"}</td>
                          <td style={S.td}>
                            <button onClick={() => { setEditingConfig(c); setShowConfigModal(true); }} style={{ ...S.btn, color: "var(--color-primary)" }}><Edit3 size={12} /></button>
                            <button onClick={() => handleToggle(c)} style={{ padding: "2px 8px", borderRadius: "var(--radius-full)", fontSize: "0.7rem", fontWeight: 600, border: c.status === "active" ? "1px solid var(--red-300)" : "1px solid var(--green-300)", background: c.status === "active" ? "var(--red-50)" : "var(--green-50)", color: c.status === "active" ? "var(--red-600)" : "var(--green-600)", cursor: "pointer" }}>
                              {c.status === "active" ? "停用" : "启用"}
                            </button>
                            {c.status === "degraded" && (
                              <button onClick={() => handleReset(c)} style={{ ...S.btn, color: "var(--amber-500)" }}><RefreshCw size={12} /></button>
                            )}
                            <button onClick={() => handleTest(c)} style={{ ...S.btn, color: "var(--color-primary)" }}><Activity size={12} /></button>
                            <button onClick={() => handleDeleteConfig(c)} style={{ ...S.btn, color: "var(--red-400)" }}><Trash2 size={12} /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>
      )}

      {subTab === "health" && (
        <div>
          <div style={{ display: "flex", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
            <button onClick={loadHealth} style={S.primaryBtn}><Activity size={14} /> 检查连通性</button>
            <button onClick={() => reloadRouter().then(() => toast.success("已重载")).catch(() => toast.error("重载失败"))} className="btn btn-secondary"><Server size={14} /> 重载路由</button>
            <button onClick={() => setHealthAutoRefresh((v) => !v)} className="btn btn-secondary" style={{ background: healthAutoRefresh ? "var(--green-100)" : undefined }}>
              <RefreshCw size={14} /> {healthAutoRefresh ? "自动刷新中" : "自动刷新"}
            </button>
          </div>
          <div className="card" style={{ overflow: "auto" }}>
            <table style={S.table}>
              <thead><tr><th style={S.th}>端点</th><th style={S.th}>状态</th><th style={S.th}>延迟</th></tr></thead>
              <tbody>
                {health.length === 0 ? <tr><td colSpan={3} style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--text-tertiary)" }}>点击"检查连通性"</td></tr> :
                  health.map((h, i) => (
                    <tr key={i}>
                      <td style={S.td}>{h.base_url}</td>
                      <td style={S.td}><span style={S.badge(h.status === "ok" ? "var(--green-100)" : "var(--red-100)", h.status === "ok" ? "var(--green-700)" : "var(--red-700)")}>{h.status}</span></td>
                      <td style={S.td}>{h.latency_ms != null ? `${h.latency_ms}ms` : "-"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <SecretModal open={showSecretModal} secret={editingSecret} onClose={() => { setShowSecretModal(false); setEditingSecret(null); }} onSaved={loadSecrets} />
      <ConfigModal open={showConfigModal} configData={editingConfig} onClose={() => { setShowConfigModal(false); setEditingConfig(null); }} onSaved={loadConfigs} />
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/teacher/ApiManagementTab.jsx
git commit -m "feat: rewrite ApiManagementTab for secrets + configs with status-aware UI"
```

---

### Task 13: 更新 MonitorTab.jsx 适配新模型

**Files:**
- Modify: `frontend/src/components/teacher/MonitorTab.jsx`

- [ ] **Step 1: 更新 imports**

将 `import { getLLMStats, exportLLMLogs }` 从 `../../api` 改为 `../../api/apiManagement`（如果这些函数不移）。确认 `getLLMStats` 和 `getLLMLogs` 仍能在 `api.js` 中正常工作（它们查询 `llm_call_logs` 表，与模型变化无关，但统计面板可能需要从 LLMConfig 聚合）。

在 MonitorTab 中找到引用 `provider_name` 或 `key` 的地方，改为引用 `config` 相关字段。

- [ ] **Step 2: 确认无需大规模改动**

`MonitorTab.jsx` 主要查询 `llm_call_logs`，该表不变。只需确认 `getLLMStats` 和 `getLLMLogs` 函数入口在 `api.js` 中仍可访问。

```bash
git add frontend/src/components/teacher/MonitorTab.jsx
git commit -m "fix: verify MonitorTab compatibility with new model"
```

---

### Task 14: 清理旧代码

**Files:**
- Delete: `frontend/src/components/teacher/ProviderModal.jsx`
- Delete: `frontend/src/components/teacher/KeyModal.jsx`
- Modify: `backend/routers/admin_api.py` — 确认旧端点已全部移除

- [ ] **Step 1: 删除旧前端组件**

```bash
git rm frontend/src/components/teacher/ProviderModal.jsx
git rm frontend/src/components/teacher/KeyModal.jsx
git commit -m "chore: remove deprecated ProviderModal and KeyModal"
```

- [ ] **Step 2: 最终验证**

```bash
cd backend && python -m pytest tests/ -v --tb=short
cd frontend && npm run build
```

确认后端全部测试通过，前端构建成功。

- [ ] **Step 3: 最终 commit**

```bash
git add -A
git commit -m "chore: cleanup, all tests pass, build succeeds"
```
