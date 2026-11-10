"""院校详情端点：跨校权限与「进入管理」前的口径。

真实 PG。两条断言贯穿全文：
1. 平台账号（``school_manage``）能看任意院校的详情；
2. **工作视图收窄（``X-School-Scope``）后只能看收窄到的那一所**，其余 404 —— 详情页
   不能成为绕开作用域的旁路（与班级/账号详情同一失败关闭口径）。
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from core.access import clear_access_cache
from core.exceptions import NotFoundError
from core.personas import persona_permissions
from core.tenant import apply_school_scope, resolve_scope
from models import Class, ClassMembership, School, SchoolBudget, User, UserSchoolPersona
from modules.admin.schools import SchoolService

NOW = datetime.now(UTC)


def _school(db, name: str) -> School:
    school = School(name=name, theme_color="blue", created_at=NOW)
    db.add(school)
    db.flush()
    return school


def _user(db, username: str, persona: str, school_id: int | None) -> User:
    user = User(
        username=username,
        password_hash="x",
        school_id=school_id,
        display_name=username,
        is_platform=school_id is None,
        created_at=NOW,
        updated_at=NOW,
    )
    db.add(user)
    db.flush()
    if school_id is not None:
        db.add(UserSchoolPersona(user_id=user.id, school_id=school_id, persona=persona))
        db.flush()
    user.set_active_persona(persona)
    user.set_permissions_cache(set(persona_permissions(persona)))
    clear_access_cache()
    return user


def _class(db, name: str, school_id: int, cohort_label: str = "2026级") -> Class:
    cls = Class(name=name, cohort_label=cohort_label, school_id=school_id, created_at=NOW)
    db.add(cls)
    db.flush()
    return cls


def _join(db, user: User, cls: Class, role: str = "student") -> None:
    db.add(ClassMembership(user_id=user.id, class_id=cls.id, member_role=role, joined_at=NOW))
    db.flush()


@pytest.fixture
def world(pg_session):
    db = pg_session
    clear_access_cache()
    school_a = _school(db, "甲大学")
    school_b = _school(db, "乙学院")
    platform_user = _user(db, "platform-root", "platform", None)
    admin_a = _user(db, "admin-a", "admin", school_a.id)
    admin_b = _user(db, "admin-b", "admin", school_b.id)
    class_a1 = _class(db, "甲一班", school_a.id)
    class_a2 = _class(db, "甲二班", school_a.id, "2027级")
    class_b = _class(db, "乙班", school_b.id)
    _join(db, admin_a, class_a1, "teacher")
    _join(db, admin_a, class_a2, "teacher")
    _join(db, _user(db, "stu-a1", "student", school_a.id), class_a1)
    _join(db, _user(db, "stu-a2", "student", school_a.id), class_a1)
    db.add(SchoolBudget(school_id=school_a.id, llm_monthly_limit=100.0, tts_monthly_limit=50.0))
    db.flush()
    return {
        "db": db,
        "school_a": school_a,
        "school_b": school_b,
        "scope_platform": resolve_scope(db, platform_user),
        "scope_a": resolve_scope(db, admin_a),
        "scope_b": resolve_scope(db, admin_b),
    }


def test_platform_reads_any_school_detail(world):
    detail = SchoolService(world["db"]).detail(world["school_b"].id, world["scope_platform"])
    assert detail.id == world["school_b"].id
    assert detail.name == "乙学院"
    assert detail.theme_color == "blue"
    assert detail.class_count == 1
    assert detail.user_count == 1  # 只有 admin-b 在乙学院
    assert detail.admin_count == 1  # 有人能管这所院校；0 才是"三不管"


def test_detail_carries_counts_and_classes(world):
    detail = SchoolService(world["db"]).detail(world["school_a"].id, world["scope_platform"])
    assert detail.class_count == 2
    assert detail.class_total == 2
    assert {c.name for c in detail.classes} == {"甲一班", "甲二班"}
    by_name = {c.name: c for c in detail.classes}
    assert by_name["甲一班"].student_count == 2
    assert by_name["甲一班"].teacher_count == 1
    assert by_name["甲二班"].teacher_count == 1
    assert by_name["甲二班"].student_count == 0


def test_detail_carries_quota_limits(world):
    detail = SchoolService(world["db"]).detail(world["school_a"].id, world["scope_platform"])
    assert detail.llm_monthly_limit == 100.0
    assert detail.tts_monthly_limit == 50.0
    assert detail.llm_used >= 0.0
    assert detail.tts_used >= 0.0
    # 没配过额度的院校：上限 0 = 不限，日额度继承平台默认
    other = SchoolService(world["db"]).detail(world["school_b"].id, world["scope_platform"])
    assert other.llm_monthly_limit == 0.0
    assert other.default_daily_llm_limit is None


def test_narrowed_platform_view_reads_only_scoped_school(world):
    narrowed = apply_school_scope(world["scope_platform"], str(world["school_a"].id))
    detail = SchoolService(world["db"]).detail(world["school_a"].id, narrowed)
    assert detail.id == world["school_a"].id

    with pytest.raises(NotFoundError):
        SchoolService(world["db"]).detail(world["school_b"].id, narrowed)


def test_school_admin_detail_fails_closed_across_schools(world):
    """院校管理员即便猜到 id 也只能拿到本校；外校 404（不确认"存在但无权"）。"""
    service = SchoolService(world["db"])
    assert service.detail(world["school_a"].id, world["scope_a"]).id == world["school_a"].id
    with pytest.raises(NotFoundError):
        service.detail(world["school_b"].id, world["scope_a"])
    with pytest.raises(NotFoundError):
        service.detail(world["school_a"].id, world["scope_b"])


def test_missing_school_is_404(world):
    with pytest.raises(NotFoundError):
        SchoolService(world["db"]).detail(999_999, world["scope_platform"])


def test_detail_counts_do_not_leak_other_school_classes(world):
    """详情里的班级摘要只含本院校：串一个班就等于在详情页泄漏外校花名册入口。"""
    detail = SchoolService(world["db"]).detail(world["school_b"].id, world["scope_platform"])
    assert [c.name for c in detail.classes] == ["乙班"]
