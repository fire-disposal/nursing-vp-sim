import asyncio

import pytest

from infra.queue import TaskQueue


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
            await asyncio.sleep(0)
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
        await asyncio.sleep(0)
        assert results == [1]

    @pytest.mark.asyncio
    async def test_multiple_tasks(self, queue):
        async def work(n):
            await asyncio.sleep(0)
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

        await queue.enqueue(lambda: low(), priority=10)
        await queue.enqueue(lambda: high(), priority=0)
        await asyncio.sleep(0)
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
            await asyncio.sleep(0)

        assert queue.pending == 0
        await queue.enqueue(lambda: slow(), priority=0)
        await queue.enqueue(lambda: slow(), priority=0)
        await asyncio.sleep(0)
        assert queue.pending <= 0
