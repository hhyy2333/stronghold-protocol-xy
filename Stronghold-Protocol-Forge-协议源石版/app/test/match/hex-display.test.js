// 业主 2026-10-29「优化协议源石：债务显示放债对象，给灵魂炸弹加个累计治疗量显示」—— the effects column's two new readings.
//
// Both are DISPLAY-only: no rule moves (no golden result, no counter semantics change). What the column shows, however, must
// be the SAME value the mechanic uses, so the 灵魂炸弹 case drives the real bank (player/round.js _addCumStats, the one place
// a battle result reaches the player) instead of writing a number the card would never see, and the 债务 case checks the
// pairing the watcher actually runs on.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, chessOfTier } from './harness.js';
import { applyHex } from '../../server/match/hextech.js';

/** The picker's own card row in the effects column (name = the card's). */
const debtRow = (ps) => ps.effectsView().find((e) => e.iconKind === 'hex' && e.name === '债务');
/** The 灵魂炸弹 row in the effects column. */
const bombRow = (ps) => ps.effectsView().find((e) => e.iconKind === 'hex' && e.name === '灵魂炸弹');

test('债务: the card names the 放债对象, and the teammate’s watcher names the picker back', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 0, seed: 71, fake: true });
  h.start();
  h.toPrep(1);
  const m = h.m;
  const p0 = h.ps('p_0');
  const p1 = h.ps('p_1');
  applyHex(m, p0, m.gd.hex('hex_debt'));
  // the picker's own line: the card's text plus who took the +3 (the teammate is drawn at random, there is no picker UI)
  const row = debtRow(p0);
  assert.ok(row, 'the picker still lists the card');
  assert.ok(row.desc.startsWith('获得时选取一名队友'), 'the card’s own wording is kept, not replaced');
  assert.match(row.desc, /（放债对象：P1）$/, 'and it names the teammate the +3 went to');
  // the same pairing is stamped on the ref (the 盟约寄生 convention), so a later reader never has to guess
  const ref = p0.effects.find((e) => e.key === 'hex:hex_debt');
  assert.deepEqual(ref.params.debt, { targetId: 'p_1', targetName: 'P1', untilRound: m.round + 2 });
  // the recipient does not own the card — its watcher now says whose debt it is instead of showing a bare card
  const host = p1.effectsView().find((e) => e.name === '债务（被放债）');
  assert.ok(host, 'the teammate’s effects column carries the watcher');
  assert.match(host.desc, /队友 P0 的【债务】以你为放债对象：3 回合内你购买干员时，其获得一个相同干员。/);
  h.invariants();
  m.dispose();
});

test('债务: solo the card says 放债对象：自己 and names no teammate', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, bots: 0, seed: 73, fake: true });
  h.start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  applyHex(m, ps, m.gd.hex('hex_debt'));
  const row = debtRow(ps);
  assert.ok(row, 'the card is in the column');
  assert.match(row.desc, /（放债对象：自己）$/, 'no teammate to name — the first half fell on the player itself');
  assert.equal(ps.effects.find((e) => e.key === 'hex:hex_debt').params.debt.targetId, ps.playerId);
  assert.equal(ps.effects.some((e) => e.key === 'effect:hexdebt'), false, 'and nobody is watched');
  h.invariants();
  m.dispose();
});

test('灵魂炸弹: the effects column shows the banked 本局医疗治疗量 — the same counter the battle spends', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, bots: 0, seed: 74, fake: true });
  h.start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  applyHex(m, ps, m.gd.hex('hex_soulbomb'));
  // nothing banked yet: the card reads 0 and the tile carries no badge
  let row = bombRow(ps);
  assert.ok(row, 'the card is in the column');
  assert.match(row.desc, /（本局累计治疗量：0）$/);
  assert.equal(row.counter, undefined, 'no badge before a battle banks anything');
  // the bank is written where a battle result reaches the player, NOT by the card — drive that path
  const medic = chessOfTier(1, (c) => c.profession === 'MEDIC')[0];
  assert.ok(medic, 'a tier-1 医疗干员 to heal with');
  ps._addCumStats({ unitStats: [{ defId: medic, dmg: 0, taken: 0, heal: 1234.6, kills: 0 }] });
  assert.equal(ps.counters['hex:hex_soulbomb:heal'], 1234.6, 'premise: the match banked the medical healing');
  row = bombRow(ps);
  assert.equal(row.counter, 1235, 'the tile badge is the banked total, rounded');
  assert.match(row.desc, /（本局累计治疗量：1235）$/);
  // a later battle folds in ON TOP of it (the record is the WHOLE match's, never per battle)
  ps._addCumStats({ unitStats: [{ defId: medic, dmg: 0, taken: 0, heal: 65.4, kills: 0 }] });
  row = bombRow(ps);
  assert.equal(row.counter, 1300, 'the display keeps up with the next fold');
  assert.match(row.desc, /（本局累计治疗量：1300）$/);
  // a non-medic's healing does not feed the card, so the display must not move either
  const other = chessOfTier(1, (c) => c.profession !== 'MEDIC')[0];
  assert.ok(other, 'a tier-1 non-medic operator');
  ps._addCumStats({ unitStats: [{ defId: other, dmg: 0, taken: 0, heal: 500, kills: 0 }] });
  assert.equal(ps.counters['hex:hex_soulbomb:heal'], 1300, 'premise: only 医疗干员 healing is banked');
  assert.equal(bombRow(ps).counter, 1300, 'and the display does not move');
  h.invariants();
  m.dispose();
});
