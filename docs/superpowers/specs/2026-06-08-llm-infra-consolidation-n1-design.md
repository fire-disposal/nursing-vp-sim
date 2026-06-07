# LLM Infrastructure Consolidation & N+1 Query Elimination Design

**Date**: 2026-06-08  
**Status**: Design  
**Author**: Tech Lead

---

## 1. Motivation

Two architectural problems inherited from the prototype phase:

1. **Scoring runs as a script-style background task** — each scoring invocation creates a new OS thread, a new asyncio event loop, and four new infrastructure objects (`ProfileRouter`, `PromptManager`, `httpx.AsyncClient`, `LogWorker`). Circuit-breaker state diverges between chat and scoring paths.

2. **7 N+1 query patterns across the backend** — loops executing per-item database queries instead of using batch aggregation or eager loading. Worst case: `class_summary` runs 4 queries per class.

**Goal:** Eliminate infrastructure duplication in scoring, unify all LLM operations under a single infrastructure layer, and remove all N+1 query patterns.

---

## 2. Part A — Scoring Infrastructure Consolidation

### 2.1 Architecture

```
                ┌──────────────────────────────────┐
                │       App Startup (Lifespan)      │
                │                                   │
                │  httpx_client = AsyncClient()     │
                │  prompt_manager = PromptManager() │
                │  profile_router = ProfileRouter() │
                │  log_worker = LogWorker()         │
                └──────────┬───────────────────────┘
                           │ module-level references
                           ▼
    ┌──────────────────────────────────────────────────┐
    │                                                  │
    ▼                                                  ▼
┌─────────────┐  chat pipeline    ┌──────────────────────┐
│  Chat API   │ ────────────────→ │  llm_caller.py       │
│  (requests) │                   │  (app.state.*)       │
└─────────────┘                   └──────────────────────┘

┌─────────────┐  asyncio task     ┌──────────────────────┐
│  Scoring    │ ────────────────→ │  _run_scoring_bg()   │
│  (end/retry)│                   │  (shared infra refs) │
└─────────────┘                   └──────────────────────┘

┌─────────────┐  asyncio task     ┌──────────────────────┐
│  Settlement │ ────────────────→ │  _cleanup_once()     │
│  (lifespan) │                   │  (shared infra refs) │
└─────────────┘                   └──────────────────────┘
```

### 2.2 Key Changes

**`_run_scoring_background`** — `def` → `async def`, accepts shared infrastructure:

```python
async def _run_scoring_background(
    record_id: int,
    case_data: dict,
    client: httpx.AsyncClient,
    router: ProfileRouter,
    pm: PromptManager,
    log_worker: LogWorker,
):
    db = SessionLocal()
    try:
        await evaluate_training(
            record_id, case_data, db,
            pm=pm, router=router, log_worker=log_worker, client=client,
        )
    finally:
        db.close()
```

**Trigger changes:**

| Trigger | Before | After |
|---------|--------|-------|
| `end_training` | `BackgroundTasks.add_task(sync fn)` | `asyncio.create_task(async fn)` |
| `retry-scoring` | same | same |
| `settlement` | `threading.Thread(target=fn, daemon=True)` | `asyncio.create_task(fn)` in lifespan |

**`settlement.py`** — `run_cleanup_loop()` becomes `async def`, started as `asyncio.create_task()` in app lifespan. Eliminates the script-level `threading.Thread + asyncio.run()` at module bottom.

**`chat.py` streaming endpoint** — fix session lifecycle: stream endpoint already uses `SessionLocal()` directly. The `try/except` gap (no `finally` close on normal completion) is fixed.

### 2.3 Benefits

- **Unified circuit breaker**: Chat and scoring share the same `ProfileRouter` instance. A degraded provider is degraded for both.
- **Connection pool reuse**: Single `httpx.AsyncClient` with `max_connections=60` serves all LLM requests.
- **No infrastructure duplication**: `PromptManager` and `ProfileRouter` loaded from DB once at startup, not per scoring task.
- **Proper asyncio**: No more `threading.Thread` + `asyncio.run()` hack. Everything runs on the app event loop.

### 2.4 Files Changed

| File | Change |
|------|--------|
| `routers/training.py` | Rewrite `_run_scoring_background` as async; change trigger from BackgroundTasks to asyncio.create_task |
| `services/training/settlement.py` | Rewrite loop as async; move startup to lifespan |
| `routers/chat.py` | Fix stream endpoint session close |
| `main.py` | Lifespan: start settlement task, pass shared infra |
| `core/database.py` | Expose engine/session for shared access |
| New: `services/llm/infra.py` | Module-level refs to shared LLM infrastructure |

---

## 3. Part B — N+1 Query Elimination

### 3.1 Fix Pattern A: Loop Aggregation → GROUP BY

**`stats.py:class_summary()`** (4 queries per class):

Replace per-class aggregate loop with single GROUP BY query:

```python
stats = (
    db.query(
        Class.id,
        func.count(func.distinct(UserClass.user_id)).label("student_count"),
        func.count(TrainingRecord.id).label("total_sessions"),
        func.coalesce(func.sum(func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60), 0).label("total_minutes"),
        func.avg(Score.total_score).label("avg_score"),
    )
    .outerjoin(UserClass, UserClass.class_id == Class.id)
    .outerjoin(TrainingRecord, (TrainingRecord.user_id == UserClass.user_id) & (TrainingRecord.status == "completed"))
    .outerjoin(Score, Score.record_id == TrainingRecord.id)
    .filter(Class.id.in_(class_ids))
    .group_by(Class.id)
    .all()
)
```

**`admin_roles.py:list_roles()`** (2 queries per role):

Batch-load permissions and user counts upfront:

```python
role_ids = [r.id for r in roles]

# One query for all permissions
all_perms = db.query(RolePermission).filter(RolePermission.role_id.in_(role_ids)).all()

# One query for all user counts
counts = dict(
    db.query(User.role_id, func.count(User.id))
    .filter(User.role_id.in_(role_ids))
    .group_by(User.role_id).all()
)
```

**`questionnaires.py:response_stats()`** (1 query per question):

```python
# One query for all answers
all_answers = (
    db.query(QuestionnaireAnswer.question_id, QuestionnaireAnswer.answer_value)
    .filter(
        QuestionnaireAnswer.question_id.in_(question_ids),
        QuestionnaireAnswer.response_id.in_(response_ids),
    )
    .all()
)
# Group in Python by question_id
```

**`settlement.py:_cleanup_once()`** (2 queries per timeout record):

Batch-load cases upfront:
```python
case_ids = [r.case_id for r in timeout_records]
cases = {c.id: c for c in db.query(Case).filter(Case.id.in_(case_ids)).all()}
```

### 3.2 Fix Pattern B: Lazy Loading → Eager Loading

**`questionnaires.py:export_responses()`** (1 lazy load per response):

```python
resp_query = (
    db.query(QuestionnaireResponse)
    .options(
        joinedload(QuestionnaireResponse.user),
        joinedload(QuestionnaireResponse.answers)
            .joinedload(QuestionnaireAnswer.question),
    )
    .filter(...)
)
```

**`questionnaires.py:_build_response_item()`** (2 queries per response):

Replace per-response answer/question queries with a pre-loaded lookup map:

```python
all_answers = db.query(QuestionnaireAnswer).filter(
    QuestionnaireAnswer.response_id.in_([r.id for r in responses])
).all()
all_questions = db.query(QuestionnaireQuestion).filter(
    QuestionnaireQuestion.template_id.in_(template_ids)
).all()
# Build lookup dicts, pass to _build_response_item as cached data
```

**`training.py:get_record_detail()`** (6 separate queries, including duplicate user query):

```python
record = (
    db.query(TrainingRecord)
    .options(
        joinedload(TrainingRecord.case),
        joinedload(TrainingRecord.user),
        joinedload(TrainingRecord.score),
        joinedload(TrainingRecord.messages).load_only(Message.id),
    )
    .filter(TrainingRecord.id == record_id)
    .first()
)
# Notes still loaded separately (different ordering)
note_records = db.query(Note).filter(Note.record_id == record_id).order_by(Note.updated_at.desc()).all()
```

Eliminate redundant user query (line 382 duplicate of line 377).

### 3.3 Summary of Changes

| File | N+1 # | Fix Pattern | Expected Impact |
|------|-------|-------------|-----------------|
| `stats.py` | #5 | GROUP BY | 4C queries → 1 query |
| `admin_roles.py` | #1 | Batch in_() | 2N+1 queries → 3 queries |
| `questionnaires.py` (response_stats) | #3 | Batch in_() | N queries → 1 query |
| `questionnaires.py` (export) | #4 | joinedload | N queries → 1 query |
| `questionnaires.py` (_build_response_item) | #2 | Pre-loaded maps | 2N queries → 2 queries |
| `settlement.py` | #6 | Batch in_() | T queries → 1 query |
| `training.py` (detail) | #7 | joinedload | 6 queries → 2 queries |

---

## 4. Backward Compatibility

- All API endpoint signatures unchanged
- Response schemas unchanged
- Scoring semantics unchanged (same two-stage pipeline with same parameters)
- Settlement behavior unchanged (same cleanup logic, same auto-score thresholds)
- Database: no migration needed

---

## 5. Success Criteria

1. Scoring uses shared `ProfileRouter` — circuit breaker state unified with chat
2. No `threading.Thread` or `asyncio.run()` in scoring or settlement paths
3. All 7 N+1 locations reduced to single-digit query counts
4. Existing tests pass (especially `test_training.py`, `test_scoring.py`, `test_auto_settlement.py`)
5. `ruff check` clean
