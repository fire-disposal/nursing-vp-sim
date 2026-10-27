"""院校管理（租户）—— 平台级端点，仅 ``school_manage``（超级管理员）可用。

院校本身是隔离边界，所以这里**不做**按院校收窄：能进这个模块的人就是跨院校的人。
删除只允许删空院校（有班级或账号 → 409），避免把别人的数据变成孤儿行。
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, File, Request, Response, UploadFile
from sqlalchemy import func

from core.audit import (
    ACTION_SCHOOL_CREATED,
    ACTION_SCHOOL_DELETED,
    ACTION_SCHOOL_UPDATED,
    TARGET_TYPE_SCHOOL,
    record,
)
from core.deps import DbSession
from core.exceptions import NotFoundError, ValidationError
from core.images import ImageRejected, normalize_image
from core.security import require_permission
from core.unit_of_work import unit_of_work
from models import Class, Role, RolePermission, School, User
from schemas import DeleteSchoolResponse, SchoolCreate, SchoolResponse, SchoolUpdate

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

router = APIRouter(prefix="/schools", tags=["院校管理"])
#: 院徽的公开读取：`<img src>` 无法携带 Authorization，且院徽本身就是对外标识。
#: 只暴露院校标识本身（不返回账号/成绩），没有院徽就是 404。
public_router = APIRouter(prefix="/api/schools", tags=["院校"])

_PlatformAdmin = Annotated[User, Depends(require_permission("school_manage"))]

#: 院徽长边上限：页首标识，512 足够；再大只是体积。
LOGO_MAX_EDGE = 512
MAX_LOGO_UPLOAD_BYTES = 2 * 1024 * 1024


def _normalize_theme_color(value: str | None) -> str | None:
    """空白 = 清除（回到平台默认品牌色）；格式由 schema 正则把关。"""
    color = (value or "").strip()
    return color or None


class SchoolService:
    def __init__(self, db: Session):
        self.db = db

    def _counts(self) -> dict[str, dict[int, int]]:
        """三类计数一次算完（列表用；单条走 `_view`，口径同源）。"""
        classes = {
            row[0]: row[1]
            for row in self.db.query(Class.school_id, func.count(Class.id)).group_by(Class.school_id).all()
        }
        users = {
            row[0]: row[1]
            for row in self.db.query(User.school_id, func.count(User.id))
            .filter(User.school_id.isnot(None))
            .group_by(User.school_id)
            .all()
        }
        # 院校管理员 = 该院校里持有 user_manage 的账号；没有它等于没人能管这所院校
        admins = {
            row[0]: row[1]
            for row in self.db.query(User.school_id, func.count(func.distinct(User.id)))
            .join(Role, Role.id == User.role_id)
            .join(RolePermission, RolePermission.role_id == Role.id)
            .filter(User.school_id.isnot(None), RolePermission.permission == "user_manage")
            .group_by(User.school_id)
            .all()
        }
        return {"class": classes, "user": users, "admin": admins}

    def list_all(self) -> list[SchoolResponse]:
        rows = self.db.query(School).order_by(School.name).all()
        counts = self._counts()
        return [self._view(s, counts) for s in rows]

    def create(self, name: str, theme_color: str | None = None, *, request: Request | None = None) -> SchoolResponse:
        name = name.strip()
        if self.db.query(School.id).filter(School.name == name).first():
            raise ValidationError("院校名称已存在")
        with unit_of_work(self.db, conflict_detail="院校名称已存在"):
            school = School(name=name, theme_color=_normalize_theme_color(theme_color))
            self.db.add(school)
            self.db.flush()
            record(
                self.db,
                action=ACTION_SCHOOL_CREATED,
                target_type=TARGET_TYPE_SCHOOL,
                target_id=school.id,
                target_label=name,
                request=request,
                payload={"name": name, "theme_color": school.theme_color},
            )
        return self._view(school)

    def update(
        self,
        school_id: int,
        name: str | None,
        theme_color: str | None = None,
        *,
        request: Request | None = None,
    ) -> SchoolResponse:
        """改名 / 改主题色。``theme_color=None`` = 不修改，``""`` = 恢复平台默认品牌色。"""
        school = self._get(school_id)
        new_name = name.strip() if name is not None else school.name
        next_color = school.theme_color if theme_color is None else _normalize_theme_color(theme_color)
        if next_color == school.theme_color and new_name == school.name:
            return self._view(school)
        if (
            new_name != school.name
            and self.db.query(School.id).filter(School.name == new_name, School.id != school.id).first()
        ):
            raise ValidationError("院校名称已存在")
        before = {"name": school.name, "theme_color": school.theme_color}
        with unit_of_work(self.db, conflict_detail="院校名称已存在"):
            school.name = new_name
            school.theme_color = next_color
            self.db.flush()
            record(
                self.db,
                action=ACTION_SCHOOL_UPDATED,
                target_type=TARGET_TYPE_SCHOOL,
                target_id=school.id,
                target_label=new_name,
                request=request,
                payload={
                    "name": {"before": before["name"], "after": new_name},
                    "theme_color": {"before": before["theme_color"], "after": next_color},
                },
            )
        return self._view(school)

    def set_logo(self, school_id: int, data: bytes, *, request: Request | None = None) -> SchoolResponse:
        """上传/替换院徽：任意来源图片 → 归一化后的 WebP 入库（剥元数据、限尺寸）。"""
        school = self._get(school_id)
        if len(data) > MAX_LOGO_UPLOAD_BYTES:
            raise ValidationError(f"图片过大（上限 {MAX_LOGO_UPLOAD_BYTES // 1024 // 1024}MB）")
        try:
            normalized, mime = normalize_image(data, max_edge=LOGO_MAX_EDGE)
        except ImageRejected as exc:
            raise ValidationError(str(exc)) from exc
        with unit_of_work(self.db, conflict_detail="院徽保存失败"):
            school.logo = normalized
            school.logo_mime = mime
            school.logo_updated_at = datetime.now(UTC)
            self.db.flush()
            record(
                self.db,
                action=ACTION_SCHOOL_UPDATED,
                target_type=TARGET_TYPE_SCHOOL,
                target_id=school.id,
                target_label=school.name,
                request=request,
                payload={"logo": {"bytes": len(normalized)}},
            )
        return self._view(school)

    def clear_logo(self, school_id: int, *, request: Request | None = None) -> SchoolResponse:
        school = self._get(school_id)
        if school.logo is None:
            return self._view(school)
        with unit_of_work(self.db, conflict_detail="院徽移除失败"):
            school.logo = None
            school.logo_mime = None
            school.logo_updated_at = datetime.now(UTC)
            self.db.flush()
            record(
                self.db,
                action=ACTION_SCHOOL_UPDATED,
                target_type=TARGET_TYPE_SCHOOL,
                target_id=school.id,
                target_label=school.name,
                request=request,
                payload={"logo": {"removed": True}},
            )
        return self._view(school)

    def read_logo(self, school_id: int) -> tuple[bytes, str]:
        """公开读：院徽本来就是对外标识。没有院徽 → 404（不返回空图占位）。"""
        school = self.db.get(School, school_id)
        if school is None or school.logo is None:
            raise NotFoundError("该院校没有院徽")
        return bytes(school.logo), school.logo_mime or "image/webp"

    def delete(self, school_id: int, *, request: Request | None = None) -> str:
        school = self._get(school_id)
        classes = self.db.query(func.count(Class.id)).filter(Class.school_id == school_id).scalar() or 0
        users = self.db.query(func.count(User.id)).filter(User.school_id == school_id).scalar() or 0
        if classes or users:
            raise ValidationError(f"院校「{school.name}」下仍有 {classes} 个班级、{users} 个账号，无法删除")
        name = school.name
        with unit_of_work(self.db, conflict_detail="无法删除"):
            record(
                self.db,
                action=ACTION_SCHOOL_DELETED,
                target_type=TARGET_TYPE_SCHOOL,
                target_id=school_id,
                target_label=name,
                request=request,
                payload={"name": name},
            )
            self.db.delete(school)
            self.db.flush()
        return name

    def _get(self, school_id: int) -> School:
        school = self.db.get(School, school_id)
        if school is None:
            raise NotFoundError("院校不存在")
        return school

    def _view(self, school: School, counts: dict[str, dict[int, int]] | None = None) -> SchoolResponse:
        counts = counts or self._counts()
        return SchoolResponse(
            id=school.id,
            name=school.name,
            class_count=counts["class"].get(school.id, 0),
            user_count=counts["user"].get(school.id, 0),
            admin_count=counts["admin"].get(school.id, 0),
            theme_color=school.theme_color,
            has_logo=school.logo is not None,
            logo_updated_at=school.logo_updated_at,
            created_at=school.created_at,
        )


@router.get("", response_model=list[SchoolResponse])
def list_schools(current_user: _PlatformAdmin, db: DbSession):
    return SchoolService(db).list_all()


@router.post("", response_model=SchoolResponse)
def create_school(body: SchoolCreate, current_user: _PlatformAdmin, db: DbSession, request: Request):
    return SchoolService(db).create(body.name, body.theme_color, request=request)


@router.put("/{school_id}", response_model=SchoolResponse)
def update_school(school_id: int, body: SchoolUpdate, current_user: _PlatformAdmin, db: DbSession, request: Request):
    return SchoolService(db).update(school_id, body.name, body.theme_color, request=request)


@router.post("/{school_id}/logo", response_model=SchoolResponse)
async def upload_school_logo(
    school_id: int,
    current_user: _PlatformAdmin,
    db: DbSession,
    request: Request,
    file: UploadFile = File(...),
):
    """上传/替换院徽（可选）。入口先归一：剥元数据、限长边、统一 WebP。"""
    data = await file.read()
    return SchoolService(db).set_logo(school_id, data, request=request)


@router.delete("/{school_id}/logo", response_model=SchoolResponse)
def delete_school_logo(school_id: int, current_user: _PlatformAdmin, db: DbSession, request: Request):
    return SchoolService(db).clear_logo(school_id, request=request)


@router.delete("/{school_id}", response_model=DeleteSchoolResponse)
def delete_school(school_id: int, current_user: _PlatformAdmin, db: DbSession, request: Request):
    name = SchoolService(db).delete(school_id, request=request)
    return DeleteSchoolResponse(message=f"已删除院校 {name}")


@public_router.get("/{school_id}/logo")
def read_school_logo(school_id: int, db: DbSession) -> Response:
    """院徽公开读（品牌标识；`<img src>` 带不了 Authorization）。

    URL 上带 `?v=<logo_updated_at>` 做版本号，换图即换 URL；这里给一天缓存。
    """
    content, mime = SchoolService(db).read_logo(school_id)
    return Response(content=content, media_type=mime, headers={"Cache-Control": "public, max-age=86400"})
