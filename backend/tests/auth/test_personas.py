"""视角（persona）= 权限预设的判据。

视角是**代码拥有**的权限包，`user_personas` 只记"谁被授予了哪些"。这块的失败模式
不是崩溃而是**静默放宽**（预设多写一个键 = 整档人越权）与**静默失权**（迁移前的老用户
因为新表为空而变什么都干不了），所以：

- 预设逐键精确断言（多一个少一个都算红）；
- 默认视角 / 超管派生 / legacy 回落三条分支各钉一条；
- 越权视角必须 403 且 detail 为「视角不可用」（前端按它提示，不该显示"权限不足"）；
- 审计落的是**操作时的视角**而不是角色名 —— 同一教师切到 admin 视角后，
  事后只看得见账号名就回答不了"他当时以什么身份做的"。
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

from core.audit import ACTION_USER_PERSONAS_UPDATED, ACTION_USER_UPDATED, TARGET_TYPE_USER, record
from core.database import Base
from core.database import engine as pg_engine
from core.permissions import PERMISSION_KEYS
from core.personas import (
    PERSONA_KEYS,
    PERSONAS,
    default_persona_for,
    grants_all_personas,
    persona_permissions,
)
from core.security import clear_permission_cache, load_user_personas, resolve_view_persona
from models import AuditLog, School, User, UserSchoolPersona

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


def _stub_user(*, platform: bool = False) -> Any:
    """只带 ``is_platform`` 的账号替身：角色退场后平台身份是唯一判据。"""
    return SimpleNamespace(id=1, is_platform=platform)


def test_platform_account_derives_all_personas():
    assert grants_all_personas(_stub_user(platform=True)) is True
    assert grants_all_personas(_stub_user(platform=False)) is False


def test_default_persona_is_platform_for_platform_account_only():
    assert default_persona_for(_stub_user(platform=True)) == "platform"


def test_default_persona_is_none_for_school_account():
    """院校账号没有"默认视角"→ None：生效视角由已授予集合决定（管理员需显式授予）。"""
    assert default_persona_for(_stub_user(platform=False)) is None


# ── 视角解析（真实 PG：`user_personas` 的行决定能选什么）───────────────────────

_TABLES = [School.__table__, User.__table__, UserSchoolPersona.__table__, AuditLog.__table__]


#: 授予行的写入需要跨用例可见（`pg_session` 是 savepoint 隔离，同一 session 内可见即可），
#: 但权限缓存是**进程级**的（按 user_id 缓存），savepoint 回滚不会清 → 每个用例自行清。
@pytest.fixture(scope="module", autouse=True)
def _schema():
    Base.metadata.create_all(pg_engine, tables=_TABLES)


def _user(db, *, platform: bool = False) -> User:
    """账号替身：院校账号没有任何视角授予，平台账号派生全部视角。"""
    school = db.query(School).first()
    if school is None:
        school = School(name=f"school-{uuid.uuid4().hex[:8]}")
        db.add(school)
        db.flush()
    user = User(
        username=f"persona-{uuid.uuid4().hex[:10]}",
        password_hash="x",
        display_name="视角用例",
        is_platform=platform,
        school_id=None if platform else school.id,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db.add(user)
    db.flush()
    clear_permission_cache()
    return user


def _grant(db, user: User, *personas: str) -> None:
    if user.school_id is None:
        return
    for persona in personas:
        db.add(UserSchoolPersona(user_id=user.id, school_id=user.school_id, persona=persona))
    db.flush()
    clear_permission_cache()


@pytest.fixture(autouse=True)
def _fresh_permission_cache():
    """进程级缓存在用例之间会串味（savepoint 回滚不清缓存）→ 前后各清一次。"""
    clear_permission_cache()
    yield
    clear_permission_cache()


def test_no_header_uses_a_granted_persona(pg_session):
    user = _user(pg_session)
    _grant(pg_session, user, "ops", "teacher")

    persona, perms = resolve_view_persona(pg_session, user, None)

    # 无默认视角的院校账号：取已授予集合里排序最前的一个（确定性）
    assert persona == "ops"
    assert perms == frozenset(_OPS)


def test_granted_header_persona_takes_effect(pg_session):
    user = _user(pg_session)
    _grant(pg_session, user, "teacher", "admin")

    persona, perms = resolve_view_persona(pg_session, user, "admin")

    assert persona == "admin"
    assert perms == frozenset(_ADMIN)
    # 换回教师视角 = 权限回收（生效权限只看当前视角，不取并集）
    persona, perms = resolve_view_persona(pg_session, user, "teacher")
    assert persona == "teacher"
    assert "user_manage" not in perms


def test_ungranted_persona_is_rejected_with_contract_detail(pg_session):
    user = _user(pg_session)
    _grant(pg_session, user, "student")

    with pytest.raises(HTTPException) as exc:
        resolve_view_persona(pg_session, user, "admin")

    assert exc.value.status_code == 403
    assert exc.value.detail == "视角不可用"


def test_platform_account_grants_all_personas_without_rows(pg_session):
    """平台账号派生：`user_personas` 没有任何行也能选任意视角。"""
    user = _user(pg_session, platform=True)

    assert pg_session.query(UserSchoolPersona).filter(UserSchoolPersona.user_id == user.id).count() == 0
    assert load_user_personas(pg_session, user) == frozenset(PERSONA_KEYS)

    # 非 platform 视角必须有选校；平台账号不再默认拿到“所有学校”的教师/运维面
    with pytest.raises(HTTPException) as exc:
        resolve_view_persona(pg_session, user, "ops")
    assert exc.value.status_code == 403

    # 无 header → 默认平台视角（跨院校的平台级功能）
    persona, perms = resolve_view_persona(pg_session, user, None)
    assert persona == "platform"
    assert perms == frozenset(_PLATFORM)


def test_user_without_grants_can_login_but_has_no_permissions(pg_session):
    """没有授予任何视角：允许解析（/auth/me 要能用），但权限为空、不能借用预设。"""
    user = _user(pg_session)

    persona, perms = resolve_view_persona(pg_session, user, None)

    assert persona is None, "没有任何视角可生效 → 不臆造一个身份"
    assert perms == frozenset()
    with pytest.raises(HTTPException) as exc:
        resolve_view_persona(pg_session, user, "admin")
    assert exc.value.status_code == 403


def test_grant_snapshot_do_not_leak_between_users(pg_session):
    """他人授予不影响本人：同库另一账号被授予全部视角，本账号仍无权限。"""
    other = _user(pg_session)
    _grant(pg_session, other, *PERSONA_KEYS)

    user = _user(pg_session)
    _persona, perms = resolve_view_persona(pg_session, user, None)

    assert perms == frozenset()


def test_granted_persona_is_selectable(pg_session):
    """授权了就必须能选：被授予 `ops` 后，带 header 选 `ops` 生效。"""
    user = _user(pg_session)
    assert resolve_view_persona(pg_session, user, None) == (None, frozenset())

    _grant(pg_session, user, "ops")

    persona, perms = resolve_view_persona(pg_session, user, "ops")
    assert persona == "ops"
    assert perms == frozenset(_OPS)
    assert "case_manage" not in perms


def test_default_persona_must_be_within_granted_set(pg_session):
    """授予了 student 与 ops：无 header 只能在已授予集合里取，不能落到 `platform`。"""
    user = _user(pg_session)
    _grant(pg_session, user, "student", "ops")

    persona, perms = resolve_view_persona(pg_session, user, None)

    assert persona in {"ops", "student"}
    assert perms == frozenset(_OPS if persona == "ops" else _STUDENT)


# ── 审计：落操作时的视角 ─────────────────────────────────────────────────────


def _request_with_persona(persona: str | None, actor: User | None = None):
    return SimpleNamespace(
        state=SimpleNamespace(request_id="req-persona", audit_actor=actor, view_persona=persona),
        headers={"user-agent": "pytest"},
        method="PUT",
        url=SimpleNamespace(path="/api/admin/users/1"),
    )


def test_record_writes_actor_persona_from_request_state(pg_session):
    actor = _user(pg_session)

    record(
        pg_session,
        action=ACTION_USER_PERSONAS_UPDATED,
        target_type=TARGET_TYPE_USER,
        target_id=1,
        actor=actor,
        request=_request_with_persona("teacher", actor),
    )
    pg_session.flush()

    row = pg_session.query(AuditLog).filter(AuditLog.actor_id == actor.id).one()
    assert row.actor_persona == "teacher"
    # 角色退场后身份快照只剩视角：`actor_role` 不再有来源，保持空
    assert row.actor_role is None


def test_record_leaves_actor_persona_null_without_view_persona(pg_session):
    """没有视角（未走 get_current_user 的内部调用）→ 该列为空，不臆造一个值。"""
    actor = _user(pg_session, platform=True)
    request = SimpleNamespace(
        state=SimpleNamespace(request_id="req-no-persona", audit_actor=actor),
        headers={"user-agent": "pytest"},
        method="PUT",
        url=SimpleNamespace(path="/api/admin/users/1"),
    )

    record(pg_session, action=ACTION_USER_UPDATED, target_type=TARGET_TYPE_USER, actor=actor, request=request)
    pg_session.flush()

    row = pg_session.query(AuditLog).filter(AuditLog.actor_id == actor.id).one()
    assert row.actor_persona is None
    assert row.actor_role is None


def test_multi_school_grants_are_school_scoped(pg_session):
    """同一账号在不同院校的授予互不串用；A 校管理员不能拿 B 校教师身份。"""
    from core.access import accessible_school_ids, resolve_access
    from core.tenant import resolve_scope
    from models import School, UserSchoolPersona

    school_a = School(name=f"甲-{uuid.uuid4().hex[:6]}")
    school_b = School(name=f"乙-{uuid.uuid4().hex[:6]}")
    pg_session.add_all([school_a, school_b])
    pg_session.flush()
    user = User(
        username=f"multi-{uuid.uuid4().hex[:8]}",
        password_hash="x",
        display_name="多校账号",
        school_id=school_a.id,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    pg_session.add(user)
    pg_session.flush()
    pg_session.add(UserSchoolPersona(user_id=user.id, school_id=school_a.id, persona="admin"))
    pg_session.add(UserSchoolPersona(user_id=user.id, school_id=school_b.id, persona="teacher"))
    pg_session.flush()
    clear_permission_cache()

    assert accessible_school_ids(pg_session, user) == frozenset({school_a.id, school_b.id})
    ctx_b = resolve_access(pg_session, user, str(school_b.id), "teacher")
    assert (ctx_b.school_id, ctx_b.persona) == (school_b.id, "teacher")
    with pytest.raises(HTTPException) as exc:
        resolve_access(pg_session, user, str(school_a.id), "teacher")
    assert exc.value.status_code == 403

    user.set_active_school(school_b.id)
    user.set_active_persona("teacher")
    user.set_permissions_cache(set(ctx_b.permissions))
    assert resolve_scope(pg_session, user).school_id == school_b.id


def test_platform_non_platform_persona_requires_selected_school(pg_session):
    """超管的教师/学生面不再默认拥有“所有学校”的数据范围。"""
    from core.access import resolve_access
    from core.tenant import resolve_scope
    from models import School

    platform = _user(pg_session, platform=True)
    with pytest.raises(HTTPException) as exc:
        resolve_access(pg_session, platform, None, "student")
    assert exc.value.status_code == 403

    school = School(name=f"平台选校-{uuid.uuid4().hex[:6]}")
    pg_session.add(school)
    pg_session.flush()
    ctx = resolve_access(pg_session, platform, str(school.id), "student")
    assert (ctx.school_id, ctx.persona) == (school.id, "student")
    platform.set_active_school(school.id)
    platform.set_active_persona("student")
    assert resolve_scope(pg_session, platform).school_id == school.id
