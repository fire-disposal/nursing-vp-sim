"""卡住评分记录的两条收束路径：启动恢复与结算超龄清扫。

两者共用 ``scoring.runner.classify_stuck_records``（分类唯一），但终态策略**有意不同**，
本文件把两侧的映射逐条钉住：

- 启动恢复（``main._recover_stuck_scoring_records``）：有分 → ``completed``；
  无学生消息 → ``mark_discarded``；其余 → ``pending``（内存队列随进程消失，必须重跑）。
- 结算清扫（``settlement._sweep_stale_scoring_records``）：有分 → ``completed``；
  无学生消息 → ``scoring_status=NULL`` + 原因；其余 → ``failed`` + 失败通知
  （本进程内 10 分钟无进展，不自动重跑）。
"""

from __future__ import annotations

from types import SimpleNamespace

import main
import modules.training.session.finalize as finalize_module
from core.statuses import ScoringStatus
from models import Message, Notification, Score, TrainingRecord
from modules.training.session import settlement
from modules.training.session.finalize import NO_STUDENT_MESSAGES_REASON

SWEEP_FAILED_ERROR = "评分超时，已自动标记失败，可手动重试"


class _All:
    def __init__(self, rows: list[object]) -> None:
        self._rows = rows

    def filter(self, *_criteria: object) -> _All:
        return self

    def all(self) -> list[object]:
        return self._rows


class _FakeDB:
    """两个调用点用到的查询（按模型分发）+ add/commit/close 的最小替身。"""

    def __init__(self, *, records: list[object], scored: set[int], with_student: set[int]) -> None:
        self.records = records
        self.scored = scored
        self.with_student = with_student
        self.added: list[object] = []
        self.commits = 0
        self.closed = False

    def query(self, model: object) -> _All:
        if model is TrainingRecord:
            return _All(self.records)
        if model is Score.record_id:
            return _All([(record_id,) for record_id in self.scored])
        if model is Message.record_id:
            return _All([(record_id,) for record_id in self.with_student])
        raise AssertionError(f"unexpected query: {model!r}")

    def add(self, obj: object) -> None:
        self.added.append(obj)

    def commit(self) -> None:
        self.commits += 1

    def close(self) -> None:
        self.closed = True


def _record(record_id: int, *, user_id: int = 3) -> SimpleNamespace:
    return SimpleNamespace(
        id=record_id,
        user_id=user_id,
        scoring_status=ScoringStatus.PENDING,
        scoring_error=None,
    )


def test_settlement_sweep_terminal_states_and_notification():
    """无分超龄 → failed + 通知；有分 → completed；无学生消息 → 清空状态并记原因。"""
    unscored, scored, discarded = _record(1), _record(2), _record(3)
    db = _FakeDB(
        records=[unscored, scored, discarded],
        scored={2},
        with_student={1, 2},
    )

    assert settlement._sweep_stale_scoring_records(db) == 3

    assert (unscored.scoring_status, unscored.scoring_error) == (ScoringStatus.FAILED, SWEEP_FAILED_ERROR)
    assert (scored.scoring_status, scored.scoring_error) == (ScoringStatus.COMPLETED, None)
    assert (discarded.scoring_status, discarded.scoring_error) == (None, NO_STUDENT_MESSAGES_REASON)
    assert [(n.type, n.record_id) for n in db.added] == [("scoring_failed", 1)]
    assert isinstance(db.added[0], Notification)
    assert db.commits == 1


def test_startup_recovery_requeues_unscored_discards_empty_and_fixes_scored(monkeypatch):
    """恢复后：无分 → pending（等待重跑）；无学生消息 → 废弃；有分 → completed。"""
    unscored, scored, no_messages = _record(1), _record(2), _record(3)
    db = _FakeDB(
        records=[unscored, scored, no_messages],
        scored={2},
        with_student={1, 2},
    )
    discarded: list[int] = []
    monkeypatch.setattr("core.database.SessionLocal", lambda: db)
    monkeypatch.setattr(finalize_module, "mark_discarded", lambda _db, record: discarded.append(record.id))

    main._recover_stuck_scoring_records()

    assert (unscored.scoring_status, unscored.scoring_error) == (ScoringStatus.PENDING, None)
    assert (scored.scoring_status, scored.scoring_error) == (ScoringStatus.COMPLETED, None)
    assert discarded == [3]
    assert db.commits == 1
    assert db.closed is True
