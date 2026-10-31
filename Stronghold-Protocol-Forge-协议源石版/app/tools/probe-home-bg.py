"""列出官方主页背景 bundle 里的对象，并试导其中的贴图。

用法：
  python tools/probe-home-bg.py --bundle bg_rogue_4            # 只看对象清单
  python tools/probe-home-bg.py --bundle bg_rogue_4 --dump     # 同时导出所有 Texture2D
"""
from __future__ import annotations

import argparse
import collections
import sys
from pathlib import Path

# 官方客户端 AB 用自定义 LZ4AK（Unity 记为 LZHAM）：先让仓库里的解码器把自己注册进 UnityPy。
sys.path.insert(0, str(Path(__file__).resolve().parent / 'local-extract'))
import aklz4  # noqa: F401,E402  (import 的副作用就是注册解压器)

import UnityPy  # noqa: E402

AB = Path(r'C:\Program Files\Hypergryph Launcher\games\Arknights\Arknights_Data\StreamingAssets\AB\Windows')
WRAP = AB / 'arts' / 'ui' / 'homebackground' / 'wrapper'


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--bundle', default='bg_rogue_4')
    ap.add_argument('--dump', action='store_true')
    ap.add_argument('--out', default='')
    args = ap.parse_args()

    path = WRAP / (args.bundle + '.ab')
    if not path.exists():
        print('缺 bundle：' + str(path), file=sys.stderr)
        return 1

    env = UnityPy.load(str(path))
    kinds = collections.Counter()
    objects = []
    for obj in env.objects:
        kinds[obj.type.name] += 1
        objects.append(obj)

    print(args.bundle + '.ab  ' + '%.2f MB' % (path.stat().st_size / 1048576))
    for k, v in sorted(kinds.items(), key=lambda x: -x[1]):
        print('  %-28s %d' % (k, v))

    out = Path(args.out) if args.out else Path(__file__).resolve().parents[1] / '.cache' / 'home-bg' / args.bundle
    if args.dump:
        out.mkdir(parents=True, exist_ok=True)
        n = 0
        for obj in objects:
            if obj.type.name not in ('Texture2D', 'Sprite'):
                continue
            try:
                data = obj.read()
                name = getattr(data, 'm_Name', '') or getattr(data, 'name', '') or ('obj_' + str(obj.path_id))
                img = data.image if hasattr(data, 'image') else None
                if img is None:
                    continue
                safe = ''.join(c if c not in '\\/:*?"<>|' else '_' for c in str(name))
                dest = out / (safe + '.png')
                img.save(dest)
                print('  -> %-46s %sx%s' % (dest.name, img.width, img.height))
                n += 1
            except Exception as exc:  # noqa: BLE001 - 探测脚本，坏一个不影响其它
                print('  !! %s: %s' % (obj.type.name, exc))
        print('导出 %d 张贴图到 %s' % (n, out))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
