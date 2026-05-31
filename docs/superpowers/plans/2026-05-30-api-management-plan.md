# API 管理数据库内化 + 多 API 支持 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 LLM API 管理从 .env 环境变量迁移到数据库，支持多 provider (DeepSeek/OpenAI)、多 key 负载均衡、自动故障回退，通过 Web UI 管理面板配置。

**Architecture:** 新增 3 张表 (`api_providers`/`api_keys`/`api_key_rules`) + LLMRouter 单例路由层 + Admin CRUD API + 前端管理 Tab。Router 在内存缓存全量配置，根据 purpose 按 priority 分组、组内加权随机选 key，失败自动降级。

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2.0, Alembic, React 19, Vite, cryptography (Fernet)

---

### Task 1: 新增模型 + 改造 LLMCallLog

**Files:**
- Modify: `backend/models.py`
- Create: `backend/services/crypto_utils.py`

- [ ] **Step 1: 添加 crypto_utils.py**

```python
"""API Key 加密工具 —— Fernet 对称加密"""
import base64
import hashlib
import os
from cryptography.fernet import Fernet

_ENV_KEY = os.getenv("KEY_ENCRYPTION_KEY", "")

def _derive_fernet() -> Fernet:
    if _ENV_KEY:
        return Fernet(_ENV_KEY.encode())
    # fallback: derive from SECRET_KEY (less secure, for transition)
    from config import SECRET_KEY
    raw = hashlib.sha256(SECRET_KEY.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(raw))

_fernet: Fernet | None = None

def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = _derive_fernet()
    return _fernet

def encrypt_api_key(raw: str) -> str:
    return _get_fernet().encrypt(raw.encode()).decode()

def decrypt_api_key(encrypted: str) -> str:
    return _get_fernet().decrypt(encrypted.encode()).decode()
```

- [ ] **Step 2: 在 models.py 末尾添加 3 个新模型**

```python
# --- API Management Models ---

class ApiProvider(Base):
    __tablename__ = "api_providers"

    id = Column(Integer, primary_key=True)
    name = Column(String(40), unique=True, nullable=False)
    display_name = Column(String(80), nullable=False)
    base_url = Column(String(200), nullable=False)
    api_type = Column(String(20), nullable=False, default="openai_compatible")
    default_model = Column(String(80), nullable=False)
    is_enabled = Column(Boolean, nullable=False, default=True)
    priority = Column(Integer, nullable=False, default=100)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    keys = relationship("ApiKey", back_populates="provider", cascade="all, delete-orphan")


class ApiKey(Base):
    __tablename__ = "api_keys"

    id = Column(Integer, primary_key=True)
    provider_id = Column(Integer, ForeignKey("api_providers.id"), nullable=False)
    label = Column(String(80), nullable=False)
    encrypted_key = Column(Text, nullable=False)
    key_suffix = Column(String(8), nullable=False)
    model = Column(String(80), nullable=True)
    weight = Column(Integer, nullable=False, default=10)
    status = Column(String(20), nullable=False, default="active")  # active / rate_limited / disabled
    price_input_per_1m = Column(Numeric(10, 6), nullable=False, default=0)
    price_output_per_1m = Column(Numeric(10, 6), nullable=False, default=0)
    currency = Column(String(10), nullable=False, default="CNY")
    balance = Column(Numeric(12, 6), nullable=True)
    monthly_cost_limit = Column(Numeric(12, 6), nullable=True)
    call_count_today = Column(Integer, nullable=False, default=0)
    total_tokens_today = Column(BigInteger, nullable=False, default=0)
    total_cost_today = Column(Numeric(12, 6), nullable=False, default=0)
    stats_date = Column(Date, nullable=True)
    monthly_cost_used = Column(Numeric(12, 6), nullable=False, default=0)
    stats_month = Column(String(7), nullable=True)
    consecutive_failures = Column(Integer, nullable=False, default=0)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    rate_limit_until = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    provider = relationship("ApiProvider", back_populates="keys")
    rules = relationship("ApiKeyRule", back_populates="api_key", cascade="all, delete-orphan")


class ApiKeyRule(Base):
    __tablename__ = "api_key_rules"
    __table_args__ = (
        UniqueConstraint("api_key_id", "purpose", name="uq_key_purpose"),
    )

    id = Column(Integer, primary_key=True)
    api_key_id = Column(Integer, ForeignKey("api_keys.id"), nullable=False)
    purpose = Column(String(40), nullable=False)
    priority = Column(Integer, nullable=False, default=100)
    is_enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    api_key = relationship("ApiKey", back_populates="rules")
```

- [ ] **Step 3: 修改 LLMCallLog**

将 `models.py:121` 的 `provider` 字段改为：
```python
    provider_name = Column(String(40), nullable=False, default="deepseek")
```
并新增：
```python
    api_key_id = Column(Integer, ForeignKey("api_keys.id"), nullable=True, index=True)
```

- [ ] **Step 4: 确认 models.py 顶部 import 完整**

确保已导入 `Numeric`, `BigInteger`, `Date`, `UniqueConstraint`, `relationship`：
```python
# models.py 顶部补全
from sqlalchemy import (
    Column, Integer, String, Text, Float, Boolean, DateTime, Date,
    BigInteger, Numeric, JSON, ForeignKey, Index, UniqueConstraint,
)
from sqlalchemy.orm import relationship
from datetime import datetime, timezone, date
```

- [ ] **Step 5: 在 config.py 添加 KEY_ENCRYPTION_KEY**

```python
# config.py 在 LLM 配置段之前添加
KEY_ENCRYPTION_KEY = os.getenv("KEY_ENCRYPTION_KEY", "")
```

- [ ] **Step 6: Commit**

```bash
git add backend/services/crypto_utils.py backend/models.py backend/config.py
git commit -m "✨ feat: add api_providers/api_keys/api_key_rules models and encryption utils"
```

---

### Task 2: 数据库迁移

**Files:**
- Create: `backend/migrations/versions/<hash>_api_management.py` (via alembic autogenerate)

- [ ] **Step 1: 生成迁移**

```bash
cd backend && uv run alembic revision --autogenerate -m "api_management"
```

- [ ] **Step 2: 检查生成的文件**

确认 up/down 包含：`api_providers`, `api_keys`, `api_key_rules` 三张表 + `llm_call_logs` 的 `provider_name` 和 `api_key_id` 字段变更。

- [ ] **Step 3: 运行迁移**

```bash
cd backend && uv run alembic upgrade head
```

- [ ] **Step 4: 验证**

```bash
PGPASSWORD=postgres psql -U postgres -h 127.0.0.1 -d vptest -c "\dt api_*"
```
Expected: 列出 `api_providers`, `api_keys`, `api_key_rules`

```bash
PGPASSWORD=postgres psql -U postgres -h 127.0.0.1 -d vptest -c "\d llm_call_logs" | grep -E "provider_name|api_key_id"
```
Expected: 显示两个字段

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/versions/
git commit -m "🔧 chore: add api_management migration"
```

---

### Task 3: LLMRouter 核心路由

**Files:**
- Create: `backend/services/llm_router.py`
- Test: `backend/tests/test_llm_router.py`

- [ ] **Step 1: 写 Router 测试**

```python
"""backend/tests/test_llm_router.py"""
import pytest
from services.llm_router import LLMRouter

router = LLMRouter()

def _make_config(keys_data):
    """模拟从数据库加载的配置: {provider_id: {provider, keys, rules}}"""
    providers = {}
    for pid, pd in keys_data.items():
        p = type("p", (), {"id": pid, "name": pd["name"], "display_name": pd["name"],
                            "base_url": pd["base_url"], "default_model": pd.get("model", "gpt-4"),
                            "is_enabled": pd.get("is_enabled", True),
                            "priority": pd.get("provider_priority", 100)})()
        keys = []
        for kd in pd["keys"]:
            k = type("k", (), {
                "id": kd["id"], "provider_id": pid, "label": kd.get("label", ""),
                "model": kd.get("model"), "weight": kd.get("weight", 10),
                "status": kd.get("status", "active"),
                "consecutive_failures": 0,
                "rate_limit_until": None,
                "price_input_per_1m": 0, "price_output_per_1m": 0,
            })()
            rules = []
            for rd in kd.get("rules", []):
                r = type("r", (), {"id": rd.get("id", 1), "api_key_id": kd["id"],
                                   "purpose": rd["purpose"], "priority": rd["priority"],
                                   "is_enabled": rd.get("is_enabled", True)})()
                rules.append(r)
            k.rules = rules
            keys.append(k)
        p.keys = keys
        providers[pid] = {"provider": p, "keys": keys, "rules": {}}
    return providers


def test_select_key_single_key():
    """单 key 单 provider = 直接选中"""
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://api.deepseek.com",
            "keys": [{"id": 1, "rules": [{"purpose": "patient_chat", "priority": 10}]}]}
    })
    router._load_config(cfg)
    key, provider = router.select_key("patient_chat")
    assert key.id == 1
    assert provider.name == "deepseek"


def test_select_key_weighted():
    """同 priority 组内按权重分配"""
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com",
            "keys": [
                {"id": 1, "weight": 10, "rules": [{"purpose": "*", "priority": 10}]},
                {"id": 2, "weight": 0, "rules": [{"purpose": "*", "priority": 10}]},
            ]}
    })
    router._load_config(cfg)
    # key 2 weight=0, 100次应全选 key 1
    results = [router.select_key("*")[0].id for _ in range(100)]
    assert results.count(1) == 100
    assert results.count(2) == 0


def test_select_key_fallback_provider():
    """同 provider key 耗尽 → 降级到下一个 provider"""
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com", "provider_priority": 10,
            "keys": [
                {"id": 1, "status": "disabled",
                 "rules": [{"purpose": "scoring", "priority": 10}]},
            ]},
        2: {"name": "openai", "base_url": "https://api.openai.com", "provider_priority": 20,
            "keys": [
                {"id": 2, "rules": [{"purpose": "scoring", "priority": 10}]},
            ]}
    })
    router._load_config(cfg)
    key, _ = router.select_key("scoring")
    assert key.id == 2


def test_select_key_fallback_wildcard():
    """特定 purpose 规则耗尽 → 兜底 '*' 规则"""
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com",
            "keys": [
                {"id": 1, "rules": [
                    {"purpose": "patient_chat", "priority": 10},
                    {"purpose": "*", "priority": 50},
                ]},
            ]}
    })
    router._load_config(cfg)
    key, _ = router.select_key("scoring")  # 没有 scoring 特定规则
    assert key.id == 1  # 兜底到 *


def test_select_key_all_failed():
    """所有 key 不可用 → RuntimeError"""
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com",
            "keys": [
                {"id": 1, "status": "disabled",
                 "rules": [{"purpose": "qa", "priority": 10}]},
            ]}
    })
    router._load_config(cfg)
    with pytest.raises(RuntimeError, match="无可用 API key"):
        router.select_key("qa")


def test_select_key_respects_rate_limited():
    """rate_limited 状态 key 不可选"""
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com",
            "keys": [
                {"id": 1, "status": "rate_limited",
                 "rules": [{"purpose": "*", "priority": 10}]},
                {"id": 2, "rules": [{"purpose": "*", "priority": 20}]},
            ]}
    })
    router._load_config(cfg)
    key, _ = router.select_key("*")
    assert key.id == 2


def test_report_result_success():
    """成功调用: 重置 consecutive_failures"""
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com",
            "keys": [{"id": 1, "consecutive_failures": 5,
                       "rules": [{"purpose": "*", "priority": 10}]}]}
    })
    router._load_config(cfg)
    key, _ = router.select_key("*")
    assert key.consecutive_failures == 5
    router.report_result(1, success=True, tokens=100, latency_ms=500, error=None)
    assert key.consecutive_failures == 0


def test_report_result_429():
    """429 → status='rate_limited', rate_limit_until 设置"""
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com",
            "keys": [{"id": 1, "rules": [{"purpose": "*", "priority": 10}]}]}
    })
    router._load_config(cfg)
    router.report_result(1, success=False, tokens=0, latency_ms=100,
                         error="HTTP 429: rate limited")
    key = router._get_key(1)
    assert key.status == "rate_limited"
    assert key.rate_limit_until is not None


def test_report_result_consecutive_failures():
    """连续失败 >=5 → status='disabled'"""
    cfg = _make_config({
        1: {"name": "deepseek", "base_url": "https://x.com",
            "keys": [{"id": 1, "rules": [{"purpose": "*", "priority": 10}]}]}
    })
    router._load_config(cfg)
    key = router._get_key(1)
    for i in range(5):
        key.consecutive_failures = i
        router.report_result(1, success=False, tokens=0, latency_ms=100, error="500")
        key.consecutive_failures += 1  # simulate what report does internally
    # After 5 failures
    key.consecutive_failures = 5
    router.report_result(1, success=False, tokens=0, latency_ms=100, error="500")
    assert key.status == "disabled"
```

- [ ] **Step 2: 运行测试确认 RED**

```bash
cd backend && uv run pytest tests/test_llm_router.py -v
```
Expected: FAIL (LLMRouter 不存在)

- [ ] **Step 3: 实现 LLMRouter**

```python
"""backend/services/llm_router.py —— LLM API 路由调度器"""
import asyncio
import logging
import random
from datetime import datetime, timezone, timedelta

_logger = logging.getLogger("nursing")

# 熔断阈值
CIRCUIT_BREAKER_THRESHOLD = 5
RATE_LIMIT_COOLDOWN_SECONDS = 60
GLOBAL_DEGRADED_TTL_SECONDS = 30


class LLMRouter:
    def __init__(self):
        self._cache: dict | None = None
        self._last_valid_cache: dict | None = None
        self._global_degraded: tuple[bool, datetime | None] = (False, None)
        self._lock = asyncio.Lock()

    def _load_config(self, config: dict):
        """直接设置缓存（测试用）"""
        self._cache = config

    async def load_from_db(self):
        """从数据库加载配置到内存"""
        from database import SessionLocal
        from models import ApiProvider, ApiKey, ApiKeyRule
        db = SessionLocal()
        try:
            providers = db.query(ApiProvider).filter(ApiProvider.is_enabled == True).all()
            config = {}
            for p in providers:
                keys = db.query(ApiKey).filter(
                    ApiKey.provider_id == p.id,
                    ApiKey.status.in_(["active", "rate_limited"]),
                ).all()
                for k in keys:
                    k.rules = db.query(ApiKeyRule).filter(
                        ApiKeyRule.api_key_id == k.id,
                        ApiKeyRule.is_enabled == True,
                    ).all()
                config[p.id] = {"provider": p, "keys": keys, "rules": {}}
            # 校验至少 1 个 active key
            total_active = sum(
                1 for c in config.values()
                for k in c["keys"] if k.status == "active"
            )
            if total_active == 0:
                if self._last_valid_cache:
                    _logger.error("加载配置失败：无可用 API key，保留上次缓存")
                    return
                raise RuntimeError("无可用 API key，无法启动 LLMRouter")
            async with self._lock:
                self._last_valid_cache = self._cache
                self._cache = config
                self._global_degraded = (False, None)
            _logger.info("LLMRouter 配置加载完成: %d providers, %d keys",
                         len(config), sum(len(c["keys"]) for c in config.values()))
        except Exception:
            _logger.exception("加载 LLMRouter 配置失败")
            if self._last_valid_cache:
                async with self._lock:
                    self._cache = self._last_valid_cache
                _logger.warning("保留上次有效配置")
            raise
        finally:
            db.close()

    def _get_key(self, key_id: int):
        """查找 key 对象"""
        for pd in self._cache.values():
            for k in pd["keys"]:
                if k.id == key_id:
                    return k
        return None

    def select_key(self, purpose: str):
        """同步选 key（不使用 async lock，调用者为同步上下文安全）"""
        if self._cache is None:
            raise RuntimeError("LLMRouter 未初始化，请先调用 load_from_db()")

        # 检查全局降级
        degraded, degraded_at = self._global_degraded
        if degraded and degraded_at:
            if degraded_at > datetime.now(timezone.utc):
                raise RuntimeError("所有 API provider 不可用，全局降级中")
            else:
                self._global_degraded = (False, None)

        # 收集候选: (key, provider, rule.priority, provider.priority)
        candidates = []
        for pd in self._cache.values():
            provider = pd["provider"]
            for key in pd["keys"]:
                if key.status == "disabled":
                    continue
                if key.status == "rate_limited":
                    if key.rate_limit_until and key.rate_limit_until > datetime.now(timezone.utc):
                        continue
                    key.status = "active"
                    key.rate_limit_until = None
                if key.consecutive_failures >= CIRCUIT_BREAKER_THRESHOLD:
                    continue
                rule_priority = None
                for r in (key.rules or []):
                    if r.purpose == purpose:
                        rule_priority = r.priority
                        break
                if rule_priority is None:
                    for r in (key.rules or []):
                        if r.purpose == "*":
                            rule_priority = r.priority
                            break
                if rule_priority is None:
                    continue
                candidates.append((key, provider, rule_priority, provider.priority))

        if not candidates:
            self._global_degraded = (True, datetime.now(timezone.utc) + timedelta(seconds=GLOBAL_DEGRADED_TTL_SECONDS))
            raise RuntimeError("无可用 API key")

        # 按 (rule_priority ASC, provider.priority ASC) 排序
        candidates.sort(key=lambda c: (c[2], c[3]))

        # 分组: 相同 rule_priority 为一组
        groups = {}
        for c in candidates:
            groups.setdefault(c[2], []).append(c)

        # 从高优先级组选
        for priority in sorted(groups.keys()):
            group = groups[priority]
            total_weight = sum(c[0].weight for c in group)
            if total_weight > 0:
                r = random.uniform(0, total_weight)
                cumulative = 0
                for key, provider, _, _ in group:
                    cumulative += key.weight
                    if r <= cumulative:
                        key.last_used_at = datetime.now(timezone.utc)
                        return key, provider
            # weight=0 或全不可用 → 降级
            continue

        self._global_degraded = (True, datetime.now(timezone.utc) + timedelta(seconds=GLOBAL_DEGRADED_TTL_SECONDS))
        raise RuntimeError("无可用 API key")

    def get_decrypted_key(self, key_id: int) -> str:
        from services.crypto_utils import decrypt_api_key
        key = self._get_key(key_id)
        if key is None:
            raise ValueError(f"API key {key_id} not found")
        return decrypt_api_key(key.encrypted_key)

    def report_result(self, key_id: int, *, success: bool, tokens: int,
                      latency_ms: int, error: str | None):
        key = self._get_key(key_id)
        if key is None:
            return
        if success:
            key.consecutive_failures = 0
            if key.status == "rate_limited":
                key.status = "active"
                key.rate_limit_until = None
            self._update_stats(key, tokens)
        else:
            if "429" in (error or ""):
                key.status = "rate_limited"
                key.rate_limit_until = datetime.now(timezone.utc) + timedelta(seconds=RATE_LIMIT_COOLDOWN_SECONDS)
            else:
                key.consecutive_failures += 1
                if key.consecutive_failures >= CIRCUIT_BREAKER_THRESHOLD:
                    key.status = "disabled"
                    _logger.warning("API key %d 熔断（连续%d次失败）", key_id, CIRCUIT_BREAKER_THRESHOLD)

    def _update_stats(self, key, tokens: int):
        today = datetime.now(timezone.utc).date()
        month = today.strftime("%Y-%m")
        if not key.stats_date or key.stats_date < today:
            key.call_count_today = 0
            key.total_tokens_today = 0
            key.total_cost_today = 0
            key.stats_date = today
        if not key.stats_month or key.stats_month < month:
            key.monthly_cost_used = 0
            key.stats_month = month
        key.call_count_today += 1
        key.total_tokens_today += tokens
        cost = (float(key.price_input_per_1m or 0) + float(key.price_output_per_1m or 0)) * tokens / 1_000_000
        key.total_cost_today = float(key.total_cost_today or 0) + cost
        key.monthly_cost_used = float(key.monthly_cost_used or 0) + cost


_router: LLMRouter | None = None

async def get_router() -> LLMRouter:
    global _router
    if _router is None:
        _router = LLMRouter()
        await _router.load_from_db()
    return _router

async def refresh_router():
    global _router
    if _router is None:
        _router = LLMRouter()
    await _router.load_from_db()
```

- [ ] **Step 4: 运行测试确认 GREEN**

```bash
cd backend && uv run pytest tests/test_llm_router.py -v
```
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add backend/services/llm_router.py backend/tests/test_llm_router.py
git commit -m "✨ feat: implement LLMRouter with priority routing and circuit breaker"
```

---

### Task 4: 改造 llm_service.py 使用 Router

**Files:**
- Modify: `backend/services/llm_service.py`
- Modify: `backend/services/llm_logging.py`

- [ ] **Step 1: 重写 llm_service.py 的 `call_llm`**

将 `call_llm` 从使用 `DEEPSEEK_API_KEY`/`DEEPSEEK_BASE_URL`/`DEEPSEEK_MODEL` 改为通过 Router 动态选择：

```python
# backend/services/llm_service.py (关键修改部分)

async def call_llm(messages: list, temperature: float = 0.7, max_tokens: int = 512,
                   timeout: int = 30, max_retries: int = 2,
                   purpose: str = "other",
                   user_id: int | None = None,
                   record_id: int | None = None,
                   case_id: int | None = None,
                   log_meta: dict | None = None,
                   client: httpx.AsyncClient | None = None,
                   semaphore: asyncio.Semaphore | None = None,
                   ) -> str:
    """通过 LLMRouter 选择 API key，调用 LLM，支持多 provider 自动回退。"""
    from services.llm_router import get_router

    router = await get_router()

    used_key_id = None
    provider_name = "unknown"
    model = "unknown"
    last_error = None
    t0 = time.perf_counter()

    _client = client if client is not None else await _get_client()
    _sema = semaphore if semaphore is not None else _rate_limiter

    for attempt in range(max_retries + 2):  # extra attempts for provider fallback
        try:
            key, provider = router.select_key(purpose)
            api_key = router.get_decrypted_key(key.id)
            used_key_id = key.id
            provider_name = provider.name
            model = key.model or provider.default_model

            payload = {
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }

            async with _sema:
                resp = await _client.post(
                    f"{provider.base_url}/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                    timeout=httpx.Timeout(timeout, connect=15.0),
                )

            if resp.status_code == 429:
                router.report_result(key.id, success=False, tokens=0,
                                     latency_ms=0, error=f"HTTP 429: {resp.text[:200]}")
                last_error = f"HTTP 429"
                if attempt < max_retries + 1:
                    delay = min(2 ** attempt, 4) + random.uniform(0, 0.5)
                    await asyncio.sleep(delay)
                continue

            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            latency_ms = int((time.perf_counter() - t0) * 1000)
            usage = data.get("usage", {})
            total_tokens = usage.get("total_tokens", 0) or len(content) // 2

            router.report_result(key.id, success=True, tokens=total_tokens,
                                 latency_ms=latency_ms, error=None)

            _log_llm_success(
                purpose=purpose, user_id=user_id, record_id=record_id,
                case_id=case_id, temperature=temperature, max_tokens=max_tokens,
                latency_ms=latency_ms, request_text=_build_request_text(messages),
                response_text=content, usage=usage,
                log_meta=log_meta, api_key_id=key.id, provider_name=provider_name, model=model,
            )
            return content

        except Exception as e:
            error_str = f"{type(e).__name__}: {str(e)[:200]}"
            if isinstance(e, RuntimeError) and "无可用" in str(e):
                raise
            if used_key_id:
                router.report_result(used_key_id, success=False, tokens=0,
                                     latency_ms=0, error=error_str)
            last_error = error_str
            if isinstance(e, httpx.RemoteProtocolError):
                await _reset_client()

            if attempt < max_retries + 1:
                delay = min(2 ** attempt, 4) + random.uniform(0, 0.5)
                await asyncio.sleep(delay)

    latency_ms = int((time.perf_counter() - t0) * 1000)
    _log_llm_failure(
        purpose=purpose, user_id=user_id, record_id=record_id,
        case_id=case_id, temperature=temperature, max_tokens=max_tokens,
        latency_ms=latency_ms, request_text=_build_request_text(messages),
        error_type="all_providers_failed", error_message=last_error,
        log_meta=log_meta, api_key_id=used_key_id,
        provider_name=provider_name, model=model,
    )
    raise RuntimeError(f"LLM调用失败（所有 provider 不可用）: {last_error}")


def _build_request_text(messages: list) -> str:
    return " ".join(m.get("content", "") for m in messages)
```

- [ ] **Step 2: 同样改造 `call_llm_stream`**

与 `call_llm` 同理，通过 Router 选 key，流式 SSE 解析保持不变。关键差异：stream 不走重试。

- [ ] **Step 3: 移除旧 import**

删除 `config` 中的 `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL` 引用，保留 `LLM_MAX_RETRIES`、`LLM_CONCURRENT_LIMIT` 等通用参数。

- [ ] **Step 4: 改造 `_log_llm_success` / `_log_llm_failure`**

新增 `api_key_id`, `provider_name` 参数，传递给 `enqueue_log`：

```python
def _log_llm_success(*, purpose, user_id, record_id, case_id, temperature,
                     max_tokens, latency_ms, request_text, response_text, usage,
                     log_meta, api_key_id=None, provider_name="deepseek", model=""):
    from services.llm_logging import enqueue_log
    enqueue_log(
        purpose=purpose, user_id=user_id, record_id=record_id, case_id=case_id,
        model=model, temperature=temperature, max_tokens=max_tokens,
        latency_ms=latency_ms, status="success",
        request_text=request_text, response_text=response_text, usage=usage,
        meta=log_meta, api_key_id=api_key_id, provider_name=provider_name,
    )
```

- [ ] **Step 5: 改造 `llm_logging.py` 的 `enqueue_log`**

接收 `api_key_id` 和 `provider_name` 参数，写入 `_build_entry`：

```python
def enqueue_log(*, purpose, user_id=None, record_id=None, case_id=None,
                model=None, temperature=None, max_tokens=None,
                latency_ms=0, status="success", error_type=None, error_message=None,
                request_text="", response_text="", usage=None, meta=None,
                api_key_id=None, provider_name="deepseek"):
    # ...
    entry = _build_entry(
        # ... existing args ...
        api_key_id=api_key_id,
        provider_name=provider_name,
    )

def _build_entry(*, purpose, user_id, record_id, case_id, model, temperature,
                 max_tokens, latency_ms, status, error_type, error_message,
                 request_text, response_text, usage, meta, api_key_id=None, provider_name="deepseek"):
    # ...
    return {
        # ... existing fields ...
        "provider_name": provider_name,
        "api_key_id": api_key_id,
    }
```

- [ ] **Step 6: 检查配置兼容性**

在 `config.py` 中标记 `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL` 为 deprecated：

```python
# [deprecated] 仅用于 seed 初始数据，由 LLMRouter 管理
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
```

同时 `log_config()` 中 DeepSeek 行改为：
```python
logger.info("  API 路由:   LLMRouter 模式（%s 关键配置在数据库）", 
            "已 seed" if DEEPSEEK_API_KEY else "需通过管理面板配置")
```

- [ ] **Step 7: Commit**

```bash
git add backend/services/llm_service.py backend/services/llm_logging.py backend/config.py
git commit -m "✨ feat: integrate LLMRouter into llm_service call_llm/call_llm_stream"
```

---

### Task 5: 启动时 Seed + Router 初始化

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: 添加 seed 逻辑**

在 `main.py` lifespan startup 中，迁移完成后 seed 默认 provider：

```python
# 添加到 init_db() 调用之后
try:
    from services.llm_router import get_router, refresh_router
    from services.crypto_utils import encrypt_api_key

    db = SessionLocal()
    try:
        from models import ApiProvider, ApiKey, ApiKeyRule
        if db.query(ApiProvider).count() == 0:
            # seed from .env
            if DEEPSEEK_API_KEY:
                p = ApiProvider(
                    name="deepseek", display_name="DeepSeek",
                    base_url=DEEPSEEK_BASE_URL, default_model=DEEPSEEK_MODEL,
                    api_type="openai_compatible", priority=10,
                )
                db.add(p)
                db.flush()
                suffix = DEEPSEEK_API_KEY[-4:] if len(DEEPSEEK_API_KEY) >= 4 else "****"
                k = ApiKey(
                    provider_id=p.id,
                    label=f"DeepSeek-{suffix}",
                    encrypted_key=encrypt_api_key(DEEPSEEK_API_KEY),
                    key_suffix=suffix,
                    model=DEEPSEEK_MODEL,
                    weight=10,
                    status="active",
                )
                db.add(k)
                db.flush()
                for purpose in ["patient_chat", "scoring", "qa", "*"]:
                    db.add(ApiKeyRule(api_key_id=k.id, purpose=purpose, priority=10))
                db.commit()
                logger.info("已从 .env seed 默认 DeepSeek provider + key")
            else:
                logger.info("DEEPSEEK_API_KEY 未设置，跳过 seed（需通过管理面板配置）")
    finally:
        db.close()

    # 初始化 Router
    await refresh_router()
except Exception as e:
    logger.error("LLMRouter 初始化失败: %s", e)
```

- [ ] **Step 2: 验证启动日志**

```bash
cd backend && timeout 10 uv run uvicorn main:app --host 127.0.0.1 --port 8000 2>&1 | grep -i router
```
Expected: `LLMRouter 配置加载完成: 1 providers, 1 keys`

- [ ] **Step 3: Commit**

```bash
git add backend/main.py
git commit -m "✨ feat: seed default provider on startup and init LLMRouter"
```

---

### Task 6: 管理员 CRUD API

**Files:**
- Create: `backend/routers/admin_api.py`
- Modify: `backend/main.py` (register router)
- Modify: `backend/schemas.py` (add Pydantic models)

- [ ] **Step 1: 添加 Pydantic schemas**

在 `backend/schemas.py` 末尾添加：

```python
# --- API Management Schemas ---

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime

class ApiProviderCreate(BaseModel):
    name: str = Field(..., max_length=40)
    display_name: str = Field(..., max_length=80)
    base_url: str = Field(..., max_length=200)
    api_type: str = Field(default="openai_compatible", max_length=20)
    default_model: str = Field(..., max_length=80)
    is_enabled: bool = True
    priority: int = Field(default=100, ge=1)

class ApiProviderUpdate(BaseModel):
    display_name: Optional[str] = Field(None, max_length=80)
    base_url: Optional[str] = Field(None, max_length=200)
    default_model: Optional[str] = Field(None, max_length=80)
    is_enabled: Optional[bool] = None
    priority: Optional[int] = Field(None, ge=1)

class ApiProviderResponse(BaseModel):
    id: int
    name: str
    display_name: str
    base_url: str
    api_type: str
    default_model: str
    is_enabled: bool
    priority: int
    key_count: int = 0
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}

class ApiKeyCreate(BaseModel):
    provider_id: int
    label: Optional[str] = None
    raw_key: str = Field(..., min_length=10)
    model: Optional[str] = None
    weight: int = Field(default=10, ge=0, le=100)
    price_input_per_1m: float = 0
    price_output_per_1m: float = 0
    monthly_cost_limit: Optional[float] = None

class ApiKeyUpdate(BaseModel):
    label: Optional[str] = Field(None, max_length=80)
    model: Optional[str] = None
    weight: Optional[int] = Field(None, ge=0, le=100)
    status: Optional[str] = None  # active / disabled
    price_input_per_1m: Optional[float] = None
    price_output_per_1m: Optional[float] = None
    balance: Optional[float] = None
    monthly_cost_limit: Optional[float] = None

class ApiKeyResponse(BaseModel):
    id: int
    provider_id: int
    provider_name: str = ""
    label: str
    key_suffix: str  # 仅返回脱敏后缀
    model: Optional[str]
    weight: int
    status: str
    price_input_per_1m: float
    price_output_per_1m: float
    balance: Optional[float]
    monthly_cost_limit: Optional[float]
    call_count_today: int
    total_tokens_today: int
    total_cost_today: float
    last_used_at: Optional[datetime]
    rate_limit_until: Optional[datetime]
    consecutive_failures: int
    created_at: datetime
    model_config = {"from_attributes": True}

class ApiKeyRuleCreate(BaseModel):
    api_key_id: int
    purpose: str = Field(..., max_length=40)
    priority: int = Field(default=100, ge=1)
    is_enabled: bool = True

class ApiKeyRuleUpdate(BaseModel):
    purpose: Optional[str] = Field(None, max_length=40)
    priority: Optional[int] = Field(None, ge=1)
    is_enabled: Optional[bool] = None

class ApiKeyRuleResponse(BaseModel):
    id: int
    api_key_id: int
    purpose: str
    priority: int
    is_enabled: bool
    created_at: datetime
    model_config = {"from_attributes": True}

class ApiKeyStatsResponse(BaseModel):
    daily: list[dict]  # [{date, calls, tokens, cost}]
    by_purpose: list[dict]  # [{purpose, calls, tokens, cost}]
    recent_errors: list[dict]  # [{created_at, error_type, error_message}]

class ApiHealthResponse(BaseModel):
    provider_id: int
    provider_name: str
    status: str  # ok / error
    latency_ms: int | None
    error: str | None
```

- [ ] **Step 2: 创建 admin_api.py router**

```python
"""backend/routers/admin_api.py —— API Key/Provider 管理 CRUD"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models import User, ApiProvider, ApiKey, ApiKeyRule, LLMCallLog
from schemas import (
    ApiProviderCreate, ApiProviderUpdate, ApiProviderResponse,
    ApiKeyCreate, ApiKeyUpdate, ApiKeyResponse,
    ApiKeyRuleCreate, ApiKeyRuleUpdate, ApiKeyRuleResponse,
    ApiKeyStatsResponse, ApiHealthResponse,
)
from auth import require_teacher
from services.llm_router import get_router, refresh_router
from services.crypto_utils import encrypt_api_key
from datetime import datetime, timezone, timedelta
import httpx
import asyncio

router = APIRouter(prefix="/api/admin/api", tags=["API管理"])


# --- Providers ---

@router.get("/providers", response_model=list[ApiProviderResponse])
def list_providers(
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    providers = db.query(ApiProvider).order_by(ApiProvider.priority).all()
    result = []
    for p in providers:
        key_count = db.query(ApiKey).filter(ApiKey.provider_id == p.id).count()
        r = ApiProviderResponse(
            id=p.id, name=p.name, display_name=p.display_name, base_url=p.base_url,
            api_type=p.api_type, default_model=p.default_model,
            is_enabled=p.is_enabled, priority=p.priority, key_count=key_count,
            created_at=p.created_at, updated_at=p.updated_at,
        )
        result.append(r)
    return result


@router.post("/providers", status_code=201)
def create_provider(
    data: ApiProviderCreate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    if db.query(ApiProvider).filter(ApiProvider.name == data.name).first():
        raise HTTPException(400, f"Provider {data.name} 已存在")
    p = ApiProvider(**data.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return {"id": p.id, "name": p.name}


@router.put("/providers/{provider_id}")
def update_provider(
    provider_id: int,
    data: ApiProviderUpdate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    p = db.query(ApiProvider).filter(ApiProvider.id == provider_id).first()
    if not p:
        raise HTTPException(404, "Provider 不存在")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(p, k, v)
    db.commit()
    return {"ok": True}


@router.delete("/providers/{provider_id}")
def delete_provider(
    provider_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    p = db.query(ApiProvider).filter(ApiProvider.id == provider_id).first()
    if not p:
        raise HTTPException(404, "Provider 不存在")
    key_count = db.query(ApiKey).filter(ApiKey.provider_id == provider_id).count()
    if key_count > 0:
        raise HTTPException(400, f"请先删除该 provider 下的 {key_count} 个 key")
    db.delete(p)
    db.commit()
    return {"ok": True}


# --- Keys ---

@router.get("/keys", response_model=list[ApiKeyResponse])
def list_keys(
    provider_id: int | None = Query(None),
    status: str | None = Query(None),
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    q = db.query(ApiKey)
    if provider_id:
        q = q.filter(ApiKey.provider_id == provider_id)
    if status:
        q = q.filter(ApiKey.status == status)
    keys = q.order_by(ApiKey.created_at.desc()).all()
    result = []
    for k in keys:
        provider = db.query(ApiProvider).filter(ApiProvider.id == k.provider_id).first()
        result.append(ApiKeyResponse(
            id=k.id, provider_id=k.provider_id,
            provider_name=provider.name if provider else "",
            label=k.label, key_suffix=k.key_suffix, model=k.model,
            weight=k.weight, status=k.status,
            price_input_per_1m=float(k.price_input_per_1m),
            price_output_per_1m=float(k.price_output_per_1m),
            balance=float(k.balance) if k.balance else None,
            monthly_cost_limit=float(k.monthly_cost_limit) if k.monthly_cost_limit else None,
            call_count_today=k.call_count_today,
            total_tokens_today=k.total_tokens_today,
            total_cost_today=float(k.total_cost_today),
            last_used_at=k.last_used_at, rate_limit_until=k.rate_limit_until,
            consecutive_failures=k.consecutive_failures, created_at=k.created_at,
        ))
    return result


@router.post("/keys", status_code=201)
async def create_key(
    data: ApiKeyCreate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    provider = db.query(ApiProvider).filter(ApiProvider.id == data.provider_id).first()
    if not provider:
        raise HTTPException(404, "Provider 不存在")

    suffix = data.raw_key[-4:] if len(data.raw_key) >= 4 else "****"
    label = data.label or f"{provider.display_name}-{suffix}"

    k = ApiKey(
        provider_id=data.provider_id,
        label=label,
        encrypted_key=encrypt_api_key(data.raw_key),
        key_suffix=suffix,
        model=data.model or provider.default_model,
        weight=data.weight,
        status="active",
        price_input_per_1m=data.price_input_per_1m,
        price_output_per_1m=data.price_output_per_1m,
        monthly_cost_limit=data.monthly_cost_limit,
    )
    db.add(k)
    db.commit()
    db.refresh(k)

    await refresh_router()
    return {"id": k.id, "key_suffix": k.key_suffix}


@router.put("/keys/{key_id}")
async def update_key(
    key_id: int,
    data: ApiKeyUpdate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    k = db.query(ApiKey).filter(ApiKey.id == key_id).first()
    if not k:
        raise HTTPException(404, "Key 不存在")
    for field, val in data.model_dump(exclude_none=True).items():
        setattr(k, field, val)
    db.commit()
    await refresh_router()
    return {"ok": True}


@router.delete("/keys/{key_id}")
async def delete_key(
    key_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    k = db.query(ApiKey).filter(ApiKey.id == key_id).first()
    if not k:
        raise HTTPException(404, "Key 不存在")
    db.query(ApiKeyRule).filter(ApiKeyRule.api_key_id == key_id).delete()
    db.delete(k)
    db.commit()
    await refresh_router()
    return {"ok": True}


@router.post("/keys/{key_id}/reset")
async def reset_key(
    key_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    k = db.query(ApiKey).filter(ApiKey.id == key_id).first()
    if not k:
        raise HTTPException(404, "Key 不存在")
    k.status = "active"
    k.consecutive_failures = 0
    k.rate_limit_until = None
    db.commit()
    await refresh_router()
    return {"ok": True}


# --- Key Stats ---

@router.get("/keys/{key_id}/stats", response_model=dict)
def key_stats(
    key_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    k = db.query(ApiKey).filter(ApiKey.id == key_id).first()
    if not k:
        raise HTTPException(404, "Key 不存在")

    # 30 天日维度
    thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
    daily_rows = db.query(
        func.date(LLMCallLog.created_at).label("day"),
        func.count().label("calls"),
        func.coalesce(func.sum(LLMCallLog.total_tokens), 0).label("tokens"),
        func.coalesce(func.sum(LLMCallLog.estimated_cost), 0).label("cost"),
    ).filter(
        LLMCallLog.api_key_id == key_id,
        LLMCallLog.created_at >= thirty_days_ago,
    ).group_by("day").order_by("day").all()

    daily = [{"date": str(r.day), "calls": r.calls, "tokens": int(r.tokens), "cost": float(r.cost)} for r in daily_rows]

    # by purpose
    purpose_rows = db.query(
        LLMCallLog.purpose,
        func.count().label("calls"),
        func.coalesce(func.sum(LLMCallLog.total_tokens), 0).label("tokens"),
        func.coalesce(func.sum(LLMCallLog.estimated_cost), 0).label("cost"),
    ).filter(LLMCallLog.api_key_id == key_id).group_by(LLMCallLog.purpose).all()

    by_purpose = [{"purpose": r.purpose, "calls": r.calls, "tokens": int(r.tokens), "cost": float(r.cost)} for r in purpose_rows]

    # 最近 20 条错误
    errors = db.query(LLMCallLog).filter(
        LLMCallLog.api_key_id == key_id,
        LLMCallLog.status != "success",
    ).order_by(LLMCallLog.created_at.desc()).limit(20).all()

    recent_errors = [{"created_at": str(e.created_at), "error_type": e.error_type, "error_message": e.error_message} for e in errors]

    return {"daily": daily, "by_purpose": by_purpose, "recent_errors": recent_errors}


# --- Rules ---

@router.get("/keys/{key_id}/rules", response_model=list[ApiKeyRuleResponse])
def list_rules(
    key_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    rules = db.query(ApiKeyRule).filter(ApiKeyRule.api_key_id == key_id).all()
    return [ApiKeyRuleResponse(
        id=r.id, api_key_id=r.api_key_id, purpose=r.purpose,
        priority=r.priority, is_enabled=r.is_enabled, created_at=r.created_at,
    ) for r in rules]


@router.post("/keys/{key_id}/rules", status_code=201)
async def create_rule(
    key_id: int,
    data: ApiKeyRuleCreate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    k = db.query(ApiKey).filter(ApiKey.id == key_id).first()
    if not k:
        raise HTTPException(404, "Key 不存在")
    existing = db.query(ApiKeyRule).filter(
        ApiKeyRule.api_key_id == key_id,
        ApiKeyRule.purpose == data.purpose,
    ).first()
    if existing:
        raise HTTPException(400, f"规则 {data.purpose} 已存在")
    r = ApiKeyRule(api_key_id=key_id, purpose=data.purpose, priority=data.priority, is_enabled=data.is_enabled)
    db.add(r)
    db.commit()
    db.refresh(r)
    await refresh_router()
    return {"id": r.id, "purpose": r.purpose}


@router.put("/rules/{rule_id}")
async def update_rule(
    rule_id: int,
    data: ApiKeyRuleUpdate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    r = db.query(ApiKeyRule).filter(ApiKeyRule.id == rule_id).first()
    if not r:
        raise HTTPException(404, "规则不存在")
    for field, val in data.model_dump(exclude_none=True).items():
        setattr(r, field, val)
    db.commit()
    await refresh_router()
    return {"ok": True}


@router.delete("/rules/{rule_id}")
async def delete_rule(
    rule_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    r = db.query(ApiKeyRule).filter(ApiKeyRule.id == rule_id).first()
    if not r:
        raise HTTPException(404, "规则不存在")
    db.delete(r)
    db.commit()
    await refresh_router()
    return {"ok": True}


# --- Health ---

@router.post("/reload")
async def reload_router(
    current_user: User = Depends(require_teacher),
):
    await refresh_router()
    return {"ok": True}


@router.get("/health", response_model=list[ApiHealthResponse])
async def health_check(
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    providers = db.query(ApiProvider).filter(ApiProvider.is_enabled == True).all()
    results = []
    for p in providers:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(5)) as client:
                t0 = asyncio.get_event_loop().time()
                resp = await client.get(f"{p.base_url}/v1/models")
                latency = int((asyncio.get_event_loop().time() - t0) * 1000)
                results.append(ApiHealthResponse(
                    provider_id=p.id, provider_name=p.name,
                    status="ok" if resp.status_code < 500 else "error",
                    latency_ms=latency, error=None,
                ))
        except Exception as e:
            results.append(ApiHealthResponse(
                provider_id=p.id, provider_name=p.name,
                status="error", latency_ms=None, error=str(e)[:200],
            ))
    return results
```

- [ ] **Step 3: 注册 router 到 main.py**

在 `backend/main.py` 中：
```python
from routers.admin_api import router as admin_api_router
app.include_router(admin_api_router)
```

- [ ] **Step 4: 验证 API**

```bash
# 启动后端
cd backend && uv run uvicorn main:app --host 127.0.0.1 --port 8000 &
sleep 5

# 登录获取 token
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# 查 providers
curl -s http://127.0.0.1:8000/api/admin/api/providers \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# 查 keys
curl -s http://127.0.0.1:8000/api/admin/api/keys \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```
Expected: 各返回 JSON 列表

- [ ] **Step 5: Commit**

```bash
git add backend/routers/admin_api.py backend/main.py backend/schemas.py
git commit -m "✨ feat: add admin CRUD API for provider/key/rule management"
```

---

### Task 7: 前端 — API 管理页面

**Files:**
- Modify: `frontend/src/pages/Admin.jsx`
- Create: `frontend/src/components/teacher/ApiManagementTab.jsx`
- Create: `frontend/src/api/apiManagement.js`
- Modify: `frontend/src/App.jsx` (if route needed)

- [ ] **Step 1: 创建 API 调用层**

```js
// frontend/src/api/apiManagement.js
const BASE = "/api/admin/api";

export async function fetchProviders() {
  const res = await fetch(BASE + "/providers", { headers: authHeader() });
  if (!res.ok) throw new Error("Failed to fetch providers");
  return res.json();
}

export async function createProvider(data) {
  const res = await fetch(BASE + "/providers", {
    method: "POST", headers: { ...jsonHeader(), ...authHeader() },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).detail);
  return res.json();
}

export async function updateProvider(id, data) {
  const res = await fetch(BASE + `/providers/${id}`, {
    method: "PUT", headers: { ...jsonHeader(), ...authHeader() },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function deleteProvider(id) {
  const res = await fetch(BASE + `/providers/${id}`, { method: "DELETE", headers: authHeader() });
  return res.json();
}

export async function fetchKeys(providerId, status) {
  const params = new URLSearchParams();
  if (providerId) params.set("provider_id", providerId);
  if (status) params.set("status", status);
  const res = await fetch(BASE + "/keys?" + params, { headers: authHeader() });
  if (!res.ok) throw new Error("Failed to fetch keys");
  return res.json();
}

export async function createKey(data) {
  const res = await fetch(BASE + "/keys", {
    method: "POST", headers: { ...jsonHeader(), ...authHeader() },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).detail);
  return res.json();
}

export async function updateKey(id, data) {
  const res = await fetch(BASE + `/keys/${id}`, {
    method: "PUT", headers: { ...jsonHeader(), ...authHeader() },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function deleteKey(id) {
  const res = await fetch(BASE + `/keys/${id}`, { method: "DELETE", headers: authHeader() });
  return res.json();
}

export async function resetKey(id) {
  const res = await fetch(BASE + `/keys/${id}/reset`, { method: "POST", headers: authHeader() });
  return res.json();
}

export async function fetchKeyStats(id) {
  const res = await fetch(BASE + `/keys/${id}/stats`, { headers: authHeader() });
  return res.json();
}

export async function fetchKeyRules(keyId) {
  const res = await fetch(BASE + `/keys/${keyId}/rules`, { headers: authHeader() });
  return res.json();
}

export async function createKeyRule(keyId, data) {
  const res = await fetch(BASE + `/keys/${keyId}/rules`, {
    method: "POST", headers: { ...jsonHeader(), ...authHeader() },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function updateKeyRule(ruleId, data) {
  const res = await fetch(BASE + `/rules/${ruleId}`, {
    method: "PUT", headers: { ...jsonHeader(), ...authHeader() },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function deleteKeyRule(ruleId) {
  const res = await fetch(BASE + `/rules/${ruleId}`, { method: "DELETE", headers: authHeader() });
  return res.json();
}

export async function reloadRouter() {
  const res = await fetch(BASE + "/reload", { method: "POST", headers: authHeader() });
  return res.json();
}

export async function checkHealth() {
  const res = await fetch(BASE + "/health", { headers: authHeader() });
  return res.json();
}

function authHeader() {
  const token = localStorage.getItem("token") || "";
  return token ? { "Authorization": "Bearer " + token } : {};
}
function jsonHeader() {
  return { "Content-Type": "application/json" };
}
```

- [ ] **Step 2: 创建 ApiManagementTab 组件**

完整前端代码较长，分为三个子组件：

**`ApiManagementTab.jsx`** — 主 Tab，含 Provider 子表 + Key 子表，用 tabs 切换 Provider 管理 / Key 管理 / 健康检查。

**Provider 子表**: 表格列 (name, display_name, base_url, model, status toggle, key_count) + 弹窗 (新增/编辑) + 删除确认。

**Key 子表**: 表格 (label, provider, key_suffix 脱敏, weight, status 标签, today calls/cost) + 筛选 (provider/status) + 弹窗 (新增含 raw_key 输入+计费价格+权重，编辑同上，路由规则子表增删) + 强制恢复按钮。

**Key 详情页**: 点击 Key 行 → 展开/跳转显示统计折线图 (30天调用/费用)、用途分布饼图、最近错误列表。使用 Recharts (已在前端依赖中)。

核心结构：
```jsx
function ProviderModal({ mode, data, onSave, onClose }) { /* 新增/编辑弹窗 */ }
function KeyModal({ mode, data, providers, onSave, onClose }) { /* 新增/编辑弹窗含规则子表 */ }
function KeyStatsPanel({ keyId }) { /* 统计图表 */ }
export default function ApiManagementTab() { /* 主布局含子 tabs */ }
```

完整实现代码参见 spec 中 UI 描述（Provider 表格 / Key 表格 / 编辑弹窗 / 统计面板）。

- [ ] **Step 3: 集成到 Admin.jsx**

```jsx
// Admin.jsx: 导入并添加 tab
import ApiManagementTab from "../components/teacher/ApiManagementTab";

const ADMIN_TABS = [
  // ... existing tabs ...
  { key: "api", label: "API 管理" },
];

// JSX:
{activeTab === "api" && <ApiManagementTab />}
```

- [ ] **Step 4: 验证前端构建**

```bash
cd frontend && npm run build
```
Expected: BUILD SUCCESS, no errors

- [ ] **Step 5: Commit**

```bash
git add frontend/
git commit -m "✨ feat: add API management admin page with provider/key CRUD UI"
```

---

### Task 8: 集成测试 + 端到端验证

**Files:**
- Create: `backend/tests/test_admin_api.py`

- [ ] **Step 1: 写 API 集成测试**

```python
"""backend/tests/test_admin_api.py"""
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def _login():
    resp = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    return resp.json()["access_token"]

def test_crud_provider():
    token = _login()
    h = {"Authorization": f"Bearer {token}"}

    # list
    resp = client.get("/api/admin/api/providers", headers=h)
    assert resp.status_code == 200

    # create
    resp = client.post("/api/admin/api/providers", headers=h, json={
        "name": "test_openai", "display_name": "Test OpenAI",
        "base_url": "https://api.openai.com", "default_model": "gpt-4o",
    })
    assert resp.status_code == 201
    pid = resp.json()["id"]

    # update
    resp = client.put(f"/api/admin/api/providers/{pid}", headers=h, json={"display_name": "Updated"})
    assert resp.status_code == 200

    # delete
    resp = client.delete(f"/api/admin/api/providers/{pid}", headers=h)
    assert resp.status_code == 200


def test_crud_key():
    token = _login()
    h = {"Authorization": f"Bearer {token}"}

    # get first provider
    providers = client.get("/api/admin/api/providers", headers=h).json()
    pid = providers[0]["id"]

    # create key
    resp = client.post("/api/admin/api/keys", headers=h, json={
        "provider_id": pid,
        "raw_key": "sk-test-key-12345678",
        "weight": 10,
    })
    assert resp.status_code == 201
    kid = resp.json()["id"]

    # list keys
    resp = client.get("/api/admin/api/keys", headers=h)
    assert resp.status_code == 200

    # reset
    resp = client.post(f"/api/admin/api/keys/{kid}/reset", headers=h)
    assert resp.status_code == 200

    # delete key
    resp = client.delete(f"/api/admin/api/keys/{kid}", headers=h)
    assert resp.status_code == 200


def test_rules_crud():
    token = _login()
    h = {"Authorization": f"Bearer {token}"}

    providers = client.get("/api/admin/api/providers", headers=h).json()
    pid = providers[0]["id"]

    kid = client.post("/api/admin/api/keys", headers=h, json={
        "provider_id": pid,
        "raw_key": "sk-test-key-rules-1234",
    }).json()["id"]

    # create rule
    resp = client.post(f"/api/admin/api/keys/{kid}/rules", headers=h, json={
        "api_key_id": kid, "purpose": "test_purpose", "priority": 50,
    })
    assert resp.status_code == 201

    # list rules
    resp = client.get(f"/api/admin/api/keys/{kid}/rules", headers=h)
    assert len(resp.json()) >= 1

    # cleanup
    client.delete(f"/api/admin/api/keys/{kid}", headers=h)
```

- [ ] **Step 2: 运行测试**

```bash
cd backend && uv run pytest tests/test_admin_api.py -v
```
Expected: ALL PASS

- [ ] **Step 3: 完整启动测试**

```bash
# 后端
cd backend && uv run uvicorn main:app --host 127.0.0.1 --port 8000 &
sleep 5
# 验证 health
curl -u admin:admin123 http://127.0.0.1:8000/api/admin/api/health
# 验证前端
cd frontend && npm run build && echo "BUILD OK"
```

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_admin_api.py
git commit -m "✅ test: add API management integration tests"
```

---

## 实现顺序

1. ✅ Task 1: Models + crypto_utils (基础)
2. ✅ Task 2: Migration (DB schema)
3. ✅ Task 3: LLMRouter (核心路由)
4. ✅ Task 4: llm_service 改造 (集成)
5. ✅ Task 5: Seed + Startup (启动)
6. ✅ Task 6: Admin CRUD API
7. ✅ Task 7: 前端管理页面
8. ✅ Task 8: 集成测试
