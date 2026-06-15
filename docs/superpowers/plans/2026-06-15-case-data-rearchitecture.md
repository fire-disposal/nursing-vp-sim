# Case Data 与运行时架构重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 5-phase plan: case_data Pydantic validation → runtime state separation → NoteCollector → plugin contract → rubric chain.

**Architecture:** Each phase is independent. Phase 1 adds a read-time validation layer without changing storage. Phase 2 moves runtime fields from `practice_snapshot` to new `runtime_state` JSONB column. Phase 3 replaces global `register_source()` with pipeline-level `NoteCollector`. Phase 4 adds plugin-case data contract. Phase 5 closes rubric dual-source gap.

**Tech Stack:** Python 3.11, FastAPI, Pydantic v2, SQLAlchemy 2.0, Alembic, pytest

---

## File Structure

### New files
| Phase | File | Responsibility |
|-------|------|----------------|
| 1 | `backend/core/case_schema.py` | Pydantic models + validate/assert functions |
| 3 | `backend/contexts/patient/note_collector.py` | NoteCollector class with budget management |
| 3 | `backend/contexts/patient/note_source.py` | NoteSource ABC (extracted from sources.py) |

### Modified files
| Phase | File | Change |
|-------|------|--------|
| 1 | `backend/routers/cases.py` | Wire `assert_valid_case_data()` on create/update/generate |
| 1 | `backend/contexts/training/router/session.py` | Wire `validate_case_data(strict=False)` on `_create_record()` |
| 2 | `backend/models.py` | Add `runtime_state` column to TrainingRecord |
| 2 | `backend/plugins/physical_exam/routes.py` | Write `record.runtime_state` instead of `snapshot` |
| 2 | `backend/contexts/training/pipeline/middleware/persister.py` | Write `ctx.record.runtime_state["phase_op_count"]` |
| 2 | `backend/plugins/exam_emotion_bridge/plugin.py` | Write `record.runtime_state` via ExamEffect |
| 2 | `backend/contexts/patient/sources.py` | Read `runtime_state` instead of `snapshot` |
| 2 | `backend/contexts/training/router/progress.py` | Read/write `runtime_state` |
| 2 | `backend/contexts/training/pipeline/context.py` | Read `runtime_state` for phase_op_count |
| 3 | `backend/contexts/patient/sources.py` | Remove global `register_source()`, keep NoteSource classes |
| 3 | `backend/contexts/patient/__init__.py` | Update exports |
| 3 | `backend/plugins/base.py` | Add `get_note_sources()` method |
| 3 | `backend/plugins/manager.py` | `build_pipeline()` returns note_collector |
| 3 | `backend/contexts/training/pipeline/runner.py` | Accept and inject note_collector |
| 3 | `backend/contexts/training/pipeline/middleware/prompt_builder.py` | Use `ctx.note_collector.collect()` |
| 4 | `backend/plugins/base.py` | Add `required_case_fields` |
| 4 | `backend/plugins/physical_exam/plugin.py` | Declare `required_case_fields = ["exam_anchors"]` |
| 4 | `backend/plugins/initiative/plugin.py` | Declare `required_case_fields = ["personality"]` |
| 4 | `backend/core/case_schema.py` | Wire plugin contract check into `validate_case_data()` |
| 5 | `backend/models.py` | Add `rubric_frozen` to TrainingRecord |
| 5 | `backend/repositories/rubric.py` | Add `load_rubric_by_version()` |
| 5 | `backend/contexts/training/router/session.py` | Add `_resolve_rubric_ref()` |
| 5 | `backend/contexts/training/score_engine.py` | Use `load_rubric_by_version()` |
| 5 | `backend/prompts/case_generation.py` | Remove `scoring_criteria` example |

### Migration files
| Phase | Desc |
|-------|------|
| 2 | Alembic: add runtime_state column + migrate existing data |
| 5 | Alembic: add rubric_frozen column |

### Test files
| Phase | File |
|-------|------|
| 1 | `backend/tests/test_case_schema.py` |
| 2 | `backend/tests/test_runtime_state.py` |
| 3 | `backend/tests/test_note_collector.py` |
| 3 | Update `backend/tests/test_patient_sources.py` |
| 4 | Update `backend/tests/test_case_schema.py` |
| 5 | Update `backend/tests/test_rubric.py` |

---

## Phase 1: Validation Layer

### Task 1: Create CaseDataSchema models

**Files:**
- Create: `backend/core/case_schema.py`
- Test: `backend/tests/test_case_schema.py`

- [ ] **Step 1: Create Pydantic schema file**

```python
"""Pydantic validation models for case_data JSONB.

Read-time validation only — does NOT change storage format.
New data: strict validation (raises HTTP 422).
Existing data: warn-only (strict=False), always passes through.
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

log = logging.getLogger(__name__)


class PatientInfo(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    age: int = Field(ge=0, le=150)
    gender: Literal["男", "女"]


class PersonalityConfig(BaseModel):
    health_literacy: Literal["low", "normal", "high"] = "normal"
    verbosity: Literal["terse", "normal", "verbose"] = "normal"
    anxiety_trait: Literal["calm", "normal", "anxious"] = "normal"
    patience: Literal["low", "normal", "high"] = "normal"


class PhaseTransition(BaseModel):
    auto: bool = False
    manual_label: str | None = None
    min_messages: int = 0
    min_operations: int = 0
    auto_after_messages: int = 0


class PhaseConfig(BaseModel):
    id: str
    name: str
    order: int
    operations: list[str] = []
    prompt_profile: str = "patient_chat"
    transition: PhaseTransition = PhaseTransition()


class CaseDataSchema(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(min_length=1, max_length=100)
    difficulty: int = Field(default=1, ge=1, le=3)
    time_limit: int = Field(default=20, ge=1, le=180)

    patient_info: PatientInfo | None = None
    chief_complaint: str = ""
    opening_line: str = ""

    personality: PersonalityConfig = PersonalityConfig()
    communication_style: str = ""

    present_illness: str = ""
    past_history: str = ""
    medication_history: str = ""
    allergy_history: str = ""
    family_history: str = ""
    social_history: str = ""

    deep_background: dict[str, str] = {}

    phases: list[PhaseConfig] | None = None
    required_inquiries: list[str] = []
    rubric_ref: str = "active"

    supported_plugins: list[str] = []

    exam_anchors: dict[str, Any] = {}

    example_dialogues: list[dict] = []


def validate_case_data(data: dict, *, strict: bool = False) -> dict:
    try:
        return CaseDataSchema(**data).model_dump(exclude_none=True)
    except ValidationError as e:
        if strict:
            raise
        log.warning("case_data validation warning: %s", e)
        return data


def assert_valid_case_data(data: dict) -> dict:
    return validate_case_data(data, strict=True)
```

- [ ] **Step 2: Write tests**

```python
"""Tests for case_data validation schema."""

import pytest
from pydantic import ValidationError
from core.case_schema import (
    CaseDataSchema,
    PatientInfo,
    PersonalityConfig,
    validate_case_data,
    assert_valid_case_data,
)


class TestCaseDataSchema:
    def test_minimal_valid(self):
        data = {"name": "测试病例"}
        result = CaseDataSchema(**data)
        assert result.name == "测试病例"
        assert result.time_limit == 20
        assert result.personality.health_literacy == "normal"

    def test_invalid_name_empty(self):
        with pytest.raises(ValidationError):
            CaseDataSchema(**{"name": ""})

    def test_patient_info_valid(self):
        data = {"name": "病例", "patient_info": {"name": "张三", "age": 45, "gender": "男"}}
        result = CaseDataSchema(**data)
        assert result.patient_info.name == "张三"

    def test_patient_info_invalid_gender(self):
        data = {"name": "病例", "patient_info": {"name": "李四", "age": 30, "gender": "unknown"}}
        with pytest.raises(ValidationError):
            CaseDataSchema(**data)

    def test_extra_fields_ignored(self):
        data = {"name": "病例", "scoring_criteria": {"旧字段": "值"}, "hidden_info": ["旧数据"]}
        result = CaseDataSchema(**data)
        assert result.name == "病例"

    def test_validate_case_data_strict_raises(self):
        with pytest.raises(ValidationError):
            assert_valid_case_data({"name": ""})

    def test_validate_case_data_non_strict_returns_raw(self):
        result = validate_case_data({"name": ""}, strict=False)
        assert result == {"name": ""}

    def test_rubric_ref_default(self):
        data = {"name": "病例"}
        result = CaseDataSchema(**data)
        assert result.rubric_ref == "active"

    def test_deep_background_valid(self):
        data = {"name": "病例", "deep_background": {"手术史": "3年前胆囊切除"}}
        result = CaseDataSchema(**data)
        assert result.deep_background["手术史"] == "3年前胆囊切除"

    def test_supported_plugins(self):
        data = {"name": "病例", "supported_plugins": ["emotion", "physical_exam"]}
        result = CaseDataSchema(**data)
        assert "emotion" in result.supported_plugins
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend; python -m pytest tests/test_case_schema.py -v`
Expected: `ModuleNotFoundError: No module named 'core.case_schema'`

- [ ] **Step 4: Create the file and run tests to verify they pass**

Run: `cd backend; python -m pytest tests/test_case_schema.py -v`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add backend/core/case_schema.py backend/tests/test_case_schema.py
git commit -m "feat(core): add case_data Pydantic validation schema"
```

### Task 2: Wire validation into HTTP entry points

**Files:**
- Modify: `backend/routers/cases.py`

- [ ] **Step 1: Add import at top**

```python
from core.case_schema import assert_valid_case_data
```

- [ ] **Step 2: Replace manual checks on create**

```python
# Replace lines 263-280 (manual name/personality/defaults checks):
cd = req.case_data
cd = assert_valid_case_data(cd)
# Remove the block setting defaults for personality, deep_background, etc.
```

- [ ] **Step 3: Replace manual checks on update**

```python
# Replace lines 312-316:
cd = req.case_data
cd = assert_valid_case_data(cd)
# Remove manual name check
```

- [ ] **Step 4: Add validation after LLM generation**

```python
# After line 226 (CaseGenerateResponse):
result = assert_valid_case_data(result)
```

- [ ] **Step 5: Run existing tests to verify**

Run: `cd backend; python -m pytest tests/test_cases.py -v`
Expected: all pass (need test_case fixture from conftest)

- [ ] **Step 6: Commit**

```bash
git add backend/routers/cases.py
git commit -m "feat(cases): wire case_data Pydantic validation into CRUD endpoints"
```

### Task 3: Wire warn-mode validation into training start

**Files:**
- Modify: `backend/contexts/training/router/session.py`

- [ ] **Step 1: Add import**

```python
from core.case_schema import validate_case_data
```

- [ ] **Step 2: Add validation in `_create_record()`**

```python
# After line 176 (config = _resolve_features(...)):
validate_case_data(case_data, strict=False)
```

- [ ] **Step 3: Run tests**

Run: `cd backend; python -m pytest tests/ -m "not pg" -x -q`
Expected: all pass (warn-only doesn't change behavior)

- [ ] **Step 4: Commit**

```bash
git add backend/contexts/training/router/session.py
git commit -m "feat(session): add warn-mode case_data validation on training start"
```

---

## Phase 2: Runtime State Separation

### Task 1: Add runtime_state column + migration

**Files:**
- Modify: `backend/models.py`

- [ ] **Step 1: Add column to TrainingRecord**

```python
class TrainingRecord(Base):
    # ... existing fields ...
    runtime_state: Mapped[dict] = mapped_column(
        JSONB, server_default=sa.text("'{}'::jsonb"), default=dict
    )
```

- [ ] **Step 2: Generate migration**

Run: `cd backend; alembic revision --autogenerate -m "add runtime_state to training_records"`

- [ ] **Step 3: Add data migration step to migration file**

Open the generated migration file, add between `op.add_column()` and the upgrade end:

```python
from alembic import op
from sqlalchemy import text

def upgrade():
    op.add_column("training_records",
        sa.Column("runtime_state", postgresql.JSONB, server_default=sa.text("'{}'::jsonb"))
    )
    # ---- data migration ----
    conn = op.get_bind()
    rows = conn.execute(
        text("SELECT id, practice_snapshot FROM training_records")
    ).fetchall()
    for row in rows:
        snap = dict(row.practice_snapshot or {})
        runtime = {}
        for old_key, new_key in [
            ("_exam_results", "exam_results"),
            ("_phase_op_count", "phase_op_count"),
        ]:
            if old_key in snap:
                runtime[new_key] = snap.pop(old_key)
        if "_exam_impact_note" in snap:
            runtime["exam_impact_note"] = snap.pop("_exam_impact_note")
        for key in list(snap):
            if key.startswith("_"):
                del snap[key]
        conn.execute(
            text("UPDATE training_records SET practice_snapshot = :snap, runtime_state = :rt WHERE id = :id"),
            {"snap": snap, "rt": runtime, "id": row.id}
        )

def downgrade():
    op.drop_column("training_records", "runtime_state")
```

- [ ] **Step 4: Run migration**

Run: `cd backend; alembic upgrade head`
Expected: migrates existing data

- [ ] **Step 5: Commit**

```bash
git add backend/models.py
git add backend/migrations/versions/*_add_runtime_state_to_training_records.py
git commit -m "feat(db): add runtime_state JSONB column to TrainingRecord"
```

### Task 2: Update physical_exam routes to write runtime_state

**Files:**
- Modify: `backend/plugins/physical_exam/routes.py`

- [ ] **Step 1: Replace snapshot writes with runtime_state (exam_results)**

```python
# Before:
exam_results = snapshot.get("_exam_results", [])
exam_results.append(result)
snapshot["_exam_results"] = exam_results

# After:
rs = dict(record.runtime_state or {})
exam_results = rs.get("exam_results", [])
exam_results.append(result)
rs["exam_results"] = exam_results
record.runtime_state = rs
```

- [ ] **Step 2: Apply ExamEffect snapshot_updates to runtime_state instead of practice_snapshot**

After `pm.run_hook("on_exam", exam_ctx, features)` returns effects:

```python
for effect in exam_effects:
    if effect is None:
        continue
    if effect.snapshot_updates:
        rs = dict(record.runtime_state or {})
        for k, v in effect.snapshot_updates.items():
            key = k.lstrip("_")
            rs[key] = v
        record.runtime_state = rs
```

Remove the old path that applies snapshot_updates to `record.practice_snapshot`.

- [ ] **Step 3: Run tests**

Run: `cd backend; python -m pytest tests/test_exam_bridge.py -v`
Expected: pass

- [ ] **Step 4: Commit**

```bash
git add backend/plugins/physical_exam/routes.py
git commit -m "feat(exam): write exam results + exam_impact_note to runtime_state"
```

### Task 3: Update persister to write phase_op_count to runtime_state

**Files:**
- Modify: `backend/contexts/training/pipeline/middleware/persister.py`

- [ ] **Step 1: Replace `_persist_phase_op_count()`**

```python
def _persist_phase_op_count(ctx: PipelineContext) -> None:
    count = ctx.state.get("_phase_op_count")
    if count is not None:
        rs = dict(ctx.record.runtime_state or {})
        rs["phase_op_count"] = count
        ctx.record.runtime_state = rs
```

- [ ] **Step 2: Run tests**

Run: `cd backend; python -m pytest tests/test_pipeline_integration.py -v`
Expected: pass

- [ ] **Step 3: Commit**

```bash
git add backend/contexts/training/pipeline/middleware/persister.py
git commit -m "feat(persister): write phase_op_count to runtime_state"
```

### Task 4: Update sources.py to read from runtime_state

**Files:**
- Modify: `backend/contexts/patient/sources.py`

- [ ] **Step 1: Update ExamResultsSource.collect()**

```python
class ExamResultsSource(ContextSource):
    name = "exam_results"

    async def collect(self, ctx) -> str | None:
        rs = ctx.record.runtime_state or {}
        exam_results = rs.get("exam_results", [])
        if not isinstance(exam_results, list) or not exam_results:
            return None
        lines = []
        for r in exam_results[-5:]:
            label = r.get("label", "")
            value = r.get("value", "")
            unit = r.get("unit", "")
            lines.append(f"{label}: {value}{unit}")
        return "已查体征: " + " | ".join(lines)
```

- [ ] **Step 2: Update ExamImpactSource.collect()**

```python
class ExamImpactSource(ContextSource):
    name = "exam_impact"

    async def collect(self, ctx) -> str | None:
        rs = ctx.record.runtime_state or {}
        note = rs.get("exam_impact_note")
        if note and isinstance(note, str) and note.strip():
            return note
        return None
```

- [ ] **Step 3: Run tests**

Run: `cd backend; python -m pytest tests/test_patient_sources.py -v`
Expected: tests update needed (see Step 4)

- [ ] **Step 4: Update test fixtures**

```python
# In test_patient_sources.py, FakeContext.Record:
class Record:
    def __init__(self, runtime_state=None):
        self.runtime_state = runtime_state
```

Update test data from `practice_snapshot={"_exam_results": ...}` to `runtime_state={"exam_results": ...}`.

- [ ] **Step 5: Run tests to verify**

Run: `cd backend; python -m pytest tests/test_patient_sources.py -v`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add backend/contexts/patient/sources.py backend/tests/test_patient_sources.py
git commit -m "feat(sources): read exam data from runtime_state instead of practice_snapshot"
```

### Task 5: Update progress.py and context.py

**Files:**
- Modify: `backend/contexts/training/router/progress.py`
- Modify: `backend/contexts/training/pipeline/context.py`

- [ ] **Step 1: Update progress.py reads/writes**

```python
# Line 62: replace
op_count = (record.practice_snapshot or {}).get("_phase_op_count", 0)
# with
op_count = (record.runtime_state or {}).get("phase_op_count", 0)

# Lines 69-71: replace
snapshot["_phase_op_count"] = 0
# with
rs = dict(record.runtime_state or {})
rs["phase_op_count"] = 0
record.runtime_state = rs
```

- [ ] **Step 2: Update context.py setup_phases()**

```python
def setup_phases(self):
    # line 59: replace
    self.phase_operation_count = self.case_data.get("_phase_op_count", 0)
    # with
    rs = self.record.runtime_state or {}
    self.phase_operation_count = rs.get("phase_op_count", 0)
```

- [ ] **Step 3: Run tests**

Run: `cd backend; python -m pytest tests/ -m "not pg" -x -q`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add backend/contexts/training/router/progress.py backend/contexts/training/pipeline/context.py
git commit -m "feat(progress): read/write phase_op_count from runtime_state"
```

---

## Phase 3: Note Infrastructure

### Task 1: Create NoteSource ABC and NoteCollector

**Files:**
- Create: `backend/contexts/patient/note_source.py`
- Create: `backend/contexts/patient/note_collector.py`
- Test: `backend/tests/test_note_collector.py`

- [ ] **Step 1: Create NoteSource ABC**

```python
"""NoteSource — per-round context injection interface."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from contexts.training.pipeline.context import PipelineContext


class NoteSource(ABC):
    name: str = ""
    priority: int = 0
    max_tokens: int = 100

    @abstractmethod
    async def collect(self, ctx: PipelineContext) -> str | None:
        ...
```

- [ ] **Step 2: Create NoteCollector**

```python
"""NoteCollector — pipeline-level author_note assembly with budget management."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from contexts.training.pipeline.context import PipelineContext

from .note_source import NoteSource

log = logging.getLogger(__name__)

MAX_AUTHOR_NOTE_TOKENS = 300


def _estimate_tokens(text: str) -> int:
    cjk = sum(1 for c in text if "\u4e00" <= c <= "\u9fff")
    return cjk * 2 + (len(text) - cjk) // 2


def _truncate_tokens(text: str, max_tokens: int) -> str:
    max_chars = max_tokens // 2
    return text[:max_chars] + "…" if len(text) > max_chars else text


class NoteCollector:
    def __init__(self) -> None:
        self._sources: list[NoteSource] = []

    def add(self, source: NoteSource) -> None:
        self._sources.append(source)

    async def collect(self, ctx: PipelineContext) -> str:
        notes: list[tuple[int, str, str]] = []
        for src in self._sources:
            try:
                text = await src.collect(ctx)
                if text and text.strip():
                    notes.append((src.priority, src.name, text.strip()))
            except Exception:
                log.exception("NoteSource %s failed", src.name)
        notes.sort(key=lambda x: x[0])
        return self._budget_join(notes)

    def _budget_join(self, notes: list[tuple[int, str, str]]) -> str:
        budget = MAX_AUTHOR_NOTE_TOKENS
        selected: list[str] = []
        for _, name, text in notes:
            cost = _estimate_tokens(text)
            if cost > budget:
                if not selected:
                    selected.append(_truncate_tokens(text, budget))
                break
            selected.append(text)
            budget -= cost
        return "【" + " | ".join(selected) + "】" if selected else ""
```

- [ ] **Step 3: Write tests**

```python
"""Tests for NoteSource ABC and NoteCollector."""

import pytest
from contexts.patient.note_source import NoteSource
from contexts.patient.note_collector import (
    MAX_AUTHOR_NOTE_TOKENS,
    NoteCollector,
    _estimate_tokens,
    _truncate_tokens,
)


class FakeSource(NoteSource):
    def __init__(self, name: str, priority: int, text: str | None):
        self.name = name
        self.priority = priority
        self._text = text

    async def collect(self, ctx) -> str | None:
        return self._text


class FakeContext:
    pass


class TestTokenEstimation:
    def test_english(self):
        assert _estimate_tokens("hello world") == 0  # no CJK

    def test_chinese(self):
        assert _estimate_tokens("患者体温38.5") == 10  # 5 CJK * 2

    def test_mixed(self):
        assert _estimate_tokens("体温 38.5 °C") == 4  # 2 CJK * 2


class TestNoteCollector:
    async def test_empty(self):
        collector = NoteCollector()
        result = await collector.collect(FakeContext())
        assert result == ""

    async def test_single_note(self):
        collector = NoteCollector()
        collector.add(FakeSource("exam", 0, "体温 38.5"))
        result = await collector.collect(FakeContext())
        assert "体温" in result

    async def test_priority_order(self):
        collector = NoteCollector()
        collector.add(FakeSource("low", 10, "low"))
        collector.add(FakeSource("high", 0, "high"))
        result = await collector.collect(FakeContext())
        assert result.index("high") < result.index("low")

    async def test_budget_truncation(self):
        collector = NoteCollector()
        long_text = "患者" * MAX_AUTHOR_NOTE_TOKENS  # far over budget
        collector.add(FakeSource("long", 0, long_text))
        result = await collector.collect(FakeContext())
        assert len(result) < len(long_text)
        assert result.endswith("…")

    async def test_source_exception_survives(self):
        class BrokenSource(NoteSource):
            async def collect(self, ctx) -> str | None:
                raise RuntimeError("boom")

        collector = NoteCollector()
        collector.add(BrokenSource())
        collector.add(FakeSource("ok", 0, "fine"))
        result = await collector.collect(FakeContext())
        assert "fine" in result
```

- [ ] **Step 4: Run tests**

Run: `cd backend; python -m pytest tests/test_note_collector.py -v`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add backend/contexts/patient/note_source.py backend/contexts/patient/note_collector.py backend/tests/test_note_collector.py
git commit -m "feat(note): add NoteSource ABC and NoteCollector with budget management"
```

### Task 2: Refactor sources.py — remove global registration

**Files:**
- Modify: `backend/contexts/patient/sources.py`
- Modify: `backend/contexts/patient/__init__.py`

- [ ] **Step 1: Remove global state from sources.py**

```python
"""ContextSource implementations — composable author_note contributions per round.

NoteSources are now assembled by NoteCollector at pipeline build time,
not registered globally. See note_collector.py and plugins/manager.py.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from contexts.training.pipeline.context import PipelineContext

from contexts.patient.guards import get_identity_correction_note, has_identity_leak

log = logging.getLogger(__name__)


class ContextSource(ABC):
    name: str = ""

    @abstractmethod
    async def collect(self, ctx: PipelineContext) -> str | None:
        ...


class EmotionNoteSource(ContextSource):
    name = "emotion"

    async def collect(self, ctx: PipelineContext) -> str | None:
        note = ctx.state.get("emotion_note")
        return note if note else None


class IdentityGuardSource(ContextSource):
    name = "identity_guard"

    async def collect(self, ctx: PipelineContext) -> str | None:
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

    async def collect(self, ctx: PipelineContext) -> str | None:
        rs = ctx.record.runtime_state or {}
        exam_results = rs.get("exam_results", [])
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

    async def collect(self, ctx: PipelineContext) -> str | None:
        rs = ctx.record.runtime_state or {}
        note = rs.get("exam_impact_note")
        if note and isinstance(note, str) and note.strip():
            return note
        return None


class PluginAuthorNoteSource(ContextSource):
    name = "plugin_author_notes"

    async def collect(self, ctx: PipelineContext) -> str | None:
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


# NOTE: register_source(), clear_sources(), get_sources(), and collect_author_note()
# have been removed. Use NoteCollector from note_collector.py instead.
```

- [ ] **Step 2: Update `__init__.py` exports**

```python
# backend/contexts/patient/__init__.py
# Remove: collect_author_note, register_source, clear_sources, get_sources
# Keep: all ContextSource subclasses
```

- [ ] **Step 3: Update test imports in test_patient_sources.py**

```python
# Remove imports of: clear_sources, collect_author_note, register_source
# Keep imports of: ContextSource, EmotionNoteSource, ExamImpactSource, ExamResultsSource, IdentityGuardSource
```

- [ ] **Step 4: Run tests**

Run: `cd backend; python -m pytest tests/test_patient_sources.py tests/test_note_collector.py -v`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add backend/contexts/patient/sources.py backend/contexts/patient/__init__.py backend/tests/test_patient_sources.py
git commit -m "refactor(sources): remove global registration, keep NoteSource classes"
```

### Task 3: Wire NoteCollector into PluginManager.build_pipeline()

**Files:**
- Modify: `backend/plugins/manager.py`
- Modify: `backend/plugins/base.py`
- Modify: `backend/contexts/training/pipeline/runner.py`
- Modify: `backend/contexts/training/pipeline/middleware/prompt_builder.py`
- Modify: `backend/contexts/training/pipeline/context.py`

- [ ] **Step 1: Add `get_note_sources()` to Plugin base**

```python
# backend/plugins/base.py
def get_note_sources(self) -> list:
    return []
```

- [ ] **Step 2: Update PluginManager.build_pipeline() to assemble collector**

```python
def build_pipeline(self, feature_flags):
    # ... existing middleware assembly ...

    from contexts.patient.note_collector import NoteCollector
    from contexts.patient.sources import (
        EmotionNoteSource, ExamImpactSource, ExamResultsSource, IdentityGuardSource,
    )

    collector = NoteCollector()
    for src_cls in [EmotionNoteSource, IdentityGuardSource, ExamResultsSource, ExamImpactSource]:
        collector.add(src_cls())

    for plugin in self.get_active(feature_flags):
        for ns in plugin.get_note_sources():
            collector.add(ns)

    return middlewares, collector
```

- [ ] **Step 3: Update PipelineContext to carry collector**

```python
@dataclass
class PipelineContext:
    # ... existing fields ...
    note_collector: Any = None
```

- [ ] **Step 4: Update runner.py to inject collector**

```python
# In run_pipeline() and stream_pipeline(), add parameter:
async def run_pipeline(ctx: PipelineContext, middlewares: list, note_collector=None):
    ctx.note_collector = note_collector
    # ... rest unchanged
```

- [ ] **Step 5: Update the caller in chat.py**

```python
# In chat.py where pipeline is called:
from contexts.training.pipeline.registry import build_pipeline as build_pipeline_with_collector
middlewares, collector = build_pipeline_with_collector(features)
await run_pipeline(ctx, middlewares, note_collector=collector)
```

- [ ] **Step 6: Update prompt_builder.py**

```python
async def prompt_builder(ctx: PipelineContext, next_mw) -> None:
    if ctx.should_shortcut:
        await next_mw()
        return

    author_note = ""
    if ctx.note_collector:
        author_note = await ctx.note_collector.collect(ctx)

    # ... rest unchanged (build_patient_context_kwargs, template rendering)
```

- [ ] **Step 7: Run tests**

Run: `cd backend; python -m pytest tests/test_pipeline_integration.py tests/test_note_collector.py -v`
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add backend/plugins/manager.py backend/plugins/base.py backend/contexts/training/pipeline/runner.py backend/contexts/training/pipeline/middleware/prompt_builder.py backend/contexts/training/pipeline/context.py
git commit -m "feat(pipeline): wire NoteCollector into pipeline assembly"
```

---

## Phase 4: Plugin Contract

### Task 1: Add required_case_fields + wire into validation

**Files:**
- Modify: `backend/plugins/base.py`
- Modify: `backend/plugins/physical_exam/plugin.py`
- Modify: `backend/plugins/initiative/plugin.py`
- Modify: `backend/core/case_schema.py`
- Modify: `backend/tests/test_case_schema.py`

- [ ] **Step 1: Add class variable to Plugin base**

```python
class Plugin(ABC):
    id: ClassVar[str]
    name: ClassVar[str]
    description: ClassVar[str] = ""
    requires: ClassVar[list[str]] = []
    required_case_fields: ClassVar[list[str]] = []
    feature_flag: ClassVar[FeatureFlag | None] = None
```

- [ ] **Step 2: Declare on physical_exam**

```python
# backend/plugins/physical_exam/plugin.py
class PhysicalExamPlugin(Plugin):
    id = "physical-exam"
    required_case_fields = ["exam_anchors"]
```

- [ ] **Step 3: Declare on initiative**

```python
# backend/plugins/initiative/plugin.py
class InitiativePlugin(Plugin):
    id = "initiative"
    requires = ["emotion"]
    required_case_fields = ["personality"]
```

- [ ] **Step 4: Wire plugin check into validate_case_data()**

```python
# backend/core/case_schema.py
def validate_case_data(data: dict, *, strict: bool = False) -> dict:
    try:
        CaseDataSchema(**data)
    except ValidationError as e:
        if strict:
            raise
        log.warning("case_data validation warning: %s", e)
        return data

    supported = data.get("supported_plugins", [])
    if supported:
        try:
            from plugins.manager import get_plugin_manager
            pm = get_plugin_manager()
            if not pm._plugins:
                pm.discover()
            for plugin_id in supported:
                plugin = pm._plugins.get(plugin_id)
                if plugin is None:
                    msg = f"未知插件: {plugin_id}"
                    if strict:
                        raise ValidationError.from_exception_data(msg, [])
                    log.warning(msg)
                    continue
                for field in plugin.required_case_fields:
                    if field not in data:
                        msg = f"插件 '{plugin_id}' 需要 case_data 字段 '{field}'"
                        if strict:
                            raise ValidationError.from_exception_data(msg, [])
                        log.warning(msg)
        except ImportError:
            pass  # running outside app context (e.g. tests)

    return data
```

- [ ] **Step 5: Write tests**

```python
class TestPluginContract:
    def test_strict_missing_field_raises(self):
        data = {"name": "病例", "supported_plugins": ["physical-exam"]}
        # exam_anchors missing
        with pytest.raises(ValidationError):
            assert_valid_case_data(data)

    def test_strict_with_field_passes(self):
        data = {"name": "病例", "supported_plugins": ["physical-exam"], "exam_anchors": {"vital_signs": {}}}
        result = assert_valid_case_data(data)
        assert result["name"] == "病例"

    def test_warn_missing_field_returns_raw(self):
        data = {"name": "病例", "supported_plugins": ["physical-exam"]}
        result = validate_case_data(data, strict=False)
        assert result == data  # passes through with warning
```

- [ ] **Step 6: Run tests**

Run: `cd backend; python -m pytest tests/test_case_schema.py -v`
Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add backend/plugins/base.py backend/plugins/physical_exam/plugin.py backend/plugins/initiative/plugin.py backend/core/case_schema.py backend/tests/test_case_schema.py
git commit -m "feat(plugins): add required_case_fields + schema validation linkage"
```

---

## Phase 5: Rubric Chain

### Task 1: Add load_rubric_by_version()

**Files:**
- Modify: `backend/repositories/rubric.py`

- [ ] **Step 1: Add function**

```python
_RUBRIC_VERSION_CACHE: dict[str, tuple[float, dict]] = {}
_RUBRIC_VERSION_TTL = 300.0


def load_rubric_by_version(version_id: str) -> dict:
    """Load a rubric by frozen version ID ({name}@{version}).

    Independent 5-minute cache (not the 60s active-rubric cache).
    """
    now = time.monotonic()
    if version_id in _RUBRIC_VERSION_CACHE:
        ts, cached = _RUBRIC_VERSION_CACHE[version_id]
        if now - ts < _RUBRIC_VERSION_TTL:
            return cached

    name, sep, ver = version_id.partition("@")
    if not sep:
        name, ver = version_id, ""

    db = SessionLocal()
    try:
        rubric = (
            db.query(Rubric)
            .filter(Rubric.name == name)
            .filter(Rubric.version == ver if ver else sa.true())
            .first()
        )
        if rubric:
            result = {
                "id": rubric.name, "name": rubric.name,
                "version": rubric.version, "total_max": rubric.total_max,
                "raw_max": rubric.raw_max, "raw_scale": rubric.raw_scale,
                "dimensions": rubric.dimensions,
            }
            _RUBRIC_VERSION_CACHE[version_id] = (now, result)
            return result
    finally:
        db.close()

    result = load_rubric(name)
    _RUBRIC_VERSION_CACHE[version_id] = (now, result)
    return result
```

- [ ] **Step 2: Write tests**

```python
class TestLoadRubricByVersion:
    def test_load_default(self):
        result = load_rubric_by_version("nursing_history_v1@1.0")
        assert result["id"] == "nursing_history_v1"
        assert len(result["dimensions"]) > 0

    def test_unknown_raises(self):
        with pytest.raises(FileNotFoundError):
            load_rubric_by_version("nonexistent@1.0")
```

- [ ] **Step 3: Run tests**

Run: `cd backend; python -m pytest tests/test_rubric.py -v`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add backend/repositories/rubric.py
git commit -m "feat(rubric): add load_rubric_by_version() for frozen rubric loading"
```

### Task 2: Add rubric_frozen + wire into training start

**Files:**
- Modify: `backend/models.py`
- Modify: `backend/contexts/training/router/session.py`
- Modify: `backend/contexts/training/score_engine.py`

- [ ] **Step 1: Add column to TrainingRecord**

```python
class TrainingRecord(Base):
    rubric_frozen: Mapped[str | None] = mapped_column(String(80), nullable=True)
```

- [ ] **Step 2: Generate migration**

Run: `cd backend; alembic revision --autogenerate -m "add rubric_frozen to training_records"`

- [ ] **Step 3: Add _resolve_rubric_ref() to session.py**

```python
def _resolve_rubric_ref(rubric_ref: str) -> str:
    from repositories.rubric import load_active_rubric, load_rubric_by_version
    if rubric_ref == "active":
        active = load_active_rubric()
        if active:
            return f"{active.name}@{active.version}"
        return "nursing_history_v1@1.0"
    load_rubric_by_version(rubric_ref)
    return rubric_ref
```

- [ ] **Step 4: Call in _create_record()**

```python
# After record creation, before return:
record.rubric_frozen = _resolve_rubric_ref(
    case_data.get("rubric_ref", "active")
)
```

- [ ] **Step 5: Update score_engine.py**

```python
# score_engine.py:evaluate_training()
# Replace:
rubric = load_rubric_dict()
# With:
rubric = load_rubric_by_version(record.rubric_frozen or "nursing_history_v1@1.0")
```

- [ ] **Step 6: Remove scoring_criteria from case_generation.py**

```python
# In prompts/case_generation.py, replace the scoring_criteria example:
# Old: {"scoring_criteria": {... lengthy example ...}}
# New: {"rubric_ref": "active"}  # 评分标准由中央 rubric 管理
```

- [ ] **Step 7: Run tests**

Run: `cd backend; python -m pytest tests/ -m "not pg" -x -q`
Expected: all pass (existing tests use `load_rubric_dict()` which still works as fallback)

- [ ] **Step 8: Commit**

```bash
git add backend/models.py backend/contexts/training/router/session.py backend/contexts/training/score_engine.py backend/prompts/case_generation.py
git add backend/migrations/versions/*_add_rubric_frozen_to_training_records.py
git commit -m "feat(rubric): add rubric_frozen column + resolve at training start"
```

---

## Spec Coverage Check

| Spec Requirement | Task |
|-----------------|------|
| Phase 1: Pydantic schema for case_data | P1.T1 |
| Phase 1: strict vs warn mode | P1.T1 (validate_case_data two modes) |
| Phase 1: wire into CRUD endpoints | P1.T2 |
| Phase 1: wire into training start | P1.T3 |
| Phase 2: runtime_state JSONB column | P2.T1 |
| Phase 2: migration of existing data | P2.T1 (migration script) |
| Phase 2: cache boundary with EmotionCache | P2.T1 (spec updated, no code change needed) |
| Phase 2: physical_exam writes runtime_state | P2.T2 |
| Phase 2: persister writes runtime_state | P2.T3 |
| Phase 2: exam_emotion_bridge writes runtime_state | P2.T4 (via ExamEffect) |
| Phase 2: sources read from runtime_state | P2.T4 |
| Phase 2: progress/context read runtime_state | P2.T5 |
| Phase 3: NoteSource ABC | P3.T1 |
| Phase 3: NoteCollector with budget | P3.T1 |
| Phase 3: remove global register_source | P3.T2 |
| Phase 3: wire into pipeline assembly | P3.T3 |
| Phase 4: required_case_fields on Plugin | P4.T1 |
| Phase 4: declare on physical-exam/initiative | P4.T1 |
| Phase 4: schema-validation linkage | P4.T1 |
| Phase 5: load_rubric_by_version() | P5.T1 |
| Phase 5: rubric_frozen column | P5.T2 |
| Phase 5: resolve at training start | P5.T2 |
| Phase 5: score engine uses frozen rubric | P5.T2 |
| Phase 5: case_generation prompt updated | P5.T2 |
