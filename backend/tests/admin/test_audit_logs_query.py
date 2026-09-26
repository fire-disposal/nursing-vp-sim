"""审计查询与导出的判据（真实 PG）。

核心要求（方案 §2.5）：**筛选键只存在于 DTO，列表与导出共用同一服务入口** →
"筛完之后导出的集合"必须等于"列表看到的集合"（否则又是"导出无视筛选"那类 bug）。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from core.database import Base
from core.database import engine as pg_engine
from models import AuditLog, Role, User
from modules.admin.audit_logs import AuditLogFilters, AuditLogService, export_audit_logs

_TABLES = [Role.__table__, User.__table__, AuditLog.__table__]


@pytest.fixture(scope="module", autouse=True)
def _schema():
    Base.metadata.create_all(pg_engine, tables=_TABLES)


@pytest.fixture
def db(pg_session):
    return pg_session


@pytest.fixture
def seeded(db):
    """三条可区分的审计：两个操作者、两类动作、两种结果、三个时间点。

    先在 savepoint 内清空审计表：与其它用例/历史残留的行互不干扰（teardown 外层回滚，
    真实库不受影响）。
    """
    db.query(AuditLog).delete()
    role = db.query(Role).filter(Role.name == "admin").first() or Role(
        name="admin", display_name="管理员", is_system=True
    )
    db.add(role)
    db.flush()
    users = []
    for name in ("audit-a", "audit-b"):
        user = User(
            username=name,
            password_hash="x",
            role_id=role.id,
            display_name=name,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        db.add(user)
        db.flush()
        users.append(user)

    now = datetime.now(UTC)
    rows = [
        AuditLog(
            created_at=now - timedelta(hours=2),
            actor_id=users[0].id,
            actor_username=users[0].username,
            actor_role="admin",
            action="role.updated",
            target_type="role",
            target_id="7",
            target_label="教师",
            outcome="success",
            payload={"permissions": {"before": ["a"], "after": ["a", "b"]}},
            request_path="/api/admin/roles/7",
        ),
        AuditLog(
            created_at=now - timedelta(hours=1),
            actor_id=users[1].id,
            actor_username=users[1].username,
            actor_role="admin",
            action="access.denied",
            target_type="secret",
            target_label="主力通道",
            outcome="denied",
            payload={"required_permission": "api_manage"},
            request_path="/api/admin/secrets",
        ),
        AuditLog(
            created_at=now,
            actor_id=users[0].id,
            actor_username=users[0].username,
            actor_role="admin",
            action="user.deleted",
            target_type="user",
            target_id="12",
            target_label="audit-a",
            outcome="success",
            payload={},
            request_path="/api/admin/users/12",
        ),
    ]
    db.add_all(rows)
    db.flush()
    return SimpleNamespace(users=users, now=now)


def _list(db, filters, *, offset=0, limit=50):
    return AuditLogService(db).list_filtered(filters, offset=offset, limit=limit)


def test_filters_by_actor_action_outcome_and_target(db, seeded):
    only_a = _list(db, AuditLogFilters(actor_id=seeded.users[0].id))[0]
    assert {r.action for r in only_a} == {"role.updated", "user.deleted"}

    denied = _list(db, AuditLogFilters(outcome="denied"))[0]
    assert [r.action for r in denied] == ["access.denied"]

    secrets = _list(db, AuditLogFilters(target_type="secret"))[0]
    assert [r.target_label for r in secrets] == ["主力通道"]

    one_action = _list(db, AuditLogFilters(action="user.deleted"))[0]
    assert [r.target_id for r in one_action] == ["12"]


def test_time_range_and_search(db, seeded):
    from_ts = (seeded.now - timedelta(minutes=90)).isoformat()
    recent = _list(db, AuditLogFilters(date_from=from_ts))[0]
    assert [r.action for r in recent] == ["user.deleted", "access.denied"]  # 新→旧

    by_search = _list(db, AuditLogFilters(search="主力"))[0]
    assert [r.action for r in by_search] == ["access.denied"]

    by_path = _list(db, AuditLogFilters(search="/users/"))[0]
    assert [r.target_id for r in by_path] == ["12"]


def test_pagination_and_total(db, seeded):
    rows, total = _list(db, AuditLogFilters(), offset=1, limit=1)
    assert total == 3
    assert len(rows) == 1


def test_export_uses_same_filters_as_list(db, seeded):
    """导出必须与列表同集（只多一条上限判定），否则就是"导出无视筛选"。"""
    filters = AuditLogFilters(action="role.updated")
    listed, total = _list(db, filters)
    assert total == len(listed) == 1

    request_stub = SimpleNamespace(
        state=SimpleNamespace(request_id="req-export-parity", audit_actor=None),
        headers={"user-agent": "pytest"},
        method="POST",
        url=SimpleNamespace(path="/api/admin/audit-logs/export"),
    )
    response = export_audit_logs(
        current_user=SimpleNamespace(id=1), db=db, filters=filters, format="csv", request=request_stub
    )
    body = response.body.decode("utf-8-sig")

    # 导出本身会留痕（A4）→ 用真实 session 清掉该行，避免污染其它用例的计数
    from core.database import SessionLocal

    with SessionLocal() as cleanup_db:
        cleanup_db.query(AuditLog).filter(AuditLog.action == "export.downloaded").delete(synchronize_session=False)
        cleanup_db.commit()
    assert "role.updated" in body
    # 未命中筛选的那两条不得出现在导出里
    assert "access.denied" not in body
    assert "user.deleted" not in body


def test_invalid_date_raises_validation_error(db, seeded):
    from core.exceptions import ValidationError

    with pytest.raises(ValidationError):
        _list(db, AuditLogFilters(date_from="2026-13-45"))
