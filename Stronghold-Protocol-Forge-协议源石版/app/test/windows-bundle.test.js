// test/windows-bundle.test.js — Windows 便携包脚本里那几处「写错就会毁掉一次打包」的纯函数。
//
// 打包本身要联网下载官方 Node、还要 `npm ci`，不适合放进单元测试；这里盯住这些：
//   * `--out` 指向仓库自己或它的上级时，`--force` 会 `rm -rf` 掉仓库 —— 必须直接拒绝；
//   * 路径比较要经得起大小写（Windows / macOS 默认不区分）、符号链接、8.3 短名；
//   * `--force` 只肯删「空目录」或「上一次打的便携包」，认不出来就不许动；
//   * 素材是整树复制的，点开头的条目（打包机器的 .DS_Store）与符号链接不该跟着进包；
//   * 按清单复制时，缺失的源文件跳过而不是抛错（素材可能还没下载）；
//   * 包内说明的措辞：不能声称「不访问外网」（Google Fonts 外链没改），`--no-node` 时也不能说不用装 Node；
//   * 发行标识（app\package.json 的 release）：格式、来源、盖章位置，畸形值必须拒绝出包；
//   * `app\MANIFEST.json`：枚举规则与 server/update.js 的 inManifest 一致，写出来必须能被 parseManifest 读回；
//   * `node.exe` 的 sha256 核对（NODE_PIN.exeSha256）：对不上就不许出包。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

/** 在 dir 下按仓库相对路径写一个文件（自动建目录）。 */
async function put(dir, rel, text) {
  const abs = path.join(dir, ...rel.split('/'));
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, text);
}

describe('make-windows-bundle.mjs: --out 不能指向仓库自己或它的上级', () => {
  test('仓库本身与它的上级目录都要拒绝', async () => {
    const { outDirIsUnsafe } = await mod('scripts/make-windows-bundle.mjs');
    assert.equal(outDirIsUnsafe(ROOT), true, '仓库本身');
    assert.equal(outDirIsUnsafe(path.dirname(ROOT)), true, '仓库的上一级');
    assert.equal(outDirIsUnsafe(path.resolve(path.dirname(ROOT), '..')), true, '再上一级');
    assert.equal(outDirIsUnsafe(path.join(ROOT, '..', path.basename(ROOT))), true, '写成 .. 绕一圈也还是仓库自己');
  });

  test('仓库之外的目录放行（默认产物就是仓库的兄弟目录）', async () => {
    const { outDirIsUnsafe } = await mod('scripts/make-windows-bundle.mjs');
    assert.equal(outDirIsUnsafe(path.join(path.dirname(ROOT), 'Stronghold-Protocol-Windows')), false, '默认产物位置');
    assert.equal(outDirIsUnsafe(path.join(os.tmpdir(), 'sp-bundle-out')), false, '临时目录');
    // 指向仓库**内部**是允许的：只是产物会出现在 git status 里，不会删掉仓库。
    assert.equal(outDirIsUnsafe(path.join(ROOT, 'dist-win')), false, '仓库内的子目录');
  });

  test('大小写不同也算同一个目录（Windows / macOS 的文件系统默认不区分大小写）', async () => {
    const { outDirIsUnsafe } = await mod('scripts/make-windows-bundle.mjs');
    // Linux 的默认文件系统区分大小写：`/HOME/X` 就是另一个目录，放行才对。
    const sameThing = process.platform !== 'linux';
    assert.equal(outDirIsUnsafe(ROOT.toUpperCase()), sameThing, `大写写法的仓库路径（${ROOT.toUpperCase()}）`);
    assert.equal(outDirIsUnsafe(ROOT.replace(/\//g, path.sep).toLowerCase()), sameThing, '全小写写法');
  });

  test('经过符号链接的路径会被认出来（macOS 的 /tmp 就是指向 /private/tmp 的链接）', async () => {
    const { outDirIsUnsafe } = await mod('scripts/make-windows-bundle.mjs');
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-link-'));
    try {
      const real = path.join(base, 'real', 'Stronghold-Protocol');
      await fsp.mkdir(real, { recursive: true });
      const link = path.join(base, 'link');
      try {
        // Windows 上目录符号链接要管理员权限，junction 不用；其它平台用 dir。
        await fsp.symlink(path.join(base, 'real'), link, process.platform === 'win32' ? 'junction' : 'dir');
      } catch {
        return;   // 建不出链接的环境（缺权限 / 缺支持）就跳过这一条
      }
      assert.equal(outDirIsUnsafe(path.join(link, 'Stronghold-Protocol'), real), true,
        '同一个目录，一条路径经过符号链接也要认出来');
      assert.equal(outDirIsUnsafe(path.join(link, 'Stronghold-Protocol', 'dist'), real), false, '仓库内部仍然放行');
    } finally {
      await fsp.rm(base, { recursive: true, force: true });
    }
  });
});

describe('make-windows-bundle.mjs: --force 只肯删空目录或上一次的包', () => {
  test('不存在 / 空目录 / 上一次打的包 → 可以删', async () => {
    const { forceDeleteVerdict } = await mod('scripts/make-windows-bundle.mjs');
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-force-'));
    try {
      assert.equal(forceDeleteVerdict(path.join(base, 'nope')), 'missing');

      const empty = path.join(base, 'empty');
      await fsp.mkdir(empty);
      assert.equal(forceDeleteVerdict(empty), 'empty');

      const bundle = path.join(base, 'bundle');
      await fsp.mkdir(path.join(bundle, 'app'), { recursive: true });
      await fsp.writeFile(path.join(bundle, 'README-开箱即用.md'), '# x');
      await fsp.writeFile(path.join(bundle, 'LICENSE'), 'x');
      assert.equal(forceDeleteVerdict(bundle), 'bundle');
    } finally {
      await fsp.rm(base, { recursive: true, force: true });
    }
  });

  test('有东西但不是上次的包 → 一律拒绝（包括桌面、仓库、只有半份的产物）', async () => {
    const { forceDeleteVerdict } = await mod('scripts/make-windows-bundle.mjs');
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-force2-'));
    try {
      const desktop = path.join(base, 'Desktop');
      await fsp.mkdir(desktop);
      await fsp.writeFile(path.join(desktop, '重要文件.txt'), 'x');
      assert.equal(forceDeleteVerdict(desktop), 'refuse', '别人的目录不能删');

      assert.equal(forceDeleteVerdict(ROOT), 'refuse', '仓库根不是便携包');
      assert.equal(forceDeleteVerdict(path.dirname(ROOT)), 'refuse', '仓库的上级也不是');

      const half = path.join(base, 'half');
      await fsp.mkdir(path.join(half, 'app'), { recursive: true });
      assert.equal(forceDeleteVerdict(half), 'refuse', '只有 app 没有说明：可能是别人的目录，不删');
      const half2 = path.join(base, 'half2');
      await fsp.mkdir(half2);
      await fsp.writeFile(path.join(half2, 'README-开箱即用.md'), '# x');
      assert.equal(forceDeleteVerdict(half2), 'refuse', '只有说明没有 app：同样不删');

      const file = path.join(base, 'afile');
      await fsp.writeFile(file, 'x');
      assert.equal(forceDeleteVerdict(file), 'refuse', '同名文件不是目录，不删');
    } finally {
      await fsp.rm(base, { recursive: true, force: true });
    }
  });
});

describe('make-windows-bundle.mjs: 包内说明的措辞', () => {
  test('不再声称「不访问外网」，改成联网 / 断网两种情况都讲清', async () => {
    const { bundleReadme } = await mod('scripts/make-windows-bundle.mjs');
    const r = bundleReadme({ version: 'v22.23.3', withNode: true });
    assert.ok(!/不访问外网/.test(r), 'index.html 的 Google Fonts 外链没改，不能说这个包不访问外网');
    assert.match(r, /不联网也能玩/, '断网可用要写清楚');
    assert.match(r, /Google Fonts/, '联网时会去 Google Fonts 加载字体，要如实说明');
    assert.match(r, /断网/, '断网时的回退也要写');
    assert.match(r, /不需要安装 Node/);
    assert.match(r, /node\\node\.exe/);
  });

  test('每条授权要点都在（素材归原权利人 / 不适用 GPL / 不单独再分发 / 可要求删除 / 无担保）', async () => {
    const { bundleReadme } = await mod('scripts/make-windows-bundle.mjs');
    for (const withNode of [true, false]) {
      const r = bundleReadme({ version: 'v22.23.3', withNode });
      assert.match(r, /版权归原权利人所有/, `withNode=${withNode}`);
      assert.match(r, /不适用.*GPL/, `withNode=${withNode}`);
      assert.match(r, /单独再分发/, `withNode=${withNode}`);
      assert.match(r, /立即删除/, `withNode=${withNode}`);
      assert.match(r, /不提供任何担保/, `withNode=${withNode}`);
      assert.match(r, /严禁任何形式的盈利/, `withNode=${withNode}`);
      assert.ok(!/本包按 GPL/.test(r), `withNode=${withNode}: 不能写「本包按 GPL-3.0-or-later 分发」`);
    }
  });

  test('--no-node 时不再写「不需要安装 Node」，目录结构也不列 node\\', async () => {
    const { bundleReadme } = await mod('scripts/make-windows-bundle.mjs');
    const r = bundleReadme({ version: 'v22.23.3', withNode: false });
    assert.ok(!/不需要安装 Node/.test(r), '没带便携 Node 就不能说不用装');
    assert.match(r, /没有带便携版 Node/, '要明确告诉玩家自己去装 Node 22/24');
    assert.ok(!/node\\node\.exe/.test(r), '目录结构里不该出现 node.exe');
    assert.ok(!/LICENSE-node\.txt/.test(r), '也不该提 node\\LICENSE-node.txt');
  });
});

describe('make-windows-bundle.mjs: PowerShell 单引号转义', () => {
  test("路径里的 ' 要写成 ''（否则 Expand-Archive 那条命令会被截断）", async () => {
    const { psSingleQuote } = await mod('scripts/make-windows-bundle.mjs');
    assert.equal(psSingleQuote('C:\\tmp\\node.zip'), "'C:\\tmp\\node.zip'");
    assert.equal(psSingleQuote("C:\\it's here\\node.zip"), "'C:\\it''s here\\node.zip'");
    assert.equal(psSingleQuote("a'b'c"), "'a''b''c'");
  });
});

describe('make-windows-bundle.mjs: 素材整树复制', () => {  test('copyDir 跳过点开头的条目（打包机器自己的 .DS_Store）与符号链接', async () => {
    const { copyDir } = await mod('scripts/make-windows-bundle.mjs');
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-copydir-'));
    try {
      const src = path.join(base, 'src');
      const dst = path.join(base, 'dst');
      await fsp.mkdir(path.join(src, 'sub', '.hidden'), { recursive: true });
      await fsp.writeFile(path.join(src, 'a.png'), 'a');
      await fsp.writeFile(path.join(src, '.DS_Store'), 'junk');
      await fsp.writeFile(path.join(src, 'sub', 'b.png'), 'bb');
      await fsp.writeFile(path.join(src, 'sub', '.keep'), 'junk');
      await fsp.writeFile(path.join(src, 'sub', '.hidden', 'c.png'), 'ccc');

      const r = await copyDir(src, dst);
      assert.equal(r.files, 2, '只数 a.png 与 sub/b.png');
      assert.equal(fs.existsSync(path.join(dst, 'a.png')), true);
      assert.equal(fs.existsSync(path.join(dst, 'sub', 'b.png')), true);
      assert.equal(fs.existsSync(path.join(dst, '.DS_Store')), false, '.DS_Store 不进包');
      assert.equal(fs.existsSync(path.join(dst, 'sub', '.keep')), false);
      assert.equal(fs.existsSync(path.join(dst, 'sub', '.hidden')), false, '点开头的目录整棵跳过');

      // 符号链接：Windows 上建链接需要权限，建不出来就跳过这条（复制逻辑本身仍然跳过链接）。
      let linked = false;
      try {
        await fsp.symlink(path.join(src, 'a.png'), path.join(src, 'link.png'));
        linked = true;
      } catch { /* 没有权限就算了 */ }
      if (linked) {
        const dst2 = path.join(base, 'dst2');
        await copyDir(src, dst2);
        assert.equal(fs.existsSync(path.join(dst2, 'link.png')), false, '符号链接不复制（目标可能指向仓库外）');
      }
    } finally {
      await fsp.rm(base, { recursive: true, force: true });
    }
  });

  test('copyFiles 跳过不存在的文件，其余照常复制', async () => {
    const { copyFiles } = await mod('scripts/make-windows-bundle.mjs');
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-copyfiles-'));
    try {
      const src = path.join(base, 'src');
      const dst = path.join(base, 'dst');
      await fsp.mkdir(path.join(src, 'data'), { recursive: true });
      await fsp.mkdir(path.join(src, 'server'), { recursive: true });
      await fsp.writeFile(path.join(src, 'server', 'index.js'), 'code');
      await fsp.writeFile(path.join(src, 'data', 'local-assets.json'), '{}');

      const r = await copyFiles(['server/index.js', 'data/local-assets.json', 'public/assets/missing.png'], dst, src);
      assert.equal(r.files, 2, '缺失的那个被跳过');
      assert.equal(fs.existsSync(path.join(dst, 'server', 'index.js')), true, '目录自动建出来');
      assert.equal(fs.existsSync(path.join(dst, 'data', 'local-assets.json')), true);
      assert.equal(fs.existsSync(path.join(dst, 'public')), false, '没有文件就不该建空目录');
    } finally {
      await fsp.rm(base, { recursive: true, force: true });
    }
  });
});

// 0.3.0 的便携包曾经**打出来是坏的**：打包清单只取 `git ls-files`（已跟踪文件），而那一版（协议源石）
// 整个是未提交交付的，于是 shared/hextech.js、server/match/hextech.js、data/hextech.json 等 6 个运行
// 必需文件没进包 —— 打包时一声不响，玩家双击启动才 ERR_MODULE_NOT_FOUND。
// 现在清单是「跟踪的 + 未提交但没被 .gitignore 忽略的」，同时保住原来的安全性质：进 .gitignore 的本机
// 文件（.env / .venv / services.env.cmd / logs / node_modules …）依然进不来。
describe('make-windows-bundle.mjs: 打包清单要带上未提交的代码（0.3.0 便携包缺文件的回归）', () => {
  test('清单用 --others --exclude-standard，未跟踪但未忽略的文件在里面', async () => {
    const { bundledFiles, uncommittedFilesForTest } = await mod('scripts/make-windows-bundle.mjs');
    const list = bundledFiles();
    assert.ok(list.length > 100, `清单非空（${list.length} 个文件）`);

    // 这份清单与 `--exclude-standard` 的定义一致：忽略掉的文件一个都不在
    const ignored = spawnSync('git', ['-C', ROOT, 'ls-files', '-z', '--others', '--ignored', '--exclude-standard'], { maxBuffer: 256 * 1024 * 1024 });
    if (!ignored.error && ignored.status === 0) {
      const ignoredSet = new Set(ignored.stdout.toString('utf8').split('\0').filter(Boolean));
      const leaked = list.filter((f) => ignoredSet.has(f));
      assert.deepEqual(leaked, [], '被 .gitignore 忽略的文件绝不能进清单');
    }

    // 曾经的漏网之鱼：这些是 0.3.0 的未跟踪文件，只要它们存在于工作区就必须在清单里
    for (const rel of ['shared/hextech.js', 'server/match/hextech.js', 'server/sim/content/hextech.js', 'data/hextech.json']) {
      if (!fs.existsSync(path.join(ROOT, rel))) continue;      // 换到已提交的树上就没有这条
      assert.ok(list.includes(rel), `${rel} 必须在打包清单里（未提交也必须带）`);
    }
    // 未提交清单本身可用（受限沙箱里管道会被拒，走临时文件兜底也不该是空的）
    const uncommitted = uncommittedFilesForTest();
    assert.ok(Array.isArray(uncommitted));
  });

  test('本机文件即使存在也进不了清单（.gitignore 仍是那道闸）', async () => {
    const { bundledFiles } = await mod('scripts/make-windows-bundle.mjs');
    const list = bundledFiles();
    const host = list.filter((f) => /(^|\/)(\.env|\.venv[^/]*|\.claude|node_modules|\.cache|logs|service\.env\.cmd|local-assets\.json)(\/|$)/.test(f));
    // data/local-assets.json 是**素材清单**，由打包脚本单独添加（不在 git 清单里），这里只看泄漏
    const leaked = host.filter((f) => f !== 'data/local-assets.json');
    assert.deepEqual(leaked, [], `本机文件不该进清单：${leaked.join(', ')}`);
  });
});

// 便携包从前既没有 app\MANIFEST.json 也没有发行标识：server/update.js 那一整套校验（与 docs/DEPLOY.md 描述的
// 更新机制）对一个装好的便携包无事可做。以下三组盯住补上的部分。
describe('make-windows-bundle.mjs: 发行标识（app\\package.json 的 release）', () => {
  test('默认取仓库 package.json 的 release，形状是 <本树版本>-<上游版本>', async () => {
    const { releaseIdentity, RELEASE_RE, repoPackage } = await mod('scripts/make-windows-bundle.mjs');
    const pkg = repoPackage();
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/, '本树版本');
    const release = releaseIdentity();
    assert.match(release, RELEASE_RE, `release=${release}`);
    assert.ok(release.startsWith(`${pkg.version}-`), '前半段必须是本树的版本（只抬上游时 version 不变）');
    assert.equal(release, pkg.release, '仓库 package.json 的 release 字段是唯一来源');
  });

  test('畸形值、缺字段、换错版本前缀都拒绝出包', async () => {
    const { releaseIdentity } = await mod('scripts/make-windows-bundle.mjs');
    const pkg = { version: '0.3.0', release: '0.3.0-0.2.3' };
    assert.equal(releaseIdentity('1.2.3-9.9.9', { version: '1.2.3' }), '1.2.3-9.9.9', '--release 显式给出时照用');
    for (const bad of ['0.3.0', 'v0.3.0-0.2.3', '0.3.0-0.2', '0.3.0-0.2.3-', 'n/a']) {
      assert.throws(() => releaseIdentity(bad, pkg), /发行标识/, `不能接受 ${JSON.stringify(bad)}`);
    }
    assert.throws(() => releaseIdentity('0.2.9-0.2.3', pkg), /前半段/, '前半段不是本树的版本');
    assert.throws(() => releaseIdentity('', { version: '0.3.0' }), /发行标识/, 'package.json 里没有 release 字段');
    assert.equal(releaseIdentity('', pkg), pkg.release, '不给 --release 时回落到仓库的 release，而不是空值');
  });

  test('stampRelease 把 release 放在 version 之后，readRelease 读得回来；version 不一致时拒绝', async () => {
    const { stampRelease, readRelease } = await mod('scripts/make-windows-bundle.mjs');
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-release-'));
    try {
      const app = path.join(base, 'app');
      await fsp.mkdir(app);
      const file = path.join(app, 'package.json');
      await fsp.writeFile(file, `${JSON.stringify({ name: 'x', version: '0.3.0', license: 'GPL-3.0-or-later' }, null, 2)}\n`);

      stampRelease(app, '0.3.0-0.2.3', { version: '0.3.0' });
      const text = fs.readFileSync(file, 'utf8');
      assert.deepEqual(Object.keys(JSON.parse(text)), ['name', 'version', 'release', 'license'], 'release 紧跟 version');
      assert.equal(JSON.parse(text).version, '0.3.0', 'version 保持原样（test/version.test.js 要三段式 semver）');
      assert.ok(text.endsWith('\n'), '写回时保留文件末尾换行');
      assert.equal(readRelease(app), '0.3.0-0.2.3');

      assert.equal(readRelease(path.join(base, 'nope')), undefined, '读不到就没有发行标识');
      assert.throws(() => stampRelease(app, '0.3.0-0.2.3', { version: '0.4.0' }), /不一致/, '包里的代码与本仓库不一致就不能盖章');
    } finally {
      await fsp.rm(base, { recursive: true, force: true });
    }
  });
});

describe('make-windows-bundle.mjs: app\\MANIFEST.json（与发行 zip 同一套）', () => {
  test('枚举规则 = server/update.js 的 inManifest：素材与元文件不进清单，其余每个文件都有 size + sha256', async () => {
    const { manifestFor } = await mod('scripts/make-windows-bundle.mjs');
    const { digestFile } = await mod('server/update.js');
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-manifest-'));
    try {
      const dir = path.join(base, 'app');
      await put(dir, 'package.json', '{"version":"0.3.0","release":"0.3.0-0.2.3"}\n');
      await put(dir, 'server/index.js', 'export const x = 1;\n');
      await put(dir, 'docs/PLAYING.md', '# play\n');
      await put(dir, 'node_modules/ws/index.js', 'module.exports = 1;\n');
      await put(dir, 'public/vendor/pixi.min.js', '/* pixi */\n');
      // 素材归 setup 管、元文件不进清单（server/update.js 的 inManifest）
      await put(dir, 'public/assets/art/board.png', 'png');
      await put(dir, 'public/fonts/bender.woff2', 'font');
      await put(dir, 'data/assets.json', '{}');
      await put(dir, 'data/local-assets.json', '{}');
      await put(dir, 'MANIFEST.json', '{}');
      await put(dir, 'UPDATE.json', '{}');

      const m = manifestFor(dir, '0.3.0');
      assert.deepEqual([...m.files.keys()], ['docs/PLAYING.md', 'node_modules/ws/index.js', 'package.json', 'public/vendor/pixi.min.js', 'server/index.js']);
      // 同一份摘要：与 server/update.js 的 digestFile 逐字节一致
      assert.deepEqual(m.files.get('server/index.js'), digestFile(path.join(dir, 'server', 'index.js')));
      assert.equal(m.bytes, [...m.files.values()].reduce((n, d) => n + d.size, 0), 'bytes 是清单里的合计');
      assert.match(m.text, /"format":1/, '与更新机制同一个格式号');
      assert.ok(!/public\/assets/.test(m.text), '素材不进清单');
    } finally {
      await fsp.rm(base, { recursive: true, force: true });
    }
  });

  test('写出来的 MANIFEST.json 能被 server/update.js 的 parseManifest 读回（tools/package.mjs 也这么查）', async () => {
    const { writeManifest } = await mod('scripts/make-windows-bundle.mjs');
    const { parseManifest, MANIFEST_FILE } = await mod('server/update.js');
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-manifest2-'));
    try {
      const dir = path.join(base, 'app');
      await put(dir, 'package.json', '{"version":"0.3.0","release":"0.3.0-0.2.3"}\n');
      await put(dir, 'server/index.js', 'export const x = 1;\n');
      await put(dir, 'public/assets/art/board.png', 'png');

      const r = await writeManifest(dir, '0.3.0');
      assert.equal(r.count, 2, 'package.json + server/index.js');
      assert.equal(r.app, '0.3.0');
      const back = parseManifest(fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8'));
      assert.equal(back.app, '0.3.0');
      assert.deepEqual([...back.files.keys()], ['package.json', 'server/index.js']);
      assert.equal(back.files.get('server/index.js').sha256, crypto.createHash('sha256').update('export const x = 1;\n').digest('hex'));
    } finally {
      await fsp.rm(base, { recursive: true, force: true });
    }
  });

  test('发行标识必须在清单之前盖章：盖完章再写清单，摘要跟着变（doctor 才认得出这个包）', async () => {
    const { manifestFor, stampRelease } = await mod('scripts/make-windows-bundle.mjs');
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-manifest3-'));
    try {
      const dir = path.join(base, 'app');
      await put(dir, 'package.json', '{\n  "version": "0.3.0"\n}\n');
      const before = manifestFor(dir, '0.3.0').files.get('package.json');
      stampRelease(dir, '0.3.0-0.2.3', { version: '0.3.0' });
      const after = manifestFor(dir, '0.3.0').files.get('package.json');
      assert.notEqual(after.sha256, before.sha256, 'release 写进 package.json 后，清单里这个文件的摘要必须跟着变');
      assert.match(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), /"release": "0\.3\.0-0\.2\.3"/);
    } finally {
      await fsp.rm(base, { recursive: true, force: true });
    }
  });

  test('盖章 + 写清单之后的 app\\ 能被 server/update.js 的 checkInstall（npm run doctor）认成完整安装', async () => {
    const { stampRelease, writeManifest, readRelease } = await mod('scripts/make-windows-bundle.mjs');
    const { checkInstall } = await mod('server/update.js');
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-manifest4-'));
    try {
      const dir = path.join(base, 'app');
      await put(dir, 'package.json', '{\n  "version": "0.3.0"\n}\n');
      await put(dir, 'server/index.js', 'export const x = 1;\n');
      await put(dir, 'public/assets/art/board.png', 'png');      // 素材：不在清单里，也不影响核对

      stampRelease(dir, '0.3.0-0.2.3', { version: '0.3.0' });
      await writeManifest(dir, '0.3.0');

      const r = checkInstall(dir);
      assert.equal(r.state, 'ok', JSON.stringify(r));
      assert.equal(r.app, '0.3.0');
      assert.equal(r.checked, 2);
      assert.equal(readRelease(dir), '0.3.0-0.2.3', '装好的包说得出自己是什么');

      // 程序文件被改过 → doctor 报 mismatch（这正是便携包从前做不到的事：没有清单就无从核对）
      await put(dir, 'server/index.js', 'export const x = 2;\n');
      assert.equal(checkInstall(dir).state, 'mismatch');
    } finally {
      await fsp.rm(base, { recursive: true, force: true });
    }
  });
});

describe('make-windows-bundle.mjs: node.exe 的 sha256 核对（NODE_PIN）', () => {
  test('一致 → ok；不一致 → mismatch；没有钉死的 exe 哈希（--node-version）→ unpinned；文件不在 → absent', async () => {
    const { nodeExeVerdict } = await mod('scripts/make-windows-bundle.mjs');
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-nodeexe-'));
    try {
      const nodeDir = path.join(base, 'node');
      await fsp.mkdir(nodeDir);
      await fsp.writeFile(path.join(nodeDir, 'node.exe'), 'a stand-in for the interpreter');
      const good = crypto.createHash('sha256').update('a stand-in for the interpreter').digest('hex');

      assert.equal(nodeExeVerdict(nodeDir, { exeSha256: good }).state, 'ok');
      assert.equal(nodeExeVerdict(nodeDir, { exeSha256: 'a'.repeat(64) }).state, 'mismatch');
      assert.equal(nodeExeVerdict(nodeDir, null).state, 'unpinned', '换版本只按命令行给的 zip sha256 校验');
      assert.equal(nodeExeVerdict(path.join(base, 'nope'), { exeSha256: good }).state, 'absent');
      // 默认就是仓库里钉死的那一份：它是完整的（有 exeSha256），所以拿假的 exe 去比是 mismatch 而不是 unpinned
      assert.equal(nodeExeVerdict(nodeDir).state, 'mismatch', 'NODE_PIN 必须带着 exeSha256，否则这一层校验形同虚设');
    } finally {
      await fsp.rm(base, { recursive: true, force: true });
    }
  });

  test('NODE_PIN 三个字段自洽，且与仓库 .cache 里那份官方 zip 对得上（没有缓存就跳过）', async () => {
    const { NODE_PIN } = await mod('scripts/make-windows-bundle.mjs');
    assert.match(NODE_PIN.version, /^v\d+\.\d+\.\d+$/);
    assert.equal(NODE_PIN.file, `node-${NODE_PIN.version}-win-x64.zip`, 'file 字段由 version 决定');
    assert.match(NODE_PIN.sha256, /^[0-9a-f]{64}$/);
    assert.match(NODE_PIN.exeSha256, /^[0-9a-f]{64}$/, 'zip 与 exe 两层哈希都要钉死');

    const zip = path.join(ROOT, '.cache', NODE_PIN.file);
    if (!fs.existsSync(zip)) return;   // 没下载过就不比：这不是契约的一部分
    const got = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
    assert.equal(got, NODE_PIN.sha256, '.cache 里那份 zip 必须就是钉死的那一份官方 win-x64 归档');
  });
});
