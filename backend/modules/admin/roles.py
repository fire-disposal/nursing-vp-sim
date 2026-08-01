from dataclasses import dataclass
from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func

from core.deps import DbSession
from core.exceptions import AuthError, NotFoundError, ValidationError
from core.permissions import PERMISSION_KEYS
from core.security import clear_permission_cache, load_role_permissions, require_permission
from core.unit_of_work import unit_of_work
from infra.exporter import ColumnDef, export_response
from models import Role, RolePermission, User
from schemas import DeleteResponse, RoleCreateRequest, RoleResponse, RoleUpdateRequest

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


@dataclass
class RoleView:
    id: int
    name: str
    display_name: str
    is_system: bool
    permissions: list[str]
    user_count: int


class RoleService:
    def __init__(self, db: "Session"):
        self.db = db

    def _view(self, role: Role, permissions: list[str], user_count: int) -> RoleView:
        return RoleView(
            id=role.id,
            name=role.name,
            display_name=role.display_name,
            is_system=role.is_system,
            permissions=permissions,
            user_count=user_count,
        )

    def list_all(self, search: str = "") -> list[RoleView]:
        roles = self.list_roles(search)
        role_ids = [r.id for r in roles]
        perms_map = self.permissions_map(role_ids)
        counts = self.user_counts(role_ids)
        return [self._view(r, perms_map.get(r.id, []), counts.get(r.id, 0)) for r in roles]

    def list_roles(self, search: str = "") -> list[Role]:
        q = self.db.query(Role)
        if search:
            q = q.filter(Role.display_name.ilike(f"%{search}%"))
        return q.order_by(Role.id).all()

    def name_exists(self, name: str, exclude_id: int | None = None) -> bool:
        q = self.db.query(Role).filter(Role.name == name)
        if exclude_id is not None:
            q = q.filter(Role.id != exclude_id)
        return bool(self.db.query(q.exists()).scalar())

    def permissions_map(self, role_ids: list[int]) -> dict[int, list[str]]:
        if not role_ids:
            return {}
        rows = self.db.query(RolePermission).filter(RolePermission.role_id.in_(role_ids)).all()
        result: dict[int, list[str]] = {}
        for p in rows:
            result.setdefault(p.role_id, []).append(p.permission)
        return result

    def user_counts(self, role_ids: list[int]) -> dict[int, int]:
        if not role_ids:
            return {}
        rows = (
            self.db.query(User.role_id, func.count(User.id))
            .filter(User.role_id.in_(role_ids))
            .group_by(User.role_id)
            .all()
        )
        return {role_id: cnt for role_id, cnt in rows}

    def get_permissions(self, role_id: int) -> list[str]:
        rows = self.db.query(RolePermission.permission).filter(RolePermission.role_id == role_id).all()
        return [r[0] for r in rows]

    def replace_permissions(self, role_id: int, permissions: list[str]) -> None:
        self.db.query(RolePermission).filter(RolePermission.role_id == role_id).delete(synchronize_session="fetch")
        for perm in permissions:
            self.db.add(RolePermission(role_id=role_id, permission=perm))

    def user_count(self, role_id: int) -> int:
        return self.db.query(func.count(User.id)).filter(User.role_id == role_id).scalar() or 0

    def _validate_permissions(self, permissions: list[str], grantable: set[str] | None) -> None:
        unknown = sorted(set(permissions) - set(PERMISSION_KEYS))
        if unknown:
            raise ValidationError(f"未知权限: {unknown}")
        if grantable is not None:
            escalated = sorted(set(permissions) - grantable)
            if escalated:
                raise AuthError(f"无权授予以下权限: {escalated}", status_code=403)

    def create(
        self,
        name: str,
        display_name: str,
        permissions: list[str],
        *,
        grantable: set[str] | None = None,
    ) -> RoleView:
        if self.name_exists(name):
            raise ValidationError("角色名已存在")
        self._validate_permissions(permissions, grantable)
        with unit_of_work(self.db, conflict_detail="角色名已存在"):
            role = Role(name=name, display_name=display_name, is_system=False)
            self.db.add(role)
            self.db.flush()
            for perm in permissions:
                self.db.add(RolePermission(role_id=role.id, permission=perm))
        return self._view(role, list(permissions), 0)

    def update(
        self,
        role_id: int,
        *,
        display_name: str | None = None,
        permissions: list[str] | None = None,
        grantable: set[str] | None = None,
    ) -> RoleView:
        role = self.db.get(Role, role_id)
        if role is None:
            raise NotFoundError("角色不存在")
        if role.is_system:
            raise AuthError("系统角色不可修改", status_code=403)
        if permissions is not None:
            self._validate_permissions(permissions, grantable)
        with unit_of_work(self.db, conflict_detail="角色冲突"):
            if display_name is not None:
                role.display_name = display_name
            if permissions is not None:
                self.replace_permissions(role.id, permissions)
                clear_permission_cache(role.id)
        perms = self.get_permissions(role.id)
        user_count = self.user_count(role.id)
        return self._view(role, perms, user_count)

    def delete(self, role_id: int) -> str:
        role = self.db.get(Role, role_id)
        if role is None:
            raise NotFoundError("角色不存在")
        if role.is_system:
            raise ValidationError("系统角色不可删除")
        user_count = self.user_count(role.id)
        if user_count > 0:
            raise ValidationError(f"该角色下还有 {user_count} 个用户，无法删除")
        name = role.name
        with unit_of_work(self.db, conflict_detail="角色冲突"):
            self.db.delete(role)
            self.db.flush()
        return name


router = APIRouter(prefix="/roles", tags=["角色管理"])

_Manager = Annotated[User, Depends(require_permission("role_manage"))]


def _grantable(current_user: User, db) -> set[str]:
    return set(load_role_permissions(db, current_user.role_id))


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
    return _resp(
        RoleService(db).create(
            req.name,
            req.display_name,
            req.permissions,
            grantable=_grantable(current_user, db),
        )
    )


@router.put("/{role_id}", response_model=RoleResponse)
def update_role(role_id: int, req: RoleUpdateRequest, current_user: _Manager, db: DbSession):
    return _resp(
        RoleService(db).update(
            role_id,
            display_name=req.display_name,
            permissions=req.permissions,
            grantable=_grantable(current_user, db),
        )
    )


@router.post("/export")
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
