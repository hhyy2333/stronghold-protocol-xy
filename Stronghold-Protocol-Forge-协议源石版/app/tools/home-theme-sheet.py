#!/usr/bin/env python3
"""把官方主页大厅（hometheme）的左右两半拼成一张横版大厅主视觉。

官方主界面背景（arts/ui/homebackground/wrapper/bg_<theme>_1.ab）在客户端里是左右两半贴图：
bg_<theme>_left.png + bg_<theme>_right.png，各 912x1024，运行时按视口宽度左右各铺一块。
这里用 Pillow 预拼成一张 1824x1024 的横版，前端直接 background-size: cover 用，
省掉运行时算位置，也避免接缝露白。

注意：两半都是 **RGBA**（边缘有透明）。拼接时铺在深色底上再合成，避免透明边缘透出白底。

用法：
  python tools/home-theme-sheet.py                     # 默认 start（始发 / rogue_3）
  python tools/home-theme-sheet.py --theme star        # 星迹 / p3r_1
  python tools/home-theme-sheet.py --check             # 只校验输入是否齐全
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'public' / 'assets' / 'local' / 'ui' / 'hometheme'

# 输出 id -> 客户端 bundle 名（bg_<stem>_left / bg_<stem>_right）
THEMES = {
    'start': 'rogue_3',   # 始发：雪原冰湖 + 天环（业主 2026-10-26 指定）
    'star': 'p3r_1',      # 星迹：蓝丝绒厅堂 + 金色天文仪
    'lonetrail': 'lonetrail_1',  # 孤星：灰色厅堂（第一张截图那套）
}
# 拼接底色的世界色：与大厅 .lobby-hub 的 #050909 一致，透明边缘不会亮
BACKDROP = (5, 9, 9)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--theme', default='start', choices=sorted(THEMES))
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()

    stem = THEMES[args.theme]
    left = SRC / ('bg_' + stem + '_left.png')
    right = SRC / ('bg_' + stem + '_right.png')
    out = SRC / ('bg_' + args.theme + '.png')

    for p in (left, right):
        if not p.exists():
            print('缺输入：' + str(p), file=sys.stderr)
            return 1
    if args.check:
        print('ok: ' + left.name + ' / ' + right.name)
        return 0

    l_img = Image.open(left).convert('RGBA')
    r_img = Image.open(right).convert('RGBA')
    if l_img.size != r_img.size:
        print('两半尺寸不一致：%s vs %s' % (l_img.size, r_img.size), file=sys.stderr)
        return 1

    w, h = l_img.size
    out_img = Image.new('RGB', (w * 2, h), BACKDROP)
    for img, x in ((l_img, 0), (r_img, w)):
        layer = Image.new('RGBA', (w, h), BACKDROP + (255,))
        layer.alpha_composite(img)     # 透明边缘压在底色上，不留白
        out_img.paste(layer.convert('RGB'), (x, 0))

    out_img.save(out, 'PNG', optimize=True)
    print('写出 %s  %dx%d  %.2f MB' % (out.name, w * 2, h, out.stat().st_size / 1048576))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
