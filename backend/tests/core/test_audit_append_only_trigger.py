"""DB 级 append-only 的判据（真实 PG）。

应用层守卫挡不住直连数据库 / ORM 误用 / 运维脚本；审计表若可被静默改写，前面所有留痕都失去意义
（2026-09-26 审计研究 §3.1）。迁移 `data/f3d4e5f6a7b8` 在 `audit_logs` 上装 BEFORE UPDATE OR DELETE 触发器。

本用例**自己建、自己拆**同一份 DDL（避免影响其它用例的清理逻辑；迁移在真实库上负责同样的事）。
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
import sqlalchemy as sa

from core.database import Base
from core.database import engine as pg_engine
from models import AuditLog, Role, User

_TABLES = [Role.__table__, User.__table__, AuditLog.__table__]

_FUNC = """
CREATE OR REPLACE FUNCTION audit_logs_forbid_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs 是只追加表：禁止 UPDATE / DELETE（审计证据不可改写）';
END;
$$ LANGUAGE plpgsql;
"""

_TRIGGER = """
CREATE TRIGGER trg_audit_logs_append_only
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION audit_logs_forbid_mutation();
"""


@pytest.fixture(scope="module", autouse=True)
def _schema():
    Base.metadata.create_all(pg_engine, tables=_TABLES)
    with pg_engine.begin() as conn:
        conn.execute(sa.text(_FUNC))
        conn.execute(sa.text(_TRIGGER))
    yield
    with pg_engine.begin() as conn:
        conn.execute(sa.text("DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON audit_logs"))
        conn.execute(sa.text("DROP FUNCTION IF EXISTS audit_logs_forbid_mutation()"))


@pytest.fixture
def db(pg_session):
    return pg_session


def _row(db) -> AuditLog:
    row = AuditLog(action="append-only-probe", target_type="test", payload={}, created_at=datetime.now(UTC))
    db.add(row)
    db.flush()
    return row


def test_insert_is_allowed(db):
    row = _row(db)
    assert row.id is not None


def test_update_is_rejected(db):
    row = _row(db)
    # plpgsql RAISE → psycopg RaiseException → SQLAlchemy ProgrammingError
    with pytest.raises(sa.exc.ProgrammingError, match="只追加"):
        db.execute(sa.text("UPDATE audit_logs SET action = 'tampered' WHERE id = :i"), {"i": row.id})


def test_delete_is_rejected(db):
    row = _row(db)
    with pytest.raises(sa.exc.ProgrammingError, match="只追加"):
        db.execute(sa.text("DELETE FROM audit_logs WHERE id = :i"), {"i": row.id})
