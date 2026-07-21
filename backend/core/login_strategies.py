import asyncio
import logging
from abc import ABC, abstractmethod
from typing import Any

from sqlalchemy.orm import Session

from core.security import verify_password
from models import User

log = logging.getLogger(__name__)


class LoginStrategy(ABC):
    """
    登录策略抽象基类。

    所有登录方式（密码、微信、OAuth2、CAS）都实现 authenticate() 方法，
    接收原始凭证，返回 User 或 None。路由层只负责参数校验和 JWT 签发，
    不再关心具体认证逻辑。

    扩展新登录方式：
      1. 继承 LoginStrategy
      2. 实现 authenticate(credentials) → User | None
      3. 在 get_strategy_registry() 中注册
      4. 在 auth.py 中添加对应路由端点
    """

    provider_type: str

    def __init__(self, db: Session):
        self.db = db

    @abstractmethod
    async def authenticate(self, credentials: dict[str, Any]) -> User | None:
        """返回匹配的 User，或 None 表示认证失败"""


class PasswordLoginStrategy(LoginStrategy):
    provider_type = "password"

    async def authenticate(self, credentials: dict[str, Any]) -> User | None:
        username = credentials.get("username", "")
        password = credentials.get("password", "")
        user = self.db.query(User).filter(User.username == username).first()
        if not user:
            return None
        if not await asyncio.to_thread(verify_password, password, user.password_hash):
            return None
        return user


def get_strategy_registry() -> dict[str, type["LoginStrategy"]]:
    return {
        "password": PasswordLoginStrategy,
    }
