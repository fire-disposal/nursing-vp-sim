import logging
from abc import ABC, abstractmethod
from typing import Any

from sqlalchemy.orm import Session

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


def get_strategy_registry() -> dict[str, type["LoginStrategy"]]:
    from core.login_strategies.password import PasswordLoginStrategy
    from core.login_strategies.wechat import WeChatLoginStrategy

    return {
        "password": PasswordLoginStrategy,
        "wechat": WeChatLoginStrategy,
    }
