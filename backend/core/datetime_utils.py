"""全局时区安全工具。

所有跨模块的 datetime 解析和时区正规化必须通过此模块，杜绝 offset-naive / offset-aware 混用。
"""

from datetime import UTC, datetime


def parse_iso_datetime(value: str) -> datetime:
    """解析 ISO 8601 日期时间字符串，始终返回 UTC-aware datetime。

    若传入字符串不含时区信息，默认视为 UTC。
    """
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


def ensure_utc(dt: datetime) -> datetime:
    """确保 datetime 为 UTC-aware。

    - naive datetime → 视为 UTC，附加 tzinfo
    - aware datetime → 转换为 UTC
    """
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)
