#!/usr/bin/env python3
"""tools/local-extract/read-mono-fields.py — 用一份 il2cpp 的 DummyDll 读 prefab 上 MonoBehaviour 的字段值。

背景：客户端是 IL2CPP，prefab 里的 MonoBehaviour 只有序列化字节，没有 typetree 就读不出字段名与取值。
UnityPy 可以用 Assembly-CSharp.dll（Il2CppDumper / Cpp2IL 产出的 DummyDll 就够，字段名 + 声明顺序齐全）
生成 typetree，于是 `projectile_chr_oblvns_talent` 这类 prefab 的 speed / 转向权重 / 存在时间就能直接打印。

用法：
  python tools/local-extract/read-mono-fields.py --assembly <DummyDll 目录> --bundle <AB 文件> \
      --object projectile_chr_oblvns_talent [--filter speed]

依赖：UnityPy>=1.25（requirements.txt）+ 同目录 aklz4.py。
"""
import argparse, os, sys

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--assembly', required=True, help='DummyDll / Assembly-CSharp.dll 所在目录')
    ap.add_argument('--bundle', required=True)
    ap.add_argument('--object', required=True, help='GameObject / MonoBehaviour 名')
    ap.add_argument('--filter', default='', help='只打印名字里含这个子串的字段')
    ap.add_argument('--pythonpath', default='')
    args = ap.parse_args()
    if args.pythonpath:
        sys.path.insert(0, args.pythonpath)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import aklz4  # noqa: F401  (LZ4AK decoder)
    import UnityPy
    from UnityPy.helpers import TypeTreeHelper

    # 用 DummyDll 生成 typetree（UnityPy 1.25: TypeTreeGenerator 需要程序集目录）
    gen = None
    for name in ('TypeTreeGenerator', 'TypeTreeGenerator2'):
        cls = getattr(TypeTreeHelper, name, None)
        if cls is None:
            continue
        try:
            gen = cls(args.assembly)
            break
        except Exception as e:
            print('[warn] %s failed: %s' % (name, str(e)[:120]))
    if gen is None:
        print('no typetree generator available in this UnityPy build')
        return 2
    gen.load_all()
    TypeTreeHelper.TypeTreeGenerator = type(gen)  # 让 MonoBehaviour 读取时用它
    TypeTreeHelper.TypeTreeGeneratorInstance = gen

    env = UnityPy.load(args.bundle)
    want = args.object
    hit = False
    for obj in env.objects:
        if obj.type.name != 'GameObject':
            continue
        go = obj.read()
        if (getattr(go, 'm_Name', '') or '') != want:
            continue
        hit = True
        print('=== GameObject', want)
        for c in go.m_Component:
            ptr = c.component if hasattr(c, 'component') else c
            try:
                comp = ptr.read()
            except Exception as e:
                print('  <read failed>', str(e)[:80]); continue
            t = type(comp).__name__
            print('  --', t)
            if t != 'MonoBehaviour':
                continue
            try:
                tree = ptr.read_typetree()
            except Exception as e:
                print('     typetree failed:', str(e)[:120]); continue
            for k, v in tree.items():
                if args.filter and args.filter.lower() not in k.lower():
                    continue
                if isinstance(v, (int, float, str, bool)) or v is None:
                    print('     %-28s %s' % (k, v))
    if not hit:
        print('object not found:', want)
        return 1
    return 0

if __name__ == '__main__':
    sys.exit(main())