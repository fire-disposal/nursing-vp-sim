"""Password login behavior without a speculative strategy registry."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
import sqlalchemy as sa

from core.audit import ACTION_AUTH_LOGIN_BLOCKED, ACTION_AUTH_LOGIN_FAILED
from core.config import LOGIN_MAX_FAILED_ATTEMPTS
from core.exceptions import AuthError
from core.security import hash_password
from models import AuditLog, Role, User
from modules.auth.service import AuthService


class _FakeUserQuery:
    def __init__(self, users: dict[str, object]):
        self._users = users
        self._username: str | None = None

    def filter(self, criterion):
        self._username = getattr(getattr(criterion, "right", None), "value", None)
        return self

    def first(self):
        return self._users.get(self._username) if self._username is not None else None


class _FakeDb:
    def __init__(self, users: dict[str, object]):
        self._users = users

    def query(self, _model):
        return _FakeUserQuery(self._users)

    # 失败计数走 unit_of_work（commit）→ 假库需提供最小写接口
    def add(self, _obj):
        pass

    def commit(self):
        pass

    def rollback(self):
        pass


def _user(username: str, password: str, *, active: bool = True):
    return SimpleNamespace(
        id=1,
        username=username,
        password_hash=hash_password("secret123"),
        is_active=active,
        role=None,
        failed_login_count=0,
        locked_until=None,
    )


@pytest.mark.asyncio
async def test_login_returns_authenticated_active_user():
    user = _user("alice", "secret123")

    actual = await AuthService(_FakeDb({"alice": user})).login("alice", "secret123")

    assert actual is user


@pytest.mark.asyncio
@pytest.mark.parametrize(("username", "password"), [("nobody", "secret123"), ("alice", "wrong")])
async def test_login_rejects_unknown_or_invalid_credentials(username: str, password: str):
    service = AuthService(_FakeDb({"alice": _user("alice", "secret123")}))

    with pytest.raises(AuthError, match="用户名或密码错误"):
        await service.login(username, password)


@pytest.mark.asyncio
async def test_login_rejects_disabled_user_after_password_verification():
    service = AuthService(_FakeDb({"alice": _user("alice", "secret123", active=False)}))

    with pytest.raises(AuthError, match="账号已被禁用"):
        await service.login("alice", "secret123")


@pytest.fixture(autouse=True)
def _cleanup_login_audit():
    """登录失败/成功会真提交审计行（core.audit.record_detached）→ 用完即清，保持测试库干净。"""
    from core.database import SessionLocal
    from models import AuditLog

    with SessionLocal() as db:
        max_id = db.query(sa.func.max(AuditLog.id)).scalar() or 0
    yield
    with SessionLocal() as db:
        db.query(AuditLog).filter(AuditLog.id > max_id).delete(synchronize_session=False)
        db.commit()


# ── 账号级登录失败锁定（方案 A6）：真库判据 ────────────────────────────────────────
# 测试库 schema 由 `tests/conftest.py::_schema_matches_models`（会话级 drop + create）保证与模型一致，
# 本模块无需再自己补列。


def _db_user(db, username: str) -> User:
    role = db.query(Role).filter(Role.name == "student").first()
    if role is None:
        role = Role(name="student", display_name="学生")
        db.add(role)
        db.flush()
    user = User(
        username=username,
        password_hash=hash_password("secret123"),
        role_id=role.id,
        display_name=username,
        failed_login_count=0,
        locked_until=None,
    )
    db.add(user)
    db.flush()
    return user


async def _fail_login(service: AuthService, username: str, times: int = LOGIN_MAX_FAILED_ATTEMPTS) -> None:
    for _ in range(times):
        with pytest.raises(AuthError, match="用户名或密码错误"):
            await service.login(username, "wrong-password")


@pytest.fixture
def lockout_enabled(monkeypatch):
    """显式打开锁定开关。

    该特性**默认关闭**（`core/config.py::LOGIN_LOCKOUT_ENABLED`，2026-09-27 决定）——
    "用错密码锁别人的号"是它自带的 DoS 面，当前阶段不启用。下面这组判据验证"打开后"的行为，
    关闭时的行为由 `test_lockout_disabled_*` 两条守住。
    """
    from modules.auth import service as auth_service

    monkeypatch.setattr(auth_service, "LOGIN_LOCKOUT_ENABLED", True)


@pytest.mark.asyncio
async def test_repeated_wrong_passwords_lock_account_and_write_blocked_audit(pg_session, lockout_enabled):
    user = _db_user(pg_session, "lock-threshold")
    service = AuthService(pg_session)

    await _fail_login(service, "lock-threshold")

    pg_session.refresh(user)
    assert user.failed_login_count == LOGIN_MAX_FAILED_ATTEMPTS
    assert user.locked_until is not None
    assert user.locked_until > datetime.now(UTC)

    blocked = (
        pg_session.query(AuditLog)
        .filter(AuditLog.action == ACTION_AUTH_LOGIN_BLOCKED, AuditLog.target_id == str(user.id))
        .all()
    )
    assert len(blocked) == 1
    row = blocked[0]
    assert (row.target_type, row.outcome) == ("user", "denied")
    assert row.payload["failed_count"] == LOGIN_MAX_FAILED_ATTEMPTS
    assert row.payload["reason"] == "max_failed_attempts"
    assert datetime.fromisoformat(row.payload["locked_until"]) == user.locked_until

    # 每次失败仍照旧留一行 login_failed
    assert (
        pg_session.query(AuditLog).filter(AuditLog.action == ACTION_AUTH_LOGIN_FAILED).count()
        == LOGIN_MAX_FAILED_ATTEMPTS
    )


@pytest.mark.asyncio
async def test_locked_account_rejects_correct_password_with_explicit_message(pg_session, lockout_enabled):
    user = _db_user(pg_session, "lock-active")
    service = AuthService(pg_session)
    await _fail_login(service, "lock-active")
    assert pg_session.get(User, user.id).locked_until is not None

    # 锁定期间即便密码正确也拒绝，且**明确告知已锁定与剩余时间**（项目口径：体验/完成度优先，2026-09-27）
    with pytest.raises(AuthError, match=r"账号已锁定，请 \d+ 分钟后再试") as excinfo:
        await service.login("lock-active", "secret123")
    assert excinfo.value.status_code == 403

    locked = (
        pg_session.query(AuditLog)
        .filter(AuditLog.action == ACTION_AUTH_LOGIN_FAILED, AuditLog.payload["reason"].astext == "locked")
        .all()
    )
    assert len(locked) == 1
    assert locked[0].target_id == str(user.id)


@pytest.mark.asyncio
async def test_expired_lock_allows_login_and_clears_state(pg_session, lockout_enabled):
    user = _db_user(pg_session, "lock-expired")
    service = AuthService(pg_session)
    await _fail_login(service, "lock-expired")

    user = pg_session.get(User, user.id)
    user.locked_until = datetime.now(UTC) - timedelta(seconds=1)
    pg_session.commit()

    actual = await service.login("lock-expired", "secret123")

    assert actual.id == user.id
    pg_session.refresh(user)
    assert user.failed_login_count == 0
    assert user.locked_until is None


@pytest.mark.asyncio
async def test_successful_login_resets_accumulated_failures(pg_session, lockout_enabled):
    user = _db_user(pg_session, "lock-reset")
    service = AuthService(pg_session)
    await _fail_login(service, "lock-reset", times=3)
    pg_session.refresh(user)
    assert user.failed_login_count == 3

    actual = await service.login("lock-reset", "secret123")

    assert actual.id == user.id
    pg_session.refresh(user)
    assert user.failed_login_count == 0
    assert user.locked_until is None


@pytest.mark.asyncio
async def test_unknown_username_failure_leaves_no_state(pg_session, lockout_enabled):
    service = AuthService(pg_session)

    await _fail_login(service, "ghost-user", times=LOGIN_MAX_FAILED_ATTEMPTS + 1)

    assert pg_session.query(User).filter(User.username == "ghost-user").count() == 0
    assert pg_session.query(AuditLog).filter(AuditLog.action == ACTION_AUTH_LOGIN_BLOCKED).count() == 0


@pytest.mark.asyncio
async def test_lockout_disabled_by_default_leaves_no_state(pg_session, monkeypatch):
    """开关关闭（默认）时：连续错误密码既不计数也不锁定，更不写 login_blocked。"""
    from modules.auth import service as auth_service

    monkeypatch.setattr(auth_service, "LOGIN_LOCKOUT_ENABLED", False)
    user = _db_user(pg_session, "lockoff-default")
    service = AuthService(pg_session)

    await _fail_login(service, "lockoff-default", times=LOGIN_MAX_FAILED_ATTEMPTS + 2)

    pg_session.refresh(user)
    assert user.failed_login_count == 0
    assert user.locked_until is None
    assert pg_session.query(AuditLog).filter(AuditLog.action == ACTION_AUTH_LOGIN_BLOCKED).count() == 0


@pytest.mark.asyncio
async def test_lockout_disabled_ignores_existing_lock(pg_session, monkeypatch):
    """开关关闭时，库里已存在的 locked_until 不得拦住任何人（关掉即恢复访问）。"""
    from modules.auth import service as auth_service

    monkeypatch.setattr(auth_service, "LOGIN_LOCKOUT_ENABLED", False)
    user = _db_user(pg_session, "lockoff-legacy")
    user.locked_until = datetime.now(UTC) + timedelta(minutes=10)
    pg_session.commit()

    actual = await AuthService(pg_session).login("lockoff-legacy", "secret123")

    assert actual.id == user.id
    pg_session.refresh(user)
    assert user.locked_until is None  # 成功登录的清零依旧生效
