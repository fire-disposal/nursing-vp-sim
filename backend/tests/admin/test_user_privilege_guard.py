"""反越权回归：``user_manage`` 不得被用来提权或接管高权限账号。

缺陷背景：``admin`` 视角有 ``user_manage`` 但没有 ``api_manage``，
此前 ``PUT /api/admin/users/{id}`` 只守卫"不能改自己"，于是普通管理员可以把任意账号
变成平台账号（或在同一请求里顺手重置其密码）——权限闸门被整体绕过。

角色退场后"这个人是什么"不再由角色表承载：权限只来自视角授予（``user_personas``），
平台账号由 ``users.is_platform`` 标记。断言的是"权限闸门的可观测结果"
（403 + 库中视角授予/密码/启用位不变 / 合法操作仍然成功）。
"""

from datetime import UTC, datetime

import pytest
from sqlalchemy.orm import Session

from core.database import Base
from core.database import engine as pg_engine
from core.exceptions import AuthError, NotFoundError, ValidationError
from core.personas import permissions_for_role_name
from core.security import clear_permission_cache
from core.tenant import TenantScope, platform_scope
from models import Class, ClassMembership, School, User, UserPersona
from modules.admin.users import UserService
from schemas import UserMembershipUpdate, UserUpdateRequest
from tests.conftest import ensure_school

# 本文件验的是权限闸门而非院校边界 → 平台视角（跨院校），作用域过滤恒为真。
_PLATFORM = platform_scope()

_TABLES = [
    School.__table__,
    Class.__table__,
    ClassMembership.__table__,
    User.__table__,
    UserPersona.__table__,
]


@pytest.fixture(scope="module", autouse=True)
def _schema():
    """本仓面向 PostgreSQL：直接用真库建表（幂等），不再用 SQLite 替身。"""
    Base.metadata.create_all(pg_engine, tables=_TABLES)


@pytest.fixture
def db(pg_session):
    clear_permission_cache()
    yield pg_session
    clear_permission_cache()


def _make_user(db: Session, username: str, persona: str = "student", *, platform: bool = False) -> User:
    """建一个账号：权限只来自视角授予；平台账号用 ``is_platform`` 标记。

    ``persona`` 既是授予的视角也是当前生效视角（``"platform"`` 隐含平台账号）。
    """
    is_platform = platform or persona == "platform"
    user = User(
        username=username,
        password_hash="not-a-real-hash",
        display_name=username,
        # 成员关系要求账号与班级同校（单校不变量）；平台账号不属任何院校
        school_id=None if is_platform else ensure_school(db).id,
        is_platform=is_platform,
        # 列默认 only 在服务端；Python 侧默认 False，停用类用例需要"启用中"的起点
        is_active=True,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    if not is_platform:
        db.add(UserPersona(user_id=user.id, persona=persona))
        db.commit()
    # 模拟 get_current_user：生效视角 → 权限集合
    user.set_active_persona(persona)
    user.set_permissions_cache(set(permissions_for_role_name(persona)))
    return user


def _granted(db: Session, user: User) -> set[str]:
    return {row[0] for row in db.query(UserPersona.persona).filter(UserPersona.user_id == user.id)}


class TestPersonaEscalation:
    def test_admin_cannot_grant_platform_persona(self, db):
        """``platform`` 视角只能授予平台账号 —— 即便请求体里写死了也不行。"""
        actor = _make_user(db, "admin-actor", "admin")
        target = _make_user(db, "student-target", "student")

        with pytest.raises(ValidationError) as exc:
            UserService(db, _PLATFORM).update(target.id, UserUpdateRequest(personas=["platform"]), current_user=actor)

        assert exc.value.status_code == 400
        assert "平台视角只能授予平台账号" in str(exc.value)
        assert _granted(db, db.get(User, target.id)) == {"student"}

    def test_admin_cannot_grant_persona_above_own_permissions(self, db):
        """``admin`` 没有 ``api_manage``/``audit_view`` → 不能把 ``ops`` 授出去（否则自我提权）。"""
        actor = _make_user(db, "actor-ops-grant", "admin")
        target = _make_user(db, "student-target-ops", "student")

        with pytest.raises(AuthError) as exc:
            UserService(db, _PLATFORM).update(target.id, UserUpdateRequest(personas=["ops"]), current_user=actor)

        assert exc.value.status_code == 403
        assert _granted(db, db.get(User, target.id)) == {"student"}

    def test_admin_can_grant_persona_within_own_permissions(self, db):
        actor = _make_user(db, "admin-actor2", "admin")
        target = _make_user(db, "student-target2", "student")

        view = UserService(db, _PLATFORM).update(target.id, UserUpdateRequest(personas=["teacher"]), current_user=actor)

        assert view.personas == ["teacher"]
        assert _granted(db, db.get(User, target.id)) == {"teacher"}

    def test_unknown_persona_is_rejected(self, db):
        actor = _make_user(db, "admin-actor-unknown", "admin")
        target = _make_user(db, "student-target-unknown", "student")

        with pytest.raises(ValidationError) as exc:
            UserService(db, _PLATFORM).update(
                target.id, UserUpdateRequest(personas=["super_admin"]), current_user=actor
            )

        assert "未知视角" in str(exc.value)
        assert _granted(db, db.get(User, target.id)) == {"student"}

    def test_platform_account_can_grant_any_persona(self, db):
        actor = _make_user(db, "root-actor", "platform")
        target = _make_user(db, "student-target3", "student")

        view = UserService(db, _PLATFORM).update(
            target.id, UserUpdateRequest(personas=["admin", "ops"]), current_user=actor
        )

        assert view.personas == ["admin", "ops"]

    def test_cannot_change_own_personas(self, db):
        actor = _make_user(db, "root-actor2", "platform")

        with pytest.raises(Exception) as exc:
            UserService(db, _PLATFORM).update(actor.id, UserUpdateRequest(personas=["student"]), current_user=actor)

        assert "不能修改自己的视角" in str(exc.value)


class TestPasswordResetScope:
    def test_admin_cannot_reset_platform_password(self, db):
        actor = _make_user(db, "admin-actor3", "admin")
        target = _make_user(db, "root-target", "platform")
        before = db.get(User, target.id).password_hash

        with pytest.raises(AuthError) as exc:
            UserService(db, _PLATFORM).update(target.id, UserUpdateRequest(password="newpass123"), current_user=actor)

        assert exc.value.status_code == 403
        assert db.get(User, target.id).password_hash == before

    def test_admin_can_reset_lower_privileged_password(self, db):
        actor = _make_user(db, "admin-actor4", "admin")
        target = _make_user(db, "student-target4", "student")
        before = db.get(User, target.id).password_hash

        UserService(db, _PLATFORM).update(target.id, UserUpdateRequest(password="newpass123"), current_user=actor)

        assert db.get(User, target.id).password_hash != before


def _make_class(db: Session, name: str, cohort_label: str = "2026级") -> Class:
    cls = Class(name=name, cohort_label=cohort_label, school_id=ensure_school(db).id)
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
        actor = _make_user(db, "root-actor3", "platform")
        target = _make_user(db, "student-multi", "student")
        first = _make_class(db, "1班")
        second = _make_class(db, "2班")

        UserService(db, _PLATFORM).update(
            target.id,
            UserUpdateRequest(memberships=[UserMembershipUpdate(class_id=first.id)]),
            current_user=actor,
        )
        view = UserService(db, _PLATFORM).update(
            target.id,
            UserUpdateRequest(memberships=[UserMembershipUpdate(class_id=second.id, member_role="teacher")]),
            current_user=actor,
        )

        assert [m.class_id for m in view.memberships] == [second.id]
        assert view.memberships[0].class_name == "2班"
        assert view.memberships[0].member_role == "teacher"
        assert db.query(ClassMembership).filter(ClassMembership.user_id == target.id).count() == 1

    def test_all_memberships_are_reported_not_just_the_first(self, db):
        actor = _make_user(db, "root-actor4", "platform")
        target = _make_user(db, "student-multi2", "student")
        first = _make_class(db, "1班", "2027级")
        second = _make_class(db, "2班", "2026级")

        view = UserService(db, _PLATFORM).update(
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
        actor = _make_user(db, "root-actor5", "platform")
        target = _make_user(db, "student-multi3", "student")

        with pytest.raises(ValidationError):
            UserService(db, _PLATFORM).update(
                target.id,
                UserUpdateRequest(memberships=[UserMembershipUpdate(class_id=4242)]),
                current_user=actor,
            )

    def test_duplicate_class_in_payload_is_rejected(self, db):
        actor = _make_user(db, "root-actor6", "platform")
        target = _make_user(db, "student-multi4", "student")
        cls = _make_class(db, "3班")

        with pytest.raises(ValidationError):
            UserService(db, _PLATFORM).update(
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
        actor = _make_user(db, "root-actor7", "platform")
        target = _make_user(db, "student-multi5", "student")
        cls = _make_class(db, "4班")
        UserService(db, _PLATFORM).update(
            target.id,
            UserUpdateRequest(memberships=[UserMembershipUpdate(class_id=cls.id)]),
            current_user=actor,
        )

        view = UserService(db, _PLATFORM).update(
            target.id, UserUpdateRequest(display_name="改个名"), current_user=actor
        )

        assert [m.class_id for m in view.memberships] == [cls.id]


class TestHighPrivilegeAccountLifecycle:
    """RB-1：停用/删除平台账号必须与"授予视角/重置密码"同口径受守卫。

    缺陷背景：``update`` 的 ``is_active`` 分支只判"不能停用自己"，``delete`` 完全无检查，
    于是持 ``user_manage`` 的 ``admin`` 可以合法停用/删除平台账号；且全仓没有
    "最后一个启用中的平台账号"兜底。
    """

    def test_admin_cannot_deactivate_platform_account(self, db):
        actor = _make_user(db, "admin-deact", "admin")
        target = _make_user(db, "root-deact", "platform")

        with pytest.raises(AuthError) as exc:
            UserService(db, _PLATFORM).update(target.id, UserUpdateRequest(is_active=False), current_user=actor)

        assert exc.value.status_code == 403
        assert db.get(User, target.id).is_active is True

    def test_platform_account_cannot_be_deleted_at_all(self, db):
        """政策：平台账号不可删除（收回权限走停用）。此前无守卫，只是被外键撞成 500。"""
        actor = _make_user(db, "admin-del", "admin")
        target = _make_user(db, "root-del", "platform")

        with pytest.raises(ValidationError) as exc:
            UserService(db, _PLATFORM).delete(target.id, actor)

        assert exc.value.status_code == 400
        assert "不可删除" in str(exc.value)
        assert db.get(User, target.id) is not None

    def test_cannot_deactivate_last_platform_account_by_self(self, db):
        """唯一启用中的平台账号自停用 = 400（自毁路径的最后一道闸）。

        ``_assert_not_last_active_super_admin`` 只拦"停掉**别人**的最后一个平台账号"；
        而能把目标停用的操作者本身必是启用的平台账号、且不计入 ``remaining`` —— 所以
        该场景在可达输入下不可触发。"自己停自己"是实际存在的自毁路径，这里钉住它。
        """
        target = _make_user(db, "root-only", "platform")

        # 自停用始终是 400（与"最后一个"守卫无关，但同样堵住自毁路径）
        with pytest.raises(ValidationError) as exc:
            UserService(db, _PLATFORM).update(target.id, UserUpdateRequest(is_active=False), current_user=target)

        assert "不能停用自己的账号" in str(exc.value)
        assert db.get(User, target.id).is_active is True

    def test_platform_account_not_deletable_even_with_peer_present(self, db):
        """即使还有别的平台账号，也不允许删除某个平台账号（政策是无条件不可删）。"""
        actor = _make_user(db, "platform-actor2", "platform")
        _make_user(db, "root-other", "platform")
        target = _make_user(db, "root-only2", "platform")

        with pytest.raises(ValidationError) as exc:
            UserService(db, _PLATFORM).delete(target.id, actor)

        assert "不可删除" in str(exc.value)
        assert db.get(User, target.id) is not None

    def test_bulk_assign_rejects_unknown_member_role(self, db):
        """RB-9：``bulk_assign_class`` 收的是裸 ``str``（不像 UserMembershipUpdate 是 Literal），
        必须有白名单，否则任意字符串会落进 ClassMembership.member_role。"""
        _make_user(db, "student-role", "student")
        cls = _make_class(db, "白名单班")

        with pytest.raises(ValidationError) as exc:
            UserService(db, _PLATFORM).bulk_assign_class([], cls.id, member_role="root")

        assert "无效的成员角色" in str(exc.value)
        assert db.query(ClassMembership).filter(ClassMembership.class_id == cls.id).count() == 0

    def test_platform_account_can_deactivate_peer_while_oneself_active(self, db):
        # 正对照：还有别的启用平台账号时，平台账号之间停用不应被兜底守卫挡住
        actor = _make_user(db, "root-a", "platform")
        peer = _make_user(db, "root-b", "platform")

        UserService(db, _PLATFORM).update(peer.id, UserUpdateRequest(is_active=False), current_user=actor)

        assert db.get(User, peer.id).is_active is False


def _make_school(db: Session, name: str) -> School:
    school = db.query(School).filter(School.name == name).first()
    if school is None:
        school = School(name=name)
        db.add(school)
        db.commit()
        db.refresh(school)
    return school


class TestSchoolAssignment:
    """编辑用户的院校归属（单位）。

    缺陷背景（2026-10-27 反馈）：``UserUpdateRequest`` 没有 ``school_id``，编辑用户时
    单位既看不到也改不了；新账号的单位只能靠「先加入一个班级」间接推导。
    """

    def test_platform_admin_can_move_user_between_schools(self, db):
        actor = _make_user(db, "root-actor-school", "platform")
        target = _make_user(db, "student-school-1", "student")
        other = _make_school(db, "另一院校")

        view = UserService(db, _PLATFORM).update(target.id, UserUpdateRequest(school_id=other.id), current_user=actor)

        assert view.school_id == other.id
        assert view.school_name == "另一院校"
        assert db.get(User, target.id).school_id == other.id

    def test_omitting_school_leaves_it_untouched(self, db):
        actor = _make_user(db, "root-actor-school2", "platform")
        target = _make_user(db, "student-school-2", "student")
        before = db.get(User, target.id).school_id

        UserService(db, _PLATFORM).update(target.id, UserUpdateRequest(display_name="改个名"), current_user=actor)

        assert db.get(User, target.id).school_id == before

    def test_school_admin_cannot_move_user_out_of_own_school(self, db):
        actor = _make_user(db, "admin-school-actor", "admin")
        target = _make_user(db, "student-school-3", "student")
        other = _make_school(db, "另一院校")
        school_scope = TenantScope(school_id=actor.school_id, class_ids=None, user_id=actor.id)

        with pytest.raises(NotFoundError):
            UserService(db, school_scope).update(target.id, UserUpdateRequest(school_id=other.id), current_user=actor)

        assert db.get(User, target.id).school_id == actor.school_id

    def test_user_with_class_in_old_school_cannot_be_moved(self, db):
        """单校不变量：账号还在原院校的班里时先解除归属，不静默搬人。"""
        actor = _make_user(db, "root-actor-school3", "platform")
        target = _make_user(db, "student-school-4", "student")
        cls = _make_class(db, "5班")
        UserService(db, _PLATFORM).update(
            target.id,
            UserUpdateRequest(memberships=[UserMembershipUpdate(class_id=cls.id)]),
            current_user=actor,
        )
        other = _make_school(db, "另一院校")

        with pytest.raises(ValidationError) as exc:
            UserService(db, _PLATFORM).update(target.id, UserUpdateRequest(school_id=other.id), current_user=actor)

        assert "其他院校的班级" in str(exc.value)
        assert db.get(User, target.id).school_id == cls.school_id

    def test_platform_role_cannot_be_given_a_school(self, db):
        actor = _make_user(db, "root-actor-school4", "platform")
        target = _make_user(db, "root-target-school", "platform")
        other = _make_school(db, "另一院校")

        with pytest.raises(ValidationError) as exc:
            UserService(db, _PLATFORM).update(target.id, UserUpdateRequest(school_id=other.id), current_user=actor)

        assert "平台超级管理员" in str(exc.value)
        assert db.get(User, target.id).school_id is None

    def test_unknown_school_is_rejected(self, db):
        actor = _make_user(db, "root-actor-school5", "platform")
        target = _make_user(db, "student-school-5", "student")
        before = db.get(User, target.id).school_id

        with pytest.raises(ValidationError) as exc:
            UserService(db, _PLATFORM).update(target.id, UserUpdateRequest(school_id=999_999), current_user=actor)

        assert "院校不存在" in str(exc.value)
        assert db.get(User, target.id).school_id == before
