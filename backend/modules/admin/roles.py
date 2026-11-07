"""账号类型（角色）列表 —— 只读。

自「视角 = 权限预设」起，角色只表示账号类型（默认视角 / 归属 / 展示），**不承载权限**。
因此这里没有创建/修改/删除/权限编辑端点，只保留列表（用户表单与筛选需要它）。
"""

from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func

from core.deps import DbSession
from core.security import require_permission
from models import Role, User
from schemas import RoleResponse

router = APIRouter(prefix="/roles", tags=["角色"])

_Manager = Annotated[User, Depends(require_permission("role_manage"))]


@dataclass(slots=True)
class RoleFilters:
    search: Annotated[str, Query(description="角色名模糊搜索")] = ""


@router.get("", response_model=list[RoleResponse])
def list_roles(
    _current_user: _Manager,
    db: DbSession,
    filters: Annotated[RoleFilters, Depends()],
):
    q = db.query(Role)
    keyword = filters.search.strip()
    if keyword:
        q = q.filter(Role.name.ilike(f"%{keyword}%"))
    roles = q.order_by(Role.id).all()
    counts = {role_id: count for role_id, count in db.query(User.role_id, func.count(User.id)).group_by(User.role_id)}
    return [
        RoleResponse(
            id=role.id,
            name=role.name,
            display_name=role.display_name,
            is_system=role.is_system,
            user_count=counts.get(role.id, 0),
        )
        for role in roles
    ]
