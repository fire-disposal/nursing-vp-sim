"""密钥 CRUD 的审计判据（真实 PG）——重点：**密钥明文绝不进审计 payload**。

密钥是最高敏感度的配置；审计表会被更宽的范围读取（`audit_view`），因此只能记元信息
（label / base_url / 末四位 / 变更前后字段），不能记 `api_key` 本身。
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from core.audit import ACTION_SECRET_CREATED, ACTION_SECRET_DELETED, ACTION_SECRET_UPDATED
from core.database import Base
from core.database import engine as pg_engine
from models import ApiSecret, AuditLog, LLMCallLog, Role, User
from modules.admin.secrets import ApiSecretService

_TABLES = [Role.__table__, User.__table__, ApiSecret.__table__, LLMCallLog.__table__, AuditLog.__table__]
_SECRET = "sk-verysecret-abcdef1234"


@pytest.fixture(scope="module", autouse=True)
def _schema():
    Base.metadata.create_all(pg_engine, tables=_TABLES)


@pytest.fixture
def db(pg_session):
    return pg_session


@pytest.fixture
def request_stub(db):
    role = db.query(Role).filter(Role.name == "super_admin").first() or Role(
        name="super_admin", display_name="超级管理员", is_system=True
    )
    db.add(role)
    db.flush()
    actor = User(
        username="secret-audit-actor",
        password_hash="x",
        role_id=role.id,
        display_name="密钥操作者",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db.add(actor)
    db.flush()
    return SimpleNamespace(
        state=SimpleNamespace(request_id="req-secret", audit_actor=actor),
        headers={"user-agent": "pytest"},
        method="POST",
        url=SimpleNamespace(path="/api/admin/secrets"),
    )


def test_create_secret_audits_metadata_without_plaintext(db, request_stub):
    ApiSecretService(db).create(
        {"label": "主力通道", "raw_key": _SECRET, "base_url": "https://api.example.com", "priority": 1},
        request=request_stub,
    )

    row = db.query(AuditLog).filter(AuditLog.action == ACTION_SECRET_CREATED).one()
    assert row.target_label == "主力通道"
    assert row.payload["key_suffix"] == "1234"
    # 明文绝不能出现在 payload 的任何位置
    assert _SECRET not in json.dumps(row.payload, ensure_ascii=False)


def test_update_secret_records_field_changes_only(db, request_stub):
    service = ApiSecretService(db)
    service.create({"label": "备用", "raw_key": _SECRET, "priority": 1}, request=request_stub)
    secret_id = db.query(ApiSecret).filter(ApiSecret.label == "备用").one().id

    service.update(secret_id, {"priority": 5, "label": "备用-已调"}, request=request_stub)

    row = db.query(AuditLog).filter(AuditLog.action == ACTION_SECRET_UPDATED).one()
    assert row.payload["changes"]["priority"] == {"before": 1, "after": 5}
    assert row.payload["changes"]["label"] == {"before": "备用", "after": "备用-已调"}
    assert _SECRET not in json.dumps(row.payload, ensure_ascii=False)


def test_delete_secret_is_audited(db, request_stub):
    service = ApiSecretService(db)
    service.create({"label": "待删", "raw_key": _SECRET}, request=request_stub)
    secret_id = db.query(ApiSecret).filter(ApiSecret.label == "待删").one().id

    service.delete(secret_id, request=request_stub)

    row = db.query(AuditLog).filter(AuditLog.action == ACTION_SECRET_DELETED).one()
    assert row.target_id == str(secret_id)
    assert row.payload == {"label": "待删"}
