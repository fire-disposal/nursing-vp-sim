"""`platform` 视角并入 `ops` 的数据迁移：升级/降级都要精确。

- 升级：所有 platform 授予变 ops；同 `(user, school)` 已有 ops 的重复行被删（新 ops 是
  旧 ops ∪ 旧 platform，删行不损失权限）。
- 降级：**只**回退由 platform 来的行，用户原本就有的 ops 授予一个都不能错回成 platform。
  这是本迁移的设计约束：`persona_platform_merge_log` 是唯一证据，没有它就不猜。

用例直接调用迁移模块的 `upgrade()` / `downgrade()`（与 `alembic upgrade head` 走同一份
代码），用 testcontainers 外的真 PG 会话（`pg_session`）跑，savepoint 隔离。
"""

from __future__ import annotations

import importlib.util
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from types import ModuleType
from typing import TYPE_CHECKING

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

from core.database import Base
from core.database import engine as pg_engine
from models import School, User, UserSchoolPersona

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[2]
    / "migrations"
    / "versions"
    / "data"
    / "c5a8e1f3d7b2_merge_platform_persona_into_ops.py"
)


def _load_migration() -> ModuleType:
    """`migrations/` 不是包（alembic 按文件路径加载）→ 这里用同一方式按路径加载。"""
    spec = importlib.util.spec_from_file_location("_merge_platform_persona_into_ops", _MIGRATION_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_TABLES = [School.__table__, User.__table__, UserSchoolPersona.__table__]
_LOG = "persona_platform_merge_log"


@pytest.fixture(scope="module", autouse=True)
def _schema():
    Base.metadata.create_all(pg_engine, tables=_TABLES)


@pytest.fixture
def migration(pg_session: Session) -> Iterator[ModuleType]:
    """把 alembic 的 ``op`` 绑到测试会话上（与真实 upgrade 同一份迁移代码）。"""
    module = _load_migration()
    ctx = MigrationContext.configure(connection=pg_session.connection())
    with Operations.context(ctx):
        yield module


def _school(db: Session) -> School:
    school = School(name=f"merge-{uuid.uuid4().hex[:8]}", created_at=datetime.now(UTC))
    db.add(school)
    db.flush()
    return school


def _user(db: Session, school: School) -> User:
    user = User(
        username=f"merge-{uuid.uuid4().hex[:10]}",
        password_hash="x",
        display_name="迁移用例",
        school_id=school.id,
        is_platform=False,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db.add(user)
    db.flush()
    return user


def _grant(db: Session, user: User, school: School, *personas: str) -> None:
    for persona in personas:
        db.add(UserSchoolPersona(user_id=user.id, school_id=school.id, persona=persona))
    db.flush()


def _personas(db: Session, user: User, school: School) -> set[str]:
    return {
        row[0]
        for row in db.query(UserSchoolPersona.persona)
        .filter(UserSchoolPersona.user_id == user.id, UserSchoolPersona.school_id == school.id)
        .all()
    }


def _count_persona(db: Session, persona: str) -> int:
    return db.query(UserSchoolPersona).filter(UserSchoolPersona.persona == persona).count()


def test_upgrade_moves_platform_grants_to_ops(pg_session, migration):
    school = _school(pg_session)
    user = _user(pg_session, school)
    _grant(pg_session, user, school, "platform")

    migration.upgrade()

    assert _personas(pg_session, user, school) == {"ops"}


def test_upgrade_dedupes_when_same_user_and_school_already_has_ops(pg_session, migration):
    school = _school(pg_session)
    user = _user(pg_session, school)
    _grant(pg_session, user, school, "teacher", "ops", "platform")

    migration.upgrade()

    # 重复行被删、其余原样保留
    assert _personas(pg_session, user, school) == {"teacher", "ops"}
    assert _count_persona(pg_session, "ops") >= 1


def test_upgrade_keeps_other_personas_and_users_untouched(pg_session, migration):
    school = _school(pg_session)
    with_platform = _user(pg_session, school)
    without_platform = _user(pg_session, school)
    _grant(pg_session, with_platform, school, "platform", "admin")
    _grant(pg_session, without_platform, school, "ops", "student")

    migration.upgrade()

    assert _personas(pg_session, with_platform, school) == {"ops", "admin"}
    assert _personas(pg_session, without_platform, school) == {"ops", "student"}


def test_upgrade_does_not_touch_is_platform_flag(pg_session, migration):
    school = _school(pg_session)
    user = _user(pg_session, school)
    user.is_platform = True
    _grant(pg_session, user, school, "platform")
    pg_session.flush()

    migration.upgrade()

    pg_session.expire_all()
    assert pg_session.get(User, user.id).is_platform is True


def test_downgrade_restores_only_rows_that_came_from_platform(pg_session, migration):
    """精确回滚：原本的 ops 授予不能被回退成 platform。"""
    school = _school(pg_session)
    from_platform = _user(pg_session, school)
    existing_ops = _user(pg_session, school)
    duplicate = _user(pg_session, school)
    _grant(pg_session, from_platform, school, "platform")
    _grant(pg_session, existing_ops, school, "ops")
    _grant(pg_session, duplicate, school, "ops", "platform")

    migration.upgrade()
    assert _personas(pg_session, from_platform, school) == {"ops"}
    assert _personas(pg_session, duplicate, school) == {"ops"}

    migration.downgrade()

    # 由 platform 来的行回到 platform
    assert _personas(pg_session, from_platform, school) == {"platform"}
    # 去重删掉的 platform 行插回，原本的 ops 行保留
    assert _personas(pg_session, duplicate, school) == {"ops", "platform"}
    # 原本就有的 ops 授予原样不动（这是"不能把全部 ops 错回 platform"的核心约束）
    assert _personas(pg_session, existing_ops, school) == {"ops"}
    # 辅助表随降级删除
    assert not sa.inspect(pg_session.connection()).has_table(_LOG)


def test_upgrade_downgrade_roundtrip_is_identity(pg_session, migration):
    school = _school(pg_session)
    a = _user(pg_session, school)
    b = _user(pg_session, school)
    _grant(pg_session, a, school, "platform")
    _grant(pg_session, b, school, "teacher", "ops", "platform")
    before = {a.id: _personas(pg_session, a, school), b.id: _personas(pg_session, b, school)}

    migration.upgrade()
    migration.downgrade()

    after = {a.id: _personas(pg_session, a, school), b.id: _personas(pg_session, b, school)}
    assert after == before


def test_downgrade_without_log_table_is_a_noop(pg_session, migration):
    """没有证据就不猜：缺辅助表时降级不改任何授予（宁可不回退，也不错回）。"""
    school = _school(pg_session)
    user = _user(pg_session, school)
    _grant(pg_session, user, school, "ops")

    migration.downgrade()

    assert _personas(pg_session, user, school) == {"ops"}
