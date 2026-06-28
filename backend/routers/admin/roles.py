from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from core.deps import DbSession
from core.security import require_permission
from infrastructure.exporter import ColumnDef, export_response
from models import User
from schemas import DeleteResponse, RoleCreateRequest, RoleResponse, RoleUpdateRequest
from services.role import RoleService

router = APIRouter(prefix="/api/admin/roles", tags=["角色管理"])

_Manager = Annotated[User, Depends(require_permission("role_manage"))]


def _resp(view) -> RoleResponse:
    return RoleResponse(
        id=view.id,
        name=view.name,
        display_name=view.display_name,
        is_system=view.is_system,
        permissions=view.permissions,
        user_count=view.user_count,
    )


@router.get("", response_model=list[RoleResponse])
def list_roles(
    current_user: _Manager,
    db: DbSession,
    search: Annotated[str, Query()] = "",
):
    return [_resp(v) for v in RoleService(db).list_all(search=search)]


@router.post("", response_model=RoleResponse, status_code=status.HTTP_201_CREATED)
def create_role(req: RoleCreateRequest, current_user: _Manager, db: DbSession):
    return _resp(RoleService(db).create(req.name, req.display_name, req.permissions))


@router.put("/{role_id}", response_model=RoleResponse)
def update_role(role_id: int, req: RoleUpdateRequest, current_user: _Manager, db: DbSession):
    return _resp(RoleService(db).update(role_id, display_name=req.display_name, permissions=req.permissions))


@router.get("/export")
def export_roles(
    current_user: _Manager,
    db: DbSession,
    format: str = Query("csv", pattern="^(csv|xlsx)$"),
):
    from models import Role

    roles = db.query(Role).order_by(Role.id).all()
    columns = [
        ColumnDef("角色名", key="name"),
        ColumnDef("显示名", key="display_name"),
    ]
    return export_response(roles, columns, "角色列表", "角色列表", format)


@router.delete("/{role_id}", response_model=DeleteResponse)
def delete_role(role_id: int, current_user: _Manager, db: DbSession):
    name = RoleService(db).delete(role_id)
    return {"message": f"角色 '{name}' 已删除"}
