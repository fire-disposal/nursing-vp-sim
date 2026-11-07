"""访问上下文：院校 × 视角的唯一解析与授予来源。

四块职责集中在这里（不另造通用权限框架）：

- ``GrantStore``：``user_school_personas`` / ``user_school_profiles`` 的读写；
- ``GrantPolicy``：谁能授予谁（平台跨校、院校管理员限本校、不得授出自己没有的视角）；
- ``AccessContext``：一次请求的不可变身份快照；
- ``resolve_access``：请求头 + 授予 → 上下文，越界一律 403。

``users.school_id`` 只是默认/家院校；真正授权只认 ``(user_id, school_id, persona)``。
班级是校内业务分组，不参与访问上下文。
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

from fastapi import HTTPException, status

from core.personas import (
    PERSONA_KEYS,
    PERSONAS,
    default_persona_for,
    grants_all_personas,
    persona_permissions,
    persona_scope,
)
from models import School, UserSchoolPersona, UserSchoolProfile

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from models import User

_PERM_CACHE_TTL = 2
#: (user_id, school_id) -> (expires_at, personas)
_grant_cache: dict[tuple[int, int | None], tuple[float, frozenset[str]]] = {}


def clear_access_cache(user_id: int | None = None) -> None:
    if user_id is None:
        _grant_cache.clear()
        return
    for key in [k for k in _grant_cache if k[0] == user_id]:
        _grant_cache.pop(key, None)


def accessible_school_ids(db: Session, user: User) -> frozenset[int]:
    """家院校 + 存在授予的附加院校。平台账号不走此表（跨校）。"""
    ids: set[int] = set()
    home = getattr(user, "school_id", None)
    if home is not None:
        ids.add(home)
    ids.update(
        row[0]
        for row in db.query(UserSchoolPersona.school_id).filter(UserSchoolPersona.user_id == user.id).distinct().all()
    )
    return frozenset(ids)


def granted_personas(db: Session, user: User, school_id: int | None = None) -> frozenset[str]:
    """该用户在某校的授予。平台账号派生全部；没有学校 = 空集。

    ``school_id=None`` 是兼容包装的“家院校”默认值；请求路径必须显式传院校。
    """
    if grants_all_personas(user):
        return frozenset(PERSONA_KEYS)
    if school_id is None:
        school_id = getattr(user, "school_id", None)
    if school_id is None:
        return frozenset()
    key = (user.id, school_id)
    now = time.monotonic()
    cached = _grant_cache.get(key)
    if cached is not None and now < cached[0]:
        return cached[1]
    granted = frozenset(
        row[0]
        for row in db.query(UserSchoolPersona.persona)
        .filter(UserSchoolPersona.user_id == user.id, UserSchoolPersona.school_id == school_id)
        .all()
    )
    _grant_cache[key] = (now + _PERM_CACHE_TTL, granted)
    return granted


def replace_personas(db: Session, user_id: int, school_id: int, personas: list[str]) -> list[str]:
    """写入某校授予（不做授权策略判断，调用方必须已过 GrantPolicy）。"""
    unique = list(dict.fromkeys(personas))
    db.query(UserSchoolPersona).filter(
        UserSchoolPersona.user_id == user_id, UserSchoolPersona.school_id == school_id
    ).delete(synchronize_session="fetch")
    for persona in unique:
        db.add(UserSchoolPersona(user_id=user_id, school_id=school_id, persona=persona))
    db.flush()
    clear_access_cache(user_id)
    return unique


def grantable_personas(actor: User) -> frozenset[str]:
    """调用者可授予的视角集合：平台不限；其他按当前生效权限覆盖整档预设。"""
    if grants_all_personas(actor):
        return frozenset(PERSONA_KEYS)
    perms = frozenset(getattr(actor, "_permissions_cache", None) or ())
    return frozenset(key for key in PERSONA_KEYS if set(PERSONAS[key].permissions) <= perms)


def student_profile_student_id(db: Session, user_id: int, school_id: int | None) -> str | None:
    if school_id is None:
        return None
    row = (
        db.query(UserSchoolProfile.student_id)
        .filter(UserSchoolProfile.user_id == user_id, UserSchoolProfile.school_id == school_id)
        .first()
    )
    return row[0] if row else None


def set_student_profile(db: Session, user_id: int, school_id: int, student_id: str | None) -> None:
    row = (
        db.query(UserSchoolProfile)
        .filter(UserSchoolProfile.user_id == user_id, UserSchoolProfile.school_id == school_id)
        .first()
    )
    if student_id in (None, ""):
        if row is not None:
            db.delete(row)
        return
    if row is None:
        db.add(UserSchoolProfile(user_id=user_id, school_id=school_id, student_id=student_id))
    else:
        row.student_id = student_id


@dataclass(frozen=True)
class AccessContext:
    user_id: int
    school_id: int | None
    persona: str | None
    permissions: frozenset[str]
    accessible_schools: frozenset[int]

    @property
    def is_global(self) -> bool:
        return self.school_id is None


def _parse_school(raw: str | None) -> int | None:
    if not raw:
        return None
    return int(raw) if raw.isdigit() and int(raw) > 0 else None


def resolve_access(
    db: Session,
    user: User,
    requested_school: str | None = None,
    requested_persona: str | None = None,
) -> AccessContext:
    """解析请求身份。兼容旧 header 字符串；越界/未授予一律 403。

    平台账号：platform 视角可全局或选校；其他视角**必须有选校**（不再拿全局数据面）。
    普通账号：只能在家院校/已授予附加院校内选择；没有选校时默认家院校。
    """
    is_platform = grants_all_personas(user)
    accessible = accessible_school_ids(db, user) if not is_platform else frozenset()
    requested_sid = _parse_school(requested_school)

    if is_platform:
        if requested_sid is not None:
            if db.get(School, requested_sid) is None:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="院校不可用")
            active_school: int | None = requested_sid
        else:
            active_school = None
    elif requested_sid is not None:
        if requested_sid not in accessible:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="院校不可用")
        active_school = requested_sid
    else:
        active_school = getattr(user, "school_id", None) or (min(accessible) if accessible else None)

    granted = granted_personas(db, user, active_school)
    desired = requested_persona.strip() if requested_persona else None
    if desired is not None and desired not in granted:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="视角不可用")
    if desired == "platform" and not is_platform:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="视角不可用")
    if desired is None:
        default = default_persona_for(user)
        if default in granted:
            desired = default
        elif granted:
            desired = next(iter(sorted(granted)))
        elif is_platform:
            desired = "platform"
        else:
            desired = None
    if is_platform and desired is not None and persona_scope(desired) != "platform" and active_school is None:
        # 平台的非 platform 视角不能对“所有学校”生效：先选学校。
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="请先选择院校")
    return AccessContext(
        user_id=user.id,
        school_id=active_school,
        persona=desired,
        permissions=persona_permissions(desired) if desired else frozenset(),
        accessible_schools=accessible,
    )
