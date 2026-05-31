# API 管理数据库内化 + 多 API 支持 — 架构设计

> 2026-05-30 | feature/multi-api-management

## 动机

当前 LLM 调用仅支持单一 DeepSeek provider，API key 存储在 `.env` 环境变量中。痛点：

- 单个 API key 受服务商限流，高峰期吞吐不足
- 单一 provider 无故障回退能力，挂了服务中断
- 无法按 key 独立计费，不知道哪个账号花了多少钱
- 修改配置需要重启服务

**目标：** API 管理完全数据库化，支持多 provider、多 key 负载均衡、自动故障回退、key 级计费可视化管理。

---

## 变更范围总览

| 变更 | 类型 |
|------|------|
| 新增 `api_providers` / `api_keys` / `api_key_rules` 3 张表 | Migration |
| `llm_call_logs` 新增 `api_key_id`、重命名 `provider` → `provider_name` | Migration |
| 新增 `backend/services/llm_router.py` | 新增 |
| 改造 `backend/services/llm_service.py` | 改造 |
| 新增 `backend/routers/admin_api.py`（CRUD 端点） | 新增 |
| 新增 `frontend/src/pages/admin/ApiManagement/` 3 页面 | 新增 |
| `backend/config.py` 新增 `KEY_ENCRYPTION_KEY`，旧 LLM 配置标记为 seed-only | 改造 |

---

## 1. 数据库 Schema

### `api_providers` — Provider 定义

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO_INCREMENT | |
| name | VARCHAR(40) UNIQUE | `deepseek` / `openai` |
| display_name | VARCHAR(80) | UI 显示名 |
| base_url | VARCHAR(200) | `https://api.deepseek.com` |
| api_type | VARCHAR(20) DEFAULT 'openai_compatible' | 预留非 OpenAI 协议扩展 |
| default_model | VARCHAR(80) | `deepseek-chat` |
| is_enabled | BOOL DEFAULT TRUE | 全局开关 |
| priority | INT DEFAULT 100 | provider 级回退优先级（越小越优先） |
| created_at | DATETIME | |
| updated_at | DATETIME | |

### `api_keys` — API Key + 独立计费

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO_INCREMENT | |
| provider_id | FK → api_providers | |
| label | VARCHAR(80) | 默认 `{provider}-{key_suffix}`，可手动改名 |
| encrypted_key | TEXT | AES-256-GCM (Fernet) 加密存储 |
| key_suffix | VARCHAR(8) | 真实 key 末尾 4 位，用于脱敏展示 `sk-****{suffix}` |
| model | VARCHAR(80) NULL | 覆盖 provider 默认模型 |
| weight | INT DEFAULT 10 | 同 priority 组内负载均衡权重 |
| status | ENUM('active','rate_limited','disabled') DEFAULT 'active' | |
| **计费** | | |
| price_input_per_1m | DECIMAL(10,6) DEFAULT 0 | 输入单价 / 1M tokens |
| price_output_per_1m | DECIMAL(10,6) DEFAULT 0 | 输出单价 / 1M tokens |
| currency | VARCHAR(10) DEFAULT 'CNY' | |
| balance | DECIMAL(12,6) NULL | 账号当前余额 |
| monthly_cost_limit | DECIMAL(12,6) NULL | 月度预算上限 |
| **运行时统计**（异步批量刷新，近似值） | | |
| call_count_today | INT DEFAULT 0 | |
| total_tokens_today | BIGINT DEFAULT 0 | |
| total_cost_today | DECIMAL(12,6) DEFAULT 0 | |
| stats_date | DATE | |
| monthly_cost_used | DECIMAL(12,6) DEFAULT 0 | |
| stats_month | VARCHAR(7) | `2026-05` |
| **熔断** | | |
| consecutive_failures | INT DEFAULT 0 | |
| last_used_at | DATETIME | |
| rate_limit_until | DATETIME NULL | 429 后冷却时间 |
| created_at | DATETIME | |
| updated_at | DATETIME | |

### `api_key_rules` — 按调用目的的路由规则

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO_INCREMENT | |
| api_key_id | FK → api_keys | |
| purpose | VARCHAR(40) | `patient_chat` / `scoring` / `qa` / `summary` / `*` |
| priority | INT DEFAULT 100 | 越小越优先 |
| is_enabled | BOOL DEFAULT TRUE | |
| created_at | DATETIME | |

**UNIQUE(api_key_id, purpose)**

### `llm_call_logs` 改造

- 新增 `api_key_id` FK → api_keys.id（NULL 允许，兼容旧数据）
- 重命名 `provider` → `provider_name` VARCHAR(40)

---

## 2. 路由逻辑

### `LLMRouter` 单例

```python
class LLMRouter:
    _cache: dict          # {provider_id: {keys: [{...}, ...], rules: {...}}}
    _last_valid_cache: dict   # 加载失败时保留
    _global_degraded: bool + expiry  # 全链路不可用时 fast-fail

    async def select_key(purpose: str) -> (ApiKey, ApiProvider):
        """
        1. 筛选: provider.is_enabled AND key.status='active'
                 AND (key_rule.purpose = purpose OR key_rule.purpose = '*')
        2. 排序: 按 key_rule.priority ASC, provider.priority ASC
        3. 分组: 相同 priority 的 key 为一个候选组
        4. 选择: 组内 weighted_random(key.weight)
        5. 失败: 同组重试其他 key → 全组失败 → 下沉到下一 priority 组
        6. 兜底: 所有 purpose 特定规则耗尽 → 尝试 purpose='*' 通用规则
        7. 全部失败: 设 _global_degraded (30s TTL) + raise RuntimeError
        """

    async def report_result(key_id, success, tokens, latency_ms, error):
        """Push 到 llm_logging 异步队列，不直接写 DB"""

    async def refresh():
        """从 DB 重新加载，校验至少 1 个 active key，atomic swap"""
```

### 选择流程示意

```
select_key("patient_chat")
  │
  ├─ priority=10: [DeepSeek-A w=10, DeepSeek-B w=5]
  │   ├─ random → DeepSeek-A ✓ 成功 → return
  │   └─ 全失败 ↓
  ├─ priority=20: [DeepSeek-C w=10]
  │   └─ 全失败 ↓
  ├─ purpose='*': [OpenAI-D w=10]
  │   └─ 全失败 ↓
  └─ raise AllProvidersFailedError
```

### 熔断规则

| 条件 | 动作 |
|------|------|
| 连续 5 次非 429 错误 | status → `disabled`，30min 后自动恢复 |
| 收到 429 | status → `rate_limited`，`rate_limit_until` = now + 60s |
| 任何成功调用 | `consecutive_failures` = 0 |
| 管理员手动重置 | POST `/keys/{id}/reset-failures` |

---

## 3. 加密方案

```python
from cryptography.fernet import Fernet

# 使用独立 KEY_ENCRYPTION_KEY（非 SECRET_KEY）
_fernet = Fernet(KEY_ENCRYPTION_KEY.encode())  # base64, 32 bytes

def encrypt_key(raw: str) -> str:
    return _fernet.encrypt(raw.encode()).decode()

def decrypt_key(encrypted: str) -> str:
    return _fernet.decrypt(encrypted.encode()).decode()
```

- `KEY_ENCRYPTION_KEY` 安装时生成一次，永不轮换，永不外泄
- 生成命令: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
- 传输安全：API 返回仅 `key_suffix`，前端显示 `sk-****{suffix}`
- 完整 key 仅在 Router 内存中存在

---

## 4. Web UI 管理面板

管理侧边栏新增 **「API 管理」** 分组：

### 4.1 Provider 管理 (`/admin/api/providers`)

表格: name, display_name, base_url, model, 状态 toggle, key 数量, 最后使用时间

操作: 新增 / 编辑（弹窗）, 启用/禁用, 删除（无关联 key 时允许）

### 4.2 Key 管理 (`/admin/api/keys`)

表格: label, provider, `sk-****{suffix}`, weight, 状态标签, 今日调用/费用

筛选: 按 provider、按 status

编辑弹窗内容：
- Provider 选择、Label、API Key 输入（带 👁 显示/隐藏）
- 模型（可选，覆盖默认）、权重
- 计费：输入价格、输出价格、月度预算
- 路由规则子表：purpose × priority × 启用 toggle，支持增删
- 强制恢复按钮（重置熔断状态）

### 4.3 Key 详情 (`/admin/api/keys/:id`)

- 30 天调用量/费用趋势折线图
- 各 purpose 分布饼图
- 今日实时统计卡片
- 最近失败日志列表

---

## 5. API 端点

```
GET    /api/admin/api/providers              → provider 列表
POST   /api/admin/api/providers              → 新增
PUT    /api/admin/api/providers/{id}         → 编辑
DELETE /api/admin/api/providers/{id}         → 删除（check 无关联 key）

GET    /api/admin/api/keys                   → key 列表 ?provider_id=&status=
POST   /api/admin/api/keys                   → 新增（加密→DB, 自动刷新 Router）
PUT    /api/admin/api/keys/{id}              → 编辑
DELETE /api/admin/api/keys/{id}              → 删除
POST   /api/admin/api/keys/{id}/reset        → 手动重置熔断

GET    /api/admin/api/keys/{id}/stats        → 单个 key 统计详情
GET    /api/admin/api/keys/{id}/rules        → 路由规则列表
POST   /api/admin/api/keys/{id}/rules        → 添加规则
PUT    /api/admin/api/rules/{id}             → 编辑规则
DELETE /api/admin/api/rules/{id}             → 删除规则

POST   /api/admin/api/reload                 → 强制热加载 Router
GET    /api/admin/api/health                 → 各 provider 连通性检查
```

---

## 6. 迁移策略

### 阶段 1 — 兼容过渡

1. 启动时若 `api_providers` 为空 → 从 .env 读取 `DEEPSEEK_API_KEY` seed 到 DB
2. LLMRouter 初始化：DB 无数据时 fallback 到 env 模式（保持向后兼容）
3. 管理员通过 UI 添加更多 key 后，Router 自动切换为 DB 模式

### 阶段 2 — 割接

4. 所有 .env LLM 配置项标记 deprecated，仅用于 seed
5. 新增 provider/key 完全走 DB

### 阶段 3 — 清理

6. 后续大版本移除 env 配置支持

---

## 7. 可靠性设计

| 场景 | 行为 |
|------|------|
| 热加载导致零可用 key | 校验失败 → 保留上次缓存 + ERROR 日志 |
| DB 断连加载失败 | 保留上次缓存 + 降级 env 模式 + WARN 日志 |
| 所有 provider 全挂 | 设 `_global_degraded=30s`，后续请求直接 fast-fail |
| 热加载 | 新配置校验通过 → atomic swap 缓存，零停机 |
| 统计丢失（重启） | `call_count_today` 等是近似值，精确数据在 `llm_call_logs` |
| 背景评分线程跨线程 | Router 全局单例，内部用 `asyncio.Lock` |

---

## 8. 性能设计

- `report_result` 走现有异步日志队列，零额外 IO 开销
- Router 全量内存缓存，`select_key` O(n) n=key 数量（<100），无性能问题
- 统计聚合在 `llm_logging` worker 中批量完成，每次最多一次 DB 事务

---

## 9. 安全设计

| 威胁 | 对策 |
|------|------|
| 数据库泄露 | key 完整密文，需 `KEY_ENCRYPTION_KEY` 才能解密 |
| 日志泄露 key | 仅存加密或脱敏形式，logger 层过滤 `Authorization` header |
| API 返回泄露 | 仅返回 `key_suffix`（末尾 4 位），显示 `sk-****{suffix}` |
| KEY_ENCRYPTION_KEY 轮换 | 独立于 SECRET_KEY，生成后不轮换；若必须换提供 `rekey` 脚本 |
| 暴力破解尾号 | 4 位 = 16M 组合，且不泄露 key 总长度 |
