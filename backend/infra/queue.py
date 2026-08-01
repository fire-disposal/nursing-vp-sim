"""TaskQueue — bounded priority background worker pool."""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Generic, TypeVar

from core.config import QUEUE_ENQUEUE_TIMEOUT, SCORING_WORKERS

log = logging.getLogger(__name__)

T = TypeVar("T")


class QueueFullError(RuntimeError):
    """Raised when the task queue is full and the enqueue timeout expires."""


@dataclass(order=True)
class _Task(Generic[T]):
    priority: int
    coro_factory: Callable[[], Awaitable[T]] = field(compare=False)
    future: asyncio.Future[T] = field(compare=False)


class TaskQueue:
    """Bounded priority task queue with configurable worker count.

    Worker count determines scoring throughput.  Each worker processes one
    scoring task at a time (2 parallel LLM calls: scoring + feedback).  The
    LLM semaphore (per llm_profile.py, scoring=10, feedback=10) is the
    hard upper bound — workers beyond 10 will simply block on the semaphore.

    Default 8 workers ≈ 80% semaphore utilisation, leaving headroom for
    retry bursts.  At 8 workers, 50 concurrent scoring requests finish in
    ~10 minutes (50/8 × ~90s per task).

    Override via SCORING_WORKERS env var.  Values > 10 are capped with
    a warning since they cannot increase throughput.
    """

    def __init__(self, max_workers: int | None = None, max_size: int = 100):
        if max_workers is None:
            max_workers = SCORING_WORKERS
        _practical_max = 10  # bounded by scoring semaphore (llm_profile.py)
        if max_workers > _practical_max:
            log.warning(
                "SCORING_WORKERS=%d exceeds practical max %d (LLM semaphore bottleneck); throughput unchanged",
                max_workers,
                _practical_max,
            )
        if max_workers < 1:
            raise ValueError("max_workers must be >= 1")
        if max_size < 1:
            raise ValueError("max_size must be >= 1")
        self._queue: asyncio.PriorityQueue[_Task] = asyncio.PriorityQueue(maxsize=max_size)
        self._max_workers = max_workers
        self._workers: list[asyncio.Task[None]] = []
        self._enqueue_timeout = QUEUE_ENQUEUE_TIMEOUT

    async def start(self) -> None:
        """Spawn worker coroutines."""
        for i in range(self._max_workers):
            task = asyncio.create_task(self._worker(i), name=f"bg-worker-{i}")
            self._workers.append(task)
        log.debug("TaskQueue started: workers=%d max_size=%d", self._max_workers, self._queue.maxsize)

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
        timeout: float | None = None,
    ) -> asyncio.Future[T]:
        """Enqueue a factory that creates a coroutine when a worker picks it up.

        Returns a Future that resolves when the task completes or fails.
        Callers may fire-and-forget or await the future.

        Raises QueueFullError if the queue is full and the timeout expires.
        """
        if timeout is None:
            timeout = self._enqueue_timeout
        future: asyncio.Future[T] = asyncio.get_running_loop().create_future()
        task = _Task(priority=priority, coro_factory=coro_factory, future=future)
        try:
            await asyncio.wait_for(self._queue.put(task), timeout=timeout)
        except TimeoutError:
            pending = self._queue.qsize()
            log.error(
                "TaskQueue enqueue timed out after %.1fs: pending=%d capacity=%d",
                timeout,
                pending,
                self._queue.maxsize,
            )
            raise QueueFullError(f"评分队列繁忙，当前积压 {pending} 个任务，请稍后重试") from None
        return future

    @property
    def pending(self) -> int:
        """Number of tasks waiting in the queue."""
        return self._queue.qsize()

    @property
    def max_workers(self) -> int:
        """Configured worker count (scoring parallelism)."""
        return self._max_workers

    async def _worker(self, wid: int) -> None:
        while True:
            try:
                task = await self._queue.get()
            except asyncio.CancelledError:
                break
            try:
                result = await task.coro_factory()
                if not task.future.done():
                    task.future.set_result(result)
            except asyncio.CancelledError:
                if not task.future.done():
                    task.future.cancel()
                break
            except Exception as exc:
                log.exception("TaskQueue 任务异常", exc_info=exc)
                if not task.future.done():
                    task.future.set_exception(exc)
            finally:
                self._queue.task_done()
