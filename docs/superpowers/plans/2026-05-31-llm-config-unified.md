# LLM 配置统一管理 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 简化 API Provider/Key 体系（合并 rules 表、用 provider.priority 做故障转移）+ 新增 Prompt 模板 DB 化管理（含版本、热加载、硬编码兜底）

**Architecture:** Phase 1 将 ApiKeyRule 合并入 ApiKey（purpose+priority 直写），路由从三层优先级简化为 provider 级权重故障转移 + key 级加权负载均衡。Phase 2 新增 PromptManager 单例（与 LLMRouter 同模式），Prompt 模板 DB 化支持版本管理和热加载。

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2.0, Alembic, React 19, cryptography (Fernet)

---

## Phase 1: API 管理体系简化

### Task 1: 数据模型重构 — 合并 ApiKeyRule 到 ApiKey

**Files:**
- Modify: `backend/models.py`
- Create: `backend/migrations/versions/<auto>_simplify_api_management.py`

- [ ] **Step 1: 更新 models.py — 给 ApiKey 添加 purpose 和 priority**

```diff
--- a/backend/models.py
+++ b/backend/models.py
@@ -199,6 +199,8 @@ class ApiKey(Base):
     encrypted_key = Column(Text, nullable=False)
     key_suffix = Column(String(8), nullable=False)
     model = Column(String(80), nullable=True)
+    purpose = Column(String(40), nullable=False, default="*")
+    priority = Column(Integer, nullable=False, default=100)
     weight = Column(Integer, nullable=False, default=10)
     status = Column(String(20), nullable=False, default="active")
     price_input_per_1m = Column(Numeric(10, 6), nullable=False, default=0)
```

Index: 添加 `Index("idx_api_keys_purpose", "purpose")`
移除 `relationship("ApiKeyRule", ...)` 中的 rules 关系

在文件末尾**删除整个** `class ApiKeyRule(Base):` 类定义。

- [ ] **Step 2: 生成 migration**

```bash
cd backend && alembic revision --autogenerate -m "simplify_api_management"
```

手动编辑生成的 migration，确保：
1. `op.add_column("api_keys", Column("purpose", ...))`
2. `op.add_column("api_keys", Column("priority", ...))`
3. `op.drop_table("api_key_rules")`
4. 添加 `op.create_index("idx_api_keys_purpose", "api_keys")`

数据迁移：从 `api_key_rules` 表中将 `(api_key_id, purpose, priority)` 迁移到 `api_keys` 表（取第一个 rule 或合并）。

```python
def upgrade():
    # 1. 加列
    op.add_column("api_keys", sa.Column("purpose", sa.String(40), nullable=True, server_default="*"))
    op.add_column("api_keys", sa.Column("priority", sa.Integer(), nullable=True, server_default="100"))

    # 2. 从 api_key_rules 迁移数据到 api_keys
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT api_key_id, purpose, priority FROM api_key_rules ORDER BY api_key_id, priority ASC")).fetchall()
    # 同一 key 多个 rules → 取第一条（purpose 最优先的）
    migrated = set()
    for row in rows:
        if row[0] not in migrated:
            conn.execute(sa.text("UPDATE api_keys SET purpose=:purpose, priority=:priority WHERE id=:id"),
                         {"purpose": row[1], "priority": row[2], "id": row[0]})
            migrated.add(row[0])

    # 3. 设 NOT NULL
    op.alter_column("api_keys", "purpose", nullable=False, server_default=None)
    op.alter_column("api_keys", "priority", nullable=False, server_default=None)

    # 4. 清理
    op.execute(sa.text("DROP TABLE IF EXISTS api_key_rules"))
    op.create_index("idx_api_keys_purpose", "api_keys", ["purpose"])

def downgrade():
    # re-create api_key_rules...
    pass
```

- [ ] **Step 3: 运行 migration 并验证**

```bash
cd backend && alembic upgrade head
```

Expected: 无报错，`api_keys` 表有 `purpose` 和 `priority` 列。

```bash
cd backend && python -c "from database import engine; from sqlalchemy import inspect; i=inspect(engine); print([c['name'] for c in i.get_columns('api_keys')])"
```

Expected: 输出包含 `purpose`, `priority`，且不包含 `api_key_rules` 表。

- [ ] **Step 4: Commit**

```bash
git add backend/models.py backend/migrations/
git commit -m "🔧 refactor: merge ApiKeyRule into ApiKey, add purpose/priority columns"
```

---

### Task 2: 更新 Schema 定义

**Files:**
- Modify: `backend/schemas.py`

- [ ] **Step 1: 在 ApiKeyCreate 和 ApiKeyUpdate 中添加 purpose/priority**

```python
# ApiKeyCreate 添加字段
class ApiKeyCreate(BaseModel):
    provider_id: int
    purpose: str = Field(default="*", max_length=40)
    priority: int = Field(default=100, ge=1)
    label: Optional[str] = None
    raw_key: str = Field(..., min_length=10)
    model: Optional[str] = None
    weight: int = Field(default=10, ge=0, le=100)
    price_input_per_1m: float = 0
    price_output_per_1m: float = 0
    monthly_cost_limit: Optional[float] = None

# ApiKeyUpdate 添加字段
class ApiKeyUpdate(BaseModel):
    purpose: Optional[str] = Field(None, max_length=40)
    priority: Optional[int] = Field(None, ge=1)
    label: Optional[str] = Field(None, max_length=80)
    model: Optional[str] = None
    weight: Optional[int] = Field(None, ge=0, le=100)
    status: Optional[str] = None
    price_input_per_1m: Optional[float] = None
    price_output_per_1m: Optional[float] = None
    balance: Optional[float] = None
    monthly_cost_limit: Optional[float] = None

# ApiKeyResponse 添加字段
class ApiKeyResponse(BaseModel):
    id: int
    provider_id: int
    provider_name: str = ""
    purpose: str = "*"
    priority: int = 100
    label: str
    key_suffix: str
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
    model_config = ConfigDict(from_attributes=True)
```

- [ ] **Step 2: 删除所有 ApiKeyRule 相关 Schema**

```python
# 移除以下类：
# class ApiKeyRuleCreate(BaseModel): ...
# class ApiKeyRuleUpdate(BaseModel): ...
# class ApiKeyRuleResponse(BaseModel): ...
```

- [ ] **Step 3: Commit**

```bash
git add backend/schemas.py
git commit -m "🔧 refactor: add purpose/priority to ApiKey schemas, remove ApiKeyRule schemas"
```

---

### Task 3: 重构 LLMRouter — 简化 select_key

**Files:**
- Modify: `backend/services/llm_router.py`

- [ ] **Step 1: 重写 select_key()**

将当前 120+ 行的 rules 遍历逻辑替换为：按 provider.priority 升序遍历，同 provider 内 weighted random。

```python
def select_key(self, purpose: str):
    if self._cache is None:
        raise RuntimeError("LLMRouter 未初始化")

    degraded, degraded_at = self._global_degraded
    if degraded and degraded_at and degraded_at > datetime.now(timezone.utc):
        raise RuntimeError("所有 API provider 不可用，全局降级中")

    # 收集所有匹配的 (key, provider) 对，按 provider.priority 分组
    provider_groups: list[tuple[int, list]] = []  # [(provider_priority, [(key, provider)])]
    for pd in self._cache.values():
        provider = pd["provider"]
        group_keys = []
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
            if key.purpose != purpose and key.purpose != "*":
                continue
            group_keys.append((key, provider))
        if group_keys:
            provider_groups.append((provider.priority, group_keys))

    if not provider_groups:
        self._global_degraded = (True, datetime.now(timezone.utc) + timedelta(seconds=GLOBAL_DEGRADED_TTL_SECONDS))
        raise RuntimeError("无可用 API key")

    # 按 provider.priority 升序尝试每一组
    provider_groups.sort(key=lambda g: g[0])

    for _, group in provider_groups:
        # 改组内 weighted random
        total_weight = sum(k[0].weight for k in group)
        if total_weight <= 0:
            continue
        r = random.uniform(0, total_weight)
        cumulative = 0
        for key, provider in group:
            cumulative += key.weight
            if r <= cumulative:
                key.last_used_at = datetime.now(timezone.utc)
                return key, provider

    self._global_degraded = (True, datetime.now(timezone.utc) + timedelta(seconds=GLOBAL_DEGRADED_TTL_SECONDS))
    raise RuntimeError("无可用 API key")
```

- [ ] **Step 2: 简化 load_from_db()**

移除 rules 查询逻辑，不再预加载 `k.rules`：

```python
async def load_from_db(self):
    from database import SessionLocal
    from models import ApiProvider, ApiKey

    db = SessionLocal()
    try:
        providers = db.query(ApiProvider).filter(ApiProvider.is_enabled == True).all()
        config = {}
        for p in providers:
            keys = db.query(ApiKey).filter(
                ApiKey.provider_id == p.id,
                ApiKey.status.in_(["active", "rate_limited"]),
            ).all()
            config[p.id] = {"provider": p, "keys": keys}
        total_active = sum(1 for c in config.values() for k in c["keys"] if k.status == "active")
        if total_active == 0:
            if self._last_valid_cache:
                _logger.error("加载配置失败：无可用 API key，保留上次缓存")
                return
            raise RuntimeError("无可用 API key，无法启动 LLMRouter")
        async with self._lock:
            self._last_valid_cache = self._cache
            self._cache = config
            self._global_degraded = (False, None)
        _logger.info("LLMRouter 配置加载: %d providers, %d keys",
                     len(config), sum(len(c["keys"]) for c in config.values()))
    except Exception:
        _logger.exception("LLMRouter 配置加载失败")
        if self._last_valid_cache:
            async with self._lock:
                self._cache = self._last_valid_cache
            _logger.warning("保留上次有效配置")
        raise
    finally:
        db.close()
```

- [ ] **Step 3: Commit**

```bash
git add backend/services/llm_router.py
git commit -m "🔧 refactor: simplify LLMRouter select_key to provider-ordered weighted-random"
```

---

### Task 4: 更新 Seed 和 Admin API

**Files:**
- Modify: `backend/main.py`
- Modify: `backend/routers/admin_api.py`

- [ ] **Step 1: 更新 main.py seed 数据**

将启动 seed 中的 `ApiKeyRule` 创建替换为直接在 ApiKey 上设置 purpose：

```python
# 旧代码（main.py:73-74）:
for purpose in ["patient_chat", "scoring", "qa", "*"]:
    db.add(ApiKeyRule(api_key_id=k.id, purpose=purpose, priority=10))

# 替换为:
k.purpose = "*"  # 通配，覆盖所有场景
k.priority = 10
```

同时移除 `from models import ..., ApiKeyRule` 中的 `ApiKeyRule` 导入。

- [ ] **Step 2: 更新 admin_api.py — 删除 rules CRUD 端点**

删除以下端点函数：
- `list_rules` (line 230)
- `create_rule` (line 234)
- `update_rule` (line 249)
- `delete_rule` (line 260)

更新 `create_key` (line 120-143) 添加 purpose/priority 字段：

```python
k = ApiKey(
    provider_id=data.provider_id, label=label,
    encrypted_key=encrypt_api_key(data.raw_key), key_suffix=suffix,
    model=data.model or provider.default_model,
    purpose=data.purpose,
    priority=data.priority,
    weight=data.weight,
    status="active",
    price_input_per_1m=data.price_input_per_1m,
    price_output_per_1m=data.price_output_per_1m,
    monthly_cost_limit=data.monthly_cost_limit,
)
```

更新 `update_key` (line 145-159) 添加 purpose/priority 到允许更新的字段列表。

更新 `list_keys` (line 87-118) 的 response dict 添加 `purpose=k.purpose, priority=k.priority`。

移除 `from models import ..., ApiKeyRule` 中的 `ApiKeyRule` 导入，以及 `from schemas import ..., ApiKeyRuleCreate, ApiKeyRuleUpdate, ApiKeyRuleResponse` 中的 rules schema。

- [ ] **Step 3: Commit**

```bash
git add backend/main.py backend/routers/admin_api.py
git commit -m "🔧 refactor: update seed and admin CRUD for simplified key model"
```

---

### Task 5: 更新后端测试

**Files:**
- Modify: `backend/tests/test_llm_router.py`

- [ ] **Step 1: 重写测试使用新模式**

将所有 `"rules": [{"purpose": ..., "priority": ...}]` 替换为直接在 key 对象上设置 `"purpose": ..., "priority": ...`。

简化 `_make_config` 中的 rules 循环为直接在 key 上设置 `purpose` 和 `priority` 属性。

```python
def _make_config(keys_data):
    providers = {}
    for pid, pd in keys_data.items():
        p = type("p", (), {
            "id": pid, "name": pd["name"], "display_name": pd["name"],
            "base_url": pd["base_url"], "default_model": pd.get("model", "gpt-4"),
            "is_enabled": pd.get("is_enabled", True),
            "priority": pd.get("provider_priority", 10),
        })()
        keys = []
        for kd in pd["keys"]:
            k = type("k", (), {
                "id": kd["id"], "provider_id": pid, "label": kd.get("label", ""),
                "model": kd.get("model"), "weight": kd.get("weight", 10),
                "status": kd.get("status", "active"),
                "purpose": kd.get("purpose", "*"),
                "priority": kd.get("priority", 100),
                "consecutive_failures": kd.get("consecutive_failures", 0),
                "rate_limit_until": None,
                "price_input_per_1m": 0, "price_output_per_1m": 0,
                "encrypted_key": kd.get("encrypted_key", "enc-test"),
            })()
            keys.append(k)
        p.keys = keys
        providers[pid] = {"provider": p, "keys": keys}
    return providers
```

更新测试用例，将 rules 改为直接 purpose/priority：

```python
# test_select_key_single — rules → purpose
cfg = _make_config({
    1: {"name": "deepseek", "base_url": "https://api.deepseek.com",
        "provider_priority": 10,
        "keys": [{"id": 1, "purpose": "patient_chat", "priority": 10}]}
})

# test_select_key_fallback_priority → provider-level failover
cfg = _make_config({
    1: {"name": "deepseek", "base_url": "https://x.com", "provider_priority": 10,
        "keys": [{"id": 1, "purpose": "scoring", "priority": 10, "weight": 10}]},
    2: {"name": "openai", "base_url": "https://x.com", "provider_priority": 20,
        "keys": [{"id": 2, "purpose": "scoring", "priority": 10, "weight": 10}]},
})
# 应该选择 provider_priority=10 的 deepseek key

# test_select_key_wildcard_purpose
cfg = _make_config({
    1: {"name": "deepseek", "base_url": "https://x.com",
        "keys": [{"id": 1, "purpose": "*", "priority": 10, "weight": 10}]}
})

# test_select_key_provider_failover
cfg = _make_config({
    1: {"name": "deepseek", "base_url": "https://x.com", "provider_priority": 10,
        "keys": [{"id": 1, "purpose": "qa", "status": "disabled"}]},
    2: {"name": "openai", "base_url": "https://x.com", "provider_priority": 20,
        "keys": [{"id": 2, "purpose": "qa"}]},
})
# 应该 fallback 到 openai
key, _ = router.select_key("qa")
assert key.id == 2
assert provider.name == "openai"
```

- [ ] **Step 2: 运行测试验证**

```bash
cd backend && python -m pytest tests/test_llm_router.py -v
```

Expected: 所有 12 个测试通过。

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_llm_router.py
git commit -m "✅ test: update router tests for simplified key model"
```

---

### Task 6: 前端 API Client 更新

**Files:**
- Modify: `frontend/src/api/apiManagement.js`

- [ ] **Step 1: 移除 rules API 调用，添加 key 更新**

```javascript
import { api } from "../api.js";

// Providers (unchanged)
export function fetchProviders() { return api.get("/admin/api/providers"); }
export function createProvider(data) { return api.post("/admin/api/providers", data); }
export function updateProvider(id, data) { return api.put(`/admin/api/providers/${id}`, data); }
export function deleteProvider(id) { return api.delete(`/admin/api/providers/${id}`); }

// Keys
export function fetchKeys(providerId, status) {
  const params = {};
  if (providerId) params.provider_id = providerId;
  if (status) params.status = status;
  return api.get("/admin/api/keys", { params });
}
export function createKey(data) { return api.post("/admin/api/keys", data); }
export function updateKey(id, data) { return api.put(`/admin/api/keys/${id}`, data); }
export function deleteKey(id) { return api.delete(`/admin/api/keys/${id}`); }
export function resetKey(id) { return api.post(`/admin/api/keys/${id}/reset`); }
export function fetchKeyStats(id) { return api.get(`/admin/api/keys/${id}/stats`); }

// Router
export function reloadRouter() { return api.post("/admin/api/reload"); }
export function checkHealth() { return api.get("/admin/api/health"); }
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api/apiManagement.js
git commit -m "🔧 refactor: remove rules API, simplify key API client"
```

---

### Task 7: 前端 — 重建 KeyModal（purpose + weight 滑块）

**Files:**
- Modify: `frontend/src/components/teacher/KeyModal.jsx`

- [ ] **Step 1: 完整替换 KeyModal**

重新写 KeyModal，移除 rules 子表，添加 purpose 下拉 + weight 滑块 + priority 输入：

```jsx
import { useState, useEffect } from "react";
import Modal from "../ui/Modal";
import { createKey, updateKey, fetchProviders } from "../../api/apiManagement";
import { useToast } from "../Toast";

const PURPOSE_OPTIONS = [
  { value: "*", label: "默认（所有场景）" },
  { value: "patient_chat", label: "患者对话" },
  { value: "scoring", label: "评分" },
  { value: "qa", label: "问答" },
];

export default function KeyModal({ open, keyData, onClose, onSaved }) {
  const toast = useToast();
  const [providers, setProviders] = useState([]);
  const [form, setForm] = useState({
    provider_id: "", purpose: "*", priority: 100, label: "",
    raw_key: "", model: "", weight: 10,
    price_input: 0, price_output: 0, monthly_cost_limit: "",
  });
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) fetchProviders().then(({ data }) => setProviders(data)).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (keyData) {
      console.log("keyData:", keyData);
      setForm({
        provider_id: keyData.provider_id || "",
        purpose: keyData.purpose || "*",
        priority: keyData.priority ?? 100,
        label: keyData.label || "",
        raw_key: keyData.raw_key || "",
        model: keyData.model || "",
        weight: keyData.weight ?? 10,
        price_input: keyData.price_input ?? 0,
        price_output: keyData.price_output ?? 0,
        monthly_cost_limit: keyData.monthly_cost_limit ?? "",
      });
    } else {
      setForm({
        provider_id: providers[0]?.id || "",
        purpose: "*", priority: 100, label: "",
        raw_key: "", model: "", weight: 10,
        price_input: 0, price_output: 0, monthly_cost_limit: "",
      });
    }
    setShowKey(false);
  }, [keyData, open, providers]);

  const handleChange = (field) => (e) => {
    const value = e.target.type === "number"
      ? (e.target.value === "" ? "" : Number(e.target.value))
      : e.target.value;
    setForm((f) => ({ ...f, [field]: value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.provider_id) { toast.error("请选择服务商"); return; }
    if (!form.raw_key && !keyData) { toast.error("请输入 API Key"); return; }
    setSaving(true);
    try {
      const payload = { ...form };
      if (payload.monthly_cost_limit === "" || payload.monthly_cost_limit === null)
        payload.monthly_cost_limit = null;
      if (keyData) {
        await updateKey(keyData.id, payload);
        toast.success("账号已更新");
      } else {
        await createKey(payload);
        toast.success("账号已创建");
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "保存失败");
    } finally { setSaving(false); }
  };

  const s = (props) => ({
    marginBottom: "var(--space-4)",
    ...props,
  });
  const label = { display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "var(--space-1)", color: "var(--text-secondary)" };
  const input = {
    width: "100%", padding: "var(--space-2) var(--space-3)",
    border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)",
    fontSize: "0.9rem", background: "var(--bg-surface)", color: "var(--text-primary)",
    boxSizing: "border-box",
  };

  return (
    <Modal open={open} onClose={onClose}
      title={keyData ? "编辑账号" : "添加账号"} maxWidth={600}
      footer={
        <>
          <button onClick={onClose} style={{ padding: "var(--space-2) var(--space-4)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", background: "var(--bg-surface)", color: "var(--text-secondary)", cursor: "pointer", fontSize: "0.85rem" }}>取消</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: "var(--space-2) var(--space-4)", border: "none", borderRadius: "var(--radius-md)", background: "var(--color-primary)", color: "#fff", cursor: saving ? "not-allowed" : "pointer", fontSize: "0.85rem", opacity: saving ? 0.6 : 1 }}>
            {saving ? "保存中..." : "保存"}
          </button>
        </>
      }
    >
      <form onSubmit={handleSave}>
        <div style={s()}>
          <label style={label}>服务商 *</label>
          <select style={input} value={form.provider_id} onChange={handleChange("provider_id")} required>
            <option value="">-- 选择服务商 --</option>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.display_name || p.name}</option>)}
          </select>
        </div>
        <div style={s()}>
          <label style={label}>场景 *</label>
          <select style={input} value={form.purpose} onChange={handleChange("purpose")}>
            {PURPOSE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div style={s()}>
          <label style={label}>标签</label>
          <input style={input} value={form.label} onChange={handleChange("label")} placeholder="留空自动生成" />
        </div>
        <div style={s()}>
          <label style={label}>API Key {!keyData && "*"}</label>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <input style={{ ...input, flex: 1 }} type={showKey ? "text" : "password"}
              value={form.raw_key} onChange={handleChange("raw_key")}
              placeholder="sk-..." required={!keyData} />
            <button type="button" onClick={() => setShowKey((v) => !v)}
              style={{ padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", background: "var(--bg-surface)", color: "var(--text-secondary)", cursor: "pointer", fontSize: "0.75rem", whiteSpace: "nowrap" }}>
              {showKey ? "隐藏" : "显示"}
            </button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-3)" }}>
          <div style={s()}>
            <label style={label}>模型</label>
            <input style={input} value={form.model} onChange={handleChange("model")} placeholder="默认" />
          </div>
          <div style={s()}>
            <label style={label}>故障转移顺序</label>
            <input style={input} type="number" value={form.priority} onChange={handleChange("priority")}
              title="同服务商内较小值优先尝试" />
          </div>
          <div style={s()}>
            <label style={label}>负载权重</label>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <input style={{ ...input, flex: 1 }} type="range" min={0} max={100} value={form.weight}
                onChange={handleChange("weight")} />
              <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", minWidth: 30, textAlign: "right" }}>{form.weight}</span>
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
          <div style={s()}>
            <label style={label}>输入价格 (¥/1M tokens)</label>
            <input style={input} type="number" step="0.01" value={form.price_input} onChange={handleChange("price_input")} />
          </div>
          <div style={s()}>
            <label style={label}>输出价格 (¥/1M tokens)</label>
            <input style={input} type="number" step="0.01" value={form.price_output} onChange={handleChange("price_output")} />
          </div>
        </div>
        <div style={s()}>
          <label style={label}>月度预算上限 (¥)</label>
          <input style={input} type="number" step="0.01" value={form.monthly_cost_limit}
            onChange={handleChange("monthly_cost_limit")} placeholder="不限制" />
        </div>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 2: 验证 KeyModal 导入**

确认 `useToast` 路径是 `"../Toast"`，`fetchProviders`、`createKey`、`updateKey` 导入路径正确。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/teacher/KeyModal.jsx
git commit -m "💄 style: redesign KeyModal with purpose select and weight slider"
```

---

### Task 8: 前端 — 重建 ApiManagementTab（按场景分组）

**Files:**
- Modify: `frontend/src/components/teacher/ApiManagementTab.jsx`

- [ ] **Step 1: 添加 scenario-grouped key list**

保留 Providers 和 Health 子 Tab，将 Keys 子 Tab 改为按场景 (purpose) 分组的卡片视图：

```jsx
import { useState, useEffect, useCallback } from "react";
import { Plus, Edit3, Trash2, RefreshCw, Server, Activity, AlertTriangle, ArrowUp, ArrowDown } from "lucide-react";
import {
  fetchProviders, deleteProvider, updateProvider,
  fetchKeys, deleteKey, resetKey, fetchKeyStats,
  reloadRouter, checkHealth,
} from "../../api/apiManagement";
import { useToast } from "../Toast";
import { useConfirm } from "../ui/ConfirmDialog";
import ProviderModal from "./ProviderModal";
import KeyModal from "./KeyModal";

const STATUS_COLORS = {
  active: { bg: "var(--green-100)", color: "var(--green-700)" },
  rate_limited: { bg: "var(--amber-100)", color: "var(--amber-700)" },
  disabled: { bg: "var(--red-100)", color: "var(--red-700)" },
};

const PURPOSE_LABELS = {
  patient_chat: "患者对话",
  scoring: "评分",
  qa: "问答",
  "*": "默认（所有场景）",
};

export default function ApiManagementTab() {
  const toast = useToast();
  const { confirm } = useConfirm();

  const [subTab, setSubTab] = useState("providers");
  const [providers, setProviders] = useState([]);
  const [keys, setKeys] = useState([]);
  const [health, setHealth] = useState([]);
  const [loading, setLoading] = useState(false);

  const [showProviderModal, setShowProviderModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState(null);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [editingKey, setEditingKey] = useState(null);

  const loadProviders = useCallback(() => {
    fetchProviders().then(({ data }) => setProviders(data)).catch(() => toast.error("加载服务商失败"));
  }, [toast]);
  const loadKeys = useCallback(() => {
    setLoading(true);
    fetchKeys()
      .then(({ data }) => setKeys(data))
      .catch(() => toast.error("加载账号失败"))
      .finally(() => setLoading(false));
  }, [toast]);
  const loadHealth = useCallback(() => {
    setLoading(true);
    checkHealth().then(({ data }) => setHealth(data)).catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadProviders(); loadKeys(); }, [loadProviders, loadKeys]);

  const handleMoveProvider = async (provider, direction) => {
    const idx = providers.indexOf(provider);
    const other = providers[idx + direction];
    if (!other) return;
    try {
      await updateProvider(provider.id, { priority: other.priority });
      await updateProvider(other.id, { priority: provider.priority });
      toast.success("顺序已调整");
      loadProviders();
    } catch (err) { toast.error("调整失败"); }
  };

  const handleDeleteProvider = async (p) => {
    if (p.keys_count > 0) {
      toast.error(`该服务商下有 ${p.keys_count} 个账号，请先删除`);
      return;
    }
    const ok = await confirm({ title: "删除服务商", message: `删除 "${p.name}"？`, confirmText: "删除", danger: true });
    if (!ok) return;
    try { await deleteProvider(p.id); toast.success("已删除"); loadProviders(); }
    catch (err) { toast.error(err.response?.data?.detail || "删除失败"); }
  };

  const handleDeleteKey = async (k) => {
    const ok = await confirm({ title: "删除账号", message: `删除 "${k.label}"？`, confirmText: "删除", danger: true });
    if (!ok) return;
    try { await deleteKey(k.id); toast.success("已删除"); loadKeys(); }
    catch (err) { toast.error(err.response?.data?.detail || "删除失败"); }
  };

  const handleResetKey = async (k) => {
    const ok = await confirm({ title: "重置熔断", message: `重置 "${k.label || k.id}" 的熔断状态？`, confirmText: "重置" });
    if (!ok) return;
    try { await resetKey(k.id); toast.success("已重置"); loadKeys(); }
    catch (err) { toast.error(err.response?.data?.detail || "重置失败"); }
  };

  const handleReload = async () => {
    try { await reloadRouter(); toast.success("路由器已刷新"); }
    catch (err) { toast.error(err.response?.data?.detail || "刷新失败"); }
  };

  // 按 purpose 分组
  const groupedKeys = {};
  keys.forEach((k) => {
    const p = k.purpose || "*";
    if (!groupedKeys[p]) groupedKeys[p] = [];
    groupedKeys[p].push(k);
  });

  const subTabs = [
    { key: "providers", label: "服务商" },
    { key: "keys", label: "账号" },
    { key: "health", label: "健康检查" },
  ];

  const tableStyle = { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" };
  const thStyle = { padding: "var(--space-2) var(--space-3)", textAlign: "left", color: "var(--text-secondary)", fontWeight: 600, borderBottom: "2px solid var(--border-color)", fontSize: "0.75rem", textTransform: "uppercase" };
  const tdStyle = { padding: "var(--space-2) var(--space-3)", borderBottom: "1px solid var(--border-color)" };
  const actionBtn = (color, hoverBg) => ({
    background: "none", border: "none", cursor: "pointer",
    padding: "var(--space-1) var(--space-2)", borderRadius: "var(--radius-sm)",
    fontSize: "0.75rem", display: "inline-flex", alignItems: "center", gap: 4, color,
  });

  return (
    <>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border-color)", marginBottom: "var(--space-5)" }}>
        {subTabs.map((tab) => (
          <button key={tab.key} onClick={() => setSubTab(tab.key)} style={{
            padding: "var(--space-2) var(--space-4)", border: "none", background: "none",
            fontSize: "0.85rem", fontWeight: subTab === tab.key ? 600 : 400,
            color: subTab === tab.key ? "var(--color-primary)" : "var(--text-secondary)",
            cursor: "pointer", borderBottom: subTab === tab.key ? "2px solid var(--color-primary)" : "2px solid transparent",
            marginBottom: -1, fontFamily: "inherit",
          }}>{tab.label}</button>
        ))}
      </div>

      {/* Providers */}
      {subTab === "providers" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
            <div>
              <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: 0 }}>LLM 服务商</h3>
              <p style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", margin: "4px 0 0 0" }}>拖拽或点击箭头调整故障转移顺序（排前面的优先调用）</p>
            </div>
            <button onClick={() => { setEditingProvider(null); setShowProviderModal(true); }} style={{
              padding: "var(--space-2) var(--space-4)", border: "none", borderRadius: "var(--radius-md)",
              background: "var(--color-primary)", color: "#fff", cursor: "pointer", fontSize: "0.85rem",
              display: "flex", alignItems: "center", gap: "var(--space-1)",
            }}><Plus size={14} /> 添加服务商</button>
          </div>
          <div className="card" style={{ overflow: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>顺序</th>
                  <th style={thStyle}>名称</th>
                  <th style={thStyle}>地址</th>
                  <th style={thStyle}>默认模型</th>
                  <th style={thStyle}>状态</th>
                  <th style={thStyle}>账号数</th>
                  <th style={thStyle}>操作</th>
                </tr>
              </thead>
              <tbody>
                {providers.length === 0 ? (
                  <tr><td colSpan={7} style={{ ...tdStyle, textAlign: "center", padding: "var(--space-6)", color: "var(--text-tertiary)" }}>暂未配置服务商</td></tr>
                ) : providers.sort((a, b) => (a.priority || 100) - (b.priority || 100)).map((p, i) => (
                  <tr key={p.id}>
                    <td style={tdStyle}>
                      <button onClick={() => handleMoveProvider(p, -1)} disabled={i === 0}
                        style={{ ...actionBtn("var(--text-secondary)"), opacity: i === 0 ? 0.3 : 1 }}>
                        <ArrowUp size={12} />
                      </button>
                      <button onClick={() => handleMoveProvider(p, 1)} disabled={i === providers.length - 1}
                        style={{ ...actionBtn("var(--text-secondary)"), opacity: i === providers.length - 1 ? 0.3 : 1 }}>
                        <ArrowDown size={12} />
                      </button>
                    </td>
                    <td style={tdStyle}><strong>{p.display_name || p.name}</strong></td>
                    <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: "0.8rem", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.base_url}</td>
                    <td style={tdStyle}>{p.default_model || "-"}</td>
                    <td style={tdStyle}>
                      <span style={{ padding: "2px 8px", borderRadius: "var(--radius-full)", fontSize: "0.75rem",
                        background: p.is_enabled !== false ? "var(--green-100)" : "var(--red-100)",
                        color: p.is_enabled !== false ? "var(--green-700)" : "var(--red-700)" }}>
                        {p.is_enabled !== false ? "正常" : "已禁用"}
                      </span>
                    </td>
                    <td style={tdStyle}>{p.keys_count ?? "-"}</td>
                    <td style={tdStyle}>
                      <button onClick={() => { setEditingProvider(p); setShowProviderModal(true); }}
                        style={actionBtn("var(--color-primary)", "var(--bg-surface-subtle)")}>
                        <Edit3 size={12} /> 编辑
                      </button>
                      <button onClick={() => handleDeleteProvider(p)}
                        style={actionBtn("var(--red-400)", "var(--red-50)")}>
                        <Trash2 size={12} /> 删除
                      </button>
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Keys — scenario-grouped */}
      {subTab === "keys" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
            <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: 0 }}>API 账号</h3>
            <button onClick={() => { setEditingKey(null); setShowKeyModal(true); }} style={{
              padding: "var(--space-2) var(--space-4)", border: "none", borderRadius: "var(--radius-md)",
              background: "var(--color-primary)", color: "#fff", cursor: "pointer", fontSize: "0.85rem",
              display: "flex", alignItems: "center", gap: "var(--space-1)",
            }}><Plus size={14} /> 添加账号</button>
          </div>

          {loading ? (
            <div style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--text-secondary)" }}>加载中...</div>
          ) : keys.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--text-tertiary)" }}>暂未配置账号</div>
          ) : Object.keys(groupedKeys).map((purpose) => {
            const group = groupedKeys[purpose];
            const totalWeight = group.reduce((s, k) => s + (k.weight || 0), 0);
            return (
              <div key={purpose} style={{ marginBottom: "var(--space-5)" }}>
                <h4 style={{ fontSize: "0.9rem", fontWeight: 600, margin: "0 0 var(--space-3) 0", color: "var(--text-primary)" }}>
                  {PURPOSE_LABELS[purpose] || purpose}
                  <span style={{ marginLeft: "var(--space-2)", fontSize: "0.75rem", color: "var(--text-tertiary)", fontWeight: 400 }}>
                    ({group.length} 个账号)
                  </span>
                </h4>
                <div className="card" style={{ overflow: "auto" }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}>标签</th>
                        <th style={thStyle}>服务商</th>
                        <th style={thStyle}>密钥</th>
                        <th style={thStyle}>模型</th>
                        <th style={thStyle}>权重</th>
                        <th style={{ ...thStyle, width: 100 }}>状态</th>
                        <th style={thStyle}>今日</th>
                        <th style={thStyle}>费用</th>
                        <th style={thStyle}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.map((k) => {
                        const pct = totalWeight > 0 ? Math.round((k.weight / totalWeight) * 100) : 0;
                        return (
                          <tr key={k.id}>
                            <td style={tdStyle}>{k.label || `key-${k.id}`}</td>
                            <td style={tdStyle}>{k.provider_name}</td>
                            <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: "0.8rem" }}>sk-****{k.key_suffix}</td>
                            <td style={tdStyle}>{k.model || "-"}</td>
                            <td style={tdStyle}>
                              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
                                <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--bg-surface-subtle)", overflow: "hidden" }}>
                                  <div style={{ height: "100%", width: `${pct}%`, background: "var(--color-primary)", borderRadius: 3 }} />
                                </div>
                                <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", minWidth: 30, textAlign: "right" }}>{k.weight}</span>
                              </div>
                            </td>
                            <td style={tdStyle}>
                              <span style={{ padding: "2px 8px", borderRadius: "var(--radius-full)", fontSize: "0.75rem",
                                background: (STATUS_COLORS[k.status] || {}).bg || "var(--bg-surface-subtle)",
                                color: (STATUS_COLORS[k.status] || {}).color || "var(--text-secondary)" }}>
                                {k.status === "active" ? "正常" : k.status === "rate_limited" ? "限流中" : "已禁用"}
                              </span>
                            </td>
                            <td style={tdStyle}>{k.call_count_today ?? 0}</td>
                            <td style={tdStyle}>
                              {k.monthly_cost_limit > 0 && k.total_cost_today != null ? (
                                <span style={{ fontSize: "0.75rem", color: Number(k.total_cost_today) > Number(k.monthly_cost_limit) * 0.9 ? "var(--red-500)" : "var(--text-secondary)" }}>
                                  ¥{Number(k.total_cost_today).toFixed(2)}
                                  {Number(k.total_cost_today) > Number(k.monthly_cost_limit) * 0.9 && (
                                    <AlertTriangle size={12} style={{ marginLeft: 4, verticalAlign: "middle", color: "var(--red-500)" }} />
                                  )}
                                </span>
                              ) : <>¥{Number(k.total_cost_today || 0).toFixed(2)}</>}
                            </td>
                            <td style={tdStyle}>
                              <button onClick={() => { setEditingKey(k); setShowKeyModal(true); }}
                                style={actionBtn("var(--color-primary)", "var(--bg-surface-subtle)")}>
                                <Edit3 size={12} />
                              </button>
                              <button onClick={() => handleResetKey(k)}
                                style={actionBtn("var(--amber-500)", "var(--amber-50)")}>
                                <RefreshCw size={12} />
                              </button>
                              <button onClick={() => handleDeleteKey(k)}
                                style={actionBtn("var(--red-400)", "var(--red-50)")}>
                                <Trash2 size={12} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Health */}
      {subTab === "health" && (
        <div>
          <div style={{ display: "flex", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
            <button onClick={loadHealth} style={{ padding: "var(--space-2) var(--space-4)", border: "none", borderRadius: "var(--radius-md)", background: "var(--color-primary)", color: "#fff", cursor: "pointer", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
              <Activity size={14} /> 检测
            </button>
            <button onClick={handleReload} style={{ padding: "var(--space-2) var(--space-4)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", background: "var(--bg-surface)", color: "var(--text-primary)", cursor: "pointer", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
              <Server size={14} /> 刷新路由
            </button>
          </div>
          <div className="card" style={{ overflow: "auto" }}>
            <table style={tableStyle}>
              <thead><tr><th style={thStyle}>服务商</th><th style={thStyle}>状态</th><th style={thStyle}>延迟</th></tr></thead>
              <tbody>
                {health.length === 0 ? (
                  <tr><td colSpan={3} style={{ ...tdStyle, textAlign: "center", padding: "var(--space-6)", color: "var(--text-tertiary)" }}>点击"检测"测试连通性</td></tr>
                ) : health.map((h, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>{h.provider_name || h.provider || h.id}</td>
                    <td style={tdStyle}>
                      <span style={{ padding: "2px 8px", borderRadius: "var(--radius-full)", fontSize: "0.75rem",
                        background: h.status === "ok" ? "var(--green-100)" : "var(--red-100)",
                        color: h.status === "ok" ? "var(--green-700)" : "var(--red-700)" }}>
                        {h.status === "ok" ? "正常" : "异常"}
                      </span>
                    </td>
                    <td style={tdStyle}>{h.latency_ms != null ? `${h.latency_ms}ms` : "-"}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ProviderModal open={showProviderModal} provider={editingProvider}
        onClose={() => { setShowProviderModal(false); setEditingProvider(null); }} onSaved={loadProviders} />
      <KeyModal open={showKeyModal} keyData={editingKey}
        onClose={() => { setShowKeyModal(false); setEditingKey(null); }}
        onSaved={() => { loadKeys(); loadProviders(); }} />
    </>
  );
}
```

- [ ] **Step 2: 验证前端编译**

```bash
cd frontend && npx vite build 2>&1 | tail -20
```

Expected: Build successful, no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/teacher/ApiManagementTab.jsx
git commit -m "💄 style: redesign ApiManagementTab with scenario-grouped keys and provider ordering"
```

---

## Phase 2: Prompt 模板 DB 化管理

### Task 9: 新增 PromptTemplate 模型

**Files:**
- Modify: `backend/models.py`

- [ ] **Step 1: 在 models.py 末尾添加 PromptTemplate**

```python
class PromptTemplate(Base):
    """LLM 提示词模板 — 可在数据库内版本化和热切换"""
    __tablename__ = "prompt_templates"

    id = Column(Integer, primary_key=True)
    purpose = Column(String(40), nullable=False, index=True)
    version = Column(Integer, nullable=False, default=1)
    name = Column(String(80), nullable=True)
    system_prompt = Column(Text, nullable=False)
    user_prompt = Column(Text, nullable=True)
    template_engine = Column(String(20), nullable=False, default="format")
    variables = Column(JSON, nullable=True)
    is_active = Column(Boolean, nullable=False, default=False)
    created_by = Column(String(80), nullable=True)
    remark = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))
```

- [ ] **Step 2: 生成并编辑 migration**

```bash
cd backend && alembic revision --autogenerate -m "add_prompt_templates"
```

手动编辑 migration，添加 CREATE TABLE：

```python
def upgrade():
    op.create_table(
        "prompt_templates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("purpose", sa.String(40), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("name", sa.String(80), nullable=True),
        sa.Column("system_prompt", sa.Text(), nullable=False),
        sa.Column("user_prompt", sa.Text(), nullable=True),
        sa.Column("template_engine", sa.String(20), nullable=False, server_default="format"),
        sa.Column("variables", sa.JSON(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("created_by", sa.String(80), nullable=True),
        sa.Column("remark", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_pt_purpose", "prompt_templates", ["purpose"])
    op.create_index("idx_pt_purpose_active", "prompt_templates", ["purpose", "is_active"])

def downgrade():
    op.drop_table("prompt_templates")
```

- [ ] **Step 3: 运行 migration**

```bash
cd backend && alembic upgrade head
```

- [ ] **Step 4: Commit**

```bash
git add backend/models.py backend/migrations/
git commit -m "🔧 chore: add prompt_templates model and migration"
```

---

### Task 10: 新增 Prompt Schema

**Files:**
- Modify: `backend/schemas.py`

- [ ] **Step 1: 在文件末尾添加 prompt schemas**

```python
# ── Prompt 管理 ──

class PromptTemplateCreate(BaseModel):
    purpose: str = Field(..., max_length=40)
    name: Optional[str] = Field(None, max_length=80)
    system_prompt: str = Field(..., min_length=10)
    user_prompt: Optional[str] = None
    variables: Optional[list[dict]] = None
    created_by: Optional[str] = None
    remark: Optional[str] = None
    activate: bool = False  # 创建后直接激活


class PromptTemplateUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=80)
    system_prompt: Optional[str] = Field(None, min_length=10)
    user_prompt: Optional[str] = None
    variables: Optional[list[dict]] = None
    remark: Optional[str] = None


class PromptTemplateResponse(BaseModel):
    id: int
    purpose: str
    version: int
    name: Optional[str]
    system_prompt: str
    user_prompt: Optional[str]
    template_engine: str
    variables: Optional[list]
    is_active: bool
    created_by: Optional[str]
    remark: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PromptValidateRequest(BaseModel):
    system_prompt: str
    user_prompt: Optional[str] = None
    variables: Optional[list[dict]] = None


class PromptValidateResponse(BaseModel):
    valid: bool
    errors: list[str] = []
    missing_vars: list[str] = []
```

- [ ] **Step 2: Commit**

```bash
git add backend/schemas.py
git commit -m "🔧 chore: add prompt template schemas"
```

---

### Task 11: 创建 PromptManager 服务

**Files:**
- Create: `backend/services/prompt_manager.py`

- [ ] **Step 1: 创建 PromptManager**

使用与 LLMRouter 相同的单例 + 内存缓存 + 硬编码兜底模式：

```python
"""Prompt 模板管理器 —— 从 DB 加载模板，支持热切换和硬编码兜底"""
import logging
import asyncio
from datetime import datetime, timezone

_logger = logging.getLogger("nursing")


class PromptTemplate:
    """单个 prompt 模板实例，支持变量渲染"""
    def __init__(self, id: int, purpose: str, version: int, system_prompt: str,
                 user_prompt: str | None, variables: list | None):
        self.id = id
        self.purpose = purpose
        self.version = version
        self.system_prompt = system_prompt
        self.user_prompt = user_prompt
        self.variables = variables or []

    def render(self, **kwargs) -> str:
        """渲染 system_prompt，用 str.format 替换变量"""
        try:
            return self.system_prompt.format(**kwargs)
        except KeyError as e:
            missing = str(e).strip("'")
            raise RuntimeError(
                f"模板变量缺失: '{missing}'，模板 (purpose={self.purpose}, v{self.version})"
            )

    def render_pair(self, **kwargs) -> tuple[str, str]:
        """渲染 system + user prompt 对（scoring 场景）"""
        system = self.render(**kwargs)
        user = ""
        if self.user_prompt:
            try:
                user = self.user_prompt.format(**kwargs)
            except KeyError as e:
                missing = str(e).strip("'")
                raise RuntimeError(
                    f"模板变量缺失: '{missing}' (user_prompt)，模板 (purpose={self.purpose}, v{self.version})"
                )
        return system, user


class PromptManager:
    def __init__(self):
        self._cache: dict[str, PromptTemplate] = {}  # purpose → active template
        self._last_valid_cache: dict[str, PromptTemplate] | None = None
        self._lock = asyncio.Lock()
        self._initialized = False

    async def load_from_db(self):
        """从 DB 加载所有 is_active=True 的模板"""
        from database import SessionLocal
        from models import PromptTemplate as PT

        db = SessionLocal()
        try:
            rows = db.query(PT).filter(PT.is_active == True).all()
            if not rows:
                _logger.info("DB 中无 active prompt 模板，seed 默认值")
                self._seed_defaults(db)
                rows = db.query(PT).filter(PT.is_active == True).all()

            new_cache: dict[str, PromptTemplate] = {}
            for r in rows:
                new_cache[r.purpose] = PromptTemplate(
                    id=r.id, purpose=r.purpose, version=r.version,
                    system_prompt=r.system_prompt, user_prompt=r.user_prompt,
                    variables=r.variables,
                )

            async with self._lock:
                self._last_valid_cache = self._cache
                self._cache = new_cache
                self._initialized = True
            _logger.info("PromptManager 加载: %d 个模板", len(new_cache))
        except Exception:
            _logger.exception("PromptManager 加载失败")
            if self._last_valid_cache:
                async with self._lock:
                    self._cache = self._last_valid_cache
                _logger.warning("保留上次有效缓存")
            raise
        finally:
            db.close()

    def _seed_defaults(self, db):
        """从 prompts.py 硬编码写入 DB"""
        from models import PromptTemplate as PT

        # QA 默认
        qa_system = _get_hardcoded_qa_prompt()
        db.add(PT(purpose="qa", version=1, name="v1-默认QA",
                  system_prompt=qa_system, is_active=True, created_by="system"))
        # Patient chat 默认
        pc_system = _get_hardcoded_patient_chat_prompt()
        db.add(PT(purpose="patient_chat", version=1, name="v1-默认患者对话",
                  system_prompt=pc_system, is_active=True, created_by="system"))
        # Scoring 默认
        sc_system, sc_user = _get_hardcoded_scoring_prompt()
        db.add(PT(purpose="scoring", version=1, name="v1-默认评分",
                  system_prompt=sc_system, user_prompt=sc_user, is_active=True, created_by="system"))
        db.commit()
        _logger.info("已从硬编码 seed 3 个默认 prompt 模板")

    async def get(self, purpose: str) -> PromptTemplate:
        """获取 active 模板。DB 为空时返回硬编码兜底。"""
        async with self._lock:
            tmpl = self._cache.get(purpose)

        if tmpl is not None:
            return tmpl

        # 缓存未命中 → try reload
        try:
            await self.load_from_db()
        except Exception:
            _logger.warning("reload 失败，使用硬编码兜底 for purpose=%s", purpose)
        return self._get_hardcoded(purpose)

    async def reload(self):
        """管理员修改后手动触发热加载"""
        await self.load_from_db()

    def _get_hardcoded(self, purpose: str) -> PromptTemplate:
        """硬编码兜底 - 永远不会返回 None"""
        if purpose == "qa":
            return PromptTemplate(0, "qa", 0, _get_hardcoded_qa_prompt(), None, [])
        elif purpose == "patient_chat":
            return PromptTemplate(0, "patient_chat", 0, _get_hardcoded_patient_chat_prompt(), None, [])
        elif purpose == "scoring":
            s, u = _get_hardcoded_scoring_prompt()
            return PromptTemplate(0, "scoring", 0, s, u, [])
        else:
            raise ValueError(f"Unknown prompt purpose: {purpose}")


# ── 硬编码兜底函数 ──（从 prompts.py 提取，永不删除）

def _get_hardcoded_qa_prompt():
    return """你是一名专业的护理学教育导师，你的职责是帮助护理专业学生学习和理解护理学知识。你有以下五项核心能力：

1.  回答各类护理学相关的**健康史采集方法**问题，包括一般资料、社会心理状况、生活型态、各系统过去健康史、各系统功能性健康型态评估等。
2.  回答**护理评估框架**相关问题，包括11项功能性健康型态（健康感知与健康管理、营养与代谢、排泄、活动与运动、睡眠与休息、认知与感知、自我概念、角色与关系、性与生殖、压力与耐受、价值与信念）。
3.  帮助学生区分**护理诊断**与**医疗诊断**的区别，分析护理诊断的组成部分（问题、病因、症状和体征），并教授书写规范。
4.  回答**护理操作标准**、无菌技术、生命体征测量、给药流程等护理技能问题。
5.  帮助学生理解**自我护理**和**健康信念**的评估方法及其对护理计划的影响。

你的回答要求：
1.  专业但通俗易懂，**保护患者隐私**，体现人文关怀。
2.  语言简洁明了，避免冗长复杂的解释，长度控制在200字以内。
3.  对不确定的问题，诚实说明"目前对此没有足够的信息"，并给出合理的建议方向。
4.  适时提供具体的临床案例或情境来说明抽象概念。
5.  鼓励学生主动思考，可在回复中适当提出引导性问题。
6.  始终保持支持和鼓励的态度，强调持续学习和临床实践的重要性。

重要限制：
1.  你只能讨论护理学相关的学术和专业问题。
2.  如何被问到护理之外的问题，请友善地引导学生回到护理学轨道。
3.  不能提供任何的处方建议、医疗诊断意见或替代临床指导老师的角色。"""


def _get_hardcoded_patient_chat_prompt():
    return """你是一个完全沉浸于角色的标准化病人（SP），请严格遵循下方角色信息进行演绎。

你只有护理学知识，只了解角色信息的内容——不额外了解疾病病因、检查结果或药理机制。请注意遵守伦理规则，不主动提供可能导致伤害的建议。如果学生问到超出你认知范围的内容，请用自然的方式表示"不知道"。

## 沟通风格
{communication_style}

## 角色信息
{patient_info}

## 病情核心信息
主诉：{chief_complaint}
现病史：{present_illness}
过敏史：{allergy_history}

## 当前注意事项
{hidden_info_rules}

## 演绎要求
1. 完全沉浸角色，忘记自己是AI。只用口语作答。
2. 内容控制在20~100词之间，要求友好而真实自然。
3. 回应当前访谈话，不要跳出主题。
4. 根据交谈进度逐步透露线索，核心重要信息可用符合人物知识水平的提示信号引导学生继续提问，但不要一次性给出所有信息。
5. 尽量关注患者角色当前面临的实际困难。
6. 如果没有新的痛苦或信息，可以出现对话停滞或说重复的话。
7. 不要评价学生表现，也不要说"你做的很棒"、"你采集得很全面"类似的话，只是沉浸在患者角色中与他互动。
8. 你的回答将用于语音播报，不要在回复中出现符号或缩写，如使用"体温升高了"而不是"体温↑"。
9. 如果学生说了告别的话，请自然地回应道别。"""


def _get_hardcoded_scoring_prompt():
    """返回 (system_prompt, user_prompt) 元组"""
    system = """你是一名资深的护理学临床导师，需要根据对话记录评估学生的问诊表现。

## 评分标准
{rubric_dim_text}

## 必要采集内容清单
{required_inquiries}

## 输出要求
请严格按照以下JSON格式输出评分结果：
```json
{rubric_json_template}
```

请确保：
1. 每个维度都有一个evidence的案例举证，具体引用对话内容
2. 评价要客观公正，既有优点也要指出不足
3. 遗漏的必问内容需在reason中明确指出
4. 建议要具体可行，针对学生的薄弱环节提出改进方向"""

    user = """请基于以下学生与标准化患者的对话记录进行评分：

## 对话记录
{conversation_text}

请严格按照要求的JSON格式输出完整的评分报告。"""
    return system, user


# ── 全局单例 ──

_manager: PromptManager | None = None


async def get_prompt_manager() -> PromptManager:
    global _manager
    if _manager is None:
        _manager = PromptManager()
        await _manager.load_from_db()
    return _manager


async def refresh_prompts():
    global _manager
    if _manager is None:
        _manager = PromptManager()
    await _manager.load_from_db()
```

- [ ] **Step 2: 验证导入**

```bash
cd backend && python -c "from services.prompt_manager import PromptManager, get_prompt_manager; print('OK')"
```

Expected: `OK` (无 import 错误)

- [ ] **Step 3: Commit**

```bash
git add backend/services/prompt_manager.py
git commit -m "✨ feat: add PromptManager service with DB + hardcoded fallback"
```

---

### Task 12: 创建 Prompt 管理 CRUD API

**Files:**
- Create: `backend/routers/admin_prompts.py`

- [ ] **Step 1: 创建 admin_prompts.py**

```python
"""Prompt 模板管理 CRUD"""
import re
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import User, PromptTemplate as PT
from schemas import (
    PromptTemplateCreate, PromptTemplateUpdate, PromptTemplateResponse,
    PromptValidateRequest, PromptValidateResponse,
)
from auth import require_teacher
from services.prompt_manager import refresh_prompts

router = APIRouter(prefix="/api/admin/prompts", tags=["Prompt管理"])


def _extract_vars(text: str | None) -> set[str]:
    """从模板文本中提取 {var} 占位符"""
    if not text:
        return set()
    return set(re.findall(r"\{(\w+)\}", text))


@router.get("", response_model=list[PromptTemplateResponse])
def list_prompts(
    purpose: str | None = None,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    q = db.query(PT).order_by(PT.purpose, PT.version.desc())
    if purpose:
        q = q.filter(PT.purpose == purpose)
    return q.all()


@router.post("", status_code=201, response_model=PromptTemplateResponse)
async def create_prompt(
    data: PromptTemplateCreate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    # 自动计算版本号
    max_v = db.query(PT).filter(PT.purpose == data.purpose).order_by(PT.version.desc()).first()
    version = (max_v.version + 1) if max_v else 1

    pt = PT(
        purpose=data.purpose, version=version, name=data.name,
        system_prompt=data.system_prompt, user_prompt=data.user_prompt,
        variables=data.variables or [
            {"name": v, "desc": ""} for v in sorted(_extract_vars(data.system_prompt) | _extract_vars(data.user_prompt))
        ],
        is_active=False, created_by=data.created_by or current_user.username,
        remark=data.remark,
    )
    db.add(pt)
    db.commit()
    db.refresh(pt)

    # 创建后激活
    if data.activate:
        await _activate(pt.id, db)

    return pt


@router.put("/{prompt_id}", response_model=PromptTemplateResponse)
async def update_prompt(
    prompt_id: int,
    data: PromptTemplateUpdate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    pt = db.query(PT).filter(PT.id == prompt_id).first()
    if not pt:
        raise HTTPException(404, "模板不存在")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(pt, k, v)
    db.commit()
    db.refresh(pt)
    return pt


@router.delete("/{prompt_id}")
async def delete_prompt(
    prompt_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    pt = db.query(PT).filter(PT.id == prompt_id).first()
    if not pt:
        raise HTTPException(404, "模板不存在")
    if pt.is_active:
        raise HTTPException(400, "不能删除当前激活的模板，请先激活其他版本")
    db.delete(pt)
    db.commit()
    return {"ok": True}


@router.post("/{prompt_id}/activate")
async def activate_prompt(
    prompt_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    await _activate(prompt_id, db)
    await refresh_prompts()
    return {"ok": True}


async def _activate(prompt_id: int, db: Session):
    pt = db.query(PT).filter(PT.id == prompt_id).first()
    if not pt:
        raise HTTPException(404, "模板不存在")
    # 同 purpose 下取消所有 is_active
    db.query(PT).filter(PT.purpose == pt.purpose).update({"is_active": False})
    pt.is_active = True
    db.commit()


@router.post("/validate", response_model=PromptValidateResponse)
def validate_prompt(data: PromptValidateRequest):
    errors = []
    missing = []
    # 语法校验: try format with dummy values
    vars = _extract_vars(data.system_prompt) | _extract_vars(data.user_prompt)
    dummy = {v: f"<{v}>" for v in vars}
    try:
        data.system_prompt.format(**dummy)
    except KeyError as e:
        errors.append(f"system_prompt 引用了未声明的变量: {e}")
    except ValueError as e:
        errors.append(f"system_prompt 格式错误: {e}")
    except Exception as e:
        errors.append(f"system_prompt 语法错误: {e}")

    if data.user_prompt:
        try:
            data.user_prompt.format(**dummy)
        except KeyError as e:
            errors.append(f"user_prompt 引用了未声明的变量: {e}")
        except Exception as e:
            errors.append(f"user_prompt 语法错误: {e}")

    # 检查声明的 variables 是否都在模板中使用
    declared = {v["name"] for v in (data.variables or [])}
    used = _extract_vars(data.system_prompt) | _extract_vars(data.user_prompt)
    missing = list(used - declared)

    return PromptValidateResponse(
        valid=len(errors) == 0,
        errors=errors,
        missing_vars=missing,
    )


@router.post("/reload")
async def reload_prompts(current_user: User = Depends(require_teacher)):
    await refresh_prompts()
    return {"ok": True}
```

- [ ] **Step 2: 注册路由到 main.py**

在 `backend/main.py` 中添加：

```python
from routers.admin_prompts import router as admin_prompts_router
# ...
app.include_router(admin_prompts_router)
```

并在 lifespan 中添加 PromptManager 初始化（放在 LLMRouter 初始化之后）：

```python
# 初始化 PromptManager 并 seed 默认模板
try:
    from services.prompt_manager import get_prompt_manager
    await get_prompt_manager()
    _startup_logger.info("PromptManager 初始化完成")
except Exception as e:
    _startup_logger.error("PromptManager 初始化失败: %s", e)
```

- [ ] **Step 3: 验证 API**

```bash
cd backend && python -c "
from database import SessionLocal
from models import PromptTemplate
db = SessionLocal()
# seed 测试
from services.prompt_manager import get_prompt_manager
import asyncio
async def test():
    mgr = await get_prompt_manager()
    tmpl = await mgr.get('qa')
    print('QA prompt loaded:', tmpl.system_prompt[:50])
    print('Patient chat prompt:', (await mgr.get('patient_chat')).system_prompt[:50])
    print('Scoring prompt:', (await mgr.get('scoring')).system_prompt[:50])
asyncio.run(test())
"
```

Expected: 三项都输出 prompt 截取内容，无 RuntimeError。

- [ ] **Step 4: Commit**

```bash
git add backend/routers/admin_prompts.py backend/main.py
git commit -m "✨ feat: add prompt template CRUD API with validate endpoint"
```

---

### Task 13: 改造现有 Prompt 调用点

**Files:**
- Modify: `backend/routers/qa.py`
- Modify: `backend/routers/chat.py`
- Modify: `backend/services/scoring.py`

- [ ] **Step 1: 改造 routers/qa.py**

```python
# 改造前 (qa.py:22-25):
from prompts import NURSING_SYSTEM_PROMPT
# ...
messages = [
    {"role": "system", "content": NURSING_SYSTEM_PROMPT},
    {"role": "user", "content": req.question},
]

# 改造后:
from services.prompt_manager import get_prompt_manager
# ...
pm = await get_prompt_manager()
tmpl = await pm.get("qa")
messages = [
    {"role": "system", "content": tmpl.system_prompt},
    {"role": "user", "content": req.question},
]
```

- [ ] **Step 2: 改造 routers/chat.py (非流式部分)**

替换 `_build_llm_context` 中的 `build_patient_system_prompt(case_data, allowed)` 调用：

```python
# 改造后:
from services.prompt_manager import get_prompt_manager
pm = await get_prompt_manager()
tmpl = await pm.get("patient_chat")

system_prompt = tmpl.render(
    communication_style=case_data.get("communication_style", "友善自然"),
    patient_info=f"{case_data.get('patient_info', {}).get('name', '患者')}，"
                 f"{case_data.get('patient_info', {}).get('age', '')}岁，"
                 f"{case_data.get('patient_info', {}).get('gender', '')}",
    chief_complaint=case_data.get("chief_complaint", ""),
    present_illness=case_data.get("present_illness", ""),
    allergy_history=case_data.get("allergy_history", "无"),
    hidden_info_rules=_format_hidden_info(allowed.get("triggered", [])),
)
# ... messages = [{"role":"system","content":system_prompt}, ...history, ...student]
```

注意：`build_patient_system_prompt` 函数仍保留在 `prompts.py` 中作为兜底，但 `_build_llm_context` 不再调用它。

- [ ] **Step 3: 改造 routers/chat.py (流式部分)**

同步改造 `_build_llm_context` 调用（流式和非流式共用同一函数）。

- [ ] **Step 4: 改造 services/scoring.py**

```python
# 改造后:
from services.prompt_manager import get_prompt_manager

async def evaluate_training(...):
    pm = await get_prompt_manager()
    tmpl = await pm.get("scoring")

    rubric = load_rubric("nursing_history_v1")
    # 预计算 rubric 文本和 JSON 模板（保持现有计算逻辑）
    dim_text, dim_json = _build_rubric_parts(rubric)
    required = json.dumps(case_data.get("required_inquiries", []), ensure_ascii=False, indent=2)

    system, user = tmpl.render_pair(
        rubric_dim_text=dim_text,
        rubric_json_template=dim_json,
        required_inquiries=required,
        conversation_text=conversation_text,
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    result = await call_llm_json(messages, purpose="scoring", ...)
```

注意：`_build_rubric_parts` 是从原 `build_scoring_prompt_from_rubric` 中提取的纯数据格式化函数，放在 `prompts.py` 中（或 scoring.py 中）作为工具函数。

- [ ] **Step 5: 验证所有改造点编译通过**

```bash
cd backend && python -c "from routers.qa import router; from routers.chat import router; from services.scoring import evaluate_training; print('OK')"
```

Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add backend/routers/qa.py backend/routers/chat.py backend/services/scoring.py
git commit -m "🔧 refactor: use PromptManager in qa/chat/scoring call sites"
```

---

### Task 14: 前端 Prompt 管理 Tab

**Files:**
- Modify: `frontend/src/api/apiManagement.js`
- Create: `frontend/src/components/teacher/PromptManagementTab.jsx`
- Modify: `frontend/src/pages/Admin.jsx`

- [ ] **Step 1: 添加前端 API 调用**

在 `apiManagement.js` 末尾追加：

```javascript
// Prompts
export function fetchPrompts(purpose) {
  const params = {};
  if (purpose) params.purpose = purpose;
  return api.get("/admin/prompts", { params });
}
export function createPrompt(data) { return api.post("/admin/prompts", data); }
export function updatePrompt(id, data) { return api.put(`/admin/prompts/${id}`, data); }
export function deletePrompt(id) { return api.delete(`/admin/prompts/${id}`); }
export function activatePrompt(id) { return api.post(`/admin/prompts/${id}/activate`); }
export function validatePrompt(data) { return api.post("/admin/prompts/validate", data); }
export function reloadPrompts() { return api.post("/admin/prompts/reload"); }
```

- [ ] **Step 2: 创建 PromptManagementTab.jsx**

```jsx
import { useState, useEffect, useCallback } from "react";
import { Plus, Edit3, Trash2, CheckCircle, Play } from "lucide-react";
import { fetchPrompts, createPrompt, updatePrompt, deletePrompt, activatePrompt, validatePrompt, reloadPrompts } from "../../api/apiManagement";
import { useToast } from "../Toast";
import { useConfirm } from "../ui/ConfirmDialog";

const PURPOSES = ["patient_chat", "scoring", "qa"];
const PURPOSE_LABELS = { patient_chat: "患者对话", scoring: "评分", qa: "问答" };

export default function PromptManagementTab() {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [prompts, setPrompts] = useState([]);
  const [filterPurpose, setFilterPurpose] = useState("");
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ purpose: "patient_chat", name: "", system_prompt: "", user_prompt: "", remark: "", activate: true });
  const [validation, setValidation] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    fetchPrompts(filterPurpose || null).then(({ data }) => setPrompts(data)).catch(() => toast.error("加载失败"));
  }, [filterPurpose, toast]);

  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setEditing(null);
    setForm({ purpose: filterPurpose || "patient_chat", name: "", system_prompt: "", user_prompt: "", remark: "", activate: true });
    setValidation(null);
    setShowForm(true);
  };
  const openEdit = (p) => {
    setEditing(p);
    setForm({ purpose: p.purpose, name: p.name || "", system_prompt: p.system_prompt, user_prompt: p.user_prompt || "", remark: p.remark || "", activate: false });
    setValidation(null);
    setShowForm(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editing) {
        await updatePrompt(editing.id, { name: form.name, system_prompt: form.system_prompt, user_prompt: form.user_prompt || null, remark: form.remark });
        toast.success("已保存");
      } else {
        await createPrompt(form);
        toast.success("已创建");
      }
      setShowForm(false);
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "保存失败"); }
    finally { setSaving(false); }
  };

  const handleActivate = async (p) => {
    const ok = await confirm({ title: "激活模板", message: `切换到 v${p.version} "${p.name || ''}" 作为 ${PURPOSE_LABELS[p.purpose] || p.purpose} 的当前模板？立即生效！`, confirmText: "激活" });
    if (!ok) return;
    try { await activatePrompt(p.id); toast.success("已激活"); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "激活失败"); }
  };

  const handleDelete = async (p) => {
    if (p.is_active) { toast.error("不能删除当前激活的模板"); return; }
    const ok = await confirm({ title: "删除模板", message: `删除 v${p.version}?`, confirmText: "删除", danger: true });
    if (!ok) return;
    try { await deletePrompt(p.id); toast.success("已删除"); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "删除失败"); }
  };

  const handleValidate = async () => {
    try {
      const { data } = await validatePrompt({ system_prompt: form.system_prompt, user_prompt: form.user_prompt || null });
      setValidation(data);
    } catch (err) { toast.error("校验失败"); }
  };

  const handleReload = async () => {
    try { await reloadPrompts(); toast.success("模板已热加载"); }
    catch (err) { toast.error("热加载失败"); }
  };

  const s = { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" };
  const th = { padding: "var(--space-2) var(--space-3)", textAlign: "left", color: "var(--text-secondary)", fontWeight: 600, borderBottom: "2px solid var(--border-color)", fontSize: "0.75rem" };
  const td = { padding: "var(--space-2) var(--space-3)", borderBottom: "1px solid var(--border-color)" };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)", flexWrap: "wrap", gap: "var(--space-2)" }}>
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
          <select value={filterPurpose} onChange={(e) => setFilterPurpose(e.target.value)} style={{ padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", fontSize: "0.85rem", background: "var(--bg-surface)", color: "var(--text-primary)" }}>
            <option value="">全部场景</option>
            {PURPOSES.map((p) => <option key={p} value={p}>{PURPOSE_LABELS[p]}</option>)}
          </select>
          <button onClick={handleReload} style={{ padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", background: "var(--bg-surface)", color: "var(--text-primary)", cursor: "pointer", fontSize: "0.85rem" }}>热加载</button>
        </div>
        <button onClick={openNew} style={{ padding: "var(--space-2) var(--space-4)", border: "none", borderRadius: "var(--radius-md)", background: "var(--color-primary)", color: "#fff", cursor: "pointer", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
          <Plus size={14} /> 新建版本
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: "var(--space-5)", padding: "var(--space-5)" }}>
          <h4 style={{ margin: "0 0 var(--space-4) 0", fontSize: "0.95rem" }}>{editing ? "编辑模板" : "新建模板"}</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)", marginBottom: "var(--space-3)" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 }}>场景</label>
              <select disabled={!!editing} value={form.purpose} onChange={(e) => setForm(f => ({...f, purpose: e.target.value}))}
                style={{ width: "100%", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", fontSize: "0.85rem", background: "var(--bg-surface)", color: "var(--text-primary)" }}>
                {PURPOSES.map((p) => <option key={p} value={p}>{PURPOSE_LABELS[p]}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 }}>版本名称</label>
              <input value={form.name} onChange={(e) => setForm(f => ({...f, name: e.target.value}))} placeholder="v2-优化版" style={{ width: "100%", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", fontSize: "0.85rem", background: "var(--bg-surface)", color: "var(--text-primary)", boxSizing: "border-box" }} />
            </div>
          </div>
          <div style={{ marginBottom: "var(--space-3)" }}>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 }}>System Prompt</label>
            <textarea value={form.system_prompt} onChange={(e) => setForm(f => ({...f, system_prompt: e.target.value}))} rows={8}
              style={{ width: "100%", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", fontSize: "0.8rem", fontFamily: "monospace", background: "var(--bg-surface)", color: "var(--text-primary)", boxSizing: "border-box", resize: "vertical" }} />
          </div>
          {form.purpose === "scoring" && (
            <div style={{ marginBottom: "var(--space-3)" }}>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 }}>User Prompt Template</label>
              <textarea value={form.user_prompt} onChange={(e) => setForm(f => ({...f, user_prompt: e.target.value}))} rows={4}
                style={{ width: "100%", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", fontSize: "0.8rem", fontFamily: "monospace", background: "var(--bg-surface)", color: "var(--text-primary)", boxSizing: "border-box", resize: "vertical" }} />
            </div>
          )}
          <div style={{ marginBottom: "var(--space-3)" }}>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 }}>备注</label>
            <input value={form.remark} onChange={(e) => setForm(f => ({...f, remark: e.target.value}))} placeholder="修改说明..." style={{ width: "100%", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", fontSize: "0.85rem", background: "var(--bg-surface)", color: "var(--text-primary)", boxSizing: "border-box" }} />
          </div>
          {validation && (
            <div style={{ padding: "var(--space-3)", borderRadius: "var(--radius-md)", marginBottom: "var(--space-3)",
              background: validation.valid ? "var(--green-50)" : "var(--red-50)",
              color: validation.valid ? "var(--green-700)" : "var(--red-700)", fontSize: "0.8rem" }}>
              {validation.valid ? "✓ 语法校验通过" : "✗ " + validation.errors.join("; ")}
              {validation.missing_vars?.length > 0 && <div style={{ marginTop: 4 }}>模板中使用但未声明的变量: {validation.missing_vars.join(", ")}</div>}
            </div>
          )}
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <button onClick={handleValidate} style={{ padding: "var(--space-2) var(--space-4)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", background: "var(--bg-surface)", color: "var(--text-primary)", cursor: "pointer", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: 4 }}>
              <Play size={14} /> 校验语法
            </button>
            <button onClick={handleSave} disabled={saving} style={{ padding: "var(--space-2) var(--space-4)", border: "none", borderRadius: "var(--radius-md)", background: "var(--color-primary)", color: "#fff", cursor: saving ? "not-allowed" : "pointer", fontSize: "0.85rem", opacity: saving ? 0.6 : 1 }}>
              {saving ? "保存中..." : editing ? "保存修改" : "创建版本"}
            </button>
            <button onClick={() => setShowForm(false)} style={{ padding: "var(--space-2) var(--space-4)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", background: "var(--bg-surface)", color: "var(--text-secondary)", cursor: "pointer", fontSize: "0.85rem" }}>取消</button>
          </div>
        </div>
      )}

      <div className="card" style={{ overflow: "auto" }}>
        <table style={s}>
          <thead><tr>
            <th style={th}>场景</th><th style={th}>版本</th><th style={th}>名称</th><th style={th}>System Prompt 预览</th><th style={th}>状态</th><th style={th}>备注</th><th style={th}>操作</th>
          </tr></thead>
          <tbody>
            {prompts.length === 0 ? (
              <tr><td colSpan={7} style={{ ...td, textAlign: "center", padding: "var(--space-6)", color: "var(--text-tertiary)" }}>暂无模板</td></tr>
            ) : prompts.map((p) => (
              <tr key={p.id}>
                <td style={td}><span style={{ padding: "2px 8px", borderRadius: "var(--radius-full)", fontSize: "0.75rem", background: "var(--bg-surface-subtle)" }}>{PURPOSE_LABELS[p.purpose] || p.purpose}</span></td>
                <td style={td}>v{p.version}</td>
                <td style={td}>{p.name || "-"}</td>
                <td style={{ ...td, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace", fontSize: "0.75rem" }}>{p.system_prompt}</td>
                <td style={td}>
                  {p.is_active ? (
                    <span style={{ padding: "2px 8px", borderRadius: "var(--radius-full)", fontSize: "0.75rem", background: "var(--green-100)", color: "var(--green-700)", display: "inline-flex", alignItems: "center", gap: 2 }}>
                      <CheckCircle size={12} /> 激活
                    </span>
                  ) : null}
                </td>
                <td style={{ ...td, fontSize: "0.75rem", color: "var(--text-tertiary)" }}>{p.remark || "-"}</td>
                <td style={td}>
                  {!p.is_active && (
                    <button onClick={() => handleActivate(p)} style={{ background: "none", border: "none", color: "var(--green-500)", cursor: "pointer", padding: "var(--space-1)", fontSize: "0.75rem" }} title="激活">
                      <CheckCircle size={14} />
                    </button>
                  )}
                  <button onClick={() => openEdit(p)} style={{ background: "none", border: "none", color: "var(--color-primary)", cursor: "pointer", padding: "var(--space-1)" }}>
                    <Edit3 size={14} />
                  </button>
                  <button onClick={() => handleDelete(p)} style={{ background: "none", border: "none", color: "var(--red-400)", cursor: "pointer", padding: "var(--space-1)" }}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 注册到 Admin.jsx**

```jsx
import PromptManagementTab from "../components/teacher/PromptManagementTab";

// 在 ADMIN_TABS 中添加:
{ key: "prompts", label: "Prompt 管理" },

// 添加条件渲染:
{activeTab === "prompts" && <PromptManagementTab />}
```

- [ ] **Step 4: 验证前端编译**

```bash
cd frontend && npx vite build 2>&1 | tail -20
```

Expected: Build successful.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/apiManagement.js frontend/src/components/teacher/PromptManagementTab.jsx frontend/src/pages/Admin.jsx
git commit -m "✨ feat: add prompt management UI tab with version control and validation"
```

---

### Task 15: 全栈集成测试

**Files:**
- Modify: `backend/tests/test_llm_router.py` (updated in Task 5)

- [ ] **Step 1: 运行全部后端测试**

```bash
cd backend && python -m pytest tests/ -v --tb=short 2>&1 | tail -40
```

Expected: 全部通过，无 regression。

- [ ] **Step 2: 运行前端构建**

```bash
cd frontend && npx vite build 2>&1 | tail -15
```

Expected: ✓ built in Xs

- [ ] **Step 3: 启动后端验证路由注册**

```bash
cd backend && timeout 5 python -c "
from main import app
routes = [(r.path, list(r.methods)) for r in app.routes if hasattr(r, 'methods')]
admin_routes = [r for r in routes if '/admin/' in r[0]]
for r in sorted(admin_routes):
    print(r[1], r[0])
" 2>&1 || true
```

Expected: 输出包含 `/admin/api/providers`, `/admin/api/keys`, `/admin/api/reload`, `/admin/api/prompts`, `/admin/api/prompts/validate` 等路由。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "✅ test: verify full integration after refactoring"
```

---

## 验收检查清单

- [ ] `api_key_rules` 表已删除，`api_keys` 有 `purpose` 和 `priority` 列
- [ ] `LLMRouter.select_key()` 按 provider.priority 升序 + 同 provider 内 weighted random
- [ ] 前端 ApiManagementTab 显示按场景分组的 key 卡片 + provider 拖拽排序
- [ ] KeyModal 表单包含 purpose 下拉 + weight 滑块，无 rules 子表
- [ ] `prompt_templates` 表存在，`PromptManager` 启动时加载
- [ ] QA/Chat/Scoring 使用 `PromptManager.get()` 获取模板
- [ ] DB 为空时所有 prompt 从 `prompt_manager.py` 硬编码兜底
- [ ] 前端 PromptManagementTab 可创建/编辑/激活/删除 prompt 版本
- [ ] 激活 prompt 后自动热加载，无需重启
- [ ] 所有后端测试通过，前端构建成功
