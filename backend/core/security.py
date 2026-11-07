from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session, joinedload

from core.config import ACCESS_TOKEN_EXPIRE_MINUTES, ALGORITHM, JWT_SECRET_KEY, REFRESH_MAX_AGE_HOURS
from core.database import get_db
from core.personas import PERSONA_KEYS, default_persona_for, grants_all_personas, persona_permissions
from models import RolePermission, User, UserPersona

security = HTTPBearer()

#: 请求头：当前生效视角。只能选"已授予"的视角，见 resolve_view_persona。
VIEW_PERSONA_HEADER = "X-View-Persona"

# Process-level permission cache: role_id -> (expires_at_monotonic, frozenset[str])
_permission_cache: dict[int, tuple[float, frozenset[str]]] = {}
# 视角授予集合缓存：user_id -> (expires_at_monotonic, frozenset[str] | None)
# None 表示"该用户没有任何 persona 行"（legacy / 自定义角色），由调用方回落到 role_permissions。
_user_persona_cache: dict[int, tuple[float, frozenset[str] | None]] = {}
# TTL 取 2s：缓存是**进程内**的，而生产跑 --workers 2（Dockerfile.backend 的 --workers），
# 改权限只会在写入的那个 worker 上被 clear_permission_cache 立即失效，另一个 worker 只能等 TTL。
# 60s 意味着"降权后另一个 worker 最长 60s 仍按旧权限放行"；2s 把窗口压到可接受量级，
# 同时仍挡住同一请求内的重复查询（2026-09-26 审计 RB-3）。
_PERM_CACHE_TTL = 2


def load_role_permissions(db: Session, role_id: int) -> frozenset[str]:
    now = time.monotonic()
    cached = _permission_cache.get(role_id)
    if cached is not None and now < cached[0]:
        return cached[1]
    rows = db.query(RolePermission.permission).filter(RolePermission.role_id == role_id).all()
    perms = frozenset(r.permission for r in rows)
    _permission_cache[role_id] = (now + _PERM_CACHE_TTL, perms)
    return perms


def load_user_personas(db: Session, user: User) -> frozenset[str]:
    """该用户**已授予**的视角集合（超管 = 全集，派生）。

    无 persona 行且非超管 → 空集，调用方据此走 legacy `role_permissions`。
    写入侧（授权变更）负责 `clear_permission_cache(user.id)`。
    """
    if grants_all_personas(user):
        return frozenset(PERSONA_KEYS)
    now = time.monotonic()
    cached = _user_persona_cache.get(user.id)
    if cached is not None and now < cached[0]:
        return cached[1] if cached[1] is not None else frozenset()
    rows = db.query(UserPersona.persona).filter(UserPersona.user_id == user.id).all()
    granted = frozenset(r.persona for r in rows)
    _user_persona_cache[user.id] = (now + _PERM_CACHE_TTL, granted or None)
    return granted


def resolve_view_persona(
    db: Session,
    user: User,
    requested: str | None = None,
) -> tuple[str | None, frozenset[str]]:
    """解析当前生效视角 → `(persona, permissions)`。

    - `requested` 给了但不在授予集合内 → 403「视角不可用」（前端只能选已授予的）；
    - 未给 → 默认视角（系统角色 → `default_persona_for`；超管 → admin）；
    - 无 persona 行且非超管 → legacy：persona 记为 `role.name`，权限取 `role_permissions`
      （迁移前的老用户 / 自定义角色不因新表为空而 500 或失权）。
    """
    granted = load_user_personas(db, user)
    legacy = not granted
    default = default_persona_for(user)

    if requested:
        desired = requested.strip()
        if legacy:
            # 未授予任何视角的用户，唯一可用的"视角"就是 legacy 身份本身
            role = getattr(user, "role", None)
            if desired != (role.name if role is not None else ""):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="视角不可用")
            return desired, load_role_permissions(db, user.role_id)
        if desired not in granted:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="视角不可用")
        return desired, persona_permissions(desired)

    if legacy or default is None:
        role = getattr(user, "role", None)
        return (role.name if role is not None else None), load_role_permissions(db, user.role_id)

    active = default if default in granted else sorted(granted)[0]
    return active, persona_permissions(active)


def clear_permission_cache(role_id: int | None = None) -> None:
    """清权限缓存。入参沿用历史语义：给了 `role_id` 只清那条角色权限，
    但视角授予集合按 `user_id` 缓存、且与角色权限同源（都影响生效权限），
    因此**无论怎么调**都一并清空 `user_personas` 缓存。"""
    if role_id is not None:
        _permission_cache.pop(role_id, None)
    else:
        _permission_cache.clear()
    _user_persona_cache.clear()


def _set_user_permissions(user: User, db: Session, persona: str | None = None) -> None:
    """把生效权限挂到 `user.has_permission` 用的缓存上。

    `persona is None` = 用默认视角（WebSocket 等不解析 header 的路径）；
    解析失败（例如越权视角）时保持无权限而不是 500 —— 鉴权由调用方决定。
    """
    if getattr(user, "_permissions_cache", None) is not None:
        return
    try:
        _active, perms = resolve_view_persona(db, user, persona)
    except HTTPException:
        user.set_permissions_cache(set())
        return
    user.set_permissions_cache(set(perms))


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    now = datetime.now(UTC)
    to_encode.update({"exp": now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES), "iat": now})
    return jwt.encode(to_encode, JWT_SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
    # FastAPI 会注入 Request；直接调用（测试/内部）时可省略，此时不写 request.state
    request: Request = None,  # ty: ignore[invalid-parameter-default]
) -> User:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("user_id")
        if not isinstance(user_id, int):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的认证令牌")
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的认证令牌")

    user = db.query(User).options(joinedload(User.role)).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在或已被禁用")

    token_tv = payload.get("tv", 0)
    if token_tv != user.token_version:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="令牌已失效，请重新登录")

    # `request` 声明为 `Request | None = None`：FastAPI 仍会注入，
    # 同时允许测试与内部代码直接调用（request 为 None 时只不写 state）。
    requested = request.headers.get(VIEW_PERSONA_HEADER) if request is not None else None
    # 越权视角由 resolve_view_persona 抛 403「视角不可用」
    active, perms = resolve_view_persona(db, user, requested)
    user.set_permissions_cache(set(perms))
    # /auth/me 要在不重复解析的前提下回报当前视角
    # 与 _permissions_cache 同构的请求级快照，随对象生命周期消亡
    user.set_active_persona(active)
    if request is not None:
        # 审计（core/audit.py::_actor_from_request）与 403 留痕都读这两个字段
        request.state.view_persona = active
        request.state.audit_actor = user
    return user


def decode_token_allow_expired(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    token = credentials.credentials
    try:
        payload = jwt.decode(
            token,
            JWT_SECRET_KEY,
            algorithms=[ALGORITHM],
            options={"verify_exp": False},
        )
        user_id = payload.get("user_id")
        if not isinstance(user_id, int):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的凭证")
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的凭证")

    user = db.query(User).options(joinedload(User.role)).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在或已被禁用")

    token_tv = payload.get("tv", 0)
    if token_tv != user.token_version:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="凭证已失效，请重新登录")

    iat = payload.get("iat", None)
    if isinstance(iat, (int, float)):
        issued_at = datetime.fromtimestamp(iat, tz=UTC)
        max_age = timedelta(hours=REFRESH_MAX_AGE_HOURS)
        if datetime.now(UTC) - issued_at > max_age:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="凭证已过期，请重新登录")

    # refresh 路径不解析视角：返回的 TokenResponse 用默认视角（前端刷新后自行选默认页）
    _set_user_permissions(user, db)
    return user


def require_permission(permission: str):
    def checker(
        request: Request,
        current_user: User = Depends(get_current_user),
    ) -> User:
        # get_current_user 已把 User 与当前视角挂到 request.state（审计/403 留痕依赖）
        request.state.audit_actor = current_user
        if not current_user.has_permission(permission):
            # "有人尝试越权"是最需要留下的证据 → 独立 session 落库（业务若回滚也留痕）
            from core.audit import ACTION_ACCESS_DENIED, record_detached

            record_detached(
                request,
                action=ACTION_ACCESS_DENIED,
                target_type="permission",
                target_id=permission,
                target_label=permission,
                outcome="denied",
                payload={"required_permission": permission},
            )
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="权限不足")
        return current_user

    return checker
