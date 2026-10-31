// test/match/n19-bounty-hex-funds.test.js — n19 的「海克斯提供的钱不计入 30 块上限」（业主 2026-11-01）**悬赏通道**那一半。
//
// 缺口（上一批的收尾）：走悬赏通道的协议源石钱和真悬赏金在 settle.js 里合成一笔 `ps.pendingFunds`，所以仍吃 n19 的
// 一回合上限。两条来源：
//   ① 过路费 `enemyHexPayoutFor(this, r.leaked)`（敌方协议源石，纯 hex 来源）；
//   ② 骑士金神 `hex_kazimierz_knightgold` 的击杀金币（`battle.addCoins(pid, 1, { hex: true })` → 战报 `coinsHex`）。
// 现在结算把这两笔记进 `ps.pendingHexFunds`，回合开始时 `round.js startRound` 的 income 那一笔由
// `server/match/player/economy.js _hexFundsExempt` 按它豁免；真悬赏（`r.coins` / `up.coins` 里其余部分、战术特训的
// perfect 悬赏）照旧计入额度。
//
// 覆盖：sim 的 `addCoins(…, { hex: true })` 记账 / 战报字段；结算记 `pendingHexFunds`；下一回合实际到账不吃上限；
// 同 setup 但**没有** hex 来源时真悬赏照旧被 30 削掉（对照组）；客户端结果校验把 `coinsHex` 夹在 `coins` 之内。

import test from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { DATA, makeMatch } from './harness.js';
import { validateClientResult } from '../../server/match/fields.js';
import { makeBattle } from '../helpers/battleHarness.js';

/** 一局 n19 的单人 ABYSS（等级轴只在这条难度上跑）。 */
function abyss19(seed, script) {
  const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', humans: 1, seed, fake: true, protocolLevel: 19, script }).start();
  h.toPrep(1);
  return { h, m: h.m, ps: h.ps('p_0') };
}

/** 记下下一回合那一笔 `addFunds(…, { reason: 'income' })` 的入参和实际到账额。 */
function watchIncome(ps) {
  const box = { call: null };
  const orig = ps.addFunds.bind(ps);
  ps.addFunds = (n, o = {}) => {
    const r = orig(n, o);
    if (o && o.reason === 'income') box.call = { n, r };
    return r;
  };
  return box;
}

// ---- 1. sim：addCoins 的 hex 标记与战报字段 -----------------------------------------------------------------------------

test('sim: addCoins(…, { hex: true }) 另记一份 coinsHex；不带 opts 的老调用行为不变，战报只在有值时带这个键', () => {
  const h = makeBattle({ content: 'none', bonds: { yanShip: { count: 3, active: true, tier: 1, layers: 0 } } });
  h.step();
  const pp = h.battle._perPlayer.p1;
  assert.equal(h.battle.addCoins('p1', 4), 4);
  assert.equal(pp.coins, 4);
  assert.equal(pp.coinsHex, undefined, '不带 opts：一个字节都不多记');
  assert.equal(h.battle.addCoins('p1', 3, { hex: true }), 3);
  assert.equal(pp.coins, 7, '真悬赏 + hex 钱都在 coins 里（老读法不变）');
  assert.equal(pp.coinsHex, 3, '只有标了 hex 的那 3 枚');
  assert.equal(h.battle.addCoins('p1', 2, {}), 2, '{} 不算 hex');
  assert.equal(pp.coinsHex, 3);
  h.b.forceEnd('forced');
  const r = h.result();
  assert.equal(r.perPlayer.p1.coins, 9);
  assert.equal(r.perPlayer.p1.coinsHex, 3, '战报带上 hex 那一份（结算要用它豁免）');

  // 一局没有任何 hex 钱：战报里没有这个键 ⇒ 与功能落地前逐字节相同
  const clean = makeBattle({ content: 'none' });
  clean.step();
  clean.b.addCoins('p1', 5);
  clean.b.forceEnd('forced');
  assert.equal('coinsHex' in clean.result().perPlayer.p1, false);
});

// ---- 2. 结算：hex 部分记进 pendingHexFunds，下一回合到账不吃上限 ---------------------------------------------------------

test('n19：骑士金神击杀金币 + 过路费到账不吃 30 上限，同一回合的真悬赏照旧被削', () => {
  // 一局：真悬赏 40 金 + 2 只漏怪（过路费 perLeak 1 ⇒ 2 金）+ 骑士金神 3 金（战报 coinsHex）
  const { h, m, ps } = abyss19(31, (b) => (b.kind === 'normal' && b.round === 1 ? { coins: { p_0: 40 }, leaks: { p_0: 2 } } : {}));
  assert.equal(m.gd.fundsGainCapPerRound, 30, '前提：n19 的一回合上限是 30');
  ps.lp = 300;
  m.enemyHexes = [{ id: 'ehex_toll' }];                 // 敌方【过路费】(perLeak 1 / cap 5)
  // 战报里那 3 枚骑士金神金币（生产路径：sim 的 addCoins(…, { hex: true }) → 战报 coinsHex）。
  // `lastResults` 在每次 COMBAT 开始时被整个换掉（combat.js `new Map()`），所以在 settle 的入口注入。
  const origSettle = m.settle.bind(m);
  m.settle = (plan, uniteResult) => {
    const r = m.lastResults.get('p_0');
    if (r && r.coins != null) r.coinsHex = 3;
    return origSettle(plan, uniteResult);
  };
  h.drive(() => m.phase === PHASE.SETTLE);
  assert.equal(ps.pendingFunds, 42, '真悬赏 40 + 过路费 2 都先进 pendingFunds');
  assert.equal(ps.pendingHexFunds, 5, '协议源石那部分单独记着：骑士金神 3 + 过路费 2');

  const income = m.gd.income(2);
  const box = watchIncome(ps);
  h.drive(() => m.phase === PHASE.PREP && m.round === 2);
  assert.ok(box.call, '下一回合的回合收入走 addFunds(…, { reason: \'income\' })');
  assert.equal(box.call.n, income + 42, '这一笔 = 回合收入 + 上回合结算的全部钱');
  assert.equal(box.call.r, 35, '协议源石那 5 点全额到账，其余 37 点只付上限 30');
  assert.equal(ps.round.fundsGained, 30, '只有真悬赏那部分占额度');
  assert.equal(ps.pendingHexFunds, 0, '豁免用掉即清');
  m.dispose();
});

test('n19 对照：同一局没有协议源石来源 ⇒ 真悬赏照旧被 30 削掉', () => {
  const { h, m, ps } = abyss19(33, (b) => (b.kind === 'normal' && b.round === 1 ? { coins: { p_0: 40 } } : {}));
  ps.lp = 300;
  h.drive(() => m.phase === PHASE.SETTLE);
  assert.equal(ps.pendingFunds, 40);
  assert.equal(ps.pendingHexFunds || 0, 0, '没有协议源石来源 ⇒ 不记这一份');
  const box = watchIncome(ps);
  h.drive(() => m.phase === PHASE.PREP && m.round === 2);
  assert.equal(box.call.r, 30, '40 只付上限 30');
  assert.equal(ps.round.fundsGained, 30);
  m.dispose();
});

// ---- 3. 客户端结果校验：coinsHex 被夹在 coins 之内 ----------------------------------------------------------------------

test('客户端结果校验：coinsHex 只在不超过自己报的 coins 时保留，没报就保持没有', () => {
  const spec = {
    kind: 'normal', round: 1, timeLimit: 60, flags: { layerGainsEnabled: true },
    // 一场带悬赏的敌人：`coins` 的上界由 spawn 的 bountyCoins 决定
    spawns: [{ enemyKey: 'enemy_1007_slime', count: 1, time: 0, mods: { bountyCoins: 20 } }],
    players: [{ playerId: 'p_0', seat: 0, side: 'L', colOffset: 0, units: [], bonds: {} }],
  };
  const raw = (extra) => ({
    reason: 'cleared', time: 5,
    perPlayer: { p_0: { killed: 0, total: 0, leaked: [], perfect: true, unitsEnd: [], unitStats: [], coins: 5, ...extra } },
  });
  const ok = validateClientResult(spec, raw({ coinsHex: 3 }), { gd: DATA });
  assert.equal(ok.ok, true, `诚实的战报被接受（got ${JSON.stringify(ok)}）`);
  assert.equal(ok.result.perPlayer.p_0.coins, 5);
  assert.equal(ok.result.perPlayer.p_0.coinsHex, 3);
  const clamped = validateClientResult(spec, raw({ coinsHex: 99 }), { gd: DATA });
  assert.equal(clamped.ok, true, '多报的 hex 部分不打回，夹住即可');
  assert.equal(clamped.result.perPlayer.p_0.coinsHex, 5, '豁免额不超过它自己报的 coins（永远不多发一分钱）');
  const none = validateClientResult(spec, raw({}), { gd: DATA });
  assert.equal('coinsHex' in none.result.perPlayer.p_0, false, '没报就保持没有（老形状）');
});
