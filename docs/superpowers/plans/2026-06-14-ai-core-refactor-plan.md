# AI Core Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `prompt_builder._collect_author_note()` hardcoded 4-source concatenation with a composable ContextSource list, and extract identity guard into a swappable PostGuard interface.

**Architecture:** Strategy pattern with module-level registries. `ContextSource` ABC produces author note fragments; `PostGuard` ABC validates LLM replies. Built-in implementations auto-register at module load. `prompt_builder` calls `collect_author_note()` from sources module instead of its own hardcoded function. `PluginAuthorNoteSource` bridges to `PluginManager.get_active()`.

**Tech Stack:** Python 3.11+ (ABC, dataclasses, asyncio), pytest, existing PipelineContext / PluginManager

---

## File Map

```
Create:
  backend/contexts/patient/sources.py        # ContextSource ABC + 5 built-in + collect_author_note
  backend/contexts/patient/guards.py         # PostGuard ABC + PatternGuard + NoGuard
  backend/tests/test_patient_sources.py
  backend/tests/test_patient_guards.py

Modify:
  backend/contexts/training/pipeline/middleware/prompt_builder.py  # Replace _collect_author_note
  backend/contexts/patient/__init__.py       # Export new modules
  backend/main.py                            # Register PluginAuthorNoteSource after pm.discover()
```

---

### Task 1: Create `backend/contexts/patient/sources.py` — ContextSource ABC + 4 built-in sources + collect_author_note

**Files:**
- Create: `backend/contexts/patient/sources.py`

- [ ] **Step 1: Write the module**

```python
"""ContextSource — composable author_note contribution per round."""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from contexts.training.pipeline.context import PipelineContext

from contexts.patient.guard import get_identity_correction_note, has_identity_leak

log = logging.getLogger(__name__)


class ContextSource(ABC):
    name: str = ""

    @abstractmethod
    async def collect(self, ctx: "PipelineContext") -> str | None:
        ...


class EmotionNoteSource(ContextSource):
    name = "emotion"

    async def collect(self, ctx: "PipelineContext") -> str | None:
        note = ctx.state.get("emotion_note")
        return note if note else None


class IdentityGuardSource(ContextSource):
    name = "identity_guard"

    async def collect(self, ctx: "PipelineContext") -> str | None:
        last_patient = None
        for msg in reversed(ctx.messages):
            if msg.role == "patient":
                last_patient = msg.content
                break
        if last_patient and has_identity_leak(last_patient):
            return get_identity_correction_note()
        return None


class ExamResultsSource(ContextSource):
    name = "exam_results"

    async def collect(self, ctx: "PipelineContext") -> str | None:
        snapshot = ctx.record.practice_snapshot or {}
        exam_results = snapshot.get("_exam_results", [])
        if not isinstance(exam_results, list) or not exam_results:
            return None
        lines = []
        for r in exam_results[-5:]:
            label = r.get("label", "")
            value = r.get("value", "")
            unit = r.get("unit", "")
            lines.append(f"{label}: {value}{unit}")
        return "已查体征: " + " | ".join(lines)


class ExamImpactSource(ContextSource):
    name = "exam_impact"

    async def collect(self, ctx: "PipelineContext") -> str | None:
        snapshot = ctx.record.practice_snapshot or {}
        note = snapshot.get("_exam_impact_note")
        if note and isinstance(note, str) and note.strip():
            return note
        return None


_sources: list[ContextSource] = []


def register_source(source: ContextSource) -> None:
    _sources.append(source)


def get_sources() -> list[ContextSource]:
    return list(_sources)


def clear_sources() -> None:
    _sources.clear()


async def collect_author_note(ctx: "PipelineContext") -> tuple[str, list[dict]]:
    notes = []
    traces = []
    for src in get_sources():
        try:
            text = await src.collect(ctx)
        except Exception:
            log.exception("ContextSource %s failed", src.name)
            traces.append({"source": src.name, "triggered": False, "error": True})
            continue
        if text and text.strip():
            notes.append(text)
            traces.append({"source": src.name, "length": len(text), "triggered": True})
        else:
            traces.append({"source": src.name, "length": 0, "triggered": False})
    joined = "【" + " | ".join(notes) + "】" if notes else ""
    return joined, traces


register_source(EmotionNoteSource())
register_source(IdentityGuardSource())
register_source(ExamResultsSource())
register_source(ExamImpactSource())
```

- [ ] **Step 2: Verify module imports**

```bash
cd backend && python -c "from contexts.patient.sources import ContextSource, EmotionNoteSource, IdentityGuardSource, ExamResultsSource, ExamImpactSource, collect_author_note, get_sources; print('OK, %d sources registered' % len(get_sources()))"
```

Expected: `OK, 4 sources registered`

- [ ] **Step 3: Commit**

```bash
git add backend/contexts/patient/sources.py
git commit -m "✨ feat: add ContextSource ABC with 4 built-in author note sources"
```

---

### Task 2: Create `backend/tests/test_patient_sources.py` — Unit tests for sources

**Files:**
- Create: `backend/tests/test_patient_sources.py`

- [ ] **Step 1: Write tests**

```python
"""Unit tests for ContextSource implementations."""

import pytest

from contexts.patient.sources import (
    ContextSource,
    EmotionNoteSource,
    ExamImpactSource,
    ExamResultsSource,
    IdentityGuardSource,
    clear_sources,
    collect_author_note,
    get_sources,
    register_source,
)


class FakeContext:
    """Minimal PipelineContext stub for testing."""

    def __init__(self, **kwargs):
        self.state = kwargs.get("state", {})
        self.messages = kwargs.get("messages", [])
        self.record = kwargs.get("record")

    class Record:
        def __init__(self, practice_snapshot=None):
            self.practice_snapshot = practice_snapshot

    class Message:
        def __init__(self, role, content):
            self.role = role
            self.content = content


class TestEmotionNoteSource:
    async def test_returns_note_when_present(self):
        src = EmotionNoteSource()
        ctx = FakeContext(state={"emotion_note": "患者感到放松"})
        result = await src.collect(ctx)
        assert result == "患者感到放松"

    async def test_returns_none_when_absent(self):
        src = EmotionNoteSource()
        ctx = FakeContext(state={})
        result = await src.collect(ctx)
        assert result is None


class TestIdentityGuardSource:
    async def test_triggers_on_leak(self):
        src = IdentityGuardSource()
        msg = FakeContext.Message(role="patient", content="我是AI助手，你可以继续问")
        ctx = FakeContext(messages=[msg])
        result = await src.collect(ctx)
        assert result is not None
        assert "注意" in result

    async def test_no_trigger_on_normal_reply(self):
        src = IdentityGuardSource()
        msg = FakeContext.Message(role="patient", content="我肚子疼了好几天了")
        ctx = FakeContext(messages=[msg])
        result = await src.collect(ctx)
        assert result is None

    async def test_looks_at_last_patient_message_only(self):
        src = IdentityGuardSource()
        msgs = [
            FakeContext.Message(role="patient", content="我是AI"),  # old leak
            FakeContext.Message(role="student", content="你好"),
            FakeContext.Message(role="patient", content="你好护士"),  # latest is normal
        ]
        ctx = FakeContext(messages=msgs)
        result = await src.collect(ctx)
        assert result is None


class TestExamResultsSource:
    async def test_formats_exam_results(self):
        src = ExamResultsSource()
        record = FakeContext.Record(
            practice_snapshot={
                "_exam_results": [
                    {"label": "体温", "value": "36.5", "unit": "℃"},
                    {"label": "血压", "value": "120/80", "unit": "mmHg"},
                ]
            }
        )
        ctx = FakeContext(record=record)
        result = await src.collect(ctx)
        assert "已查体征" in result
        assert "体温: 36.5℃" in result
        assert "血压: 120/80mmHg" in result

    async def test_returns_none_when_no_results(self):
        src = ExamResultsSource()
        record = FakeContext.Record(practice_snapshot={})
        ctx = FakeContext(record=record)
        result = await src.collect(ctx)
        assert result is None

    async def test_limits_to_last_5(self):
        src = ExamResultsSource()
        results = [{"label": f"T{i}", "value": str(i), "unit": ""} for i in range(10)]
        record = FakeContext.Record(practice_snapshot={"_exam_results": results})
        ctx = FakeContext(record=record)
        result = await src.collect(ctx)
        assert "T0" not in result
        assert "T9" in result


class TestExamImpactSource:
    async def test_returns_impact_note(self):
        src = ExamImpactSource()
        record = FakeContext.Record(
            practice_snapshot={"_exam_impact_note": "频繁检查让患者不耐烦"}
        )
        ctx = FakeContext(record=record)
        result = await src.collect(ctx)
        assert result == "频繁检查让患者不耐烦"

    async def test_returns_none_when_empty(self):
        src = ExamImpactSource()
        record = FakeContext.Record(practice_snapshot={"_exam_impact_note": ""})
        ctx = FakeContext(record=record)
        result = await src.collect(ctx)
        assert result is None


class TestRegistry:
    def teardown_method(self):
        clear_sources()

    async def test_collect_author_note_aggregates_all(self):
        clear_sources()

        class AlwaysSource(ContextSource):
            name = "always"
            async def collect(self, ctx):
                return "hello"
        register_source(AlwaysSource())
        register_source(AlwaysSource())

        ctx = FakeContext()
        result, traces = await collect_author_note(ctx)
        assert "hello" in result
        assert " | " in result

    async def test_collect_author_note_survives_exception(self):
        clear_sources()

        class GoodSource(ContextSource):
            name = "good"
            async def collect(self, ctx):
                return "good"

        class BadSource(ContextSource):
            name = "bad"
            async def collect(self, ctx):
                raise RuntimeError("boom")

        register_source(GoodSource())
        register_source(BadSource())

        ctx = FakeContext()
        result, traces = await collect_author_note(ctx)
        assert "good" in result
        error_trace = [t for t in traces if t["source"] == "bad"]
        assert error_trace[0]["error"] is True
```

- [ ] **Step 2: Run tests (will fail on FakeContext type mismatch)**

```bash
cd backend && pytest tests/test_patient_sources.py -v -m "not pg"
```

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_patient_sources.py
git commit -m "✅ test: add unit tests for ContextSource implementations"
```

---

### Task 3: Modify `prompt_builder.py` — Replace `_collect_author_note` with `collect_author_note`

**Files:**
- Modify: `backend/contexts/training/pipeline/middleware/prompt_builder.py`

- [ ] **Step 1: Read current prompt_builder.py to confirm unchanged**

```bash
cd backend && wc -l contexts/training/pipeline/middleware/prompt_builder.py
```

Expected: 83 lines

- [ ] **Step 2: Replace `_collect_author_note` function with import**

Delete lines 1-47 (imports + `_collect_author_note` function) and replace with:

```python
"""prompt_builder — assemble LLM messages array from context."""

import logging

from contexts.patient import (
    build_patient_chat_messages,
    build_patient_context_kwargs,
)
from contexts.patient.sources import collect_author_note
from infrastructure.prompt import render_template
from prompts.patient_dynamic import PATIENT_DYNAMIC_TEMPLATE

from ..context import PipelineContext

log = logging.getLogger(__name__)


async def prompt_builder(ctx: PipelineContext, next_mw) -> None:
    if ctx.should_shortcut:
        await next_mw()
        return

    author_note, traces = await collect_author_note(ctx)
    ctx.state["_source_traces"] = traces

    kwargs = build_patient_context_kwargs(ctx.case_data, author_note=author_note)
    pm = ctx.app_state.prompt_manager
    tmpl = await pm.get(ctx.current_phase.prompt_profile if ctx.current_phase else "patient_chat")

    profile_keys = {"patient_info", "scenario", "personality", "communication_style"}
    try:
        system_prompt = tmpl.render(**{k: v for k, v in kwargs.items() if k in profile_keys})
        dynamic_keys = {"chief_complaint", "present_illness", "allergy_history", "deep_background", "example_dialogues"}
        try:
            dynamic_tmpl = await pm.get("patient_dynamic")
            dynamic_prompt = dynamic_tmpl.render(**{k: v for k, v in kwargs.items() if k in dynamic_keys})
        except Exception:
            dynamic_prompt = render_template(PATIENT_DYNAMIC_TEMPLATE, **kwargs)
    except Exception as e:
        log.error("Prompt render failed: %s", e)
        system_prompt = str(kwargs.get("patient_info", "未知患者"))
        dynamic_prompt = str(kwargs.get("chief_complaint", "无"))

    ctx.llm_messages = build_patient_chat_messages(
        system_prompt,
        dynamic_prompt,
        ctx.messages,
        ctx.student_display or ctx.student_input,
        author_note=author_note,
    )

    await next_mw()
```

- [ ] **Step 3: Verify import works**

```bash
cd backend && python -c "from contexts.training.pipeline.middleware.prompt_builder import prompt_builder; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Run existing pipeline tests**

```bash
cd backend && pytest tests/test_pipeline_integration.py -v -m "not pg"
```

- [ ] **Step 5: Commit**

```bash
git add backend/contexts/training/pipeline/middleware/prompt_builder.py
git commit -m "♻️ refactor: replace _collect_author_note with composable ContextSource list"
```

---

### Task 4: Create `backend/contexts/patient/guards.py` — PostGuard ABC + PatternGuard + NoGuard

**Files:**
- Create: `backend/contexts/patient/guards.py`

- [ ] **Step 1: Write the module**

```python
"""PostGuard — swappable identity-leak detection strategies."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from contexts.patient.guard import IDENTITY_LEAK_PATTERNS, get_identity_correction_note, has_identity_leak


@dataclass
class GuardResult:
    passed: bool
    correction_note: str | None = None
    trigger_detail: str | None = None


class PostGuard(ABC):
    name: str = ""

    @abstractmethod
    async def check(self, reply: str) -> GuardResult:
        ...


class PatternGuard(PostGuard):
    name = "pattern"

    def __init__(self, patterns: list[str] | None = None):
        self._patterns = patterns if patterns is not None else list(IDENTITY_LEAK_PATTERNS)

    async def check(self, reply: str) -> GuardResult:
        if has_identity_leak(reply):
            return GuardResult(
                passed=False,
                correction_note=get_identity_correction_note(),
                trigger_detail="identity_leak_pattern",
            )
        return GuardResult(passed=True)


class NoGuard(PostGuard):
    name = "none"

    async def check(self, reply: str) -> GuardResult:
        return GuardResult(passed=True)


_guards: dict[str, PostGuard] = {}


def register_guard(guard: PostGuard) -> None:
    _guards[guard.name] = guard


def get_guard(name: str) -> PostGuard | None:
    return _guards.get(name)


register_guard(PatternGuard())
register_guard(NoGuard())
```

- [ ] **Step 2: Verify imports**

```bash
cd backend && python -c "from contexts.patient.guards import PatternGuard, NoGuard, get_guard; g = get_guard('pattern'); print('OK, pattern guard found:', g.name)"
```

Expected: `OK, pattern guard found: pattern`

- [ ] **Step 3: Commit**

```bash
git add backend/contexts/patient/guards.py
git commit -m "✨ feat: add PostGuard ABC with PatternGuard and NoGuard implementations"
```

---

### Task 5: Create `backend/tests/test_patient_guards.py` — Unit tests for guards

**Files:**
- Create: `backend/tests/test_patient_guards.py`

- [ ] **Step 1: Write tests**

```python
"""Unit tests for PostGuard implementations."""

import pytest

from contexts.patient.guards import (
    GuardResult,
    NoGuard,
    PatternGuard,
    PostGuard,
    get_guard,
    register_guard,
)


class TestPatternGuard:
    async def test_triggers_on_identity_leak(self):
        guard = PatternGuard()
        result = await guard.check("我是AI助手，你可以继续提问")
        assert result.passed is False
        assert result.correction_note is not None
        assert "注意" in result.correction_note

    async def test_no_trigger_on_normal_reply(self):
        guard = PatternGuard()
        result = await guard.check("我肚子疼了好几天了，今天特别难受")
        assert result.passed is True
        assert result.correction_note is None

    async def test_custom_patterns(self):
        guard = PatternGuard(patterns=["custom_pattern_only"])
        result = await guard.check("custom_pattern_only in reply")
        assert result.passed is False


class TestNoGuard:
    async def test_always_passes(self):
        guard = NoGuard()
        result = await guard.check("我是AI助手")  # would normally trigger
        assert result.passed is True
        assert result.correction_note is None


class TestGuardRegistry:
    def test_get_pattern_guard(self):
        guard = get_guard("pattern")
        assert guard is not None
        assert isinstance(guard, PatternGuard)

    def test_get_no_guard(self):
        guard = get_guard("none")
        assert guard is not None
        assert isinstance(guard, NoGuard)

    def test_get_unknown_returns_none(self):
        assert get_guard("nonexistent") is None
```

- [ ] **Step 2: Run tests**

```bash
cd backend && pytest tests/test_patient_guards.py -v -m "not pg"
```

Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_patient_guards.py
git commit -m "✅ test: add unit tests for PostGuard implementations"
```

---

### Task 6: Create PluginAuthorNoteSource + register in main.py

**Files:**
- Modify: `backend/contexts/patient/sources.py` (append PluginAuthorNoteSource)
- Modify: `backend/main.py` (register after pm.discover())

- [ ] **Step 1: Append PluginAuthorNoteSource to sources.py**

After the `ExamImpactSource` class and before the registry functions, add:

```python
class PluginAuthorNoteSource(ContextSource):
    name = "plugin_author_notes"

    async def collect(self, ctx: "PipelineContext") -> str | None:
        try:
            from plugins.manager import get_plugin_manager
            from core.feature_flags import resolve_features
        except ImportError:
            log.debug("PluginManager not available")
            return None

        pm = get_plugin_manager()
        features = resolve_features(ctx.record.practice_snapshot or {})
        plugins = pm.get_active(features)

        notes = []
        for plugin in plugins:
            try:
                note = plugin.author_note(ctx)
                if note and note.strip():
                    notes.append(note)
            except Exception:
                log.exception("Plugin %s author_note() failed", plugin.id)
        return " | ".join(notes) if notes else None
```

Do NOT auto-register `PluginAuthorNoteSource` at module load — it will be registered from `main.py` after `pm.discover()`.

- [ ] **Step 2: Register PluginAuthorNoteSource in main.py lifespan**

In `main.py` lifespan function, after `pm.discover()`, add:

```python
from contexts.patient.sources import PluginAuthorNoteSource, register_source

pm = get_plugin_manager()
pm.discover()
register_source(PluginAuthorNoteSource())
log.info("PluginAuthorNoteSource registered")
```

- [ ] **Step 3: Verify startup**

```bash
cd backend && timeout 5 python -c "from main import app; print('App imported OK')" 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add backend/contexts/patient/sources.py backend/main.py
git commit -m "✨ feat: add PluginAuthorNoteSource bridging PluginManager.author_note()"
```

---

### Task 7: Update `backend/contexts/patient/__init__.py` — Export new modules

**Files:**
- Modify: `backend/contexts/patient/__init__.py`

- [ ] **Step 1: Add sources.py and guards.py exports**

Add after the existing imports:

```python
# 提示词组装策略
from .sources import (
    ContextSource,
    collect_author_note,
    clear_sources,
    get_sources,
    register_source,
)

# 身份守卫策略
from .guards import (
    GuardResult,
    NoGuard,
    PatternGuard,
    PostGuard,
    get_guard,
    register_guard,
)
```

Update `__all__` to include the new names:

```python
__all__ = [
    # existing exports...
    "ContextSource",
    "GuardResult",
    "NoGuard",
    "PatternGuard",
    "PostGuard",
    "clear_sources",
    "collect_author_note",
    "get_guard",
    "get_sources",
    "register_guard",
    "register_source",
]
```

- [ ] **Step 2: Verify all imports work**

```bash
cd backend && python -c "
from contexts.patient import ContextSource, PostGuard, PatternGuard, NoGuard, GuardResult
from contexts.patient import collect_author_note, get_sources, register_source, clear_sources
from contexts.patient import get_guard, register_guard
print('All imports OK')
"
```

- [ ] **Step 3: Commit**

```bash
git add backend/contexts/patient/__init__.py
git commit -m "♻️ refactor: export new sources.py and guards.py modules from patient"
```

---

### Task 8: Full verification — lint, typecheck, tests

**Files:**
- None

- [ ] **Step 1: Run backend lint**

```bash
cd backend && ruff check . && ruff format --check .
```

Fix any issues.

- [ ] **Step 2: Run backend type checker**

```bash
cd backend && ty .
```

Fix any issues.

- [ ] **Step 3: Run backend unit tests**

```bash
cd backend && pytest -m "not pg" -v
```

Expected: All PASS, including `test_patient_sources.py` and `test_patient_guards.py`.

- [ ] **Step 4: Run full check**

```bash
npm run check
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git commit -am "✅ test: full verification pass — lint + typecheck + tests"
```
