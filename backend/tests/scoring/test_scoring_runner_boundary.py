"""评分执行边界（``modules.training.scoring.runner``）。

守护两个收束点：

- ``enqueue_scoring`` 是五个触发点（启动重放 / ``/end`` / retry / 患者走人 / 结算）共用的
  唯一入队口：只把 ``record_id``/``case_data`` 捕获为标量（worker 不回读 ORM），队列满时
  原样抛 ``QueueFullError`` 交调用方恢复，队列未就绪时显式 ``RuntimeError``。
- ``classify_stuck_records`` 是启动恢复与结算清扫共用的唯一分类器，且
  「有 Score ⇒ completed」优先于「无学生消息」。
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from infra.queue import QueueFullError
from models import Message, Score
from modules.training.scoring import runner


class _All:
    def __init__(self, rows: list[object]) -> None:
        self._rows = rows

    def filter(self, *_criteria: object) -> _All:
        return self

    def all(self) -> list[object]:
        return self._rows


class _ClassifierDB:
    """``classify_stuck_records`` 用到的两个批量查询的替身。"""

    def __init__(self, *, scored: set[int], with_student_messages: set[int]) -> None:
        self._scored = scored
        self._with_student = with_student_messages

    def query(self, column: object) -> _All:
        if column is Score.record_id:
            return _All([(record_id,) for record_id in self._scored])
        if column is Message.record_id:
            return _All([(record_id,) for record_id in self._with_student])
        raise AssertionError(f"unexpected column: {column!r}")


class _RecordingQueue:
    def __init__(self, *, full: bool = False) -> None:
        self.factories: list = []
        self.priorities: list[int] = []
        self._full = full

    async def enqueue(self, coro_factory, *, priority: int = 0):
        if self._full:
            raise QueueFullError("评分队列繁忙")
        self.factories.append(coro_factory)
        self.priorities.append(priority)


@pytest.fixture
def scoring_calls(monkeypatch):
    calls: list[tuple] = []

    async def _fake(record_id, case_data, *, llm_client, tracker=None, realtime_hub=None):
        calls.append((record_id, case_data, llm_client, tracker, realtime_hub))

    monkeypatch.setattr(runner, "run_scoring_background", _fake)
    return calls


def test_classify_stuck_records_maps_scored_discarded_and_unscored():
    """批量分类：有分 → completed，无学生消息 → discarded，其余 → unscored。

    ``1`` 同时有分且无学生消息：分已可见优先（丢分/孤儿分都比"重算"更糟）。
    """
    db = _ClassifierDB(scored={1, 4}, with_student_messages={2, 4})
    records = [SimpleNamespace(id=record_id) for record_id in (1, 2, 3, 4)]

    assert runner.classify_stuck_records(db, records) == {
        1: runner.StuckRecordOutcome.COMPLETED,
        2: runner.StuckRecordOutcome.UNSCORED,
        3: runner.StuckRecordOutcome.DISCARDED,
        4: runner.StuckRecordOutcome.COMPLETED,
    }


def test_classify_stuck_records_empty_input_skips_queries():
    class _NoQuery:
        def query(self, column: object) -> None:
            raise AssertionError("空输入不得查询")

    assert runner.classify_stuck_records(_NoQuery(), []) == {}


async def test_enqueue_scoring_defers_runner_with_scalar_capture(scoring_calls):
    llm_client = object()
    realtime_hub = object()
    queue = _RecordingQueue()
    state = SimpleNamespace(task_queue=queue, llm_client=llm_client, scoring_tracker=None, realtime_hub=realtime_hub)
    case_data = {"patient_info": {"name": "张"}}

    await runner.enqueue_scoring(state, 7, case_data)

    assert queue.priorities == [runner.SCORING_PRIORITY]
    await queue.factories[0]()

    assert scoring_calls == [(7, case_data, llm_client, None, realtime_hub)]


async def test_enqueue_scoring_normalizes_missing_case_data(scoring_calls):
    queue = _RecordingQueue()
    state = SimpleNamespace(task_queue=queue, llm_client=object())

    await runner.enqueue_scoring(state, 9, None)
    await queue.factories[0]()

    assert scoring_calls[0][:2] == (9, {})


async def test_enqueue_scoring_propagates_queue_full():
    """队列满不做任何补救：HTTP 回滚 503 / 结算重开记录等恢复策略留在调用方。"""
    state = SimpleNamespace(task_queue=_RecordingQueue(full=True), llm_client=object())

    with pytest.raises(QueueFullError):
        await runner.enqueue_scoring(state, 7, {})


async def test_enqueue_scoring_rejects_missing_task_queue():
    with pytest.raises(RuntimeError, match="TaskQueue"):
        await runner.enqueue_scoring(SimpleNamespace(llm_client=object()), 7, {})
