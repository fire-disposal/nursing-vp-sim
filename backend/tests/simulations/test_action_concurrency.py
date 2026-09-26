"""并发与幂等：临床推理动作面必须与训练工具面同一套语义。

不变量：
  1. ``expected_revision`` 不符 → 409（双击、双标签、超时重发不再静默叠加）；
  2. 同一 ``idem_key`` 重复提交 → 只应用一次，返回 ``replayed=True`` 且状态不变；
  3. 被接受的动作用推进 ``revision``，使下一次 CAS 有意义；
  4. 幂等键有界（``IDEM_KEY_LIMIT``），不随会话无限增长。

缺陷背景（产品价值：操作可信）：此前动作请求体只有 action，无版本校验也无幂等键，
重复提交会重复扣检查点或丢动作；而训练工具面早已有 revision CAS + request_id 幂等。

真库并发判据（**PostgreSQL**，`nursing_test`）：行锁 + 重读 state 这段 fake session
覆盖不到，因此用真实提交的独立 session（`SessionLocal`）跑 —— ``simulation_sessions``
是真表（``state`` 为 JSONB），``user_id`` 是真外键，故夹具建一条真实 actor 行并在
finally 清理（真实提交不受 savepoint 夹具回滚保护）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, cast

import pytest
import sqlalchemy as sa

from core.database import Base, SessionLocal
from core.database import engine as pg_engine
from core.exceptions import ConflictError
from models import Role, SimulationSession, User
from modules.simulations.service import SimulationService
from modules.simulations.state import IDEM_KEY_LIMIT, state_from_dict
from tests.simulations.test_api_flow import _FakeSession  # reuse the fake-DB harness

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

_TABLES = [Role.__table__, User.__table__, SimulationSession.__table__]


def _service() -> SimulationService:
    return SimulationService(cast("Session", _FakeSession()))


def _revision(session) -> int:
    return state_from_dict(session.state).revision


def test_stale_revision_is_rejected():
    service = _service()
    session = service.create(1)

    messages, accepted, replayed = service.act(session, "WAIT", None, expected_revision=_revision(session))

    assert accepted is True
    assert replayed is False
    assert messages  # WAIT 产出时间推进消息

    with pytest.raises(ConflictError) as exc:
        service.act(session, "WAIT", None, expected_revision=0)  # 陈旧 revision
    assert "revision" in str(exc.value.detail)


def test_accepted_action_advances_revision():
    service = _service()
    session = service.create(1)
    before = _revision(session)

    service.act(session, "WAIT", None)

    assert _revision(session) == before + 1


def test_rejected_action_does_not_advance_revision():
    service = _service()
    session = service.create(1)
    before = _revision(session)

    _, accepted, _ = service.act(session, "TALK", "doctor", text="你好")  # 无效目标

    assert accepted is False
    assert _revision(session) == before


def test_same_idem_key_applies_once():
    service = _service()
    session = service.create(1)

    service.act(session, "WAIT", None, idem_key="k1", expected_revision=_revision(session))
    after_first = _revision(session)

    messages, accepted, replayed = service.act(
        session, "WAIT", None, idem_key="k1", expected_revision=_revision(session)
    )

    assert replayed is True
    assert messages == []
    assert _revision(session) == after_first  # 没有被推进两次
    assert accepted is True  # 语义上"该请求已被处理"


def test_different_idem_keys_apply_independently():
    service = _service()
    session = service.create(1)

    service.act(session, "WAIT", None, idem_key="a", expected_revision=_revision(session))
    service.act(session, "WAIT", None, idem_key="b", expected_revision=_revision(session))

    assert _revision(session) == 2


def test_idem_keys_are_bounded():
    service = _service()
    session = service.create(1)

    for i in range(IDEM_KEY_LIMIT + 5):
        service.act(session, "WAIT", None, idem_key=f"k{i}", expected_revision=_revision(session))

    keys = state_from_dict(session.state).idem_keys
    assert len(keys) == IDEM_KEY_LIMIT
    assert "k0" not in keys  # 最早的键被丢弃
    assert f"k{IDEM_KEY_LIMIT + 4}" in keys  # 最新的键保留


# ── 真库并发：行锁 + 重读 state（fake session 覆盖不到这段） ──


@pytest.fixture(scope="module", autouse=True)
def _schema():
    """本仓面向 PostgreSQL：真库建表（幂等）。"""
    Base.metadata.create_all(pg_engine, tables=_TABLES)
    # 结局状态的唯一 owner 是 ``state.case_status``：模型与真表都**不得**有 status 列
    # （原 SQLite 夹具靠"手写 DDL 没有该列 → 插入报错"当护栏，这里改成直接判列）。
    assert "status" not in SimulationSession.__table__.columns
    with pg_engine.connect() as conn:
        columns = {
            row[0]
            for row in conn.execute(
                sa.text("SELECT column_name FROM information_schema.columns WHERE table_name = 'simulation_sessions'")
            )
        }
    assert "status" not in columns


@pytest.fixture
def sim_actor() -> int:
    """真实提交的 actor：``simulation_sessions.user_id`` 是真外键，且要跨 session 可见。"""
    with SessionLocal() as db:
        role = db.query(Role).filter(Role.name == "student").first() or Role(
            name="student", display_name="学生", is_system=True
        )
        db.add(role)
        db.flush()
        user = User(
            username=f"sim-actor-{uuid.uuid4().hex[:8]}",
            password_hash="x",
            role_id=role.id,
            display_name="模拟并发操作者",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        db.add(user)
        db.commit()
        actor_id = user.id

    try:
        yield actor_id
    finally:
        with SessionLocal() as cleanup:
            cleanup.query(SimulationSession).filter(SimulationSession.user_id == actor_id).delete()
            cleanup.query(User).filter(User.id == actor_id).delete()
            cleanup.commit()


def test_stale_snapshot_must_lose_to_committed_revision(sim_actor):
    """两个请求从同一 revision 出发：先提交的赢，后提交者 409 而不是覆盖它。

    真实竞态窗口：请求 A 读出行后（旧 state 在内存里），请求 B 在另一事务里对
    同一行执行动作并提交；A 随后提交时必须由锁后重读看到 B 的 revision 而被
    拒绝，否则就是 lost update。fake session 测不出这段——行锁与 identity map
    重读只发生在真 Session 上。
    """
    db_a, db_b = SessionLocal(), SessionLocal()
    try:
        sid = SimulationService(db_a).create(sim_actor).id
        stale = SimulationService(db_a).get_owned(sid, sim_actor)
        assert _revision(stale) == 0

        # 请求 B：另一事务、同一行，接受一次动作并提交 → revision 1
        winner = SimulationService(db_b).get_owned(sid, sim_actor)
        _, accepted, replayed = SimulationService(db_b).act(winner, "STATUS", None, expected_revision=0)
        assert (accepted, replayed) == (True, False)
        db_b.expire_all()
        assert _revision(SimulationService(db_b).get_owned(sid, sim_actor)) == 1

        # 请求 A：手里的快照已过期 → 409，且 B 的结果不被覆盖
        with pytest.raises(ConflictError):
            SimulationService(db_a).act(stale, "STATUS", None, expected_revision=0)
        db_b.expire_all()
        assert _revision(SimulationService(db_b).get_owned(sid, sim_actor)) == 1
    finally:
        db_a.close()
        db_b.close()


def test_provider_runs_after_commit_and_without_row_lock(sim_actor):
    """外部 provider 必须在事务 A 提交之后调用，且不持有会话行锁（docs/16 §4.5）。

    证据用另一条连接给出：provider 执行期间，同一条会话行能被另一个事务正常加锁并
    提交（若事务/行锁仍被 provider 持有，另一事务的 ``SELECT … FOR UPDATE`` 会阻塞到
    ``lock_timeout`` 报错）；随后事务 B 必须把回复追加到那次并发动作之后的最新
    state 上，而不是覆盖它。
    """
    db = SessionLocal()
    other = SessionLocal()
    try:
        sid = SimulationService(db).create(sim_actor).id
        session = SimulationService(db).get_owned(sid, sim_actor)
        rev = _revision(session)
        observed: dict = {}

        def provider(summary: str) -> str:
            observed["in_transaction"] = db.in_transaction()
            # 另一事务在 provider 运行期间读到事务 A 已提交的 revision，并对同一行执行动作。
            service = SimulationService(other)
            committed = service.get_owned(sid, sim_actor)
            observed["committed_revision"] = _revision(committed)
            messages, accepted, _ = service.act(
                committed, "STATUS", None, expected_revision=observed["committed_revision"]
            )
            observed["concurrent"] = [(m.kind, m.text) for m in messages]
            observed["concurrent_accepted"] = accepted
            return "建议：继续监测尿量与生命体征。"

        messages, accepted, _ = SimulationService(db).act(session, "CONSULT", None, consult_provider=provider)

        assert accepted is True
        assert observed["in_transaction"] is False  # 事务 A 已提交，provider 不在事务里
        assert observed["committed_revision"] == rev + 1  # 推进后的 revision 已对外可见
        assert observed["concurrent_accepted"] is True  # 行锁已释放：另一事务能提交
        assert any("专家建议" in m.text for m in messages)

        db.expire_all()
        final = state_from_dict(SimulationService(db).get_owned(sid, sim_actor).state)
        # 回复与并发动作都留了下来：事务 B 基于最新 state 追加，没有覆盖 revision。
        assert final.revision == rev + 2
        assert any("专家建议" in m.text for m in final.public_log)
        persisted = [(m.kind, m.text) for m in final.public_log]
        assert all(item in persisted for item in observed["concurrent"])
    finally:
        db.close()
        other.close()
