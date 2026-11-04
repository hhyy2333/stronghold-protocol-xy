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
/** The 圣佑 row in the effects column. */
const snipeRow = (ps) => ps.effectsView().find((e) => e.iconKind === 'hex' && e.name === '圣佑');

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

// 业主 2026-11-04「能否给源石协议圣佑狙击的伤害也统计一个文本，像灵魂炸弹一样显示出来」—— 同一个做法：效果栏那一行读
// 玩家身上的**对局级**计数器，战斗半边把它本场真正打出的狙击伤害写在战报上（sim/spec.js `perPlayer.hexSnipeDamage`），
// `_addCumStats` 是唯一把它存进玩家的地方。所以这里也驱动那一条路径，不自己编一个数字。
test('圣佑: the effects column shows the banked 本局累计狙击伤害 — the same counter the battle hands back', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, bots: 0, seed: 76, fake: true });
  h.start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  applyHex(m, ps, m.gd.hex('hex_laterano_sanctuary'));
  // nothing banked yet: the card reads 0 and the tile carries no badge
  let row = snipeRow(ps);
  assert.ok(row, 'the card is in the column');
  assert.match(row.desc, /（本局累计狙击伤害：0）$/);
  assert.equal(row.counter, undefined, 'no badge before a battle banks anything');
  // the battle hands the number back on its result; _addCumStats banks it (a result without unitStats still banks it —
  // the snipe total is not per-unit, so it must not ride the per-unit fold)
  ps._addCumStats({ unitStats: [], hexSnipeDamage: 1950 });
  assert.equal(ps.counters['hex:hex_laterano_sanctuary:snipe'], 1950, 'premise: the match banked the snipe damage');
  row = snipeRow(ps);
  assert.equal(row.counter, 1950, 'the tile badge is the banked total');
  assert.match(row.desc, /（本局累计狙击伤害：1950）$/);
  // a later battle folds in ON TOP of it (the record is the WHOLE match's, never per battle)
  ps._addCumStats({ unitStats: [], hexSnipeDamage: 1300 });
  row = snipeRow(ps);
  assert.equal(row.counter, 3250, 'the display keeps up with the next fold');
  assert.match(row.desc, /（本局累计狙击伤害：3250）$/);
  // the 灵魂炸弹 row is untouched by all of this (two cards, two counters)
  assert.equal(bombRow(ps), undefined, 'this player owns only 圣佑');
  h.invariants();
  m.dispose();
});

test('圣佑: 没有这张卡时战报里的狙击伤害不进任何计数器（效果栏也不会凭空多一行）', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, bots: 0, seed: 78, fake: true });
  h.start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  ps._addCumStats({ unitStats: [], hexSnipeDamage: 5000 });
  assert.equal(ps.counters['hex:hex_laterano_sanctuary:snipe'], undefined, 'the counter belongs to the card');
  assert.equal(snipeRow(ps), undefined, 'and no row appears without the card');
  h.invariants();
  h.m.dispose();
});

test('圣佑: 战报的 hexSnipeDamage 走 compactResult 的形状校验，且不进结果摘要（只影响显示）', async () => {
  const { compactResult, resultDigest } = await import('../../server/sim/spec.js');
  const withIt = compactResult({ perPlayer: { p1: { killed: 0, total: 0, hexSnipeDamage: 1234.6 } } });
  assert.equal(withIt.perPlayer.p1.hexSnipeDamage, 1235, 'kept and rounded to an integer');
  const without = compactResult({ perPlayer: { p1: { killed: 0, total: 0 } } });
  assert.equal('hexSnipeDamage' in without.perPlayer.p1, false, 'a battle that fired no snipe reports nothing');
  assert.equal(resultDigest(withIt).hash, resultDigest(without).hash, 'display-only ⇒ never splits a digest');
  // a negative / non-finite number is not a total: it is dropped, not banked
  const junk = compactResult({ perPlayer: { p1: { killed: 0, total: 0, hexSnipeDamage: -5 } } });
  assert.equal('hexSnipeDamage' in junk.perPlayer.p1, false);
});
