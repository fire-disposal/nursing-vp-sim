"""院校隔离矩阵（真实 PG）：A 校管理员不得以任何路径看到 B 校的班级与账号。

这是租户隔离唯一的自动化兜底 —— 收窄写在查询层，漏一处就等于跨校泄漏，而漏点只能靠
"逐条路径真打一遍"发现。断言口径：越权一律 404（`NotFoundError`），
写入侧跨校抛 `ValidationError`（本仓映射 400）。
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from core.exceptions import NotFoundError, ValidationError
from core.roles import SYSTEM_PERMISSIONS
from core.security import clear_permission_cache
from core.tenant import apply_school_scope, platform_scope, resolve_scope, school_name_map
from models import Case, Class, ClassMembership, Role, RolePermission, School, TrainingRecord, User
from modules.admin.class_memberships import upsert_members
from modules.admin.classes import ClassService
from modules.admin.exports import RecordService
from modules.admin.stats import StatsService
from modules.admin.users import UserFilters, UserService
from modules.scoreboard.service import ScoreboardScope, ScoreboardService

NOW = datetime.now(UTC)


def _role(db, name: str) -> Role:
    """建角色并授予代码里的系统权限（测试库跳过 seed，权限行需自建）。

    权限缓存是**进程级**（`core.security._permission_cache`，按 role_id 缓存）：
    savepoint 回滚不会清它，而各测试文件会复用同一批 role_id —— 不显式清缓存就会
    读到别的用例留下的权限集合，表现成"作用域莫名变窄"。这里建完角色立刻清。
    """
    role = db.query(Role).filter(Role.name == name).first()
    if role is None:
        role = Role(name=name, display_name=name, is_system=True)
        db.add(role)
        db.flush()
    # 幂等补齐：别的用例可能已提交过同名角色但没授全权限（savepoint 之外的提交不受回滚约束）
    existing = {rp.permission for rp in db.query(RolePermission).filter(RolePermission.role_id == role.id).all()}
    for perm in set(SYSTEM_PERMISSIONS.get(name, [])) - existing:
        db.add(RolePermission(role_id=role.id, permission=perm))
    db.flush()
    clear_permission_cache(role.id)
    return role


def _school(db, name: str) -> School:
    school = School(name=name, created_at=NOW)
    db.add(school)
    db.flush()
    return school


def _user(db, username: str, role: str, school_id: int | None) -> User:
    user = User(
        username=username,
        password_hash="x",
        role_id=_role(db, role).id,
        school_id=school_id,
        display_name=username,
        created_at=NOW,
        updated_at=NOW,
    )
    db.add(user)
    db.flush()
    # 模拟 get_current_user 的权限装载：作用域解析依赖 has_permission("user_manage")
    from core.security import load_role_permissions

    user.set_permissions_cache(set(load_role_permissions(db, user.role_id)))
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
    clear_permission_cache()
    school_a = _school(db, "甲大学")
    school_b = _school(db, "乙学院")
    admin_a = _user(db, "admin-a", "admin", school_a.id)
    admin_b = _user(db, "admin-b", "admin", school_b.id)
    platform_user = _user(db, "platform-root", "super_admin", None)
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
    assert world["scope_platform"].is_global, "super_admin 的 school_id 为空 → 平台视角"


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


def test_platform_role_cannot_join_class(world):
    """平台角色（school_id 为空）不属于任何院校，不能被塞进班级。"""
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
