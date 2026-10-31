// 一回合获得的资金上限 —— 协议等级 **19** 那一级的负面（业主 2026-10-29「增加限制玩家一回合最多获得30块」→
// 「把这个负面做成 n19」）。数字在 shared/protocolLevels.js 的 19 级那一行（`fundsGainCap`），唯一的执行点是
// PlayerState.addFunds（server/match/player/economy.js）。
//
// 口径（业主同一次追问里选的两条）：所有正收益都算（回合收入、效果发放、卖出返还、债务还款），超出的部分直接作废、
// 不结转；负数（先付再退的付款、对外还的债）把额度还回来；startRound 清零；测试场的工具钱与「过路钱」用 force 跳过。
// **它只属于 19 级**：0–18 级、其它难度、以及关了等级的每一局都是 0 = 不设上限（从前的经济逐字节不变）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameData } from '../../server/match/gamedata.js';
import { PROTOCOL_LEVEL_MAX, protocolLevelMods, protocolLevelEffects } from '../../shared/protocolLevels.js';
import { DATA, makeMatch, give, chessOfTier, withoutHextech } from './harness.js';

/** The toast a clipped gain sends (its msgid, not its Chinese rendering: the client translates it). */
const CAP_MSGID = '本回合获得的资金已达上限（{cap}）';

/** A solo ABYSS match at `protocolLevel` (ABYSS is the only difficulty the axis works on). */
function abyssMatch(protocolLevel, o = {}) {
  const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', humans: 1, seed: 21, fake: true, protocolLevel, data: withoutHextech(), ...o }).start();
  h.toPrep(1);
  return h;
}

test('the cap belongs to protocol level 19 only: 0–18 and every other difficulty stay uncapped', () => {
  assert.equal(PROTOCOL_LEVEL_MAX, 19);
  for (let lv = 0; lv <= 18; lv++) assert.equal(protocolLevelMods(lv, 'ABYSS')?.fundsGainCap ?? 0, 0, `L${lv}`);
  assert.equal(protocolLevelMods(19, 'ABYSS').fundsGainCap, 30);
  for (const d of ['FUNNY', 'NORMAL', 'HARD', 'TRAINING']) assert.equal(protocolLevelMods(19, d), null, d);
  // GameData reads the row: off at 0 / 18, 30 at 19, and never on a difficulty the axis does not serve
  assert.equal(new GameData(DATA, 'mode_single_abyss').fundsGainCapPerRound, 0, 'level 0 = off');
  assert.equal(new GameData(DATA, 'mode_single_abyss', { protocolLevel: 18 }).fundsGainCapPerRound, 0, 'N18 has no cap');
  assert.equal(new GameData(DATA, 'mode_single_abyss', { protocolLevel: 19 }).fundsGainCapPerRound, 30);
  assert.equal(new GameData(DATA, 'mode_single_hard', { protocolLevel: 19 }).fundsGainCapPerRound, 0, 'ABYSS only');
  // …and the level picker lists it for N19, not for N18
  assert.equal(protocolLevelEffects(19).find((e) => e.id === 'fundsCap')?.params.n, 30);
  assert.equal(protocolLevelEffects(18).some((e) => e.id === 'fundsCap'), false);
});

test('at level 0 and at N18 a big payout lands in full (the old economy is untouched)', () => {
  for (const lv of [0, 18]) {
    const h = abyssMatch(lv);
    const ps = h.ps('p_0');
    const before = ps.funds;
    assert.equal(ps.addFunds(60), 60, `L${lv}: no clipping`);
    assert.equal(ps.funds, before + 60);
    h.m.dispose();
  }
});

test('N19: one round gains at most 30 — the income counts, the overflow is discarded, the next round opens again', () => {
  const h = abyssMatch(19);
  const ps = h.ps('p_0');
  assert.equal(ps.funds, 4, 'R1 income');
  assert.equal(ps.round.fundsGained, 4, 'the round-start income counts toward the cap');
  assert.equal(ps.addFunds(20), 20);
  assert.equal(ps.addFunds(40), 6, 'only the 6 left under the cap');
  assert.equal(ps.funds, 30);
  assert.equal(ps.round.fundsGained, 30);
  assert.equal(ps.addFunds(5, { reason: 'item' }), 0, 'a gain at the cap adds nothing');
  assert.equal(ps.funds, 30);
  assert.equal(ps.pendingFunds, 0, 'the overflow is discarded, never banked into the next round');
  const capToasts = h.allTo('p_0', 'm.toast').filter((x) => x.msgid === CAP_MSGID);
  assert.equal(capToasts.length, 1, 'one notice per round, not one per clipped gain');
  assert.equal(capToasts[0].params.cap, 30);
  // the allowance is per round: startRound resets the counter and pays the new income into it
  ps.startRound(2);
  assert.equal(ps.round.fundsGained, 5, 'R2 income 5, a fresh allowance');
  assert.equal(ps.addFunds(40), 25);
  assert.equal(ps.round.fundsGained, 30);
  h.m.dispose();
});

test('N19: 卖出返还也算「获得」—— 到上限后卖出照样成功，只是不再进账', () => {
  const h = abyssMatch(19);
  const ps = h.ps('p_0');
  const ids = chessOfTier(1);
  const a = give(h.m, ps, ids[0]);
  const b = give(h.m, ps, ids[1]);
  ps.addFunds(26); // 4 + 26 = 30: this round's allowance is used up
  assert.equal(ps.round.fundsGained, 30);
  const before = ps.funds;
  assert.deepEqual(ps.sell(a.uid), { ok: true });
  assert.equal(ps.funds, before, 'no refund past the cap');
  assert.equal(ps.round.fundsGained, 30);
  // …and with one point of room it counts like any other gain
  ps.round.fundsGained = 29;
  assert.deepEqual(ps.sell(b.uid), { ok: true });
  assert.equal(ps.funds, before + 1);
  assert.equal(ps.round.fundsGained, 30);
  h.m.dispose();
});

test('N19: 负数把额度还回来（先付再退的一对不占额度），真正花掉的 spend() 不还', () => {
  const h = abyssMatch(19);
  const ps = h.ps('p_0');
  ps.addFunds(26);
  assert.equal(ps.round.fundsGained, 30);
  ps.addFunds(-10); // a refund of a payment that just went out
  assert.equal(ps.funds, 20);
  assert.equal(ps.round.fundsGained, 20, 'the room came back');
  assert.equal(ps.addFunds(15), 10, 'only 10 fit under 30');
  assert.equal(ps.round.fundsGained, 30);
  // a purchase is not a negative addFunds: spending never restores the allowance
  assert.equal(ps.spend(5), true);
  assert.equal(ps.round.fundsGained, 30);
  assert.equal(ps.addFunds(1), 0);
  // a refund only gives back what the purse actually had: 25 of the 30 came in, so 25 of the room returns
  ps.addFunds(-1000);
  assert.equal(ps.funds, 0);
  assert.equal(ps.round.fundsGained, 5);
  h.m.dispose();
});

test('N19: 测试场的工具钱不占额度（force），force 的退款也不把额度还回去', () => {
  const h = abyssMatch(19, { test: true });
  const ps = h.ps('p_0');
  const before = ps.funds;
  assert.deepEqual(h.m.handle('p_0', { t: 'g.testFunds', amount: 200 }), { ok: true });
  assert.equal(ps.funds, before + 200, 'the 测试场 hands out the whole amount');
  assert.equal(ps.round.fundsGained, 4, 'and none of it is a round gain');
  ps.addFunds(-50, { force: true });
  assert.equal(ps.round.fundsGained, 4, 'a forced refund does not open room either');
  assert.equal(ps.addFunds(30), 26, 'the ordinary allowance is still intact');
  h.m.dispose();
});
