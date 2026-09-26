"""审计写入的事务语义判据（**真实 PG**，`nursing_test`）。

本仓始终面向 PostgreSQL（不做跨库降级），因此这些判据直接跑在 PG 上：
`JSONB` 列、`DESC` 表达式索引、`CHECK` 约束、`FK ON DELETE SET NULL` 都是真实行为。

对应 2026-09-26 审计研究 §3.2 的两条硬约束：
- **成功变更**：审计与业务**同一事务** —— 业务回滚时审计一起回滚（没发生的变更不留痕）；
- **被拒/失败**：必须**独立 session** —— 业务 rollback 掉了，"有人尝试越权"的证据仍要在。
另附 append-only 的两条可判据（模型无 updated_at；模块里不得对 AuditLog update/delete）。
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
import sqlalchemy as sa

from core.audit import (
    ACTION_ACCESS_DENIED,
    ACTION_ROLE_UPDATED,
    TARGET_TYPE_ROLE,
    record,
    record_detached,
)
from core.database import Base
from core.database import engine as pg_engine
from models import AuditLog, Role, User

_TABLES = [Role.__table__, User.__table__, AuditLog.__table__]


@pytest.fixture(scope="module", autouse=True)
def _schema():
    Base.metadata.create_all(pg_engine, tables=_TABLES)


@pytest.fixture
def db(pg_session):
    return pg_session


def _actor(session) -> User:
    role = session.query(Role).filter(Role.name == "admin").first()
    if role is None:
        role = Role(name="admin", display_name="管理员", is_system=True)
        session.add(role)
        session.flush()
    user = User(
        username="a1-smoke-actor",
        password_hash="x",
        role_id=role.id,
        display_name="冒烟操作者",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    session.add(user)
    session.commit()
    return user


def _request(rid: str = "req-1"):
    return SimpleNamespace(
        state=SimpleNamespace(request_id=rid, audit_actor=None),
        headers={"user-agent": "pytest"},
        method="PUT",
        url=SimpleNamespace(path="/api/admin/roles/1"),
    )


def test_record_commits_with_business_transaction(db):
    actor = _actor(db)
    record(
        db,
        action=ACTION_ROLE_UPDATED,
        target_type=TARGET_TYPE_ROLE,
        target_id=3,
        actor=actor,
        request=_request(),
        payload={"before": ["a"], "after": ["a", "b"]},
    )
    db.commit()

    row = db.query(AuditLog).filter(AuditLog.actor_id == actor.id).one()
    assert row.outcome == "success"
    assert row.actor_username == actor.username
    assert row.actor_display_name == "冒烟操作者"
    assert row.actor_role == "admin"  # 身份快照：删用户后仍可读
    assert row.target_id == "3"
    assert row.payload == {"before": ["a"], "after": ["a", "b"]}
    assert row.request_id == "req-1"
    assert row.request_path == "/api/admin/roles/1"


def test_record_rolls_back_with_business(db):
    actor = _actor(db)
    record(db, action=ACTION_ROLE_UPDATED, target_type=TARGET_TYPE_ROLE, actor=actor)
    db.rollback()

    assert db.query(AuditLog).filter(AuditLog.actor_id == actor.id).count() == 0


def test_record_detached_survives_business_rollback():
    """独立 session 的语义必须用**真实提交**验：savepoint 夹具里 actor 未提交，
    detached 那条会因为外键不可达而写不进去（那是夹具的形态，不是产品行为）。

    断言：业务事务回滚掉了自己那行审计；detached 那行在库里。
    """
    from core.database import SessionLocal

    marker = uuid.uuid4().hex[:8]
    with SessionLocal() as setup:
        role = setup.query(Role).filter(Role.name == "admin").first() or Role(
            name="admin", display_name="管理员", is_system=True
        )
        setup.add(role)
        setup.flush()
        actor = User(
            username=f"a1-detached-{marker}",
            password_hash="x",
            role_id=role.id,
            display_name="独立会话操作者",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        setup.add(actor)
        setup.commit()
        actor_id = actor.id

    try:
        with SessionLocal() as biz:
            # actor 必须绑定在打开的会话上（_actor_fields 会读 actor.role 做角色快照）
            actor = biz.get(User, actor_id)
            record(biz, action=ACTION_ROLE_UPDATED, target_type=TARGET_TYPE_ROLE, actor=actor)
            biz.rollback()

            record_detached(
                _request("req-2"),
                action=ACTION_ACCESS_DENIED,
                target_type=TARGET_TYPE_ROLE,
                actor=actor,
                payload={"required_permission": "role_manage"},
            )

        with SessionLocal() as check:
            rows = check.query(AuditLog).filter(AuditLog.actor_id == actor_id).all()
        assert [r.action for r in rows] == [ACTION_ACCESS_DENIED]
        assert rows[0].outcome == "denied"
        assert rows[0].request_id == "req-2"
    finally:
        with SessionLocal() as cleanup:
            cleanup.query(AuditLog).filter(AuditLog.actor_id == actor_id).delete()
            cleanup.query(User).filter(User.id == actor_id).delete()
            cleanup.commit()


def test_outcome_whitelist_is_enforced_by_db(db):
    actor = _actor(db)
    db.add(AuditLog(action="x", target_type="y", outcome="whatever", payload={}, actor_id=actor.id))
    with pytest.raises(sa.exc.IntegrityError):
        db.commit()
    db.rollback()


def test_actor_id_becomes_null_but_snapshot_survives(db):
    """FK ON DELETE SET NULL：删用户不得连带删掉它的审计。"""
    actor = _actor(db)
    record(db, action=ACTION_ROLE_UPDATED, target_type=TARGET_TYPE_ROLE, actor=actor, target_label="a1-smoke-fk")
    db.commit()
    actor_id, username = actor.id, actor.username

    db.delete(db.get(User, actor_id))
    db.commit()

    row = db.query(AuditLog).filter(AuditLog.actor_username == username).one()
    assert row.actor_id is None
    assert row.actor_username == username


def test_audit_model_is_append_only():
    assert not hasattr(AuditLog, "updated_at")
    assert "updated_at" not in AuditLog.__table__.columns


def test_no_module_updates_or_deletes_audit_rows():
    """模块层不得出现对 AuditLog 的 update/delete（append-only 的第二层守卫）。"""
    offenders: list[str] = []
    for path in (Path(__file__).resolve().parents[2] / "modules").rglob("*.py"):
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if "AuditLog" not in line:
                continue
            if re.search(r"\b(delete|update)\s*\(", line):
                offenders.append(f"{path}:{lineno}: {line.strip()}")
    assert not offenders, "发现对 AuditLog 的写改删：\n" + "\n".join(offenders)
