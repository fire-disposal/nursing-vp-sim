"""视角（persona）= 权限预设的判据。

视角是**代码拥有**的权限包，`user_personas` 只记"谁被授予了哪些"。这块的失败模式
不是崩溃而是**静默放宽**（预设多写一个键 = 整档人越权）与**静默失权**（迁移前的老用户
因为新表为空而变什么都干不了），所以：

- 预设逐键精确断言（多一个少一个都算红）；
- 默认视角 / 超管派生 / legacy 回落三条分支各钉一条；
- 越权视角必须 403 且 detail 为「视角不可用」（前端按它提示，不该显示"权限不足"）；
- 审计落的是**操作时的视角**而不是角色名 —— 同一教师切到 admin 视角后，
  事后只看得见 `actor_role=teacher` 就回答不了"他当时以什么身份做的"。
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

os.environ["JWT_SECRET_KEY"] = "test-secret-key-for-testing-only"

from core.audit import ACTION_ROLE_UPDATED, TARGET_TYPE_ROLE, record
from core.database import Base
from core.database import engine as pg_engine
from core.permissions import PERMISSION_KEYS
from core.personas import (
    DEFAULT_PERSONA_BY_ROLE,
    PERSONA_KEYS,
    PERSONAS,
    default_persona_for,
    grants_all_personas,
    persona_permissions,
)
from core.security import clear_permission_cache, load_user_personas, resolve_view_persona
from models import AuditLog, Role, User, UserPersona

# ── 预设快照 ────────────────────────────────────────────────────────────────

_STUDENT = {"training_access", "scenario_training", "qa_access"}
_TEACHER = {
    "grade_class_manage",
    "case_manage",
    "training_access",
    "scenario_training",
    "qa_access",
    "score_review",
    "stats_view",
    "assignment_manage",
    "feedback_review",
    "export_data",
    "questionnaire_manage",
}
_ADMIN = {
    "user_manage",
    "role_manage",
    "grade_class_manage",
    "case_manage",
    "training_access",
    "scenario_training",
    "score_review",
    "stats_view",
    "qa_access",
    "llm_monitor",
    "assignment_manage",
    "feedback_review",
    "export_data",
    "questionnaire_manage",
}
_OPS = {
    "llm_monitor",
    "api_manage",
    "audit_view",
    "audit_export",
    "feedback_review",
    "export_data",
}
_PLATFORM = {
    "school_manage",
    "api_manage",
    "audit_view",
    "audit_export",
    "llm_monitor",
    "export_data",
}


def test_persona_keys_are_exactly_the_five_contracted_ones():
    assert set(PERSONA_KEYS) == {"student", "teacher", "admin", "ops", "platform"}
    assert set(PERSONAS) == set(PERSONA_KEYS)


@pytest.mark.parametrize(
    ("persona", "expected"),
    [("student", _STUDENT), ("teacher", _TEACHER), ("admin", _ADMIN), ("ops", _OPS), ("platform", _PLATFORM)],
)
def test_persona_presets_match_contract_exactly(persona: str, expected: set[str]):
    """预设是权限包的全部内容：**不多不少**（多的就是越权，少的会 403）。"""
    assert set(PERSONAS[persona].permissions) == expected
    assert persona_permissions(persona) == frozenset(expected)


def test_persona_presets_only_reference_defined_permissions():
    defined = set(PERMISSION_KEYS)
    for key in PERSONA_KEYS:
        assert set(PERSONAS[key].permissions) <= defined, f"{key} 引用了未定义权限"
        # 重复键会让"改一个键"变成"No-op"式的意外，预设里不该有
        assert len(PERSONAS[key].permissions) == len(set(PERSONAS[key].permissions))


def test_unknown_persona_has_no_permissions():
    assert persona_permissions("nope") == frozenset()
    assert persona_permissions("") == frozenset()


# ── 授予集合 / 默认视角（纯函数，不碰 DB）─────────────────────────────────────


def _stub_user(role_name: str | None) -> Any:
    role = None if role_name is None else SimpleNamespace(name=role_name)
    return SimpleNamespace(id=1, role=role, role_id=1)


def test_super_admin_derives_all_personas():
    assert grants_all_personas(_stub_user("super_admin")) is True
    for role_name in ("admin", "teacher", "student", "ops", "custom", None):
        assert grants_all_personas(_stub_user(role_name)) is False


def test_default_persona_per_system_role():
    assert default_persona_for(_stub_user("student")) == "student"
    assert default_persona_for(_stub_user("teacher")) == "teacher"
    assert default_persona_for(_stub_user("admin")) == "admin"
    assert default_persona_for(_stub_user("super_admin")) == "platform"


def test_default_persona_is_none_for_custom_role_and_missing_role():
    """自定义角色没有预设 → None（未授予视角 → 无权限，管理员需显式授予）。"""
    assert default_persona_for(_stub_user("nurse_lead")) is None
    assert default_persona_for(_stub_user(None)) is None
    assert set(DEFAULT_PERSONA_BY_ROLE) == {"student", "teacher", "admin", "super_admin"}


# ── 视角解析（真实 PG：`user_personas` 的行决定能选什么）───────────────────────

_TABLES = [Role.__table__, User.__table__, UserPersona.__table__, AuditLog.__table__]


#: 授予行的写入需要跨用例可见（`pg_session` 是 savepoint 隔离，同一 session 内可见即可），
#: 但权限缓存是**进程级**的（按 user_id 缓存），savepoint 回滚不会清 → 每个用例自行清。
@pytest.fixture(scope="module", autouse=True)
def _schema():
    Base.metadata.create_all(pg_engine, tables=_TABLES)


def _role(db, name: str) -> Role:
    role = db.query(Role).filter(Role.name == name).first()
    if role is None:
        role = Role(name=name, display_name=name, is_system=True)
        db.add(role)
        db.flush()
    clear_permission_cache()
    return role


def _user(db, role_name: str) -> User:
    role = _role(db, role_name)
    user = User(
        username=f"persona-{uuid.uuid4().hex[:10]}",
        password_hash="x",
        role_id=role.id,
        display_name=f"视角用例 {role_name}",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db.add(user)
    db.flush()
    clear_permission_cache()
    return user


def _grant(db, user: User, *personas: str) -> None:
    for persona in personas:
        db.add(UserPersona(user_id=user.id, persona=persona))
    db.flush()
    clear_permission_cache()


@pytest.fixture(autouse=True)
def _fresh_permission_cache():
    """进程级缓存在用例之间会串味（savepoint 回滚不清缓存）→ 前后各清一次。"""
    clear_permission_cache()
    yield
    clear_permission_cache()


def test_no_header_falls_back_to_default_persona(pg_session):
    user = _user(pg_session, "teacher")
    _grant(pg_session, user, "teacher", "admin")

    persona, perms = resolve_view_persona(pg_session, user, None)

    assert persona == "teacher", "系统角色的默认视角由其角色决定"
    assert perms == frozenset(_TEACHER)


def test_granted_header_persona_takes_effect(pg_session):
    user = _user(pg_session, "teacher")
    _grant(pg_session, user, "teacher", "admin")

    persona, perms = resolve_view_persona(pg_session, user, "admin")

    assert persona == "admin"
    assert perms == frozenset(_ADMIN)
    # 换回教师视角 = 权限回收（生效权限只看当前视角，不取并集）
    persona, perms = resolve_view_persona(pg_session, user, "teacher")
    assert persona == "teacher"
    assert "user_manage" not in perms


def test_ungranted_persona_is_rejected_with_contract_detail(pg_session):
    user = _user(pg_session, "student")
    _grant(pg_session, user, "student")

    with pytest.raises(HTTPException) as exc:
        resolve_view_persona(pg_session, user, "admin")

    assert exc.value.status_code == 403
    assert exc.value.detail == "视角不可用"


def test_super_admin_grants_all_personas_without_rows(pg_session):
    """超管派生：`user_personas` 没有任何行也能选任意视角，且不因"无行"落入 legacy。"""
    user = _user(pg_session, "super_admin")

    assert pg_session.query(UserPersona).filter(UserPersona.user_id == user.id).count() == 0
    assert load_user_personas(pg_session, user) == frozenset(PERSONA_KEYS)

    persona, perms = resolve_view_persona(pg_session, user, "ops")
    assert persona == "ops"
    assert perms == frozenset(_OPS)

    # 无 header → 默认平台视角（跨院校的平台级功能）
    persona, perms = resolve_view_persona(pg_session, user, None)
    assert persona == "platform"
    assert perms == frozenset(_PLATFORM)


def test_user_without_grants_can_login_but_has_no_permissions(pg_session):
    """没有授予任何视角：允许解析（/auth/me 要能用），但权限为空、不能借用预设。"""
    user = _user(pg_session, "nurse_lead")

    persona, perms = resolve_view_persona(pg_session, user, None)

    assert persona == "nurse_lead"
    assert perms == frozenset()
    with pytest.raises(HTTPException) as exc:
        resolve_view_persona(pg_session, user, "admin")
    assert exc.value.status_code == 403


def test_role_permissions_no_longer_grant_anything(pg_session):
    """角色不再承载权限：同名 teacher 角色、无 persona 行 → 仍然没有任何权限。"""
    user = _user(pg_session, "teacher")
    _persona, perms = resolve_view_persona(pg_session, user, None)
    assert perms == frozenset()


def test_granted_persona_is_selectable_regardless_of_role_name(pg_session):
    """授权了就必须能选：自定义角色的用户被授予 `ops` 后，带 header 选 `ops` 生效。

    （默认视角仍按契约走 legacy —— `default_persona_for` 只认系统角色。）
    """
    user = _user(pg_session, "nurse_lead")
    assert resolve_view_persona(pg_session, user, None)[0] == "nurse_lead"

    _grant(pg_session, user, "ops")

    persona, perms = resolve_view_persona(pg_session, user, "ops")
    assert persona == "ops"
    assert perms == frozenset(_OPS)
    assert "case_manage" not in perms


def test_default_persona_must_be_granted_else_a_granted_one_is_used(pg_session):
    """角色是 teacher 但只被授予 ops：不能"默认"到一个没授权的视角。"""
    user = _user(pg_session, "teacher")
    _grant(pg_session, user, "ops")

    persona, perms = resolve_view_persona(pg_session, user, None)

    assert persona == "ops", "默认 teacher 未授予时，只能取已授予集合里的视角"
    assert perms == frozenset(_OPS)


# ── 审计：落操作时的视角 ─────────────────────────────────────────────────────


def _request_with_persona(persona: str | None, actor: User | None = None):
    return SimpleNamespace(
        state=SimpleNamespace(request_id="req-persona", audit_actor=actor, view_persona=persona),
        headers={"user-agent": "pytest"},
        method="PUT",
        url=SimpleNamespace(path="/api/admin/roles/1"),
    )


def test_record_writes_actor_persona_from_request_state(pg_session):
    actor = _user(pg_session, "teacher")

    record(
        pg_session,
        action=ACTION_ROLE_UPDATED,
        target_type=TARGET_TYPE_ROLE,
        target_id=1,
        actor=actor,
        request=_request_with_persona("teacher", actor),
    )
    pg_session.flush()

    row = pg_session.query(AuditLog).filter(AuditLog.actor_id == actor.id).one()
    assert row.actor_persona == "teacher"
    # 快照列仍然记角色：视角回答"以什么身份"，角色回答"这个人是什么"
    assert row.actor_role == "teacher"


def test_record_leaves_actor_persona_null_without_view_persona(pg_session):
    """没有视角（未走 get_current_user 的内部调用）→ 该列为空，不臆造一个值。"""
    actor = _user(pg_session, "admin")
    request = SimpleNamespace(
        state=SimpleNamespace(request_id="req-no-persona", audit_actor=actor),
        headers={"user-agent": "pytest"},
        method="PUT",
        url=SimpleNamespace(path="/api/admin/roles/1"),
    )

    record(pg_session, action=ACTION_ROLE_UPDATED, target_type=TARGET_TYPE_ROLE, actor=actor, request=request)
    pg_session.flush()

    row = pg_session.query(AuditLog).filter(AuditLog.actor_id == actor.id).one()
    assert row.actor_persona is None
    assert row.actor_role == "admin"
