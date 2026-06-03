from typing import Any


def paginate(query: Any, offset: int, limit: int) -> tuple[list[Any], int]:
    total = query.order_by(None).count()
    items = query.offset(offset).limit(limit).all()
    return items, total
