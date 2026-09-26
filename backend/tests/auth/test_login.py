"""Password login behavior without a speculative strategy registry."""

from types import SimpleNamespace

import pytest

from core.exceptions import AuthError
from core.security import hash_password
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


def _user(username: str, password: str, *, active: bool = True):
    return SimpleNamespace(
        id=1,
        username=username,
        password_hash=hash_password(password),
        is_active=active,
        role=None,
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
