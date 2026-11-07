"""视角授予的三道闸：租户边界、平台视角、提权上限，以及授予留痕。

这些规则不写在端点里而是服务里（`PersonaService`），所以直接测服务：
- 跨校目标 → 404（不暴露存在性）；
- 目标是平台账号 → 400（派生全视角，不可编辑）；
- 平台视角只能授予平台账号；
- 调用者只能授予自己当前视角权限覆盖得到的视角（403）；
- 成功替换后写 `user_personas` 并留下 `user.personas_updated`。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from core.audit import ACTION_USER_PERSONAS_UPDATED
from core.database import Base
from core.database import engine as pg_engine
from core.exceptions import AuthError, NotFoundError, ValidationError
from core.personas import PERSONAS
from core.tenant import TenantScope
from models import AuditLog, Role, School, User, UserPersona
from modules.admin.personas import PersonaService

_TABLES = [School.__table__, Role.__table__, User.__table__, UserPersona.__table__, AuditLog.__table__]


@pytest.fixture(scope="module", autouse=True)
def _schema():
    Base.metadata.create_all(pg_engine, tables=_TABLES)


def _school(db, name: str) -> School:
    school = School(name=f"{name}-{uuid.uuid4().hex[:6]}", created_at=datetime.now(UTC))
    db.add(school)
    db.flush()
    return school


def _actor(db, *, school: School | None, perms: set[str], platform: bool = False) -> User:
    role = db.query(Role).filter(Role.name == ("super_admin" if platform else "teacher")).first()
    if role is None:
        role = Role(name=("super_admin" if platform else "teacher"), display_name="x", is_system=True)
        db.add(role)
        db.flush()
    user = User(
        username=f"actor-{uuid.uuid4().hex[:8]}",
        password_hash="x",
        role_id=role.id,
        display_name="actor",
        school_id=school.id if school else None,
        is_platform=platform,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db.add(user)
    db.flush()
    user.set_permissions_cache(perms)
    return user


def _target(db, school: School, *, platform: bool = False) -> User:
    role = db.query(Role).filter(Role.name == "student").first()
    if role is None:
        role = Role(name="student", display_name="学生", is_system=True)
        db.add(role)
        db.flush()
    user = User(
        username=f"target-{uuid.uuid4().hex[:8]}",
        password_hash="x",
        role_id=role.id,
        display_name="target",
        school_id=school.id,
        is_platform=platform,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db.add(user)
    db.flush()
    return user


def _service(db, school: School, actor: User) -> PersonaService:
    return PersonaService(db, TenantScope(school_id=school.id, class_ids=None, user_id=actor.id))


def test_cross_school_target_is_404(pg_session):
    school_a = _school(pg_session, "A")
    school_b = _school(pg_session, "B")
    actor = _actor(pg_session, school=school_a, perms=set(PERSONAS["admin"].permissions))
    target = _target(pg_session, school_b)

    with pytest.raises(NotFoundError):
        _service(pg_session, school_a, actor).replace(target.id, ["teacher"], actor=actor)


def test_platform_account_target_is_not_editable(pg_session):
    school = _school(pg_session, "A")
    actor = _actor(pg_session, school=school, perms=set(PERSONAS["admin"].permissions))
    target = _target(pg_session, school, platform=True)

    with pytest.raises(ValidationError):
        _service(pg_session, school, actor).replace(target.id, ["teacher"], actor=actor)


def test_platform_persona_cannot_be_granted_to_school_account(pg_session):
    school = _school(pg_session, "A")
    actor = _actor(pg_session, school=school, perms=set(PERSONAS["admin"].permissions))
    target = _target(pg_session, school)

    with pytest.raises(ValidationError):
        _service(pg_session, school, actor).replace(target.id, ["platform"], actor=actor)


def test_actor_cannot_grant_persona_above_own_permissions(pg_session):
    school = _school(pg_session, "A")
    actor = _actor(pg_session, school=school, perms=set(PERSONAS["teacher"].permissions))
    target = _target(pg_session, school)

    with pytest.raises(AuthError):
        _service(pg_session, school, actor).replace(target.id, ["admin"], actor=actor)


def test_replace_grants_writes_rows_and_audit(pg_session):
    school = _school(pg_session, "A")
    actor = _actor(pg_session, school=school, perms=set(PERSONAS["admin"].permissions))
    target = _target(pg_session, school)
    service = _service(pg_session, school, actor)

    granted = service.replace(target.id, ["teacher", "student", "teacher"], actor=actor)

    assert granted == ["teacher", "student"]
    rows = {row.persona for row in pg_session.query(UserPersona).filter(UserPersona.user_id == target.id).all()}
    assert rows == {"teacher", "student"}
    audit = (
        pg_session.query(AuditLog)
        .filter(AuditLog.action == ACTION_USER_PERSONAS_UPDATED, AuditLog.target_id == str(target.id))
        .order_by(AuditLog.id.desc())
        .first()
    )
    assert audit is not None
    assert audit.payload["after"] == ["teacher", "student"]
    assert audit.payload["school_id"] == school.id
