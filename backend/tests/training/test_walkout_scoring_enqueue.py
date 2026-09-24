"""回归：患者走人触发的评分入队不得在 worker 阶段回读 ORM 属性。

线上（2026-09-24 机房会话）现象：``TaskQueue 任务异常`` + ``DetachedInstanceError``，
评分入队丢失。原因：``_end_by_patient_walkout`` 把 ``ctx.record.id`` 留在延迟执行的
闭包里求值，而 worker 执行时请求 session 已关闭。
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm.exc import DetachedInstanceError

import modules.training.router.scoring as scoring_module
import modules.training.session.finalize as finalize_module
from core.statuses import TrainingStatus
from modules.training.pipeline import STATE_DONE_PAYLOAD, PipelineContext
from modules.training.pipeline.middleware.side_effects import _end_by_patient_walkout


class _DetachingRecord:
    """ORM 替身：``detach()`` 之后的属性访问与离线实例一样抛 DetachedInstanceError。"""

    def __init__(self, record_id: int = 42) -> None:
        self._id = record_id
        self._detached = False

    def detach(self) -> None:
        self._detached = True

    @property
    def id(self) -> int:
        if self._detached:
            raise DetachedInstanceError("Instance <TrainingRecord> is not bound to a Session")
        return self._id


class _Queue:
    def __init__(self) -> None:
        self.factories: list = []

    async def enqueue(self, coro_factory, priority: int = 0) -> None:
        self.factories.append(coro_factory)


@pytest.mark.asyncio
async def test_enqueued_scoring_survives_detached_record(monkeypatch):
    scored: list[int] = []

    async def _fake_scoring(record_id, case_data, **kwargs):
        scored.append(record_id)

    monkeypatch.setattr(scoring_module, "_run_scoring_background", _fake_scoring)
    monkeypatch.setattr(
        finalize_module,
        "finalize_training",
        lambda db, record_id, ended_at=None: (True, TrainingStatus.COMPLETED, {"patient_info": {}}),
    )
    monkeypatch.setattr(finalize_module, "mark_patient_walkout", lambda record, at=None: None)
    monkeypatch.setattr(finalize_module, "cleanup_session_runtime", lambda record, app, db: None)

    record = _DetachingRecord()
    ctx = PipelineContext(
        record=record,
        case_data={},
        current_user=SimpleNamespace(id=7),
        db=MagicMock(),
        app_state=MagicMock(),
    )
    app = SimpleNamespace(task_queue=_Queue(), llm_client=object(), scoring_tracker=None, realtime_hub=None)

    await _end_by_patient_walkout(ctx, app)

    assert app.task_queue.factories, "走人路径必须入队评分"
    assert ctx.state[STATE_DONE_PAYLOAD] == {
        "ended": True,
        "end_reason": "patient_walkout",
    }

    record.detach()
    await app.task_queue.factories[0]()

    assert scored == [42]
