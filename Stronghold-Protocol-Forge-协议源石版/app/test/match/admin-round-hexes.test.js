// 业主 2026-10-25：
//   玩偶批发商 — 「增加每回合获得一个」（在原有的「获得时给一个」之上加回来）
//   管理员2 — 「第一回合随机获得一个协议源石，第3回合随机获得一个协议源石」
//   管理员3 — 「第4，10 回合获得『潘多拉』」；业主 2026-10-31「改成第5回合开始时，获得【潘多拉魔盒】」（单回合）
//
// 三条都落在同一套东西上：`data/bands.json` 里那两个手写策略的 `band_hex_grant_rounds` buff，
// 以及 `server/match/match/hexDraft.js applyBandRoundHexes`（每回合由 `startRound` 调一次）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { makeMatch, DATA } from '../match/harness.js';
import { applyHex } from '../../server/match/hextech.js';

const hexesOwned = (ps) => (ps.effects || [])
  .filter((e) => e && typeof e.key === 'string' && e.key.startsWith('hex:'))
  .map((e) => (e.data && e.data.hexId) || e.key.slice(4));

/** A started solo match whose player already picked `bandId` (the strategy draft is skipped by setting it straight). */
function withBand(bandId, seed = 4242) {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed, fake: true }).start();
  const ps = h.ps('p_0');
  if (bandId) ps.bandId = bandId;
  return { h, m: h.m, ps };
}

// ---------------------------------------------------------------------------------------------------------------
// 数据面

test('管理员2 / 管理员3 are hand-authored strategies with the new round-grant buff', () => {
  const a2 = DATA.bands.band_admin2;
  const a3 = DATA.bands.band_admin3;
  assert.ok(a2 && a3, 'both strategies exist');
  assert.equal(a2.name, '管理员2');
  assert.equal(a3.name, '管理员3');
  assert.deepEqual(a2.buffs, [{ key: 'band_hex_grant_rounds', bb: { roundA: 1, roundB: 3 }, bbStr: {} }]);
  assert.deepEqual(a3.buffs, [{ key: 'band_hex_grant_rounds', bb: { roundA: 5 }, bbStr: { hexId: 'hex_pandora' } }]);
  assert.match(a2.desc, /1、3 回合/, 'the card text names its rounds');
  assert.match(a3.desc, /第 5 回合/, 'a single-round strategy names that one round');
  assert.doesNotMatch(a3.desc, /4、10/, 'and no longer advertises the old pair');
  assert.match(a3.desc, /潘多拉/);
  // they are drafts-able like the original 管理员: no icon art, all three mode types
  for (const b of [a2, a3]) assert.deepEqual(b.modeTypeList, ['LOCAL', 'SINGLE', 'MULTI']);
  assert.equal(Object.keys(DATA.bands).length, 43, '40 official + 管理员 / 管理员2 / 管理员3');
});

test('玩偶批发商: one doll on gain AND one at every round start', () => {
  const { h, m, ps } = withBand(null, 9001);
  h.toPrep(1);
  const card = m.gd.hex('hex_dollwholesale');
  const dolls = ['chess_item_2_05_e_a', 'chess_item_2_07_e_a'];
  assert.deepEqual(card.effect.onPick.randomItem.ids, dolls);
  assert.deepEqual(card.effect.onRoundStart.randomItem.ids, dolls, 'the per-round half is back');
  const dollCount = () => (ps.hand || []).filter((p) => p && p.kind === 'item' && dolls.includes(p.id)).length;

  const before = dollCount();
  applyHex(m, ps, card);
  const afterPick = dollCount();
  assert.equal(afterPick - before, 1, 'exactly one doll on gain');
  h.toPrep(2);   // R2's round start: the card's onRoundStart runs
  assert.equal(dollCount(), afterPick + 1, 'and one more at the next round start');
  h.invariants();
  m.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// 回合判定

test('bandHexGrants: rounds and the pinned card come off the buff', () => {
  const { m, ps } = withBand('band_admin2');
  assert.deepEqual(m.bandHexGrants(ps), [{ rounds: [1, 3], hexId: null }]);
  const b3 = withBand('band_admin3');
  assert.deepEqual(b3.m.bandHexGrants(b3.ps), [{ rounds: [5], hexId: 'hex_pandora' }]);
  const none = withBand('band_orchid');
  assert.deepEqual(none.m.bandHexGrants(none.ps), [], 'a strategy without the buff grants nothing');
  for (const x of [m, b3.m, none.m]) x.dispose();
});

test('管理员2: rounds 1 and 3 give one random card each, other rounds give nothing', () => {
  const { m, ps } = withBand('band_admin2');
  const count = () => hexesOwned(ps).length;

  assert.equal(m.applyBandRoundHexes(2), 0, 'R2 is not one of its rounds');
  assert.equal(m.applyBandRoundHexes(4), 0);
  const c0 = count();
  assert.equal(m.applyBandRoundHexes(3), 1, 'R3 grants one');
  assert.equal(count(), c0 + 1, 'and it landed on the player');
  const granted = hexesOwned(ps).at(-1);
  assert.ok(m.gd.hex(granted), `the granted card is a real one (${granted})`);
  assert.equal(m.applyBandRoundHexes(3), 1, 'the same round twice would grant twice — startRound calls it once per round');
  m.dispose();
});

test('管理员3: 潘多拉魔盒 lands on R5 and nowhere else', () => {
  const { m, ps } = withBand('band_admin3');
  assert.equal(m.applyBandRoundHexes(1), 0, 'nothing at R1');
  assert.equal(m.applyBandRoundHexes(4), 0, 'R4 is no longer one of its rounds');
  assert.equal(m.applyBandRoundHexes(5), 1, 'R5 grants the card');
  // 潘多拉魔盒's own onPick replaces EVERY owned card with a random 3阶 one, itself included — so "did it fire" is
  // observable as "everything I now own is prismatic".
  const owned = hexesOwned(ps);
  assert.ok(owned.length > 0, 'the player owns cards after 潘多拉');
  for (const id of owned) assert.equal(m.gd.hex(id).rarity, 'prismatic', `${id} came from 潘多拉`);
  assert.equal(m.applyBandRoundHexes(10), 0, 'and the old second round (R10) grants nothing any more');
  m.dispose();
});

test('a full match: 管理员2 already owns one extra card when R1 starts', () => {
  // Differential: same seed, same strategy draft (the harness takes the offer's first band), and the ONLY difference is
  // `bandId` being 管理员2 when `startRound(1)` runs — which is why the band is stamped at BATTLE_CHECK, right before
  // the round starts, rather than before the draft (the draft would overwrite it).
  const run = (bandId) => {
    const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 777, fake: true }).start();
    h.drive(() => h.m.phase === PHASE.BATTLE_CHECK);
    if (bandId) h.ps('p_0').bandId = bandId;
    h.toPrep(1);
    return { h, count: hexesOwned(h.ps('p_0')).length };
  };
  const plain = run(null);
  const band = run('band_admin2');
  assert.equal(band.count, plain.count + 1, 'R1 start handed 管理员2 one extra 协议源石');
  assert.equal(band.h.m.phase, PHASE.PREP, 'and the round still reached PREP normally');
  assert.equal(band.h.ps('p_0').bandId, 'band_admin2', 'the band really stayed 管理员2 through the round start');
  band.h.invariants();
  plain.h.m.dispose();
  band.h.m.dispose();
});
