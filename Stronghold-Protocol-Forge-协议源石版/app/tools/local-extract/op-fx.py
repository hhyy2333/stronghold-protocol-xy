#!/usr/bin/env python3
"""tools/local-extract/op-fx.py — 从本机《明日方舟》客户端里导出某个干员 / 敌人的战斗特效贴图。

为什么需要它：官方干员 / 首领的攻击、技能特效贴图（丰川祥子的「音符」、黑蛇不息恶火的火球）只在客户端里，
网页素材站没有。
- 丰川祥子的音符在 `battle/prefabs/effects/oblvns.ab` 的 oblvns_skin_04 / oblvns_skin_05 两张 256x256 贴图上，
  每张是 2x2 共 4 个字形。`--prefix note` 按象限切开、裁掉透明边，存成 note_1..8.png；
- 「不死的黑蛇」不息恶火的火球贴图在 `pkgrps/btl_pfb_fx_enemy_1.ab` 的 bsnake_04 / 05 / 07 / 10 / 12 / 16 上。
  `--prefix bsnake --no-split` 原样存成 bsnake_04.png … bsnake_16.png（每张就是一个完整字形，不能切）。

存到 public/assets/local/fx/（git-ignored）；客户端 public/js/render/fx/system.js 的 NOTE_TEXTURE_URLS /
SNAKE_FIRE_TEXTURE_URLS 读它们，缺席时退回 FX 图集里画的那颗。

用法：
  python tools/local-extract/op-fx.py --bundle <AB 路径> --out public/assets/local/fx --prefix note \
      --texture oblvns_skin_04 --texture oblvns_skin_05
  python tools/local-extract/op-fx.py --bundle <AB 路径> --out public/assets/local/fx --prefix bsnake --no-split \
      --texture bsnake_

依赖：UnityPy（requirements.txt）与同目录的 aklz4.py（官方客户端的 LZ4AK 解压）。
UnityPy 装在哪里由 --pythonpath 或环境变量 PYTHONPATH 指定（本机是 <工作区>\.akpy\pylib 或系统 Python 的 site-packages）。
"""
import argparse, os, sys

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bundle', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--prefix', default='note')
    ap.add_argument('--texture', action='append', default=[])
    ap.add_argument('--quadrants', type=int, default=4)
    # --no-split: each texture IS one sprite (the enemy effect sheets), saved as <prefix>_<its own name suffix>.png
    ap.add_argument('--no-split', action='store_true')
    args = ap.parse_args()
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import aklz4  # noqa: F401  (registers the LZ4AK decoder)
    import UnityPy
    from PIL import Image
    env = UnityPy.load(args.bundle)
    wanted = [w.lower() for w in args.texture]
    os.makedirs(args.out, exist_ok=True)
    n = 1
    for obj in env.objects:
        if obj.type.name != 'Texture2D':
            continue
        d = obj.read()
        name = (getattr(d, 'm_Name', None) or getattr(d, 'name', '') or '').lower()
        if wanted and not any(w in name for w in wanted):
            continue
        img = getattr(d, 'image', None)
        if img is None:
            continue
        img = img.convert('RGBA')
        if args.no_split:
            # the object's own name (the data names the sheet by it): bsnake_04.png, bsnake_16.png …
            own = (getattr(d, 'm_Name', None) or '') or ('%s_%d' % (args.prefix, n))
            out = os.path.join(args.out, '%s.png' % own)
            img.save(out)
            print(out, img.size)
            n += 1
            continue
        w, h = img.size
        cols = 2 if args.quadrants >= 4 else 1
        rows = 2 if args.quadrants >= 4 else 1
        for i in range(cols * rows):
            box = ((i % cols) * w // cols, (i // cols) * h // rows, (i % cols) * w // cols + w // cols, (i // cols) * h // rows + h // rows)
            q = img.crop(box)
            bb = q.getbbox()
            q = q.crop(bb) if bb else q
            out = os.path.join(args.out, '%s_%d.png' % (args.prefix, n))
            q.save(out)
            print(out, q.size)
            n += 1

if __name__ == '__main__':
    main()