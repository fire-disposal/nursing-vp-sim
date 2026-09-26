"""A4 判据（真实 PG）：越权被拒要留痕、导出要留痕、被拒的超限导出**不得**留"已导出"。

这两类事件是审计价值的核心：
- `access.denied` —— "有人尝试越权"（业务侧必然回滚，所以必须走独立 session 才留得住）；
- `export.downloaded` —— "数据被带走"（含行数/格式/筛选，便于事后追责与对账）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from core.audit import ACTION_ACCESS_DENIED, ACTION_EXPORT_DOWNLOADED
from core.config import MAX_EXPORT_ROWS
from core.database import Base, SessionLocal
from core.database import engine as pg_engine
from core.security import clear_permission_cache, require_permission
from infra.exporter import ExportAudit, export_response
from models import AuditLog, Role, User

_TABLES = [Role.__table__, User.__table__, AuditLog.__table__]


@pytest.fixture(scope="module", autouse=True)
def _schema():
    Base.metadata.create_all(pg_engine, tables=_TABLES)


def _mk_actor(perms_role: str = "student") -> int:
    """建一个真实提交的 actor（独立 session 的 FK 需要它可见）。"""
    with SessionLocal() as db:
        role = db.query(Role).filter(Role.name == perms_role).first() or Role(
            name=perms_role, display_name=perms_role, is_system=True
        )
        db.add(role)
        db.flush()
        user = User(
            username=f"a4-{uuid.uuid4().hex[:8]}",
            password_hash="x",
            role_id=role.id,
            display_name="A4 操作者",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        db.add(user)
        db.commit()
        return user.id


def _stub_request(actor_id: int, rid: str):
    return SimpleNamespace(
        state=SimpleNamespace(
            request_id=rid,
            audit_actor=SimpleNamespace(
                id=actor_id,
                username="a4-actor",
                display_name="A4 操作者",
                role=SimpleNamespace(name="student"),
            ),
        ),
        headers={"user-agent": "pytest"},
        method="GET",
        url=SimpleNamespace(path="/api/admin/export"),
    )


def _rows(action: str) -> list[AuditLog]:
    with SessionLocal() as db:
        return db.query(AuditLog).filter(AuditLog.action == action).all()


def _cleanup(actor_ids: list[int]) -> None:
    with SessionLocal() as db:
        db.query(AuditLog).filter(AuditLog.actor_id.in_(actor_ids)).delete(synchronize_session=False)
        db.query(User).filter(User.id.in_(actor_ids)).delete(synchronize_session=False)
        db.commit()


def test_denied_permission_is_audited_even_though_request_fails():
    """403 必须留下 access.denied（含要求的权限键与 actor）。"""
    actor_id = _mk_actor("student")  # student 没有 role_manage
    clear_permission_cache()
    try:
        checker = require_permission("role_manage")
        request = _stub_request(actor_id, f"deny-{uuid.uuid4().hex[:6]}")
        user = SimpleNamespace(
            id=actor_id,
            username="a4-actor",
            display_name="A4 操作者",
            role=SimpleNamespace(name="student"),
            has_permission=lambda _p: False,
        )

        with pytest.raises(HTTPException) as exc:
            checker(request=request, current_user=user)
        assert exc.value.status_code == 403

        rows = [r for r in _rows(ACTION_ACCESS_DENIED) if r.actor_id == actor_id]
        assert len(rows) == 1
        assert rows[0].outcome == "denied"
        assert rows[0].payload["required_permission"] == "role_manage"
        assert rows[0].target_id == "role_manage"
    finally:
        _cleanup([actor_id])
        clear_permission_cache()


def test_export_is_audited_with_rows_and_filters():
    """导出成功 → 恰一行 export.downloaded，含行数/格式/筛选。"""
    actor_id = _mk_actor("student")
    try:
        request = _stub_request(actor_id, f"exp-{uuid.uuid4().hex[:6]}")
        response = export_response(
            [1, 2, 3],
            [],
            "测试导出",
            audit=ExportAudit(request=request, target_label="测试导出", filters={"action": "role.updated"}),
        )
        assert response.status_code == 200

        rows = [r for r in _rows(ACTION_EXPORT_DOWNLOADED) if r.target_label == "测试导出"]
        assert len(rows) == 1
        assert rows[0].payload["rows"] == 3
        assert rows[0].payload["format"] == "csv"
        assert rows[0].payload["filters"] == {"action": "role.updated"}
    finally:
        _cleanup([actor_id])


def test_over_limit_export_is_rejected_and_leaves_no_export_audit():
    """超限导出被 400 拒掉 → **不该**留下"已导出"的记录（只在判定通过后才记）。"""
    actor_id = _mk_actor("student")
    try:
        request = _stub_request(actor_id, f"over-{uuid.uuid4().hex[:6]}")
        with pytest.raises(HTTPException) as exc:
            export_response(
                [None] * (MAX_EXPORT_ROWS + 1),
                [],
                "超限",
                audit=ExportAudit(request=request, target_label="超限测试"),
            )
        assert exc.value.status_code == 400
        assert [r for r in _rows(ACTION_EXPORT_DOWNLOADED) if r.target_label == "超限测试"] == []
    finally:
        _cleanup([actor_id])
