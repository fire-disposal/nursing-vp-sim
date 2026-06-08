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
