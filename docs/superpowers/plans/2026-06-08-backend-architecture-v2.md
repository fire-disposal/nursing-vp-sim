# Backend Architecture v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure backend into a clean layered architecture with single event loop, eliminate global mutable state, and unify async patterns.

**Architecture:** Layered: routers → services → repositories → models. All I/O on one event loop. DB access via `asyncio.to_thread`. Background tasks via bounded `TaskQueue`. LLM calls via unified `LLMClient`. Dependencies injected via FastAPI `Depends` / constructor, never module globals.

**Tech Stack:** FastAPI, SQLAlchemy (sync), httpx, asyncio, Pydantic v2, pytest

---

## File Map

| New File | Responsibility |
|----------|---------------|
| `backend/core/exceptions.py` | Unified exception hierarchy |
| `backend/core/dependencies.py` | FastAPI Depends factories (rewritten) |
| `backend/core/seed.py` | Seed data (extracted from main.py) |
| `backend/infrastructure/llm/__init__.py` | Re-exports for LLM infrastructure |
| `backend/infrastructure/llm/client.py` | LLMClient — unified LLM caller |
| `backend/infrastructure/llm/circuit.py` | Retry + backoff logic |
| `backend/infrastructure/queue.py` | TaskQueue — bounded background workers |
| `backend/infrastructure/cache.py` | EmotionCache, InitiativeCache |
| `backend/infrastructure/__init__.py` | Re-exports |
| `backend/domain/__init__.py` | Re-exports for domain |
| `backend/domain/scoring.py` | Scoring rules + validation (extracted) |
| `backend/domain/phases.py` | Phase transition logic (extracted) |
| `backend/domain/inquiry.py` | Inquiry coverage detection (extracted) |
| `backend/repositories/__init__.py` | Re-exports for repositories |
| `backend/repositories/base.py` | SyncRepository base class |
| `backend/repositories/training.py` | TrainingRecord queries |
| `backend/repositories/user.py` | User queries |
| `backend/repositories/case.py` | Case queries |
| `backend/repositories/qa.py` | QA session queries |
| `backend/services/chat.py` | Chat service (extracted from router) |
| `backend/services/scoring.py` | ScoringService (rewritten orchestration) |
| `backend/services/training/settlement_v2.py` | Async settlement loop |
| `backend/tests/test_llm_client.py` | LLMClient tests |
| `backend/tests/test_task_queue.py` | TaskQueue tests |
| `backend/tests/test_exceptions.py` | Exception hierarchy tests |
| `backend/tests/test_cache_infrastructure.py` | Cache tests |

| Modified File | Change |
|---------------|--------|
| `backend/main.py` | Thinned lifespan, delegate to seed.py + dependencies |
| `backend/services/llm/__init__.py` | Remove service re-exports, keep router/logging/crypto/parsing/catalog |
| `backend/services/llm/service.py` | **DELETED** — replaced by `infrastructure/llm/client.py` |
| `backend/services/llm/infra.py` | **DELETED** — replaced by Depends injection |
| `backend/services/training/__init__.py` | Update exports |
| `backend/services/training/settlement.py` | Replace `_cleanup_once` with async |
| `backend/services/pipeline/context.py` | Remove `app_state` field, inject deps directly |
| `backend/services/pipeline/middleware/llm_caller.py` | Use LLMClient instead of inline imports |
| `backend/services/patient_ai/patient_initiative.py` | Remove module-level dicts, use cache instance |
| `backend/routers/training.py` | `async def` endpoints, use TrainingService via Depends |
| `backend/routers/chat.py` | `async with db_session()`, use ChatService |
| `backend/routers/qa.py` | `async with db_session()` |
| `backend/routers/auth.py` | Top-level imports, use AuthService |
| `backend/middleware/dependencies.py` | Rewrite Depends factories |

---

### Task 1: Exception Hierarchy

**Files:**
- Create: `backend/core/exceptions.py`
- Create: `backend/tests/test_exceptions.py`

- [ ] **Step 1: Write the exception classes**

```python
# backend/core/exceptions.py
"""Unified application exception hierarchy."""


class AppError(Exception):
    """Base for all application-level exceptions."""


class AuthError(AppError):
    """Authentication or authorization failure."""


class NotFoundError(AppError):
    """Requested resource does not exist."""


class ConflictError(AppError):
    """Resource state conflict (e.g., duplicate, already processed)."""


# ── LLM ──

class LLMError(AppError):
    """Base for all LLM-related errors."""


class NoProviderAvailable(LLMError):
    """All LLM providers exhausted, degraded, or unavailable."""


class LLMConcurrencyExceeded(LLMError):
    """Semaphore acquisition timed out — too many in-flight calls."""


class LLMParseError(LLMError):
    """JSON response parsing failed after all retries."""


class LLMRateLimited(LLMError):
    """Provider returned 429 after all retries."""


# ── Scoring ──

class ScoringError(AppError):
    """Base for scoring pipeline errors."""


class ScoringValidationError(ScoringError):
    """Scoring result failed structural validation."""


class ScoringFeedbackError(ScoringError):
    """Feedback generation returned empty or invalid result."""
```

- [ ] **Step 2: Write the tests**

```python
# backend/tests/test_exceptions.py
import pytest

from core.exceptions import (
    AppError,
    AuthError,
    ConflictError,
    LLMConcurrencyExceeded,
    LLMError,
    LLMParseError,
    LLMRateLimited,
    NoProviderAvailable,
    NotFoundError,
    ScoringError,
    ScoringFeedbackError,
    ScoringValidationError,
)


class TestExceptionHierarchy:

    def test_app_error_is_base(self):
        assert issubclass(AuthError, AppError)
        assert issubclass(NotFoundError, AppError)
        assert issubclass(LLMError, AppError)
        assert issubclass(ScoringError, AppError)

    def test_llm_subclasses(self):
        assert issubclass(NoProviderAvailable, LLMError)
        assert issubclass(LLMConcurrencyExceeded, LLMError)
        assert issubclass(LLMParseError, LLMError)
        assert issubclass(LLMRateLimited, LLMError)

    def test_scoring_subclasses(self):
        assert issubclass(ScoringValidationError, ScoringError)
        assert issubclass(ScoringFeedbackError, ScoringError)

    def test_str_representation(self):
        exc = NoProviderAvailable("purpose=scoring")
        assert "scoring" in str(exc)

    def test_can_catch_by_base(self):
        with pytest.raises(AppError):
            raise NoProviderAvailable("test")
```

- [ ] **Step 3: Run tests**

Run: `cd backend && .venv\Scripts\python -m pytest tests/test_exceptions.py -v`
Expected: 6 PASS

- [ ] **Step 4: Commit**

```bash
git add backend/core/exceptions.py backend/tests/test_exceptions.py
git commit -m "✨ feat: add unified exception hierarchy"
```

---

### Task 2: Retry + Backoff Logic

**Files:**
- Create: `backend/infrastructure/llm/circuit.py`
- Create: `backend/infrastructure/llm/__init__.py`
- Create: `backend/infrastructure/__init__.py`

- [ ] **Step 1: Create directories and write circuit.py**

```bash
New-Item -ItemType Directory -Force -Path "backend\infrastructure\llm"
```

```python
# backend/infrastructure/llm/circuit.py
"""Retry loop and backoff for LLM HTTP calls."""

import asyncio
import logging
import random
from collections.abc import Awaitable, Callable
from typing import TypeVar

import httpx

from core.exceptions import LLMRateLimited, NoProviderAvailable

log = logging.getLogger(__name__)

T = TypeVar("T")

_RETRYABLE_STATUSES: frozenset[int] = frozenset({429, 500, 502, 503, 504})
_RETRYABLE_EXCEPTIONS: tuple[type[Exception], ...] = (
    httpx.TimeoutException,
    httpx.ConnectError,
    httpx.RemoteProtocolError,
    httpx.ReadError,
)


def backoff_delay(attempt: int) -> float:
    """Exponential backoff with jitter. attempt is 0-indexed."""
    return min(2 ** (attempt + 1), 16) + random.uniform(0, 0.5)


async def async_retry(
    fn: Callable[[], Awaitable[T]],
    *,
    max_retries: int = 2,
    purpose: str = "unknown",
) -> T:
    """Call `fn` with retry on retryable failures.

    Raises NoProviderAvailable if all attempts exhausted.
    Raises LLMRateLimited if all attempts got 429.
    """
    last_error: str | None = None
    all_429: bool = True

    for attempt in range(max_retries + 1):
        try:
            return await fn()
        except _RETRYABLE_EXCEPTIONS as e:
            last_error = f"{type(e).__name__}: {e!s}"[:200]
            all_429 = False
        except httpx.HTTPStatusError as e:
            status = e.response.status_code
            last_error = f"HTTP {status}"
            if status != 429:
                all_429 = False
            if status not in _RETRYABLE_STATUSES:
                raise  # non-retryable (400, 401, 403, 404, etc.)
        except Exception as e:
            last_error = f"{type(e).__name__}: {e!s}"[:200]
            all_429 = False

        if attempt < max_retries:
            delay = backoff_delay(attempt)
            log.debug("LLM retry attempt=%d/%d delay=%.1fs purpose=%s error=%s",
                       attempt + 1, max_retries, delay, purpose, last_error)
            await asyncio.sleep(delay)

    if all_429 and last_error:
        raise LLMRateLimited(f"purpose={purpose}: {last_error}")
    raise NoProviderAvailable(f"purpose={purpose}: {last_error}")
```

- [ ] **Step 2: Write infrastructure __init__.py files**

```python
# backend/infrastructure/__init__.py
"""External integrations — LLM, task queue, caches, WeChat."""
```

```python
# backend/infrastructure/llm/__init__.py
"""LLM infrastructure — client, router, logging, crypto, parsing."""
```

- [ ] **Step 3: Write tests for circuit.py**

```python
# backend/tests/test_llm_circuit.py
import asyncio
import httpx
import pytest

from core.exceptions import LLMRateLimited, NoProviderAvailable
from infrastructure.llm.circuit import async_retry, backoff_delay


class TestBackoffDelay:

    def test_increases_with_attempt(self):
        d0 = backoff_delay(0)
        d2 = backoff_delay(2)
        assert d0 < d2

    def test_max_cap(self):
        d10 = backoff_delay(10)
        assert d10 <= 16.5


class TestAsyncRetry:

    @pytest.mark.asyncio
    async def test_success_first_try(self):
        call_count = 0

        async def fn():
            nonlocal call_count
            call_count += 1
            return "ok"

        result = await async_retry(fn, max_retries=2)
        assert result == "ok"
        assert call_count == 1

    @pytest.mark.asyncio
    async def test_retry_on_timeout(self):
        call_count = 0

        async def fn():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise httpx.TimeoutException("timeout")
            return "ok"

        result = await async_retry(fn, max_retries=3)
        assert result == "ok"
        assert call_count == 3

    @pytest.mark.asyncio
    async def test_exhaust_retries_raises(self):
        async def fn():
            raise httpx.ConnectError("refused")

        with pytest.raises(NoProviderAvailable):
            await async_retry(fn, max_retries=1)

    @pytest.mark.asyncio
    async def test_all_429_raises_rate_limited(self):
        async def fn():
            raise httpx.HTTPStatusError(
                "429", request=object(), response=object()
            )

        with pytest.raises(LLMRateLimited):
            await async_retry(fn, max_retries=1)

    @pytest.mark.asyncio
    async def test_non_retryable_status_raises_immediately(self):
        call_count = 0

        async def fn():
            nonlocal call_count
            call_count += 1
            resp = httpx.Response(400, request=httpx.Request("POST", "http://x"))
            raise httpx.HTTPStatusError("400", request=object(), response=resp)

        with pytest.raises(httpx.HTTPStatusError):
            await async_retry(fn, max_retries=3)
        assert call_count == 1

    @pytest.mark.asyncio
    async def test_retry_on_5xx(self):
        call_count = 0

        async def fn():
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                resp = httpx.Response(503, request=httpx.Request("POST", "http://x"))
                raise httpx.HTTPStatusError("503", request=object(), response=resp)
            return "ok"

        result = await async_retry(fn, max_retries=2)
        assert result == "ok"
        assert call_count == 2
```

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv\Scripts\python -m pytest tests/test_llm_circuit.py -v`
Expected: 7 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/infrastructure/ backend/tests/test_llm_circuit.py
git commit -m "✨ feat: add retry/circuit-breaker logic for LLM"
```

---

### Task 3: LLMClient — Unified LLM Caller

**Files:**
- Create: `backend/infrastructure/llm/client.py`
- Create: `backend/tests/test_llm_client.py`

- [ ] **Step 1: Write LLMClient**

Note: This requires reading the current `services/llm/service.py` and `services/llm/router.py` for full context on router.select() and ProfileRouter APIs. The imported modules `services/llm/router.py`, `services/llm/logging.py`, `services/llm/crypto_utils.py`, `services/llm/parsing.py` remain in place and are imported by this module.

```python
# backend/infrastructure/llm/client.py
"""LLMClient — unified entry point for LLM API calls.

Consolidates call_llm / call_llm_stream / call_llm_json from
the old services/llm/service.py into a single class with shared
retry, rate-limiting, and logging logic.
"""

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from collections.abc import AsyncIterator

import httpx

from core.config import LLM_CONCURRENT_LIMIT, get_llm_config
from core.exceptions import LLMConcurrencyExceeded, LLMParseError
from infrastructure.llm.circuit import async_retry
from services.llm.logging import LogWorker
from services.llm.parsing import _safe_parse_json
from services.llm.router import ProfileRouter

log = logging.getLogger(__name__)


@dataclass
class CallContext:
    """Metadata for a single LLM call — user, record, case context."""
    purpose: str = "other"
    user_id: int | None = None
    record_id: int | None = None
    case_id: int | None = None
    log_meta: dict | None = None


@dataclass
class _CallState:
    """Internal state built per-call from context + config."""
    provider_name: str = "unknown"
    model: str = "unknown"
    config_id: int | None = None
    api_key: str = ""
    base_url: str = ""
    price_input: float = 0.0
    price_output: float = 0.0


class LLMClient:
    """Unified LLM caller with retry, concurrency limiting, and logging.

    All LLM calls in the system go through this class. It manages:
    - Profile selection and key decryption (via ProfileRouter)
    - Concurrency limiting (via asyncio.Semaphore)
    - Retry with exponential backoff (via async_retry)
    - Call logging (via LogWorker)
    """

    def __init__(
        self,
        http: httpx.AsyncClient,
        router: ProfileRouter,
        log_worker: LogWorker,
        concurrency: int | None = None,
    ):
        self._http = http
        self._router = router
        self._log_worker = log_worker
        self._sem = asyncio.Semaphore(concurrency or LLM_CONCURRENT_LIMIT)

    # ── Public API ──

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
    ) -> str:
        """Send a chat completion request and return the response text."""
        ctx = ctx or CallContext(purpose=purpose)
        state = _CallState()

        async def _attempt() -> str:
            return await self._do_call(
                messages, state, purpose,
                temperature, max_tokens, timeout,
                response_format, stream=False,
            )

        t0 = time.perf_counter()
        try:
            content = await async_retry(_attempt, max_retries=max_retries, purpose=purpose)
            latency_ms = int((time.perf_counter() - t0) * 1000)
            self._log_worker.enqueue(
                purpose=purpose,
                user_id=ctx.user_id,
                record_id=ctx.record_id,
                case_id=ctx.case_id,
                model=state.model,
                temperature=temperature,
                max_tokens=max_tokens,
                latency_ms=latency_ms,
                status="success",
                request_text=" ".join(m.get("content", "") for m in messages),
                response_text=content,
                usage=None,
                meta=ctx.log_meta,
                config_id=state.config_id,
                provider_name=state.provider_name,
                key_price_input=state.price_input,
                key_price_output=state.price_output,
            )
            return content
        except Exception:
            latency_ms = int((time.perf_counter() - t0) * 1000)
            self._log_worker.enqueue(
                purpose=purpose,
                user_id=ctx.user_id,
                record_id=ctx.record_id,
                case_id=ctx.case_id,
                model=state.model,
                temperature=temperature,
                max_tokens=max_tokens,
                latency_ms=latency_ms,
                status="failed",
                error_type="all_providers_failed",
                error_message=str(latency_ms),
                request_text=" ".join(m.get("content", "") for m in messages),
                meta=ctx.log_meta,
                config_id=state.config_id,
                provider_name=state.provider_name,
            )
            raise

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
    ) -> AsyncIterator[str]:
        """Send a streaming chat completion and yield content chunks."""
        ctx = ctx or CallContext(purpose=purpose)
        state = _CallState()
        full_reply: list[str] = []
        t0 = time.perf_counter()

        async def _attempt() -> None:
            nonlocal full_reply
            full_reply = []  # reset on retry
            async for chunk in self._do_stream(
                messages, state, purpose,
                temperature, max_tokens, timeout,
            ):
                full_reply.append(chunk)
                yield chunk  # type: ignore[misc]

        try:
            # async_retry expects a callable returning Awaitable[T], but
            # we need an async generator. We handle retry manually here
            # because async generators can't be passed to async_retry directly.
            last_error: str | None = None
            for attempt in range(max_retries + 1):
                try:
                    full_reply = []
                    state = _CallState()
                    async for chunk in self._do_stream(
                        messages, state, purpose,
                        temperature, max_tokens, timeout,
                    ):
                        full_reply.append(chunk)
                        yield chunk
                    # success — log and return
                    latency_ms = int((time.perf_counter() - t0) * 1000)
                    total_text = "".join(full_reply)
                    self._log_worker.enqueue(
                        purpose=purpose,
                        user_id=ctx.user_id,
                        record_id=ctx.record_id,
                        case_id=ctx.case_id,
                        model=state.model,
                        temperature=temperature,
                        max_tokens=max_tokens,
                        latency_ms=latency_ms,
                        status="success",
                        request_text=" ".join(m.get("content", "") for m in messages),
                        response_text=total_text,
                        usage=None,
                        meta=ctx.log_meta,
                        config_id=state.config_id,
                        provider_name=state.provider_name,
                        key_price_input=state.price_input,
                        key_price_output=state.price_output,
                    )
                    return
                except httpx.HTTPStatusError as e:
                    if e.response.status_code not in (429, 500, 502, 503, 504):
                        raise
                    last_error = f"HTTP {e.response.status_code}"
                except (httpx.TimeoutException, httpx.ConnectError,
                        httpx.RemoteProtocolError, httpx.ReadError) as e:
                    last_error = f"{type(e).__name__}: {e!s}"[:200]
                except Exception as e:
                    last_error = f"{type(e).__name__}: {e!s}"[:200]

                if attempt < max_retries:
                    from infrastructure.llm.circuit import backoff_delay
                    await asyncio.sleep(backoff_delay(attempt))

            # All retries exhausted
            latency_ms = int((time.perf_counter() - t0) * 1000)
            if not full_reply:
                # fallback to non-streaming
                try:
                    content = await self.call(
                        messages,
                        purpose=purpose,
                        temperature=temperature,
                        max_tokens=max_tokens,
                        timeout=timeout,
                        max_retries=0,
                        ctx=ctx,
                    )
                    yield content
                    return
                except Exception:
                    pass

            self._log_worker.enqueue(
                purpose=purpose,
                user_id=ctx.user_id,
                record_id=ctx.record_id,
                case_id=ctx.case_id,
                model=state.model,
                temperature=temperature,
                max_tokens=max_tokens,
                latency_ms=latency_ms,
                status="failed",
                error_type="all_providers_failed",
                error_message=last_error,
                request_text=" ".join(m.get("content", "") for m in messages),
                meta=ctx.log_meta,
                config_id=state.config_id,
                provider_name=state.provider_name,
            )
            from core.exceptions import NoProviderAvailable
            raise NoProviderAvailable(f"purpose={purpose}: {last_error}")

    async def call_json(
        self,
        messages: list[dict],
        *,
        purpose: str,
        temperature: float = 0.3,
        max_tokens: int = 2048,
        timeout: int = 120,
        max_retries: int = 3,
        response_format: dict | None = None,
        ctx: CallContext | None = None,
    ) -> dict:
        """call() + safe JSON parse. Raises LLMParseError on failure."""
        text = await self.call(
            messages,
            purpose=purpose,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=timeout,
            max_retries=max_retries,
            response_format=response_format,
            ctx=ctx,
        )
        try:
            return _safe_parse_json(text)
        except (json.JSONDecodeError, ValueError) as e:
            raise LLMParseError(f"purpose={purpose}: {e!s}") from e

    # ── Internal ──

    async def _select_config(self, purpose: str) -> _CallState:
        """Select a profile and build initial call state."""
        config = self._router.select(purpose)
        api_key = self._router.get_decrypted_key(config)

        state = _CallState()
        state.api_key = api_key

        if hasattr(config, "secret") and config.secret:
            state.provider_name = _infer_provider(config.secret.base_url)
            state.base_url = config.secret.base_url
            state.price_input = float(config.secret.price_input_per_1m or 0)
            state.price_output = float(config.secret.price_output_per_1m or 0)
        else:
            state.provider_name = _infer_provider(getattr(config, "base_url", ""))
            state.base_url = getattr(config, "base_url", "")
            state.price_input = float(getattr(config, "price_input_per_1m", 0) or 0)
            state.price_output = float(getattr(config, "price_output_per_1m", 0) or 0)

        state.model = config.model
        state.config_id = config.id
        return state

    async def _do_call(
        self,
        messages: list[dict],
        state: _CallState,
        purpose: str,
        temperature: float,
        max_tokens: int,
        timeout: int,
        response_format: dict | None,
        stream: bool,
    ) -> str:
        """Single HTTP call attempt — selects config, sends request, parses response."""
        new_state = await self._select_config(purpose)
        state.provider_name = new_state.provider_name
        state.model = new_state.model
        state.config_id = new_state.config_id
        state.api_key = new_state.api_key
        state.base_url = new_state.base_url
        state.price_input = new_state.price_input
        state.price_output = new_state.price_output

        payload: dict = {
            "model": state.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if stream:
            payload["stream"] = True
        if response_format and not stream:
            payload["response_format"] = response_format

        try:
            async with asyncio.timeout(timeout + 10):
                async with self._sem:
                    resp = await self._http.post(
                        f"{state.base_url}/v1/chat/completions",
                        headers={
                            "Authorization": f"Bearer {state.api_key}",
                            "Content-Type": "application/json",
                        },
                        json=payload,
                        timeout=httpx.Timeout(timeout, connect=15.0),
                    )
        except TimeoutError:
            raise LLMConcurrencyExceeded(
                f"purpose={purpose}: semaphore acquisition timed out"
            ) from None

        resp.raise_for_status()
        data = resp.json()

        usage = data.get("usage", {})
        total_tokens = usage.get("total_tokens", 0) or 0
        await self._router.report_result(
            state, success=True, tokens=total_tokens, latency_ms=0, error=None
        )

        content = data["choices"][0]["message"]["content"]
        return content

    async def _do_stream(
        self,
        messages: list[dict],
        state: _CallState,
        purpose: str,
        temperature: float,
        max_tokens: int,
        timeout: int,
    ) -> AsyncIterator[str]:
        """Single streaming HTTP attempt — yields content chunks."""
        new_state = await self._select_config(purpose)
        state.provider_name = new_state.provider_name
        state.model = new_state.model
        state.config_id = new_state.config_id
        state.api_key = new_state.api_key
        state.base_url = new_state.base_url
        state.price_input = new_state.price_input
        state.price_output = new_state.price_output

        payload = {
            "model": state.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }

        try:
            async with asyncio.timeout(timeout + 10):
                async with self._sem:
                    async with self._http.stream(
                        "POST",
                        f"{state.base_url}/v1/chat/completions",
                        headers={
                            "Authorization": f"Bearer {state.api_key}",
                            "Content-Type": "application/json",
                        },
                        json=payload,
                        timeout=httpx.Timeout(timeout, connect=15.0),
                    ) as resp:
                        resp.raise_for_status()
                        async for line in resp.aiter_lines():
                            if line.startswith("data: "):
                                data = line[6:]
                                if data == "[DONE]":
                                    break
                                try:
                                    obj = json.loads(data)
                                    delta = obj["choices"][0].get("delta", {})
                                    content = delta.get("content", "")
                                    if content:
                                        yield content
                                except (json.JSONDecodeError, KeyError, IndexError):
                                    pass
        except TimeoutError:
            raise LLMConcurrencyExceeded(
                f"purpose={purpose}: semaphore acquisition timed out"
            ) from None


def _infer_provider(base_url: str) -> str:
    """Simple provider inference from base URL."""
    if not base_url:
        return "unknown"
    if "deepseek" in base_url:
        return "deepseek"
    if "openai" in base_url:
        return "openai"
    if "zhipu" in base_url or "bigmodel" in base_url:
        return "zhipu"
    return base_url.split("//")[-1].split("/")[0].split(".")[0]
```

- [ ] **Step 2: Update infrastructure/llm/__init__.py**

```python
# backend/infrastructure/llm/__init__.py
"""LLM infrastructure — client, router, logging, crypto, parsing."""
from .client import LLMClient, CallContext

__all__ = ["LLMClient", "CallContext"]
```

- [ ] **Step 3: Write LLMClient tests**

```python
# backend/tests/test_llm_client.py
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from core.exceptions import LLMParseError
from infrastructure.llm.client import LLMClient, CallContext


@pytest.fixture
def mock_http():
    return MagicMock(spec=httpx.AsyncClient)


@pytest.fixture
def mock_router():
    router = MagicMock()
    router.select.return_value = MagicMock(
        id=1,
        model="test-model",
        secret=MagicMock(
            base_url="https://test.api.com",
            price_input_per_1m=1.0,
            price_output_per_1m=2.0,
        ),
    )
    router.get_decrypted_key.return_value = "sk-test-key"
    router.report_result = AsyncMock()
    return router


@pytest.fixture
def mock_log_worker():
    return MagicMock()


@pytest.fixture
def client(mock_http, mock_router, mock_log_worker):
    return LLMClient(
        http=mock_http,
        router=mock_router,
        log_worker=mock_log_worker,
        concurrency=10,
    )


class TestLLMClientCall:

    @pytest.mark.asyncio
    async def test_successful_call(self, client, mock_http):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": "Hello, patient!"}}],
            "usage": {"total_tokens": 50},
        }
        mock_resp.status_code = 200
        mock_http.post = AsyncMock(return_value=mock_resp)

        result = await client.call(
            [{"role": "user", "content": "Hi"}],
            purpose="patient_chat",
            ctx=CallContext(user_id=1, record_id=10),
        )

        assert result == "Hello, patient!"
        mock_http.post.assert_called_once()

    @pytest.mark.asyncio
    async def test_semaphore_acquisition(self, client, mock_http):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": "ok"}}],
        }
        mock_resp.status_code = 200
        mock_http.post = AsyncMock(return_value=mock_resp)

        # Should succeed — semaphore not exhausted
        result = await client.call(
            [{"role": "user", "content": "test"}],
            purpose="qa",
        )
        assert result == "ok"


class TestLLMClientCallJSON:

    @pytest.mark.asyncio
    async def test_successful_json_call(self, client, mock_http):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": '{"score": 85}'}}],
        }
        mock_resp.status_code = 200
        mock_http.post = AsyncMock(return_value=mock_resp)

        result = await client.call_json(
            [{"role": "user", "content": "score this"}],
            purpose="scoring",
        )
        assert result == {"score": 85}

    @pytest.mark.asyncio
    async def test_json_parse_failure(self, client, mock_http):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": "not json at all"}}],
        }
        mock_resp.status_code = 200
        mock_http.post = AsyncMock(return_value=mock_resp)

        with pytest.raises(LLMParseError):
            await client.call_json(
                [{"role": "user", "content": "test"}],
                purpose="scoring",
            )
```

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv\Scripts\python -m pytest tests/test_llm_client.py -v`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/infrastructure/llm/client.py backend/infrastructure/llm/__init__.py backend/tests/test_llm_client.py
git commit -m "✨ feat: add LLMClient — unified LLM caller with retry + semaphore"
```

---

### Task 4: TaskQueue — Bounded Background Worker Pool

**Files:**
- Create: `backend/infrastructure/queue.py`
- Create: `backend/tests/test_task_queue.py`

- [ ] **Step 1: Write TaskQueue**

```python
# backend/infrastructure/queue.py
"""TaskQueue — bounded priority background worker pool.

Replaces scattered asyncio.create_task() and schedule_background()
with a single, observable worker pool that lives on the main event loop.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import TypeVar

log = logging.getLogger(__name__)

T = TypeVar("T")


@dataclass(order=True)
class _Task:
    priority: int
    coro_factory: Callable[[], Awaitable[T]] = field(compare=False)
    future: asyncio.Future[T] = field(compare=False)


class TaskQueue:
    """Bounded priority task queue with configurable worker count.

    Usage:
        queue = TaskQueue(max_workers=3)
        await queue.start()
        future = await queue.enqueue(lambda: do_work(), priority=5)
        # optionally: result = await future
        await queue.stop()
    """

    def __init__(self, max_workers: int = 3, max_size: int = 100):
        if max_workers < 1:
            raise ValueError("max_workers must be >= 1")
        if max_size < 1:
            raise ValueError("max_size must be >= 1")
        self._queue: asyncio.PriorityQueue[_Task] = asyncio.PriorityQueue(maxsize=max_size)
        self._max_workers = max_workers
        self._workers: list[asyncio.Task[None]] = []

    async def start(self) -> None:
        """Spawn worker coroutines. Must be called on the event loop."""
        for i in range(self._max_workers):
            task = asyncio.create_task(self._worker(i), name=f"bg-worker-{i}")
            self._workers.append(task)
        log.info("TaskQueue started: workers=%d max_size=%d", self._max_workers, self._queue.maxsize)

    async def stop(self) -> None:
        """Cancel all workers and drain remaining tasks."""
        for w in self._workers:
            w.cancel()
        results = await asyncio.gather(*self._workers, return_exceptions=True)
        for r in results:
            if r is not None and not isinstance(r, asyncio.CancelledError):
                log.warning("TaskQueue worker exception on stop: %s", r)
        self._workers.clear()
        log.info("TaskQueue stopped")

    async def enqueue(
        self,
        coro_factory: Callable[[], Awaitable[T]],
        *,
        priority: int = 0,
    ) -> asyncio.Future[T]:
        """Enqueue a factory that creates a coroutine when a worker picks it up.

        Returns a Future that resolves when the task completes.
        Callers may fire-and-forget (ignore the Future) or await it.
        """
        future: asyncio.Future[T] = asyncio.get_running_loop().create_future()
        task = _Task(priority=priority, coro_factory=coro_factory, future=future)
        await self._queue.put(task)
        return future

    @property
    def pending(self) -> int:
        """Number of tasks waiting in the queue."""
        return self._queue.qsize()

    async def _worker(self, wid: int) -> None:
        while True:
            try:
                task = await self._queue.get()
            except asyncio.CancelledError:
                break  # graceful shutdown
            try:
                result = await task.coro_factory()
                if not task.future.done():
                    task.future.set_result(result)
            except asyncio.CancelledError:
                if not task.future.done():
                    task.future.cancel()
                break
            except Exception as exc:
                if not task.future.done():
                    task.future.set_exception(exc)
            finally:
                self._queue.task_done()
```

- [ ] **Step 2: Write TaskQueue tests**

```python
# backend/tests/test_task_queue.py
import asyncio

import pytest

from infrastructure.queue import TaskQueue


@pytest.fixture
async def queue():
    q = TaskQueue(max_workers=2, max_size=10)
    await q.start()
    yield q
    await q.stop()


class TestTaskQueue:

    @pytest.mark.asyncio
    async def test_enqueue_and_await_result(self, queue):
        async def work():
            await asyncio.sleep(0.01)
            return 42

        future = await queue.enqueue(lambda: work(), priority=0)
        result = await future
        assert result == 42

    @pytest.mark.asyncio
    async def test_fire_and_forget(self, queue):
        results = []

        async def work():
            results.append(1)

        await queue.enqueue(lambda: work())
        # Give worker time to process
        await asyncio.sleep(0.05)
        assert results == [1]

    @pytest.mark.asyncio
    async def test_multiple_tasks(self, queue):
        async def work(n):
            await asyncio.sleep(0.01)
            return n * 2

        futures = []
        for i in range(5):
            futures.append(await queue.enqueue(lambda n=i: work(n)))
        results = await asyncio.gather(*futures)
        assert sorted(results) == [0, 2, 4, 6, 8]

    @pytest.mark.asyncio
    async def test_priority_ordering(self, queue):
        order = []

        async def high():
            order.append("high")

        async def low():
            order.append("low")

        # Enqueue low priority first, then high
        # Note: this test may have timing sensitivity.
        # Priority queue ensures high-priority tasks are dequeued first.
        await queue.enqueue(lambda: low(), priority=10)
        await queue.enqueue(lambda: high(), priority=0)
        await asyncio.sleep(0.1)
        # High (priority 0) should be processed before low (priority 10)
        assert order[0] == "high"

    @pytest.mark.asyncio
    async def test_exception_propagates_to_future(self, queue):
        async def fail():
            raise ValueError("boom")

        future = await queue.enqueue(lambda: fail(), priority=0)
        with pytest.raises(ValueError, match="boom"):
            await future

    @pytest.mark.asyncio
    async def test_pending_count(self, queue):
        async def slow():
            await asyncio.sleep(0.1)

        assert queue.pending == 0
        await queue.enqueue(lambda: slow(), priority=0)
        await queue.enqueue(lambda: slow(), priority=0)
        await asyncio.sleep(0.01)
        # 2 workers, both busy, queue should have 0 pending (both dequeued)
        assert queue.pending <= 0
```

- [ ] **Step 3: Run tests**

Run: `cd backend && .venv\Scripts\python -m pytest tests/test_task_queue.py -v`
Expected: 6 PASS

- [ ] **Step 4: Commit**

```bash
git add backend/infrastructure/queue.py backend/tests/test_task_queue.py
git commit -m "✨ feat: add TaskQueue — bounded priority background worker pool"
```

---

### Task 5: Cache Infrastructure (EmotionCache, InitiativeCache)

**Files:**
- Create: `backend/infrastructure/cache.py`
- Create: `backend/tests/test_cache_infrastructure.py`

- [ ] **Step 1: Write cache classes**

```python
# backend/infrastructure/cache.py
"""In-memory caches — EmotionCache, InitiativeCache.

Replaces module-level dicts in services/patient_ai/ that were
accessed across modules via private variable imports.
"""

import logging
from dataclasses import dataclass

log = logging.getLogger(__name__)


@dataclass
class EmotionState:
    score: int
    state: str
    note: str


class EmotionCache:
    """Per-record emotion state cache. Non-persistent, lives in app.state."""

    def __init__(self) -> None:
        self._store: dict[int, EmotionState] = {}

    def get(self, record_id: int) -> EmotionState:
        """Get or create default emotion state."""
        if record_id not in self._store:
            self._store[record_id] = EmotionState(score=0, state="neutral", note="初始状态")
        return self._store[record_id]

    def set(self, record_id: int, score: int, state: str, note: str) -> None:
        self._store[record_id] = EmotionState(score=score, state=state, note=note)

    def cleanup(self, record_id: int) -> None:
        self._store.pop(record_id, None)

    def cleanup_completed(self, completed_ids: set[int]) -> int:
        """Remove entries for completed records. Returns count removed."""
        count = 0
        for rid in completed_ids:
            if rid in self._store:
                del self._store[rid]
                count += 1
        if count:
            log.info("Cleaned %d completed emotion cache entries", count)
        return count

    @property
    def size(self) -> int:
        return len(self._store)


class InitiativeCache:
    """Per-record initiative timer cache. Non-persistent, lives in app.state."""

    def __init__(self) -> None:
        self._timers: dict[int, float] = {}
        self._last_triggers: dict[int, float] = {}

    def update_timer(self, record_id: int, timestamp: float) -> None:
        self._timers[record_id] = timestamp
        self._last_triggers.pop(record_id, None)

    def get_timer(self, record_id: int, default: float) -> float:
        return self._timers.get(record_id, default)

    def get_last_trigger(self, record_id: int) -> float:
        return self._last_triggers.get(record_id, 0.0)

    def set_last_trigger(self, record_id: int, timestamp: float) -> None:
        self._last_triggers[record_id] = timestamp

    def cleanup(self, record_id: int) -> None:
        self._timers.pop(record_id, None)
        self._last_triggers.pop(record_id, None)

    def cleanup_completed(self, completed_ids: set[int]) -> int:
        """Remove entries for completed records. Returns count removed."""
        count = 0
        for rid in completed_ids:
            if rid in self._timers:
                del self._timers[rid]
                count += 1
            if rid in self._last_triggers:
                del self._last_triggers[rid]
                count += 1
        if count:
            log.info("Cleaned %d completed initiative cache entries", count)
        return count

    @property
    def size(self) -> int:
        return len(self._timers)
```

- [ ] **Step 2: Write cache tests**

```python
# backend/tests/test_cache_infrastructure.py
from infrastructure.cache import EmotionCache, EmotionState, InitiativeCache


class TestEmotionCache:

    def test_get_creates_default(self):
        cache = EmotionCache()
        state = cache.get(1)
        assert state.score == 0
        assert state.state == "neutral"

    def test_set_and_get(self):
        cache = EmotionCache()
        cache.set(1, score=2, state="engaged", note="良好")
        state = cache.get(1)
        assert state.score == 2
        assert state.state == "engaged"
        assert state.note == "良好"

    def test_cleanup_removes(self):
        cache = EmotionCache()
        cache.set(1, score=1, state="neutral", note="")
        assert cache.size == 1
        cache.cleanup(1)
        assert cache.size == 0
        # get after cleanup creates fresh default
        state = cache.get(1)
        assert state.score == 0

    def test_cleanup_completed(self):
        cache = EmotionCache()
        cache.set(1, score=0, state="neutral", note="")
        cache.set(2, score=0, state="neutral", note="")
        cache.set(3, score=0, state="neutral", note="")
        removed = cache.cleanup_completed({1, 3})
        assert removed == 2
        assert cache.size == 1


class TestInitiativeCache:

    def test_update_and_get_timer(self):
        cache = InitiativeCache()
        cache.update_timer(1, 1000.0)
        assert cache.get_timer(1, 0.0) == 1000.0
        assert cache.get_timer(999, 5.0) == 5.0

    def test_last_trigger(self):
        cache = InitiativeCache()
        assert cache.get_last_trigger(1) == 0.0
        cache.set_last_trigger(1, 2000.0)
        assert cache.get_last_trigger(1) == 2000.0

    def test_update_timer_clears_trigger(self):
        cache = InitiativeCache()
        cache.set_last_trigger(1, 2000.0)
        cache.update_timer(1, 3000.0)
        assert cache.get_last_trigger(1) == 0.0

    def test_cleanup(self):
        cache = InitiativeCache()
        cache.update_timer(1, 1000.0)
        cache.set_last_trigger(1, 2000.0)
        assert cache.size == 1
        cache.cleanup(1)
        assert cache.size == 0

    def test_cleanup_completed(self):
        cache = InitiativeCache()
        cache.update_timer(1, 1000.0)
        cache.update_timer(2, 2000.0)
        removed = cache.cleanup_completed({1})
        assert removed >= 1
        assert cache.size == 1
```

- [ ] **Step 3: Run tests**

Run: `cd backend && .venv\Scripts\python -m pytest tests/test_cache_infrastructure.py -v`
Expected: 8 PASS

- [ ] **Step 4: Commit**

```bash
git add backend/infrastructure/cache.py backend/tests/test_cache_infrastructure.py
git commit -m "✨ feat: add EmotionCache and InitiativeCache as injectable instances"
```

---

### Task 6: Seed Data Extraction

**Files:**
- Create: `backend/core/seed.py`
- Modify: `backend/main.py` (later task — lifespan rewrite)

- [ ] **Step 1: Extract _seed_data and _seed_llm from main.py**

Read `backend/main.py` lines 60-256 (the `_seed_data` and `_seed_llm` functions). Move them into `backend/core/seed.py` with the following structure:

```python
# backend/core/seed.py
"""Database seeding — default school, roles, admin user, test data, LLM config.

Extracted from main.py to keep the application entrypoint thin.
Called once during app startup (lifespan).
"""

import logging
import os

from core.config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL
from core.database import SessionLocal
from core.roles import SYSTEM_PERMISSIONS, SYSTEM_ROLES
from core.security import hash_password
from models import Case, Role, RolePermission, Rubric, School, User
from models import ApiSecret, LLMConfig
from services.llm.crypto_utils import encrypt_api_key

log = logging.getLogger(__name__)


def seed_all() -> None:
    """Run all seed operations. Safe to call multiple times (idempotent)."""
    _seed_data()
    _seed_llm()


def _seed_data() -> None:
    """Create default school, system roles, admin user, test students, cases, rubrics."""
    db = SessionLocal()
    try:
        school = db.query(School).filter(School.name == "默认学校").first()
        if not school:
            school = School(name="默认学校")
            db.add(school)
            db.flush()
            log.info("默认学校已创建")

        # ... (copy the rest of _seed_data from main.py lines 69-192 exactly)
        # The logic is unchanged — just relocated.
    finally:
        db.close()


def _seed_llm() -> None:
    """Create initial LLM API key and purpose configs from env vars."""
    # ... (copy the rest of _seed_llm from main.py lines 197-256 exactly)
```

**IMPORTANT:** The actual seed logic (lines 69-192 and 197-256 of `backend/main.py`) must be copied verbatim. Do NOT rewrite the seeding logic — only relocate it.

- [ ] **Step 2: Verify no imports are broken**

Run: `cd backend && .venv\Scripts\python -c "from core.seed import seed_all; print('import OK')"`
Expected: `import OK`

- [ ] **Step 3: Commit**

```bash
git add backend/core/seed.py
git commit -m "♻️ refactor: extract seed data to core/seed.py"
```

---

### Task 7: Rewrite dependencies.py

**Files:**
- Modify: `backend/middleware/dependencies.py` (rewrite as `backend/core/dependencies.py`)
- Keep old file temporarily for backward compat

- [ ] **Step 1: Write new core/dependencies.py**

```python
# backend/core/dependencies.py
"""FastAPI dependency injection factories.

All infrastructure objects live on app.state and are injected
via Depends. No module-level global variables.
"""

from typing import Annotated

import httpx
from fastapi import Depends, Request

from infrastructure.cache import EmotionCache, InitiativeCache
from infrastructure.llm.client import LLMClient
from infrastructure.queue import TaskQueue
from middleware.rate_limits import RateLimiter
from services.llm.logging import LogWorker
from services.llm.router import ProfileRouter
from services.prompt.manager import PromptManager


# ── Infrastructure ──

def get_httpx_client(request: Request) -> httpx.AsyncClient:
    return request.app.state.httpx_client


def get_llm_router(request: Request) -> ProfileRouter:
    return request.app.state.llm_router


def get_log_worker(request: Request) -> LogWorker:
    return request.app.state.log_worker


def get_prompt_manager(request: Request) -> PromptManager:
    return request.app.state.prompt_manager


def get_rate_limiter(request: Request) -> RateLimiter:
    return request.app.state.rate_limiter


def get_llm_client(request: Request) -> LLMClient:
    return request.app.state.llm_client


def get_task_queue(request: Request) -> TaskQueue:
    return request.app.state.task_queue


def get_emotion_cache(request: Request) -> EmotionCache:
    return request.app.state.emotion_cache


def get_initiative_cache(request: Request) -> InitiativeCache:
    return request.app.state.initiative_cache


# ── School filter ──

def resolve_school_filter(source_user, school_id_param: int | None = None) -> int | None:
    if source_user is None:
        return school_id_param
    return source_user.school_id


# ── Type aliases for Depends ──

HttpxClientDep = Annotated[httpx.AsyncClient, Depends(get_httpx_client)]
LLMRouterDep = Annotated[ProfileRouter, Depends(get_llm_router)]
PromptManagerDep = Annotated[PromptManager, Depends(get_prompt_manager)]
LLMClientDep = Annotated[LLMClient, Depends(get_llm_client)]
TaskQueueDep = Annotated[TaskQueue, Depends(get_task_queue)]
EmotionCacheDep = Annotated[EmotionCache, Depends(get_emotion_cache)]
InitiativeCacheDep = Annotated[InitiativeCache, Depends(get_initiative_cache)]
```

- [ ] **Step 2: Verify imports**

Run: `cd backend && .venv\Scripts\python -c "from core.dependencies import get_llm_client; print('import OK')"`
Expected: `import OK`

- [ ] **Step 3: Commit**

```bash
git add backend/core/dependencies.py
git commit -m "♻️ refactor: rewrite dependencies.py with full injection coverage"
```

---

### Task 8: Repository Layer — Base + Training

**Files:**
- Create: `backend/repositories/__init__.py`
- Create: `backend/repositories/base.py`
- Create: `backend/repositories/training.py`

- [ ] **Step 1: Write SyncRepository base**

```python
# backend/repositories/base.py
"""SyncRepository — base class for synchronous SQLAlchemy data access.

All DB operations run via asyncio.to_thread() to avoid blocking
the single event loop.
"""

import asyncio
from collections.abc import Callable
from typing import TypeVar

from sqlalchemy.orm import Session

from core.database import SessionLocal

T = TypeVar("T")


class SyncRepository:
    """Base class for repositories using synchronous SQLAlchemy sessions."""

    def __init__(self, session_factory=SessionLocal):
        self._session_factory = session_factory

    async def _run(self, fn: Callable[..., T], *args, **kwargs) -> T:
        """Execute fn(*args, **kwargs) in the default thread pool."""
        return await asyncio.to_thread(fn, *args, **kwargs)

    async def _run_in_session(self, fn: Callable[[Session], T]) -> T:
        """Execute fn(session) in a new session, auto-close after."""

        def _do() -> T:
            session = self._session_factory()
            try:
                return fn(session)
            finally:
                session.close()

        return await self._run(_do)
```

- [ ] **Step 2: Write TrainingRepository**

```python
# backend/repositories/training.py
"""TrainingRecord repository."""

from datetime import UTC, datetime

from sqlalchemy import func, text
from sqlalchemy.orm import Session, joinedload

from models import Case, Message, TrainingRecord
from repositories.base import SyncRepository


class TrainingRepository(SyncRepository):
    """Data access for TrainingRecord and related entities."""

    async def find_by_id(self, record_id: int) -> TrainingRecord | None:
        def _do(session: Session) -> TrainingRecord | None:
            return (
                session.query(TrainingRecord)
                .options(
                    joinedload(TrainingRecord.case),
                    joinedload(TrainingRecord.user),
                    joinedload(TrainingRecord.score),
                    joinedload(TrainingRecord.messages),
                )
                .filter(TrainingRecord.id == record_id)
                .first()
            )
        return await self._run_in_session(_do)

    async def find_messages(self, record_id: int) -> list[Message]:
        def _do(session: Session) -> list[Message]:
            return (
                session.query(Message)
                .filter(Message.record_id == record_id)
                .order_by(Message.created_at)
                .all()
            )
        return await self._run_in_session(_do)

    async def find_timeout_records(self) -> list[TrainingRecord]:
        def _do(session: Session) -> list[TrainingRecord]:
            now = datetime.now(UTC)
            return (
                session.query(TrainingRecord)
                .filter(TrainingRecord.status == "in_progress")
                .filter(
                    text(
                        "training_records.start_time + "
                        "(training_records.time_limit * interval '1 minute') < :now"
                    ).bindparams(now=now)
                )
                .all()
            )
        return await self._run_in_session(_do)

    async def mark_completed(self, record_id: int) -> None:
        def _do(session: Session) -> None:
            record = session.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
            if record:
                record.status = "completed"
                record.end_time = datetime.now(UTC)
                session.commit()
        await self._run_in_session(_do)

    async def update_scoring_status(self, record_id: int, status: str, error: str | None = None) -> None:
        def _do(session: Session) -> None:
            record = session.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
            if record:
                record.scoring_status = status
                if error is not None:
                    record.scoring_error = error
                session.commit()
        await self._run_in_session(_do)

    async def delete_cascade(self, record_id: int) -> None:
        def _do(session: Session) -> None:
            from models import LLMCallLog, Note, Score
            session.query(Message).filter(Message.record_id == record_id).delete()
            session.query(Score).filter(Score.record_id == record_id).delete()
            session.query(Note).filter(Note.record_id == record_id).delete()
            session.query(LLMCallLog).filter(LLMCallLog.record_id == record_id).delete()
            record = session.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
            if record:
                session.delete(record)
            session.commit()
        await self._run_in_session(_do)
```

- [ ] **Step 3: Write __init__.py**

```python
# backend/repositories/__init__.py
"""Data access layer."""
from .base import SyncRepository
from .training import TrainingRepository

__all__ = ["SyncRepository", "TrainingRepository"]
```

- [ ] **Step 4: Commit**

```bash
git add backend/repositories/
git commit -m "✨ feat: add repository layer — base + TrainingRepository"
```

---

### Task 9: Rewrite main.py Lifespan

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Rewrite main.py with new lifespan**

```python
# backend/main.py
"""Virtual Patient Training System — FastAPI application entrypoint."""

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager, suppress

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from core.config import (
    APP_VERSION,
    CLEANUP_INTERVAL_SECONDS,
    LLM_CONNECTION_KEEPALIVE,
    LLM_CONNECTION_POOL_SIZE,
    log_config,
    validate_config,
)
from core.database import engine, get_db, init_db
from core.logging_setup import setup_logging
from core.seed import seed_all
from infrastructure.cache import EmotionCache, InitiativeCache
from infrastructure.llm.client import LLMClient
from infrastructure.queue import TaskQueue
from middleware.rate_limits import RateLimiter
from services.llm.logging import LogWorker
from services.llm.router import ProfileRouter
from services.prompt.manager import PromptManager

log = logging.getLogger(__name__)

_MAX_REQUEST_BYTES = int(os.getenv("MAX_REQUEST_BYTES", str(10 * 1024 * 1024)))


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    validate_config()
    log.info("虚拟患者训练系统 v%s", APP_VERSION)
    log_config(log)

    # 1. DB init
    log.info("── 1/4 数据库 ──")
    init_db()
    log.info("数据库迁移完成")

    # 2. Seed data
    log.info("── 2/4 种子数据 ──")
    seed_all()
    log.info("种子数据就绪")

    # 3. Infrastructure
    log.info("── 3/4 基础设施 ──")
    app.state.rate_limiter = RateLimiter()

    app.state.httpx_client = httpx.AsyncClient(
        timeout=httpx.Timeout(120, connect=15.0),
        limits=httpx.Limits(
            max_connections=LLM_CONNECTION_POOL_SIZE,
            max_keepalive_connections=LLM_CONNECTION_KEEPALIVE,
            keepalive_expiry=30,
        ),
    )

    app.state.llm_router = ProfileRouter()
    await app.state.llm_router.load_from_db()
    log.info("密钥路由就绪")

    app.state.prompt_manager = PromptManager()
    await app.state.prompt_manager.load_from_db()
    log.info("提示词管理器就绪")

    app.state.log_worker = LogWorker()
    await app.state.log_worker.start()
    log.info("LLM 日志写入器就绪")

    app.state.llm_client = LLMClient(
        http=app.state.httpx_client,
        router=app.state.llm_router,
        log_worker=app.state.log_worker,
    )

    app.state.task_queue = TaskQueue(max_workers=3)
    await app.state.task_queue.start()
    log.info("后台任务队列就绪")

    app.state.emotion_cache = EmotionCache()
    app.state.initiative_cache = InitiativeCache()

    # 4. Background loops
    log.info("── 4/4 后台服务 ──")
    cleanup_task = asyncio.create_task(_rate_limiter_cleanup(app.state.rate_limiter))
    app.state._cleanup_task = cleanup_task

    from services.training.settlement_v2 import settlement_loop
    settlement_task = asyncio.create_task(
        settlement_loop(
            repo=None,  # will be injected when TrainingRepository is available
            task_queue=app.state.task_queue,
            interval=CLEANUP_INTERVAL_SECONDS,
        )
    )
    app.state._settlement_task = settlement_task
    log.info("自动结算就绪 (间隔=%ds)", CLEANUP_INTERVAL_SECONDS)

    _loop = asyncio.get_running_loop()
    _loop.set_exception_handler(_handle_task_exception)

    log.info("── 启动完成 ──")
    yield

    # Shutdown
    log.info("正在关闭...")
    cleanup_task.cancel()
    with suppress(asyncio.CancelledError):
        await cleanup_task
    settlement_task.cancel()
    with suppress(asyncio.CancelledError):
        await settlement_task
    await app.state.task_queue.stop()
    await app.state.log_worker.stop()
    if app.state.httpx_client:
        await app.state.httpx_client.aclose()
    await asyncio.to_thread(engine.dispose)
    log.info("服务已关闭")


async def _rate_limiter_cleanup(rate_limiter: RateLimiter):
    while True:
        await asyncio.sleep(600)
        await rate_limiter.cleanup()


def _handle_task_exception(loop, ctx):
    msg = ctx.get("message", "")
    exc = ctx.get("exception")
    task_name = getattr(ctx.get("task"), "get_name", lambda: "?")() if ctx.get("task") else "?"
    log.error("asyncio task 异常 %s: %s | %s", task_name, msg, exc)


app = FastAPI(title="虚拟患者训练系统", version=APP_VERSION, lifespan=lifespan)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    if isinstance(exc, HTTPException):
        raise exc
    log.error("未处理异常 %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(status_code=500, content={"detail": "服务器内部错误"})


@app.middleware("http")
async def _log_requests(request: Request, call_next):
    t0 = time.perf_counter()
    response = await call_next(request)
    ms = int((time.perf_counter() - t0) * 1000)
    if response.status_code >= 500:
        log.error("%s %s → %d [%dms]", request.method, request.url.path, response.status_code, ms)
    elif response.status_code >= 400:
        log.warning("%s %s → %d [%dms]", request.method, request.url.path, response.status_code, ms)
    return response


@app.middleware("http")
async def _limit_body_size(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > _MAX_REQUEST_BYTES:
        return JSONResponse(status_code=413, content={"detail": "请求体过大"})
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:8000").split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Route registration
from routers import (
    admin, admin_classes, admin_grades, auth, cases, chat,
    export, feedback, notes, nursing_records, qa, questionnaires, stats, training,
)
from routers.admin_api import router as admin_api_router
from routers.admin_prompts import router as admin_prompts_router
from routers.admin_roles import router as admin_roles_router
from routers.admin_schools import router as admin_schools_router

for mod in [auth, admin, admin_classes, admin_grades, cases, chat, export, feedback, notes, nursing_records, qa, questionnaires, stats, training]:
    app.include_router(mod.router)
app.include_router(admin_api_router)
app.include_router(admin_prompts_router)
app.include_router(admin_schools_router)
app.include_router(admin_roles_router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": APP_VERSION}
```

- [ ] **Step 2: Write async settlement loop**

```python
# backend/services/training/settlement_v2.py
"""Async settlement loop — auto-completes timed-out training sessions.

Replaces the sync-in-async hybrid in settlement.py.
All DB access via repository (to_thread). Scoring via TaskQueue.
"""

import asyncio
import logging
import re
from datetime import UTC, datetime

from core.config import AUTO_SCORE_AI_CHARS_MIN, AUTO_SCORE_COVERED_INQUIRIES_MIN, AUTO_SCORE_STUDENT_CHARS_MIN
from core.database import SessionLocal
from infrastructure.cache import EmotionCache, InitiativeCache
from infrastructure.queue import TaskQueue
from models import Case, Message

log = logging.getLogger(__name__)


def _count_covered_inquiries(inquiries: list[str], student_text: str) -> int:
    if not inquiries:
        return 0
    covered = 0
    for inquiry in inquiries:
        cleaned = re.sub(r"[（）()]", " ", inquiry)
        tokens = set()
        for i in range(len(cleaned) - 1):
            token = cleaned[i:i + 2]
            if token.strip():
                tokens.add(token)
        if any(token in student_text for token in tokens):
            covered += 1
    return covered


def _should_auto_score(messages: list, case_data: dict) -> bool:
    inquiries = case_data.get("required_inquiries", [])
    student_text = "".join(m.content for m in messages if getattr(m, "role", None) == "student")
    ai_text = "".join(m.content for m in messages if getattr(m, "role", None) == "patient")
    covered = _count_covered_inquiries(inquiries, student_text)
    return (
        covered >= AUTO_SCORE_COVERED_INQUIRIES_MIN
        and len(student_text) >= AUTO_SCORE_STUDENT_CHARS_MIN
        and len(ai_text) >= AUTO_SCORE_AI_CHARS_MIN
    )


async def settlement_loop(
    repo,
    task_queue: TaskQueue,
    interval: int = 30,
    emotion_cache: EmotionCache | None = None,
    initiative_cache: InitiativeCache | None = None,
) -> None:
    """Periodic loop: find timed-out sessions, mark completed, optionally trigger scoring."""
    while True:
        await asyncio.sleep(interval)
        try:
            await _settle_once(repo, task_queue, emotion_cache, initiative_cache)
        except Exception:
            log.exception("自动结算循环异常")


async def _settle_once(
    repo,
    task_queue: TaskQueue,
    emotion_cache: EmotionCache | None,
    initiative_cache: InitiativeCache | None,
) -> None:
    timeout_records = await repo.find_timeout_records()
    if not timeout_records:
        # Check for orphaned cache entries
        if emotion_cache and initiative_cache:
            await _cleanup_orphaned_cache(repo, emotion_cache, initiative_cache)
        return

    log.info("发现 %d 个超时会话，开始自动结算", len(timeout_records))

    for record in timeout_records:
        try:
            messages = await repo.find_messages(record.id)

            # fetch case data for scoring decision
            case_data = {}
            db = SessionLocal()
            try:
                case = db.query(Case).filter(Case.id == record.case_id).first()
                if case and case.case_data:
                    case_data = case.case_data
            finally:
                db.close()

            await repo.mark_completed(record.id)

            if emotion_cache:
                emotion_cache.cleanup(record.id)
            if initiative_cache:
                initiative_cache.cleanup(record.id)

            if _should_auto_score(messages, case_data):
                from services.scoring.engine import evaluate_training

                await repo.update_scoring_status(record.id, "pending")
                # Fire-and-forget scoring via task queue
                await task_queue.enqueue(
                    lambda rid=record.id, cd=case_data: _run_scoring_job(rid, cd, repo),
                    priority=5,
                )
                log.info("自动结算+评分: record_id=%d", record.id)
            else:
                log.info("自动结算(跳过评分): record_id=%d", record.id)
        except Exception:
            log.exception("自动结算 record_id=%d 失败", record.id)


async def _run_scoring_job(record_id: int, case_data: dict, repo) -> None:
    """Wrapper for scoring that updates status on completion/failure."""
    from services.scoring.engine import evaluate_training
    from services.llm.infra import get_client, get_router, get_pm, get_log_worker

    try:
        await repo.update_scoring_status(record_id, "processing")
        db = SessionLocal()
        try:
            await asyncio.wait_for(
                evaluate_training(
                    record_id, case_data, db,
                    pm=get_pm(),
                    router=get_router(),
                    log_worker=get_log_worker(),
                    client=get_client(),
                ),
                timeout=300,
            )
            await repo.update_scoring_status(record_id, "completed")
        finally:
            db.close()
    except TimeoutError:
        await repo.update_scoring_status(record_id, "failed", "评分超时（超过5分钟）")
        log.exception("评分超时 record_id=%d", record_id)
    except Exception as e:
        await repo.update_scoring_status(record_id, "failed", str(e)[:2000])
        log.exception("评分失败 record_id=%d", record_id)


async def _cleanup_orphaned_cache(
    repo, emotion_cache: EmotionCache, initiative_cache: InitiativeCache
) -> None:
    """Remove cache entries for records that are already completed."""
    # Collect all record IDs from both caches
    record_ids: set[int] = set()
    # EmotionCache internal inspection — we read the private _store for cleanup
    # (acceptable since both are owned by this module's lifecycle)
    record_ids.update(emotion_cache._store.keys())
    record_ids.update(initiative_cache._timers.keys())
    record_ids.update(initiative_cache._last_triggers.keys())

    if not record_ids:
        return

    # Find which ones are completed
    db = SessionLocal()
    try:
        from models import TrainingRecord
        completed = set(
            row[0] for row in db.query(TrainingRecord.id).filter(
                TrainingRecord.id.in_(list(record_ids)),
                TrainingRecord.status == "completed",
            ).all()
        )
    finally:
        db.close()

    e_removed = emotion_cache.cleanup_completed(completed)
    i_removed = initiative_cache.cleanup_completed(completed)
    if e_removed or i_removed:
        log.info("清理了 %d emotion + %d initiative 缓存条目", e_removed, i_removed)
```

- [ ] **Step 3: Verify imports and startup**

Run: `cd backend && .venv\Scripts\python -c "from main import app; print('app OK')"`
Expected: `app OK`

- [ ] **Step 4: Commit**

```bash
git add backend/main.py backend/services/training/settlement_v2.py
git commit -m "♻️ refactor: rewrite main.py lifespan + async settlement loop"
```

---

### Task 10: Migrate patient_initiative.py to cache instances

**Files:**
- Modify: `backend/services/patient_ai/patient_initiative.py`

- [ ] **Step 1: Replace module-level dicts with optional cache parameters**

Currently, `patient_initiative.py` uses module-level `_initiative_timers: dict[int, float] = {}` and `_last_trigger_time: dict[int, float] = {}`. Add new functions that accept cache instances, while keeping backward-compatible wrappers:

```python
# Add to the END of patient_initiative.py (after existing functions):

# ── Cache-aware variants (backward compatible) ──

def update_initiative_timer_v2(
    record_id: int,
    cache: "InitiativeCache",
    last_reply_length: int = 0,
) -> None:
    """Reset the initiative timer using a cache instance."""
    from datetime import UTC, datetime
    now = datetime.now(UTC).timestamp()
    cache.update_timer(record_id, now)


def get_initiative_seconds_v2(
    record_id: int,
    cache: "InitiativeCache",
    personality: dict,
    emotion_score: int,
) -> tuple[float, float]:
    """Return (elapsed, threshold) using a cache instance."""
    from datetime import UTC, datetime
    now = datetime.now(UTC).timestamp()
    last_reply = cache.get_timer(record_id, now)
    elapsed = now - last_reply

    patience = personality.get("patience", "normal")
    anxiety_trait = personality.get("anxiety_trait", "normal")
    patience_bias = {"low": -8, "normal": 0, "high": +10}
    anxiety_bias = {"anxious": -5, "normal": 0, "calm": +5}
    emotion_bias = emotion_score * -3
    threshold = 30.0 + patience_bias.get(patience, 0) + anxiety_bias.get(anxiety_trait, 0) + emotion_bias
    threshold = max(15, min(90, threshold))
    return elapsed, threshold


def should_initiate_v2(
    record_id: int,
    cache: "InitiativeCache",
    personality: dict,
    emotion_score: int,
) -> bool:
    """Check using a cache instance."""
    from datetime import UTC, datetime
    elapsed, threshold = get_initiative_seconds_v2(record_id, cache, personality, emotion_score)
    if elapsed < threshold:
        return False
    now = datetime.now(UTC).timestamp()
    last_trigger = cache.get_last_trigger(record_id)
    if now - last_trigger < 8:
        return False
    cache.set_last_trigger(record_id, now)
    return True


def cleanup_initiative_v2(record_id: int, cache: "InitiativeCache") -> None:
    cache.cleanup(record_id)
```

- [ ] **Step 2: Add similar for emotion_engine**

```python
# Add to the END of services/patient_ai/emotion_engine.py:

def get_emotion_v2(record_id: int, cache: "EmotionCache") -> "EmotionState":
    return cache.get(record_id)

def cleanup_emotion_v2(record_id: int, cache: "EmotionCache") -> None:
    cache.cleanup(record_id)
```

- [ ] **Step 3: Commit**

```bash
git add backend/services/patient_ai/patient_initiative.py backend/services/patient_ai/emotion_engine.py
git commit -m "♻️ refactor: add cache-aware variants to patient_ai modules"
```

---

### Task 11: Cleanup — Delete infra.py, update imports

**Files:**
- Delete: `backend/services/llm/infra.py`
- Delete: `backend/services/llm/service.py`
- Modify: `backend/services/llm/__init__.py`
- Modify: `backend/services/training/__init__.py`

- [ ] **Step 1: Update services/llm/__init__.py**

Remove `call_llm`, `call_llm_json`, `call_llm_stream` from exports (they moved to `infrastructure/llm/client.py`). Keep router, logging, crypto, parsing, catalog.

```python
# backend/services/llm/__init__.py
from .crypto_utils import decrypt_api_key, encrypt_api_key
from .logging import LogWorker
from .parsing import _safe_parse_json
from .provider_catalog import (
    get_catalog,
    get_models_for,
    infer_provider_name,
    match_provider,
)
from .router import (
    ProfileRouter,
    _SyntheticConfig,
    get_env_fallback_state,
    set_env_fallback_state,
)

__all__ = [
    "ProfileRouter",
    "LogWorker",
    "_SyntheticConfig",
    "_safe_parse_json",
    "decrypt_api_key",
    "encrypt_api_key",
    "get_catalog",
    "get_models_for",
    "infer_provider_name",
    "match_provider",
    "get_env_fallback_state",
    "set_env_fallback_state",
]
```

- [ ] **Step 2: Delete old files**

```bash
Remove-Item -LiteralPath "backend\services\llm\infra.py"
Remove-Item -LiteralPath "backend\services\llm\service.py"
```

- [ ] **Step 3: Update services/training/__init__.py**

```python
# backend/services/training/__init__.py
from .session import get_config, get_default_config, list_configs
from .settlement_v2 import settlement_loop

__all__ = [
    "get_config",
    "get_default_config",
    "list_configs",
    "settlement_loop",
]
```

- [ ] **Step 4: Find and fix all remaining references to deleted code**

Run a search to find files that still import from the deleted modules:

```bash
cd backend && rg "from services.llm.infra import|from services.llm.service import|from services.llm import (call_llm|call_llm_json|call_llm_stream)" --include="*.py"
```

For each match found, update the import:
- `from services.llm.infra import get_client, get_router, get_pm, get_log_worker, schedule_background` → `from core.dependencies import get_llm_client, get_task_queue` (or use Depends)
- `from services.llm import call_llm` → `from infrastructure.llm.client import LLMClient` (obtain via Depends)
- `from services.llm import call_llm_json` → use `llm_client.call_json(...)` where `llm_client: LLMClient` is injected
- `from services.llm import call_llm_stream` → use `llm_client.stream(...)` where `llm_client: LLMClient` is injected

Expected matches and their fixes:

| File | Old Import | New Pattern |
|------|-----------|-------------|
| `routers/training.py:122` | `from services.llm.infra import get_client, get_router, get_pm, get_log_worker` | Use Depends injection or task queue |
| `routers/training.py:214,261` | `from services.llm.infra import schedule_background` | `await task_queue.enqueue(...)` |
| `services/scoring/engine.py` | `from services.llm import call_llm_json` | Accept `llm_client: LLMClient` parameter |
| `services/pipeline/middleware/llm_caller.py` | `from services.llm import call_llm, call_llm_stream` | Accept `llm_client: LLMClient` parameter |
| `services/qa/` | `from services.llm import call_llm, call_llm_stream` | Accept `llm_client: LLMClient` parameter |
| `routers/cases.py` | `from services.llm import call_llm_json` | Accept `llm_client: LLMClient` parameter |
| `main.py` | `from services.llm.infra import set_infra` | Remove — no longer needed |

This is the biggest search-and-replace task in the migration. Handle each file individually.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "🔥 remove: delete infra.py + service.py, update all imports"
```

---

### Task 12: Run Full Test Suite and Fix Regressions

- [ ] **Step 1: Run the full test suite**

```bash
cd backend && .venv\Scripts\python -m pytest tests/ -v --tb=short 2>&1 | Select-Object -Last 100
```

- [ ] **Step 2: Fix any test failures**

Common expected failures and fixes:
1. **Tests that import `from services.llm import call_llm`** → update to use mock LLMClient
2. **Tests that set `app.state.httpx_client` directly** → also need to set `app.state.llm_client`
3. **Tests that reference `services.llm.infra`** → remove those references
4. **conftest.py** → add mocks for new app.state fields (`llm_client`, `task_queue`, `emotion_cache`, `initiative_cache`)

Update `backend/tests/conftest.py` client fixture (around line 99-133) to also mock new state:

```python
# In conftest.py, inside the client fixture, add after line 129:
    app.state.log_worker = MagicMock()

    # New: mock LLM client
    mock_llm_client = MagicMock()
    mock_llm_client.call = AsyncMock(return_value="mock llm response")
    mock_llm_client.call_json = AsyncMock(return_value={"total_score": 85})
    mock_llm_client.stream = MagicMock()  # async generator mock
    app.state.llm_client = mock_llm_client

    # New: mock task queue
    mock_tq = MagicMock()
    mock_tq.enqueue = AsyncMock(return_value=MagicMock())  # returns a Future-like
    app.state.task_queue = mock_tq

    # New: mock caches
    from infrastructure.cache import EmotionCache, InitiativeCache
    app.state.emotion_cache = EmotionCache()
    app.state.initiative_cache = InitiativeCache()
```

- [ ] **Step 3: Verify all tests pass**

```bash
cd backend && .venv\Scripts\python -m pytest tests/ -v
```

Expected: All tests pass (or known pre-existing failures only).

- [ ] **Step 4: Run lint**

```bash
cd backend && .venv\Scripts\python -m ruff check .
```

Fix any new lint violations introduced (ignore pre-existing ones).

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "✅ test: fix test suite for v2 architecture"
```
