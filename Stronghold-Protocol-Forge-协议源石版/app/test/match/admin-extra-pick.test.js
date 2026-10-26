// 管理员 (业主 2026-10-25「管理员策略改成第一回合多选择一次海克斯」):
// round 1's hex draft hands the strategy's owner ONE extra three-card offer — pick one of your three, then a fresh
// three-card offer appears for a second pick. Replaces the old 「获得协议源石时复制一个」.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { makeMatch, DATA } from '../match/harness.js';
import { hexIdsOf } from '../../server/match/hextech.js';

/** A solo match sitting in the round-1 HEX_DRAFT with `bandId` chosen. */
function atRound1Draft(bandId, seed = 5150) {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed, fake: true, captureFrames: false }).start();
  const ps = h.ps('p_0');
  ps.bandId = bandId;
  // drive to the first hex draft (data/hextech.json format.rounds starts at 1)
  let guard = 0;
  while (h.m.phase !== PHASE.HEX_DRAFT && guard++ < 5000) {
    if (h.m.phase === PHASE.INFO_CHECK && !ps.infoReady) h.m.handle('p_0', { t: 'g.infoReady' });
    else if (h.m.phase === PHASE.BAND_DRAFT && h.m.draftTurn() === 'p_0') {
      const offer = h.m.bandOfferOf ? h.m.bandOfferOf('p_0') : null;
      h.m.handle('p_0', { t: 'g.band', bandId: offer && offer.includes(bandId) ? bandId : (offer && offer[0]) || bandId });
    } else if (h.sched) h.sched.advance(50);
    else break;
  }
  return { h, m: h.m, ps };
}

test('管理员 data: the band carries the extra-pick buff and says so', () => {
  const b = DATA.bands.band_admin;
  assert.ok(b, 'band_admin exists');
  assert.deepEqual(b.buffs.map((x) => [x.key, x.bb.count]), [['band_hex_extra_pick_r1', 1]]);
  assert.match(b.desc, /多选一次/, 'the card text describes the new mechanic');
  assert.doesNotMatch(b.desc, /复制一个/, 'the old wording is gone');
});

test('管理员: round 1 gives one extra pick, and a fresh three-card offer after the first choice', () => {
  const { h, m, ps } = atRound1Draft('band_admin');
  if (m.phase !== PHASE.HEX_DRAFT) { m.dispose(); return; }   // fixture could not reach the draft: nothing to assert
  assert.equal(m.round, 1, 'round 1');
  assert.equal(m.hex.extraPicks.p_0, 1, 'the strategy grants exactly one extra pick');
  const first = m.hexOffersNow ? null : null; void first;
  const offerBefore = m.hexOfferOf('p_0').slice();
  assert.ok(offerBefore.length >= 2, `three cards were dealt (got ${offerBefore.length})`);

  // first pick: the BASE pick is spent, the extra one is still owed ⇒ a fresh offer appears
  assert.deepEqual(m.handle('p_0', { t: 'g.hex', idx: 0 }), { ok: true });
  assert.equal(m.hexDraftDone(), false, 'not done: one pick is still owed');
  const offerAfter = m.hexOfferOf('p_0').slice();
  assert.ok(offerAfter.length >= 2, 'a NEW three-card offer was dealt for the extra pick');
  assert.notDeepEqual(offerAfter, offerBefore, 'the re-dealt offer is a fresh draw, not the same three');
  assert.equal(m.hex.extraPicks.p_0, 1, 'still owed: the extra pick is spent by the SECOND choice');

  // second pick finishes the draft
  assert.deepEqual(m.handle('p_0', { t: 'g.hex', idx: 0 }), { ok: true });
  assert.equal(m.hex.extraPicks.p_0, 0, 'the extra pick is now spent');
  assert.equal(m.hexDraftDone(), true, 'the draft is complete after the second pick');
  // and a third pick is refused
  assert.notDeepEqual(m.handle('p_0', { t: 'g.hex', idx: 0 }), { ok: true }, 'no third pick');
  m.dispose();
});

test('no strategy → exactly one pick, as before', () => {
  const { h, m } = atRound1Draft('band_orchid');   // any band without the buff
  if (m.phase !== PHASE.HEX_DRAFT) { m.dispose(); return; }
  assert.equal(m.hex.extraPicks.p_0 || 0, 0, 'no extra pick');
  assert.deepEqual(m.handle('p_0', { t: 'g.hex', idx: 0 }), { ok: true });
  assert.equal(m.hexDraftDone(), true, 'one pick and the draft is done');
  assert.notDeepEqual(m.handle('p_0', { t: 'g.hex', idx: 0 }), { ok: true }, 'a second pick is refused');
  m.dispose();
});

// 业主 2026-10-25「管理员策略有问题，不一定能选两次」: the extra pick only existed if you clicked it before the draft
// timer ran out. `_timeoutHexDraft` used to skip anyone with a pick already recorded and then force-`finishHexDraft()`,
// so a player who had spent the base pick and still OWED the extra one lost it. The deadline is not armed in a solo
// match (`soloUntimed`), so the test drives the very function the deadline calls.
test('管理员: when the timer runs out, the OWED extra pick is auto-made instead of dropped', () => {
  const { m, ps } = atRound1Draft('band_admin');
  if (m.phase !== PHASE.HEX_DRAFT) { m.dispose(); return; }
  assert.equal(m.hex.extraPicks.p_0, 1);
  assert.deepEqual(m.handle('p_0', { t: 'g.hex', idx: 0 }), { ok: true });
  assert.equal(m.hexDraftDone(), false, 'the base pick is spent, the extra one is still owed');
  const owned = hexIdsOf(ps).length;

  m._timeoutHexDraft();   // what the 30 s deadline runs

  assert.equal(m.hexDraftDone(), true, 'the draft is complete, not merely closed');
  assert.equal(hexIdsOf(ps).length, owned + 1, 'the owed extra pick was granted a second card');
  m.dispose();
});

// The same hole on the bot path: `scheduleHexBot` skipped a seat that already had a pick recorded, and the re-deal never
// re-scheduled it — in a solo match (untimed) an AI 管理员 would sit on its owed pick and wedge the draft.
test('管理员: a bot seat takes BOTH picks without waiting for a timer', () => {
  const { h, m, ps } = atRound1Draft('band_admin');
  if (m.phase !== PHASE.HEX_DRAFT) { m.dispose(); return; }
  assert.equal(m.hex.extraPicks.p_0, 1);
  const owned = hexIdsOf(ps).length;
  ps.autoplay = true;   // botControlled = isBot || left || autoplay (player/basics.js)
  m.scheduleHexBot(ps);
  // the first bot action (900 ms) picks the base card, the re-deal re-schedules the seat, and that second timer fires
  // inside the same window — no draft deadline is armed here (solo is untimed), so nothing but the re-schedule can
  // produce the second card
  h.sched.advance(2000);
  assert.equal(hexIdsOf(ps).length, owned + 2, 'the bot owns two cards, both taken by itself');
  assert.equal(m.hexDraftDone(), true, 'the draft is complete, not waiting on a timer');
  m.dispose();
});

// 业主 2026-10-26「策略『管理员』第一回合第二次三选一不给刷新不能选」: the re-dealt offer kept its OWN reroll budgets
// (the server resets them when it re-deals), but `rerollHex` still refused on "a pick is recorded" — the base pick is
// recorded by definition, so both the whole-batch and the per-card buttons answered ALREADY.
test('管理员: the second 三选一 can be rerolled (both budgets) and then picked', () => {
  const { m } = atRound1Draft('band_admin');
  if (m.phase !== PHASE.HEX_DRAFT) { m.dispose(); return; }
  assert.deepEqual(m.handle('p_0', { t: 'g.hex', idx: 0 }), { ok: true });
  const firstOffer = m.hexOfferOf('p_0').slice();
  assert.equal(m.hex.extraPicks.p_0, 1, 'the extra pick is still owed');
  assert.equal(m.hex.rerolls.p_0, 1, 'the re-dealt batch carries its own budget');
  assert.deepEqual(m.hex.slotRerolls.p_0, [1, 1, 1], 'and every card its own one');

  // 整批刷新
  assert.deepEqual(m.handle('p_0', { t: 'g.hexReroll' }), { ok: true });
  assert.equal(m.hex.rerolls.p_0, 0, 'the batch budget is spent');
  assert.notDeepEqual(m.hexOfferOf('p_0'), firstOffer, 'the batch was replaced');

  // 单张刷新
  assert.deepEqual(m.handle('p_0', { t: 'g.hexReroll', idx: 1 }), { ok: true });
  assert.equal(m.hex.slotRerolls.p_0[1], 0, 'that card spent its own budget');

  // 第二张照常可选，选完就真的结束了
  assert.deepEqual(m.handle('p_0', { t: 'g.hex', idx: 2 }), { ok: true });
  assert.equal(m.hex.extraPicks.p_0, 0);
  assert.equal(m.hexDraftDone(), true);
  // 选完之后再刷新仍然是 ALREADY（旧行为不变）
  assert.deepEqual(m.handle('p_0', { t: 'g.hexReroll' }), { error: 'ALREADY' });
  m.dispose();
});

// 同一个 bug 的另一半：第二次三选一必须是一个**真正能选**的选择。草稿只有一条 deadline（enterHexDraft 时上表），
// 旧实现换牌时不续时，于是第一次选得晚的玩家会看到新一批牌被同一个定时器立刻自动选掉 —— 屏幕上「一闪而过」。
test('管理员: the re-dealt offer re-arms the draft deadline (the second pick is not auto-made by the first timer)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 5150, fake: true, captureFrames: false }).start();
  const m = h.m;
  h.drive(() => m.phase === PHASE.HEX_DRAFT, { band: 'band_admin' });
  if (m.phase !== PHASE.HEX_DRAFT) { m.dispose(); return; }
  assert.ok(m.deadline > 0, 'a multiplayer draft is timed');
  // spend a little of the first turn, so the re-armed deadline is strictly later (in virtual time a pick made at the
  // same instant would re-arm to the very same timestamp)
  h.sched.advance(5000);
  const before = m.deadline;
  assert.deepEqual(m.handle('p_0', { t: 'g.hex', idx: 0 }), { ok: true });
  assert.ok(m.deadline > before, 'the second 三选一 gets a fresh deadline');
  assert.equal(m.hex.turnDeadline, m.deadline, 'the published countdown is the new one');
  // 旧 deadline 到点时不再替玩家做掉第二张
  h.sched.advance(Math.max(0, before - h.sched.now()) + 1);
  assert.equal(m.hex.extraPicks.p_0, 1, 'the old deadline no longer auto-picks the owed card');
  // 新 deadline 到点才走超时补选，草稿正常收尾
  h.sched.advance(Math.max(0, m.deadline - h.sched.now()) + 1);
  assert.equal(m.hex ? m.hex.extraPicks.p_0 : 0, 0, 'the new deadline resolved the owed pick');
  m.dispose();
});
