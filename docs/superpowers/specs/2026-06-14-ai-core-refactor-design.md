# AI Core Refactor — Design Spec

> 日期: 2026-06-14 | 依赖: 插件系统重写已完成 (Plugin ABC + PluginManager)
>
> 范围: Short-term — ContextSource 抽象 + PostGuard 策略化 + 可观测基础

---

## 一、目标

将 `prompt_builder._collect_author_note()` 从 4 个硬编码来源的固定拼接，重构为可注册、可独立测试、可插拔的 ContextSource 列表驱动。同时将身份泄漏检测接口化，为未来 A/B 测试提供可切换的 Guard 实现。

**不做的事：** MessageAssembler 策略、PersonalityFormatter 策略、DeepBackgroundFormatter 策略、ExperimentProfile 框架、shadow mode。这些属于 medium/long-term。

---

## 二、架构

### 2.1 文件变更

```
新增:
  backend/contexts/patient/sources.py    ← ContextSource ABC + 5 个内置实现
  backend/contexts/patient/guards.py     ← PostGuard ABC + PatternGuard + NoGuard
  backend/tests/test_patient_sources.py
  backend/tests/test_patient_guards.py

修改:
  backend/contexts/patient/__init__.py   ← 导出新模块
  backend/contexts/training/pipeline/middleware/prompt_builder.py  ← 替换 _collect_author_note

保留不变:
  backend/contexts/patient/guard.py      ← has_identity_leak / get_identity_correction_note（被 PatternGuard 调用）
  backend/contexts/patient/prompt.py     ← build_patient_context_kwargs / build_patient_chat_messages（不变）
  backend/infrastructure/prompt/manager.py  ← PromptManager（不变）
```

### 2.2 数据流

```
prompt_builder(ctx, next_mw)
  │
  ├─ collect_author_note(ctx)                    ← sources.py
  │    for src in get_sources():
  │        note = await src.collect(ctx)
  │        if note: notes.append(note); trace[...]
  │    return joined_notes, traces
  │
  ├─ build_patient_context_kwargs(...)            ← 不变
  ├─ pm.get("patient_chat").render(...)           ← 不变
  ├─ pm.get("patient_dynamic").render(...)        ← 不变
  ├─ build_patient_chat_messages(...)             ← 不变
  └─ ctx.state["_source_traces"] = traces         ← 新：可观测
```

---

## 三、ContextSource

### 3.1 接口

```python
class ContextSource(ABC):
    name: str = ""

    async def collect(self, ctx: PipelineContext) -> str | None:
        ...
```

返回 `str` 表示贡献一段 author note 文本，返回 `None` 表示本轮无贡献。异常由调用方捕获，不影响其他 source。

### 3.2 内置实现

| Source | name | 数据来源 | 逻辑 |
|--------|------|----------|------|
| `EmotionNoteSource` | `"emotion"` | `ctx.state["emotion_note"]` | 原样返回 |
| `IdentityGuardSource` | `"identity_guard"` | 最近一条 patient 消息 | 调用 `has_identity_leak()` → 返回更正提示 |
| `ExamResultsSource` | `"exam_results"` | `practice_snapshot._exam_results[-5:]` | 格式化为 `"已查体征: ..."` |
| `ExamImpactSource` | `"exam_impact"` | `practice_snapshot._exam_impact_note` | 原样返回 |
| `PluginAuthorNoteSource` | `"plugin_author_notes"` | `PluginManager.get_active()` | 调用每个插件的 `author_note(ctx)`，收集非空结果 |

### 3.3 PluginAuthorNoteSource

通过 `PluginManager.get_active()` 获取已激活插件，调用 `plugin.author_note(ctx)`。注册时机在 `main.py` lifespan 中 `pm.discover()` 之后，确保 PluginManager 已初始化。其余 4 个 source 模块加载时自动注册。

### 3.4 注册表

```python
# sources.py 模块级
_sources: list[ContextSource] = []

def register_source(source: ContextSource) -> None: ...
def get_sources() -> list[ContextSource]: ...
def clear_sources() -> None:  # 仅测试用
```

---

## 四、PostGuard

### 4.1 接口

```python
@dataclass
class GuardResult:
    passed: bool
    correction_note: str | None = None
    trigger_detail: str | None = None

class PostGuard(ABC):
    name: str = ""

    async def check(self, reply: str) -> GuardResult:
        ...
```

### 4.2 内置实现

| Guard | name | 逻辑 |
|-------|------|------|
| `PatternGuard` | `"pattern"` | 调用现有 `has_identity_leak()` + `get_identity_correction_note()`。patterns 列表通过 `__init__` 注入，默认 = `IDENTITY_LEAK_PATTERNS` |
| `NoGuard` | `"none"` | `check()` 始终返回 `GuardResult(passed=True)` |

### 4.3 当前调用关系

- `IdentityGuardSource`（author note 收集）直接调用 `has_identity_leak()`，不经过 PostGuard 抽象——它是 context 收集的一部分
- `llm_caller` 中间件（生成后校验）未来通过 PostGuard 抽象切换，但**不在本次范围内**
- `patient/guard.py` 保留不删，`has_identity_leak()` 和 `get_identity_correction_note()` 保持原样

### 4.4 注册表

```python
_guards: dict[str, PostGuard] = {}

def register_guard(guard: PostGuard) -> None: ...
def get_guard(name: str) -> PostGuard | None: ...
```

---

## 五、prompt_builder 变更

### Before（当前）

```python
def _collect_author_note(ctx) -> str:
    notes = []
    if ctx.state.get("emotion_note"):
        notes.append(ctx.state["emotion_note"])
    # identity leak guard...
    # exam results...
    # exam impact...
    return "【" + " | ".join(notes) + "】" if notes else ""

async def prompt_builder(ctx, next_mw):
    author_note = _collect_author_note(ctx)   # 同步
    ...
```

### After

```python
from contexts.patient.sources import collect_author_note

async def prompt_builder(ctx, next_mw):
    author_note, traces = await collect_author_note(ctx)   # 异步 + 追踪
    ctx.state["_source_traces"] = traces
    ...
```

`_collect_author_note()` 函数（30 行）删除。`prompt_builder.py` 从 83 行缩减到 ~55 行。其余逻辑（模板渲染、fallback、消息组装）不变。

---

## 六、可观测性

每轮对话在 `ctx.state["_source_traces"]` 中写入：

```python
[
    {"source": "emotion", "length": 42, "triggered": True},
    {"source": "identity_guard", "length": 0, "triggered": False},
    {"source": "exam_results", "length": 78, "triggered": True},
    {"source": "exam_impact", "length": 0, "triggered": False},
    {"source": "plugin_author_notes", "length": 0, "triggered": False},
]
```

`persister` 中间件将此数据附带写入 `llm_call_log.meta`（已有 JSONB 字段），为 A/B 分析提供数据基础。不新增数据库表。

---

## 七、测试策略

### 新增单元测试（`-m "not pg"`）

**`tests/test_patient_sources.py`：**
- 4 个内置 source 的 `collect()` 逻辑（正常/空/异常）
- 注册表操作：register / get / clear
- `PluginAuthorNoteSource` — mock `PluginManager`，验证收集结果
- 某个 source 异常时不影响其他 source

**`tests/test_patient_guards.py`：**
- `PatternGuard` — 触发（含身份泄漏词）/ 不触发（正常对话）
- `PatternGuard` — 自定义 patterns 列表
- `NoGuard` — 始终通过
- 注册/查询

### 现有测试回归

`prompt_builder` 相关集成测试保持通过，验证重构前后行为无差异。

---

## 八、与插件系统重写的关系

- 依赖 `PluginManager.get_active()` 和 `Plugin.author_note()`
- 插件重写已完成（`base.py:137` 有 `author_note` 方法，`manager.py` 有 `get_active` 和 `run_hook_sync`）
- `prompt_builder` 仍然挂在 `PipelineStage.PROMPT`（`manager.py:85`），位置不变
- `emotion_tracker` 已迁到 `plugins/emotion/middleware.py`，仍写 `ctx.state["emotion_note"]`，读写路径不变
