#!/usr/bin/env python3
"""从扁平插画立绘里抽出 rig 几何（归一化 0..1），输出可直接贴进 engine/rig.ts 的条目。

扁平插画是规则版式，所以按颜色类定位即可，不需要视觉模型：
  - 眼睛：图像里两块大小相近、左右对称的深色小团（眉毛是细长条，按长宽比排除）；
  - 嘴：眼线以下、以脸中线为中心的连续深暖色横线（按行取最长连续段，取得最上面的一行）；
  - 肤色/唇色：脸部主色与唇线中值。

用法（在 frontend/ 下）：
    uv run --with pillow --with numpy python scripts/extract-rigs.py            # 打印
    uv run --with pillow --with numpy python scripts/extract-rigs.py --overlay /tmp/rig  # 同时出标注图

写实照片（realistic/*.png）不在自动范围内：那两张是人工标定后写进 rig.ts 的。
"""

from __future__ import annotations

import argparse
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

SRC = os.path.join(os.path.dirname(__file__), "..", "src", "assets", "avatars", "simple")


def label(mask: np.ndarray, min_px: int = 20) -> list[np.ndarray]:
    """4 连通域；返回每个连通域的像素坐标数组。"""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    out: list[np.ndarray] = []
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if seen[y0, x0]:
            continue
        seen[y0, x0] = True
        stack = [(y0, x0)]
        pixels = []
        while stack:
            y, x = stack.pop()
            pixels.append((y, x))
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        if len(pixels) >= min_px:
            out.append(np.array(pixels))
    return out


def find_eyes(rgb: np.ndarray, lum: np.ndarray, face_centre: float) -> tuple[dict, dict] | None:
    h, w = lum.shape
    candidates = []
    for comp in label(lum < 95):
        y0, x0 = comp.min(axis=0)
        y1, x1 = comp.max(axis=0)
        bw, bh = x1 - x0 + 1, y1 - y0 + 1
        if not (0.03 * w <= bw <= 0.08 * w and 0.04 * h <= bh <= 0.09 * h):
            continue
        if len(comp) < 0.0012 * w * h:
            continue
        candidates.append({"cx": (x0 + x1) / 2, "cy": (y0 + y1) / 2, "rx": bw / 2, "ry": bh / 2})
    for a in candidates:
        for b in candidates:
            if a["cx"] >= b["cx"] or abs(a["cy"] - b["cy"]) > 0.02 * h:
                continue
            if abs((a["cx"] + b["cx"]) / 2 - face_centre) > 0.03 * w:
                continue
            if abs((a["cx"] - face_centre) + (b["cx"] - face_centre)) > 0.03 * w:
                continue
            return a, b
    return None


def find_mouth(
    rgb: np.ndarray, eye_y: float, face_bottom: float, centre: float, eye_sep: float
) -> tuple[dict, np.ndarray] | None:
    """唇线：逐行找最长连续段，取最上面一行（下巴阴影是更大的一块，但它在下面）。"""
    h, w = rgb.shape[:2]
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    mask = (r > g + 22) & (r > b + 40) & (lum < 215) & (lum > 70)
    half = int(0.45 * eye_sep)
    cx = int(centre)
    rows = []
    for y in range(int(eye_y + 0.15 * (face_bottom - eye_y)), min(h, int(face_bottom) + 3)):
        seg = mask[y, cx - half : cx + half]
        if not seg.any():
            continue
        idx = np.nonzero(seg)[0]
        runs = np.split(idx, np.nonzero(np.diff(idx) > 1)[0] + 1)
        best = max(runs, key=len)
        if len(best) >= 0.35 * eye_sep:
            rows.append((y, int(cx - half + best[0]), int(cx - half + best[-1])))
    if not rows:
        return None
    y_top = rows[0][0]
    x0 = min(r[1] for r in rows[:3])
    x1 = max(r[2] for r in rows[:3])
    y_bot = max(r[0] for r in rows if r[0] < y_top + 0.05 * h)
    lip = np.median(rgb[rows[0][0], rows[0][1] : rows[0][2] + 1].reshape(-1, 3), axis=0)
    return {"x": (x0 + x1) / 2 / w, "y": y_top / h, "w": (x1 - x0 + 1) / w, "h": (y_bot - y_top + 1) / h}, lip


def extract(path: str) -> tuple[str, Image.Image, tuple[dict, dict, dict]] | None:
    im = Image.open(path).convert("RGB")
    rgb = np.asarray(im).astype(np.float32)
    h, w = rgb.shape[:2]
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    warm = (r > 180) & (r > g + 12) & (g > b + 8)
    ys, xs = np.nonzero(warm)
    if len(ys) < 100:
        return None
    fx0, fx1 = np.percentile(xs, [2, 98])
    fy0, fy1 = np.percentile(ys, [1, 99])
    centre = (fx0 + fx1) / 2

    eyes = find_eyes(rgb, lum, centre)
    if eyes is None:
        return None
    (eye_l, eye_r) = eyes
    eye_y = (eye_l["cy"] + eye_r["cy"]) / 2
    mouth = find_mouth(rgb, eye_y, fy1, centre, eye_r["cx"] - eye_l["cx"])
    if mouth is None:
        return None
    (mouth, lip) = mouth
    skin = np.median(rgb[warm].reshape(-1, 3), axis=0)
    key = os.path.basename(path).replace(".png", "")
    return (
        f'\t{key}: {{ profile: "flat", '
        f'eyeL: {{ x: {eye_l["cx"] / w:.3f}, y: {eye_l["cy"] / h:.3f}, rx: {eye_l["rx"] / w:.4f}, ry: {eye_l["ry"] / h:.4f} }}, '
        f'eyeR: {{ x: {eye_r["cx"] / w:.3f}, y: {eye_r["cy"] / h:.3f}, rx: {eye_r["rx"] / w:.4f}, ry: {eye_r["ry"] / h:.4f} }}, '
        f'mouth: {{ x: {mouth["x"]:.3f}, y: {mouth["y"]:.3f}, w: {mouth["w"]:.3f}, h: {mouth["h"]:.3f} }}, '
        f'skin: "#{int(skin[0]):02x}{int(skin[1]):02x}{int(skin[2]):02x}", '
        f'lip: "#{int(lip[0]):02x}{int(lip[1]):02x}{int(lip[2]):02x}" }},'
    ), im, (eye_l, eye_r, mouth)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--overlay", help="把标注图写到这个目录，人工核对用")
    args = ap.parse_args()

    flat = os.path.abspath(SRC)
    for name in sorted(os.listdir(flat)):
        if not name.endswith(".png"):
            continue
        result = extract(os.path.join(flat, name))
        if result is None:
            print(f"!! {name}: 未能定位五官，需人工检查", file=sys.stderr)
            continue
        line, im, (eye_l, eye_r, mouth) = result
        print(line)
        if args.overlay:
            draw = ImageDraw.Draw(im)
            w, h = im.size
            for eye in (eye_l, eye_r):
                draw.ellipse(
                    [eye["cx"] - eye["rx"], eye["cy"] - eye["ry"], eye["cx"] + eye["rx"], eye["cy"] + eye["ry"]],
                    outline=(0, 220, 0),
                    width=2,
                )
            draw.rectangle(
                [mouth["x"] * w - mouth["w"] * w / 2, mouth["y"] * h,
                 mouth["x"] * w + mouth["w"] * w / 2, mouth["y"] * h + mouth["h"] * h],
                outline=(255, 0, 0),
                width=2,
            )
            os.makedirs(args.overlay, exist_ok=True)
            im.save(os.path.join(args.overlay, name))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
