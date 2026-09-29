"""场景资源：pack 声明的资源 + **库里的字节**（管理侧上传 / 安装播种）。

- 运行时唯一来源 = `st_assets`（`(pack_key, asset_id)` → 字节 + mime）；
- 仓库里的 `assets/<pack_key>/...` 只是**播种来源**（作者用文件准备，安装时入库），
  运行时不读文件系统——与反馈图片同构，部署与环境无关。
"""

from __future__ import annotations

import io
import pathlib
from typing import TYPE_CHECKING, Any

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select

from models.scenario_training import StAsset

from .schema import ScenarioPack

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

ASSETS_ROOT = pathlib.Path(__file__).resolve().parent / "assets"
MAX_ASSET_BYTES = 8 * 1024 * 1024

#: 文件后缀 → MIME 的**唯一来源**（`router.py` 的回退与 `seed_from_pack` 的播种都用它）
SUFFIX_MIME: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}
ALLOWED_MIME = tuple(dict.fromkeys(SUFFIX_MIME.values()))


def suffix_mime(filename: str | None) -> str:
    """上传时 `content_type` 缺失的回退：按后缀取 MIME（认不出交给 `store_asset` 拒绝）。"""
    suffix = "." + (filename or "").rsplit(".", 1)[-1].lower()
    return SUFFIX_MIME.get(suffix, "application/octet-stream")


MAX_EDGE = 1600  # 场景图长边上限（再大对展示无意义，只增体积）
WEBP_QUALITY = 82


def normalize_image(data: bytes) -> tuple[bytes, str]:
    """上传唯一入口：把任意来源图片归一成**干净**的 WebP。

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
    """写入或覆盖一份资源字节（管理侧上传用；与反馈图片一样存库）。

    **入库前一律归一**：统一 WebP、剥掉全部元数据、长边限幅、只留首帧。
    """
    if len(data) > MAX_ASSET_BYTES:
        raise AssetRejected(f"资源过大：{len(data)} 字节（上限 {MAX_ASSET_BYTES}）")
    if mime_type not in ALLOWED_MIME:
        raise AssetRejected(f"不支持的资源类型：{mime_type}")
    normalized, stored_mime = normalize_image(data)
    row = get_asset(db, pack_key, asset_id)
    if row is None:
        row = StAsset(
            pack_key=pack_key,
            asset_id=asset_id,
            filename=filename,
            mime_type=stored_mime,
            file_size=len(normalized),
            content=normalized,
        )
        db.add(row)
    else:
        row.filename = filename
        row.mime_type = stored_mime
        row.file_size = len(normalized)
        row.content = normalized
    db.flush()
    return row


def delete_asset(db: Session, pack_key: str, asset_id: str) -> bool:
    row = get_asset(db, pack_key, asset_id)
    if row is None:
        return False
    db.delete(row)
    db.flush()
    return True


def seed_from_pack(db: Session, pack: ScenarioPack, *, overwrite: bool = False) -> list[str]:
    """把 pack 声明的、仓库里有文件的资源播种入库（幂等；缺文件时跳过并返回 id 列表）。"""
    missing: list[str] = []
    root = ASSETS_ROOT / pack.key
    for asset in pack.assets:
        if not asset.path:
            missing.append(asset.id)
            continue
        path = (root / asset.path).resolve()
        if root.resolve() not in path.parents or not path.is_file():
            missing.append(asset.id)
            continue
        existing = get_asset(db, pack.key, asset.id)
        if existing is not None and not overwrite:
            continue
        mime = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".gif": "image/gif",
        }.get(path.suffix.lower(), "application/octet-stream")
        store_asset(
            db,
            pack_key=pack.key,
            asset_id=asset.id,
            filename=path.name,
            mime_type=mime,
            data=path.read_bytes(),
        )
    return missing


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
