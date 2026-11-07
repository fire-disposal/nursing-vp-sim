"""视角 → 数据作用域：院校边界只来自账号，视角只决定"本校全部/任教班级/仅本人"。

这些用例锁住两条不变量：
1. 视角永不放宽院校边界（超管除外，它本来就是全局）；
2. 没有视角的账号保持迁移前的旧推断（不让老账号因新表为空失权）。
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from core.tenant import resolve_scope


class _ClassQuery:
    def __init__(self, class_ids: set[int]):
        self._ids = class_ids

    def filter(self, *_args, **_kwargs):
        return self

    def all(self):
        return [(cid,) for cid in sorted(self._ids)]


class _Db:
    def __init__(self, taught: set[int] | None = None):
        self._taught = taught or set()

    def query(self, _model):
        return _ClassQuery(self._taught)


def _user(
    *, school_id: int | None = 3, persona: str | None = "teacher", perms: set[str] | None = None, platform: bool = False
):
    return SimpleNamespace(
        id=42,
        school_id=school_id,
        is_platform=platform,
        role=SimpleNamespace(name="teacher"),
        active_persona=persona,
        has_permission=lambda p: p in (perms or set()),
    )


@pytest.mark.parametrize("persona", ["admin", "ops"])
def test_tenant_scope_personas_see_whole_school(persona):
    scope = resolve_scope(_Db({7, 8}), _user(persona=persona))
    assert scope.school_id == 3
    assert scope.class_ids is None


def test_class_scope_limits_to_taught_classes():
    scope = resolve_scope(_Db({7, 8}), _user(persona="teacher"))
    assert scope.school_id == 3
    assert scope.class_ids == frozenset({7, 8})


def test_self_scope_keeps_school_but_no_classes():
    scope = resolve_scope(_Db({7, 8}), _user(persona="student"))
    assert scope.school_id == 3
    assert scope.class_ids == frozenset()


def test_platform_account_is_global_even_with_school():
    scope = resolve_scope(_Db({7}), _user(school_id=3, persona="student", platform=True))
    assert scope.school_id is None
    assert scope.class_ids is None


def test_account_without_school_is_global():
    scope = resolve_scope(_Db({7}), _user(school_id=None, persona="teacher"))
    assert scope.school_id is None


def test_user_without_persona_has_school_but_no_classes():
    """没有授予任何视角：院校边界保留，class_ids 为空（能登录、看不到数据）。"""
    scope = resolve_scope(_Db({7}), _user(persona=None))
    assert scope.school_id == 3
    assert scope.class_ids == frozenset()


def test_platform_persona_is_global():
    scope = resolve_scope(_Db({7}), _user(persona="platform"))
    assert scope.school_id is None
    assert scope.class_ids is None
