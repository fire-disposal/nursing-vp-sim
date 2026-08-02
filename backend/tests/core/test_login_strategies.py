"""Unit tests for login strategies — fake session, no database."""

from types import SimpleNamespace

import pytest

from core.login_strategies import PasswordLoginStrategy, get_strategy_registry
from core.security import hash_password


class _FakeUserQuery:
    def __init__(self, users: dict[str, object]):
        self._users = users
        self._username: str | None = None

    def filter(self, _criteria):
        # criteria is User.username == value; extract the literal side
        right = getattr(_criteria, "right", None)
        self._username = getattr(right, "value", None)
        return self

    def first(self):
        if self._username is None:
            return None
        return self._users.get(self._username)


class _FakeDb:
    def __init__(self, users: dict[str, object]):
        self._users = users

    def query(self, _model):
        return _FakeUserQuery(self._users)


def _user(username: str, password: str):
    return SimpleNamespace(username=username, password_hash=hash_password(password))


class TestPasswordLoginStrategy:
    @pytest.mark.asyncio
    async def test_authenticates_with_correct_password(self):
        db = _FakeDb({"alice": _user("alice", "secret123")})
        strategy = PasswordLoginStrategy(db)
        user = await strategy.authenticate({"username": "alice", "password": "secret123"})
        assert user is not None
        assert user.username == "alice"

    @pytest.mark.asyncio
    async def test_returns_none_for_unknown_username(self):
        db = _FakeDb({"alice": _user("alice", "secret123")})
        strategy = PasswordLoginStrategy(db)
        assert await strategy.authenticate({"username": "nobody", "password": "secret123"}) is None

    @pytest.mark.asyncio
    async def test_returns_none_for_wrong_password(self):
        db = _FakeDb({"alice": _user("alice", "secret123")})
        strategy = PasswordLoginStrategy(db)
        assert await strategy.authenticate({"username": "alice", "password": "wrong"}) is None

    @pytest.mark.asyncio
    async def test_missing_credentials_are_empty_strings(self):
        db = _FakeDb({})
        strategy = PasswordLoginStrategy(db)
        assert await strategy.authenticate({}) is None

    def test_provider_type(self):
        assert PasswordLoginStrategy.provider_type == "password"


class TestStrategyRegistry:
    def test_registry_contains_password(self):
        registry = get_strategy_registry()
        assert "password" in registry
        assert registry["password"] is PasswordLoginStrategy
