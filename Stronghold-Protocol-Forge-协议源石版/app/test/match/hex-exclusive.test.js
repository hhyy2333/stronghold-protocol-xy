// test/match/hex-exclusive.test.js — 第 7 回合的盟约专属协议抽取（业主 2026-10-26）以及新一批专属卡的备战半段：
// 抽卡池收窄、锻炉给薄绿/洛洛、燎原 +2 部署位、绿洲的 60/325 层里程碑、冰雪消融的价格 −1。
//
// 抽卡池的三条规则直接打 MatchHexDraft 的两个方法（_isExclusiveHexRound / _hexPoolFor），不需要真的打 7 个回合；
// 备战半段走真实的 applyHex（server/match/hextech.js），因为 spec 的执行发生在 dispatcher 里。

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, giveItem, chessOfTier, DATA } from './harness.js';
import { MatchHexDraft } from '../../server/match/match/hexDraft.js';
import { applyHex } from '../../server/match/hextech.js';

function fresh() {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 31, fake: true });
  h.start();
  return h;
}

/** A match in R1 PREP with an empty hand / board, so `g.equip` is legal and the cap starts at the base 8. */
function prepOnly(seed = 31) {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed, fake: true });
  h.start();
  h.toPrep(1);
  h.setStage('act2autochess_m04');
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.recompute();
  return { h, m: h.m, ps };
}

/** Give the player a fresh normal operator and equip 人事部文档 (cap floor 9) onto it; returns the carrier. */
function equipHrFile(m, ps) {
  const carrier = give(m, ps, chessOfTier(1).find((c) => m.pool.has(c)));
  const hr = giveItem(m, ps, 'chess_item_6_08_e_a');
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: hr.uid, targetUid: carrier.uid }), { ok: true });
  return carrier;
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
  // 炎激活：池子只剩 requiresBond: 'yanShip'（【燎原】与 2 阶的【炎百兽】）
  const yan = poolOf(7, { yanShip: { active: true, count: 3, layers: 0 } });
  assert.ok(yan.length >= 1, '炎激活时至少有【燎原】');
  assert.ok(yan.every((r) => r.requiresBond === 'yanShip'), '只放炎专属');
  // 两个核心盟约激活：四张专属都在（炎 2 + 谢拉格 2）
  const both = poolOf(7, {
    yanShip: { active: true, count: 3, layers: 0 },
    kjeragShip: { active: true, count: 3, layers: 0 },
  });
  assert.deepEqual(both.map((r) => r.id).sort(), ['hex_kjerag_frostdeath', 'hex_kjerag_thaw', 'hex_yan_beasts', 'hex_yan_ember']);
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

// 业主 2026-11-03「人事部文档使用后再获得燎原这个协议源石，人口并不会变成11人口有bug」。
// 两张卡是两份互相独立的收益：人事部文档把部署位**至少**抬到 9（`setDeployCapAtLeast`），燎原在此基础上 +2
// （`addDeployCap`）。旧实现写成 `max(底数 + 增减量, 下限)`：增减量加在底数上、下限只跟这个和取大，于是底数 8 被
// 燎原抬成 10 之后，人事部文档那个 9 的下限就不再起作用 —— 两种顺序都是 `max(8 + 2, 9) = 10`，本该是「9 再加 2」。
// 现在底数先抬到下限、再加增减量，于是两种顺序都是 11 —— 顺序不该改变两份独立收益的总数。
test('人事部文档 + 燎原：两种获得顺序都得到 11 个部署位（业主 2026-11-03）', () => {
  // 顺序 A：先人事部文档（下限 9），再燎原（+2）
  const a = prepOnly();
  assert.equal(a.ps.deployCap, 8, '底数：官方 8');
  equipHrFile(a.m, a.ps);
  assert.equal(a.ps.deployCap, 9, '人事部文档：至少 9');
  applyHex(a.m, a.ps, DATA.hextech.playerHexes.hex_yan_ember);
  assert.equal(a.ps.deployCap, 11, '再燎原：9 + 2 = 11');
  a.m.dispose();

  // 顺序 B：先燎原（+2），再人事部文档（下限 9）—— 两张卡各算各的，顺序不改变总数
  const b = prepOnly();
  applyHex(b.m, b.ps, DATA.hextech.playerHexes.hex_yan_ember);
  assert.equal(b.ps.deployCap, 10, '燎原：8 + 2 = 10');
  equipHrFile(b.m, b.ps);
  assert.equal(b.ps.deployCap, 11, '再人事部文档：底数抬到 9，燎原的 +2 还在 ⇒ 11');

  b.m.dispose();
});

test('部署位：下限与增减量各算各的，第二份人事部文档仍然不再叠加', () => {
  const { m, ps } = prepOnly();
  const carrier = equipHrFile(m, ps);
  assert.equal(ps.deployCap, 9);
  // 第二份人事部文档：下限还是 9（setDeployCapAtLeast 只在更大时才写），不该变成 18 之类
  const hr2 = giveItem(m, ps, 'chess_item_6_08_e_a');
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: hr2.uid, targetUid: carrier.uid }), { ok: true });
  assert.equal(ps.deployCap, 9, '第二份不再叠加');
  // 燎原的 +2 落在下限**之上**，于是 9 + 2 = 11，而不是被下限吃掉
  applyHex(m, ps, DATA.hextech.playerHexes.hex_yan_ember);
  assert.equal(ps.deployCap, 11);
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

test('骑士金神：本回合每消耗 3 金把伤害加成写进卡自己的 params.battle.dmgPct，新回合清零', () => {
  const h = fresh();
  const m = h.m;
  const ps = h.ps('p_0');
  applyHex(m, ps, DATA.hextech.playerHexes.hex_kazimierz_knightgold);
  const ref = ps.effects.find((e) => e && e.data && e.data.hexId === 'hex_kazimierz_knightgold');
  assert.ok(ref, '卡在 effects 里');
  m.dispatch(ps, 'onSpend', { amount: 3, reason: 'buy' });
  assert.equal(ref.params.battle.dmgPct, 20, '3 金 → +20%');
  m.dispatch(ps, 'onSpend', { amount: 4, reason: 'buy' });
  assert.equal(ref.params.battle.dmgPct, 40, '累计 7 金 → floor(7/3)×20 = 40');
  m.dispatch(ps, 'onRoundStart', { round: 3 });
  assert.equal(ref.params.battle.dmgPct, 0, '新回合清零');
  m.dispose();
});

test('整批刷新不会把 offer 刷空；空 offer 也不再算「欠一次选牌」（第 7 回合专属池被占满时的卡死回归）', () => {
  const h = fresh();
  const m = h.m;
  const ps = h.ps('p_0');
  // 第 7 回合、炎激活：池子只有【燎原】+【炎百兽】两张，而它们正躺在 offer 里。整批刷新的 `owned` 同时带着
  // 「已拥有 + 当前 offer」，旧代码于是抽到空数组、把 offer 清空 —— 玩家欠一次选牌却没有牌可选。限时的局靠超时兜底，
  // 单人 / 单人不限时的局没有 deadline（enterHexDraft 在 untimed 时不 arm），整局永远卡在 HEX_DRAFT（fuzz seed 27 实测）。
  m.round = 7;
  m.phase = 'HEX_DRAFT';
  ps.bonds = { yanShip: { active: true, count: 3, layers: 0 } };
  const pool = [DATA.hextech.playerHexes.hex_yan_ember.id, DATA.hextech.playerHexes.hex_yan_beasts.id];
  m.hex = {
    offers: { p_0: pool }, picks: {}, rerolls: { p_0: 1 }, slotRerolls: { p_0: [1] }, extraPicks: { p_0: 0 },
    untimed: true, turnDeadline: 0,
  };
  assert.deepEqual(m.rerollHex(ps), { ok: true });
  assert.deepEqual(m.hexOfferOf('p_0'), pool, '抽不出新的一批就保留原来那一批');
  // 真的空 offer（池子被抽干 / 工坊包的极小池子）不再算欠一次选牌，phase 不会永远等下去
  m.hex.offers.p_0 = [];
  assert.equal(m._hexPicksLeft('p_0'), 0);
  assert.equal(m.hexDraftDone(), true);
  m.dispose();
});
