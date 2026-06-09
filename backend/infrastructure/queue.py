"""TaskQueue — bounded priority background worker pool."""

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
    """Bounded priority task queue with configurable worker count."""

    def __init__(self, max_workers: int = 3, max_size: int = 100):
        if max_workers < 1:
            raise ValueError("max_workers must be >= 1")
        if max_size < 1:
            raise ValueError("max_size must be >= 1")
        self._queue: asyncio.PriorityQueue[_Task] = asyncio.PriorityQueue(maxsize=max_size)
        self._max_workers = max_workers
        self._workers: list[asyncio.Task[None]] = []

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
    ) -> asyncio.Future[T]:
        """Enqueue a factory that creates a coroutine when a worker picks it up.

        Returns a Future that resolves when the task completes or fails.
        Callers may fire-and-forget or await the future.
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
                if not task.future.done():
                    task.future.set_exception(exc)
            finally:
                self._queue.task_done()
