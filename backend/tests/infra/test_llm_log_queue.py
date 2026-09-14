"""回归：LLM 日志队列必须按**字节**封顶（条数封顶不足以防内存爆炸）。

每条日志含 prompt/response 全文，学校场景单条可达数十~数百 KB；原先只按
``maxsize=2000`` 条封顶，最坏可占数百 MB 直接把 worker 推向 OOM。
现在超额时丢弃**最旧**条目并计数，配了 overflow_dir 时仍落盘兜底。

用例直接操作 ``_enqueue_entry``（不启动消费协程），因此水位断言是确定性的。
"""

import asyncio
import json

from infra.llm.logging import LogWorker


def _entry(idx: int, payload_chars: int = 200) -> dict:
    return {"purpose": "qa", "request_text": "x" * payload_chars, "seq": idx}


def _drain(worker: LogWorker) -> list[dict]:
    assert worker._queue is not None
    drained = []
    while not worker._queue.empty():
        entry, _size = worker._queue.get_nowait()
        drained.append(entry)
    return drained


class TestByteBudget:
    def test_queue_stays_within_byte_budget(self):
        worker = LogWorker(max_queue_bytes=2000, max_queue_entries=10_000)
        worker._queue = asyncio.Queue()

        for i in range(60):
            worker._enqueue_entry(_entry(i))

        stats = worker.queue_stats()
        assert stats["queued_bytes"] <= 2000
        assert stats["dropped_entries"] > 0
        assert stats["dropped_bytes"] > 0

    def test_oldest_entries_are_dropped(self):
        worker = LogWorker(max_queue_bytes=2000, max_queue_entries=10_000)
        worker._queue = asyncio.Queue()

        for i in range(60):
            worker._enqueue_entry(_entry(i))

        remaining = _drain(worker)
        assert remaining, "队列不应被清空"
        # 保留的是最新现场，最旧的已被挤出
        assert remaining[0]["seq"] > 0
        assert remaining[-1]["seq"] == 59

    def test_entry_count_cap_still_enforced(self):
        worker = LogWorker(max_queue_bytes=10 * 1024 * 1024, max_queue_entries=5)
        worker._queue = asyncio.Queue()

        for i in range(20):
            worker._enqueue_entry(_entry(i, payload_chars=1))

        assert worker.queue_stats()["queued_entries"] <= 5
        assert worker.queue_stats()["dropped_entries"] >= 15

    def test_single_oversized_entry_is_kept_alone(self):
        """单条超过预算时不能把队列清空 —— 保留它并继续（否则丢一条就丢光上下文）。"""
        worker = LogWorker(max_queue_bytes=100, max_queue_entries=100)
        worker._queue = asyncio.Queue()

        worker._enqueue_entry(_entry(0, payload_chars=5000))

        drained = _drain(worker)
        assert len(drained) == 1
        assert worker.queue_stats()["dropped_entries"] == 0

    def test_dropped_entries_are_spilled_to_overflow_file(self, tmp_path):
        worker = LogWorker(overflow_dir=str(tmp_path), max_queue_bytes=1500, max_queue_entries=10_000)
        worker._queue = asyncio.Queue()

        for i in range(40):
            worker._enqueue_entry(_entry(i))

        files = list(tmp_path.glob("*.jsonl"))
        assert files, "被丢弃的条目必须落盘兜底"
        spilled = [json.loads(line) for f in files for line in f.read_text(encoding="utf-8").splitlines()]
        assert spilled
        assert {e["seq"] for e in spilled} & set(range(40))
        assert sorted(e["seq"] for e in spilled)[0] == 0

    async def test_worker_releases_accounting_after_drain(self, monkeypatch):
        # 消费协程的 _flush 会连真实 DB；这里只验证队列水位记账，替换为 no-op。
        monkeypatch.setattr(LogWorker, "_flush", staticmethod(lambda items: None))
        worker = LogWorker(max_queue_bytes=1_000_000, max_queue_entries=100)
        await worker.start()
        try:
            for i in range(10):
                worker._enqueue_entry(_entry(i))
            assert worker.queue_stats()["queued_bytes"] > 0

            for _ in range(100):
                if worker.queue_stats()["queued_entries"] == 0:
                    break
                await asyncio.sleep(0.01)
        finally:
            await worker.stop()

        assert worker.queue_stats()["queued_bytes"] == 0
        assert worker.queue_stats()["queued_entries"] == 0
