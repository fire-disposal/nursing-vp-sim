from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models._base import _now_utc


class RateLimitEntry(Base):
    __tablename__ = "rate_limit_entries"
    __table_args__ = (Index("idx_rate_limit_key_ts", "key", "created_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now_utc, server_default=text("NOW()")
    )
