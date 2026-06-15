# 评分进度展示优化设计

## 背景

当前训练结束后的评分进度展示存在以下问题：

1. **前端进度条与后端完全脱钩**：`ScoreManager` 使用 `min(95, 30 + retries*2)` 计算进度，`ScoringOverlay` 使用 200ms 自增计数器（cap 95%），两者都是伪进度
2. **`/scoring-status` 不返回进度信息**，只返回 `scoring_status` 和 `score`，前端无法展示真实阶段
3. **两套进度逻辑冲突**：`ScoreManager` 的轮询进度和 `ScoringOverlay` 的自增进度各自独立，互相覆盖

## 目标

- 后端上报评分真实阶段和百分比进度
- 前端进度条展示真实阶段名称 + 百分比
- 消除伪进度和冲突逻辑
- 评分超时/失败时展示明确错误信息和操作按钮

## 范围

- 后端：新增内存进度跟踪器 + 改造 scoring-status 端点
- 前端：重写 ScoreManager + ScoringOverlay
- 不涉及：DB 模型变更、WebSocket 引入

---

## 后端设计

### ScoringProgressTracker

`backend/infrastructure/scoring_progress.py`

```python
from dataclasses import dataclass, field
import time

Phase = Literal["loading", "scoring", "feedback", "saving", "completed", "failed"]

@dataclass
class ScoringProgress:
    phase: Phase
    percentage: int         # 0-100
    message: str
    updated_at: float = field(default_factory=time.time)

class ScoringProgressTracker:
    """In-memory scoring progress store with auto-cleanup."""
    
    def __init__(self, ttl: int = 600):
        self._store: dict[int, ScoringProgress] = {}
        self._ttl = ttl
    
    def start(self, record_id: int) -> None
    def update(self, record_id: int, phase: Phase, pct: int, msg: str) -> None
    def get(self, record_id: int) -> ScoringProgress | None
    def remove(self, record_id: int) -> None
    def _cleanup(self) -> None  # 移除 >TTL 的条目
```

### 阶段与百分比

| Phase | 百分比 | 中文消息 |
|-------|--------|----------|
| `loading` | 0-5 | "正在加载对话记录..." |
| `scoring` | 10-60 | "正在评分维度分析 ({pct}%)" |
| `feedback` | 60-90 | "正在生成反馈建议 ({pct}%)" |
| `saving` | 95 | "正在保存评分结果..." |
| `completed` | 100 | "评分完成" |

### 注入点

`evaluate_training()` 在 `score_engine.py` 中接收 `tracker: ScoringProgressTracker` 参数：

```python
async def evaluate_training(record_id, case_data, db, *, pm, llm_client, tracker):
    tracker.start(record_id)
    
    # loading phase
    record = db.query(TrainingRecord)...  # DB query
    messages = db.query(Message)...       # DB query
    tracker.update(record_id, "loading", 5, "正在加载对话记录...")
    
    # build prompts
    rubric = load_rubric_by_version(...)
    scoring_criteria = build_scoring_criteria(rubric)
    tracker.update(record_id, "scoring", 10, "正在评分维度分析...")
    
    # scoring stage (10% → 60%)
    scoring_task = _score_stage(...)
    # feedback stage (60% → 90%)
    feedback_task = _feedback_stage(...)
    
    # Since asyncio.gather runs both concurrently, we can't update progress
    # inside the stages directly. Instead, progress is updated based on:
    # - Before gather: scoring @ 10%
    # - After gather (scoring done): scoring @ 60%
    #   Wait, that's not right either because they run concurrently.
    
    # Solution: don't track intra-call progress. Just set milestones:
    tracker.update(id, "scoring", 10, "正在评分维度分析...")
    scoring_result, feedback_result = await asyncio.gather(...)
    # Both are done now. But we can't tell which finished first.
    # Actually we can use a shared counter approach:
    
    # On scoring call start: move to 10%
    # When scoring call completes: move to 60%
    # When feedback call completes: move to 90%
    # But with gather, we wait for both...
    
    # Better approach: split gather into individual tasks with callbacks
    
    scoring_task = asyncio.create_task(_score_stage(...))
    feedback_task = asyncio.create_task(_feedback_stage(...))
    
    done, pending = await asyncio.wait(
        [scoring_task, feedback_task],
        return_when=asyncio.FIRST_COMPLETED,
    )
    # One is done, update progress
    if scoring_task in done:
        tracker.update(id, "feedback", 60, "评分分析完成，正在生成反馈建议...")
    else:
        tracker.update(id, "scoring", 60, "反馈建议生成中，等待评分分析...")
    
    # Wait for the other
    await asyncio.wait(pending)
    tracker.update(id, "saving", 95, "正在保存评分结果...")
```

Wait, actually this over-complicates things. The `_score_stage` and `_feedback_stage` are where the actual LLM calls happen and where most time is spent. But `asyncio.gather` runs them concurrently.

Let me simplify: just update progress at key synchronization points:

```
1. tracker.start(id)                     → loading, 0%
2. Load messages + build prompts         → loading → scoring, 10%
3. await asyncio.gather(scoring, feedback)
   [during: scoring and feedback run concurrently]
   (no progress updates during LLM calls — API call duration is opaque)
4. scoring done + feedback done          → saving, 95%
5. Validate + save to DB                 → completed, 100%
```

This is simpler and still gives real progress. The user sees:
- 0-10%: loading (very fast, <100ms)
- 10%: "评分维度分析中..." (stays at 10% while LLM calls run)
- 95%: "正在保存评分结果..." (after LLM, very fast)
- 100%: "评分完成"

Hmm, this isn't great because the LLM calls take 90% of the time and we show a static 10%. That defeats the purpose.

A better approach: use a progress estimator that updates during the LLM calls based on time:

Actually, the simplest real approach is to have the LLM call phases report progress independently. Since scoring and feedback run in parallel via `asyncio.gather`, we can:

1. Split `asyncio.gather` into two sequential await with progress updates in between
2. Or use the approach where each phase updates a shared progress counter

Option 1: Sequential (loses parallelism but gets better progress):
```python
tracker.update(id, "scoring", 10, "正在评分维度分析...")
scoring_result = await _score_stage(...)
tracker.update(id, "feedback", 60, "评分完成，正在生成反馈建议...")
feedback_result = await _feedback_stage(...)
tracker.update(id, "saving", 95, "正在保存评分结果...")
```

This sacrifices the ~50% speedup from parallelism for much better progress accuracy.

Option 2: Keep parallelism, accept that progress "jumps":
```python
tracker.update(id, "scoring", 10, "评分分析 + 反馈生成中...")
scoring_result, feedback_result = await asyncio.gather(scoring_task, feedback_task)
tracker.update(id, "saving", 95, "正在保存评分结果...")
```

I think Option 2 is the pragmatic choice. The user sees a quick jump to 10% then it sits at 10% for 3-8 seconds, then jumps to 95% and quickly to 100%. This is still much better than the current fake progress.

But wait—we could do both! We can replace `asyncio.gather` with individual `asyncio.create_task` + `asyncio.wait` with `FIRST_COMPLETED`:

```python
tracker.update(id, "scoring", 10, "评分分析 + 反馈生成中...")
scoring_task = asyncio.create_task(_score_stage(...))
feedback_task = asyncio.create_task(_feedback_stage(...))

done, pending = await asyncio.wait(
    [scoring_task, feedback_task],
    return_when=asyncio.FIRST_COMPLETED,
)

if scoring_task in done:
    scoring_result = done.pop().result()
    tracker.update(id, "feedback", 60, "评分维度分析完成，正在生成反馈建议...")
    feedback_result = await list(pending)[0]
else:
    feedback_result = done.pop().result()
    tracker.update(id, "scoring", 60, "反馈建议生成完成，正在完善评分维度...")
    scoring_result = await list(pending)[0]

tracker.update(id, "saving", 95, "正在保存评分结果...")
```

Actually this is messy with exceptions and task order. Let me just go with Option 2 (simple jump) for now. It's a huge improvement over fake progress.

Actually, let me reconsider. Let me keep the `asyncio.gather` but add time-based progress estimation. The approach:

```python
# Start an async task that updates progress every 2 seconds as an estimate
# while the real LLM calls are running
async def _progress_estimator(record_id, tracker):
    """Update estimated progress while scoring is running."""
    for pct in range(15, 55, 5):
        await asyncio.sleep(0.8)
        tracker.update(record_id, "scoring", pct, f"正在评分维度分析 ({pct}%)...")
    for pct in range(60, 90, 5):
        await asyncio.sleep(0.8)
        tracker.update(record_id, "feedback", pct, f"正在生成反馈建议 ({pct}%)...")

estimator_task = asyncio.create_task(_progress_estimator(record_id, tracker))
try:
    scoring_result, feedback_result = await asyncio.gather(scoring_task, feedback_task)
finally:
    estimator_task.cancel()
```

This is fake again but with a much better illusion since it's a secondary indicator while waiting for real LLM responses. It's still fake though...

OK, I think the pragmatic approach is: **split into sequential phases but mark the "scoring" and "feedback" phases with progressive estimates based on real LLM timeouts**. But that's still fake.

Let me step back. What does the user actually need? They need:
1. A real progress indicator that shows what phase the backend is in
2. Not a fake percentage

So the simplest real solution is:
- Phase-based: show what phase we're in (loading, scoring, feedback, saving)
- For percentage inside a phase: estimate based on LLM timeout/retry info

For scoring, we can report approximate progress:
- If scoring has max_retries=3, we can say "attempt 1/3"
- If timeout=120s, we can estimate time remaining

Actually, let me just go with the sequential approach. The loss of parallelism is compensated by:
1. Much better user experience (real stages visible)
2. Simpler code
3. More reliable (sequential eliminates potential race conditions in DB writes)

Wait no, the parallelism loss means scoring takes 1.5-2x longer in wall time. That's bad UX in itself.

Let me settle on a hybrid approach:

**Hybrid approach: parallel LLM calls + progress updates at synchronization points + time-based estimation during LLM calls**

The `_score_stage` and `_feedback_stage` take the tracker as well and update progress internally:

```python
async def _score_stage(messages, record_id, rubric, *, tracker, ...):
    tracker.update(record_id, "scoring", 10, "正在评分维度分析...")
    result = await llm_client.call_json(...)  # takes 2-5s
    tracker.update(record_id, "scoring", 55, "评分分析完成")
    return result

async def _feedback_stage(messages, record_id, *, tracker, ...):
    tracker.update(record_id, "feedback", 60, "正在生成反馈建议...")
    result = await llm_client.call_json(...)  # takes 2-4s
    tracker.update(record_id, "feedback", 85, "反馈建议生成完成")
    return result
```

With `asyncio.gather`, both run concurrently. The progress tracker sees:
1. loading(0%) → scoring(10%)  [main thread]
2. scoring(10%) → scoring(55%)  [score_stage done, thread race]
3. feedback(60%) → feedback(85%)  [feedback_stage done, thread race]
4. saving(95%) → completed(100%)  [main thread]

The user sees something like:
- 10% → "正在评分维度分析"
- 55% → "评分分析完成" (quickly followed by)
- 60% → "正在生成反馈建议"
- 85% → "反馈建议生成完成" (quickly followed by)
- 95% → "正在保存评分结果"
- 100% → "评分完成"

But since `gather` waits for BOTH, the actual visible progression depends on which finishes first. If scoring finishes first (55%), the user briefly sees 55%, then the system pauses at 60% while waiting for feedback. When feedback finishes, it jumps to 85% → 95% → 100%.

This actually works well! The user sees:
- Quick jump to 10% (loading)
- Pause at 10% while both LLM calls are running
- Jump to 55% then 60% when scoring finishes
- Pause at 60% while waiting for feedback
- Jump to 85% then 95% then 100% when feedback finishes

Actually wait, tracker updates from inside `asyncio.gather` might have visibility issues. Since `asyncio.gather` runs tasks concurrently but they're all in the same thread (asyncio is single-threaded), the updates are safe but the timing of when the frontend polls them depends on polling interval.

This is fine. The overhead of tracker updates is negligible (<1μs). The frontend polls every 1.5s so it will eventually see the latest state.

Let me finalize the design with this approach.

### 改造 `_score_stage` 和 `_feedback_stage`

Both functions accept `tracker` and update progress at start/end.

### 改造 `_run_scoring_background`

在 `scoring.py` 中，在调用 `evaluate_training` 前获取 tracker，清理异常/完成后的 tracker 条目。

### 改造 `GET /{record_id}/scoring-status`

增加 `progress` 字段：
```python
return {
    "scoring_status": record.scoring_status,
    "scoring_error": record.scoring_error,
    "score": {...} if score else None,
    "progress": {
        "phase": progress.phase if progress else None,
        "percentage": progress.percentage if progress else 0,
        "message": progress.message if progress else "",
    } if progress else None,
}
```

### Application 生命周期

在 `main.py` 中将 `ScoringProgressTracker` 实例挂载到 `app.state`：
```python
from infrastructure.scoring_progress import ScoringProgressTracker
app.state.scoring_tracker = ScoringProgressTracker()
```

在 `_run_scoring_background` 中通过参数传递。

---

## 前端设计

### ScoreManager 重写

移除：
- fake progress 计算 `min(95, 30 + retries * 2)`
- 独立的 progress 状态管理

新增：
- `phase`、`percentage`、`message` 直接从后端返回获取
- 轮询间隔缩短到 1500ms
- 当 `phase === 'completed'` 时设置 progress = 100 并 emit `score:ready`
- 当 `phase === 'failed'` 时设置 progress = 0 并 emit `score:failed`
- 暴露 `state` 对象包含 `{ phase, percentage, message, status }`

### ScoringOverlay 重写

移除：
- `setInterval` 自增计数器

状态来源：
- 完全依赖 `ScoreManager` 的 `state`

UI 变更：
```
┌─────────────────────────────────────┐
│       正在评估训练表现...               │
│  ━━━━━━━━━━━━━━━━━━━━━━━━░░░░░░░  45% │
│  正在评分维度分析 (45%)                │
│                                     │
│  [取消查看结果]                       │
└─────────────────────────────────────┘
```

- 超时 300s 无完成 → 显示"评分超时" + "重新评分"按钮
- 失败 → 显示错误信息 + "重新评分"按钮

### 进度映射

```typescript
const phaseLabels: Record<string, string> = {
  loading: "正在加载对话记录...",
  scoring: "正在评分维度分析",
  feedback: "正在生成反馈建议",
  saving: "正在保存评分结果...",
  completed: "评分完成 ✓",
  failed: "评分失败",
};
```

---

## 文件变更清单

### 新增

| 文件 | 说明 |
|------|------|
| `backend/infrastructure/scoring_progress.py` | ScoringProgressTracker 实现 |

### 修改

| 文件 | 修改内容 |
|------|----------|
| `backend/contexts/training/score_engine.py` | `evaluate_training` 接收 tracker 参数，阶段内部更新进度 |
| `backend/contexts/training/router/scoring.py` | `_run_scoring_background` 创建/清理 tracker；`/scoring-status` 返回 progress 字段 |
| `backend/main.py` | `app.state.scoring_tracker = ScoringProgressTracker()` |
| `frontend/src/engine/ScoreManager.ts` | 完全重写，基于后端进度 |
| `frontend/src/plugins/scoring-display/ScoringOverlay.tsx` | 完全重写，真实进度展示 |
| `frontend/src/engine/types.ts` | 新增 `ScoringProgress` 类型 |

---

## 错误处理

- tracker 不存在的 record_id → 返回 fallback（只返回 status，不带 progress）
- tracker 异常 → 不影响评分主流程，在 `evaluate_training` 中 catch 并 log

## 性能考量

- tracker 使用 `dict[int, ScoringProgress]`，单次更新 O(1)
- 10 分钟 TTL 自动清理，避免内存泄漏
- 前端 1500ms 轮询，1 条 HTTP 请求无需认证（已在 `/scoring-status` 中认证）
