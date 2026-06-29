# Batch A — Profile Infrastructure + Case Decoupling

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish the `TrainingProfile` data model and registry, decouple `Case` from monolithic `CaseDataSchema`, and route existing code through profile without breaking existing behavior.

**Architecture:** Profile is a static dataclass registry — not a plugin system. `get_profile(type)` returns a `TrainingProfile` instance. Existing routes keep working via bridge code. DB migration adds new columns but preserves all existing data.

**Tech Stack:** Python 3.13, SQLAlchemy 2, Alembic, FastAPI

---

### Task 1: Profile Data Classes + Registry + history_taking Profile

**Files:**
- Create: `backend/profiles/__init__.py`
- Create: `backend/profiles/registry.py`
- Create: `backend/profiles/history_taking/__init__.py`
- Create: `backend/profiles/history_taking/profile.py`
- Modify: `backend/contexts/patient/note_source.py` (add `OperationNoteSource` alongside `ExamExperienceSource`)

- [ ] **Step 1: Create `backend/profiles/__init__.py`**

```python
"""Profiles — self-contained training type configuration."""
```

- [ ] **Step 2: Create `backend/profiles/registry.py`**

```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Sequence

    from contexts.patient.note_source import NoteSource


@dataclass
class PhaseConfig:
    id: str
    name: str = ""
    description: str = ""
    order: int = 1
    operations: list[str] = field(default_factory=lambda: ["chat"])
    prompt_profile: str = "patient_chat"
    scoring_dimensions: list[str] = field(default_factory=list)
    transition: dict = field(default_factory=dict)

    def supports_operation(self, op_type: str) -> bool:
        return "chat" in self.operations or op_type in self.operations


@dataclass
class PromptCollection:
    system: str = ""
    dynamic: str = ""
    scoring: str = ""
    scoring_user: str = ""
    scoring_feedback: str = ""
    scoring_feedback_user: str = ""


@dataclass
class TrainingProfile:
    name: str
    initial_phase: str
    phases: list[PhaseConfig]
    note_sources: list[type[NoteSource]]
    prompts: PromptCollection
    rubric: dict
    capabilities: list[str]
    max_rounds: int
    has_emotion: bool
    has_initiative: bool


_PROFILES: dict[str, TrainingProfile] = {}


def register_profile(type_: str, profile: TrainingProfile) -> None:
    _PROFILES[type_] = profile


def get_profile(type_: str) -> TrainingProfile:
    if type_ not in _PROFILES:
        raise KeyError(f"Unknown training type: {type_}")
    return _PROFILES[type_]


def get_known_types() -> list[str]:
    return list(_PROFILES)
```

- [ ] **Step 3: Create `backend/profiles/history_taking/__init__.py`**

```python
from .profile import PROFILE

__all__ = ["PROFILE"]
```

- [ ] **Step 4: Create `backend/profiles/history_taking/profile.py`**

The profile holds all configuration that was previously hardcoded in pipeline code.

```python
from __future__ import annotations

from contexts.patient.note_source import EmotionNoteSource, IdentityGuardSource, OperationNoteSource
from profiles.registry import (
    TRAINING_PROFILE_MAP,
    PhaseConfig,
    PromptCollection,
    TrainingProfile,
)

_PROMPTS = PromptCollection(
    system="""你正在扮演一位真实患者。你不是AI，不是教学工具——你是一个活生生的人，正在医院里和一位护理学生对话。

## 身份

姓名：{#patient_info#}

## 场景

{#scenario#}

## 性格

{#personality#}

## 说话风格

{#communication_style#}

## 必须遵守

1. **按人设回应**
2. **像真人聊天** — 每次回答 1-3 句话
3. **只回答你知道的**
4. **不暴露身份**
5. **感知检查但不自知结果**
""",
    dynamic="""## 病情信息

**主诉**: {#chief_complaint#}

**现病史**: {#present_illness#}

**过敏史**: {#allergy_history#}

**隐藏背景**: {#deep_background#}

**对话参考**: {#example_dialogues#}
""",
)

_RUBRIC: dict = {
    "name": "nursing_history_v1",
    "version": "1.0",
    "raw_max": 57,
    "raw_scale": 3,
    "dimensions": [
        {
            "name": "沟通技能",
            "items": [
                {"id": "greeting", "label": "主动礼貌问候", "max": 3},
            ],
        },
        {
            "name": "病史采集",
            "items": [
                {"id": "chief_complaint", "label": "主诉询问", "max": 3},
            ],
        },
    ],
}

PROFILE = TrainingProfile(
    name="history_taking",
    initial_phase="history_taking",
    phases=[
        PhaseConfig(
            id="history_taking",
            name="问诊",
            order=1,
            operations=["chat"],
            prompt_profile="patient_chat",
            scoring_dimensions=["沟通技能", "病史采集"],
            transition={"auto": True, "auto_after_messages": 9999},
        ),
    ],
    note_sources=[EmotionNoteSource, IdentityGuardSource, OperationNoteSource],
    prompts=_PROMPTS,
    rubric=_RUBRIC,
    capabilities=["emotion", "patient_initiative", "physical_exam"],
    max_rounds=8,
    has_emotion=True,
    has_initiative=False,
)
```

- [ ] **Step 5: Add `OperationNoteSource` to `note_source.py`**

Replace `ExamExperienceSource` with a more generic `OperationNoteSource`:

```python
_OPS_EXPERIENCE_DESCRIPTIONS: dict[str, str] = {
    "temp": "体温测量（体温计置于腋下）",
    "bp": "血压测量（袖带绑在左上臂）",
    "hr": "心率测量",
    "rr": "呼吸频率测量（观察胸廓起伏）",
    "spo2": "血氧测量（手指佩戴血氧夹）",
    "vitals": "全套生命体征测量",
    "skin": "皮肤检查（视诊观察）",
    "pain": "NRS 疼痛评估",
}


class OperationNoteSource(NoteSource):
    name = "operation"
    priority = 30
    max_tokens = 150

    async def collect(self, ctx: PipelineContext) -> str | None:
        rs = ctx.record.runtime_state or {}
        ops = rs.get("operations", [])
        if not isinstance(ops, list) or not ops:
            return None
        experiences: list[str] = []
        seen: set[str] = set()
        for op in ops:
            type_ = op.get("type", "")
            if type_ in seen:
                continue
            seen.add(type_)
            desc = _OPS_EXPERIENCE_DESCRIPTIONS.get(type_)
            if desc:
                experiences.append(desc)
        if not experiences:
            return None
        return "护士对你进行了以下操作：\n- " + "\n- ".join(experiences)
```

Keep `ExamExperienceSource` as well for now (compat alias).

- [ ] **Step 6: Register the profile at app startup**

Find where the app initializes (likely `backend/main.py` or `backend/__init__.py`). Add:

```python
# After app creation, before first request
from profiles.history_taking import PROFILE as history_taking_profile
from profiles.registry import register_profile

register_profile("history_taking", history_taking_profile)
```

- [ ] **Step 7: Run tests to confirm nothing broke**

Run: `cd backend && uv run python -m pytest tests/training/ tests/core/test_note_collector.py -x -q`
Expected: All existing tests pass (profile is additive, no code uses it yet)

- [ ] **Step 8: Commit**

```bash
git add backend/profiles/ backend/contexts/patient/note_source.py
git commit -m "🗃️ db: add TrainingProfile registry and history_taking profile"
```

---

### Task 2: DB Migration — Case Columns + JSONB + Drop CHECK Constraints

**Files:**
- Create: `backend/alembic/versions/xxxx_batch_a_case_schema.py`
- Modify: `backend/models/case_practice.py`
- Modify: `backend/models/training.py`
- Modify: `backend/core/case_schema.py`

- [ ] **Step 1: Read the current migration head**

Run: `cd backend && uv run alembic heads`
Note the current head revision ID.

- [ ] **Step 2: Create the migration**

Run: `cd backend && uv run alembic revision --autogenerate -m "batch_a_case_schema"`

If autogenerate doesn't detect changes because SQLAlchemy model still uses `PydanticJSONB(CaseDataSchema)`, generate an empty migration and write manually:

```python
"""batch_a_case_schema

Revision ID: xxxx
Revises: <current_head>
Create Date: 2026-06-29

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "xxxx"
down_revision = "<current_head>"


def upgrade():
    # 1) Add columns to cases
    op.add_column("cases", sa.Column("training_type", sa.String(50), server_default="history_taking", nullable=False))
    op.add_column("cases", sa.Column("difficulty", sa.Integer, server_default="1", nullable=False))
    op.add_column("cases", sa.Column("time_limit_minutes", sa.Integer, server_default="20", nullable=False))

    # 2) Migrate existing case_data values into new columns
    op.execute("UPDATE cases SET difficulty = (case_data->>'difficulty')::int WHERE case_data ? 'difficulty'")
    op.execute("UPDATE cases SET time_limit_minutes = (case_data->>'time_limit')::int WHERE case_data ? 'time_limit'")

    # 3) Add training_type to training_records
    op.add_column("training_records", sa.Column("training_type", sa.String(50), server_default="history_taking", nullable=False))
    op.add_column("training_records", sa.Column("prompt_snapshot", JSONB, nullable=True))
    op.add_column("training_records", sa.Column("rubric_snapshot", JSONB, nullable=True))

    # 4) Drop CHECK constraints
    op.drop_constraint("ck_training_records_current_phase", "training_records", type_="check")
    op.drop_constraint("ck_messages_role", "messages", type_="check")


def downgrade():
    op.add_constraint("ck_messages_role", "messages", sa.CheckConstraint("role IN ('student', 'patient', 'system')"))
    op.add_constraint("ck_training_records_current_phase", "training_records", sa.CheckConstraint("current_phase IN ('history_taking', 'physical_exam', 'ending')"))
    op.drop_column("training_records", "rubric_snapshot")
    op.drop_column("training_records", "prompt_snapshot")
    op.drop_column("training_records", "training_type")
    op.drop_column("cases", "time_limit_minutes")
    op.drop_column("cases", "difficulty")
    op.drop_column("cases", "training_type")
```

- [ ] **Step 3: Update `backend/models/case_practice.py`**

```python
from sqlalchemy.dialects.postgresql import JSONB

class Case(Base, TimestampMixin):
    __tablename__ = "cases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    training_type: Mapped[str] = mapped_column(String(50), default="history_taking")
    difficulty: Mapped[int] = mapped_column(Integer, default=1)
    time_limit_minutes: Mapped[int] = mapped_column(Integer, default=20)
    case_data: Mapped[dict] = mapped_column(JSONB, default=dict)  # Was PydanticJSONB(CaseDataSchema)

    practices: Mapped[list[Practice]] = relationship(back_populates="case")
```

- [ ] **Step 4: Update `backend/models/training.py`**

Remove CHECK constraints from `__table_args__`:

```python
class TrainingRecord(Base):
    __tablename__ = "training_records"
    __table_args__ = (
        Index("ix_tr_user_status", "user_id", "status"),
        Index("ix_tr_status", "status"),
        Index("ix_tr_start_time", "start_time"),
        Index("ix_tr_case_id", "case_id"),
        Index("ix_tr_practice_id", "practice_id"),
        CheckConstraint("status IN ('in_progress', 'completed', 'abandoned')", name="ck_training_records_status"),
        CheckConstraint("scoring_status IN ('pending', 'processing', 'completed', 'failed')", name="ck_training_records_scoring_status"),
        # ck_training_records_current_phase REMOVED
    )
```

Add `training_type`, `prompt_snapshot`, `rubric_snapshot` columns:

```python
class TrainingRecord(Base):
    # ... existing columns ...
    training_type: Mapped[str] = mapped_column(String(50), default="history_taking")
    prompt_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    rubric_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
```

Remove CHECK from Message:

```python
class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_msg_record_created", "record_id", "created_at"),
        Index("ix_msg_role", "role"),
        # ck_messages_role REMOVED
    )
```

- [ ] **Step 5: Update `core/case_schema.py`**

Remove the `PydanticJSONB(CaseDataSchema)` reference — keep `CaseDataSchema` as a class for the `history_taking` profile validator, but it's no longer bound to the column.

Add type-router:

```python
from typing import Any

import logging

log = logging.getLogger(__name__)

_TYPE_VALIDATORS: dict[str, type] = {
    "history_taking": CaseDataSchema,
}


def validate_case_data(training_type: str, data: dict, *, strict: bool = False) -> dict:
    schema_cls = _TYPE_VALIDATORS.get(training_type)
    if schema_cls is None:
        log.warning("No validator for training_type=%s, skipping validation", training_type)
        return data
    try:
        validated = schema_cls(**data)
        return validated.model_dump()
    except Exception as e:
        if strict:
            from core.exceptions import ValidationError
            raise ValidationError(str(e))
        log.warning("case_data validation warning for type=%s: %s", training_type, e)
        return data
```

- [ ] **Step 6: Update `CaseService.create` / `CaseService.update`** in `services/case.py`

Replace `assert_valid_case_data(case_data)` with:

```python
from core.case_schema import validate_case_data

validated = validate_case_data(data.training_type or "history_taking", case_data, strict=True)
```

- [ ] **Step 7: Run migration**

Run: `cd backend && uv run alembic upgrade head`
Expected: Migration runs, all existing data preserved.

- [ ] **Step 8: Run tests**

Run: `cd backend && uv run python -m pytest -x -q`
Expected: All passing.

- [ ] **Step 9: Commit**

```bash
git add backend/alembic/ backend/models/ backend/core/case_schema.py backend/services/case.py
git commit -m "🗃️ db: migrate Case schema — add columns, drop CHECK constraints, type-routed validation"
```

---

### Task 3: Adapter Changes — Route Existing Code Through Profile

**Files:**
- Modify: `backend/contexts/training/router/session.py`
- Modify: `backend/contexts/training/pipeline/builder.py`
- Modify: `backend/contexts/training/pipeline/middleware/prompt_builder.py`
- Modify: `backend/contexts/training/pipeline/middleware/side_effects.py`
- Modify: `backend/contexts/patient/prompt.py`
- Modify: `backend/contexts/training/pipeline/phase.py`
- Modify: `backend/contexts/patient/exam.py` (add `infer_operations`)

- [ ] **Step 1: Update `session.py: _create_record()`**

Replace hardcoded `record.current_phase = "history_taking"` and greeting generation with profile-aware code:

```python
from profiles.registry import get_profile

def _create_record(db, user_id, case, case_data, config, *, ...):
    training_type = case.training_type or "history_taking"
    profile = get_profile(training_type)

    time_limit = case.time_limit_minutes or config.get("behavior", {}).get("time_limit_minutes", 20)

    config["features"] = effective_features(config.get("features") or {}, case_data.get("supported_plugins"))

    record = TrainingRecord(
        user_id=user_id,
        case_id=case.id,
        practice_id=practice_id,
        practice_snapshot=config or None,
        assignment_id=assignment_id,
        is_overdue=is_overdue,
        status="in_progress",
        time_limit=time_limit,
        training_type=training_type,
    )
    record.current_phase = profile.initial_phase
    db.add(record)
    db.flush()

    # Build greeting from profile
    opening_line = case_data.get("opening_line", "")
    patient_info = case_data.get("patient_info", {})
    patient_name = patient_info.get("name", "患者") if patient_info else "患者"
    greeting = f"你好，我是{patient_name}。{opening_line}" if opening_line else f"你好，我是{patient_name}。我今天感觉不太舒服，所以来看看。"

    greeting_msg = Message(record_id=record.id, role="patient", content=greeting)
    db.add(greeting_msg)
    db.commit()
```

- [ ] **Step 2: Update `builder.py` — NoteSources from profile**

```python
from profiles.registry import get_profile

def build_pipeline(training_type: str | None = None) -> tuple[list[Any], Any]:
    # ... existing middleware chain building ...

    # NoteCollector from profile
    from contexts.patient.note_collector import NoteCollector

    collector = NoteCollector()
    pt = training_type or "history_taking"
    try:
        profile = get_profile(pt)
        for src_cls in profile.note_sources:
            collector.add(src_cls())
    except KeyError:
        # Fallback for default
        from contexts.patient.note_source import (
            EmotionNoteSource,
            IdentityGuardSource,
            OperationNoteSource,
        )
        for src_cls in [EmotionNoteSource, IdentityGuardSource, OperationNoteSource]:
            collector.add(src_cls())

    return result, collector
```

Then in `chat.py:_build_context()`, pass `record.training_type` to `get_pipeline()`:

```python
pipe, collector = get_pipeline(training_type=ctx.record.training_type)
```

- [ ] **Step 3: Update `prompt_builder.py` — prompts from profile**

```python
from profiles.registry import get_profile

async def prompt_builder(ctx: PipelineContext, next_mw) -> None:
    # ...
    author_note = ""
    if ctx.note_collector:
        author_note = await ctx.note_collector.collect(ctx)

    training_type = getattr(ctx.record, "training_type", None) or "history_taking"
    profile = get_profile(training_type)

    # Read prompts from profile instead of PromptManager
    system_prompt_template = profile.prompts.system
    dynamic_prompt_template = profile.prompts.dynamic

    # Use string.Template for rendering (prepare for future replacement of {#var#})
    import string
    system_prompt = string.Template(system_prompt_template).safe_substitute(**kwargs) if system_prompt_template else ""
    dynamic_prompt = string.Template(dynamic_prompt_template).safe_substitute(**kwargs) if dynamic_prompt_template else ""

    ctx.llm_messages = build_patient_chat_messages(
        system_prompt,
        dynamic_prompt,
        ctx.messages,
        ctx.student_display or ctx.student_input,
        author_note=author_note,
        max_rounds=profile.max_rounds,
    )
    await next_mw()
```

- [ ] **Step 4: Update `prompt.py` — accept `max_rounds` param**

```python
def build_patient_chat_messages(
    system_prompt: str,
    dynamic_prompt: str,
    history_messages: list,
    student_content: str,
    author_note: str = "",
    max_rounds: int = 8,  # ← parameterized, not hardcoded
) -> list[dict]:
```

- [ ] **Step 5: Update `side_effects.py` — emotion/initiative from profile**

```python
async def side_effects(ctx: PipelineContext, next_mw) -> None:
    await next_mw()
    if ctx.error or ctx.should_shortcut:
        return

    training_type = getattr(ctx.record, "training_type", None) or "history_taking"
    try:
        from profiles.registry import get_profile
        profile = get_profile(training_type)
    except KeyError:
        profile = None

    features = ctx.state.get(STATE_FEATURES) or {}

    if profile and not profile.has_emotion:
        # Skip emotion entirely
        pass
    elif features.get("emotion") and ctx.llm_reply:
        # ... existing emotion code ...

    if profile and not profile.has_initiative:
        pass
    elif features.get("patient_initiative") and ctx.llm_reply:
        # ... existing initiative code ...
```

- [ ] **Step 6: Update `phase.py` — remove `_default_phase`**

```python
def parse_phases(case_data: dict, training_type: str | None = None) -> list[Phase]:
    raw = case_data.get("phases", [])
    if raw:
        return sorted([parse_phase(p) for p in raw], key=lambda p: p.order)
    # Fallback: use profile phases if no custom phases in case_data
    if training_type:
        from profiles.registry import get_profile
        profile = get_profile(training_type)
        return [Phase(**vars(pc)) for pc in profile.phases]
    return [_default_phase(case_data)]  # Keep as compat fallback
```

- [ ] **Step 7: Add `infer_operations` to `exam.py`**

```python
_KNOWN_VITALS = {"temp", "bp", "hr", "rr", "spo2", "skin", "pain"}

def infer_operations(case_data: dict) -> list[str]:
    """从 case_data 的数据推断可用操作，取代显式的 exam_anchors 元数据。"""
    ops = ["chat"]
    physiology = case_data.get("physiology", {})
    if physiology.get("timeline"):
        baseline = physiology["timeline"]["0m"] if "0m" in physiology["timeline"] else next(iter(physiology["timeline"].values()))
        for k in baseline:
            if k in _KNOWN_VITALS:
                ops.append(k)
    if not ops and case_data.get("exam_anchors"):
        ops.extend(["vitals", "bp", "temp", "spo2", "hr", "rr", "skin", "pain"])
    return ops
```

- [ ] **Step 8: Run tests**

Run: `cd backend && uv run python -m pytest tests/training/ tests/core/test_note_collector.py tests/core/test_capabilities.py -x -q`
Expected: All passing.

- [ ] **Step 9: Commit**

```bash
git add backend/contexts/training/ backend/contexts/patient/prompt.py backend/contexts/patient/exam.py
git commit -m "♻️ refactor: route existing code through TrainingProfile adapter layer"
```

---

### Task 4: Self-Review and Final Test

**Files:** None (verification only)

- [ ] **Step 1: Spec coverage check**

From `TODO.md` Batch A checklist:
- [x] TrainingProfile data classes — Task 1
- [x] Registry `get_profile(type)` — Task 1
- [x] history_taking profile — Task 1
- [x] `infer_operations(case_data)` — Task 3
- [x] Case migration (3 columns) — Task 2
- [x] case_data to JSONB — Task 2
- [x] Service layer type validator — Task 2
- [x] Drop CHECK constraints — Task 2
- [x] `_create_record()` from profile — Task 3
- [x] `builder.py` from profile — Task 3
- [x] `side_effects.py` profile-based — Task 3
- [x] `prompt_builder.py` from profile — Task 3
- [x] `prompt.py` max_rounds param — Task 3
- [x] `phase.py` profile phases — Task 3
- [x] Adapter layer — Task 3
- [x] TrainingRecord +training_type — Task 2
- [ ] Full test suite — Step 2 below

- [ ] **Step 2: Run full test suite**

Run: `cd backend && uv run python -m pytest -x -q`
Expected: All tests pass.

Run: `cd backend && uv run ruff check`
Expected: No lint errors.

Run: `cd backend && uv run ty check`
Expected: No type errors.

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors (frontend changes from earlier commits still valid).

Run: `cd frontend && npx biome check`
Expected: No lint errors.

- [ ] **Step 3: Verify the app starts**

Run: `cd backend && uv run python -c "from profiles.registry import get_profile; p = get_profile('history_taking'); print(p.name)"`
Expected: `history_taking`

- [ ] **Step 4: Commit**

```bash
git commit -m "✅ test: Batch A — full test suite verification"
```
