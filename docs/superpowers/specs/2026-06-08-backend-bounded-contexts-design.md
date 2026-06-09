# Backend Bounded Contexts — Design Spec

**Date:** 2026-06-09
**Branch:** `refactor/backend-bounded-contexts`
**Status:** Design

---

## 1. Motivation

The current backend has grown without a consistent organisational paradigm. The
`routers/training/base.py` file alone has grown to 405 lines mixing 7 endpoints,
7 module-level globals, infrastructure plumbing, and business logic. Dependencies
cross layer boundaries in both directions, and the LLM pipeline's interactions
with patient simulation modules are scattered across 13 import sites in 6 files.

This refactoring establishes **bounded contexts** — each domain gathers its own
router, service, and pipeline under one directory. Contexts communicate only
through public facades or shared infrastructure. Every context follows the same
internal naming convention.

### Out of scope

- Splitting `models.py` or `schemas.py` into domain-specific files
- Changing database schema or API contracts
- Splitting auth, cases, questionnaires, admin into contexts (deferred)
- Production deployment

---

## 2. Target Architecture

### 2.1 Directory Structure

```
backend/
├── main.py                        # lifespan + app factory
│
├── core/                          # framework foundation (unchanged)
│   ├── config.py
│   ├── database.py
│   ├── security.py
│   ├── exceptions.py
│   └── dependencies.py
│
├── infrastructure/                # pure technology, zero business logic
│   ├── llm/
│   │   ├── client.py              # LLMClient (call, stream, call_json)
│   │   ├── circuit.py             # retry / backoff
│   │   ├── router.py              # ProfileRouter
│   │   ├── logging.py             # LogWorker
│   │   └── parsing.py             # JSON parsing
│   ├── cache.py                   # EmotionCache, InitiativeCache
│   ├── queue.py                   # TaskQueue
│   └── wechat.py                  # WeChat integration (TODO: move here)
│
├── models.py                      # all ORM models (deferred split)
├── schemas.py                     # all Pydantic models (deferred split)
├── repositories/                  # shared data access
│   ├── base.py                    # SyncRepository
│   └── training.py                # TrainingRepository
│
├── middleware/                     # FastAPI middleware (cross-cutting)
│   ├── dependencies.py            # school filter
│   └── rate_limits.py             # rate limiting
│
├── prompts/                       # LLM prompt templates
│
├── contexts/                       # ★ domain contexts
│   │
│   ├── training/                  # training lifecycle + pipeline
│   │   ├── __init__.py            # exports training_router
│   │   ├── router/
│   │   │   ├── __init__.py
│   │   │   ├── session.py         # start, end, delete
│   │   │   ├── chat.py            # send_message, stream
│   │   │   ├── browse.py          # list, detail, configs
│   │   │   ├── progress.py        # phase advance, state, initiative
│   │   │   ├── scoring.py         # review, submit, retry
│   │   │   └── nursing.py         # nursing record CRUD
│   │   ├── service/
│   │   │   ├── __init__.py
│   │   │   ├── session.py         # create/end/delete logic
│   │   │   ├── settlement.py      # auto-timeout loop (v2)
│   │   │   └── scoring.py         # evaluate_training
│   │   ├── pipeline/
│   │   │   ├── __init__.py
│   │   │   ├── context.py         # PipelineContext dataclass
│   │   │   ├── phase.py           # Phase, parse_phases, try_advance_phase
│   │   │   ├── registry.py        # PIPELINE_REGISTRY
│   │   │   ├── runner.py          # run_pipeline, stream_pipeline
│   │   │   └── middleware/
│   │   │       ├── __init__.py
│   │   │       ├── phase_guard.py
│   │   │       ├── operation_detector.py
│   │   │       ├── operation_executor.py
│   │   │       ├── phase_transition.py
│   │   │       ├── prompt_builder.py
│   │   │       ├── llm_caller.py
│   │   │       ├── persister.py
│   │   │       └── side_effects.py
│   │   └── _patient.py            # private adapter: single entry point to patient context
│   │
│   ├── patient/                   # patient simulation engine
│   │   ├── __init__.py            # public API (16 functions)
│   │   ├── emotion.py             # emotion state machine
│   │   ├── initiative.py          # proactive patient behaviour
│   │   ├── guard.py               # identity leak detection
│   │   ├── exam.py                # physical exam handling
│   │   └── prompt.py              # virtual patient prompt construction
│   │
│   └── qa/                        # Q&A sessions
│       ├── __init__.py            # exports qa_router
│       ├── api.py                 # messages, sessions CRUD
│       └── logic.py               # session management, cache
│
└── shared/                        # modules not yet extracted to contexts
    ├── routers/
    │   ├── auth.py
    │   ├── cases.py
    │   ├── questionnaires/
    │   ├── admin/
    │   └── ... (feedback, stats, notes, export)
    └── services/
        ├── feature_flags.py
        ├── pagination.py
        ├── wechat.py
        ├── prompt/                # prompt manager (shared infrastructure)
        └── llm/                   # legacy LLM sub-modules (being migrated to infrastructure/)
```

### 2.2 Naming Conventions

| Convention | Meaning | Example |
|-----------|---------|---------|
| `router/` or `api.py` | HTTP layer (always) | `training/router/chat.py` |
| `service/` or `logic.py` | Business logic, zero HTTP | `training/service/scoring.py` |
| `pipeline/` | Message processing middleware | `training/pipeline/` |
| `_name.py` | Private/internal module | `training/_patient.py` |
| `contexts/<name>/` | Domain boundary | `contexts/patient/` |
| `infrastructure/` | Pure technology | `infrastructure/llm/client.py` |
| `core/` | Framework foundation | `core/config.py` |

### 2.3 Cross-Context Dependency Rules

```
contexts/training  ──→  contexts/patient     (via _patient.py adapter)
contexts/training  ──→  infrastructure/       (LLMClient, TaskQueue, caches)
contexts/training  ──→  core/                 (config, db, security)
contexts/training  ──→  models, schemas, repositories, prompts
contexts/patient   ──→  prompts/              (only AUTHOR_NOTE_TEMPLATE)
contexts/patient   ──→  nothing else          (stdlib only, zero imports from training)
contexts/qa        ──→  infrastructure/llm    (LLMClient)
contexts/qa        ──→  core, models, schemas

NEVER: patient → training, qa → training, infrastructure → contexts
```

---

## 3. LLM Work Chain Optimisation

### 3.1 Current Chain (scattered across 6 files)

```
prompt_builder.py       → get_emotion + classify_intent + build_context_kwargs
                          + render_prompts + build_chat_messages
                          [imports 4 patient_ai functions]

llm_caller.py           → LLMClient.call/stream → has_identity_leak → retry
                          [lazy imports 2 patient_ai functions]

operation_detector.py   → detect_operation          [imports 1 patient_ai function]
operation_executor.py   → handle_operation           [imports 1 patient_ai function]
side_effects.py         → update_initiative_timer    [imports 1 patient_ai function]
```

### 3.2 Target Chain (single patient adapter)

```
prompt_builder.py
  └── _patient.get_emotion_context(input)  →  returns {emotion, intent, author_note}
  └── _build_template_vars(case_data)      →  returns dict of 10 variables
  └── pm.render(profile, vars)             →  system + dynamic prompts
  └── _assemble_messages(vars, history)    →  final messages array

llm_caller.py
  └── infrastructure.llm.client.call/stream
  └── _patient.check_identity(reply)       →  bool
  └── retry with correction note if leaked   (max 1 retry)

All middleware
  └── _patient.<function>()                 (single import site)
```

### 3.3 Deleted Anti-patterns

| Anti-pattern | Replacement |
|-------------|-------------|
| `infra.py` module-level globals (`_client`, `_router`, `_pm`, `_log_worker`) | Already deleted; `LLMClient` from `infrastructure/llm/client.py` |
| `set_training_infra()` / `_get_client()` etc. in `base.py` | `Depends(get_llm_client)` from `core/dependencies.py` |
| `_schedule_background()` with `asyncio.run_coroutine_threadsafe` | `TaskQueue.enqueue()` from `infrastructure/queue.py` |
| `_scoring_pending` + `threading.Lock` | `TaskQueue` natural bounded capacity |
| `settlement.py` accessing `_emotion_cache` / `_initiative_timers` private variables | Inject `EmotionCache` / `InitiativeCache` from `infrastructure/cache.py` |
| Lazy imports in `llm_caller.py` for patient_guard | Move identity check out of llm_caller, call through `_patient.py` |
| `ctx.app_state: Any` | Replace with typed dependencies passed via `PipelineContext` |

---

## 4. File Mapping (Source → Target)

### 4.1 Patient Context (6 source files → 6 target files)

| Source | Target |
|--------|--------|
| `services/patient_ai/emotion_engine.py` | `contexts/patient/emotion.py` |
| `services/patient_ai/patient_initiative.py` | `contexts/patient/initiative.py` |
| `services/patient_ai/patient_guard.py` | `contexts/patient/guard.py` |
| `services/patient_ai/exam_handler.py` | `contexts/patient/exam.py` |
| `services/patient_ai/virtual_patient_prompt.py` | `contexts/patient/prompt.py` |
| `services/patient_ai/__init__.py` | `contexts/patient/__init__.py` |

Internal imports: zero changes (all within same directory, relative imports).
External imports: 1 line (`prompts.patient_chat` → unchanged, shared module).

### 4.2 Training Context (29 source files → 29 target files)

| Source | Target |
|--------|--------|
| `routers/chat.py` | `contexts/training/router/chat.py` |
| `routers/nursing_records.py` | `contexts/training/router/nursing.py` |
| `routers/training/base.py` | Split into 4 router files |
| `routers/training/scoring.py` | `contexts/training/router/scoring.py` |
| `routers/training/phases.py` | `contexts/training/router/progress.py` |
| `routers/training/config.py` | `contexts/training/router/browse.py` (merged) |
| `services/training/session.py` | `contexts/training/service/session.py` |
| `services/training/settlement_v2.py` | `contexts/training/service/settlement.py` |
| `services/training/__init__.py` | merged into `contexts/training/service/__init__.py` |
| `services/scoring/engine.py` | `contexts/training/service/scoring.py` |
| `services/scoring/rubric.py` | `contexts/training/service/scoring.py` (merged) |
| `services/scoring/validation.py` | `contexts/training/service/scoring.py` (merged) |
| `services/scoring/__init__.py` | merged into `contexts/training/service/__init__.py` |
| `services/pipeline/` (15 files) | `contexts/training/pipeline/` (15 files) |

### 4.3 QA Context (5 source files → 3 target files)

| Source | Target |
|--------|--------|
| `routers/qa/__init__.py` | merged into `contexts/qa/__init__.py` |
| `routers/qa/messages.py` | `contexts/qa/api.py` (merged) |
| `routers/qa/sessions.py` | `contexts/qa/api.py` (merged) |
| `services/qa/cache.py` | `contexts/qa/logic.py` (merged) |
| `services/qa/__init__.py` | merged into `contexts/qa/__init__.py` |

### 4.4 Deleted Files

| File | Reason |
|------|--------|
| `services/patient_ai/` (entire directory) | Moved to `contexts/patient/` |
| `services/pipeline/` (entire directory) | Moved to `contexts/training/pipeline/` |
| `services/scoring/` (entire directory) | Merged into `contexts/training/service/scoring.py` |
| `services/training/settlement.py` (V1) | Dead code; V2 replaces it |
| `services/training/session.py` | Moved to `contexts/training/service/session.py` |
| `services/training/settlement_v2.py` | Moved to `contexts/training/service/settlement.py` |
| `services/qa/` (entire directory) | Moved to `contexts/qa/logic.py` |
| `routers/training/` (entire directory) | Moved to `contexts/training/router/` |
| `routers/chat.py` | Moved to `contexts/training/router/chat.py` |
| `routers/nursing_records.py` | Moved to `contexts/training/router/nursing.py` |
| `routers/qa/` (entire directory) | Moved to `contexts/qa/api.py` |

### 4.5 Unchanged

| Area | Reason |
|------|--------|
| `core/` | Already clean |
| `infrastructure/` | Already clean; `infrastructure/__init__.py` gets re-export additions |
| `models.py` | Deferred split |
| `schemas.py` | Deferred split |
| `repositories/` | Already correctly layered |
| `prompts/` | Already isolated |
| `middleware/` | Cross-cutting by nature |
| `shared/routers/auth.py, cases.py, admin/, etc.` | Deferred to future contexts |
| `main.py` | Only import paths change; lifespan logic unchanged |
| `migrations/` | Unchanged |
| Frontend / Miniprogram | Unchanged |
| `openapi.json` | Unchanged (endpoint paths unchanged) |

---

## 5. Migration Phases

### Phase 0: Settlement V1 removal (prerequisite)
- Delete `services/training/settlement.py` (V1, 171 lines of dead code)
- Verify `settlement_v2` is the only settlement running in `main.py` lifespan

### Phase 1: Patient context extraction
- Create `contexts/patient/` with 6 files
- Update 13 import sites in training to use `contexts.patient` (via `_patient.py`)
- Run patient-related tests

### Phase 2: Training context extraction
- Create `contexts/training/` directory tree
- Move pipeline (15 files), scoring engine, settlement, session
- Split `base.py` into `router/session.py`, `router/browse.py`, `router/scoring.py`
- Move `chat.py`, `nursing_records.py`, `phases.py`, `config.py` into `router/`
- Eliminate module-level globals (`_scoring_pending`, `_infra_*`, `_schedule_background`)
- Wire `TaskQueue.enqueue()` for scoring dispatch
- Create `_patient.py` adapter

### Phase 3: QA context extraction
- Create `contexts/qa/` with `api.py` + `logic.py`
- Merge `routers/qa/` + `services/qa/` → `contexts/qa/`

### Phase 4: Wire-up in main.py
- Update all import paths in `main.py`
- Register routers from new context locations
- Run full test suite and fix regressions

---

## 6. Deleted Anti-patterns (Summary)

| Anti-pattern | Location | Replacement |
|-------------|----------|-------------|
| `_scoring_pending` + `threading.Lock` | `base.py:38-39` | `TaskQueue` bounded capacity |
| `_infra_client`, `_infra_router`, `_infra_pm`, `_infra_log_worker`, `_main_loop` module globals | `base.py:55-59` | `Depends()` from `core/dependencies.py` |
| `set_training_infra()` / `_get_client()` etc. | `base.py:71-100` | Deleted; use `request.app.state.xxx` or `Depends` |
| `_schedule_background()` | `base.py:103-109` | `TaskQueue.enqueue()` |
| `_run_scoring_background` manual `SessionLocal` | `scoring.py:30-82` | `TrainingRepository` + injected deps |
| Lazy imports for `patient_guard` | `llm_caller.py` | `_patient.check_identity()` |
| `settlement.py` imports `_emotion_cache` / `_initiative_timers` | `settlement.py` | `EmotionCache` / `InitiativeCache` injection |

---

## 7. Open Questions

1. **Should `services/prompt/` move into `infrastructure/`?** The prompt manager (`PromptManager`) is pure infrastructure (template storage + rendering). It could logically live in `infrastructure/prompt/`. Deferred — treat as shared for now.

2. **QA context future features?** QA is expected to grow (question banks, multi-turn follow-ups, answer scoring). The current simple structure (`api.py` + `logic.py`) can evolve into `router/` + `service/` at that point.

3. **When to split models.py and schemas.py?** Deferred until at least one more context is extracted from `shared/`. At that point the one-file model becomes painful enough to justify.

4. **Should nursing records be a separate context?** Currently 97 lines in one router file. Not enough mass to justify a context. Revisit when nursing record gets pipeline integration, scoring, and teacher review features.
