"""场景资源：pack 声明的资源 + **库里的字节**（病例文件夹播种 / 管理侧上传）。

- 运行时唯一来源 = `st_assets`（`(pack_key, asset_id)` → 字节 + mime）；
- 病例文件夹的 `cases/<key>/img/` 只是**播种来源**（导入/安装时随内容一起入库），
  运行时不读文件系统——与反馈图片同构，部署与环境无关。
- **字节原样入库**：作者给的字节就是资产（导入不重编码，`mime` 按文件名后缀还原）；
  只有管理侧的**上传**入口会先归一（剥元数据 + 统一 WebP，用户裁定 2026-09-27）。
"""

from __future__ import annotations

import io
import logging
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select

from models.scenario_training import StAsset

from .schema import ScenarioPack

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

log = logging.getLogger(__name__)

MAX_ASSET_BYTES = 8 * 1024 * 1024

#: 文件后缀 → MIME 的**唯一来源**（播种/导入时按文件名还原媒体类型，`_MIME_SUFFIX` 是它的反向）
SUFFIX_MIME: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}
ALLOWED_MIME = tuple(dict.fromkeys(SUFFIX_MIME.values()))
#: 反向（导出时给"没有声明文件名"的行补一个名字）——取第一个后缀
_MIME_SUFFIX: dict[str, str] = {mime: suffix for suffix, mime in reversed(SUFFIX_MIME.items())}


def suffix_mime(filename: str | None) -> str:
    """按文件名后缀取 MIME（认不出交给 `store_asset` 拒绝）。"""
    suffix = "." + (filename or "").rsplit(".", 1)[-1].lower()
    return SUFFIX_MIME.get(suffix, "application/octet-stream")


MAX_EDGE = 1600  # 场景图长边上限（再大对展示无意义，只增体积）
WEBP_QUALITY = 82


def normalize_image(data: bytes) -> tuple[bytes, str]:
    """管理侧上传入口：把任意来源图片归一成**干净**的 WebP。

    做的四件事（用户裁定 2026-09-27「隐私字段裁剪」）：
    1. **先把 Orientation 用掉**（手机竖拍照片不转正会歪 90°），再让元数据整体消失；
    2. 去 EXIF/XMP/IPTC（GPS、设备、拍摄时间等——对场景无意义且有隐私风险）；
    3. 长边限到 `MAX_EDGE`；
    4. 统一 WebP（含 alpha），只保留首帧（动图退化为静态）。
    """
    try:
        with Image.open(io.BytesIO(data)) as raw:
            frames = getattr(raw, "n_frames", 1)
            image = ImageOps.exif_transpose(raw)  # 先把方向应用到像素
            if frames > 1:
                image.seek(0)
            image = image.convert("RGBA" if _has_alpha(image) else "RGB")
            image.thumbnail((MAX_EDGE, MAX_EDGE))
            out = io.BytesIO()
            image.save(out, format="WEBP", quality=WEBP_QUALITY, method=6)
            return out.getvalue(), "image/webp"
    except Image.DecompressionBombError as exc:
        raise AssetRejected("图片像素过大") from exc
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise AssetRejected(f"不是可用图片：{type(exc).__name__}") from exc


def _has_alpha(image: Image.Image) -> bool:
    return image.mode in ("RGBA", "LA", "PA") or (image.mode == "P" and "transparency" in image.info)


class AssetNotFound(RuntimeError):
    """资源未声明、或库里没有它的字节。"""


class AssetRejected(RuntimeError):
    """资源被拒（过大或类型不支持）。"""


def declared_ids(pack: ScenarioPack) -> set[str]:
    return {asset.id for asset in pack.assets}


def get_asset(db: Session, pack_key: str, asset_id: str) -> StAsset | None:
    return db.execute(
        select(StAsset).where(StAsset.pack_key == pack_key, StAsset.asset_id == asset_id)
    ).scalar_one_or_none()


def store_asset(
    db: Session,
    *,
    pack_key: str,
    asset_id: str,
    filename: str,
    mime_type: str,
    data: bytes,
) -> StAsset:
    """写入或覆盖一份资源字节（**字节原样**：病例文件夹 / 导入的字节就是资产）。

    归一化只在上传入口做一次（`normalize_image`），因为那是唯一"任意来源图片"的入口。
    """
    if len(data) > MAX_ASSET_BYTES:
        raise AssetRejected(f"资源过大：{len(data)} 字节（上限 {MAX_ASSET_BYTES}）")
    if mime_type not in ALLOWED_MIME:
        raise AssetRejected(f"不支持的资源类型：{mime_type}")
    row = get_asset(db, pack_key, asset_id)
    if row is None:
        row = StAsset(
            pack_key=pack_key,
            asset_id=asset_id,
            filename=filename,
            mime_type=mime_type,
            file_size=len(data),
            content=data,
        )
        db.add(row)
    else:
        row.filename = filename
        row.mime_type = mime_type
        row.file_size = len(data)
        row.content = data
    db.flush()
    return row


def delete_asset(db: Session, pack_key: str, asset_id: str) -> bool:
    row = get_asset(db, pack_key, asset_id)
    if row is None:
        return False
    db.delete(row)
    db.flush()
    return True


def seed_assets(db: Session, pack: ScenarioPack, files: Mapping[str, bytes], *, overwrite: bool = False) -> list[str]:
    """把 `img/` 的字节（文件名 → 字节）播种入库；返回**没有落地的** asset id。

    `overwrite=False`（编辑器保存/新建时的口径）：库里已有的字节不动，只报告缺哪些；
    `overwrite=True`（安装/导入：文件夹是权威来源）：按文件重新写入。
    """
    missing: list[str] = []
    for asset in pack.assets:
        data = files.get(asset.file) if asset.file else None
        if data is None:
            missing.append(asset.id)
            continue
        if get_asset(db, pack.key, asset.id) is not None and not overwrite:
            continue
        try:
            store_asset(
                db,
                pack_key=pack.key,
                asset_id=asset.id,
                filename=asset.file,
                mime_type=suffix_mime(asset.file),
                data=data,
            )
        except AssetRejected as exc:
            log.warning("病例 %s 的图片 %s 未入库：%s", pack.key, asset.id, exc)
            missing.append(asset.id)
    return missing


def asset_files(db: Session, pack: ScenarioPack) -> dict[str, bytes]:
    """病例的图片字节（导出用）：文件名 → 字节；库里没有的跳过。"""
    out: dict[str, bytes] = {}
    for asset in pack.assets:
        row = get_asset(db, pack.key, asset.id)
        if row is None:
            continue
        out[asset.file or row.filename or f"{asset.id}{_MIME_SUFFIX.get(row.mime_type, '.bin')}"] = bytes(row.content)
    return out


def read_image(db: Session, pack: ScenarioPack, asset_id: str) -> tuple[bytes, str]:
    """取一份资源的字节与媒体类型（字节在库里，运行时不读文件系统）。"""
    if asset_id not in declared_ids(pack):
        raise AssetNotFound(f"pack 未声明资源 {asset_id}")
    row = get_asset(db, pack.key, asset_id)
    if row is None:
        raise AssetNotFound(f"资源尚未上传：{asset_id}")
    return bytes(row.content), row.mime_type


def describe(db: Session, pack: ScenarioPack) -> list[dict[str, Any]]:
    """管理侧用的资源清单：声明 + 是否已有字节。"""
    out: list[dict[str, Any]] = []
    for asset in pack.assets:
        row = get_asset(db, pack.key, asset.id)
        out.append(
            {
                "id": asset.id,
                "kind": asset.kind,
                "title": asset.title,
                "alt": asset.alt,
                "filename": row.filename if row else "",
                "mime_type": row.mime_type if row else "",
                "file_size": row.file_size if row else 0,
                "uploaded": row is not None,
            }
        )
    return out
