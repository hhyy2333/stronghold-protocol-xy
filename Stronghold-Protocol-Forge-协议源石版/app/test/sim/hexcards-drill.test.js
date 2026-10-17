// test/sim/hexcards-drill.test.js — 精锐训练 (hex_drill)'s per-round battle script, exercised in isolation.
//
// The card has two halves and this suite is the only net under the SECOND one:
//   * the static half (+20 % ATK / +10 ASPD points) travels as the ref's plain `battle` passive and is applied by
//     server/sim/content/hextech.js install() under the ref's own id — `hex:hex_drill`;
//   * the per-round half (`+5x%` ATK / `+4x` ASPD, `x = battle.round`) is server/sim/content/hexcards/drill.js and is
//     installed here through the documented integration point: `installDrill(hexHooks(battle))`.
//
// The two halves MUST stay apart under different buff keys: `passiveBuff` refreshes with `replace`, so if the script
// reused `hex:hex_drill` the per-round grant would silently overwrite the static one and the static +20 % / +10 would
// vanish in exactly the rounds the card is played. The first test pins both keys at once; the rest pin the numbers,
// the `x = 0` no-op and idempotence.
//
// Everything runs the REAL Battle through test/helpers/battleHarness.js (deployment, buff aggregation, markDirty), so a
// change to the stat pipeline fails here rather than in a playtest. `round` is a constructor option (the harness
// defaults it to 1); a bare battle leaves it 0.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { hexHooks } from '../../server/sim/content/hexcards/hooks.js';
import { installDrill } from '../../server/sim/content/hexcards/drill.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HEXTECH = JSON.parse(readFileSync(path.join(ROOT, 'data', 'hextech.json'), 'utf8'));

const REC = HEXTECH.playerHexes.hex_drill;
assert.ok(REC, 'data/hextech.json has no hex_drill');

/** The card's effect record as data/hextech.json carries it — `{ battle: { atkPct: 20, aspd: 10 }, drill: {...} }`. */
const EFFECT = REC.effect;

/** One `playerEffects` entry, the shape server/match/hextech.js addHexRef writes. */
const refOf = () => ({
  id: 'hex:hex_drill', key: 'hex:hex_drill', name: REC.name, desc: REC.desc, iconKind: 'hex', iconId: REC.icon,
  params: { ...EFFECT, hexId: 'hex_drill', rarity: REC.rarity }, data: { hexId: 'hex_drill', rarity: REC.rarity },
});

/** A sturdy melee operator: 500 ATK / 100 ASPD base, so the numbers below read cleanly. */
const guard = () => chessRec({
  id: 'test_guard', profession: 'WARRIOR',
  stats: { maxHp: 2000, atk: 500, def: 200, res: 0, blockCnt: 1, respawnTime: 20 },
  skill: null,
});

/** A speed-0 enemy so nothing dies and the window stays quiet (we only need battleStart). */
const dummy = () => enemyRec({ key: 'enemy_dummy', hp: 100000, atk: 1, speed: 0 });

/**
 * One battle with the whole 精锐训练 integration, driven through the PRODUCTION path: the ref reaches `install()` in
 * server/sim/content/hextech.js, which applies the static half AND dispatches `installDrill(hexHooks(battle))`. Nothing
 * is installed by hand here — if the wiring in `installHexCards` were dropped, every test below would fail.
 * @param {{ round?: number, units?: any[]|null, effects?: any[]|null, players?: any[]|null }} [o]
 */
function drillBattle({ round = 1, units = null, effects = null, players = null } = {}) {
  const list = players || [{
    playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {},
    playerEffects: effects || [refOf()],
    units: units || [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
  }];
  return makeBattle({
    defs: { chess: { test_guard: guard() }, enemies: { enemy_dummy: dummy() } },
    players: list,
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }],
    round,
    autoFinish: false,
    timeLimit: 5,
  });
}

const ops = (h) => h.battle.allyUnits.filter((u) => u && u.kind === 'op' && u.side === 'ally');
const one = (h) => ops(h)[0];
const buffsOf = (u, key) => (u.buffs || []).filter((b) => b.key === key);

/** The round half's expected mods for a round: +5x % ATK (ratio) and +4x ASPD points. */
const expectRound = (x) => ({ atkPct: (5 * x) / 100, aspd: 4 * x });

// =====================================================================================================================
// the two keys coexist (the trap the contract calls out)
// =====================================================================================================================

test('精锐训练: the static half and the per-round half live under TWO keys and both apply (R1)', () => {
  const h = drillBattle({ round: 1 });
  h.run(0.5);
  const u = one(h);

  const stat = buffsOf(u, 'hex:hex_drill');
  const round = buffsOf(u, 'hex:drill:round');
  assert.equal(stat.length, 1, 'the static `battle` passive is applied under the ref id');
  assert.equal(round.length, 1, 'the per-round half is applied under hex:drill:round');
  // the per-round key must NOT be the ref id, or `passiveBuff`'s `replace` would refresh the static half away
  assert.ok(
    (u.buffs || []).every((b) => b.key !== 'hex:hex_drill' || (b.mods.atkPct === 0.20 && b.mods.aspd === 10)),
    'hex:hex_drill still carries the STATIC numbers (a shared key would have replaced them)',
  );

  // each half keeps its own numbers (a shared key would have left only ONE of these entries, with the other's mods)
  assert.ok(Math.abs(stat[0].mods.atkPct - 0.20) < 1e-9, `static ATK +20 % (got ${stat[0].mods.atkPct})`);
  assert.equal(stat[0].mods.aspd, 10, 'static ASPD +10 points');
  const want = expectRound(1);
  assert.ok(Math.abs(round[0].mods.atkPct - want.atkPct) < 1e-9, `round ATK +5 % (got ${round[0].mods.atkPct})`);
  assert.equal(round[0].mods.aspd, want.aspd, 'round ASPD +4 points');

  // and the engine aggregated BOTH on the live stats: 500 × 1.25 = 625, 100 + 10 + 4 = 114
  assert.ok(Math.abs(u.s.atk - 625) < 1e-6, `500 ATK × 1.25 = 625 (got ${u.s.atk})`);
  assert.ok(Math.abs(u.s.aspd - 114) < 1e-9, `100 + 14 ASPD points = 114 (got ${u.s.aspd})`);
  assert.ok(Math.abs(u.s.interval - (u.s.bat * 100) / 114) < 1e-9, 'interval follows bat × 100 / aspd');
  h.invariants();
});

// =====================================================================================================================
// R1 / R6 / R11 / R14 — the numbers the owner named, uncapped
// =====================================================================================================================

test('精锐训练: R1 / R6 / R11 / R14 scale ±5 % ATK and +4 ASPD points per round, uncapped', () => {
  const cases = [
    { round: 1, atk: 625, aspd: 114 },   // +20+5 % ATK / +10+4
    { round: 6, atk: 750, aspd: 134 },   // +20+30 % / +10+24
    { round: 11, atk: 875, aspd: 154 },  // +20+55 % / +10+44
    { round: 14, atk: 950, aspd: 166 },  // +20+70 % / +10+56
  ];
  for (const c of cases) {
    const h = drillBattle({ round: c.round });
    h.run(0.5);
    const u = one(h);
    const want = expectRound(c.round);
    const round = buffsOf(u, 'hex:drill:round');
    assert.equal(round.length, 1, `R${c.round}: the round buff is present`);
    assert.ok(Math.abs(round[0].mods.atkPct - want.atkPct) < 1e-9, `R${c.round}: +5×${c.round} % ATK`);
    assert.equal(round[0].mods.aspd, want.aspd, `R${c.round}: +4×${c.round} ASPD`);
    assert.ok(Math.abs(u.s.atk - c.atk) < 1e-6, `R${c.round}: 500 × (1 + ${0.2 + want.atkPct}) = ${c.atk} (got ${u.s.atk})`);
    assert.ok(Math.abs(u.s.aspd - c.aspd) < 1e-9, `R${c.round}: ASPD ${c.aspd} (got ${u.s.aspd})`);
    h.invariants();
  }
});

// =====================================================================================================================
// x = 0 / missing — no bonus, never a throw
// =====================================================================================================================

test('精锐训练: round 0 adds nothing — the static half still applies and nothing throws', () => {
  const h = drillBattle({ round: 0 });
  assert.doesNotThrow(() => h.run(0.5));
  const u = one(h);
  assert.equal(buffsOf(u, 'hex:drill:round').length, 0, 'x = 0 → no per-round buff');
  assert.equal(buffsOf(u, 'hex:hex_drill').length, 1, 'the static half is unaffected by x');
  assert.ok(Math.abs(u.s.atk - 600) < 1e-6, `only the static +20 %: 500 × 1.2 = 600 (got ${u.s.atk})`);
  assert.ok(Math.abs(u.s.aspd - 110) < 1e-9, `only the static +10 points: 110 (got ${u.s.aspd})`);
  assert.equal(h.battle.errorCount, 0, 'no handler error from the missing round');
  h.invariants();
});

test('installDrill: 0 without the card, 0 without a round, and the count of own operators otherwise', () => {
  // the direct-call contract: `installDrill(hexHooks(battle))` reports the operators it registered the grant for
  assert.equal(installDrill(hexHooks(drillBattle({ round: 6, effects: [] }).battle)), 0, 'no owner → 0');
  assert.equal(installDrill(hexHooks(drillBattle({ round: 0 }).battle)), 0, 'x = 0 → 0');
  assert.equal(installDrill(hexHooks(drillBattle({ round: 6 }).battle)), 1, 'one own operator → 1');
  const two = drillBattle({
    round: 6,
    units: [
      { uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 },
      { uid: 2, kind: 'chess', chessId: 'test_guard', row: 10, col: 6 },
    ],
  });
  assert.equal(installDrill(hexHooks(two.battle)), 2, 'one per own operator on the field');
});

test('installDrill: a malformed / absent hook bundle is a no-op, not a throw', () => {
  assert.equal(installDrill(undefined), 0);
  assert.equal(installDrill({}), 0);
  const h = drillBattle({ round: 6 });
  assert.equal(installDrill({ battle: h.battle }), 0, 'a bundle missing the primitive helpers does nothing');
});

// =====================================================================================================================
// idempotence + several owners
// =====================================================================================================================

test('精锐训练: re-firing battleStart cannot double the round buff (persist + replace)', () => {
  const h = drillBattle({ round: 11 });
  h.run(0.5);
  const u = one(h);
  const before = buffsOf(u, 'hex:drill:round');
  assert.equal(before.length, 1, 'premise: the grant landed once');
  const atk = u.s.atk, aspd = u.s.aspd;

  h.battle.emit('battleStart', {});   // a second battleStart (content re-install / a redeploy path)
  assert.equal(buffsOf(u, 'hex:drill:round').length, 1, 'still ONE buff entry — not stacked');
  assert.ok(Math.abs(u.s.atk - atk) < 1e-9, 'ATK unchanged by the second grant');
  assert.ok(Math.abs(u.s.aspd - aspd) < 1e-9, 'ASPD unchanged by the second grant');
  h.invariants();
});

test('精锐训练: every owner of the card grants it to its own operators', () => {
  const players = [
    { playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [refOf()], units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }] },
    { playerId: 'p2', seat: 1, side: 'L', colOffset: 8, bonds: {}, playerEffects: [refOf()], units: [{ uid: 2, kind: 'chess', chessId: 'test_guard', row: 10, col: 15 }] },
  ];
  const h = drillBattle({ round: 6, players });
  h.run(0.5);
  const list = ops(h);
  assert.equal(list.length, 2, 'both boards are on the field');
  const want = expectRound(6);
  for (const u of list) {
    const round = buffsOf(u, 'hex:drill:round');
    assert.equal(round.length, 1, `uid ${u.uid} got the round half`);
    assert.ok(Math.abs(round[0].mods.atkPct - want.atkPct) < 1e-9, `uid ${u.uid}: +30 % ATK at R6`);
    assert.equal(round[0].mods.aspd, want.aspd, `uid ${u.uid}: +24 ASPD at R6`);
  }
  h.invariants();
});

test('精锐训练: the record carries the numbers the script reads (data set guard)', () => {
  assert.ok(EFFECT && EFFECT.drill, 'hex_drill.effect.drill must exist');
  assert.equal(EFFECT.drill.atkPerRound, 5, 'the +5x % ATK step of the data set');
  assert.equal(EFFECT.drill.aspdPerRound, 4, 'the +4x ASPD step of the data set');
  assert.equal(EFFECT.battle.atkPct, 20, 'the static +20 % ATK half');
  assert.equal(EFFECT.battle.aspd, 10, 'the static +10 ASPD half');
});
