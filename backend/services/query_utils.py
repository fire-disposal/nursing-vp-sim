"""共享查询工具函数"""

from datetime import datetime
from fastapi import HTTPException


def parse_date_filter(date_from: str | None, date_to: str | None) -> tuple[datetime | None, datetime | None]:
    """解析日期筛选参数，返回 (datetime_from, datetime_to)。
    任一格式无效时抛 HTTPException 400。
    """
    df = None
    dt = None
    if date_from:
        try:
            df = datetime.fromisoformat(date_from)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"无效日期格式: {date_from}")
    if date_to:
        try:
            dt = datetime.fromisoformat(date_to)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"无效日期格式: {date_to}")
    return df, dt
