# -*- coding: utf-8 -*-
"""生成 sai2工作台 的应用图标（柑橘切面）。

设计：橙皮外环 + 白色果肉层 + 8 片彩虹扇形 + 白色中心
几何全部由参数算出，不依赖任何图形库；4 倍超采样后降采样，保证小尺寸不糊。

用法：
    python tools/make_icon.py

产出：
    build/icon.png            1024×1024 主图（窗口图标 / 文档用）
    build/icons/icon-{n}.png  16~512 各尺寸
    build/icon.ico            多尺寸 ICO（打包用，electron-builder 默认读这个）
    build/preview-icon.png    预览图（浅/深底 + 各尺寸对照），仅用于自检
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
ICONS = BUILD / "icons"

# ---------------------------------------------------------------- 几何参数
# 全部以「外圆半径 = 1」为单位，改这几个数就能调整比例
R_RIM = 1.000  # 描边圆（略深，让图标在浅色/深色背景上都有边界）
R_RIND = 0.980  # 橙皮色圆
R_PITH = 0.885  # 白色果肉层外沿
R_WEDGE = 0.775  # 扇形外沿（与白色果肉层之间留出可见的果肉环）
R_CENTER = 0.152  # 中心白色圆
SECTORS = 8  # 扇形数量
GAP_DEG = 4.0  # 每个扇形两侧留出的白色缝隙（度）

# ---------------------------------------------------------------- 配色
C_RIM = (224, 114, 31, 255)  # 外描边：深橙
C_RIND = (244, 149, 74, 255)  # 橙皮
C_PITH = (255, 255, 255, 255)  # 果肉 / 分隔线
# 从 12 点开始顺时针
C_WEDGES = [
    (240, 69, 126, 255),  # 玫红
    (244, 98, 58, 255),  # 橘红
    (247, 154, 62, 255),  # 橙黄
    (247, 210, 62, 255),  # 柠檬黄
    (107, 194, 74, 255),  # 青绿
    (53, 198, 214, 255),  # 天蓝
    (78, 123, 232, 255),  # 蓝
    (169, 107, 224, 255),  # 紫
]

MASTER = 1024
SS = 4  # 超采样倍数
SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512]


def render_master() -> Image.Image:
    px = MASTER * SS
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = px / 2
    rmax = px / 2

    def disc(ratio: float, color: tuple[int, ...]) -> None:
        r = rmax * ratio
        d.ellipse([c - r, c - r, c + r, c + r], fill=color)

    disc(R_RIM, C_RIM)
    disc(R_RIND, C_RIND)
    disc(R_PITH, C_PITH)

    step = 360 / SECTORS
    rw = rmax * R_WEDGE
    for i, color in enumerate(C_WEDGES):
        # Pillow 角度：0° 指向 3 点方向，顺时针递增；-90° 即 12 点
        a0 = -90 + i * step + GAP_DEG
        a1 = -90 + (i + 1) * step - GAP_DEG
        d.pieslice([c - rw, c - rw, c + rw, c + rw], start=a0, end=a1, fill=color)

    # 中心白圆：把扇形汇聚点盖掉，形成干净的果心
    disc(R_CENTER, C_PITH)

    return img.resize((MASTER, MASTER), Image.LANCZOS)


def save_all(master: Image.Image) -> None:
    ICONS.mkdir(parents=True, exist_ok=True)
    master.save(BUILD / "icon.png")

    for size in SIZES:
        img = master.resize((size, size), Image.LANCZOS)
        img.save(ICONS / f"icon-{size}.png")

    # ICO 里嵌入 16~256，Windows 会按场景自动挑（任务栏/开始菜单/资源管理器）
    master.save(
        BUILD / "icon.ico",
        sizes=[(n, n) for n in (16, 20, 24, 32, 40, 48, 64, 128, 256)],
    )


def make_preview(master: Image.Image) -> None:
    """自检图：上排浅底/深底看边界，下排各尺寸看是否还认得出。"""
    pad = 22
    cell = 168  # 上排大图格子
    slot = 120  # 下排尺寸阶梯的固定格宽，避免小尺寸挤在一起

    bgs = [(38, 41, 47), (255, 255, 255), (236, 238, 242)]
    ladder = [16, 24, 32, 48, 64, 96]
    w = pad + max(len(bgs) * (cell + pad), len(ladder) * (slot + pad))
    h = pad + (cell + pad) + (slot + 30)

    board = Image.new("RGB", (w, h), (246, 247, 249))
    d = ImageDraw.Draw(board)

    for i, bg in enumerate(bgs):
        x = pad + i * (cell + pad)
        d.rounded_rectangle([x, pad, x + cell, pad + cell], radius=18, fill=bg)
        big = master.resize((cell - 44, cell - 44), Image.LANCZOS)
        board.paste(big, (x + 22, pad + 22), big)

    # 尺寸阶梯：每个都放大到同一显示尺寸（NEAREST），便于横向比较清晰度
    y = pad + cell + pad
    for i, s in enumerate(ladder):
        im = master.resize((s, s), Image.LANCZOS)
        big = im.resize((slot - 16, slot - 16), Image.NEAREST if s <= 48 else Image.LANCZOS)
        x = pad + i * (slot + pad) + (slot - big.width) // 2
        board.paste(big, (x, y + (slot - big.height) // 2), big)
        d.text((pad + i * (slot + pad) + 6, y + slot + 2), f"{s}px", fill=(90, 96, 106))

    board.save(BUILD / "preview-icon.png")


def main() -> None:
    master = render_master()
    save_all(master)
    make_preview(master)

    print(f"OK  master {MASTER}x{MASTER}")
    print(f"    {BUILD / 'icon.png'}")
    print(f"    {BUILD / 'icon.ico'}  ({', '.join(str(s) for s in [16, 24, 32, 48, 64, 128, 256])})")
    print(f"    {ICONS}/ 共 {len(SIZES)} 个尺寸")
    print(f"    {BUILD / 'preview-icon.png'}（自检用）")


if __name__ == "__main__":
    main()
