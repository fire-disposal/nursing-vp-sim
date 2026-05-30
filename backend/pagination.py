from typing import Tuple, Any, List
from sqlalchemy.orm import Query


def paginate(query: Query, offset: int, limit: int) -> Tuple[List[Any], int]:
    total = query.order_by(None).count()
    items = query.offset(offset).limit(limit).all()
    return items, total
