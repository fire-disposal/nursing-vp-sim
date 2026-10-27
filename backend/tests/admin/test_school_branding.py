"""院校品牌（可选主题色 + 可选院徽）。

院徽是**可选项**：没有就是 404，不返回占位图；上传入口先归一（剥元数据、限长边、WebP）。
"""

from __future__ import annotations

import io
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest
from PIL import Image

from core.exceptions import NotFoundError, ValidationError
from models import School
from modules.admin.schools import MAX_LOGO_UPLOAD_BYTES, SchoolService

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


def _png(color: tuple[int, int, int] = (30, 120, 90), size: int = 64) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (size, size), color).save(buffer, format="PNG")
    return buffer.getvalue()


def _school(db: Session, name: str = "品牌院校") -> School:
    school = School(name=name, created_at=datetime.now(UTC))
    db.add(school)
    db.commit()
    db.refresh(school)
    return school


def test_theme_color_set_and_clear(pg_session):
    school = _school(pg_session)
    service = SchoolService(pg_session)

    view = service.update(school.id, None, "indigo")
    assert view.theme_color == "indigo"

    # 省略（None）= 不修改
    assert service.update(school.id, "改名院校", None).theme_color == "indigo"

    # 空串 = 回到平台默认
    assert service.update(school.id, None, "").theme_color is None


def test_logo_upload_read_and_clear(pg_session):
    school = _school(pg_session, "有院徽院校")
    service = SchoolService(pg_session)

    view = service.set_logo(school.id, _png())
    assert view.has_logo is True
    assert view.logo_updated_at is not None

    content, mime = service.read_logo(school.id)
    assert mime == "image/webp"
    assert content[:4] == b"RIFF"  # WebP 容器头

    service.clear_logo(school.id)
    with pytest.raises(NotFoundError):
        service.read_logo(school.id)


def test_logo_rejects_non_image_and_oversize(pg_session):
    school = _school(pg_session, "拒收院校")
    service = SchoolService(pg_session)

    with pytest.raises(ValidationError):
        service.set_logo(school.id, b"<html>not an image</html>")

    with pytest.raises(ValidationError):
        service.set_logo(school.id, b"\x00" * (MAX_LOGO_UPLOAD_BYTES + 1))
