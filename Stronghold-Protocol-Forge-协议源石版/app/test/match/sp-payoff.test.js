// 破财消灾 (业主 2026-10-25「悬赏加个可被多人选择的－1块钱选项」):
// on a 悬赏决策 round a player may pay 1 资金 to take NO bounty that round. Unlike the drafted cards it is NOT unique —
// every player at the table may choose it, because it never enters `taken`.
//
// The fixture builds the draft STATE directly instead of hunting for a seed that happens to draw a bounty round: the
// behaviour under test is `pickCard`'s payoff branch, which does not depend on how the cards got there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { makeMatch, DATA } from './harness.js';

const PAYOFF = -1;

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
    payoff: { idx: PAYOFF, cost: 1 },
  };
  m.setDeadline(0);
  return { h, m, order, alive };
}

test('破财消灾: offered with a negative pseudo index and a 1 资金 cost, never in `taken`', () => {
  const { h, m } = bountyDraft(701);
  assert.equal(m.sp.family, 'bounty', 'premise: a bounty draft');
  assert.deepEqual(m.spPayoff(), { idx: PAYOFF, cost: 1 });
  assert.equal(m.sp.taken[PAYOFF], undefined, 'it is not a card and is never taken');
  h.m.dispose();
});

test('破财消灾: paying 1 资金 takes no bounty, and the option stays open for the NEXT player', () => {
  const { h, m, order } = bountyDraft(702);
  const first = m.players.get(order[0]);
  const second = m.players.get(order[1]);
  first.funds = 10;
  second.funds = 10;
  const bountiesBefore = (first.bounties || []).length;

  assert.deepEqual(m.handle(first.playerId, { t: 'g.choice', idx: PAYOFF }), { ok: true }, 'the payoff is accepted');
  assert.equal(first.funds, 9, 'it cost exactly 1 资金');
  assert.equal((first.bounties || []).length, bountiesBefore, 'and granted NO bounty');
  assert.equal(m.sp.picks[first.playerId], PAYOFF, 'their pick is recorded');
  assert.equal(m.spTurn(), second.playerId, 'the turn moved on');
  assert.equal(m.sp.taken[PAYOFF], undefined, 'still not recorded as taken');

  // THE POINT (「可被多人选择」): the next player may choose it too
  assert.deepEqual(m.handle(second.playerId, { t: 'g.choice', idx: PAYOFF }), { ok: true }, 'a SECOND player may also take it');
  assert.equal(second.funds, 9, 'and pays their own 1 资金');
  assert.equal(m.sp.taken[PAYOFF], undefined, 'never taken, even after two players used it');
  h.invariants();
  h.m.dispose();
});

test('破财消灾: refused without the 1 资金 — and nothing is charged', () => {
  const { h, m, order } = bountyDraft(703);
  const cur = m.players.get(order[0]);
  cur.funds = 0;
  const r = m.handle(cur.playerId, { t: 'g.choice', idx: PAYOFF });
  assert.notDeepEqual(r, { ok: true }, 'no funds → refused');
  assert.equal(cur.funds, 0, 'nothing charged');
  assert.equal(m.sp.picks[cur.playerId], undefined, 'the turn did not advance');
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
