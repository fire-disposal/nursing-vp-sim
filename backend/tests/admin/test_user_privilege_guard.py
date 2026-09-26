"""反越权回归：``user_manage`` 不得被用来提权或接管高权限账号。

缺陷背景：``admin`` 角色有 ``user_manage`` 但没有 ``role_manage``/``api_manage``，
此前 ``PUT /api/admin/users/{id}`` 只守卫"不能改自己"，于是普通管理员可以把任意账号
改成 ``super_admin``（或在同一请求里顺手重置其密码）——权限表被整体绕过。

这些用例用 SQLite 建真实表 + ``core.roles.SYSTEM_PERMISSIONS`` 真实权限词表，
断言的是"权限闸门的可观测结果"（403 + 库中角色/密码不变 / 合法操作仍然成功）。
"""

from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.database import Base
from core.exceptions import AuthError, ValidationError
from core.roles import SYSTEM_PERMISSIONS
from core.security import clear_permission_cache
from models import Class, ClassMembership, Role, RolePermission, User
from modules.admin.users import UserService
from schemas import UserMembershipUpdate, UserUpdateRequest

_TABLES = [
    Class.__table__,
    ClassMembership.__table__,
    Role.__table__,
    RolePermission.__table__,
    User.__table__,
]


@pytest.fixture
def db():
    # load_role_permissions 有进程级缓存（role_id → perms，60s TTL），
    # 而每个 SQLite 实例的 role_id 都从 1 开始 —— 必须逐用例清理。
    clear_permission_cache()
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=_TABLES)
    with Session(engine) as session:
        for name, perms in SYSTEM_PERMISSIONS.items():
            role = Role(name=name, display_name=name, is_system=True)
            session.add(role)
            session.flush()
            for perm in perms:
                session.add(RolePermission(role_id=role.id, permission=perm))
        session.commit()
        yield session
    clear_permission_cache()


def _make_user(db: Session, username: str, role_name: str) -> User:
    role_id = db.query(Role).filter(Role.name == role_name).one().id
    user = User(
        username=username,
        password_hash="not-a-real-hash",
        role_id=role_id,
        display_name=username,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


class TestRoleEscalation:
    def test_admin_cannot_promote_anyone_to_super_admin(self, db):
        actor = _make_user(db, "admin-actor", "admin")
        target = _make_user(db, "student-target", "student")

        with pytest.raises(AuthError) as exc:
            UserService(db).update(target.id, UserUpdateRequest(role="super_admin"), current_user=actor)

        assert exc.value.status_code == 403
        assert db.get(User, target.id).role.name == "student"

    def test_admin_can_grant_role_within_own_permissions(self, db):
        actor = _make_user(db, "admin-actor2", "admin")
        target = _make_user(db, "student-target2", "student")

        view = UserService(db).update(target.id, UserUpdateRequest(role="teacher"), current_user=actor)

        assert view.role == "teacher"

    def test_super_admin_can_promote(self, db):
        actor = _make_user(db, "root-actor", "super_admin")
        target = _make_user(db, "student-target3", "student")

        assert UserService(db).update(target.id, UserUpdateRequest(role="admin"), current_user=actor).role == "admin"

    def test_cannot_change_own_role(self, db):
        actor = _make_user(db, "root-actor2", "super_admin")

        with pytest.raises(Exception) as exc:
            UserService(db).update(actor.id, UserUpdateRequest(role="student"), current_user=actor)

        assert "不能修改自己的角色" in str(exc.value)


class TestPasswordResetScope:
    def test_admin_cannot_reset_super_admin_password(self, db):
        actor = _make_user(db, "admin-actor3", "admin")
        target = _make_user(db, "root-target", "super_admin")
        before = db.get(User, target.id).password_hash

        with pytest.raises(AuthError) as exc:
            UserService(db).update(target.id, UserUpdateRequest(password="newpass123"), current_user=actor)

        assert exc.value.status_code == 403
        assert db.get(User, target.id).password_hash == before

    def test_admin_can_reset_lower_privileged_password(self, db):
        actor = _make_user(db, "admin-actor4", "admin")
        target = _make_user(db, "student-target4", "student")
        before = db.get(User, target.id).password_hash

        UserService(db).update(target.id, UserUpdateRequest(password="newpass123"), current_user=actor)

        assert db.get(User, target.id).password_hash != before


def _make_class(db: Session, name: str, cohort_label: str = "2026级") -> Class:
    cls = Class(name=name, cohort_label=cohort_label)
    db.add(cls)
    db.commit()
    db.refresh(cls)
    return cls


class TestMembershipReplacement:
    """单用户多班级：``memberships`` 是**全量替换**集合。

    缺陷背景：老实现用 ``class_id``（0 作清除哨兵）+ ``user_classes[0]``，用户编辑只能
    改第一条成员关系，行内展示也可能显示与筛选不一致的那条。
    """

    def test_memberships_replaced_as_a_whole(self, db):
        actor = _make_user(db, "root-actor3", "super_admin")
        target = _make_user(db, "student-multi", "student")
        first = _make_class(db, "1班")
        second = _make_class(db, "2班")

        UserService(db).update(
            target.id,
            UserUpdateRequest(memberships=[UserMembershipUpdate(class_id=first.id)]),
            current_user=actor,
        )
        view = UserService(db).update(
            target.id,
            UserUpdateRequest(memberships=[UserMembershipUpdate(class_id=second.id, member_role="teacher")]),
            current_user=actor,
        )

        assert [m.class_id for m in view.memberships] == [second.id]
        assert view.memberships[0].class_name == "2班"
        assert view.memberships[0].member_role == "teacher"
        assert db.query(ClassMembership).filter(ClassMembership.user_id == target.id).count() == 1

    def test_all_memberships_are_reported_not_just_the_first(self, db):
        actor = _make_user(db, "root-actor4", "super_admin")
        target = _make_user(db, "student-multi2", "student")
        first = _make_class(db, "1班", "2027级")
        second = _make_class(db, "2班", "2026级")

        view = UserService(db).update(
            target.id,
            UserUpdateRequest(
                memberships=[
                    UserMembershipUpdate(class_id=first.id),
                    UserMembershipUpdate(class_id=second.id),
                ]
            ),
            current_user=actor,
        )

        # 排序按 (cohort_label, name)：2026级 在前
        assert [(m.cohort_label, m.class_name) for m in view.memberships] == [
            ("2026级", "2班"),
            ("2027级", "1班"),
        ]
        assert db.query(ClassMembership).filter(ClassMembership.user_id == target.id).count() == 2

    def test_unknown_class_is_rejected(self, db):
        actor = _make_user(db, "root-actor5", "super_admin")
        target = _make_user(db, "student-multi3", "student")

        with pytest.raises(ValidationError):
            UserService(db).update(
                target.id,
                UserUpdateRequest(memberships=[UserMembershipUpdate(class_id=4242)]),
                current_user=actor,
            )

    def test_duplicate_class_in_payload_is_rejected(self, db):
        actor = _make_user(db, "root-actor6", "super_admin")
        target = _make_user(db, "student-multi4", "student")
        cls = _make_class(db, "3班")

        with pytest.raises(ValidationError):
            UserService(db).update(
                target.id,
                UserUpdateRequest(
                    memberships=[
                        UserMembershipUpdate(class_id=cls.id),
                        UserMembershipUpdate(class_id=cls.id, member_role="teacher"),
                    ]
                ),
                current_user=actor,
            )

    def test_omitting_memberships_leaves_them_untouched(self, db):
        actor = _make_user(db, "root-actor7", "super_admin")
        target = _make_user(db, "student-multi5", "student")
        cls = _make_class(db, "4班")
        UserService(db).update(
            target.id,
            UserUpdateRequest(memberships=[UserMembershipUpdate(class_id=cls.id)]),
            current_user=actor,
        )

        view = UserService(db).update(target.id, UserUpdateRequest(display_name="改个名"), current_user=actor)

        assert [m.class_id for m in view.memberships] == [cls.id]
