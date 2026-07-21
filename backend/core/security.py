import time
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session, joinedload

from core.config import ACCESS_TOKEN_EXPIRE_MINUTES, ALGORITHM, JWT_SECRET_KEY, REFRESH_MAX_AGE_HOURS
from core.database import get_db
from models import RolePermission, User

security = HTTPBearer()

# Process-level permission cache: role_id -> (expires_at_monotonic, frozenset[str])
_permission_cache: dict[int, tuple[float, frozenset[str]]] = {}
_PERM_CACHE_TTL = 60


def load_role_permissions(db: Session, role_id: int) -> frozenset[str]:
    now = time.monotonic()
    cached = _permission_cache.get(role_id)
    if cached is not None and now < cached[0]:
        return cached[1]
    rows = db.query(RolePermission.permission).filter(RolePermission.role_id == role_id).all()
    perms = frozenset(r.permission for r in rows)
    _permission_cache[role_id] = (now + _PERM_CACHE_TTL, perms)
    return perms


def clear_permission_cache(role_id: int | None = None) -> None:
    if role_id is not None:
        _permission_cache.pop(role_id, None)
    else:
        _permission_cache.clear()


def _set_user_permissions(user: User, db: Session) -> None:
    if getattr(user, "_permissions_cache", None) is not None:
        return
    user.set_permissions_cache(set(load_role_permissions(db, user.role_id)))


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

    _set_user_permissions(user, db)
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

    return user


def require_permission(permission: str):
    def checker(
        current_user: User = Depends(get_current_user),
    ) -> User:
        if not current_user.has_permission(permission):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="权限不足")
        return current_user

    return checker
