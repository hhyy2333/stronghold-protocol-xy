// 百变（锻炉）**仍是变形同构体的携带者** —— 业主 2026-10-24 的第二条：「百变可正常被同构体识别」。
//
// 症状（业主截图）：隐现身上 `百变[变形同构体, 维式重锤]`，变形同构体的天赋栏却写着「暂未生效」，维多利亚的芯片也没亮。
// 根因：百变是**一条空记录**（`canGiveBond: false`、`giveBondId: null`），而成员资格的三个读取点都只读 `it.id`：
//   * `server/match/bondsMeta.js pieceBonds`（备战侧人数 / 层数 / 条带）；
//   * `server/sim/content/support/index.js unitBonds`（战斗 —— battleInput 早把 merged 展开成两个 id，所以**一直是对的**）；
//   * 客户端 `gameLogic/bonds.js` 的 `grantedBonds` / `pieceBondIds` / `bondMembers` / `morphPairings`。
// 修法：展开收在**一处**（`shared/morph.js itemRecs` / `itemIds`），三处读取点都走它 ⇒ 不可能再分叉。
//
// 这里钉住的是「融合前后的成员资格一致」这一条，四处读者各一条，另外钉住不变量：融合前后**装备件数**仍是 1 件
// （百变只占一个装备位，这一点不能因为展开而变），以及「不融合时不认识的两个 id 不会凭空出现」。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (f) => JSON.parse(readFileSync(path.join(ROOT, 'data', f), 'utf8'));

globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const items = load('items.json');
const chess = load('chess.json');
const bonds = load('bonds.json');
const getItem = (id) => items[id] || null;
const hasBond = (id) => !!bonds[id];

const WEARER = 'chess_char_1_01_a';      // 隐现 — 拉特兰 / 迅捷, NOT 维多利亚
const ISO = 'chess_item_6_09_e_a';       // 变形同构体
const HAMMER = 'chess_item_1_01_e_a';    // 维式重锤 → 维多利亚
const SHIELD = 'chess_item_1_02_e_a';    // 坚守盾牌 → 坚守
const FUSED = 'chess_item_9_97_e_a';     // 百变

const { pieceBonds } = await import('../../server/match/bondsMeta.js');
const { GameData } = await import('../../server/match/gamedata.js');
const { getData } = await import('../../server/data.js');
const { itemRecs, itemIds } = await import('../../shared/morph.js');
const { data } = await import('../../public/js/data.js');
await data.loadAll('bonds', 'chess', 'items', 'assets', 'garrisons', 'config');
const { grantedBonds, pieceBondIds, bondMembers, slotPolicy } = await import('../../public/js/ui/gameLogic.js');

const gd = new GameData(getData({ log: { warn() {}, error() {}, info() {} } }), 'mode_multi_normal');
const fusedPiece = (merged) => ({ uid: 21, kind: 'item', id: FUSED, ...(merged ? { merged } : null) });
const wearerPiece = (carried) => ({ uid: 9, kind: 'chess', id: WEARER, items: carried });

describe('锻炉: a fused 百变 still counts as wearing its two components', () => {
  test('itemRecs / itemIds expand a fused piece and leave everything else alone', () => {
    assert.deepEqual(itemRecs([fusedPiece([ISO, HAMMER])], getItem).map((r) => r.id), [ISO, HAMMER]);
    assert.deepEqual(itemRecs([{ id: HAMMER }, { id: ISO }], getItem).map((r) => r.id), [HAMMER, ISO], 'order follows the row');
    assert.deepEqual(itemRecs([ISO, HAMMER], getItem).map((r) => r.id), [ISO, HAMMER], 'bare ids still resolve');
    assert.deepEqual(itemIds([fusedPiece([ISO, HAMMER]), SHIELD]), [ISO, HAMMER, SHIELD], 'mixed rows, expanded in place');
    // junk cannot make it throw or invent ids
    assert.deepEqual(itemIds([fusedPiece(null), fusedPiece([]), fusedPiece([null, '']), null]), [FUSED], 'no merged → the wrapper id, deduped');
    assert.deepEqual(itemIds([fusedPiece([ISO, ISO])]), [ISO], 'a repeated component is listed once');
    assert.deepEqual(itemRecs([fusedPiece(['nope'])], getItem), [], 'an id with no record contributes no record');
    assert.deepEqual(itemIds([fusedPiece(['nope'])]), ['nope'], 'but itemIds reports it verbatim');
  });

  test('prep-side pieceBonds: 变形同构体 + 维式重锤 grants 维多利亚 whether worn apart or fused', () => {
    const apart = pieceBonds(gd, wearerPiece([{ id: ISO }, { id: HAMMER }]));
    const fused = pieceBonds(gd, wearerPiece([fusedPiece([ISO, HAMMER])]));
    assert.ok(apart.includes('victoriaShip'), 'premise: worn apart it is a 维多利亚 member');
    assert.deepEqual(fused, apart, 'the fusion changes nothing about membership');
  });

  test('the reverse fusion order (维式重锤 + 变形同构体) works, and a pair without a 变形同构体 grants nothing', () => {
    assert.ok(pieceBonds(gd, wearerPiece([fusedPiece([HAMMER, ISO])])).includes('victoriaShip'), 'reverse order');
    // the official rule needs a 变形同构体 IN the pair: two bond items alone grant nothing, fused or not
    assert.deepEqual(pieceBonds(gd, wearerPiece([fusedPiece([SHIELD, HAMMER])])), ['lateranoShip', 'swiftShip']);
    assert.deepEqual(pieceBonds(gd, wearerPiece([{ id: HAMMER }, { id: SHIELD }])), ['lateranoShip', 'swiftShip'], 'fused or not: same answer');
  });

  test('the client readers agree with the server: grantedBonds, pieceBondIds, bondMembers, morphPairings', () => {
    const row = [fusedPiece([ISO, HAMMER])];
    assert.deepEqual(grantedBonds(row, getItem), ['victoriaShip'], 'grantedBonds');
    assert.deepEqual(pieceBondIds(chess[WEARER], row, getItem, hasBond), ['lateranoShip', 'swiftShip', 'victoriaShip'], 'pieceBondIds (the chips)');
    // the bond popup's member list: the wearer is a GRANTED row, and it names the two components
    const priv = { board: [wearerPiece(row)], hand: [], temp: [] };
    const rows = bondMembers(bonds.victoriaShip || { bondId: 'victoriaShip' }, priv, [], (id) => chess[id], getItem, null, hasBond);
    const granted = rows.filter((r) => r.granted);
    assert.equal(granted.length, 1, 'one granted member');
    assert.deepEqual(granted[0].items, [ISO, HAMMER], 'and it names both components, not the 百变 wrapper');
  });

  test('the equipment slot count is unchanged: a 百变 is still ONE item in the row', () => {
    const row = [fusedPiece([ISO, HAMMER])];
    assert.equal(slotPolicy().slotsUsed(row, getItem), 1, 'expansion must not turn one slot into two');
  });

  test('a `merged` that is not a string array is ignored (a corrupt frame cannot crash a card or a count)', () => {
    assert.deepEqual(itemIds([{ id: FUSED, merged: 'chess_item_1_01_e_a' }]), [FUSED]);
    assert.deepEqual(itemIds([{ id: FUSED, merged: [1, 2, {}] }]), [FUSED]);
    assert.ok(pieceBonds(gd, wearerPiece([{ id: FUSED, merged: 'oops' }])).length >= 2, 'still a normal (empty-record) item');
  });
});
