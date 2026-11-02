// test/ui/portraitChain.test.js —— 立绘 / 头像的**唯一解析链**（public/js/ui/portraitChain.js）。
//
// 这条链被九处渲染路径调用（手牌、结算页、商店卡、席位名片、补位棋盘、干员调配…），而 docs/WORKSHOP.md 一直
// 把本文件当作「皮肤通道已实现」的证据 —— 它**不在本检出**（`shared/modSurface.js` 的 `skins` 表面行也点名它）。
// 于是这一条链路在本仓零覆盖：谁改都等于盲改。这里补上的就是那份缺失的守卫，两件事：
//
//   1. **没有提供者时逐字不变**（回归闸门）：262 个可上场棋子，本链的答案与两个旧实现
//      （`ui/assetUrls.js` 的 `chessPortraitUrl` / `chessAvatarUrl`）**逐项相等**。链是这两个实现的合并，
//      这一条红了就说明「合并」把某个分支弄丢了。
//   2. **步骤 0 的契约**（`setAppearanceLookup` / `setAppearanceFirst`）：什么时候问提供者、什么时候不问。
//      这里有一条 2026-11 改过的边界：从前 `id` 以 `_1` / `_2` 结尾、以及 `chess.isGolden` 也被当成「调用方
//      点名了版本」，于是**立绘一次都问不到提供者**（真实棋子的 `assets.portrait` 全部以 `_1` / `_2` 结尾）。
//      现在只有 `variant: 'elite'` 挡住提供者，其余全让提供者先说话 —— 下面用**真实棋子记录**正面钉住它。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  portraitUrlOf, avatarUrlOf, portraitEntry,
  setAppearanceLookup, clearAppearanceLookup, currentAppearanceLookup,
  setAppearanceFirst, appearanceFirstEnabled, setLocalManifest,
} from '../../public/js/ui/portraitChain.js';
import { chessPortraitUrl, chessAvatarUrl } from '../../public/js/ui/assetUrls.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (f) => JSON.parse(readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const m = load('assets.json');
const chess = load('chess.json');
const records = Object.values(chess).filter((c) => c && typeof c === 'object' && c.chessId && !c.isDiy);

/** 一套回放的提供者：记下每一次被问，按 kind 回答。 */
function recorder(answer) {
  const calls = [];
  return {
    calls,
    lookup: (kind, charId, id) => { calls.push([kind, charId, id]); return answer(kind, charId, id); },
  };
}

test.beforeEach(() => {
  clearAppearanceLookup();
  setAppearanceFirst(true);
  setLocalManifest(null);
});
test.after(() => { clearAppearanceLookup(); setAppearanceFirst(true); });

test('没有提供者时：262 个棋子与两个旧实现逐项相等（回归闸门）', () => {
  assert.equal(currentAppearanceLookup(), undefined, '没有注册者时链里那一个必须是 undefined');
  let n = 0;
  for (const c of records) {
    assert.equal(portraitUrlOf(m, c), chessPortraitUrl(m, c), `portrait ${c.chessId}`);
    assert.equal(avatarUrlOf(m, c), chessAvatarUrl(m, c), `avatar ${c.chessId}`);
    n++;
  }
  assert.ok(n > 250, `真的比了 ${n} 个棋子`);
});

test('同一份记录、两份实现：`_1` / `_2` / 精确命中 / isGolden 四个分支都覆盖到了', () => {
  // 这一条是给上面那条闸门做保障的：如果数据换了形状（例如以后不再用 `_1` / `_2` 后缀），
  // 「逐项相等」就可能变成「两边都返回 null」——那是一条假装绿了的闸门。
  const suffixes = new Set(records.map((c) => (c.assets?.portrait || '').slice(-2)));
  assert.ok(suffixes.has('_1') && suffixes.has('_2'), `立绘 id 的后缀：${[...suffixes].join(',')}`);
  const golden = records.filter((c) => c.isGolden);
  assert.ok(golden.length > 50, `精锐棋子 ${golden.length} 个`);
  for (const c of golden.slice(0, 20)) {
    assert.ok(chessPortraitUrl(m, c), `精锐立绘 ${c.chessId}`);
  }
});

test('步骤 0：调用方没点名版本时，提供者的答案压过官方回落', () => {
  // 合成一条「没有版本后缀」的记录 —— 只有这种形状才走得到步骤 0（见文件头第 2 条）
  const synthetic = { charId: 'char_498_inside', assets: { avatar: 'char_498_inside', portrait: 'char_498_inside' } };
  const r = recorder((kind) => (kind === 'avatar' ? { avatar: '/skin/inside-a.png' } : { portrait: '/skin/inside-p.png' }));
  assert.equal(setAppearanceLookup(r.lookup), true);

  assert.equal(avatarUrlOf(m, synthetic), '/skin/inside-a.png');
  assert.equal(portraitUrlOf(m, synthetic), '/skin/inside-p.png');
  assert.deepEqual(r.calls, [
    ['avatar', 'char_498_inside', 'char_498_inside'],
    ['portrait', 'char_498_inside', 'char_498_inside'],
  ], '按 kind 各问一次、各答一次');
});

test('步骤 0：只认被问的那一条 kind 的字段（给另一条 kind 的图不算答案）', () => {
  const synthetic = { charId: 'char_498_inside', assets: { avatar: 'char_498_inside', portrait: 'char_498_inside' } };
  // 只画了立绘的一套外观：头像那一次问它，它给 `{ portrait }` —— 链不认，掉回官方头像
  setAppearanceLookup(() => ({ portrait: '/skin/only-portrait.png' }));
  assert.equal(avatarUrlOf(m, synthetic), m.chars.char_498_inside.avatar, '头像位不画立绘');
  assert.equal(portraitUrlOf(m, synthetic), '/skin/only-portrait.png');
});

test('步骤 0：给 null / 抛错 / 给空对象 ⇒ 回落官方（失败形态是「画面照旧」，不外溢）', () => {
  const synthetic = { charId: 'char_498_inside', assets: { avatar: 'char_498_inside', portrait: 'char_498_inside' } };
  const official = {
    avatar: m.chars.char_498_inside.avatar,
    portrait: m.chars.char_498_inside.portrait,
  };
  for (const answer of [() => null, () => { throw new Error('坏 mod'); }, () => ({}), () => 'nope']) {
    clearAppearanceLookup();
    setAppearanceLookup(answer);
    assert.equal(avatarUrlOf(m, synthetic), official.avatar, `${String(answer)} → 官方头像`);
    assert.equal(portraitUrlOf(m, synthetic), official.portrait, `${String(answer)} → 官方立绘`);
  }
});

test('两个开关：`opts.skins === false` 与 setAppearanceFirst(false) 都让步骤 0 整段不存在', () => {
  const synthetic = { charId: 'char_498_inside', assets: { avatar: 'char_498_inside' } };
  const r = recorder(() => ({ avatar: '/skin/x.png' }));
  setAppearanceLookup(r.lookup);

  assert.equal(avatarUrlOf(m, synthetic, { skins: false }), m.chars.char_498_inside.avatar);
  assert.equal(r.calls.length, 0, '一个调用点的否决：连问都不问');

  assert.equal(setAppearanceFirst(false), false, '同步之后链里生效的值就是 false');
  assert.equal(appearanceFirstEnabled(), false);
  assert.equal(avatarUrlOf(m, synthetic), m.chars.char_498_inside.avatar);
  assert.equal(r.calls.length, 0, '模块门控关掉：连问都不问');

  setAppearanceFirst(true);
  assert.equal(avatarUrlOf(m, synthetic), '/skin/x.png', '打开之后同一个调用重新生效');
});

test('一个进程最多一个提供者：后注册者被拒，clear 之后可以再注册', () => {
  assert.equal(setAppearanceLookup(() => ({ avatar: '/a.png' })), true);
  assert.equal(setAppearanceLookup(() => ({ avatar: '/b.png' })), false, '第二个被拒（CLIENT_APPEARANCE_TAKEN 的那一条）');
  assert.equal(currentAppearanceLookup()('avatar', 'x', 'x').avatar, '/a.png', '先注册的那个还在');
  clearAppearanceLookup();
  assert.equal(currentAppearanceLookup(), undefined);
  assert.equal(setAppearanceLookup(() => ({ avatar: '/c.png' })), true);
});

test('只有 `variant: elite` 挡住提供者：真实棋子的 `_1` / `_2` 立绘与精锐立绘都换成时装图', () => {
  const r = recorder((kind) => (kind === 'portrait' ? { portrait: '/skin/p.png' } : { avatar: '/skin/a.png' }));
  const base = records.find((c) => !c.isGolden);
  const golden = records.find((c) => c.isGolden);
  assert.ok(base && golden);

  // 没有提供者时官方给的答案（`variant: elite` 的那一档要拿它对照）
  clearAppearanceLookup();
  const officialElitePortrait = portraitUrlOf(m, base, { variant: 'elite' });
  assert.ok(officialElitePortrait, '这个干员有精锐立绘，对照才有意义');

  setAppearanceLookup(r.lookup);
  // 1) `_1` 后缀的普通立绘 —— 从前这里一次都不问提供者（数据里 131 张立绘都是这种形状）
  assert.equal(portraitUrlOf(m, base), '/skin/p.png', '`_1` 立绘换成时装图');
  // 2) `_2` 后缀（精锐棋子的立绘）与 `isGolden` 的普通棋子 —— 从前同样不问
  assert.equal(portraitUrlOf(m, golden), '/skin/p.png', '`_2` / 精锐立绘换成时装图');
  assert.equal(portraitUrlOf(m, { ...base, isGolden: true }), '/skin/p.png', 'isGolden 同样让提供者先说话');
  // 3) 头像那两条照旧（本来就是通的）
  assert.equal(avatarUrlOf(m, base), '/skin/a.png');
  assert.equal(avatarUrlOf(m, golden), '/skin/a.png');

  // 4) 唯一被承认的「点名版本」：`variant: 'elite'` —— 提供者一次都不被问到，链给这个干员的精锐立绘
  r.calls.length = 0;
  assert.equal(portraitUrlOf(m, base, { variant: 'elite' }), officialElitePortrait, '点名精锐 ⇒ 官方精锐立绘');
  assert.equal(r.calls.length, 0, 'variant: elite ⇒ 不打扰提供者');
});

test('⭐ 最硬的不变量：开关关掉 / 调用点写 `skins: false` 时，262 个棋子与没装提供者逐字相同', () => {
  // 这是整条通道的总闸（设置 →「工坊外观」）：装了提供者、玩家也选了时装，只要开关关掉，链的答案必须与
  // 「什么都没装」逐项相等 —— 连问都不问（下面顺带用 calls 钉住「不问」这件事）。
  const r = recorder(() => ({ avatar: '/skin/a.png', portrait: '/skin/p.png' }));
  setAppearanceLookup(r.lookup);
  for (const c of records) {
    assert.equal(portraitUrlOf(m, c, { skins: false }), chessPortraitUrl(m, c), `skins:false portrait ${c.chessId}`);
    assert.equal(avatarUrlOf(m, c, { skins: false }), chessAvatarUrl(m, c), `skins:false avatar ${c.chessId}`);
  }
  assert.equal(r.calls.length, 0, '一个调用点的否决：连问都不问');

  assert.equal(setAppearanceFirst(false), false);
  for (const c of records) {
    assert.equal(portraitUrlOf(m, c), chessPortraitUrl(m, c), `开关关 portrait ${c.chessId}`);
    assert.equal(avatarUrlOf(m, c), chessAvatarUrl(m, c), `开关关 avatar ${c.chessId}`);
  }
  assert.equal(r.calls.length, 0, '模块门控关掉：连问都不问');
});

test('`variant: elite` 时链自己那一档不受影响：262 个棋子与没有提供者时逐字相同', () => {
  for (const c of records) {
    const without = (() => { clearAppearanceLookup(); return portraitUrlOf(m, c, { variant: 'elite' }); })();
    setAppearanceLookup(() => ({ portrait: '/skin/p.png' }));
    assert.equal(portraitUrlOf(m, c, { variant: 'elite' }), without, `variant: elite ${c.chessId}`);
  }
});

test('不认识的 kind 由提供者自己回 null：链只送 portrait / avatar 两个值', () => {
  const seen = new Set();
  const synthetic = { charId: 'char_498_inside', assets: { avatar: 'char_498_inside', portrait: 'char_498_inside' } };
  setAppearanceLookup((kind) => { seen.add(kind); return null; });
  avatarUrlOf(m, synthetic);
  portraitUrlOf(m, synthetic);
  assert.deepEqual([...seen].sort(), ['avatar', 'portrait']);
});

test('portraitEntry 的 kind 默认是 portrait（简写不改变默认行为）', () => {
  const c = records.find((x) => !x.isGolden);
  assert.equal(portraitEntry(m, c), portraitUrlOf(m, c));
  assert.equal(portraitEntry(m, c, { kind: 'avatar' }), avatarUrlOf(m, c));
});
