"""Unit tests for security helpers beyond hashing — permission cache, guards, token validation.

Uses fake sessions; no database connection is made.
"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import jwt
import pytest
from fastapi import HTTPException

from core.config import ALGORITHM, JWT_SECRET_KEY
from core.personas import persona_permissions
from core.security import (
    _set_user_permissions,
    clear_permission_cache,
    create_access_token,
    decode_token_allow_expired,
    get_current_user,
    require_permission,
)


class _PermQuery:
    def __init__(self, permissions: list[str]):
        self._permissions = permissions
        self._queries = 0

    @property
    def queries(self) -> int:
        return self._queries

    def filter(self, _criteria):
        return self

    def all(self):
        self._queries += 1
        return [SimpleNamespace(permission=p) for p in self._permissions]


class _UserQuery:
    def __init__(self, user):
        self._user = user

    def options(self, *_args):
        return self

    def filter(self, _criteria):
        return self

    def first(self):
        return self._user

    def all(self):
        # load_role_permissions may run inside get_current_user via _set_user_permissions
        return []


class _PersonaQuery:
    """视角授予查询：默认"无任何 persona 行"（可登录、无权限）。"""

    def __init__(self, personas: list[str] | None = None):
        self._personas = personas or []
        self.queries = 0

    def filter(self, _criteria):
        return self

    def all(self):
        self.queries += 1
        return [SimpleNamespace(persona=p) for p in self._personas]


class _PermDb:
    def __init__(self, personas: list[str] | None = None):
        self.persona_query = _PersonaQuery(personas)

    def query(self, model):
        # load_user_personas 查询的是 `UserPersona.persona`（列表达式，不是类）
        if "UserPersona" in str(model):
            return self.persona_query
        raise AssertionError(f"unexpected query: {model}")


class _UserDb:
    def __init__(self, user):
        self._user = user

    def query(self, _model):
        return _UserQuery(self._user)


def _user(**kw):
    defaults = dict(
        id=1,
        is_active=True,
        token_version=0,
        role_id=2,
        _permissions_cache=None,
    )
    defaults.update(kw)
    u = SimpleNamespace(**defaults)
    u.set_permissions_cache = lambda perms: setattr(u, "_permissions_cache", perms)
    u.set_active_persona = lambda persona: setattr(u, "_active_persona", persona)
    u.has_permission = lambda perm: perm in (u._permissions_cache or set())
    return u


@pytest.fixture(autouse=True)
def _clear_perm_cache():
    clear_permission_cache()
    yield
    clear_permission_cache()


class TestLoadUserPersonas:
    def test_loads_and_caches(self):
        db = _PermDb(["teacher", "admin"])
        from core.security import load_user_personas

        granted = load_user_personas(db, _user(id=7, is_platform=False, role=None))
        assert granted == frozenset({"teacher", "admin"})
        assert db.persona_query.queries == 1

    def test_second_call_served_from_cache(self):
        from core.security import load_user_personas

        db = _PermDb(["student"])
        user = _user(id=3, is_platform=False, role=None)
        load_user_personas(db, user)
        load_user_personas(db, user)
        assert db.persona_query.queries == 1

    def test_clear_single_user_forces_reload(self):
        from core.security import load_user_personas

        db = _PermDb(["student"])
        user = _user(id=5, is_platform=False, role=None)
        load_user_personas(db, user)
        clear_permission_cache(5)
        load_user_personas(db, user)
        assert db.persona_query.queries == 2

    def test_empty_result_is_empty_frozenset(self):
        from core.security import load_user_personas

        db = _PermDb([])
        assert load_user_personas(db, _user(id=9, is_platform=False, role=None)) == frozenset()


class TestSetUserPermissions:
    def test_set_cache_from_granted_persona(self):
        db = _PermDb(["teacher"])
        user = _user(id=1, is_platform=False, role=None)
        _set_user_permissions(user, db)
        assert user._permissions_cache == set(persona_permissions("teacher"))

    def test_skips_when_already_cached(self):
        db = _PermDb(["student"])
        user = _user(id=1, is_platform=False, role=None, _permissions_cache={"other"})
        _set_user_permissions(user, db)
        assert user._permissions_cache == {"other"}


class TestGetCurrentUser:
    def _credentials(self, token: str):
        return SimpleNamespace(credentials=token)

    def test_valid_token_returns_user(self):
        token = create_access_token({"user_id": 42})
        db = _UserDb(_user(id=42, token_version=0, role_id=1))
        user = get_current_user(self._credentials(token), db)
        assert user.id == 42

    def test_invalid_token_rejected(self):
        with pytest.raises(HTTPException) as exc:
            get_current_user(self._credentials("not-a-jwt"), _UserDb(_user(id=42)))
        assert exc.value.status_code == 401

    def test_missing_user_id_rejected(self):
        token = create_access_token({"foo": "bar"})
        with pytest.raises(HTTPException) as exc:
            get_current_user(self._credentials(token), _UserDb(_user(id=42)))
        assert exc.value.status_code == 401

    def test_inactive_user_rejected(self):
        token = create_access_token({"user_id": 42})
        db = _UserDb(_user(id=42, is_active=False))
        with pytest.raises(HTTPException) as exc:
            get_current_user(self._credentials(token), db)
        assert exc.value.status_code == 401

    def test_token_version_mismatch_rejected(self):
        token = create_access_token({"user_id": 42})
        db = _UserDb(_user(id=42, token_version=5))
        with pytest.raises(HTTPException) as exc:
            get_current_user(self._credentials(token), db)
        assert exc.value.status_code == 401

    def test_missing_user_rejected(self):
        token = create_access_token({"user_id": 99})
        with pytest.raises(HTTPException) as exc:
            get_current_user(self._credentials(token), _UserDb(None))
        assert exc.value.status_code == 401


class TestDecodeTokenAllowExpired:
    def _credentials(self, token: str):
        return SimpleNamespace(credentials=token)

    def _token(self, *, exp_delta: timedelta, iat_delta: timedelta) -> str:
        now = datetime.now(UTC)
        payload = {
            "user_id": 42,
            "exp": now + exp_delta,
            "iat": now - iat_delta,
        }
        return jwt.encode(payload, JWT_SECRET_KEY, algorithm=ALGORITHM)

    def test_expired_token_still_decodes(self):
        token = self._token(exp_delta=timedelta(hours=-1), iat_delta=timedelta(hours=2))
        user = decode_token_allow_expired(self._credentials(token), _UserDb(_user(id=42)))
        assert user.id == 42

    def test_valid_token_decodes(self):
        token = self._token(exp_delta=timedelta(hours=1), iat_delta=timedelta(minutes=1))
        user = decode_token_allow_expired(self._credentials(token), _UserDb(_user(id=42)))
        assert user.id == 42

    def test_older_than_refresh_max_age_rejected(self):
        token = self._token(exp_delta=timedelta(hours=1000), iat_delta=timedelta(hours=1000))
        with pytest.raises(HTTPException) as exc:
            decode_token_allow_expired(self._credentials(token), _UserDb(_user(id=42)))
        assert exc.value.status_code == 401

    def test_invalid_token_rejected(self):
        with pytest.raises(HTTPException) as exc:
            decode_token_allow_expired(self._credentials("garbage"), _UserDb(_user(id=42)))
        assert exc.value.status_code == 401

    def test_inactive_user_rejected(self):
        token = self._token(exp_delta=timedelta(hours=-1), iat_delta=timedelta(hours=2))
        with pytest.raises(HTTPException) as exc:
            decode_token_allow_expired(self._credentials(token), _UserDb(_user(id=42, is_active=False)))
        assert exc.value.status_code == 401


def _stub_request():
    """checker 会写 request.state.audit_actor（审计的 actor 来源），故需要带 state 的替身。"""
    return SimpleNamespace(state=SimpleNamespace(audit_actor=None))


class TestRequirePermission:
    def test_allows_user_with_permission(self):
        user = _user(_permissions_cache={"case_manage"})
        checker = require_permission("case_manage")
        assert checker(request=_stub_request(), current_user=user) is user

    def test_forbids_user_without_permission(self):
        user = _user(_permissions_cache={"qa_access"})
        checker = require_permission("case_manage")
        with pytest.raises(HTTPException) as exc:
            checker(request=_stub_request(), current_user=user)
        assert exc.value.status_code == 403


class TestPermissionCacheWindow:
    def test_ttl_is_short_enough_for_cross_worker_changes(self):
        """RB-3：缓存是**进程内** dict，而生产跑 `--workers 2` —— 改权限只在写入方失效，
        另一个 worker 只能等 TTL。TTL 回到分钟级 = "降权后另一个 worker 仍按旧权限放行"，
        所以这里把上限钉住（数值可调小，不得调大回分钟级）。"""
        from core.security import _PERM_CACHE_TTL

        assert _PERM_CACHE_TTL <= 5, f"权限缓存 TTL 过大：{_PERM_CACHE_TTL}s（跨 worker 陈旧窗口）"


class TestAuthMeExposesPermissions:
    def test_get_me_fills_permissions_from_role(self):
        """RB-4：`/auth/me` 必须带 permissions，否则前端降权/升权后最长 24h 仍按旧权限渲染。"""
        from modules.auth.service import AuthService

        user = _user(
            username="u1",
            role=SimpleNamespace(name="admin", display_name="管理员"),
            display_name="用户一",
            student_id=None,
            gender=None,
            avatar=None,
            memberships=[],
            created_at=datetime.now(UTC),
        )
        brief = AuthService(_PermDb(["teacher"])).get_me(user)

        assert brief.permissions == sorted(persona_permissions("teacher"))
        assert brief.personas == ["teacher"]

    def test_get_me_without_role_keeps_empty_permissions(self):
        from modules.auth.service import AuthService

        user = _user(
            role_id=None,
            username="u2",
            role=None,
            display_name="用户二",
            student_id=None,
            gender=None,
            avatar=None,
            memberships=[],
            created_at=datetime.now(UTC),
        )
        brief = AuthService(_PermDb([])).get_me(user)

        assert brief.permissions == []
