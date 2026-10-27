"""图片归一化的唯一实现（任意来源图片 → 干净、尺寸受限的 WebP）。

上传入口只有两处（场景资源、院校院徽），两处都先走这里：
1. 先把 Orientation 用掉（手机竖拍照片不转正会歪 90°），再让元数据整体消失；
2. 去 EXIF/XMP/IPTC（GPS、设备、拍摄时间等——对业务无意义且有隐私风险）；
3. 长边限到调用方给的 `max_edge`；
4. 统一 WebP（含 alpha），只保留首帧（动图退化为静态）。
"""

from __future__ import annotations

import io

from PIL import Image, ImageOps, UnidentifiedImageError

WEBP_QUALITY = 82


class ImageRejected(RuntimeError):
    """不是可用图片 / 像素规模过大 —— 调用方映射成 422。"""


def _has_alpha(image: Image.Image) -> bool:
    return image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info)


def normalize_image(data: bytes, *, max_edge: int = 1600, quality: int = WEBP_QUALITY) -> tuple[bytes, str]:
    """归一化图片字节，返回 ``(webp_bytes, "image/webp")``。"""
    try:
        with Image.open(io.BytesIO(data)) as raw:
            frames = getattr(raw, "n_frames", 1)
            image = ImageOps.exif_transpose(raw)  # 先把方向应用到像素
            if frames > 1:
                image.seek(0)
            image = image.convert("RGBA" if _has_alpha(image) else "RGB")
            image.thumbnail((max_edge, max_edge))
            out = io.BytesIO()
            image.save(out, format="WEBP", quality=quality, method=6)
            return out.getvalue(), "image/webp"
    except Image.DecompressionBombError as exc:
        raise ImageRejected("图片像素过大") from exc
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ImageRejected(f"不是可用图片：{type(exc).__name__}") from exc
