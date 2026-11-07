from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from core.access import (
    clear_access_cache,
    granted_personas,
    resolve_access,
)
from core.config import ACCESS_TOKEN_EXPIRE_MINUTES, ALGORITHM, JWT_SECRET_KEY, REFRESH_MAX_AGE_HOURS
from core.database import get_db
from models import User

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

security = HTTPBearer()

#: 请求头：当前生效视角。只能选"已授予"的视角，见 resolve_view_persona。
VIEW_PERSONA_HEADER = "X-View-Persona"


def load_user_personas(db: Session, user: User, school_id: int | None = None) -> frozenset[str]:
    """兼容包装：某校授予集合（唯一来源见 ``core.access``）。"""
    return granted_personas(db, user, school_id)


def resolve_view_persona(
    db: Session,
    user: User,
    requested: str | None = None,
    school_id: int | None = None,
) -> tuple[str | None, frozenset[str]]:
    """兼容包装：解析一次访问上下文，返回 (persona, permissions)。"""
    ctx = resolve_access(db, user, str(school_id) if school_id is not None else None, requested)
    return ctx.persona, ctx.permissions


def clear_permission_cache(user_id: int | None = None) -> None:
    """清授予缓存（唯一实现转交 access 模块）。"""
    clear_access_cache(user_id)


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

    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在或已被禁用")

    token_tv = payload.get("tv", 0)
    if token_tv != user.token_version:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="令牌已失效，请重新登录")

    # `request` 声明为 `Request | None = None`：FastAPI 仍会注入，
    # 同时允许测试与内部代码直接调用（request 为 None 时只不写 state）。
    requested = request.headers.get(VIEW_PERSONA_HEADER) if request is not None else None
    requested_school = request.headers.get("X-School-Scope") if request is not None else None
    try:
        context = resolve_access(db, user, requested_school, requested)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_403_FORBIDDEN and request is not None:
            from core.audit import ACTION_ACCESS_DENIED, record_detached

            request.state.audit_actor = user
            request.state.view_persona = requested
            try:
                record_detached(
                    request,
                    action=ACTION_ACCESS_DENIED,
                    target_type="persona",
                    target_id=str(requested),
                    target_label=str(requested),
                    outcome="denied",
                    payload={"requested_persona": requested, "requested_school": requested_school},
                )
            except Exception:  # 审计失败不得改变鉴权结果
                pass
        raise
    user.set_permissions_cache(set(context.permissions))
    user.set_active_persona(context.persona)
    user.set_active_school(context.school_id)
    user.set_access_context(context)
    if request is not None:
        request.state.view_persona = context.persona
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

    user = db.query(User).filter(User.id == user_id).first()
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
