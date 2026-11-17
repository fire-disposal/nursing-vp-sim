"""WebSocket 鉴权（与 HTTP ``get_current_user`` 同语义的查询参数版本）。

浏览器 WebSocket 不能自带请求头，于是 JWT / 视角 / 院校只能走查询参数。本模块把
``modules/training/router/ws.py`` 里原有的两条判定（JWT + token_version、以及
``training_access`` 权限）原样提取出来，供训练事件通道与语音识别通道共用 —— 行为不变，
只是不再各写一份。

关闭码约定（前端按码分支，别改）::

    4001 鉴权失败（缺 token / 过期 / 用户不存在或已停用 / token_version 不符）
    4003 已登录但无权（缺 training_access）
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

import jwt

from core.database import SessionLocal
from core.security import ALGORITHM, JWT_SECRET_KEY, _set_user_permissions
from models import User

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

log = logging.getLogger(__name__)

WS_CLOSE_UNAUTHORIZED = 4001
WS_CLOSE_FORBIDDEN = 4003


@dataclass(frozen=True)
class WsIdentity:
    user_id: int
    token_version: int


def authenticate_ws_token(token: str) -> WsIdentity | None:
    """校验 JWT 并核对用户状态 / token_version。

    返回的只是普通值对象，**不持有 ORM 实例** —— 会话随之关闭，后续查询另开 session。
    """
    if not token:
        return None
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError as e:
        log.warning("WS auth: JWT decode failed: %s", e)
        return None

    user_id = payload.get("user_id")
    if not isinstance(user_id, int):
        log.warning("WS auth: user_id not int: %s", type(user_id))
        return None

    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            log.warning("WS auth: user %d not found", user_id)
            return None
        if not user.is_active:
            log.warning("WS auth: user %d inactive", user_id)
            return None
        token_tv = payload.get("tv", 0)
        if token_tv != user.token_version:
            log.warning(
                "WS auth: token_version mismatch tv=%d db=%d for user %d", token_tv, user.token_version, user_id
            )
            return None
        return WsIdentity(user_id=user.id, token_version=user.token_version)
    finally:
        db.close()


def resolve_ws_access(
    user_id: int,
    *,
    persona: str = "",
    school: str = "",
) -> bool:
    """按查询参数解析视角/院校，并判断是否具备 ``training_access``。

    缺省（旧客户端）走默认视角 —— 平台账号会落到 ``ops`` 视角、无 ``training_access``，
    与 HTTP 请求不带 ``X-View-Persona`` 时一致。
    """
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if user is None:
            return False
        resolved = _set_user_permissions(user, db, persona, school)
        if not resolved:
            log.warning("WS auth: user %d access context unresolved (persona=%r school=%r)", user_id, persona, school)
            return False
        if not user.has_permission("training_access"):
            log.warning("WS auth: user %d lacks training_access (persona=%r school=%r)", user_id, persona, school)
            return False
        return True
    finally:
        db.close()
