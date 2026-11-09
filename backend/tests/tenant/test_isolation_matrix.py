"""院校隔离矩阵（真实 PG）：A 校管理员不得以任何路径看到 B 校的班级与账号。

这是租户隔离唯一的自动化兜底 —— 收窄写在查询层，漏一处就等于跨校泄漏，而漏点只能靠
"逐条路径真打一遍"发现。断言口径：越权一律 404（`NotFoundError`），
写入侧跨校抛 `ValidationError`（本仓映射 400）。
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from core.access import clear_access_cache
from core.exceptions import NotFoundError, ValidationError
from core.personas import persona_permissions
from core.tenant import apply_school_scope, platform_scope, resolve_scope, school_name_map
from models import Case, Class, ClassMembership, School, TrainingRecord, User, UserSchoolPersona
from modules.admin.class_memberships import upsert_members
from modules.admin.classes import ClassService
from modules.admin.exports import RecordService
from modules.admin.stats import StatsService
from modules.admin.users import UserFilters, UserService
from modules.scoreboard.service import ScoreboardScope, ScoreboardService

NOW = datetime.now(UTC)


def _school(db, name: str) -> School:
    school = School(name=name, created_at=NOW)
    db.add(school)
    db.flush()
    return school


def _user(db, username: str, persona: str, school_id: int | None) -> User:
    """建账号并授予 ``persona``（``"platform"`` = 平台账号，不再落授予行）。

    模拟 ``get_current_user``：装载生效视角与对应权限（作用域由视角声明决定）。
    """
    is_platform = persona == "platform"
    user = User(
        username=username,
        password_hash="x",
        school_id=school_id,
        display_name=username,
        is_platform=is_platform,
        created_at=NOW,
        updated_at=NOW,
    )
    db.add(user)
    db.flush()
    if not is_platform and school_id is not None:
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
    """两所院校、两名院校管理员、各两组师生，互不相干。"""
    db = pg_session
    clear_access_cache()
    school_a = _school(db, "甲大学")
    school_b = _school(db, "乙学院")
    admin_a = _user(db, "admin-a", "admin", school_a.id)
    admin_b = _user(db, "admin-b", "admin", school_b.id)
    platform_user = _user(db, "platform-root", "platform", None)
    class_a = _class(db, "甲班", school_a.id)
    class_b = _class(db, "乙班", school_b.id)
    stu_a = _user(db, "stu-a", "student", school_a.id)
    stu_b = _user(db, "stu-b", "student", school_b.id)
    _join(db, stu_a, class_a)
    _join(db, stu_b, class_b)
    return {
        "db": db,
        "school_a": school_a,
        "school_b": school_b,
        "admin_a": admin_a,
        "admin_b": admin_b,
        "platform_user": platform_user,
        "class_a": class_a,
        "class_b": class_b,
        "stu_a": stu_a,
        "stu_b": stu_b,
        "scope_a": resolve_scope(db, admin_a),
        "scope_b": resolve_scope(db, admin_b),
        "scope_platform": resolve_scope(db, platform_user),
    }


def test_scope_resolution_shapes(world):
    assert world["scope_a"].school_id == world["school_a"].id
    assert world["scope_a"].class_ids is None, "有 user_manage 的院校管理员应看全校"
    assert world["scope_platform"].is_global, "平台账号（school_id 为空）→ 平台作用域"


def test_class_list_only_own_school(world):
    names = {c.name for c in ClassService(world["db"], world["scope_a"]).list_all()}
    assert names == {"甲班"}
    all_names = {c.name for c in ClassService(world["db"], world["scope_platform"]).list_all()}
    assert all_names == {"甲班", "乙班"}


def test_class_get_across_school_is_404(world):
    with pytest.raises(NotFoundError):
        ClassService(world["db"], world["scope_a"]).get(world["class_b"].id)


def test_class_create_forced_into_own_school(world):
    created = ClassService(world["db"], world["scope_a"]).create("新班", "2027级")
    assert created.school_id == world["school_a"].id

    with pytest.raises(NotFoundError):
        ClassService(world["db"], world["scope_a"]).create("越权班", "2027级", school_id=world["school_b"].id)


def test_user_list_and_detail_scoped(world):
    service = UserService(world["db"], world["scope_a"])
    page = service.list_all(UserFilters(), offset=0, limit=50)
    usernames = {u.username for u in page.items}
    assert usernames == {"admin-a", "stu-a"}

    with pytest.raises(NotFoundError):
        service.get_detail(world["stu_b"].id)


def test_bulk_assign_rejects_foreign_class(world):
    service = UserService(world["db"], world["scope_a"])
    with pytest.raises(NotFoundError):
        service.bulk_assign_class(world["class_b"].id, [world["stu_a"].id], "student")


def test_membership_cross_school_rejected(world):
    db = world["db"]
    with pytest.raises(ValidationError):
        upsert_members(db, world["class_a"].id, [world["stu_b"].id], member_role="student", scope=world["scope_a"])
    assert (
        db.query(ClassMembership)
        .filter(
            ClassMembership.class_id == world["class_a"].id,
            ClassMembership.user_id == world["stu_b"].id,
        )
        .count()
        == 0
    )


def test_platform_account_cannot_join_class(world):
    """平台账号（school_id 为空）不属于任何院校，不能被塞进班级。"""
    db = world["db"]
    with pytest.raises(ValidationError):
        upsert_members(db, world["class_a"].id, [world["platform_user"].id], member_role="student")


def test_stats_class_summary_scoped(world):
    rows = StatsService(world["db"], world["scope_a"]).class_summary()
    assert [r.class_id for r in rows] == [world["class_a"].id]


def test_scoreboard_ranking_scoped(world):
    board = ScoreboardService(world["db"], world["scope_a"]).ranking(scope=ScoreboardScope())
    students = {item.display_name for item in board.items}
    assert "stu-b" not in students


def test_export_does_not_leak_other_school(world):
    """导出走的是与列表同一条收窄链路：串校一次就等于把别人的数据带走。"""
    db = world["db"]
    case = Case(name="甲病例", description="", difficulty=1, time_limit_minutes=30)
    db.add(case)
    db.flush()
    for user in (world["stu_a"], world["stu_b"]):
        db.add(
            TrainingRecord(
                user_id=user.id,
                case_id=case.id,
                status="completed",
                start_time=NOW,
            )
        )
    db.flush()

    rows, _ = RecordService(db, world["scope_a"]).get_records_for_export()
    assert {r.user_id for r in rows} == {world["stu_a"].id}

    all_rows, _ = RecordService(db, world["scope_platform"]).get_records_for_export()
    assert {r.user_id for r in all_rows} == {world["stu_a"].id, world["stu_b"].id}


def test_user_export_list_is_scoped(world):
    """`/api/admin/export` 与用户列表共用 `list_filtered` —— 同一处收窄，两处口径一致。"""
    total, users = UserService(world["db"], world["scope_b"]).list_filtered(UserFilters(), offset=0, limit=50)
    assert total == 2
    assert {u.username for u in users} == {"admin-b", "stu-b"}


def test_platform_scope_is_not_accidentally_used_by_scoped_services(world):
    """回归护栏：把限制在最窄（教师）作用域时，列表不得越出自己任教班。"""
    from core.tenant import TenantScope

    narrow = TenantScope(school_id=world["school_a"].id, class_ids=frozenset(), user_id=world["stu_a"].id)
    assert ClassService(world["db"], narrow).list_all() == []
    assert platform_scope().is_global


# ── 平台角色的「当前院校」视图（X-School-Scope）──
# 语义：只收窄、不放宽。院校角色的院校是硬边界，头一律忽略。


def test_school_scope_narrows_platform_view(world):
    narrowed = apply_school_scope(world["scope_platform"], str(world["school_a"].id))

    assert narrowed.school_id == world["school_a"].id
    page = UserService(world["db"], narrowed).list_all(UserFilters(), offset=0, limit=50)
    assert {u.username for u in page.items} == {"admin-a", "stu-a"}


def test_school_scope_header_cannot_widen_school_admin(world):
    assert apply_school_scope(world["scope_a"], str(world["school_b"].id)).school_id == world["school_a"].id


def test_school_scope_header_invalid_values_fall_back_to_global(world):
    for raw in ("", "abc", "-1", "0", None):
        assert apply_school_scope(world["scope_platform"], raw).is_global


def test_school_name_map_is_batched_lookup(world):
    names = school_name_map(world["db"], [world["school_a"].id, world["school_b"].id, None, 999_999])
    assert names == {world["school_a"].id: "甲大学", world["school_b"].id: "乙学院"}


def test_non_platform_account_without_school_fails_closed(pg_session):
    """非平台账号丢了院校归属时不能退化成跨院校：脏数据也不能拿到全局视野。"""
    db = pg_session
    orphan = _user(db, "orphan-admin", "admin", None)
    scope = resolve_scope(db, orphan)
    assert not scope.is_global
    assert scope.school_id == 0
    assert scope.class_ids == frozenset()


def test_teacher_scope_is_school_wide_not_class_scoped(world):
    """教师是校级视角：班级只是校内业务分组，不能再收窄授权边界。

    账号 A 校、却有一条 B 校班级的教师成员关系（正常写入会拒绝，这里直接造脏数据）：
    教师视角仍是 A 校全校（class_ids=None），B 校班级不会成为教师视野的一部分。
    """
    db = world["db"]
    teacher = _user(db, "teacher-a", "teacher", world["school_a"].id)
    _join(db, teacher, world["class_a"], "teacher")
    _join(db, teacher, world["class_b"], "teacher")
    scope = resolve_scope(db, teacher)
    assert scope.school_id == world["school_a"].id
    assert scope.class_ids is None
