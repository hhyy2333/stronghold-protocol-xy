// test/ui/mode-modules-surfaces.test.js — 协议源石【特限恢复】`hex_mode_modules` 的 3 级模组在**其它客户端界面**上
// （0.19.46）：判据只有一份（public/js/ui/gameLogic/modeModules.js `modeModuleLevel`），商店卡的模组徽标、局内详情卡
// 画到棋盘上的攻击范围、落位轮盘 / 整数区的攻击范围、召唤物的 ownerRange 与棋盘范围都与详情卡、服务端战斗同口径。
//
// 服务端那一半在 test/match/module-level3.test.js，详情卡那一半在 test/ui/mode-modules-detail.test.js（那一页不动）。
// 这一页钉的是「其余界面没有传 moduleLevel」这个缺口：
//   - ChessCard → SkillBadge 的 `scard__mod` 徽标（模组类型 ISW-A / SPC-X …）；
//   - inspectRange（detail 卡画到场上的范围）接受 moduleLevel / moduleLevels；
//   - deployedRecord 的第 5 个参数 opts、previewGrid（落位轮盘）、placementContext 的 moduleLevels（召唤物
//     ownerRange 走 ownerRangeOf → deployedRecord）；
//   - 没有卡时逐字段与改动前一致（deepEqual on JSON），补位干员不套 3 级。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (f) => JSON.parse(readFileSync(path.join(ROOT, 'data', f), 'utf8'));

// the browser data store reads the real data files from disk
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { data } = await import('../../public/js/data.js');
await data.loadAll('chess', 'assets', 'moduleLevels', 'backups', 'local', 'bonds', 'items', 'garrisons', 'effects', 'tokens');

const G = await import('../../public/js/ui/gameLogic.js');
const { modeModuleLevel, ownsModeModules } = await import('../../public/js/ui/gameLogic/modeModules.js');
const { previewGrid } = await import('../../public/js/ui/facing.js');
const { inspectRange } = await import('../../public/js/screens/game/range.js');
const { ChessCard } = await import('../../public/js/ui/shopBar.js');
const { attackRangeGrid } = await import('../../shared/loadoutRecord.js');

const CHESS = load('chess.json');
const LEVELS = load('moduleLevels.json');
const getChess = (id) => CHESS[id] || null;

const HORN_A = 'chess_char_5_08_a';        // 号角 普通形态（没有 modules 列表，干员调配里选的 ISW-A）
const HORN_ISW = 'uniequip_004_horn';
const MOSTMA_A = 'chess_char_4_02_a';      // 莫斯提马 普通形态 → 3 级 SPC-X 扩范围（9 → 10 格）
const MOSTMA_MOD = 'uniequip_003_mostma';

/** m.private 的一份最小样本：拥有（或不拥有）【特限恢复】+ 干员调配。 */
const privOf = (loadout, { card = true, copySeq = 0 } = {}) => ({
  loadout,
  effects: card
    ? [{ id: `hex:hex_mode_modules${copySeq ? `#${copySeq}` : ''}`, key: 'hex:hex_mode_modules', name: '特限恢复',
      desc: '', iconKind: 'hex', counter: null, battle: true, params: {}, data: { hexId: 'hex_mode_modules' } }]
    : [],
});
const HORN_LOADOUT = { [HORN_A]: { module: HORN_ISW } };
const MOSTMA_LOADOUT = { [MOSTMA_A]: { module: MOSTMA_MOD } };

const plain = (v) => JSON.parse(JSON.stringify(v));

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}

// ---- the one predicate ---------------------------------------------------------------------------------

test('modeModuleLevel: hex_mode_modules ⇒ 3（含「管理员」复制的 #2 那一条），别的卡 / 没有 effects ⇒ null', () => {
  const fn = modeModuleLevel;
  assert.equal(fn(privOf({}, { card: true })), 3);
  assert.equal(fn(privOf({}, { card: true, copySeq: 2 })), 3, '复制的那一份 ref id 带 #2');
  assert.equal(fn(privOf({}, { card: false })), null);
  assert.equal(fn(null), null, 'no m.private at all');
  assert.equal(fn({}), null);
  assert.equal(fn({ effects: [{ id: 'hex:hex_break_limit', iconKind: 'hex', iconId: 'hex:hex_break_limit' }] }), null,
    '别的协议源石不是这张卡');
  assert.equal(fn({ effects: [{ id: 'hex:hex_mode_modules', iconKind: 'choice' }] }), null, '不是 hex 卡面');
  assert.equal(fn({ effects: [{ id: 'choice:hex_mode_modules#1', iconKind: 'choice' }] }), null,
    '机变里挑了同名效果不算拥有这张卡');
  assert.equal(fn({ effects: [{ iconKind: 'hex' }] }), null, '没有 id 的条目');
  assert.equal(ownsModeModules(privOf({}, { card: true })), true);
  assert.equal(ownsModeModules(privOf({}, { card: false })), false);
});

// ---- shop card: the module badge ---------------------------------------------------------------

test('ChessCard（商店卡）：拥有【特限恢复】时普通形态的卡也画模组徽标（ISW-A），没有卡时不画', () => {
  const slot = { kind: 'chess', id: HORN_A, price: 4, basePrice: 4 };
  const cardOf = (priv) => ChessCard({ slot, idx: 0, priv, onBuy() {}, onDetail() {} });
  const loOf = (priv) => [...walk(cardOf(priv))].find((n) => n?.props?.lo)?.props?.lo;
  // SkillBadge 是 htm vnode（function type）：调一次展开它的子树，看模组徽标那一段
  const modChip = (priv) => {
    const badge = [...walk(cardOf(priv))].find((n) => n?.props?.lo && typeof n.type === 'function');
    const chip = badge ? [...walk(badge.type(badge.props))].find((n) => n?.props?.['data-type']) : null;
    return chip ? chip.props['data-type'] : null;
  };

  const withCard = privOf(HORN_LOADOUT, { card: true });
  const lo = loOf(withCard);
  assert.deepEqual([lo.module.id, lo.module.typeName, lo.module.none], [HORN_ISW, 'ISW-A', false],
    '卡面用的就是干员调配里选的 ISW-A 特限模组');
  assert.equal(lo.record.module.level, 3, '记录是 3 级那份');
  assert.equal(modChip(withCard), 'ISW-A', 'SkillBadge 的模组徽标（scard__mod data-type）');

  const noCard = privOf(HORN_LOADOUT, { card: false });
  assert.equal(loOf(noCard).module, null, '没有卡：普通形态照旧「没有模组」');
  assert.equal(loOf(noCard).record.module.level, 0);
  assert.equal(modChip(noCard), null, '没有卡：没有模组徽标');

  // 逐字段：没有卡的那张卡 = 完全不传 moduleLevel 的那张卡
  const before = ChessCard({ slot, idx: 0, priv: { loadout: HORN_LOADOUT, effects: [] }, onBuy() {}, onDetail() {} });
  assert.equal(JSON.stringify(plain(cardOf({ loadout: HORN_LOADOUT, effects: [] }))).length > 0, true);
  assert.deepEqual(plain(loOf(noCard)), plain([...walk(before)].find((n) => n?.props?.lo)?.props?.lo),
    '没有卡时 chessLoadout 的结果逐字段与改动前一致');
});

// ---- the detail card's field range (inspectRange) ------------------------------------------------

const inspectArgs = (chessId, loadout) => ({
  target: { kind: 'unit', unit: { kind: 'op', side: 'ally', area: 'board', y: 10, x: 6, dir: 'RIGHT' } },
  detail: { type: 'chess', chess: CHESS[chessId] },
  pieces: new Map(), showPrep: false, field: { prep: false },
  snapshot: [1, 6, 10, 100, 100], live: null, loadout, getChess, backups: null,
});

test('inspectRange：3 级模组扩范围（莫斯提马 SPC-X 9 → 10 格），没有卡时与改动前逐字段一致', () => {
  const priv = privOf(MOSTMA_LOADOUT, { card: true });
  const args = inspectArgs(MOSTMA_A, MOSTMA_LOADOUT);
  const l1 = inspectRange(args);
  const l3 = inspectRange({ ...args, moduleLevel: modeModuleLevel(priv), moduleLevels: LEVELS });
  assert.ok(l1.grid.length > 0 && l3.grid.length > l1.grid.length,
    `3 级扩范围（${l1.grid.length} → ${l3.grid.length}）`);
  assert.deepEqual([l3.row, l3.col, l3.dir], [l1.row, l1.col, l1.dir], '位置 / 朝向不变，只有范围变了');

  // 没有卡：moduleLevel = null ⇒ 与完全不传那两个参数一样
  const before = inspectRange(args);
  const noCard = inspectRange({ ...args, moduleLevel: null, moduleLevels: LEVELS });
  assert.deepEqual(plain(noCard), plain(before), '没有卡时逐字段一致');

  // 上限是数据自己的那条：inspectRange 不自己判所有权，调用点给 null 才是「没有卡」
  assert.equal(modeModuleLevel(privOf(MOSTMA_LOADOUT, { card: false })), null);
});

// ---- deployedRecord's opts (board overlay / wheel / summon ownerRange) ---------------------------

test('deployedRecord：第 5 个参数 opts 传 3 级；不传 / 传 null 时逐字段与改动前一致', () => {
  const priv = privOf(MOSTMA_LOADOUT, { card: true });
  const l1 = G.deployedRecord(CHESS[MOSTMA_A], priv, getChess, null);
  const l3 = G.deployedRecord(CHESS[MOSTMA_A], priv, getChess, null,
    { moduleLevel: modeModuleLevel(priv), moduleLevels: LEVELS });
  assert.equal(l3.module.level, 3);
  assert.ok(attackRangeGrid(l3).length > attackRangeGrid(l1).length, '3 级模组的攻击范围更大');

  const before = G.deployedRecord(CHESS[MOSTMA_A], priv, getChess, null);
  const nullish = G.deployedRecord(CHESS[MOSTMA_A], priv, getChess, null, null);
  const empty = G.deployedRecord(CHESS[MOSTMA_A], priv, getChess, null, {});
  for (const [name, got] of [['null', nullish], ['{}', empty]]) {
    assert.deepEqual(plain(got), plain(before), `opts = ${name} 时逐字段与改动前一致`);
  }
  // 没有卡（moduleLevel null）也逐字段一致
  assert.deepEqual(plain(G.deployedRecord(CHESS[MOSTMA_A], privOf(MOSTMA_LOADOUT, { card: false }), getChess, null,
    { moduleLevel: null, moduleLevels: LEVELS })), plain(before));
});

test('previewGrid（落位轮盘 / 选中单位）：chessRecord 传了 3 级就画 3 级的范围', () => {
  const priv = privOf(MOSTMA_LOADOUT, { card: true });
  const piece = { kind: 'chess', id: MOSTMA_A };
  const l1 = previewGrid({ getChess, getToken: () => null, getItem: () => null,
    chessRecord: (rec) => G.deployedRecord(rec, privOf(MOSTMA_LOADOUT, { card: false }), getChess, null) }, piece);
  const l3 = previewGrid({ getChess, getToken: () => null, getItem: () => null,
    chessRecord: (rec) => G.deployedRecord(rec, priv, getChess, null,
      { moduleLevel: modeModuleLevel(priv), moduleLevels: LEVELS }) }, piece);
  assert.ok(l3.length > l1.length, '轮盘画的范围跟着 3 级走');
});

test('placementContext 的 moduleLevels：召唤物 ownerRange 用召唤者 3 级模组的攻击范围', () => {
  const board = [{ uid: 1, kind: 'chess', id: MOSTMA_A, row: 10, col: 6, dir: 'RIGHT' }];
  const withCard = { ...privOf(MOSTMA_LOADOUT, { card: true }), board };
  const noCard = { ...privOf(MOSTMA_LOADOUT, { card: false }), board };
  const getToken = () => ({ ownerRange: true, position: 'MELEE' }); // 「只能部署在召唤者攻击范围内」的召唤物
  const ctxOf = (priv) => G.placementContext({ priv, stage: null, editable: true, getChess, getToken, moduleLevels: LEVELS });
  const token = { kind: 'token', id: 'token_probe', uid: 2, ownerUid: 1 };
  const r1 = G.summonRange(ctxOf(noCard), token);
  const r3 = G.summonRange(ctxOf(withCard), token);
  assert.ok(r1 && r3, '两个上下文都算得出召唤范围');
  assert.ok(r3.size > r1.size, `3 级模组的 ownerRange 更大（${r1.size} → ${r3.size}）`);
  assert.equal(ctxOf(noCard).moduleLevels, LEVELS, '上下文带着 moduleLevels（没有卡时也不影响，ownerRangeOf 自己判）');
});

// ---- stand-ins never take it --------------------------------------------------------------------

test('deployedRecord：补位干员不套 3 级（技能的不可更改不因【特限恢复】改变）', () => {
  const backups = data.get('backups');
  // 银灰 不持有（standIns）⇒ 显示 Sharp 的补位记录
  const SILVER = 'chess_char_4_22_a';
  const priv = { ...privOf({ [SILVER]: { module: 'uniequip_002_svrash' } }, { card: true }), standIns: [SILVER] };
  const base = G.deployedRecord(CHESS[SILVER], priv, getChess, backups);
  const withOpts = G.deployedRecord(CHESS[SILVER], priv, getChess, backups,
    { moduleLevel: 3, moduleLevels: LEVELS });
  assert.equal(base.charId, withOpts.charId, '补位记录本身就是它自己');
  assert.deepEqual(plain(withOpts), plain(base), '补位分支忽略 opts，逐字段一致');
  assert.deepEqual(plain(G.standInLoadout(withOpts, getChess, backups)), plain(G.standInLoadout(base, getChess, backups)));
});

// ---- the call sites the screens use -------------------------------------------------------------

test('调用点都接线了：shopBar / range.js / game.js / standIn.js / placement.js 读的是同一份判据', () => {
  const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
  const shop = read('public/js/ui/shopBar.js');
  assert.match(shop, /moduleLevel: modeModuleLevel\(priv\), moduleLevels: data\.get\('moduleLevels'\)/,
    'ChessCard 的 chessLoadout 传 moduleLevel / moduleLevels');
  const range = read('public/js/screens/game/range.js');
  assert.match(range, /moduleLevel = null, moduleLevels = null/, 'inspectRange 接受两个参数');
  assert.match(range, /chessLoadout\(detail\.chess, detail\.diy \? null : loadout, getChess, \{ moduleLevel, moduleLevels \}\)/,
    'inspectRange 把两个参数交给 chessLoadout');
  const game = read('public/js/screens/game.js');
  assert.match(game, /moduleLevel: detailModuleLevel, moduleLevels: data\.get\('moduleLevels'\)/, 'cardRange 调用点');
  assert.match(game, /moduleLevels: data\.get\('moduleLevels'\),\s*\n\s*\}\), \[priv, pub\?\.stageId/,
    'placementContext 带着 moduleLevels（召唤物 ownerRange）');
  const standIn = read('public/js/ui/gameLogic/standIn.js');
  assert.match(standIn, /export function deployedRecord\(chess, priv, getChess, backups, opts = null\)/);
  const placement = read('public/js/ui/gameLogic/placement.js');
  assert.match(placement, /from '\.\/modeModules\.js'/, 'placement.js 读的是共享判据，不是自己再写一遍');
  const mod = read('public/js/ui/gameLogic/modeModules.js');
  assert.match(mod, /export function modeModuleLevel\(priv\)/);
  assert.match(mod, /export function ownsModeModules\(priv\)/);
});
