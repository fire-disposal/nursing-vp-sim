from sqlalchemy import update as sa_update
from sqlalchemy.orm import Session

from models import UserClass


def nullify_user_class_associations(db: Session, class_ids: list[int]) -> None:
    """将指定班级的 UserClass 关联置空（class_id=NULL），用于删除班级/年级前的解绑。"""
    if not class_ids:
        return
    db.execute(
        sa_update(UserClass)
        .where(UserClass.class_id.in_(class_ids))
        .values(class_id=None)
    )
