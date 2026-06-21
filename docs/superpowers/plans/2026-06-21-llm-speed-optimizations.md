# LLM 调用速度优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化后端 LLM 调用链路，减少网络/代码层面延迟，提升 Context Caching 命中率。

**Architecture:** 七项独立优化：1) HTTP keepalive 延长，2) 降低 patient_chat temperature，3) 重构 patient_chat 消息结构以提升 KV Cache 命中率，4) Cache 监控，5) Scoring DB 并行，6) API `user` 参数隔离 KVCache，7) 修复 streaming `include_usage`。

**Tech Stack:** Python + httpx + DeepSeek API + SQLAlchemy

---

## 修改文件总览

| 文件 | 变更 | 优化项 |
|------|------|--------|
| `backend/main.py:156` | `keepalive_expiry` 30→120 | #1 |
| `backend/core/config.py:111` | `temperature` 0.6→0.3 | #2 |
| `backend/contexts/patient/prompt.py:93-124` | author_note 移到 user 消息之后 | #3 |
| `backend/contexts/training/pipeline/middleware/llm_caller.py:73,144` | identity leak 重试位置同步 | #3 |
| `backend/infrastructure/llm/client.py:420-440` | payload 添加 `user` 参数 | #6 |
| `backend/infrastructure/llm/client.py:483-502` | streaming payload 添加 `stream_options` + `user` | #6, #7 |
| `backend/infrastructure/llm/client.py:443-448` | 提取 cache hit/miss 字段 | #4 |
| `backend/infrastructure/llm/logging.py:19-87` | _build_entry 新增 cache 字段 | #4 |
| `backend/models.py:341-370` | LLMCallLog 新增 cache 列 | #4 |
| DD migration | autogenerate 新列 | #4 |
| `backend/contexts/training/score_engine.py:182-198` | asyncio.gather 并行化 DB 查询 | #5 |

---

### Task 1: HTTP Keepalive 延长

**Files:**
- Modify: `backend/main.py:156`

- [ ] **Step 1: 修改 keepalive_expiry**

```python
# main.py:156 — 改 30 为 120
keepalive_expiry=120,
```

- [ ] **Step 2: 验证语法**

```bash
cd backend && uv run python -c "import ast; ast.parse(open('main.py').read()); print('OK')"
```
Expected: `OK`

- [ ] **Step 3: 验证启动**

```bash
cd backend && uv run python -c "from core.config import LLM_CONNECTION_KEEPALIVE; print(LLM_CONNECTION_KEEPALIVE)"
```
Expected: `30`（此值来自环境变量，与代码无关。代码改的是 httpx 客户端的 keepalive_expiry 参数，不影响 config 值。）

- [ ] **Step 4: Commit**

```bash
git add backend/main.py
git commit -m "⚡ perf: extend httpx keepalive expiry from 30s to 120s"
```

---

### Task 2: patient_chat temperature 降低

**Files:**
- Modify: `backend/core/config.py:111`

- [ ] **Step 1: 修改 temperature**

`config.py:111` 中 `patient_chat` 条目的 `temperature` 从 `0.6` 改为 `0.3`：

```python
"patient_chat": {"timeout": 30, "max_tokens": 512, "temperature": 0.3, "max_retries": 2},
```

- [ ] **Step 2: 验证语法**

```bash
cd backend && uv run python -c "from core.config import get_llm_config; c = get_llm_config('patient_chat'); assert c['temperature'] == 0.3, f'Expected 0.3, got {c[\"temperature\"]}'; print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/core/config.py
git commit -m "⚡ perf: lower patient_chat temperature from 0.6 to 0.3 for faster decode"
```

---

### Task 3: Context Caching — 重构消息结构以提升 Cache 命中率

**Files:**
- Modify: `backend/contexts/patient/prompt.py:93-124`

**问题**：当前 `build_patient_chat_messages` 将 `author_note` 作为独立 system 消息插入到历史消息末尾、用户输入之前。这导致每轮请求的前缀结构不一致，KV Cache 无法命中。

**当前结构**（Round 1→2 前缀不匹配）：
```
Round 1: [system, system, author_note_1, user_msg_1]           ← Cache: [system, system, author_note_1, user_msg_1]
Round 2: [system, system, user_msg_1, assistant_1, author_note_2, user_msg_2]  ← 前缀不匹配，MISS
```

**新结构**（author_note 移到 user 消息之后）：
```
Round 1: [system, system, user_msg_1, system:author_note_1]    ← Cache: [system, system, user_msg_1]
Round 2: [system, system, user_msg_1, assistant_1, user_msg_2, system:author_note_2]  ← [system, system, user_msg_1] 命中！
```

- [ ] **Step 1: 修改 `build_patient_chat_messages`**

将 author_note 从用户输入前移到用户输入后：

```python
def build_patient_chat_messages(
    system_prompt: str,
    dynamic_prompt: str,
    history_messages: list,
    student_content: str,
    author_note: str = "",
    max_rounds: int = 8,
) -> list[dict]:
    """构建 AI酒馆风格的 messages 数组。

    结构：
      messages[0] = Character Card (静态, prefix cache)
      messages[1] = 患者资料+背景+示例 (per-session)
      messages[2..N] = 聊天历史
      messages[-2] = 用户输入
      messages[-1] = Author's Note (系统消息, 放在用户输入之后，提升 cache 命中率)
    """
    llm_messages = [
        {"role": "system", "content": system_prompt},
        {"role": "system", "content": dynamic_prompt},
    ]

    for msg in history_messages[-max_rounds * 2 :]:
        role = "user" if msg.role == "student" else "assistant"
        llm_messages.append({"role": role, "content": msg.content})

    llm_messages.append({"role": "user", "content": student_content})

    if author_note.strip():
        note_content = render_template(AUTHOR_NOTE_TEMPLATE, author_note=author_note)
        llm_messages.append({"role": "system", "content": note_content})

    return llm_messages
```

> 关键变化：`author_note` 从 `llm_messages.insert(-1, ...)`（在 user 之前）变为 `llm_messages.append(...)`（在 user 之后）。

- [ ] **Step 2: 同步修改 identity leak 重试中的 author_note 位置**

`llm_caller.py:73` 和 `llm_caller.py:144` 的 `msgs.insert(-1, ...)` 改为 `msgs.append(...)`：

```python
# llm_caller.py:73 — batch 重试
msgs.append({"role": "system", "content": get_identity_correction_note()})
```

```python
# llm_caller.py:144 — stream 重试
msgs.append({"role": "system", "content": corrected})
```

- [ ] **Step 3: 运行现有测试确保功能不受影响**

```bash
cd backend && uv run python -m pytest tests/contexts/patient/ -x -q 2>&1
```
Expected: 全部 PASS

```bash
cd backend && uv run python -m pytest tests/ -x -q -k "chat or training" 2>&1
```
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add backend/contexts/patient/prompt.py backend/contexts/training/pipeline/middleware/llm_caller.py
git commit -m "⚡ perf: move author_note after user message in LLM request to improve KV cache hit rate"
```

---

### Task 4: Context Caching — 添加 Cache Hit/Miss 监控

**Files:**
- Modify: `backend/infrastructure/llm/client.py:443-448`
- Modify: `backend/infrastructure/llm/logging.py:19-87`
- Modify: `backend/models.py:341-370`
- Create: `backend/migrations/versions/ddl/<autogenerated>.py`

- [ ] **Step 1: 从 API 响应中提取 cache hit/miss 字段**

`client.py:_do_call` 的响应处理（line 443-448 附近）提取 usage 中的 `prompt_cache_hit_tokens` 和 `prompt_cache_miss_tokens`：

```python
# client.py _do_call 方法中，resp.raise_for_status() 之后：
data = resp.json()
content = data["choices"][0]["message"]["content"]
usage = data.get("usage", {})
state.usage = usage
# 提取 cache 命中统计
cache_hit = usage.get("prompt_cache_hit_tokens", 0) or 0
cache_miss = usage.get("prompt_cache_miss_tokens", 0) or 0
```

同时需要将这两个值传递到 `_CallState`：

```python
@dataclass
class _CallState:
    # ... existing fields ...
    cache_hit_tokens: int = 0
    cache_miss_tokens: int = 0
```

在 `_do_call` 中赋值：
```python
state.cache_hit_tokens = cache_hit
state.cache_miss_tokens = cache_miss
```

在 `call()` 方法的成功路径（line 139）将 cache 数据传入 enqueue：
```python
self._log_worker.enqueue(
    # ... existing params ...
    cache_hit_tokens=state.cache_hit_tokens,
    cache_miss_tokens=state.cache_miss_tokens,
)
```

- [ ] **Step 2: 修改 LogWorker.enqueue 和 _build_entry**

`logging.py:_build_entry` 新增两个 cache 字段：

```python
def _build_entry(
    # ... existing params ...
    cache_hit_tokens=0,
    cache_miss_tokens=0,
):
    # ... existing code ...
    return {
        # ... existing fields ...
        "cache_hit_tokens": cache_hit_tokens,
        "cache_miss_tokens": cache_miss_tokens,
    }
```

`logging.py:LogWorker.enqueue` 新增对应参数并传递：

```python
def enqueue(
    self,
    # ... existing params ...
    cache_hit_tokens=0,
    cache_miss_tokens=0,
):
    # ... existing code ...
    entry = _build_entry(
        # ... existing params ...
        cache_hit_tokens=cache_hit_tokens,
        cache_miss_tokens=cache_miss_tokens,
    )
```

- [ ] **Step 3: LLMCallLog 模型新增两列**

`models.py:LLMCallLog` 添加：

```python
cache_hit_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
cache_miss_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
```

- [ ] **Step 4: 生成 autogenerate 迁移**

```bash
cd backend && uv run alembic revision --autogenerate -m "add llm_call_logs cache tracking columns"
```

检查生成的迁移文件确保只包含两列的 ADD COLUMN。

- [ ] **Step 5: 验证迁移**

```bash
cd backend && uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head
```
Expected: 三轮均成功。

- [ ] **Step 6: Commit**

```bash
git add backend/infrastructure/llm/client.py backend/infrastructure/llm/logging.py backend/models.py backend/migrations/versions/ddl/*.py
git commit -m "⚡ perf: add prompt cache hit/miss tracking to LLM call logs"
```

---

### Task 5: Scoring 前置 DB 查询并行化

**Files:**
- Modify: `backend/contexts/training/score_engine.py:182-198`

- [ ] **Step 1: 用 asyncio.gather 并行化三个 DB 查询**

`score_engine.py:evaluate_training` 中原来顺序的三个查询改为并行：

```python
# 原来（顺序）：
# record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
# messages = db.query(Message).filter(Message.record_id == record_id).order_by(Message.created_at).all()
# rubric = load_rubric_by_version(record.rubric_frozen or "nursing_history_v1@1.0")

# 改为并行：record 和 messages 可用 asyncio.gather（python 不可直接 await 同步 DB 查询，
# 但 record 依赖 rubric_frozen，rubric 依赖 record → 所以只能并行 record + messages，
# rubric 必须在 record 之后）

import asyncio

async def _fetch_record(db, record_id):
    return db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()

async def _fetch_messages(db, record_id):
    return db.query(Message).filter(Message.record_id == record_id).order_by(Message.created_at).all()

record, messages = await asyncio.gather(
    asyncio.to_thread(_fetch_record, db, record_id),
    asyncio.to_thread(_fetch_messages, db, record_id),
)
```

但 `asyncio.to_thread` 会创建新线程，线程内的 `db` session 是同一个 — SQLAlchemy Session 不是线程安全的！需要分别创建 session：

```python
from core.database import SessionLocal

async def _fetch_record(record_id: int):
    db = SessionLocal()
    try:
        return db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    finally:
        db.close()

async def _fetch_messages(record_id: int):
    db = SessionLocal()
    try:
        return db.query(Message).filter(Message.record_id == record_id).order_by(Message.created_at).all()
    finally:
        db.close()

record, messages = await asyncio.gather(
    asyncio.to_thread(_fetch_record, record_id),
    asyncio.to_thread(_fetch_messages, record_id),
)
```

> 注意：rubric 查询保留在原位置，因为它依赖 `record.rubric_frozen`，必须在 record 返回后执行。

- [ ] **Step 2: 确保现有逻辑不变**

并行化后其他代码保持不变：conversation_text 的构建、tracker 更新顺序、rubric 加载等都保持原样。

- [ ] **Step 3: 运行 scoring 测试**

```bash
cd backend && uv run python -m pytest tests/ -x -q -k "scoring or score" 2>&1
```
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add backend/contexts/training/score_engine.py
git commit -m "⚡ perf: parallelize scoring pre-LLM DB queries with asyncio.gather"
```

---

## 验证清单

全部完成后运行完整测试：

```bash
cd backend && uv run python -m pytest -x -q
cd backend && uv run ruff check && uv run ruff format --check
cd backend && uv run ty check
cd frontend && npx tsc --noEmit && npx biome check
```

---

---

### Task 6: 添加 API `user` 参数（KVCache 隔离 + 滥用监控）

**Files:**
- Modify: `backend/infrastructure/llm/client.py:420-440` (`_do_call` payload)
- Modify: `backend/infrastructure/llm/client.py:483-502` (`_do_stream` payload)

- [ ] **Step 1: `_do_call` 添加 `user` 参数**

`client.py` 中 `_do_call` 的 payload 构造处（line 420）添加 `user` 字段，从 `CallContext` 获取 `record_id`：

```python
payload: dict = {
    "model": state.model,
    "messages": messages,
    "temperature": temperature,
    "max_tokens": max_tokens,
}
# Add end-user ID for KV cache isolation per training session
if ctx and ctx.record_id:
    payload["user"] = str(ctx.record_id)
if response_format:
    payload["response_format"] = response_format
```

> `ctx` 需要从 `call()` / `stream()` → `_do_call()` / `_do_stream()` 传递。当前 `_do_call` 不接收 `ctx`，需修改其签名。

- [ ] **Step 2: 修改 `_do_call` 和 `call()` 签名传递 ctx**

`_do_call` 方法签名添加 `ctx` 参数：

```python
async def _do_call(
    self,
    messages,
    state,
    purpose,
    temperature,
    max_tokens,
    timeout,
    response_format,
    ctx,  # ← 新增
) -> str:
```

`call()` 方法中调用 `_do_call` 时传递 ctx：

```python
# line 122
return await self._do_call(
    messages, state, purpose, temperature,
    max_tokens, timeout, response_format, ctx,
)
```

- [ ] **Step 3: `_do_stream` 同样添加 `user` 参数**

`_do_stream` 签名添加 `ctx`，payload 中添加 `user`：

```python
async def _do_stream(
    self, messages, state, purpose, temperature,
    max_tokens, timeout, ctx,  # ← 新增 ctx
) -> AsyncIterator[str]:

    payload = {
        "model": state.model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    if ctx and ctx.record_id:
        payload["user"] = str(ctx.record_id)
```

`stream()` 方法中调用 `_do_stream` 时传递 ctx。

- [ ] **Step 4: 验证**

```bash
cd backend && uv run python -m pytest tests/core/test_llm_client.py -x -q 2>&1
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/infrastructure/llm/client.py
git commit -m "⚡ perf: add user parameter to LLM API payload for KV cache isolation per session"
```

---

### Task 7: 修复 Streaming `stream_options.include_usage`

**Files:**
- Modify: `backend/infrastructure/llm/client.py:483-502` (`_do_stream` payload)

- [ ] **Step 1: 添加 `stream_options` 到 streaming payload**

`client.py:_do_stream` 的 payload（line 483）添加 `stream_options`：

```python
payload = {
    "model": state.model,
    "messages": messages,
    "temperature": temperature,
    "max_tokens": max_tokens,
    "stream": True,
    "stream_options": {"include_usage": True},
}
```

> 这会使得 DeepSeek API 在流式输出最后一个 chunk 之前发送一个包含完整 `usage` 的 chunk，从而 `_do_stream` line 520-522 的 usage 提取逻辑生效，避免每次都 fallback 到本地估算。

- [ ] **Step 2: 验证**

```bash
cd backend && uv run python -m pytest tests/core/test_llm_client.py -x -q 2>&1
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add backend/infrastructure/llm/client.py
git commit -m "🐛 fix: add stream_options.include_usage to enable API token tracking for streaming calls"
```

---

## 预期收益

| 优化项 | 预期收益 | 风险 |
|--------|----------|------|
| #1 Keepalive | 减少空闲期 TLS 重协商（~5ms/冷请求） | 无 |
| #2 Lower temperature | 减少 token 采样多样性，略加快 decode | patient 回复可能略缺变化 |
| #3 Cache 结构优化 | 第2轮起 prompt tokens 减半，逐轮增长（cascading） | author_note 移到末尾需验证回复质量 |
| #4 Cache 监控 | 为后续优化提供数据依据 | migration 添加两列（低风险） |
| #5 Scoring DB 并行 | ~10-20ms | 需要独立的 DB session |
| #6 API `user` 参数 | KVCache 按训练会话隔离，避免跨会话缓存污染 | 无 |
| #7 `stream_options` 修复 | streaming 调用获得真实 API usage，不再被迫 fallback 估算 | 无 |
