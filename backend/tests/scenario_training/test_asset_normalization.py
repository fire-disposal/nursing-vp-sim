"""上传归一化：格式统一、**隐私字段裁剪**、方向转正、限幅、只留首帧（纯逻辑，不连库）。"""

from __future__ import annotations

import io

import pytest
from PIL import Image

from modules.scenario_training.assets import (
    MAX_EDGE,
    AssetRejected,
    normalize_image,
)


def _jpeg(*, size: tuple[int, int] = (240, 120), orientation: int | None = None, with_private: bool = True) -> bytes:
    image = Image.new("RGB", size, (28, 34, 44))
    exif = Image.Exif()
    if with_private:
        exif[0x010F] = "TestCam"  # Make
        exif[0x0110] = "Model-X"  # Model
        exif[0x0132] = "2026:09:27 22:00:00"  # DateTime
        exif[0x8825] = {1: "N", 2: (39.0, 54.0, 0.0), 3: "E", 4: (116.0, 23.0, 0.0)}  # GPS
    if orientation is not None:
        exif[0x0112] = orientation
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", exif=exif)
    return buffer.getvalue()


def test_private_metadata_is_stripped_entirely() -> None:
    """GPS/设备/时间等隐私字段：整个 EXIF 都不该留下（不是"少几项"）。"""
    source = _jpeg()
    assert Image.open(io.BytesIO(source)).getexif(), "构造的测试图本身应当带 EXIF"

    data, mime = normalize_image(source)
    assert mime == "image/webp"
    assert data[:4] == b"RIFF"
    assert data[8:12] == b"WEBP"

    with Image.open(io.BytesIO(data)) as out:
        assert dict(out.getexif()) == {}
        assert out.info.get("exif") is None


def test_orientation_is_applied_before_stripping() -> None:
    """竖拍照片（Orientation=6）必须先转正再剥元数据。"""
    source = _jpeg(size=(240, 120), orientation=6)
    data, _mime = normalize_image(source)
    with Image.open(io.BytesIO(data)) as out:
        assert out.size == (120, 240), "方向没有被应用（会显示成歪的）"
        assert dict(out.getexif()) == {}


def test_long_edge_is_capped() -> None:
    source = _jpeg(size=(3200, 800))
    data, _mime = normalize_image(source)
    with Image.open(io.BytesIO(data)) as out:
        assert max(out.size) == MAX_EDGE
        assert out.size[0] / out.size[1] == pytest.approx(4.0, rel=0.01)


def test_animation_is_flattened_to_first_frame() -> None:
    frames = [Image.new("RGB", (60, 40), color) for color in ((200, 0, 0), (0, 200, 0))]
    buffer = io.BytesIO()
    frames[0].save(buffer, "GIF", save_all=True, append_images=frames[1:], duration=100, loop=0)
    assert Image.open(io.BytesIO(buffer.getvalue())).n_frames == 2

    data, _mime = normalize_image(buffer.getvalue())
    with Image.open(io.BytesIO(data)) as out:
        assert getattr(out, "n_frames", 1) == 1


def test_transparency_survives_as_alpha() -> None:
    source = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    buffer = io.BytesIO()
    source.save(buffer, "PNG")
    data, _mime = normalize_image(buffer.getvalue())
    with Image.open(io.BytesIO(data)) as out:
        assert out.mode in ("RGBA", "RGBa")
        assert out.getpixel((5, 5))[3] == 0


def test_non_image_payload_is_rejected() -> None:
    with pytest.raises(AssetRejected):
        normalize_image(b"<html>not an image</html>")
