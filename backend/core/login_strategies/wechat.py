import logging
from typing import Any

from models import User

from . import LoginStrategy

log = logging.getLogger(__name__)


class WeChatLoginStrategy(LoginStrategy):
    provider_type = "wechat"

    async def authenticate(self, credentials: dict[str, Any]) -> User | None:
        openid = credentials.get("openid", "")
        if not openid:
            return None

        user = self.db.query(User).filter(User.wechat_openid == openid).first()
        if user:
            return user

        return None
