// test/match/hex-exclusive.test.js — 第 7 回合的盟约专属协议抽取（业主 2026-10-26）以及新一批专属卡的备战半段：
// 抽卡池收窄、锻炉给薄绿/洛洛、燎原 +2 部署位、绿洲的 60/325 层里程碑、冰雪消融的价格 −1。
//
// 抽卡池的三条规则直接打 MatchHexDraft 的两个方法（_isExclusiveHexRound / _hexPoolFor），不需要真的打 7 个回合；
// 备战半段走真实的 applyHex（server/match/hextech.js），因为 spec 的执行发生在 dispatcher 里。

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { MatchHexDraft } from '../../server/match/match/hexDraft.js';
import { applyHex } from '../../server/match/hextech.js';

function fresh() {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 31, fake: true });
  h.start();
  return h;
}

test('第 7 回合的抽卡池只放 requiresBond 的盟约专属协议；没有激活核心盟约时回退普通池', () => {
  const h = fresh();
  const m = h.m;
  const ps = h.ps('p_0');
  const poolOf = (round, bonds) => {
    m.round = round;
    ps.bonds = bonds;
    return MatchHexDraft.prototype._hexPoolFor.call(m, ps);
  };
  // 炎激活：池子只剩 requiresBond: 'yanShip'（当前只有【燎原】）
  const yan = poolOf(7, { yanShip: { active: true, count: 3, layers: 0 } });
  assert.ok(yan.length >= 1, '炎激活时至少有【燎原】');
  assert.ok(yan.every((r) => r.requiresBond === 'yanShip'), '只放炎专属');
  // 两个核心盟约激活：两张专属都在
  const both = poolOf(7, {
    yanShip: { active: true, count: 3, layers: 0 },
    kjeragShip: { active: true, count: 3, layers: 0 },
  });
  assert.deepEqual(both.map((r) => r.id).sort(), ['hex_kjerag_thaw', 'hex_yan_ember']);
  // 没有核心盟约：回退普通池（有非专属卡，且数量远大于 1）
  const fallback = poolOf(7, {});
  assert.ok(fallback.length > 10, '回退到普通池');
  assert.ok(fallback.some((r) => !r.requiresBond), '普通池里必须有非专属卡');
  // 普通回合不受影响：第 6 回合仍然同时有专属与非专属
  const r6 = poolOf(6, { yanShip: { active: true, count: 3, layers: 0 } });
  assert.ok(r6.some((r) => !r.requiresBond), '普通回合不只看专属');
  assert.ok(r6.some((r) => r.requiresBond === 'yanShip'), '专属卡在普通回合也进池');
  m.dispose();
});

test('锻炉：获得时立即得到薄绿与洛洛（chess.ids 的指定干员形式）', () => {
  const h = fresh();
  const m = h.m;
  const ps = h.ps('p_0');
  const before = new Set(ps.allChess().map((p) => p.id));
  applyHex(m, ps, DATA.hextech.playerHexes.hex_forge);
  const got = ps.allChess().map((p) => DATA.chess[p.id]).filter(Boolean);
  const names = got.map((c) => c.name);
  assert.ok(names.includes('薄绿'), '获得薄绿');
  assert.ok(names.includes('洛洛'), '获得洛洛');
  assert.ok(!before.has('chess_char_3_08_a') && !before.has('chess_char_2_10_a'), '前提：之前没有这两位');
  m.dispose();
});

test('燎原：获得时部署位 +2', () => {
  const h = fresh();
  const m = h.m;
  const ps = h.ps('p_0');
  const cap0 = ps.deployCap;
  applyHex(m, ps, DATA.hextech.playerHexes.hex_yan_ember);
  assert.equal(ps.deployCap, cap0 + 2);
  m.dispose();
});

test('绿洲：萨尔贡首次到 60 层给缇缇、首次到 325 层给黄沙罗盘（每档一次）', () => {
  const h = fresh();
  const m = h.m;
  const ps = h.ps('p_0');
  applyHex(m, ps, DATA.hextech.playerHexes.hex_sargon_oasis);
  ps.addLayers('sargonShip', 60, { reason: 'test' });
  const has = (id) => ps.allChess().some((p) => p.id === id);
  assert.ok(has('chess_char_5_02_a'), '60 层给缇缇');
  const ownsItem = (id) => ps._itemLocations(id).length > 0;
  assert.ok(!ownsItem('chess_item_6_07_e_a'), '325 层之前没有罗盘');
  ps.addLayers('sargonShip', 265, { reason: 'test' });
  assert.ok(ownsItem('chess_item_6_07_e_a'), '325 层给黄沙罗盘');
  // 掉层后再次达到阈值不重复发
  ps.setLayers('sargonShip', 50, { reason: 'test' });
  ps.addLayers('sargonShip', 300, { reason: 'test' });
  const chessCount = ps.allChess().filter((p) => p.id === 'chess_char_5_02_a').length;
  assert.equal(chessCount, 1, '缇缇只发一次');
  m.dispose();
});

test('冰雪消融：获得时得到耶拉，谢拉格干员价格 −1（最低 1）', () => {
  const h = fresh();
  const m = h.m;
  const ps = h.ps('p_0');
  applyHex(m, ps, DATA.hextech.playerHexes.hex_kjerag_thaw);
  assert.ok(ps.allChess().some((p) => p.id === 'chess_char_3_20_a'), '获得耶拉');
  // 谢拉格干员（耶拉）与别的干员各取一名，比较 onPrice 的最终价
  const kj = DATA.chess.chess_char_3_20_a;
  const other = Object.values(DATA.chess).find((c) => c && !c.isGolden && Array.isArray(c.bonds) && !c.bonds.includes('kjeragShip') && c.price > 1);
  assert.ok(kj && other, '数据里有谢拉格干员与对照干员');
  const priceOf = (rec) => {
    const ev = { kind: 'chess', slot: { id: rec.chessId }, piece: { kind: 'chess', id: rec.chessId }, price: rec.price };
    m.dispatch(ps, 'onPrice', ev);
    return ev.price;
  };
  assert.equal(priceOf(kj), Math.max(1, kj.price - 1), '谢拉格 −1');
  assert.equal(priceOf(other), other.price, '其他干员不变');
  m.dispose();
});
