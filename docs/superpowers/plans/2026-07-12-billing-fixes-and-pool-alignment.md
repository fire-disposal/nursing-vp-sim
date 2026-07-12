# 计费修复 + 连接池对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复成本计费的系统性失真（pro 少计费 3x、幻影成本、ASR 计费维度、缓存命中价、时区分桶），并把 DB 连接池以 RAM 友好方式对齐 50 并发目标。

**Architecture:** 计费逻辑修复集中在 `token_counter.py`（定价公式）、`logging.py`（明细记账）、`costs.py`（聚合展示）、`asr.py`（语音计费维度）。连接池仅调 `database.py` 一处。均为纯逻辑/配置，无 schema 迁移（`Float→Numeric` 的 F-1 与连接持有根因 A1 各自独立成轮，见文末）。

**Tech Stack:** FastAPI + SQLAlchemy + PostgreSQL；`uv run` from `backend/`；pytest。

**服务器约束（已实测）：** 2 vCPU / 3.8GiB RAM 共享机，PG `max_connections=100`。稀缺资源是内存，不是 PG 连接数——故连接池取"小常驻 + 大突发"。

**关联审计：** 成本审计报告（本会话）H-1 / M-1 / M-2 / M-3 / L-4；并发审计 P1-2。

---

## Task B1: pro 模型少计费 ~3x（H-1，定价改为模型优先）

**Files:**
- Modify: `backend/infrastructure/llm/token_counter.py:47-74`
- Test: `backend/tests/core/test_token_counter.py`（新建）

**根因：** `estimate_cost_cny` 优先用传入的 key 价（`price_input/price_output`）。种子把共享密钥写死 flash 价 (1/2)，该 key 又绑定 pro 用途（scoring/feedback），导致 pro 永远按 flash 计，实际成本约为记录的 3 倍。单 key 单一价格无法表达多模型定价，故**以模型为权威定价维度**。

- [ ] **Step 1: 写失败测试**

新建 `backend/tests/core/test_token_counter.py`：

```python
from infrastructure.llm.token_counter import estimate_cost_cny


def test_pro_model_priced_by_model_not_key_flat_price():
    # key 价为 flash(1/2)，但模型是 pro(3/6) —— 必须按模型 3/6 计。
    cost = estimate_cost_cny(
        1_000_000, 1_000_000, price_input=1.0, price_output=2.0, model="deepseek-v4-pro"
    )
    assert cost == 9.0  # 3 + 6，而非旧行为的 3.0 (1+2)


def test_flash_model_priced_by_model():
    cost = estimate_cost_cny(1_000_000, 1_000_000, model="deepseek-v4-flash")
    assert cost == 3.0  # 1 + 2


def test_no_model_falls_back_to_key_price():
    cost = estimate_cost_cny(1_000_000, 0, price_input=5.0, price_output=9.0)
    assert cost == 5.0
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend; uv run python -m pytest tests/core/test_token_counter.py -x -q`
Expected: FAIL（第 1 个断言得到 3.0）

- [ ] **Step 3: 改为模型优先**

`token_counter.py` 的 `estimate_cost_cny` 主体替换为：

```python
    # 定价优先级：模型（权威官方价）> 显式 key 价（仅当无 model 时）> 环境变量回退。
    # 理由：单个 ApiSecret 只有一对价格，无法表达多模型定价；pro/flash 官方价才是
    # 正确的每模型定价维度（修复 H-1：pro 被按 flash 少计 ~3x）。
    if model:
        pi, po = get_model_price_cny(model)
    elif price_input is not None and price_input > 0 and price_output is not None and price_output > 0:
        pi, po = price_input, price_output
    else:
        from core.config import LLM_PRICE_INPUT_PER_1M, LLM_PRICE_OUTPUT_PER_1M

        pi, po = LLM_PRICE_INPUT_PER_1M, LLM_PRICE_OUTPUT_PER_1M

    return round(prompt_tokens / 1_000_000 * float(pi) + completion_tokens / 1_000_000 * float(po), 6)
```

同步更新函数 docstring 的优先级描述。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend; uv run python -m pytest tests/core/test_token_counter.py -x -q`
Expected: PASS

- [ ] **Step 5: 回归 + 提交**

Run: `cd backend; uv run ruff check infrastructure/llm/token_counter.py tests/core/test_token_counter.py; uv run ty check infrastructure/llm/token_counter.py; uv run python -m pytest tests/core/ -x -q`

```bash
git add backend/infrastructure/llm/token_counter.py backend/tests/core/test_token_counter.py
git commit -m "🐛 fix: LLM 成本改为模型优先定价，修复 pro 按 flash 少计 ~3x"
```

---

## Task B2: 失败调用幻影成本计入总额（M-3）

**Files:**
- Modify: `backend/services/costs.py`（`_llm_stats:71-78`、`_daily_series:99-107`、`export_data:274-287`）
- Test: `backend/tests/admin/test_costs.py`（新建或追加）

**根因：** 失败调用（预连接失败/全 provider 失败，实际未扣费）带 `request_text` 入队，`_build_entry` 估出 `estimated_cost>0`、`status='failed'`。仪表盘对所有 status 求和，把幻影成本计入 `total_cost`/`monthly_used`。修复：**成本聚合只算 `status='success'`**。

- [ ] **Step 1: 写失败测试**

追加/新建 `backend/tests/admin/test_costs.py`：

```python
from datetime import UTC, datetime

from models import LLMCallLog
from services.costs import CostService


def _add_log(db, status, cost):
    db.add(LLMCallLog(
        purpose="scoring", provider_name="deepseek", model="deepseek-v4-pro",
        prompt_tokens=10, completion_tokens=10, total_tokens=20, token_estimated=1,
        estimated_cost=cost, cost_currency="CNY", latency_ms=100, status=status,
        created_at=datetime.now(UTC),
    ))
    db.flush()


def test_llm_cost_excludes_failed_calls(db_session):
    _add_log(db_session, "success", 0.5)
    _add_log(db_session, "failed", 0.9)  # 幻影成本
    svc = CostService(db_session)
    total, success, error_count, avg_latency, total_cost = svc._llm_stats(
        datetime(2000, 1, 1, tzinfo=UTC)
    )
    assert total == 2
    assert round(total_cost, 6) == 0.5  # 幻影 0.9 不计入
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend; uv run python -m pytest tests/admin/test_costs.py -x -q`
Expected: FAIL（total_cost=1.4）

- [ ] **Step 3: 成本聚合加 success 过滤**

`costs.py` `_llm_stats` 的 `total_cost` 查询：

```python
        total_cost = (
            self.db.query(func.sum(LLMCallLog.estimated_cost))
            .filter(LLMCallLog.created_at >= since, LLMCallLog.status == "success")
            .scalar()
        )
```

`_daily_series` 的 llm 查询 `.filter(...)` 加 `LLMCallLog.status == "success"`。
`export_data` 的 llm 成本 `func.coalesce(func.sum(...))` 改为仅统计 success 的成本——用 `func.sum(func.case((LLMCallLog.status == "success", LLMCallLog.estimated_cost), else_=0))` 保持 calls/success/error 计数不变、仅成本按 success。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend; uv run python -m pytest tests/admin/test_costs.py -x -q`
Expected: PASS

- [ ] **Step 5: 回归 + 提交**

Run: `cd backend; uv run ruff check services/costs.py; uv run ty check services/costs.py`

```bash
git add backend/services/costs.py backend/tests/admin/test_costs.py
git commit -m "🐛 fix: 成本聚合仅统计 success 调用，排除失败调用幻影成本"
```

---

## Task B3: ASR 按转写字符计费（维度错误，M-2）

**Files:**
- Modify: `backend/routers/asr.py:34`（费率常量）、`browser_to_upstream`（累计字节）、计费写入处（~171-184）
- Test: 手动/集成（WS 流难以单测，见 Step 4）

**根因：** `cost = len(final_text) * _ASR_COST_PER_CHAR`。火山流式 ASR 按**音频时长**计费。浏览器上传 16kHz mono 16-bit PCM，`duration_sec = 总字节 / (16000*2)`。

- [ ] **Step 1: 费率常量改为按秒**

`asr.py` 顶部：

```python
# 火山流式 ASR 按音频时长计费。浏览器上传 16kHz mono 16-bit PCM => 32000 bytes/s。
_ASR_BYTES_PER_SEC = 16000 * 2
_ASR_COST_PER_SECOND = float(os.getenv("ASR_COST_PER_SECOND", "0.0018"))
```

（保留旧 `_ASR_COST_PER_CHAR` 删除。确认 `os` 已导入。`0.0018` 为占位估值，须由运维按实际报价经 `ASR_COST_PER_SECOND` 覆盖。）

- [ ] **Step 2: 累计上行音频字节**

在 `browser_to_upstream` 外层用可变容器累计（`nonlocal` 或 list）：在 `t0 = time.perf_counter()` 附近加 `audio_bytes = 0`，改为闭包可写（用 `audio_bytes` 装入 `dict`：`stats = {"bytes": 0}`）。在 `await client.send_audio(data)` 前 `stats["bytes"] += len(data)`。

- [ ] **Step 3: 计费按时长**

原按字符计费处改为：

```python
        duration_sec = stats["bytes"] / _ASR_BYTES_PER_SEC
        cost = round(duration_sec * _ASR_COST_PER_SECOND, 6)
```

`VoiceCallLog` 的 `text_length` 仍记 `len(final_text)`（用于展示），`cost_estimated` 用上面的 duration 成本。

- [ ] **Step 4: 验证**

Run: `cd backend; uv run ruff check routers/asr.py; uv run ty check routers/asr.py; uv run python -m pytest tests/ -x -q -k "asr or voice"`
Expected: clean（若无 asr 单测则仅 ruff/ty 通过）。手动核验：说一段话，检查 `voice_call_logs.cost_estimated` 与音频时长成比例。

- [ ] **Step 5: 提交**

```bash
git add backend/routers/asr.py
git commit -m "🐛 fix: ASR 计费改为按音频时长，替代按转写字符数"
```

---

## Task B4: 缓存命中未按缓存价计费（M-1）

**Files:**
- Modify: `backend/infrastructure/llm/token_counter.py`（新增缓存定价）、`backend/infrastructure/llm/logging.py:44-61`（`_build_entry` 用缓存 token 分段计价）
- Verify: 流式路径缓存 token 捕获（`client.py` `_do_stream`）
- Test: `backend/tests/core/test_token_counter.py`

**根因：** `estimate_cost_cny` 把全部 `prompt_tokens` 按满额输入价计。DeepSeek 对 `prompt_cache_hit_tokens` 收费极低（flash ¥0.02、pro ¥0.025 /百万）。非流式已在 `_do_call:638-639` 捕获 hit/miss 并写入日志列，但成本公式没用；流式路径未捕获。

- [ ] **Step 1: 新增缓存定价 + 分段计价（先测）**

追加测试到 `test_token_counter.py`：

```python
def test_cache_hit_priced_lower():
    # pro：100万 prompt 全部命中缓存 + 0 输出。命中价 ¥0.025/1M，远低于满价 ¥3。
    cost = estimate_cost_cny(
        1_000_000, 0, model="deepseek-v4-pro", cache_hit_tokens=1_000_000
    )
    assert cost == 0.025
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend; uv run python -m pytest tests/core/test_token_counter.py::test_cache_hit_priced_lower -x -q`
Expected: FAIL（当前得 3.0）

- [ ] **Step 3: 实现缓存分段计价**

`token_counter.py`：新增缓存价常量与查询：

```python
# 缓存命中价 (元/百万 tokens)
_CACHE_PRICE_FLASH = 0.02
_CACHE_PRICE_PRO = 0.025


def get_cache_price_cny(model: str) -> float:
    return _CACHE_PRICE_PRO if "pro" in (model or "").lower() else _CACHE_PRICE_FLASH
```

`estimate_cost_cny` 新增参数 `cache_hit_tokens: int = 0`，成本 =
`miss_tokens*输入价 + hit_tokens*缓存价 + completion*输出价`，其中 `miss = max(0, prompt - hit)`：

```python
def estimate_cost_cny(prompt_tokens, completion_tokens, *, price_input=None,
                      price_output=None, model=None, cache_hit_tokens=0):
    # ...(B1 的定价解析得到 pi, po)...
    hit = max(0, min(cache_hit_tokens or 0, prompt_tokens or 0))
    miss = max(0, (prompt_tokens or 0) - hit)
    cache_price = get_cache_price_cny(model) if model else 0.0
    return round(
        miss / 1_000_000 * float(pi)
        + hit / 1_000_000 * float(cache_price)
        + (completion_tokens or 0) / 1_000_000 * float(po),
        6,
    )
```

- [ ] **Step 4: `_build_entry` 传缓存 token**

`logging.py` `_build_entry`：`estimate_cost_cny(...)` 调用加 `cache_hit_tokens=cache_hit_tokens`。

- [ ] **Step 5: 补齐流式缓存捕获**

读 `client.py` `_do_stream`（~668-741）。确认是否设置 `stream_options={"include_usage": true}` 并从末尾 chunk 的 `usage` 读取 `prompt_cache_hit_tokens`；若未，则：
- 在 stream payload 加 `"stream_options": {"include_usage": True}`；
- 解析含 `usage` 的最终 chunk，写入 `state.cache_hit_tokens/cache_miss_tokens`；
- `stream()` 的 enqueue 传 `cache_hit_tokens=state.cache_hit_tokens, cache_miss_tokens=state.cache_miss_tokens`。

> 若流式改动风险偏高，本 Task 可只落 Step 1-4（覆盖非流式 scoring/feedback/qa-batch），Step 5 拆为独立提交。

- [ ] **Step 6: 跑测试 + 回归 + 提交**

Run: `cd backend; uv run python -m pytest tests/core/ -x -q; uv run ruff check infrastructure/llm/token_counter.py infrastructure/llm/logging.py infrastructure/llm/client.py; uv run ty check infrastructure/llm/`

```bash
git add backend/infrastructure/llm/token_counter.py backend/infrastructure/llm/logging.py backend/infrastructure/llm/client.py backend/tests/core/test_token_counter.py
git commit -m "🐛 fix: 缓存命中 token 按缓存价计费，避免成本高估"
```

---

## Task B6: 日/月成本分桶按北京时区（L-4）

**Files:**
- Modify: `backend/services/costs.py`（`_daily_series`、`export_data` 的日期截断）
- Test: `backend/tests/admin/test_costs.py`

**根因：** `func.date(created_at)` 按 UTC 切分；北京每日 00:00–08:00 的调用归到前一天，月初 8 小时错位到上月。列为 naive-UTC，需先按 UTC 解释再转上海时区。

- [ ] **Step 1: 加本地日期辅助**

`costs.py` 顶部：

```python
_LOCAL_TZ = "Asia/Shanghai"


def _local_date(col):
    # 列存 naive-UTC：先标记 UTC，再转北京时区取 date。
    return func.date(func.timezone(_LOCAL_TZ, func.timezone("UTC", col)))
```

- [ ] **Step 2: 替换分桶**

`_daily_series` 三处 `func.date(LLMCallLog.created_at)` / `func.date(VoiceCallLog.created_at)` → `_local_date(...)`；`export_data` 的 `func.date(...)`（非 monthly 分支）同样替换。`date_trunc("month", ...)` 亦包一层 timezone 转换。

- [ ] **Step 3: 测试（近午夜边界）**

追加测试：插入一条 `created_at = 2026-06-30 20:00 UTC`（= 北京 07-01 04:00），断言 `_daily_series` 把它归到 `2026-07-01` 桶。

Run: `cd backend; uv run python -m pytest tests/admin/test_costs.py -x -q`

> 注：SQLite 测试库不支持 `func.timezone`。若测试 DB 为 SQLite，此测试标 `@pytest.mark.postgres` 或改为对 `_local_date` SQL 编译串的断言；实际验证以 staging（PG）为准。先确认 conftest 的测试 DB 类型再决定。

- [ ] **Step 4: 提交**

```bash
git add backend/services/costs.py backend/tests/admin/test_costs.py
git commit -m "🐛 fix: 成本日/月分桶按 Asia/Shanghai 时区，修正跨零点错位"
```

---

## Task A2: 连接池以 RAM 友好方式对齐 50 并发

**Files:**
- Modify: `backend/core/database.py:20-21`

**设计：** 目标 50 并发。`pool_size` 决定常驻热连接（每条 = 一个 PG backend ~5-10MB，共享机内存稀缺）；`max_overflow` 决定突发上限（用完即关，不常驻）。故取 **小常驻 + 大突发**。

- [ ] **Step 1: 调整池参数**

```python
    pool_size=10,
    max_overflow=40,
```

（常驻仍 10，突发上限 50，与上游 HTTP 池 60 协调。）

- [ ] **Step 2: 验证 + 提交**

Run: `cd backend; uv run ruff check core/database.py`

```bash
git add backend/core/database.py
git commit -m "⚡ perf: 连接池对齐 50 并发（常驻 10 + 突发 40，RAM 友好）"
```

---

## 阶段收尾 Checkpoint

- [ ] **后端全绿**: `cd backend; uv run ruff check; uv run ruff format --check; uv run ty check; uv run python -m pytest -x -q`
- [ ] 汇报本轮完成，列出仍待办的独立轮次。

---

## 本轮不含（各自独立成轮）

- **A1（根因·连接持有）**：`chat.py`/`persister.py`/`asr.py` 缩短流式期间的 DB 连接持有——收益最大、需较多测试与谨慎回归，单独立轮。
- **B5（F-1·Float→Numeric）**：`LLMCallLog.estimated_cost` / `VoiceCallLog.cost_estimated` / `monthly_budget` 改 `Numeric(12,6)`——需一个 DDL 迁移，单独立轮。
- **A3 / C1 / C2**：threadpool 卸载同步 DB、环境变量化并入 compose、容器 mem_limit 观测后再定。

---

## Self-Review

- **Spec 覆盖**：H-1→B1；M-3→B2；M-2→B3；M-1→B4；L-4→B6；50 并发池→A2。F-1/根因显式拆出。
- **无占位符**：每步含实际代码/命令；ASR 费率、缓存价均给出具体数值与 env 覆盖点。
- **类型/签名一致**：`estimate_cost_cny` 在 B1 改定价解析、B4 加 `cache_hit_tokens` 参数——B4 基于 B1 结果实现，须按 B1→B4 顺序执行。`get_cache_price_cny`/`_local_date` 为新增辅助，调用点一致。
- **风险标注**：B4-Step5（流式捕获）、B6-Step3（SQLite 时区）已标注可拆分/条件化。
</content>
</invoke>
