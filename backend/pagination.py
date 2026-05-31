from typing import Tuple, Any, List


def paginate(query: Any, offset: int, limit: int) -> Tuple[List[Any], int]:
    total = query.order_by(None).count()
    items = query.offset(offset).limit(limit).all()
    return items, total
