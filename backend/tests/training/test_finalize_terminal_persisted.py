"""终态持久化回归：``finalize_training`` 的 completed/discarded 必须真的落到行上。

缺陷背景（2026-09-26 P0）：``patch_runtime_state`` 用 ``populate_existing`` 重读整行；而生产
``SessionLocal`` 是 ``autoflush=False``，于是它会把调用方在同一事务里**尚未 flush 的列改动**
（``finalize_training`` 里的 ``status`` / ``end_time``）按库中旧值覆盖。表现：

* ``/end`` 返回 ``record_status=completed``，库里却仍是 ``in_progress``、``end_time`` 为空；
* 学生被「同时只能有一条进行中训练」挡住，无法开始下一次训练；
* 结果页、成绩统计、复盘与重练入口永远拿不到 completed 记录。

修复在 owner 侧（``state.patch_runtime_state`` 先 ``db.flush()`` 再重读），因此**不依赖调用方
的写入顺序**。本文件同时钉住两点：

1. 终态列在事务里读回来的行上可见（真库 + savepoint 隔离）；
2. 会话语义必须与生产一致（``autoflush=False``）—— 本模块自建该会话，因为共享夹具
   ``pg_session`` 用的是 SQLAlchemy 默认的 ``autoflush=True``，恰好会掩盖这类缺陷。
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy.orm import Session

from core.database import Base
from core.database import engine as pg_engine
from core.statuses import TrainingStatus
from models import Case, Message, Role, TrainingRecord, User
from modules.training.session.finalize import (
    END_ORIGIN_USER,
    TERMINAL_STATE_KEY,
    finalize_training,
)

_TABLES = [Role.__table__, User.__table__, Case.__table__, TrainingRecord.__table__, Message.__table__]


@pytest.fixture
def db():
    """与生产 ``SessionLocal`` 同语义的会话（``autoflush=False``，savepoint 隔离）。"""
    with pg_engine.connect() as conn:
        outer = conn.begin()
        Base.metadata.create_all(pg_engine, tables=_TABLES)
        session = Session(bind=conn, join_transaction_mode="create_savepoint", autoflush=False)
        try:
            yield session
        finally:
            session.close()
            outer.rollback()


def _record(db, *, with_student_message: bool) -> TrainingRecord:
    role = db.query(Role).filter(Role.name == "student").first() or Role(name="student", display_name="学生")
    db.add(role)
    db.flush()
    stamp = datetime.now(UTC).timestamp()
    user = User(username=f"finalize-{stamp}", password_hash="x", display_name="学生", role_id=role.id)
    db.add(user)
    db.flush()
    case = Case(name=f"终态病例 {stamp}", description="", difficulty=1, time_limit_minutes=30)
    db.add(case)
    db.flush()
    record = TrainingRecord(user_id=user.id, case_id=case.id, status=TrainingStatus.IN_PROGRESS)
    db.add(record)
    db.flush()
    if with_student_message:
        db.add(Message(record_id=record.id, role="student", content="老师您好，我最近头晕"))
        db.flush()
    return record


def _reload(db, record_id: int) -> TrainingRecord:
    """丢掉身份映射现值，强制从事务里读回行 —— 看到的才是真正写下去的列。"""
    db.expire_all()
    return db.query(TrainingRecord).filter(TrainingRecord.id == record_id).one()


def test_completion_persists_status_and_end_time(db):
    record = _record(db, with_student_message=True)

    claimed, kind, case_data = finalize_training(db, record.id, origin=END_ORIGIN_USER)
    db.commit()

    assert claimed is True
    assert kind == TrainingStatus.COMPLETED
    assert case_data is not None

    reloaded = _reload(db, record.id)
    assert reloaded.status == TrainingStatus.COMPLETED
    assert reloaded.end_time is not None
    # runtime_state 的终端原因与终态列必须同时存在（写 runtime_state 不能挤掉终态列）
    assert (reloaded.runtime_state or {}).get(TERMINAL_STATE_KEY, {}).get("reason") == END_ORIGIN_USER


def test_discard_persists_terminal_status_and_clears_scoring(db):
    record = _record(db, with_student_message=False)

    claimed, kind, _case_data = finalize_training(db, record.id, origin=END_ORIGIN_USER)
    db.commit()

    assert claimed is True
    assert kind == TrainingStatus.DISCARDED

    reloaded = _reload(db, record.id)
    assert reloaded.status == TrainingStatus.DISCARDED
    assert reloaded.end_time is not None
    assert reloaded.scoring_status is None  # 废弃不评分：占位必须被清掉
