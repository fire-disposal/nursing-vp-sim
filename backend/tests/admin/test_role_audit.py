"""角色/权限变更的审计判据（**真实 PG**）。

为什么先接这里：权限变更零痕迹等于"审计系统可以被静默降权"（2026-09-26 审计 RB-2），
所以角色变更的留痕是审计自身可信的前提（方案 A2）。

断言口径：每条变更**恰好 1 行**审计，且 before/after 与实际改动一致
（断言 DB 行内容，而不是"函数被调用过"）。
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from core.audit import ACTION_ROLE_CREATED, ACTION_ROLE_DELETED, ACTION_ROLE_UPDATED, TARGET_TYPE_ROLE
from core.database import Base
from core.database import engine as pg_engine
from core.security import clear_permission_cache
from models import AuditLog, Role, RolePermission, User
from modules.admin.roles import RoleService

_TABLES = [Role.__table__, RolePermission.__table__, User.__table__, AuditLog.__table__]


@pytest.fixture(scope="module", autouse=True)
def _schema():
    Base.metadata.create_all(pg_engine, tables=_TABLES)


@pytest.fixture
def db(pg_session):
    clear_permission_cache()
    yield pg_session
    clear_permission_cache()


@pytest.fixture
def actor(db) -> User:
    role = db.query(Role).filter(Role.name == "super_admin").first() or Role(
        name="super_admin", display_name="超级管理员", is_system=True
    )
    db.add(role)
    db.flush()
    user = User(
        username="role-audit-actor",
        password_hash="x",
        role_id=role.id,
        display_name="审计操作者",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db.add(user)
    db.flush()
    return user


def _request(actor: User, rid: str = "req-role"):
    """模拟 require_permission 的 choke point：把 actor 挂到 request.state。

    同时提供 audit 取值需要的 headers/method/url（与真实 Starlette Request 同形）。
    """
    return SimpleNamespace(
        state=SimpleNamespace(request_id=rid, audit_actor=actor),
        headers={"user-agent": "pytest-agent"},
        method="POST",
        url=SimpleNamespace(path="/api/admin/roles"),
    )


def _rows(db, action: str) -> list[AuditLog]:
    return db.query(AuditLog).filter(AuditLog.action == action).all()


def test_create_role_writes_one_audit_row(db, actor):
    view = RoleService(db).create(
        "ops", "运维", ["stats_view", "qa_access"], grantable={"stats_view", "qa_access"}, request=_request(actor)
    )

    rows = _rows(db, ACTION_ROLE_CREATED)
    assert len(rows) == 1
    row = rows[0]
    assert row.target_type == TARGET_TYPE_ROLE
    assert row.target_id == str(view.id)
    assert row.target_label == "运维"
    assert row.payload["permissions"] == ["qa_access", "stats_view"]
    assert row.actor_id == actor.id
    assert row.actor_role == "super_admin"
    assert row.request_id == "req-role"


def test_update_role_records_before_and_after(db, actor):
    view = RoleService(db).create("ops2", "运维2", ["stats_view"], request=_request(actor))
    RoleService(db).update(
        view.id, display_name="运维二", permissions=["stats_view", "qa_access"], request=_request(actor, "req-upd")
    )

    rows = _rows(db, ACTION_ROLE_UPDATED)
    assert len(rows) == 1
    payload = rows[0].payload
    assert payload["display_name"] == {"before": "运维2", "after": "运维二"}
    assert payload["permissions"] == {"before": ["stats_view"], "after": ["qa_access", "stats_view"]}
    assert rows[0].request_id == "req-upd"


def test_delete_role_records_removed_permissions(db, actor):
    view = RoleService(db).create("ops3", "运维3", ["stats_view"], request=_request(actor))
    RoleService(db).delete(view.id, request=_request(actor, "req-del"))

    rows = _rows(db, ACTION_ROLE_DELETED)
    assert len(rows) == 1
    assert rows[0].target_id == str(view.id)
    assert rows[0].target_label == "运维3"
    assert rows[0].payload == {"name": "ops3", "permissions": ["stats_view"]}
    assert rows[0].request_id == "req-del"
