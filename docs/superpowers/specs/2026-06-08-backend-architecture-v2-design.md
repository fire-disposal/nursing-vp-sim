# Backend Architecture v2 — Design Spec

**Date:** 2026-06-08
**Branch:** `refactor/backend-architecture-v2`
**Status:** Design

---

## 1. Motivation

The current backend has accumulated architectural debt that makes ongoing development
fragile and unpredictable. Two root problems dominate:

1. **No clear architecture paradigm.** Dependencies cross layer boundaries in both
   directions (services import routers, routers import services). Inline imports
   (92 instances across 20 files) mask circular dependencies rather than resolving
   them. All ORM models live in one file; all schemas in another.

2. **Dangerous sync/async mixing.** Background scoring runs through
   `asyncio.run_coroutine_threadsafe` from threadpool threads to a separately-captured
   event loop. A threading semaphore bridges what should be a single async semaphore.
   Synchronous functions call `asyncio.create_task()` relying on implicit loop context.
   Six module-level global variables in `infra.py` act as a poor-man's DI container.

The system is not yet in production use. This is the right moment to establish a
clean foundation before scaling.

### Out of scope for this design

Models (models.py) and schemas (schemas.py) split into domain-specific files is
deferred — the user has explicitly exempted these.

---

## 2. Target Architecture

### 2.1 Layer Model

```
┌──────────────────────────────────────────────────┐
│  routers/     HTTP layer (thin)                   │
│  - Parameter validation (Pydantic)                │
│  - Auth/permission checks (Depends)               │
│  - Call service → return response                 │
│  ↓ one-way dependency                             │
├──────────────────────────────────────────────────┤
│  services/    Application layer (orchestration)   │
│  - Business process orchestration                 │
│  - Transaction boundaries                         │
│  - Obtains repositories via Depends               │
│  ↓ one-way dependency                             │
├──────────────────────────────────────────────────┤
│  repositories/   Data access layer                │
│  - SQLAlchemy query encapsulation                 │
│  - Executed via asyncio.to_thread                  │
│  - Returns domain objects, not ORM objects        │
│  ↓ one-way dependency                             │
├──────────────────────────────────────────────────┤
│  models/   ORM mappings                           │
│  - One model per file (eventually)                │
│  - Zero business logic                            │
└──────────────────────────────────────────────────┘

Lateral (no I/O dependencies):
├── domain/          Pure functions, zero I/O, zero ORM
├── infrastructure/  External integrations (LLM, WeChat, task queue)
├── prompts/         Prompt templates
└── schemas/         Pydantic models, split by domain
```

**Iron rules:**
- Dependency direction: routers → services → repositories → models. Never reverse.
- `domain/` imports nothing with I/O.
- `infrastructure/` imports nothing from `routers/` or `services/`.
- No module-level mutable state. Everything through FastAPI `Depends` or constructor injection.

### 2.2 Single Event Loop

All code runs on exactly one asyncio event loop:

```
┌──────────────────────────────────────────────────────────┐
│                  Single event loop                        │
│                                                          │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────────┐  │
│  │ FastAPI   │  │ Background│  │ TaskQueue             │  │
│  │ request   │  │ Tasks     │  │ (asyncio.Queue +      │  │
│  │ handlers  │  │ (settle,  │  │  worker coroutines)   │  │
│  │ (async)   │  │ log work) │  │                       │  │
│  └──────────┘  └───────────┘  │  scoring_job ──→ w0    │  │
│                                │  cleanup_job ──→ w1    │  │
│  ┌──────────┐                  └──────────────────────┘  │
│  │ Depends  │                                            │
│  │ inject   │──→ All services receive deps via            │
│  │ app.state│    constructor. No module globals.          │
│  └──────────┘                                            │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │  DB access: unified asyncio.to_thread              │    │
│  │  (dedicated, large thread pool)                   │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

All FastAPI endpoints become `async def`. All background work goes through
`TaskQueue.enqueue()`. No `asyncio.run()` outside `main.py` entry point.

---

## 3. Core Components

### 3.1 LLMClient — Unified LLM Calling

Replaces the current `services/llm/service.py` (423 lines, two heavily duplicated
functions `call_llm` / `call_llm_stream`).

```python
class LLMClient:
    """Unified LLM entry point. Retry, rate-limiting, and logging
    are all handled in this layer."""

    def __init__(
        self,
        http: httpx.AsyncClient,
        router: ProfileRouter,
        log_worker: LogWorker,
        concurrency: int = 50,
    ):
        self._http = http
        self._router = router
        self._log = log_worker
        self._sem = asyncio.Semaphore(concurrency)

    async def call(
        self,
        messages: list[dict],
        *,
        purpose: str,
        temperature: float = 0.7,
        max_tokens: int = 512,
        timeout: int = 30,
        max_retries: int = 2,
        response_format: dict | None = None,
        ctx: CallContext | None = None,
    ) -> str: ...

    async def stream(
        self,
        messages: list[dict],
        *,
        purpose: str,
        temperature: float = 0.7,
        max_tokens: int = 512,
        timeout: int = 30,
        max_retries: int = 2,
        ctx: CallContext | None = None,
    ) -> AsyncIterator[str]: ...

    async def call_json(self, **kwargs) -> dict:
        """call() + safe JSON parse."""
```

**Key changes from current:**
- `asyncio.Semaphore` replaces `threading.Semaphore` + `asyncio.to_thread` wrapper.
  Single event loop makes this safe.
- Shared `_retry(fn, max_retries)` private method handles all retry logic including
  `_RETRYABLE_STATUSES`, `_RETRYABLE_EXCEPTIONS`, and exponential backoff. Eliminates
  off-by-one bugs (current stream code has 5 incorrect guard expressions).
- `NoProviderAvailable` exception replaces `if "可用" in str(e)` Chinese string matching.
- `_CallContext` decoupled from `LLMClient` — passed as optional parameter, used
  only for logging metadata.
- `stream()` supports `response_format` (formerly absent).
- `full_reply` accumulator reset between retry attempts (current bug: accumulated
  duplicates on retry).
- Non-retryable HTTP errors (400, 401) propagate immediately in both `call` and
  `stream` (current: stream retries them, call raises immediately — inconsistent).

### 3.2 TaskQueue — Bounded Background Worker Pool

Replaces scattered `asyncio.create_task()` and `schedule_background()`
(`run_coroutine_threadsafe`).

```python
@dataclass(order=True)
class _Task:
    priority: int
    coro_factory: Callable[[], Awaitable[T]] = field(compare=False)
    future: asyncio.Future = field(compare=False)


class TaskQueue:
    """Bounded priority task queue. Single-event-loop only."""

    def __init__(self, max_workers: int = 3, max_size: int = 100):
        self._queue: asyncio.PriorityQueue[_Task] = asyncio.PriorityQueue(maxsize=max_size)
        self._max_workers = max_workers
        self._workers: list[asyncio.Task] = []

    async def start(self) -> None:
        for i in range(self._max_workers):
            self._workers.append(
                asyncio.create_task(self._worker(i), name=f"bg-worker-{i}")
            )

    async def stop(self) -> None:
        for w in self._workers:
            w.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)

    async def enqueue(
        self,
        coro_factory: Callable[[], Awaitable[T]],
        *,
        priority: int = 0,
    ) -> asyncio.Future[T]:
        """Enqueue a task factory. Returns a Future the caller may await."""
        future: asyncio.Future[T] = asyncio.get_running_loop().create_future()
        await self._queue.put(_Task(priority=priority, coro_factory=coro_factory, future=future))
        return future

    async def _worker(self, wid: int) -> None:
        while True:
            task = await self._queue.get()
            try:
                result = await task.coro_factory()
                if not task.future.done():
                    task.future.set_result(result)
            except Exception as exc:
                if not task.future.done():
                    task.future.set_exception(exc)
            finally:
                self._queue.task_done()
```

**Design decisions:**
- `coro_factory` (callable) not coroutine — defers creation until a worker picks
  up the task, preventing premature execution.
- Returns `Future` — caller may `await future` for result, or fire-and-forget.
- `PriorityQueue` — scoring tasks use lower priority than user-facing tasks.
- `max_size=100` — `put()` blocks when full, providing natural backpressure.
  Prevents the "100 simultaneous timeouts = 100 scoring coroutines" problem.

**Usage replaces current `schedule_background()`:**

```python
# In end_training router:
future = await task_queue.enqueue(
    lambda: scoring_service.evaluate(record_id),
    priority=5,
)
# Fire-and-forget: scoring reports result via scoring_status field.
```

### 3.3 Settlement Loop — Pure Async

Current: `run_cleanup_loop()` (async) calls `_cleanup_once()` (sync, blocks event
loop with DB queries, calls `asyncio.create_task` from sync context).

New: fully async, DB access via repository + `to_thread`, scoring via `TaskQueue`.

```python
async def settlement_loop(
    repo: TrainingRepository,
    task_queue: TaskQueue,
    interval: int = 30,
) -> None:
    while True:
        await asyncio.sleep(interval)
        timeout_records = await repo.find_timeout_records()
        for record in timeout_records:
            await repo.mark_completed(record.id)
            await task_queue.enqueue(
                lambda rid=record.id: scoring_service.evaluate(rid),
                priority=5,
            )
```

### 3.4 Caches as Injectable Instances

Current: module-level `dict` caches (`_emotion_cache`, `_initiative_timers` in
`services/patient_ai/`), accessed across modules via private variable imports.

```python
# services/training/settlement.py
from services.patient_ai.emotion_engine import _emotion_cache  # private!
from services.patient_ai.patient_initiative import _initiative_timers  # private!
```

New: class instances on `app.state`.

```python
class EmotionCache:
    def __init__(self):
        self._store: dict[int, EmotionState] = {}

    def get(self, record_id: int) -> EmotionState | None: ...
    def set(self, record_id: int, state: EmotionState) -> None: ...
    def cleanup(self, record_id: int) -> None: ...
    def cleanup_completed(self, completed_ids: set[int]) -> int: ...

class InitiativeCache:
    def __init__(self):
        self._timers: dict[int, float] = {}

    def get_timer(self, record_id: int) -> float | None: ...
    def reset(self, record_id: int) -> None: ...
    def cleanup(self, record_id: int) -> None: ...
```

Settlement loop accesses caches through injected instances, not private imports.

### 3.5 Database Access — Sync SQLAlchemy via to_thread

**Decision:** Keep synchronous SQLAlchemy engine. This system's latency is
dominated by LLM calls (seconds), not DB queries (milliseconds). Async DB
(`sqlalchemy[asyncio]`) would add migration complexity with negligible real
performance gain.

**Thread pool:** A dedicated `ThreadPoolExecutor` with generous size (e.g., 20
threads) dedicated to DB operations, separate from FastAPI's default pool.

```python
# core/database.py
from concurrent.futures import ThreadPoolExecutor

db_executor = ThreadPoolExecutor(max_workers=20, thread_name_prefix="db-")


class SyncRepository:
    """Base class for synchronous SQLAlchemy repositories."""

    def __init__(self, session_factory=SessionLocal):
        self._session_factory = session_factory

    async def _run(self, fn, *args, **kwargs):
        """Execute a synchronous DB function in the dedicated thread pool."""
        return await asyncio.get_running_loop().run_in_executor(
            db_executor, fn, *args, **kwargs
        )

    async def _run_in_session(self, fn):
        """Execute fn(session) in a new session, with auto-close."""
        def _do():
            session = self._session_factory()
            try:
                return fn(session)
            finally:
                session.close()
        return await self._run(_do)
```

**Transaction boundary for scoring:**
The scoring pipeline (read messages → LLM call → write score) cannot use a single
database transaction because the LLM call spans seconds to minutes. Holding a
connection open that long would exhaust the pool.

Instead:
1. **Read phase:** open session → read messages → close session
2. **LLM phase:** pure async (no session held)
3. **Write phase:** open session → write score → commit → close session

The `scoring_status` field (`pending` → `processing` → `completed` / `failed`)
provides idempotency, not database transactions.

### 3.6 Streaming Endpoints — Context Manager for DB Sessions

Current: streaming endpoints manually manage `SessionLocal()` + `except BaseException`
for cleanup.

New: `async with` context manager.

```python
from contextlib import asynccontextmanager

@asynccontextmanager
async def db_session():
    session = await asyncio.to_thread(SessionLocal)
    try:
        yield session
    finally:
        await asyncio.to_thread(session.close)


# Usage in streaming endpoint:
@router.post("/{record_id}/message/stream")
async def send_message_stream(...):
    async with db_session() as db:
        ctx = await _build_context(record_id, req, current_user, db, ...)
        return StreamingResponse(
            stream_pipeline(ctx, pipe),
            media_type="text/event-stream",
        )
```

`db.close()` runs on `GeneratorExit` (client disconnect) via the `finally` block.
No `BaseException` catch needed.

---

## 4. Target Directory Structure

```
backend/
├── main.py                      # app factory + lifespan (<80 lines)
├── core/
│   ├── config.py                # settings (minimal changes)
│   ├── database.py              # engine + Session + db_executor + get_db
│   ├── security.py              # auth utilities (minimal changes)
│   ├── exceptions.py            # unified exception hierarchy
│   └── dependencies.py          # FastAPI Depends factories
├── models/                      # SQLAlchemy ORM (one file per model)
│   ├── __init__.py              # re-export all
│   ├── base.py
│   ├── user.py
│   ├── training.py
│   ├── case.py
│   ├── scoring.py
│   ├── qa.py
│   ├── llm.py
│   ├── questionnaire.py
│   ├── feedback.py
│   ├── prompt.py
│   └── nursing_record.py
├── repositories/                # data access (sync SQLAlchemy)
│   ├── base.py                  # SyncRepository base
│   ├── user.py
│   ├── training.py
│   ├── case.py
│   ├── qa.py
│   └── questionnaire.py
├── services/                    # business orchestration (async, no HTTP)
│   ├── auth.py
│   ├── training.py
│   ├── scoring.py
│   ├── chat.py
│   ├── qa.py
│   ├── template.py
│   └── patient.py
├── routers/                     # HTTP endpoints (thin)
│   ├── __init__.py
│   ├── auth.py
│   ├── training.py
│   ├── chat.py
│   ├── cases.py
│   ├── qa.py
│   ├── admin.py
│   └── ...
├── schemas/                     # Pydantic models (split by domain)
│   ├── __init__.py
│   ├── auth.py
│   ├── training.py
│   └── ...
├── infrastructure/              # external integrations (no business logic)
│   ├── llm/
│   │   ├── client.py            # LLMClient
│   │   ├── router.py            # ProfileRouter
│   │   ├── logging.py           # LogWorker
│   │   ├── crypto.py            # encryption
│   │   └── parsing.py           # safe JSON parse
│   ├── queue.py                 # TaskQueue
│   ├── wechat.py
│   ├── cache.py                 # EmotionCache, InitiativeCache, QACache
│   └── pagination.py
├── domain/                      # pure functions (zero I/O, zero ORM)
│   ├── scoring.py               # scoring rules, validation, conversion
│   ├── phases.py                # phase transition logic
│   ├── rubric.py                # rubric loading
│   ├── inquiry.py               # inquiry coverage detection
│   └── prompts.py               # prompt template rendering
├── prompts/                     # prompt text templates (unchanged)
├── migrations/                  # Alembic (unchanged)
└── tests/                       # mirror source structure
```

### Files deleted

| Old path | Reason |
|----------|--------|
| `services/llm/infra.py` | Module-level globals replaced by Depends + constructor injection |
| `services/llm/service.py` | Merged into `infrastructure/llm/client.py` |

---

## 5. Exception Hierarchy

```python
# core/exceptions.py

class AppError(Exception):
    """Base for all application-level exceptions."""

class AuthError(AppError): ...
class NotFoundError(AppError): ...

class LLMError(AppError):
    """Base for all LLM-related errors."""

class NoProviderAvailable(LLMError):
    """All LLM providers exhausted or unavailable."""

class LLMConcurrencyExceeded(LLMError):
    """Semaphore acquisition timed out."""

class LLMParseError(LLMError):
    """JSON response parsing failed after retries."""

class ScoringError(AppError): ...
class ScoringValidationError(ScoringError): ...
class ScoringFeedbackError(ScoringError): ...
```

Replaces current patterns:
- `if "可用" in str(e): raise` → `except NoProviderAvailable: raise`
- `RuntimeError("LLM调用失败...")` → `raise NoProviderAvailable(...)`
- `RuntimeError("LLM 服务繁忙...")` → `raise LLMConcurrencyExceeded()`

---

## 6. Dependency Injection — FastAPI Native

No third-party DI framework. Use `Depends` + `app.state`.

```python
# core/dependencies.py

from typing import Annotated
from fastapi import Depends, Request

def get_llm_client(request: Request) -> LLMClient:
    return request.app.state.llm_client

def get_task_queue(request: Request) -> TaskQueue:
    return request.app.state.task_queue

def get_training_repo() -> TrainingRepository:
    return TrainingRepository()

def get_llm_router(request: Request) -> ProfileRouter:
    return request.app.state.llm_router

def get_log_worker(request: Request) -> LogWorker:
    return request.app.state.log_worker

def get_emotion_cache(request: Request) -> EmotionCache:
    return request.app.state.emotion_cache

def get_initiative_cache(request: Request) -> InitiativeCache:
    return request.app.state.initiative_cache

# Composite dependencies
def get_training_service(
    repo: Annotated[TrainingRepository, Depends(get_training_repo)],
    llm: Annotated[LLMClient, Depends(get_llm_client)],
    queue: Annotated[TaskQueue, Depends(get_task_queue)],
) -> TrainingService:
    return TrainingService(repo=repo, llm=llm, queue=queue)
```

### Lifespan initialization

```python
# main.py
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Infrastructure
    http_client = httpx.AsyncClient(timeout=..., limits=...)
    llm_router = ProfileRouter()
    await llm_router.load_from_db()
    log_worker = LogWorker()
    await log_worker.start()
    task_queue = TaskQueue(max_workers=3)
    await task_queue.start()

    app.state.httpx_client = http_client
    app.state.llm_router = llm_router
    app.state.log_worker = log_worker
    app.state.task_queue = task_queue
    app.state.llm_client = LLMClient(
        http=http_client,
        router=llm_router,
        log_worker=log_worker,
    )
    app.state.emotion_cache = EmotionCache()
    app.state.initiative_cache = InitiativeCache()

    # 2. Seed data (delegated to separate module)
    from core.seed import seed_all
    await seed_all()

    # 3. Background loops
    from services.training import settlement_loop
    settlement_task = asyncio.create_task(settlement_loop(...))
    app.state._settlement_task = settlement_task

    yield

    # Shutdown
    settlement_task.cancel()
    await task_queue.stop()
    await log_worker.stop()
    await http_client.aclose()
```

---

## 7. Feature Coverage Verification

Each current feature verified against the new architecture:

| Feature | Current | New | Risk |
|---------|---------|-----|------|
| Auth (login/register/wechat) | Router → direct DB | Router → AuthService → UserRepo(to_thread) | None |
| Training start/end | Sync endpoints, direct DB | Async endpoints → TrainingService → TrainingRepo(to_thread) | None |
| Chat (message + stream) | Manual SessionLocal + BaseException catch | async with db_session() context manager | None |
| Scoring (2-stage + background) | evaluate_training with global deps | ScoringService.evaluate with injected LLMClient | None |
| Settlement (auto-timeout) | Sync _cleanup_once with create_task | Async settlement_loop with TaskQueue.enqueue | None |
| Patient AI (emotion/initiative) | Module-level dict caches | EmotionCache/InitiativeCache on app.state | None |
| LLM logging | LogWorker with asyncio.Queue | Unchanged logic, injected dependency | None |
| QA (ask + stream) | Manual SessionLocal + BaseException | async with db_session() | None |
| Admin endpoints | Sync, direct DB | Async, via services/repos | None |
| WeChat integration | Direct calls from router | Via infrastructure/wechat.py, injected | None |
| Prompt management | PromptManager on app.state | Unchanged, injected | None |

---

## 8. What Changes vs What Stays

### Removed entirely

| Artifact | Reason |
|----------|--------|
| `services/llm/infra.py` | Module globals (`_client`, `_router`, `_pm`, `_log_worker`, `_main_loop`) |
| `set_infra()` / `get_client()` / `get_router()` / `get_pm()` / `get_log_worker()` / `get_main_loop()` | Replaced by Depends + constructor injection |
| `schedule_background()` | Replaced by `TaskQueue.enqueue()` |
| `_SemaPool` (threading.Semaphore wrapper) | Replaced by `asyncio.Semaphore` |
| Inline imports in 20 files (92 instances) | All moved to module-level in correct layer |
| Chinese string matching `if "可用" in str(e)` | Replaced by `except NoProviderAvailable` |
| `BaseException` catches in streaming endpoints | Replaced by `async with` context manager |
| `_scoring_pending` + `threading.Lock` | Simplified to plain `set` on `TaskQueue` (single loop) |

### Refactored in place

| Artifact | Change |
|----------|--------|
| `services/llm/service.py` → `infrastructure/llm/client.py` | Merge `call_llm` + `call_llm_stream` into `LLMClient` |
| `services/training/settlement.py` | `_cleanup_once` → async; eliminate reverse dependency on routers |
| `routers/training.py` | Endpoints → `async def`; scoring dispatch via `TaskQueue` |
| `routers/chat.py` | `SessionLocal` → `async with db_session()` |
| `routers/qa.py` | Same as chat |
| `routers/auth.py` | Inline `from services.wechat import` → top-level |
| `main.py` | `_seed_data` + `_seed_llm` → `core/seed.py`; lifespan thinned |

### Unchanged

| Artifact | Reason |
|----------|--------|
| `prompts/` | Already isolated |
| `migrations/` | Alembic conventions fine |
| `core/config.py` | Settings already decent |
| `core/security.py` | Auth utilities clean |
| Frontend | HTTP API surface unchanged |
| Miniprogram | Same |

---

## 9. Migration Strategy

Since the system is not yet in production and can be tested on a staging server,
a one-shot restructuring is feasible.

### Phase order

1. **Infrastructure first** — `LLMClient`, `TaskQueue`, `EmotionCache`, `InitiativeCache`,
   exception hierarchy. These have no downstream dependents yet (they're new files).
2. **Repositories** — move data access out of routers/services into `repositories/`.
   Each repository is independently testable.
3. **Services** — rewrite orchestration services to use injected repositories +
   `LLMClient`. Eliminate all global variable access.
4. **Routers** — convert to `async def`, use services via `Depends`, eliminate
   `SessionLocal` manual management.
5. **Main + lifespan** — initialize all infrastructure, wire up dependencies,
   start background loops.
6. **Delete dead code** — `infra.py`, `schedule_background`, `_SemaPool`, inline
   imports, `BaseException` catches.
7. **Test pass** — run full test suite (`pytest backend/tests/`), fix regressions.

### Rollback

All changes on `refactor/backend-architecture-v2` branch. `master` remains untouched
until verified. Rollback is `git checkout master`.

---

## 10. Open Questions

1. **Seed data extraction**: Should `_seed_data` + `_seed_llm` become Alembic data
   migrations, or remain as startup-time scripts? (Deferred — keep as startup script
   for now, moved to `core/seed.py`.)

2. **DB thread pool sizing**: 20 threads is a starting estimate. Should be tuned
   based on load testing. (Deferred — use configurable env var with default 20.)

3. **TaskQueue monitoring**: Should expose queue depth and worker status via
   `/api/health` or a dedicated debug endpoint. (Deferred — add health check
   integration as part of v2.)

---

## 11. Rejected Alternatives

| Alternative | Reason rejected |
|-------------|-----------------|
| SQLAlchemy async engine | Mature enough, but migration cost > benefit for this LLM-bound workload |
| Redis + ARQ for background tasks | Adds infrastructure dependency for a low-volume workload |
| PostgreSQL SKIP LOCKED task queue | Overengineered for current scale; migrate later if needed |
| Third-party DI framework (punq, dependency-injector) | FastAPI Depends is sufficient; avoids another dependency |
| Keep _SemaPool threading approach | Single event loop makes it unnecessary |
