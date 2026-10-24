// The strategy draft's duplicate switch (data/config.json bandDraft.duplicatesAllowed, shared/bandDraft.js; owner
// 2026-10-24 「多人可选同一个策略」): with it ON — the data's default, and what every test below runs under unless it
// says otherwise — two seats take the same strategy, the server publishes the verdict as m.public.draft.duplicatesAllowed,
// and the UI only draws the pickers' avatars (screens/bandDraft.js teammateBands). With it OFF the old 「队友已选」 rule
// stands verbatim (research 09 §5): the server refuses the pick (match/phases.js pickBand → BAD_TARGET '队友已选'), bots
// re-draw, the UI greys the card, and automatic assignments (a turn that runs out, a departing seat) give the official
// default 「华法琳」 only while no teammate holds it, else the first free strategy (match/phases.js defaultBand; the UI
// names it: bandDraft.js timeoutBand). A timed-out turn takes the highlighted band first (g.bandFocus; user playtest #4
// item 4: one countdown, BAND_TURN_SECONDS per turn, no separate step cap).
//
// The two directions are asserted side by side on purpose: the switch must ADD the allowed branch and leave the old one
// byte-for-byte as it was, so every 「队友已选」 case here passes duplicatesAllowed: false / dataOff() explicitly.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ERR, PHASE } from '../../shared/constants.js';
import { makeMatch, DATA } from '../match/harness.js';
import { teammateBands, timeoutBand, allowedBands, autoPickBand, draftClock, draftTip, draftSelection, duplicatesAllowedOf } from '../../public/js/screens/bandDraft.js';
import { BAND_TURN_SECONDS } from '../../server/match/Match.js';

const TURN_MS = BAND_TURN_SECONDS * 1000;
/** The real data with the duplicate switch OFF (data/config.json bandDraft.duplicatesAllowed: false) — the old rule. */
const dataOff = () => ({ ...DATA, config: { ...DATA.config, bandDraft: { ...DATA.config.bandDraft, duplicatesAllowed: false } } });

function draftOf(o) {
  const h = makeMatch({ mode: 'coop', ...o }).start();
  for (const ps of h.m.players.values()) if (!ps.isBot) h.m.handle(ps.playerId, { t: 'g.infoReady' });
  h.sched.advance(1);
  assert.equal(h.m.phase, PHASE.BAND_DRAFT);
  return h;
}

describe('server: skip requires a successor and remaining quota', () => {
  for (const humans of [2, 3, 4]) test(`${humans} humans: the final unpicked player cannot pass to a finished player`, () => {
    const h = draftOf({ humans, seed: 5 });
    const m = h.m;
    try {
      const order = m.draft.order.slice();
      for (let i = 0; i < order.length - 1; i++) {
        const pid = order[i];
        assert.equal(m.draftTurn(), pid);
        assert.deepEqual(m.handle(pid, { t: 'g.band', bandId: m.defaultBand(pid) }), { ok: true });
      }
      const last = order.at(-1);
      assert.equal(m.draftTurn(), last);
      assert.equal(m.publicView().draft.order.length, humans, 'the published order retains finished players');
      assert.equal(m.draft.skipsLeft[last], 1);
      assert.deepEqual(m.handle(last, { t: 'g.bandSkip' }), { error: ERR.BAD_TARGET, detail: 'nobody to pass to' });
      assert.equal(m.draftTurn(), last);
      assert.equal(m.draft.skipsLeft[last], 1, 'a refused skip consumes no quota');
      assert.deepEqual(m.handle(last, { t: 'g.band', bandId: m.defaultBand(last) }), { ok: true });
    } finally { m.dispose(); }
  });

  test('passing works before the final position, but a spent quota cannot be used again', () => {
    const h = draftOf({ humans: 3, seed: 5 });
    const m = h.m;
    try {
      const [first, second, third] = m.draft.order;
      assert.deepEqual(m.handle(first, { t: 'g.bandSkip' }), { ok: true });
      assert.equal(m.draftTurn(), second);
      assert.deepEqual(m.handle(second, { t: 'g.bandSkip' }), { ok: true });
      assert.equal(m.draftTurn(), third);
      assert.deepEqual(m.handle(third, { t: 'g.band', bandId: m.defaultBand(third) }), { ok: true });
      assert.equal(m.draftTurn(), first);
      assert.equal(m.draft.order.length - m.draft.idx, 2);
      assert.deepEqual(m.handle(first, { t: 'g.bandSkip' }), { error: ERR.ALREADY, detail: 'no skip left' });
      assert.equal(m.draftTurn(), first);
    } finally { m.dispose(); }
  });
});

describe('server: the duplicate switch (data/config.json bandDraft.duplicatesAllowed)', () => {
  test('switch ON (the data default): a teammate\'s strategy is accepted and both seats sit on it', () => {
    const h = draftOf({ humans: 3, seed: 5 });
    const m = h.m;
    assert.equal(m.gd.bandDraft.duplicatesAllowed, true);
    assert.equal(m.publicView().draft.duplicatesAllowed, true, 'the server publishes its verdict for the client');
    const [first, second, third] = m.draft.order;
    assert.deepEqual(m.handle(first, { t: 'g.band', bandId: 'band_sarkazb' }), { ok: true });
    assert.equal(m.bandTaken('band_sarkazb', second), false, 'no duplicate gate while the switch is on');
    assert.deepEqual(m.handle(second, { t: 'g.band', bandId: 'band_sarkazb' }), { ok: true }, '多人可选同一个策略');
    assert.equal(h.ps(second).lp, DATA.bands.band_sarkazb.totalHp, 'its LP is the shared strategy startLp');
    assert.equal(m.draftTurn(), third);
    assert.deepEqual(m.handle(third, { t: 'g.band', bandId: 'band_sarkazb' }), { ok: true }, 'a third seat too');
    assert.equal(h.ps(third).lp, DATA.bands.band_sarkazb.totalHp);
    assert.deepEqual(Object.values(m.draft.picks), ['band_sarkazb', 'band_sarkazb', 'band_sarkazb']);
    assert.equal(m.handle(third, { t: 'g.band', bandId: 'band_amiya' }).error, ERR.ALREADY, 'still one pick per seat');
    h.sched.advance(1);
    assert.equal(m.phase, PHASE.BATTLE_CHECK);
    m.dispose();
  });

  test('switch OFF (dataOff): the old rule verbatim — a teammate\'s band is refused with 队友已选', () => {
    const h = draftOf({ humans: 3, seed: 5, data: dataOff() });
    const m = h.m;
    assert.equal(m.gd.bandDraft.duplicatesAllowed, false);
    assert.equal(m.publicView().draft.duplicatesAllowed, false);
    const [first, second, third] = m.draft.order;
    assert.deepEqual(m.handle(first, { t: 'g.band', bandId: 'band_sarkazb' }), { ok: true });
    const dup = m.handle(second, { t: 'g.band', bandId: 'band_sarkazb' });
    assert.equal(dup.error, ERR.BAD_TARGET, 'duplicate refused');
    assert.equal(dup.detail, '队友已选');
    assert.equal(m.draftTurn(), second, 'still their turn');
    assert.equal(m.bandTaken('band_sarkazb', second), true);
    assert.equal(m.bandTaken('band_sarkazb', first), false, 'your own pick is not "taken by a teammate"');
    assert.deepEqual(m.handle(second, { t: 'g.band', bandId: 'band_lisa' }), { ok: true });
    assert.equal(m.handle(third, { t: 'g.band', bandId: 'band_lisa' }).error, ERR.BAD_TARGET);
    assert.deepEqual(m.handle(third, { t: 'g.band', bandId: 'band_amiya' }), { ok: true });
    const picks = Object.values(m.publicView().draft?.picks || m.draft.picks);
    assert.equal(new Set(picks).size, picks.length, 'all different');
    h.sched.advance(1);
    assert.equal(m.phase, PHASE.BATTLE_CHECK);
    m.dispose();
  });

  test('switch ON: a bot no longer re-draws (bands may repeat); switch OFF: bots never share one', () => {
    for (const seed of [1, 2, 3, 4, 6, 9, 11]) {
      const h = draftOf({ humans: 1, bots: 3, seed });
      const m = h.m;
      // the human picks first when it is their turn; bots pick by themselves
      h.run(() => m.phase !== PHASE.BAND_DRAFT || m.draftTurn() === 'p_0', { maxTime: 20000 });
      if (m.phase === PHASE.BAND_DRAFT) assert.deepEqual(m.handle('p_0', { t: 'g.band', bandId: 'band_bldsk' }), { ok: true });
      h.run(() => m.phase !== PHASE.BAND_DRAFT, { maxTime: 60000 });
      const ids = [...m.players.values()].map((p) => p.bandId);
      for (const id of ids) assert.ok(DATA.bands[id], 'seed ' + seed + ': ' + id);
      m.dispose();
    }
    for (const seed of [1, 2, 3, 4, 6, 9, 11]) {
      const h = draftOf({ humans: 1, bots: 3, seed, data: dataOff() });
      const m = h.m;
      h.run(() => m.phase !== PHASE.BAND_DRAFT || m.draftTurn() === 'p_0', { maxTime: 20000 });
      if (m.phase === PHASE.BAND_DRAFT) assert.deepEqual(m.handle('p_0', { t: 'g.band', bandId: 'band_bldsk' }), { ok: true });
      h.run(() => m.phase !== PHASE.BAND_DRAFT, { maxTime: 60000 });
      const ids = [...m.players.values()].map((p) => p.bandId);
      assert.equal(new Set(ids).size, ids.length, 'seed ' + seed + ' (switch off): distinct strategies ' + ids);
      for (const id of ids) assert.ok(DATA.bands[id], id);
      m.dispose();
    }
  });

  test('solo: the rule has nothing to compare against', () => {
    const h = makeMatch({ mode: 'solo', seed: 2 }).start();
    h.m.handle('p_0', { t: 'g.infoReady' });
    h.sched.advance(1);
    assert.equal(h.m.bandTaken('band_orchid', 'p_0'), false);
    assert.deepEqual(h.m.handle('p_0', { t: 'g.band', bandId: 'band_orchid' }), { ok: true });
    h.m.dispose();
  });
});

describe('UI: duplicatesAllowedOf (which verdict the screen greys by)', () => {
  test('the server\'s published verdict wins; without one gd.config decides; with neither it is allowed', () => {
    assert.equal(duplicatesAllowedOf({ draft: { duplicatesAllowed: false } }, { bandDraft: { duplicatesAllowed: true } }), false,
      'm.public.draft.duplicatesAllowed is the server\'s word — it wins over the local config');
    assert.equal(duplicatesAllowedOf({ draft: { duplicatesAllowed: true } }, { bandDraft: { duplicatesAllowed: false } }), true);
    assert.equal(duplicatesAllowedOf({ draft: {} }, { bandDraft: { duplicatesAllowed: false } }), false, 'no published verdict: gd.config');
    assert.equal(duplicatesAllowedOf(null, { bandDraft: { duplicatesAllowed: false } }), false);
    assert.equal(duplicatesAllowedOf(null, null), true, 'neither ⇒ BAND_DRAFT_DEFAULTS (the official rule)');
    assert.equal(duplicatesAllowedOf(null, {}), true);
    assert.equal(duplicatesAllowedOf({ draft: { duplicatesAllowed: 'no' } }, {}), true, 'a non-boolean never counts');
    assert.equal(duplicatesAllowedOf({ draft: { duplicatesAllowed: 0 } }, { bandDraft: { duplicatesAllowed: 0 } }), true);
  });
});
describe('UI: teammateBands', () => {
  test('maps each band a teammate picked to its pickers; never the viewer', () => {
    const picks = new Map([['a', 'band_x'], ['b', 'band_y'], ['c', 'band_x'], ['me', 'band_z']]);
    const t = teammateBands(picks, 'me');
    assert.deepEqual([...t.keys()].sort(), ['band_x', 'band_y']);
    assert.deepEqual(t.get('band_x'), ['a', 'c']);
    assert.equal(t.has('band_z'), false);
    assert.equal(teammateBands(null, 'me').size, 0);
  });
});

describe('UI: draftSelection (review regression)', () => {
  test('switch OFF: on my turn a selection a teammate took meanwhile moves to the first free band; otherwise it is kept', async () => {
    const { draftSelection } = await import('../../public/js/screens/bandDraft.js');
    const bands = [{ bandId: 'a' }, { bandId: 'b' }, { bandId: 'c' }];
    const taken = new Map([['a', ['p1']]]);
    const off = { bands, taken, duplicatesAllowed: false };
    assert.equal(draftSelection(null, { ...off, myPick: null, myTurn: false }), 'b', 'default: first free');
    assert.equal(draftSelection(null, { ...off, myPick: 'c', myTurn: false }), 'c', 'default: my pick');
    assert.equal(draftSelection('a', { ...off, myPick: null, myTurn: false }), 'a', 'browsing a taken band is fine while waiting');
    assert.equal(draftSelection('a', { ...off, myPick: null, myTurn: true }), 'b', 'my turn: off the taken band');
    assert.equal(draftSelection('c', { ...off, myPick: null, myTurn: true }), 'c', 'a free selection is kept');
    assert.equal(draftSelection('a', { ...off, myPick: 'c', myTurn: false }), 'a', 'after my pick nothing moves');
    assert.equal(draftSelection('x', { ...off, bands: [], myPick: null, myTurn: true }), 'x', 'no bands: unchanged');
  });

  test('switch ON (the default): the selection starts on the official default and never moves off a teammate pick', () => {
    const bands = [{ bandId: 'a' }, { bandId: 'b' }, { bandId: 'c' }];
    const taken = new Map([['a', ['p1']]]);
    const on = { bands, taken }; // no duplicatesAllowed ⇒ BAND_DRAFT_DEFAULTS (true)
    assert.equal(draftSelection(null, { ...on, myPick: null, myTurn: false, defaultId: 'a' }), 'a', 'the default, though a teammate holds it');
    assert.equal(draftSelection('a', { ...on, myPick: null, myTurn: true, defaultId: 'a' }), 'a', 'my turn: the taken band is NOT abandoned');
    assert.equal(draftSelection('b', { ...on, myPick: null, myTurn: true, defaultId: 'a' }), 'b', 'a selection is kept as it is');
    assert.equal(draftSelection(null, { ...on, myPick: 'c', myTurn: false, defaultId: 'a' }), 'c', 'my pick wins over the default');
    assert.equal(draftSelection('x', { ...on, myPick: null, myTurn: true }), 'x', 'no default: the current selection stands');
    assert.equal(draftSelection(null, { ...on, duplicatesAllowed: true, myPick: null, myTurn: false }), 'a', 'explicit true is the same branch');
  });
});

describe('server: automatic assignments, both directions of the duplicate switch', () => {
  /** Every seat on a real strategy; returns them. Distinctness is asserted only where the switch is off. */
  const allBands = (m) => {
    const ids = [...m.players.values()].map((p) => p.bandId);
    for (const id of ids) assert.ok(DATA.bands[id], `unknown strategy ${id}`);
    return ids;
  };
  const distinct = (m) => {
    const ids = allBands(m);
    assert.equal(new Set(ids).size, ids.length, `distinct strategies ${ids}`);
    return ids;
  };
  /** With duplicates allowed every automatic assignment is the official default outright (Match.defaultBand). */
  const allDefault = (m) => {
    const want = m.gd.bandDraft.timeoutBandId;
    for (const p of m.players.values()) {
      assert.equal(p.bandId, want, `${p.playerId} gets the official default (${want})`);
      assert.equal(p.lp, DATA.bands[want].totalHp, `${p.playerId}'s LP follows it`);
    }
    return want;
  };

  test('switch ON: a turn that runs out takes 华法琳 outright — a teammate holding it changes nothing', () => {
    const h = draftOf({ humans: 3, seed: 5 });
    const m = h.m;
    const [first, second, third] = m.draft.order;
    assert.deepEqual(m.handle(first, { t: 'g.band', bandId: 'band_bldsk' }), { ok: true });
    assert.equal(m.defaultBand(second), 'band_bldsk', 'the default, though a teammate already holds it');
    assert.equal(m.timeoutBand(second), 'band_bldsk');
    h.sched.advance(TURN_MS - 1);
    assert.equal(m.draft.picks[second], undefined, `the whole ${BAND_TURN_SECONDS} s`);
    h.sched.advance(2);
    assert.equal(m.draft.picks[second], 'band_bldsk', 'the timeout shares 华法琳 — no free-strategy hunt');
    assert.equal(h.ps(second).lp, DATA.bands.band_bldsk.totalHp, 'the LP of the assigned strategy');
    assert.equal(m.draftTurn(), third);
    h.sched.advance(TURN_MS + 1);
    assert.equal(m.draft.picks[third], 'band_bldsk');
    assert.equal(allDefault(m), 'band_bldsk', 'all three share the default');
    m.dispose();
  });

  test('switch OFF: a turn that runs out gives 华法琳 when free, else the first free strategy (sortId order)', () => {
    const h = draftOf({ humans: 3, seed: 5, data: dataOff() });
    const m = h.m;
    const [first, second, third] = m.draft.order;
    assert.deepEqual(m.handle(first, { t: 'g.band', bandId: 'band_bldsk' }), { ok: true });
    assert.equal(m.defaultBand(second), 'band_amiya', 'the next free strategy by sortId');
    assert.equal(m.timeoutBand(second), 'band_amiya');
    h.sched.advance(TURN_MS + 1);
    assert.equal(m.draft.picks[second], 'band_amiya', 'never 队友已选');
    assert.equal(h.ps(second).lp, DATA.bands.band_amiya.totalHp, 'the LP of the assigned strategy');
    assert.equal(m.draftTurn(), third);
    h.sched.advance(TURN_MS + 1);
    assert.equal(m.draft.picks[third], m.defaultBand(third));
    assert.ok(!['band_bldsk', 'band_amiya'].includes(m.draft.picks[third]), 'a third distinct one');
    distinct(m);
    m.dispose();
  });

  test('switch ON: a timeout takes the highlighted strategy even when a teammate holds it', () => {
    const h = draftOf({ humans: 3, seed: 5 });
    const m = h.m;
    const [first, second, third] = m.draft.order;
    // highlights may come before the turn; the last one counts; null clears it
    assert.deepEqual(m.handle(third, { t: 'g.bandFocus', bandId: 'band_lisa' }), { ok: true });
    assert.deepEqual(m.handle(second, { t: 'g.bandFocus', bandId: 'band_amiya' }), { ok: true });
    assert.deepEqual(m.handle(second, { t: 'g.bandFocus', bandId: 'band_sarkazb' }), { ok: true });
    assert.equal(m.handle(second, { t: 'g.bandFocus', bandId: 'band_nope' }).error, ERR.BAD_TARGET);
    assert.deepEqual(m.handle(first, { t: 'g.band', bandId: 'band_lisa' }), { ok: true });
    assert.equal(m.handle(first, { t: 'g.bandFocus', bandId: 'band_amiya' }).error, ERR.ALREADY, 'nothing to highlight after the pick');
    h.sched.advance(TURN_MS + 1);
    assert.equal(m.draft.picks[second], 'band_sarkazb', 'the highlighted strategy');
    assert.equal(h.ps(second).lp, DATA.bands.band_sarkazb.totalHp);
    // the third player highlighted band_lisa, which a teammate took — accepted now: duplicates are allowed
    assert.equal(m.timeoutBand(third), 'band_lisa', 'the highlight stands, teammate or not');
    h.sched.advance(TURN_MS + 1);
    assert.equal(m.draft.picks[third], 'band_lisa');
    allBands(m);
    m.dispose();
    const h2 = draftOf({ humans: 2, seed: 5 });
    const [a] = h2.m.draft.order;
    assert.deepEqual(h2.m.handle(a, { t: 'g.bandFocus', bandId: 'band_amiya' }), { ok: true });
    assert.deepEqual(h2.m.handle(a, { t: 'g.bandFocus' }), { ok: true }, 'cleared');
    h2.sched.advance(TURN_MS + 1);
    assert.equal(h2.m.draft.picks[a], 'band_bldsk', 'no highlight: the default');
    assert.equal(h2.m.handle(a, { t: 'g.bandFocus', bandId: 'band_amiya' }).error, ERR.ALREADY);
    h2.m.dispose();
  });

  test('switch OFF: the highlight a teammate holds falls back to the default', () => {
    const h = draftOf({ humans: 3, seed: 5, data: dataOff() });
    const m = h.m;
    const [first, second, third] = m.draft.order;
    assert.deepEqual(m.handle(first, { t: 'g.band', bandId: 'band_lisa' }), { ok: true });
    assert.deepEqual(m.handle(third, { t: 'g.bandFocus', bandId: 'band_lisa' }), { ok: true });
    assert.equal(m.timeoutBand(third), 'band_bldsk', '队友已选: never assigned');
    h.sched.advance(TURN_MS + 1);
    assert.equal(m.draft.picks[second], 'band_bldsk', 'the default while nobody holds it');
    h.sched.advance(TURN_MS + 1);
    assert.equal(m.draft.picks[third], 'band_amiya', 'the held highlight gives way to the first free strategy');
    distinct(m);
    m.dispose();
  });

  test('switch ON: every human idle — all of them take the same default (no separate step cap)', () => {
    const h = draftOf({ humans: 4, seed: 9 });
    const m = h.m;
    h.run(() => m.phase !== PHASE.BAND_DRAFT, { maxTime: 4 * TURN_MS + 1 });
    assert.equal(m.phase, PHASE.BATTLE_CHECK);
    assert.equal(allDefault(m), 'band_bldsk');
    m.dispose();
  });

  test('switch OFF: every human idle — the timeouts still assign distinct strategies (no separate step cap)', () => {
    const h = draftOf({ humans: 4, seed: 9, data: dataOff() });
    const m = h.m;
    h.run(() => m.phase !== PHASE.BAND_DRAFT, { maxTime: 4 * TURN_MS + 1 });
    assert.equal(m.phase, PHASE.BATTLE_CHECK);
    const ids = distinct(m);
    assert.ok(ids.includes('band_bldsk'), 'the first idle player still gets the official default');
    for (const ps of m.players.values()) assert.equal(ps.lp, DATA.bands[ps.bandId].totalHp, `${ps.playerId} LP follows its strategy`);
    m.dispose();
  });

  test('switch ON: the step cap (finishBandDraft) fills the leftovers with the default too', () => {
    const h = draftOf({ humans: 3, seed: 5 });
    const m = h.m;
    const [first] = m.draft.order;
    assert.deepEqual(m.handle(first, { t: 'g.band', bandId: 'band_bldsk' }), { ok: true });
    m.finishBandDraft(true);
    assert.equal(m.phase, PHASE.BATTLE_CHECK);
    assert.equal(allDefault(m), 'band_bldsk');
    m.dispose();
  });

  test('switch OFF: the step cap (finishBandDraft) assigns the remaining seats without duplicates', () => {
    const h = draftOf({ humans: 3, seed: 5, data: dataOff() });
    const m = h.m;
    const [first] = m.draft.order;
    assert.deepEqual(m.handle(first, { t: 'g.band', bandId: 'band_bldsk' }), { ok: true });
    m.finishBandDraft(true);
    distinct(m);
    assert.equal(m.phase, PHASE.BATTLE_CHECK);
    m.dispose();
  });

  test('switch ON: a departing seat passes with the default (it may repeat 华法琳)', () => {
    const h = draftOf({ humans: 3, seed: 5 });
    const m = h.m;
    const [first, second] = m.draft.order;
    assert.deepEqual(m.handle(first, { t: 'g.band', bandId: 'band_bldsk' }), { ok: true });
    m.onLeave(second);
    assert.equal(m.draft.picks[second], 'band_bldsk', 'the leaver takes the same 华法琳 its teammate holds');
    assert.ok(DATA.bands[m.draft.picks[second]]);
    m.dispose();
  });

  test('switch OFF: a departing seat passes with a free strategy; mixed with bots nobody shares one', () => {
    const h = draftOf({ humans: 3, seed: 5, data: dataOff() });
    const m = h.m;
    const [first, second] = m.draft.order;
    assert.deepEqual(m.handle(first, { t: 'g.band', bandId: 'band_bldsk' }), { ok: true });
    m.onLeave(second);
    assert.notEqual(m.draft.picks[second], 'band_bldsk', 'the leaver does not duplicate 华法琳');
    assert.ok(DATA.bands[m.draft.picks[second]]);
    m.dispose();
    for (const seed of [1, 2, 3, 4]) {
      const h2 = draftOf({ humans: 2, bots: 2, seed, data: dataOff() });
      h2.run(() => h2.m.phase !== PHASE.BAND_DRAFT, { maxTime: 4 * TURN_MS + 1 });
      distinct(h2.m);
      h2.m.dispose();
    }
  });
});

describe('UI: timeoutBand (the tip names what a timeout gives me)', () => {
  const bands = allowedBands([
    { bandId: 'band_amiya', sortId: 2 }, { bandId: 'band_bldsk', sortId: 1 }, { bandId: 'band_duyaoy', sortId: 3 },
    { bandId: 'band_solo', sortId: 0, modeTypeList: ['SINGLE'] },
  ], 'MULTI');
  test('allowedBands keeps the server order (sortId, then id) and the mode filter', () => {
    assert.deepEqual(bands.map((b) => b.bandId), ['band_bldsk', 'band_amiya', 'band_duyaoy']);
  });
  test('switch OFF: 华法琳 while free; else the first free one; never a taken one', () => {
    const off = { duplicatesAllowed: false };
    assert.equal(timeoutBand(bands, new Map(), undefined, off), 'band_bldsk');
    assert.equal(timeoutBand(bands, new Map([['band_amiya', ['a']]]), undefined, off), 'band_bldsk');
    assert.equal(timeoutBand(bands, new Map([['band_bldsk', ['a']]]), undefined, off), 'band_amiya');
    assert.equal(timeoutBand(bands, new Map([['band_bldsk', ['a']], ['band_amiya', ['b']]]), undefined, off), 'band_duyaoy');
    assert.equal(timeoutBand([], new Map(), undefined, off), 'band_bldsk', 'no data yet: the official default');
    assert.equal(timeoutBand(bands, null, undefined, off), 'band_bldsk');
  });
  test('switch ON (the default): the official default outright — a teammate holding it changes nothing', () => {
    assert.equal(timeoutBand(bands, new Map()), 'band_bldsk');
    assert.equal(timeoutBand(bands, new Map([['band_bldsk', ['a']]])), 'band_bldsk', 'no free-band hunt');
    assert.equal(timeoutBand(bands, new Map([['band_bldsk', ['a']], ['band_amiya', ['b']]])), 'band_bldsk');
    assert.equal(timeoutBand(bands, null), 'band_bldsk', 'taken is not even consulted');
    assert.equal(timeoutBand([], new Map()), 'band_bldsk', 'no data yet: the official default');
    assert.equal(timeoutBand(bands, new Map(), 'band_amiya'), 'band_amiya', 'bandDraft.timeoutBandId wins');
    assert.equal(timeoutBand([], new Map(), undefined), 'band_bldsk', 'BAND_DRAFT_DEFAULTS.timeoutBandId');
  });
  test('switch OFF: matches the server for every combination of taken strategies', () => {
    const h = draftOf({ humans: 4, seed: 3, data: dataOff() });
    const m = h.m;
    const all = allowedBands(Object.values(DATA.bands), 'MULTI');
    assert.deepEqual(all.map((b) => b.bandId), m.gd.bandIds(), 'same order as gd.bandIds');
    const [a, b, c, d] = m.draft.order;
    for (const picks of [[], ['band_bldsk'], ['band_bldsk', 'band_amiya'], ['band_amiya', 'band_duyaoy'], ['band_bldsk', 'band_amiya', 'band_duyaoy']]) {
      m.draft.picks = Object.fromEntries(picks.map((id, i) => [[a, b, c][i], id]));
      const taken = teammateBands(new Map(Object.entries(m.draft.picks)), d);
      assert.equal(timeoutBand(all, taken, undefined, { duplicatesAllowed: false }), m.defaultBand(d), `picks ${picks}`);
    }
    m.dispose();
  });
  test('switch ON: matches the server for every combination of taken strategies (the default, whatever is held)', () => {
    const h = draftOf({ humans: 4, seed: 3 });
    const m = h.m;
    assert.equal(m.gd.bandDraft.duplicatesAllowed, true);
    const all = allowedBands(Object.values(DATA.bands), 'MULTI');
    const [a, b, c, d] = m.draft.order;
    for (const picks of [[], ['band_bldsk'], ['band_bldsk', 'band_amiya'], ['band_amiya', 'band_duyaoy'], ['band_bldsk', 'band_amiya', 'band_duyaoy']]) {
      m.draft.picks = Object.fromEntries(picks.map((id, i) => [[a, b, c][i], id]));
      const taken = teammateBands(new Map(Object.entries(m.draft.picks)), d);
      assert.equal(timeoutBand(all, taken), m.defaultBand(d), `picks ${picks}`);
      assert.equal(m.defaultBand(d), m.gd.bandDraft.timeoutBandId, 'the server gives the default outright');
    }
    m.dispose();
  });
});

describe('UI: one countdown and the highlighted band (user playtest #4 item 4)', () => {
  const bands = allowedBands([
    { bandId: 'band_amiya', sortId: 2 }, { bandId: 'band_bldsk', sortId: 1 }, { bandId: 'band_duyaoy', sortId: 3 },
  ], 'MULTI');

  test('draftClock: the step header counts the current turn down (m.public.deadline = draft.turnDeadline); untimed ⇒ none', () => {
    assert.deepEqual(draftClock({ deadline: 5000, draft: { turnDeadline: 5000, turnSeconds: 30 } }), { deadline: 5000, total: 30 });
    assert.deepEqual(draftClock({ deadline: 0, draft: { turnDeadline: 7000, turnSeconds: 30 } }), { deadline: 7000, total: 30 }, 'the turn deadline stands in');
    assert.equal(draftClock({ deadline: 0, draft: { turnDeadline: 0, untimed: true, turnSeconds: 0 } }), null);
    assert.equal(draftClock({ deadline: 9000, draft: { untimed: true } }), null, 'an untimed draft shows no clock');
    assert.equal(draftClock({ deadline: 0, draft: { turnDeadline: 0 } }), null);
    assert.equal(draftClock(null), null);
    assert.deepEqual(draftClock({ deadline: 4000, draft: {} }), { deadline: 4000, total: null });
  });

  test('the server publishes one clock: deadline = turnDeadline, turnSeconds = the turn length; AI seats pick at once', () => {
    const h = draftOf({ humans: 2, bots: 2, seed: 9 });
    const m = h.m;
    h.sched.advance(1);
    const turn = m.draftTurn();
    assert.ok(turn && !turn.startsWith('ai_'), `a human's turn after the AI seats picked at once (${m.draft.order})`);
    const pub = m.publicView();
    assert.equal(pub.deadline, pub.draft.turnDeadline, 'one countdown');
    assert.equal(pub.draft.turnSeconds, BAND_TURN_SECONDS);
    assert.ok(Math.abs(pub.deadline - h.sched.now() - TURN_MS) <= 2, 'a whole turn left');
    assert.deepEqual(draftClock(pub), { deadline: pub.deadline, total: BAND_TURN_SECONDS });
    m.dispose();
  });

  test('switch OFF: autoPickBand takes the highlighted band while free, else timeoutBand; nothing after my pick', () => {
    const off = { bands, duplicatesAllowed: false };
    assert.equal(autoPickBand('band_duyaoy', { ...off, taken: new Map() }), 'band_duyaoy');
    assert.equal(autoPickBand('band_duyaoy', { ...off, taken: new Map([['band_duyaoy', ['a']]]) }), 'band_bldsk', '队友已选 ⇒ the default');
    assert.equal(autoPickBand(null, { ...off, taken: new Map() }), 'band_bldsk');
    assert.equal(autoPickBand('band_unknown', { ...off, taken: new Map() }), 'band_bldsk', 'not a band of the mode');
    assert.equal(autoPickBand('band_amiya', { ...off, taken: new Map([['band_bldsk', ['a']], ['band_amiya', ['b']]]) }), 'band_duyaoy');
    assert.equal(autoPickBand('band_amiya', { ...off, taken: new Map(), myPick: 'band_amiya' }), null);
  });

  test('switch ON (the default): autoPickBand keeps the highlighted band even when a teammate holds it', () => {
    const on = { bands }; // no duplicatesAllowed ⇒ BAND_DRAFT_DEFAULTS (true)
    assert.equal(autoPickBand('band_duyaoy', { ...on, taken: new Map() }), 'band_duyaoy');
    assert.equal(autoPickBand('band_duyaoy', { ...on, taken: new Map([['band_duyaoy', ['a']]]) }), 'band_duyaoy', '队友已选 no longer matters');
    assert.equal(autoPickBand(null, { ...on, taken: new Map([['band_bldsk', ['a']]]) }), 'band_bldsk', 'no highlight: the default outright');
    assert.equal(autoPickBand('band_unknown', { ...on, taken: new Map() }), 'band_bldsk', 'not a band of the mode ⇒ the default');
    assert.equal(autoPickBand('band_amiya', { ...on, taken: new Map([['band_bldsk', ['a']], ['band_amiya', ['b']]]) }), 'band_amiya');
    assert.equal(autoPickBand('band_amiya', { ...on, taken: new Map(), myPick: 'band_amiya' }), null);
  });

  test('switch OFF: the selection starts on what a timeout gives (华法琳 while free), so the tip names the highlighted band', () => {
    const off = { bands, duplicatesAllowed: false };
    assert.equal(draftSelection(null, { ...off, taken: new Map(), myPick: null, myTurn: false }), 'band_bldsk');
    assert.equal(draftSelection(null, { ...off, taken: new Map([['band_bldsk', ['a']]]), myPick: null, myTurn: true }), 'band_amiya');
    assert.equal(draftSelection('band_bldsk', { ...off, taken: new Map([['band_bldsk', ['a']]]), myPick: null, myTurn: true }), 'band_amiya', 'taken on my turn ⇒ the default');
  });
  test('switch ON (the default): the selection starts on 华法琳 and stays there, so the tip keeps naming it', () => {
    const on = { bands };
    assert.equal(draftSelection(null, { ...on, taken: new Map(), myPick: null, myTurn: false }), 'band_bldsk');
    assert.equal(draftSelection(null, { ...on, taken: new Map([['band_bldsk', ['a']]]), myPick: null, myTurn: true }), 'band_bldsk', 'a teammate\'s 华法琳 keeps the default');
    assert.equal(draftSelection('band_bldsk', { ...on, taken: new Map([['band_bldsk', ['a']]]), myPick: null, myTurn: true }), 'band_bldsk', 'and does not move the selection');
  });
  test('draftTip names the clock, the one skip and what a timeout gives me', () => {
    assert.match(draftTip({ timed: true, turnSeconds: 30, autoName: '华法琳' }), /每位博士有 30 秒，超时将自动选择当前选中的「华法琳」/);
    assert.match(draftTip({ timed: true, turnSeconds: 30, autoName: '阿米娅', selected: false }), /超时将自动选择「阿米娅」$/);
    assert.equal(draftTip({ timed: true, turnSeconds: 30, autoName: null }), '联合模拟在选择策略时可以进行一次跳过；每位博士有 30 秒');
    assert.equal(draftTip({ timed: false, autoName: '华法琳' }), '联合模拟在选择策略时可以进行一次跳过；本局不限时');
  });

  test('a single human with AI teammates: the draft is untimed (soloUntimed), keeps the co-op order and its skip', () => {
    const h = draftOf({ humans: 1, bots: 3, seed: 4 });
    const m = h.m;
    h.run(() => m.draftTurn() === 'p_0' || m.phase !== PHASE.BAND_DRAFT, { maxTime: 1000 });
    assert.equal(m.draftTurn(), 'p_0');
    const pub = m.publicView();
    assert.equal(pub.deadline, 0);
    assert.equal(pub.draft.untimed, true);
    assert.equal(pub.draft.turnSeconds, 0);
    assert.equal(draftClock(pub), null);
    h.sched.advance(10 * 60_000);
    assert.equal(m.phase, PHASE.BAND_DRAFT, 'waits for the player');
    assert.equal(m.draftTurn(), 'p_0');
    if (m.draft.order.length - m.draft.idx > 1) assert.deepEqual(m.handle('p_0', { t: 'g.bandSkip' }), { ok: true }, 'the co-op skip stays');
    m.dispose();
  });
});
