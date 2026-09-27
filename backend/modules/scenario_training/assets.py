"""场景资源：pack 声明的资源 + **库里的字节**（管理侧上传 / 安装播种）+ 预留的绘画者 AI。

- 运行时唯一来源 = `st_assets`（`(pack_key, asset_id)` → 字节 + mime）；
- 仓库里的 `assets/<pack_key>/...` 只是**播种来源**（作者用文件准备，安装时入库），
  运行时不读文件系统——与反馈图片同构，部署与环境无关。
- 绘画者 AI 现场生成的图也入库（`st_generated_assets`，对外引用 `gen:<行 id>`）：
  曾用磁盘缓存，容器重建即丢、管理端看不见，现改为**库里一行 = 一张图**，删除即回收。
- 绘画者 AI 仍是**可注入接口**：未接入时诚实跳过，不生成占位假图。
"""

from __future__ import annotations

import hashlib
import io
import pathlib
from typing import TYPE_CHECKING, Any, Protocol

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from models.scenario_training import StAsset, StGeneratedAsset

from .schema import ScenarioPack

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

ASSETS_ROOT = pathlib.Path(__file__).resolve().parent / "assets"
GENERATED_PREFIX = "gen:"
MAX_ASSET_BYTES = 8 * 1024 * 1024
ALLOWED_MIME = ("image/png", "image/jpeg", "image/webp", "image/gif")
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


def generated_asset_id(row_id: int) -> str:
    """生成物的对外引用：`gen:<行 id>`（字节在库；行删掉即取不到图，不留孤儿文件）。"""
    return f"{GENERATED_PREFIX}{row_id}"


def _generated_row_id(asset_id: str) -> int:
    raw = asset_id.removeprefix(GENERATED_PREFIX)
    if not raw.isdigit():  # 只认库里行的 id，别的一律当不存在
        raise AssetNotFound(f"生成物 id 非法：{asset_id}")
    return int(raw)


def is_generated(asset_id: str) -> bool:
    return asset_id.startswith(GENERATED_PREFIX)


def get_generated_asset(db: Session, row_id: int) -> StGeneratedAsset | None:
    return db.get(StGeneratedAsset, row_id)


def find_generated_by_prompt(
    db: Session, *, session_id: int, prompt: str, kind: str = "image"
) -> StGeneratedAsset | None:
    """本会话已为这条提示词生成过的行——同提示词不必再花一次生成成本。"""
    return (
        db.execute(
            select(StGeneratedAsset)
            .where(
                StGeneratedAsset.session_id == session_id,
                StGeneratedAsset.kind == kind,
                StGeneratedAsset.prompt == prompt,
            )
            .order_by(StGeneratedAsset.id)
        )
        .scalars()
        .first()
    )


def _generated_by_sha(db: Session, *, session_id: int, digest: str) -> StGeneratedAsset | None:
    return db.execute(
        select(StGeneratedAsset).where(StGeneratedAsset.session_id == session_id, StGeneratedAsset.sha256 == digest)
    ).scalar_one_or_none()


def store_generated_asset(
    db: Session,
    *,
    session_id: int,
    pack_key: str,
    pack_revision_id: int,
    prompt: str,
    data: bytes,
    kind: str = "image",
) -> StGeneratedAsset:
    """把 DM 现场生成的一份字节入库（**同会话同字节只留一行**），返回落库行。

    入库前与上传同一套归一（统一 WebP、剥元数据、限幅、只留首帧），因此生成图也是干净字节。
    并发下同一份字节被另一条路径先写入时，靠唯一约束兜住：取回已有行，
    不把整个回合打成 409（`begin_nested` 只回滚这一次插入，外层事务照常进行）。
    """
    if len(data) > MAX_ASSET_BYTES:
        raise AssetRejected(f"生成物过大：{len(data)} 字节（上限 {MAX_ASSET_BYTES}）")
    normalized, stored_mime = normalize_image(data)
    digest = hashlib.sha256(normalized).hexdigest()
    row = _generated_by_sha(db, session_id=session_id, digest=digest)
    if row is not None:
        return row

    row = StGeneratedAsset(
        session_id=session_id,
        pack_key=pack_key,
        pack_revision_id=pack_revision_id,
        kind=kind,
        prompt=prompt,
        mime_type=stored_mime,
        file_size=len(normalized),
        sha256=digest,
        content=normalized,
    )
    try:
        with db.begin_nested():
            db.add(row)
    except IntegrityError:
        existing = _generated_by_sha(db, session_id=session_id, digest=digest)
        if existing is None:  # 不是去重冲突（例如会话不存在）→ 照实抛出
            raise
        return existing
    return row


def list_generated(
    db: Session,
    *,
    pack_key: str,
    limit: int,
    offset: int,
    session_id: int | None = None,
) -> tuple[list[StGeneratedAsset], int]:
    """管理侧清单：按 pack（可选再按会话）过滤后分页；`total` 是过滤后的总数。"""
    query = select(StGeneratedAsset).where(StGeneratedAsset.pack_key == pack_key)
    if session_id is not None:
        query = query.where(StGeneratedAsset.session_id == session_id)
    total = db.execute(select(func.count()).select_from(query.subquery())).scalar() or 0
    rows = db.execute(query.order_by(StGeneratedAsset.id.desc()).limit(limit).offset(offset)).scalars().all()
    return list(rows), int(total)


def delete_generated_asset(db: Session, row_id: int) -> bool:
    row = get_generated_asset(db, row_id)
    if row is None:
        return False
    db.delete(row)
    db.flush()
    return True


def describe_generated(row: StGeneratedAsset) -> dict[str, Any]:
    """管理侧列表项：只有元数据，**不含字节**（列表要能翻页，不能顺带传几 MB 图）。"""
    return {
        "id": row.id,
        "session_id": row.session_id,
        "pack_key": row.pack_key,
        "pack_revision_id": row.pack_revision_id,
        "kind": row.kind,
        "prompt": row.prompt,
        "mime_type": row.mime_type,
        "file_size": row.file_size,
        "sha256": row.sha256,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


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
    """取一份资源的字节与媒体类型（生成图与上传资源**都在库里**，运行时不读文件系统）。"""
    if is_generated(asset_id):
        row = db.get(StGeneratedAsset, _generated_row_id(asset_id))
        if row is None or row.pack_key != pack.key:  # 生成物只服务它所属的 pack
            raise AssetNotFound(f"生成物不存在：{asset_id}")
        return bytes(row.content), row.mime_type
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
                "suggest_when": asset.suggest_when,
                "filename": row.filename if row else "",
                "mime_type": row.mime_type if row else "",
                "file_size": row.file_size if row else 0,
                "uploaded": row is not None,
            }
        )
    return out


class ImageProvider(Protocol):
    """绘画者 AI 的最小接口：给一段提示词，返回图片字节。"""

    async def generate(self, prompt: str) -> bytes: ...


def get_image_provider(app_state: object) -> ImageProvider | None:
    provider = getattr(app_state, "scenario_image_provider", None)
    return provider if provider is not None else None
