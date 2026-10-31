// test/assets/manifest-groups.test.js — tools/local-assets-groups.mjs：本机素材清单（data/local-assets.json）必须
// 覆盖 public/assets/local/ 上真实存在的 group。
//
// 这是 0.19.36 那次事故的守卫（清单只有 130 group，少了 23 个，客户端静默退回画字/画形状）。0.19.24 已经是同一类
// 事故。所以这里锁的是判据本身：**磁盘上有文件的目录就是一个 group**，两个方向分开算 ——
//   * 磁盘有、清单没有 → unlisted，致命（出包必须失败）；
//   * 清单有、磁盘没有 → dangling，警告（指向空处）；
//   * `fx` / `fx/*` 例外（官方特效有自己的 data/local-fx.json），一个都不该报。
// 全部在 os.tmpdir() 里造素材树 + 假清单，所以 CI 上（没有 public/assets）也照样跑；
// 本机真的提取过素材时，最后一条再用真清单当正例。
// Run: node test/assets/manifest-groups.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LOCAL_DIR, LOCAL_MANIFEST, diskGroups, groupGaps, isExcludedGroup, localGroupGaps,
} from '../../tools/local-assets-groups.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * 一个临时 checkout：`files` 是相对 `public/assets/local/` 的文件路径；`groups` 是假清单的 groups（给 null 就不写
 * 清单，用来测「这台机器没有清单」）；`dirs` 只建空目录（测「空目录不算 group」）。
 * @param {string[]} files
 * @param {Record<string, unknown> | null} groups
 * @param {string[]} [dirs]
 */
function fixture(files, groups, dirs = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-local-groups-'));
  for (const f of files) {
    const abs = path.join(dir, LOCAL_DIR, f);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'x');
  }
  for (const d of dirs) fs.mkdirSync(path.join(dir, LOCAL_DIR, d), { recursive: true });
  if (groups) {
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dir, LOCAL_MANIFEST), JSON.stringify({ version: 1, count: 0, groups }));
  }
  return dir;
}

/** 一份「磁盘上有什么」的清单：group → 一个条目（体检只看 group 名，不看条目内容）。 */
const listed = (...names) => Object.fromEntries(names.map((n) => [n, { [`${n}.png`]: { path: `/assets/local/${n}.png` } }]));

/** 拿根目录跑一段，跑完删掉临时树。 */
function inFixture(files, groups, fn) {
  const dir = fixture(files, groups);
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** 同上，给 async 的 body 用（临时树要等 body 跑完才能删）。 */
async function inFixtureAsync(files, groups, fn) {
  const dir = fixture(files, groups);
  try { return await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

describe('diskGroups: 磁盘上有文件的目录才是 group', () => {
  test('一层、两层、三层都能认出来；只装子目录的中间层不是 group', () => {
    inFixture([
      'guide/autochess_handbook_1.webp', // 一层：guide
      'scene/tex/board.png', // 两层：scene/tex
      'ui/homeicon/a.png', 'ui/hometheme/b.png', // 两层：两个不同的 group
      'spine/enemy/enemy_10004_trdiam/enemy_10004_trdiam.skel', // 三层
      'spine/enemy/enemy_10004_trdiam/enemy_10004_trdiam.atlas',
      'char/char_4182_oblvns/avatar.png', // char/<id> 就是 group …
      'char/char_4182_oblvns/spine/front/char_4182_oblvns.atlas', // … 它的 spine/ 子树属于这个 group
    ], null, (dir) => {
      const got = diskGroups(path.join(dir, LOCAL_DIR));
      assert.deepEqual(Object.keys(got).sort(), [
        'char/char_4182_oblvns', 'guide', 'scene/tex', 'spine/enemy/enemy_10004_trdiam',
        'ui/homeicon', 'ui/hometheme',
      ], '已经是 group 的目录不再往下走：char/<id>/spine/front 不是新 group，spine/ 与 spine/enemy/ 也不是');
      assert.equal(got['spine/enemy/enemy_10004_trdiam'], 2, 'value = that directory\'s own file count');
    });
  });

  test('空目录（没有文件、只有子目录）算不存在', () => {
    const dir = fixture(['guide/a.webp'], null, ['ui/homeicon', 'scene/tex']);
    try {
      assert.deepEqual(diskGroups(path.join(dir, LOCAL_DIR)), { guide: 1 }, 'two empty directories are not groups');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('目录根不存在时返回空表（不抛）', () => {
    assert.deepEqual(diskGroups(path.join(os.tmpdir(), 'sp-local-groups-does-not-exist')), {});
    assert.deepEqual(diskGroups(''), {});
  });
});

describe('groupGaps: 两个方向分开算', () => {
  const TREE = ['guide/a.webp', 'scene/act1autochess_m01/scene.png', 'hextech/tier/1.png', 'ui/hometheme/t.png'];
  const ALL = ['guide', 'scene/act1autochess_m01', 'hextech/tier', 'ui/hometheme'];

  test('全覆盖 → 没有缺口', () => {
    inFixture(TREE, listed(...ALL), (dir) => {
      const g = localGroupGaps(dir);
      assert.equal(g.skipped, '');
      assert.deepEqual(g.unlisted, []);
      assert.deepEqual(g.dangling, []);
      assert.equal(g.groups, 4);
      assert.equal(g.listed, 4);
      assert.equal(g.files, 0);
    });
  });

  test('少一个 group → 正好报出那一个（致命项），带它里面的文件数', () => {
    inFixture([...TREE, 'hextech/tier/2.png'], listed('guide', 'scene/act1autochess_m01', 'ui/hometheme'), (dir) => {
      const g = localGroupGaps(dir);
      assert.deepEqual(g.unlisted, ['hextech/tier'], 'exactly the group the manifest forgot, nothing else');
      assert.deepEqual(g.dangling, []);
      assert.equal(g.files, 2, 'both files of that group');
      assert.equal(g.groups, 4);
      assert.equal(g.listed, 3);
    });
  });

  test('清单多出一个磁盘没有的 group → dangling（警告，不是致命项）', () => {
    inFixture(TREE, listed(...ALL, 'scene/act2autochess_m04'), (dir) => {
      const g = localGroupGaps(dir);
      assert.deepEqual(g.unlisted, [], 'nothing on disk is unlisted');
      assert.deepEqual(g.dangling, ['scene/act2autochess_m04'], 'the manifest points at nothing');
      assert.equal(g.listed, 5);
    });
  });

  test('两种偏差同时出现：各报各的', () => {
    inFixture(TREE, listed('guide', 'scene/act1autochess_m01', 'scene/act2autochess_m04'), (dir) => {
      const g = localGroupGaps(dir);
      assert.deepEqual(g.unlisted, ['hextech/tier', 'ui/hometheme']);
      assert.deepEqual(g.dangling, ['scene/act2autochess_m04']);
    });
  });

  test('纯函数：对任意清单对象与目录根求值，不读别的路径', () => {
    inFixture(TREE, null, (dir) => {
      const gaps = groupGaps({ groups: listed('guide') }, path.join(dir, LOCAL_DIR));
      assert.deepEqual(gaps.unlisted, ['hextech/tier', 'scene/act1autochess_m01', 'ui/hometheme']);
      assert.deepEqual(groupGaps(null, path.join(dir, LOCAL_DIR)).unlisted.length, 4, 'a manifest with no groups lists nothing');
      assert.deepEqual(groupGaps({ groups: listed('guide') }, path.join(dir, 'nowhere')), {
        unlisted: [], dangling: ['guide'], groups: 0, listed: 1, files: 0,
      });
    });
  });
});

describe('fx 例外：官方特效有自己的 data/local-fx.json', () => {
  test('fx 目录一个都没登记 → 不报（两个方向都不报）', () => {
    inFixture([
      'guide/a.webp',
      'fx/a.png', // fx 本身直接有文件
      'fx/tex/b.png', // fx/* 两层
      'fx/tex/half/c.png', // fx/* 三层
    ], listed('guide'), (dir) => {
      const g = localGroupGaps(dir);
      assert.deepEqual(g.unlisted, [], 'fx / fx/* are not gaps: extract.py drops them from this manifest on purpose');
      assert.deepEqual(g.dangling, []);
      assert.equal(g.groups, 1, 'group count excludes fx too');
      assert.deepEqual(diskGroups(path.join(dir, LOCAL_DIR)), { guide: 1 }, 'diskGroups drops the whole fx subtree');
    });
  });

  test('清单里真有 fx 条目也不算 dangling（fx 不参与这次体检）', () => {
    inFixture(['guide/a.webp', 'fx/tex/b.png'], listed('guide', 'fx', 'fx/tex'), (dir) => {
      const g = localGroupGaps(dir);
      assert.deepEqual(g.unlisted, []);
      assert.deepEqual(g.dangling, []);
      assert.equal(g.listed, 1);
    });
    assert.equal(isExcludedGroup('fx'), true);
    assert.equal(isExcludedGroup('fx/tex'), true);
    assert.equal(isExcludedGroup('fxtra'), false, 'only fx and fx/* — not every name that starts with fx');
  });
});

describe('localGroupGaps: 没有本机素材的机器优雅跳过', () => {
  test('没有 public/assets/local → skipped（不是失败）', () => {
    inFixture([], listed('guide'), (dir) => {
      const g = localGroupGaps(dir);
      assert.match(g.skipped, /public\/assets\/local/);
      assert.deepEqual(g.unlisted, []);
      assert.equal(g.dir, false);
    });
  });

  test('有素材目录、没有清单 → skipped（这台机器没提取过）', () => {
    inFixture(['guide/a.webp'], null, (dir) => {
      const g = localGroupGaps(dir);
      assert.match(g.skipped, /data\/local-assets\.json/);
      assert.deepEqual(g.unlisted, []);
      assert.equal(g.dir, true);
      assert.equal(g.manifest, false);
    });
  });

  test('清单不是合法 JSON → error（客户端连 groups 都读不到）', () => {
    inFixture(['guide/a.webp'], null, (dir) => {
      fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
      fs.writeFileSync(path.join(dir, LOCAL_MANIFEST), '{');
      const g = localGroupGaps(dir);
      assert.equal(g.skipped, '');
      assert.match(g.error, /JSON/);
    });
  });
});

// 出包闸门：同一道体检挂在 tools/package.mjs 的 plan() 上（全量包与更新包），缺口必须变成 problems 而不是
// 悄悄继续。lite 包不带本机素材，不查。
describe('出包闸门：plan() 里缺口变成 problems', () => {
  /** 一个最小的 checkout：package.json（plan 要读版本号）+ 假素材 + 假清单。 */
  const checkout = (groups) => {
    const dir = fixture(['hextech/tier/1.png'], groups);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '9.9.9', scripts: {} }));
    return dir;
  };
  const groupProblems = (problems) => problems.filter((x) => x.includes('local-asset'));

  test('清单漏了磁盘上的 group → problems 里逐条列出那个 group', async () => {
    const { plan } = await import('../../tools/package.mjs');
    const dir = checkout(listed('guide'));
    try {
      const problems = groupProblems(plan(dir, { paths: ['package.json'], allowDirty: true, scan: false, measure: false }).problems);
      assert.ok(problems.some((x) => x.includes('are not in')), problems.join('\n'));
      assert.ok(problems.some((x) => x.endsWith('hextech/tier')), `the missing group is named: ${problems.join('\n')}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('对齐时没有问题；lite 包不查（它不带本机素材）', async () => {
    const { plan } = await import('../../tools/package.mjs');
    const dir = checkout(listed('hextech/tier'));
    try {
      const opts = { paths: ['package.json'], allowDirty: true, scan: false, measure: false };
      assert.deepEqual(groupProblems(plan(dir, opts).problems), []);
      assert.equal(plan(dir, opts).localGroups.groups, 1);
      const lite = plan(dir, { ...opts, lite: true });
      assert.equal(lite.localGroups, null, 'lite: no local-client art, no check');
      assert.deepEqual(groupProblems(lite.problems), []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('没有 public/assets/local 的机器：跳过，不挡出包', async () => {
    const { plan } = await import('../../tools/package.mjs');
    const dir = fixture([], null);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '9.9.9', scripts: {} }));
    try {
      const p = plan(dir, { paths: ['package.json'], allowDirty: true, scan: false, measure: false });
      assert.deepEqual(groupProblems(p.problems), []);
      assert.match(p.localGroups.skipped, /public\/assets\/local/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// 命令行入口：`tools/asset-pack-doctor.mjs check-groups`（与出包闸门同一份判据，只是给人跑的形态）。
describe('入口：asset-pack-doctor.mjs check-groups', () => {
  /** 跑一段 main()/checkGroups() 并收回 stdout。 */
  const capture = async (fn) => {
    const out = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s) => { out.push(String(s)); return true; };
    try { return { code: await fn(), text: out.join('') }; } finally { process.stdout.write = write; }
  };

  test('有缺口：退出 1，并逐条打印缺的 group（不打印文件路径之外的噪声）', async () => {
    const { checkGroups } = await import('../../tools/asset-pack-doctor.mjs');
    await inFixtureAsync(['hextech/tier/1.png', 'scene/tex/a.png'], listed('scene/tex'), async (dir) => {
      const { code, text } = await capture(() => checkGroups({ root: dir }));
      assert.equal(code, 1);
      assert.match(text, /check-groups|local-assets/);
      assert.match(text, /hextech\/tier/, text);
      assert.match(text, /静默退回/, 'says the client falls back silently');
    });
  });

  test('dangling：默认只警告（exit 0），--strict 才算失败（exit 1）', async () => {
    const { checkGroups, main } = await import('../../tools/asset-pack-doctor.mjs');
    // 磁盘上只有 hextech/tier；清单还写着一个磁盘上没有的 scene/act2autochess_m04
    await inFixtureAsync(['hextech/tier/1.png'], listed('hextech/tier', 'scene/act2autochess_m04'), async (dir) => {
      const lenient = await capture(() => checkGroups({ root: dir }));
      assert.equal(lenient.code, 0, '出包工作区：dangling 只是警告，不能把无辜的出包挡下来');
      assert.match(lenient.text, /警告：1 个 group 在清单里但磁盘上没有目录/);
      assert.match(lenient.text, /scene\/act2autochess_m04/);
      const strict = await capture(() => checkGroups({ root: dir, strict: true }));
      assert.equal(strict.code, 1, '服务器上体检：指向空处的清单同样不能上线');
      assert.match(strict.text, /失败：1 个 group 在清单里但磁盘上没有目录/);
      const json = await capture(() => checkGroups({ root: dir, strict: true, json: true }));
      assert.equal(json.code, 1);
      assert.equal(JSON.parse(json.text.trim()).ok, false);
      // 开关本身：`--strict` 是不带值的布尔参数（与 --json 一样），命令行上要能过
      const cli = await capture(() => main(['check-groups', '--root', dir, '--strict']));
      assert.equal(cli.code, 1);
      const cliLenient = await capture(() => main(['check-groups', '--root', dir]));
      assert.equal(cliLenient.code, 0, '不带 --strict 时同样的目录退出 0');
    });
  });

  test('对齐：退出 0；--json 给机器可读的结果', async () => {
    const { checkGroups } = await import('../../tools/asset-pack-doctor.mjs');
    await inFixtureAsync(['hextech/tier/1.png'], listed('hextech/tier'), async (dir) => {
      const plain = await capture(() => checkGroups({ root: dir }));
      assert.equal(plain.code, 0);
      assert.match(plain.text, /1 个 group 全部列在/);
      const json = await capture(() => checkGroups({ root: dir, json: true }));
      assert.equal(json.code, 0);
      const parsed = JSON.parse(json.text.trim());
      assert.equal(parsed.ok, true);
      assert.deepEqual(parsed.unlisted, []);
    });
  });

  test('这台机器没有本机素材：退出 0 并说明为什么跳过', async () => {
    const { checkGroups } = await import('../../tools/asset-pack-doctor.mjs');
    const dir = fixture([], null);
    try {
      const { code, text } = await capture(() => checkGroups({ root: dir }));
      assert.equal(code, 0, 'a clean checkout must not be blocked');
      assert.match(text, /跳过/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// 本机的正例：真的提取过本机素材时，这份清单必须一个 group 都不缺（2026-10-30 修好的那份是 1941 条 / 152 group，
// hextech/tier 3、hextech/item 7、hextech/audio 2、char/* 3、scene/* 12、ui/homeicon 2、ui/hometheme 6）。
// 没有 public/assets/local 的机器（CI）跳过这一条 —— 与 test/content/extra-enemies.test.js 的既有写法一致。
test('本机提取过素材时：data/local-assets.json 覆盖 public/assets/local 的每个 group',
  { skip: !fs.existsSync(path.join(ROOT, LOCAL_DIR)) && 'no local-client art on this machine' }, () => {
    const g = localGroupGaps(ROOT);
    assert.equal(g.error, '');
    assert.deepEqual(g.unlisted, [], `local-asset groups on disk but not in ${LOCAL_MANIFEST}: ${g.unlisted.join(', ')}`);
  });
