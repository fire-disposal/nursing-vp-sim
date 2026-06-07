# Training Pipeline Refactor — Phase + Middleware Architecture

**Date**: 2026-06-07  
**Status**: Design  
**Author**: Tech Lead

---

## 1. Motivation

The training message processing flow is hardcoded in `chat.py` (356 lines) with ~90% duplication between streaming and non-streaming endpoints. Adding new training features (clinical judgment, abnormal sign recognition, care planning) requires surgery on core code. The training lifecycle (Start → Chat → End → Score) is rigid with no support for intermediate phases.

**Goal**: Refactor into a composable pipeline architecture where:
- Message processing is a chain of pluggable middleware
- Training lifecycle is managed by a Phase state machine
- New features can be added as self-contained middleware modules without touching core code

---

## 2. Architecture Overview

### 2.1 Two-Layer Design

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: Phase State Machine (Training Lifecycle)  │
│                                                     │
│  history_taking → physical_exam → clinical_judgment │
│       → care_planning → [End → Score]               │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│  Layer 2: Message Pipeline (Per-Message Processing) │
│                                                     │
│  Input → PhaseGuard → OpDetect → OpExec →           │
│  PhaseTrans → PromptBuild → LLMCall →               │
│  IdentityGuard → Persist → SideEffects → Output     │
└─────────────────────────────────────────────────────┘
```

### 2.2 Key Principle

- **Streaming and non-streaming share the same pipeline.** The only difference is `LLMCall` middleware's output mechanism.
- **Middleware can short-circuit.** An operation match skips LLM call and returns system message directly.
- **Pipeline composition is per-Phase.** Different phases use different middleware chains.

---

## 3. Phase Definition

### 3.1 Storage

Phases are stored in `case_data.phases` (JSONB). If absent, a default single-phase `history_taking` is inferred — fully backward compatible.

### 3.2 Schema

```json
{
  "id": "history_taking",
  "name": "问诊",
  "description": "采集患者病史、症状和基本信息",
  "order": 1,
  "operations": ["chat"],
  "prompt_profile": "patient_chat",
  "scoring_dimensions": ["沟通技能", "病史采集"],
  "transition": {
    "auto": false,
    "manual_label": "进入体格检查",
    "min_messages": 5
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique phase identifier |
| `name` | string | Display name |
| `description` | string | Phase purpose |
| `order` | int | Sequence position |
| `operations` | string[] | Allowed operation types in this phase |
| `prompt_profile` | string | LLM prompt profile to use |
| `scoring_dimensions` | string[] | Scoring dimensions evaluated in this phase |
| `transition` | object | Phase advancement rules |
| `transition.auto` | bool | Auto-advance after conditions met |
| `transition.manual_label` | string | Button label for manual advance |
| `transition.min_messages` | int | Min messages before advance allowed |
| `transition.min_operations` | int | Min operations before advance allowed |
| `transition.auto_after_messages` | int | Auto-advance after N messages |

### 3.3 Current Phase Tracking

`TrainingRecord` gains a `current_phase` column (nullable String, default `"history_taking"`). This persists across requests so phase state survives page reloads.

### 3.4 Phase Transition

```python
def try_advance_phase(ctx: PipelineContext) -> Phase | None:
    """Check if conditions for phase transition are met."""
    phase = ctx.current_phase
    t = phase.transition

    if not t.auto and not ctx.manual_advance_requested:
        return None

    if t.min_messages and len(ctx.messages) < t.min_messages:
        return None
    if t.min_operations and ctx.phase_operation_count < t.min_operations:
        return None

    # Advance to next phase
    next_order = phase.order + 1
    return get_phase_by_order(ctx.case_data.phases, next_order)
```

`POST /api/training/{record_id}/advance-phase` — manual advance endpoint.

---

## 4. Pipeline Context

```python
@dataclass
class PipelineContext:
    # ── request-scoped ──
    record: TrainingRecord
    case_data: dict
    current_user: User
    db: Session
    app_state: Any                    # access to prompt_manager, httpx_client, etc.

    # ── message flow ──
    student_input: str                # raw input from student
    student_display: str              # text passed to LLM (may differ from input)
    messages: list[Message]           # history messages (from DB)

    # ── phase ──
    current_phase: Phase
    phase_index: int
    manual_advance_requested: bool
    phase_operation_count: int

    # ── operation ──
    operation: OperationResult | None
    system_events: list[dict]         # accumulated system events for frontend

    # ── LLM ──
    llm_messages: list[dict] | None
    llm_reply: str | None

    # ── control ──
    should_shortcut: bool             # skip remaining middleware
    state: dict                       # free-form middleware communication
    error: str | None                 # error message if pipeline fails
```

---

## 5. Middleware Interface

```python
PipelineMiddleware = Callable[
    [PipelineContext, Callable[[], Awaitable[None]]],
    Awaitable[None]
]
```

A middleware:
1. Inspects/modifies `ctx`
2. Either calls `await next()` to continue, or returns (short-circuit)
3. Must not mutate `ctx` after `await next()` if downstream depends on it

### 5.1 Middleware Catalog

| Middleware | Phase(s) | Description |
|-----------|----------|-------------|
| `phase_guard` | all | Reject operations not allowed in current phase |
| `operation_detector` | all | Detect slash commands (/vitals, /bp, etc.) |
| `operation_executor` | all | Execute operation via `exam_handler.handle_operation()` |
| `phase_transition` | all | Check if operation triggers phase advance |
| `prompt_builder` | all | Build LLM messages array |
| `llm_caller` | all | Call LLM (streaming or batch) |
| `identity_guard` | all | Detect identity leak, retry with correction |
| `persister` | all | Save student+patient messages to DB |
| `side_effects` | all | Update emotion, initiative timer, topics |

Future middleware (not in this PR):
- `abnormality_checker` — flag unrecognized abnormal vital signs
- `judgment_collector` — collect student clinical judgments
- `decision_recorder` — record intervention decisions

### 5.2 Pipeline Runner

```python
async def run_pipeline(ctx: PipelineContext, middlewares: list[PipelineMiddleware]):
    """Execute middleware chain with short-circuit support."""
    index = 0

    async def next_mw():
        nonlocal index
        if ctx.should_shortcut:
            return
        if index < len(middlewares):
            mw = middlewares[index]
            index += 1
            await mw(ctx, next_mw)

    await next_mw()
```

### 5.3 Per-Phase Pipeline Assembly

```python
PIPELINE_REGISTRY: dict[str, list[PipelineMiddleware]] = {
    "history_taking": [
        phase_guard,
        operation_detector,
        operation_executor,
        phase_transition,
        prompt_builder,
        llm_caller,
        identity_guard,
        persister,
        side_effects,
    ],
    "physical_exam": [
        phase_guard,
        operation_detector,
        operation_executor,
        phase_transition,
        prompt_builder,
        llm_caller,
        identity_guard,
        persister,
        side_effects,
    ],
    # Future phases extend this registry
}
```

---

## 6. Router Changes

### 6.1 `chat.py` — Simplified

```python
@router.post("/{record_id}/message", response_model=ChatMessageResponse)
async def send_message(record_id, req, request, current_user, db):
    ctx = await build_context(record_id, req, current_user, db, request)
    await run_pipeline(ctx, get_pipeline(ctx.current_phase.id))
    return ChatMessageResponse(role="patient", content=ctx.llm_reply)

@router.post("/{record_id}/message/stream")
async def send_message_stream(record_id, req, request, current_user):
    ctx = await build_context(record_id, req, current_user, db=None, request=request, stream_mode=True)
    return StreamingResponse(
        stream_pipeline(ctx, get_pipeline(ctx.current_phase.id)),
        media_type="text/event-stream"
    )
```

Single `build_context()` replaces duplicated validation logic (record existence, ownership, status, rate limit, case_data loading).

### 6.2 `training.py` — New Endpoint

```python
@router.post("/{record_id}/advance-phase")
def advance_phase(record_id, current_user, db):
    """Student manually advances to next training phase."""
    # Validates: ownership, in_progress, transition conditions
    # Moves current_phase to next phase
    # Returns new phase info
```

---

## 7. Module Layout

```
backend/
├── services/
│   └── pipeline/
│       ├── __init__.py            # exports: run_pipeline, PipelineContext
│       ├── context.py             # PipelineContext definition + build_context()
│       ├── runner.py              # run_pipeline() implementation
│       ├── registry.py            # PIPELINE_REGISTRY + get_pipeline()
│       ├── phase.py               # Phase definition, try_advance_phase(), get_phase_by_order()
│       └── middleware/
│           ├── __init__.py
│           ├── phase_guard.py
│           ├── operation_detector.py
│           ├── operation_executor.py
│           ├── phase_transition.py
│           ├── prompt_builder.py
│           ├── llm_caller.py
│           ├── identity_guard.py
│           ├── persister.py
│           └── side_effects.py
```

---

## 8. Migration & Rollback

### 8.1 Database

```sql
ALTER TABLE training_records ADD COLUMN current_phase VARCHAR(50) DEFAULT 'history_taking';
```

Existing records with `status='completed'` get `current_phase = NULL` or remain at default (no impact — they're read-only).

### 8.2 Backward Compatibility

- Any case without `phases` in `case_data` auto-generates a single `history_taking` phase
- API response format unchanged — frontend zero migration
- All existing tests must pass before merge

### 8.3 Rollback

- Revert `chat.py` to previous version
- Remove `services/pipeline/`
- `current_phase` column can be dropped or ignored

---

## 9. Success Criteria

1. `chat.py` reduces from 356 to ~100 lines
2. Streaming and non-streaming endpoints share identical pipeline logic
3. Adding a new middleware requires only: create file in `middleware/`, register in `registry.py`
4. Adding a new phase requires only: add entry to `case_data.phases`, register pipeline in `PIPELINE_REGISTRY`
5. All existing training flows (start, message, stream, end, score, retry) work identically
6. Existing test suite passes
