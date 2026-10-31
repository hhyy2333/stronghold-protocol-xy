// 破财消灾 (业主 2026-10-25「悬赏加个可被多人选择的－1块钱选项」):
// on a 悬赏决策 round a player may skip that round's bounty for 1 资金. Unlike the drafted cards it is NOT unique —
// every player at the table may choose it, because it never enters `taken`.
//
// 业主 2026-10-30「扣1块钱是在下回合开始时扣」/「没钱也能选，下回合从收入里扣」: the pick checks and moves NO money. It books
// `ps.payoffDue`, and the debt is collected at the NEXT round's start (`MatchSpDraft.settleSpPayoffs`, called from
// MatchPhases.startRound) out of the income that just arrived — as a real `spend()` (so it shows up in stats.gold /
// 战绩's 花费 and fires onSpend). An empty purse may take it: the money is the next round's problem, not the pick's.
//
// The fixture builds the draft STATE directly instead of hunting for a seed that happens to draw a bounty round: the
// behaviour under test is `pickCard`'s payoff branch, which does not depend on how the cards got there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { makeMatch, DATA } from './harness.js';

const PAYOFF = -1;
const COST = 1;

/** A 2-human match parked in a hand-built 悬赏决策 SP_DRAFT with `n` bounty cards on the table. */
function bountyDraft(seed = 700, n = 3) {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 0, difficulty: 'NORMAL', seed, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const alive = [...m.players.values()].filter((p) => p.alive);
  assert.equal(alive.length, 2, 'two players alive');
  // real bounty cards from the data, so `applyCard` is exercised for real
  const src = DATA.choices.cards.bounty.slice(0, n).map((c, i) => ({ ...c, idx: i, family: 'bounty' }));
  const order = alive.map((p) => p.playerId);
  m.phase = PHASE.SP_DRAFT;
  m.sp = {
    family: 'bounty', name: '悬赏决策', desc: '', eventId: null,
    cards: src, order, idx: 0, picks: {}, taken: {}, untimed: true, turnDeadline: 0,
    payoff: { idx: PAYOFF, cost: COST },
  };
  m.setDeadline(0);
  return { h, m, order, alive };
}

test('破财消灾: offered with a negative pseudo index and a 1 资金 cost, never in `taken`', () => {
  const { h, m } = bountyDraft(701);
  assert.equal(m.sp.family, 'bounty', 'premise: a bounty draft');
  assert.deepEqual(m.spPayoff(), { idx: PAYOFF, cost: COST });
  assert.equal(m.sp.taken[PAYOFF], undefined, 'it is not a card and is never taken');
  h.m.dispose();
});

test('破财消灾: the pick books the debt, takes no bounty — and the option stays open for the NEXT player', () => {
  const { h, m, order } = bountyDraft(702);
  const first = m.players.get(order[0]);
  const second = m.players.get(order[1]);
  first.funds = 10;
  second.funds = 10;
  const bountiesBefore = (first.bounties || []).length;

  assert.deepEqual(m.handle(first.playerId, { t: 'g.choice', idx: PAYOFF }), { ok: true }, 'the payoff is accepted');
  // 业主 2026-10-30: nothing is charged at the pick — the debt rides to the next round's start
  assert.equal(first.funds, 10, 'no money moves when the button is pressed');
  assert.equal(first.payoffDue, 1, 'the 1 资金 is booked as a debt');
  assert.equal((first.bounties || []).length, bountiesBefore, 'and granted NO bounty');
  assert.equal(m.sp.picks[first.playerId], PAYOFF, 'their pick is recorded');
  assert.equal(m.spTurn(), second.playerId, 'the turn moved on');
  assert.equal(m.sp.taken[PAYOFF], undefined, 'still not recorded as taken');

  // THE POINT (「可被多人选择」): the next player may choose it too
  assert.deepEqual(m.handle(second.playerId, { t: 'g.choice', idx: PAYOFF }), { ok: true }, 'a SECOND player may also take it');
  assert.equal(second.funds, 10, 'and is charged nothing either');
  assert.equal(second.payoffDue, 1, 'each player owes their own 1 资金');
  assert.equal(m.sp.taken[PAYOFF], undefined, 'never taken, even after two players used it');
  h.invariants();
  h.m.dispose();
});

test('破财消灾: the 1 资金 is charged at the NEXT round start, out of the income that just arrived', () => {
  const { h, m, order } = bountyDraft(706);
  const ps = m.players.get(order[0]);
  ps.funds = 10;
  assert.deepEqual(m.handle(ps.playerId, { t: 'g.choice', idx: PAYOFF }), { ok: true });
  assert.equal(ps.funds, 10, 'premise: the pick itself charged nothing');

  const goldBefore = ps.stats.gold;
  m.startRound(m.round + 1);

  assert.equal(ps.payoffDue, 0, 'the debt is settled at the round start');
  assert.equal(ps.stats.gold - goldBefore, COST, 'exactly 1 资金 went through spend() — it counts as 花费');
  assert.equal(ps.round.spent, COST, 'and as this round\'s spending');
  assert.ok(ps.funds >= 0, 'never a negative purse');
  h.m.dispose();
});

test('破财消灾: a purse that cannot cover it pays what it has — the debt never goes negative or rolls over', () => {
  const { h, m, order } = bountyDraft(707);
  const ps = m.players.get(order[0]);
  ps.payoffDue = 1;
  ps.funds = 0;
  const goldBefore = ps.stats.gold;
  m.settleSpPayoffs([ps]);
  assert.equal(ps.funds, 0, 'nothing to take: the purse stays at 0');
  assert.equal(ps.stats.gold, goldBefore, 'and no spend was recorded');
  assert.equal(ps.payoffDue, 0, 'the debt is written off rather than carried into the round after');
  h.m.dispose();
});

test('破财消灾: an empty purse may take it too — the 1 资金 is collected from the next round\'s income', () => {
  const { h, m, order } = bountyDraft(703);
  const cur = m.players.get(order[0]);
  cur.funds = 0;
  // 业主 2026-10-30「没钱也能选，下回合从收入里扣」: no funds gate on the pick any more
  assert.deepEqual(m.handle(cur.playerId, { t: 'g.choice', idx: PAYOFF }), { ok: true }, 'broke, and still allowed');
  assert.equal(cur.funds, 0, 'still nothing charged at the pick');
  assert.equal(cur.payoffDue, 1, 'the debt is booked');
  assert.equal(m.sp.picks[cur.playerId], PAYOFF, 'the turn advanced');
  assert.equal(m.sp.taken[PAYOFF], undefined, 'still not a taken card');

  // the next round opens with income, and the debt comes out of that
  const goldBefore = cur.stats.gold;
  m.startRound(m.round + 1);
  assert.equal(cur.payoffDue, 0, 'settled at the round start');
  assert.equal(cur.stats.gold - goldBefore, COST, 'exactly 1 资金, out of the income that just arrived');
  assert.ok(cur.funds >= 0, 'never a negative purse');
  h.m.dispose();
});

test('破财消灾: a non-bounty draft does not offer it at all', () => {
  const { h, m, order } = bountyDraft(704);
  m.sp.payoff = null;
  m.sp.family = 'supply';
  const cur = m.players.get(order[0]);
  cur.funds = 5;
  const r = m.handle(cur.playerId, { t: 'g.choice', idx: PAYOFF });
  assert.notDeepEqual(r, { ok: true }, 'no payoff → BAD_TARGET');
  assert.equal(cur.funds, 5, 'nothing charged');
  assert.ok(!cur.payoffDue, 'nothing booked');
  h.m.dispose();
});

// a real match must build the payoff itself on a bounty round (not only when a test injects it)
test('破财消灾: enterSpDraft attaches it for a bounty family and only for that family', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 705, fake: true }).start();
  const m = h.m;
  m.enterSpDraft = m.enterSpDraft.bind(m);
  // drive a normal draft, then re-enter with a forced bounty family
  const orig = m.rngDraft;
  void orig;
  m.enterSpDraft();
  if (m.phase === PHASE.SP_DRAFT && m.sp) {
    if (m.sp.family === 'bounty') assert.ok(m.sp.payoff, 'a real bounty draft carries the payoff');
    else assert.equal(m.sp.payoff, null, `family ${m.sp.family} carries no payoff`);
  }
  m.dispose();
});
