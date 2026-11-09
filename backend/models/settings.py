from __future__ import annotations

from sqlalchemy import Boolean, Integer, text
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models._base import TimestampMixin


class AppSettings(Base, TimestampMixin):
    """全站运行时开关（单行，id=1）。放 DB 而不是 env：管理员可在界面即时切换。"""

    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    #: 首次登录是否显示“点反馈”引导遮罩（每个账号本地记已读）。
    feedback_hint_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
