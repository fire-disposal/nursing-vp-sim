"""TTS Circuit Breaker — prevents cascading failures when Volcengine TTS is degraded."""

import asyncio
import logging
import time
from collections.abc import Callable
from typing import Any, TypeVar

log = logging.getLogger(__name__)

T = TypeVar("T")


class CircuitOpenError(Exception):
    """Raised when the circuit breaker is open and the TTS service is unavailable."""


class TTSCircuitBreaker:
    def __init__(self, failure_threshold: int = 3, cooldown_seconds: int = 300):
        self._failure_threshold = failure_threshold
        self._cooldown_seconds = cooldown_seconds
        self._failure_count = 0
        self._last_failure_time: float = 0.0
        self._state: str = "closed"  # closed | open | half_open

    @property
    def state(self) -> str:
        return self._state

    async def call(self, fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        if self._state == "open":
            if time.monotonic() - self._last_failure_time >= self._cooldown_seconds:
                self._state = "half_open"
                log.info("TTS circuit breaker: open → half_open (cooldown expired)")
            else:
                raise CircuitOpenError("TTS service temporarily unavailable, using browser fallback")

        try:
            result = await fn(*args, **kwargs) if asyncio.iscoroutinefunction(fn) else fn(*args, **kwargs)
        except Exception:
            self._failure_count += 1
            self._last_failure_time = time.monotonic()
            if self._state == "half_open":
                self._state = "open"
                log.warning("TTS circuit breaker: half_open → open (trial failed)")
            elif self._failure_count >= self._failure_threshold:
                self._state = "open"
                log.warning(
                    "TTS circuit breaker: closed → open (%d consecutive failures, threshold=%d)",
                    self._failure_count,
                    self._failure_threshold,
                )
            raise

        if self._state == "half_open":
            self._state = "closed"
            log.info("TTS circuit breaker: half_open → closed (trial succeeded)")
        self._failure_count = 0
        return result
