import asyncio
import logging
from typing import Any

from core.security import verify_password
from models import User

from . import LoginStrategy

log = logging.getLogger(__name__)


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
