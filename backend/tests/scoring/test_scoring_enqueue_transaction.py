"""回归：``SCORING_EXECUTION=job`` 的入队必须写进**调用方事务**（2026-10-27 生产 500）。

现象：``POST /api/training/624/end`` 连打两次 500，报
``psycopg.errors.LockNotAvailable: canceling statement due to lock timeout``，
``CONTEXT: while locking tuple ... in relation "training_records"``，
语句是 ``INSERT INTO jobs`` 的外键校验。

原因：``/end`` / ``retry-scoring`` / 患者走人的事务还没提交，且持着该记录的
``FOR UPDATE``；job 模式入队却自开连接写 ``jobs``，外键校验要 ``FOR KEY SHARE``
同一行 → 等的是自己的锁，``lock_timeout=3000`` 到点后整条请求 500。

判据：调用方已锁记录行时入队仍成功，且那一行**只在调用方事务里可见**（未提交）
—— 记录完成与任务登记同一事务，不存在"记录完成了、任务没登记"的中间态。
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from sqlalchemy import text

import modules.training.scoring.runner as runner_module
from core.database import Base, engine
from core.statuses import TrainingStatus
from models import Case, Job, Role, TrainingRecord, User

#: FK 目标必须一起建（PG 校验真 FK）
_TABLES = [Role.__table__, User.__table__, Case.__table__, TrainingRecord.__table__, Job.__table__]


@pytest.fixture(scope="module", autouse=True)
def _schema():
    Base.metadata.create_all(engine, tables=_TABLES)


def _record(db) -> TrainingRecord:
    # 同名角色可能已由别的用例**真实提交**过（savepoint 之外的提交不受回滚约束），
    # 直接 INSERT 会撞 roles_name_key —— 取不到再建，保持用例对执行顺序不敏感。
    role = db.query(Role).filter(Role.name == "student").first()
    if role is None:
        role = Role(name="student", display_name="学生", is_system=True)
        db.add(role)
        db.flush()
    user = User(username="enqueue-tx", password_hash="x", display_name="学生", role_id=role.id)
    case = Case(name="事务病例", description="", difficulty=1, time_limit_minutes=30)
    db.add_all([user, case])
    db.flush()
    record = TrainingRecord(
        user_id=user.id,
        case_id=case.id,
        status=TrainingStatus.IN_PROGRESS,
        case_snapshot={"patient_info": {"name": "王某"}},
    )
    db.add(record)
    db.flush()
    return record


def test_job_enqueue_reuses_callers_transaction(pg_session, monkeypatch):
    monkeypatch.setattr(runner_module, "SCORING_EXECUTION", "job")
    record = _record(pg_session)
    # ``end_training`` 的第一步：请求事务锁住记录行（之后才入队评分）
    pg_session.query(TrainingRecord).filter(TrainingRecord.id == record.id).with_for_update().one()

    asyncio.run(runner_module.enqueue_scoring(SimpleNamespace(), record.id, {}, db=pg_session))

    job = pg_session.query(Job).filter(Job.record_id == record.id).one()
    assert job.kind == "scoring"
    assert job.status == "pending"

    with engine.connect() as other:
        visible_elsewhere = other.execute(
            text("SELECT count(*) FROM jobs WHERE record_id = :record_id"), {"record_id": record.id}
        ).scalar()
    assert visible_elsewhere == 0, "入队不得自行提交：记录完成与任务登记必须同一事务"
