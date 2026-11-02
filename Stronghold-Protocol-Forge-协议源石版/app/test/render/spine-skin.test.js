// test/render/spine-skin.test.js —— 刀二（局内 Spine 换装）的**引擎半边**：`assets.js` 的
// `spineEntry(m, id, { skin })` 与 `hasBackSpine(m, id, { skin })`，以及「同一干员、两套时装」在 Spine LRU 里
// 真的各占一份缓存这件事。
//
// WHY THIS EXISTS
//
// `pack.json.skins[]` 的 `art` 与 `art.chars` 一条同形（`ART_TABLES.chars.spine = 'sides'`），所以**包格式早就能
// 带模型**；缺的一直是 `spineEntry` 不认「这一套时装的模型」。这个文件钉住四件事：
//
//   1. **没有 `opts.skin` 时逐项与今天相同**（front / back / `_2` 后缀 / token / enemy / 未知 id）—— 换装是纯增量，
//      关掉它（不传 skin）就回到 0.19.41 的行为，这是最硬的那条不变量；
//   2. **有 skin 就用它**：`back` 面缺失回落 `front`（与既有 `back && isObj(spine.back) ? back : front` 同一条规则），
//      这一面不成形（缺 skel / atlas）时**回落原版模型**，而不是把坏数据画出去；
//   3. **`anims` 是内容侧的硬契约**：`validSpine` 要求 `{ skel, atlas, anims }` 三样齐，时装的 `art.spine`
//      **必须**自己写 `anims`（内容侧按 `tools/assets/anim-roles.mjs resolveRoles` 算，与官方 chars 同一套参数，
//      并与融合版 `plugin.lock.json` 逐面对过账）。**引擎不从官方 `chars[id].spine` 继承 anims** —— 那会盖掉
//      时装自己的 clip 名（41 套的普攻 clip 不叫 `Attack*`，正是靠它自己的 `anims` 才对）。缺 `anims` ⇒ 这一侧
//      不算模型 ⇒ 回落原版模型（可见、静默、不画坏数据）；
//   4. **缓存不串**：`assets.spine` 的缓存键是 `entry.skel`，两套时装 = 两个骨架目录 = 两份缓存。这条要用
//      `createAssets({ loadSpine })`（注入的加载器，不需要 PIXI）真的跑一遍，而不是只在注释里声明。
//
// 注意：本文件直接 `node test/render/spine-skin.test.js` 执行（沙箱里 `node --test` 起不了子进程，spawn EPERM）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spineEntry, hasBackSpine, createAssets } from '../../public/js/assets.js';

const OP = 'char_498_inside';

// 官方那一份的最小形状（`data/assets.json` 的 `chars.<id>.spine`）。`anims` / `animations` / `hits` / `bounds`
// 的类型就是官方条目的实际类型（`shared/workshop.js` 的 ART_SPINE_PASSTHROUGH 抄的就是它们）。
const ANIMS = Object.freeze({
  idle: 'Idle', deploy: 'Start',
  attack: { begin: 'Attack_Begin', loop: 'Attack_Loop', end: 'Attack_End' },
  die: 'Die', move: null, stun: null,
});
const OFFICIAL_FRONT = Object.freeze({
  skel: `/assets/spine/op/${OP}/front/${OP}.skel`,
  atlas: `/assets/spine/op/${OP}/front/${OP}.atlas`,
  textures: [`/assets/spine/op/${OP}/front/${OP}.png`],
  pma: false,
  anims: ANIMS,
  animations: Object.freeze({ Idle: 4, Start: 1, Attack_Loop: 1 }),
  events: Object.freeze(['OnAttack', 'OnStart']),
  hits: Object.freeze({ Attack_Loop: Object.freeze([0]) }),
  bounds: Object.freeze({ x: -161.493, y: -1.154, width: 1212.455, height: 422.149 }),
});
const OFFICIAL_BACK = Object.freeze({
  skel: `/assets/spine/op/${OP}/back/${OP}.skel`,
  atlas: `/assets/spine/op/${OP}/back/${OP}.atlas`,
  textures: [`/assets/spine/op/${OP}/back/${OP}.png`],
  anims: Object.freeze({ ...ANIMS, idle: 'Idle_2' }),
});

/** 装载期改写过的时装模型（`mergeWorkshopSkins` 把包内相对路径变成 `/workshop-assets/<包>/…`）。 */
const skinFront = (name, extra = {}) => ({
  skel: `/workshop-assets/official-skins/spine/${name}/front/${name}.skel`,
  atlas: `/workshop-assets/official-skins/spine/${name}/front/${name}.atlas`,
  textures: [`/workshop-assets/official-skins/spine/${name}/front/${name}.png`],
  pma: false,
  ...extra,
});
const skinBack = (name, extra = {}) => ({
  skel: `/workshop-assets/official-skins/spine/${name}/back/${name}.skel`,
  atlas: `/workshop-assets/official-skins/spine/${name}/back/${name}.atlas`,
  textures: [`/workshop-assets/official-skins/spine/${name}/back/${name}.png`],
  pma: false,
  ...extra,
});
/**
 * 时装模型自己的 anims —— 内容侧算出来的那一份（`resolveRoles`）。刻意与官方的 `ANIMS` **不同值**：
 * 41 套时装的普攻 clip 不叫 `Attack*`，靠的就是这一份。
 */
const SKIN_ANIMS = Object.freeze({
  idle: 'Idle', deploy: 'Start',
  attack: { begin: null, loop: 'Attack_A', end: null },
  die: 'Die', move: null, stun: null,
});
/** 一套时装：`art` 与 `art.chars` 的一条同形，模型在 `art.spine.front/back`。 */
const skinArt = (name, { back = true, anims = SKIN_ANIMS } = {}) => ({
  spine: {
    front: skinFront(name, { anims }),
    ...(back ? { back: skinBack(name, { anims }) } : {}),
  },
});

const MANIFEST = Object.freeze({
  chars: { [OP]: { avatar: `/assets/char/avatar/${OP}.png`, spine: { front: OFFICIAL_FRONT, back: OFFICIAL_BACK } } },
  tokens: { token_10000_silent_healrb: { spine: { skel: '/assets/spine/token/t.skel', atlas: '/assets/spine/token/t.atlas', anims: { idle: 'Idle' } } } },
  enemies: { enemy_1007_slime: { spine: { skel: '/assets/spine/enemy/s.skel', atlas: '/assets/spine/enemy/s.atlas', anims: { idle: 'Idle' } } } },
});

// ---- 1. 没有 skin：逐项与今天相同（纯增量的那一半） -------------------------------------------------------

test('spineEntry without opts.skin is byte-for-byte today’s answer', () => {
  assert.equal(spineEntry(MANIFEST, OP), MANIFEST.chars[OP].spine.front, 'front, the very object');
  assert.equal(spineEntry(MANIFEST, OP, { back: false }), MANIFEST.chars[OP].spine.front);
  assert.equal(spineEntry(MANIFEST, OP, { back: true }), MANIFEST.chars[OP].spine.back);
  // 一个只带 front 的官方条目：back 也回 front，而不是 null（既有规则：没有反面就是同一个面）
  const frontOnly = { chars: { [OP]: { spine: { front: OFFICIAL_FRONT } } } };
  assert.equal(spineEntry(frontOnly, OP, { back: true }), OFFICIAL_FRONT);
  // token / enemy / 未知 id / 空 id：一个字节不变
  assert.equal(spineEntry(MANIFEST, 'token_10000_silent_healrb'), MANIFEST.tokens.token_10000_silent_healrb.spine);
  assert.equal(spineEntry(MANIFEST, 'enemy_1007_slime'), MANIFEST.enemies.enemy_1007_slime.spine);
  assert.equal(spineEntry(MANIFEST, 'char_nobody'), null);
  assert.equal(spineEntry(MANIFEST, ''), null);
  assert.equal(spineEntry(MANIFEST, null), null);
});

test('spineEntry without opts.skin: an entry without anims is not a model (today’s rule)', () => {
  const bare = { chars: { [OP]: { spine: { front: { skel: '/a/x.skel', atlas: '/a/x.atlas' } } } } };
  assert.equal(spineEntry(bare, OP), null, 'validSpine needs anims — unchanged');
  assert.equal(hasBackSpine(bare, OP), false);
});

// ---- 2. 有 skin：用它；back 缺失回落 front；不成形回落原版 -----------------------------------------------

test('spineEntry with opts.skin: the outfit’s own two sides', () => {
  const skin = skinArt('outfit_summer');
  assert.equal(spineEntry(MANIFEST, OP, { skin }), skin.spine.front);
  assert.equal(spineEntry(MANIFEST, OP, { skin, back: false }), skin.spine.front);
  assert.equal(spineEntry(MANIFEST, OP, { skin, back: true }), skin.spine.back);
  // 三种写法都认：`art`（`{ spine }`）、`{ spine }`、`spine` 本身（`{ front, back }`）
  assert.equal(spineEntry(MANIFEST, OP, { skin: skin.spine }), skin.spine.front);
  assert.equal(spineEntry(MANIFEST, OP, { skin: skin.spine.front && skin.spine }), skin.spine.front);
  assert.equal(spineEntry(MANIFEST, OP, { skin: { spine: skin.spine }, back: true }), skin.spine.back);
});

test('spineEntry with opts.skin: a single-sided outfit falls back to its own front', () => {
  const skin = skinArt('outfit_single', { back: false });
  assert.equal(spineEntry(MANIFEST, OP, { skin, back: true }), skin.spine.front, 'back missing → front, same rule as always');
  assert.equal(hasBackSpine(MANIFEST, OP, { skin }), false, 'and the view is told there is no Back model');
  assert.equal(hasBackSpine(MANIFEST, OP), true, 'the official model still has one');
});

test('spineEntry with opts.skin: a broken side falls back to the installation’s model, never to bad data', () => {
  const noAtlas = { spine: { front: { skel: '/workshop-assets/p/x/front/x.skel' } } };
  assert.equal(spineEntry(MANIFEST, OP, { skin: noAtlas }), OFFICIAL_FRONT);
  const noSkel = { spine: { front: { atlas: '/workshop-assets/p/x/front/x.atlas' } } };
  assert.equal(spineEntry(MANIFEST, OP, { skin: noSkel, back: true }), OFFICIAL_BACK);
  // 一个根本不是 spine 的 skin（一套只有头像的时装）：同样回落原版
  assert.equal(spineEntry(MANIFEST, OP, { skin: { avatar: '/workshop-assets/p/a.png' } }), OFFICIAL_FRONT);
  assert.equal(spineEntry(MANIFEST, OP, { skin: null }), OFFICIAL_FRONT);
  assert.equal(spineEntry(MANIFEST, OP, { skin: 'nope' }), OFFICIAL_FRONT);
});

test('spineEntry with opts.skin: an outfit model wins over the operator’s self-made model (spineLocal)', () => {
  // data/local-assets.json 的形状：`groups[<组>][<文件名>] = { path }`（`localAssetUrl`）；skel 与 atlas 必须同名同目录
  const local = {
    groups: {
      'char/x': {
        'x.skel': { path: '/assets/local/char/x/x.skel' },
        'x.atlas': { path: '/assets/local/char/x/x.atlas' },
        'x.png': { path: '/assets/local/char/x/x.png' },
      },
    },
  };
  const withLocal = {
    chars: {
      [OP]: {
        spine: { front: OFFICIAL_FRONT, back: OFFICIAL_BACK },
        spineLocal: { front: { group: 'char/x', skel: 'x.skel', atlas: 'x.atlas', textures: ['x.png'], anims: ANIMS } },
      },
    },
  };
  const skin = skinArt('outfit_summer');
  assert.equal(spineEntry(withLocal, OP, { local, skin }), skin.spine.front, 'a chosen outfit beats the self-made art');
  assert.equal(spineEntry(withLocal, OP, { local }).local, true, 'and without a skin the self-made model is unchanged');
});

// ---- 3. anims 是内容契约：时装自己写；缺了就不算模型（回落原版） -----------------------------------------

test('spineEntry with opts.skin: a model without anims is not a model (validSpine, today’s rule)', () => {
  const bare = { spine: { front: { skel: '/workshop-assets/p/x/front/x.skel', atlas: '/workshop-assets/p/x/front/x.atlas' } } };
  assert.equal(spineEntry(MANIFEST, OP, { skin: bare }), OFFICIAL_FRONT, 'falls back to the installation’s model');
  assert.equal(hasBackSpine(MANIFEST, OP, { skin: bare }), true, 'and the official Back model is still there');
});

test('spineEntry with opts.skin: the outfit’s own anims are used verbatim, and the entry object is stable', () => {
  // 41 套时装的普攻 clip 不叫 `Attack*`（`Attack_A` / `Skill_1_Loop` / `Attack_1` …）：它们靠**自己的** anims 才对，
  // 所以引擎一个字段都不改写、不从官方借。
  const own = { idle: 'Idle_Kitchen', deploy: 'Start_Kitchen', attack: { begin: null, loop: 'Attack_A', end: null }, die: 'Die', move: null, stun: null };
  const skin = skinArt('outfit_kitchen', { anims: own });
  const a = spineEntry(MANIFEST, OP, { skin });
  const b = spineEntry(MANIFEST, OP, { skin });
  assert.equal(a.anims, own, 'the outfit’s map, by reference — never the official one');
  assert.notEqual(a.anims, ANIMS);
  assert.equal(a, b, 'one entry object per side: render/units.js compares entries across frames');
  assert.equal(a, skin.spine.front, 'the manifest object itself, not a copy');
  // 另一套时装是另一个对象（同一干员、两套外观不许串）
  const other = skinArt('outfit_winter', { anims: own });
  assert.notEqual(spineEntry(MANIFEST, OP, { skin: other }), a);
  assert.equal(spineEntry(MANIFEST, OP, { skin, back: true }).anims, own, 'the Back side carries its own too');
});

// ---- 4. 缓存不串：同一干员、两套时装的 Spine 各占一份 -----------------------------------------------------

/** 一个只记下被加载的条目的加载器（不需要 PIXI：`createAssets` 的 `loadSpine` 是可注入的）。 */
function recordingStore() {
  const loaded = [];
  const assets = createAssets({
    manifest: MANIFEST,
    loadSpine: (entry) => { loaded.push(entry); return Promise.resolve({ animations: [], skel: entry.skel }); },
  });
  return { assets, loaded };
}

test('assets.spine cache: two outfits of one operator are two skeletons, never one', async () => {
  const { assets, loaded } = recordingStore();
  const summer = skinArt('outfit_summer');
  const winter = skinArt('outfit_winter');
  const base = assets.spineEntry(OP);
  const a = assets.spineEntry(OP, { skin: summer });
  const b = assets.spineEntry(OP, { skin: winter });
  assert.equal(new Set([base.skel, a.skel, b.skel]).size, 3, 'three different skeleton URLs');
  const [da, db, dbase] = await Promise.all([assets.spine.acquire(a), assets.spine.acquire(b), assets.spine.acquire(base)]);
  assert.equal(dbase.skel, base.skel);
  assert.equal(da.skel, a.skel);
  assert.equal(db.skel, b.skel);
  assert.notEqual(da, db, 'each outfit got its own skeleton data');
  assert.deepEqual(loaded.map((e) => e.skel), [a.skel, b.skel, base.skel], 'one load per skeleton URL (the cache key is entry.skel)');
  // 再取一次同一份：不会再加载（缓存命中），release 也按同一个键
  assets.spine.release(a);
  await assets.spine.acquire(a);
  assert.equal(loaded.length, 3, 'the second acquire of the same outfit is a cache hit');
  assets.spine.release(a); assets.spine.release(b); assets.spine.release(base);
});

test('assets.spine cache: one skeleton URL is one cache record (the content contract behind “no swapping”)', async () => {
  // 两套时装若把 skel 写成同一个 URL，引擎按 skel 缓存 ⇒ 它们**共用**一份 spineData（pixi-spine 是从 skel 的路径
  // 推出同名 atlas 的，清单里的 atlas 只用于内存回收）。所以「每套时装自带骨架目录」是内容侧的硬契约，不是风格。
  const { assets, loaded } = recordingStore();
  const one = skinArt('outfit_summer');
  const same = { spine: { front: { ...one.spine.front } } };
  const a = assets.spineEntry(OP, { skin: one });
  const b = assets.spineEntry(OP, { skin: same });
  await Promise.all([assets.spine.acquire(a), assets.spine.acquire(b)]);
  assert.equal(loaded.length, 1, 'same skel URL → one load: two outfits MUST ship their own skeleton files');
  assets.spine.release(a); assets.spine.release(b);
});

// ---- 5. 真内容（`workshop/official-skins`）：276 套的每一套都真的解析得出来 ---------------------------------
//
// 上面那些用的是手写的最小形状；这一条用**盘上真的那一套**：`pack.json` 的 `skins[]` + `data/assets.json` 的 `chars`，
// 按装载期那条规则把包内相对路径改写成 `/workshop-assets/<包>/…`，然后逐套问 `spineEntry` 要模型。
// 它挡的是「引擎写对了、内容形状错一格」那一类静默失败（`spineEntry` 回 null ⇒ 棋盘上根本不换装，一条日志都没有）。
// 包不在（内容那半边没跑 / 素材被清）时整条跳过。

const PACK_DIR = new URL('../../workshop/official-skins/', import.meta.url);
const packJson = (() => {
  try { return JSON.parse(readFileSync(new URL('pack.json', PACK_DIR), 'utf8')); } catch { return null; }
})();
const repoManifest = (() => {
  try { return JSON.parse(readFileSync(new URL('../../data/assets.json', import.meta.url), 'utf8')); } catch { return null; }
})();
const skipReal = packJson && repoManifest ? false : 'the official-skins pack / data/assets.json is not in this checkout';

test('the real pack: every outfit’s model resolves through spineEntry (front, back, single-sided)', { skip: skipReal }, () => {
  const toUrl = (p) => `/workshop-assets/${packJson.id}/${String(p).split('/').map(encodeURIComponent).join('/')}`;
  const sides = (sp) => Object.fromEntries(Object.entries(sp).map(([k, side]) => [k, {
    ...side,
    skel: toUrl(side.skel),
    atlas: toUrl(side.atlas),
    ...(Array.isArray(side.textures) ? { textures: side.textures.map(toUrl) } : {}),
  }]));
  const outfit = packJson.skins.filter((s) => s && s.charId && s.art && s.art.spine);
  assert.ok(outfit.length > 200, `the pack ships the battle models (${outfit.length} outfits)`);
  const failures = [];
  let checked = 0, single = 0;
  for (const skin of outfit) {
    if (!repoManifest.chars || !repoManifest.chars[skin.charId]) continue;   // this install has no such operator
    checked++;
    const sp = sides(skin.art.spine);
    const front = spineEntry(repoManifest, skin.charId, { skin: { spine: sp } });
    if (!front || front.skel !== sp.front.skel) { failures.push(`${skin.charId}/${skin.id}: front did not resolve`); continue; }
    // pixi-spine 找 atlas 是靠把 skel 的扩展名换掉（清单里的 atlas 只用于内存回收）：两者必须同名同目录
    if (front.skel.replace(/\.skel$/, '.atlas') !== front.atlas) failures.push(`${skin.charId}/${skin.id}: skel/atlas are not siblings`);
    if (sp.back) {
      const back = spineEntry(repoManifest, skin.charId, { skin: { spine: sp }, back: true });
      if (!back || back.skel !== sp.back.skel) failures.push(`${skin.charId}/${skin.id}: back did not resolve`);
      if (!hasBackSpine(repoManifest, skin.charId, { skin: { spine: sp } })) failures.push(`${skin.charId}/${skin.id}: no back reported`);
    } else {
      single++;
      const b = spineEntry(repoManifest, skin.charId, { skin: { spine: sp }, back: true });
      if (!b || b.skel !== sp.front.skel) failures.push(`${skin.charId}/${skin.id}: single-sided outfit must fall back to its front`);
      if (hasBackSpine(repoManifest, skin.charId, { skin: { spine: sp } })) failures.push(`${skin.charId}/${skin.id}: reported a back it has not`);
    }
  }
  assert.deepEqual(failures, [], `${checked} outfits checked (${single} single-sided)`);
  assert.ok(checked > 200, `most outfits belong to an operator this install has (${checked})`);
});
