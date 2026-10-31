"""把客户端 AB 里的 Sprite/Texture2D 全部导出成 PNG，并打印名字与尺寸，便于挑图。

用法：
  python tools/probe-ab.py --bundle "arts/ui/stage/[uc]homeentry.ab"
  python tools/probe-ab.py --bundle <相对 AB\Windows 的路径> --list-only
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / 'local-extract'))
import aklz4  # noqa: F401,E402  (注册 LZ4AK 解压器)

import UnityPy  # noqa: E402

AB = Path(r'C:\Program Files\Hypergryph Launcher\games\Arknights\Arknights_Data\StreamingAssets\AB\Windows')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--bundle', required=True, help='相对 AB\\Windows 的路径，或绝对路径')
    ap.add_argument('--out', default='')
    ap.add_argument('--list-only', action='store_true')
    args = ap.parse_args()

    path = Path(args.bundle)
    if not path.is_absolute():
        path = AB / args.bundle
    if not path.exists():
        print('缺 bundle：' + str(path), file=sys.stderr)
        return 1

    env = UnityPy.load(str(path))
    out = Path(args.out) if args.out else Path(__file__).resolve().parents[1] / '.cache' / 'ab-dump' / path.stem.replace('[uc]', '')
    out.mkdir(parents=True, exist_ok=True)

    n = 0
    for obj in env.objects:
        if obj.type.name not in ('Texture2D', 'Sprite'):
            continue
        try:
            data = obj.read()
            name = str(getattr(data, 'm_Name', '') or '')
            img = getattr(data, 'image', None)
            if img is None:
                continue
            if args.list_only:
                print('%-46s %sx%s' % (name, img.width, img.height))
                continue
            safe = ''.join(c if c not in '\\/:*?"<>|' else '_' for c in name) or ('obj_' + str(obj.path_id))
            dest = out / (safe + '.png')
            img.save(dest)
            print('%-46s %sx%s' % (safe + '.png', img.width, img.height))
            n += 1
        except Exception as exc:  # noqa: BLE001
            print('!! %s: %s' % (obj.type.name, exc))
    if not args.list_only:
        print('导出 %d 张 → %s' % (n, out))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
