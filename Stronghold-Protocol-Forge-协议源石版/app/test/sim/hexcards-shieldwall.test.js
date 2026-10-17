// test/sim/hexcards-shieldwall.test.js — 盾墙 (hex_shieldwall) adjacent-重装 damage / healing split.
//
// The card's STATIC half (+1 block / +20 % max HP) is the plain `battle` passive of data/hextech.json and is covered by
// test/sim/hextech-battle.test.js. THIS suite covers the script half only: server/sim/content/hexcards/shieldwall.js —
// `adjacentTanks(battle, unit, ownerId)` and `installShieldwall(hexHooks(battle))`.
//
// The cases run through the real simulation (test/helpers/battleHarness.js) and the REAL integration point: the module is
// installed by server/sim/content/hextech.js `install()` → `installHexCards()` → `installShieldwall(hexHooks(battle))`,
// exactly as a match installs it. Nothing is mocked — the hook bundle (hexcards/hooks.js) and the damage pipeline
// (server/sim/damage.js) both do the work. Units are placed with `abs: true` (raw field tiles), so adjacency is exact and
// independent of a player's `colOffset` mapping.
//
// Two things the numbers depend on:
//   * the card's own static passive is live in every battle here, so a 盾墙 owner's operator has maxHp × 1.2. Every
//     assertion therefore works in HP DELTAS, never absolute HP — the script split must not be confused with the passive.
//   * a hit is cut by `ratio` (50 % by default), and the cut is re-dealt sourceless as TRUE damage over the pool measured
//     AT CUT TIME: a member that has already left the field is not in that pool, so the survivors are never over-billed
//     (rule 9). The pool is re-measured for every new hit — nothing is cached across hits.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';
import { hexHooks } from '../../server/sim/content/hexcards/hooks.js';
import { adjacentTanks, installShieldwall } from '../../server/sim/content/hexcards/shieldwall.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HEXTECH = JSON.parse(readFileSync(path.join(ROOT, 'data', 'hextech.json'), 'utf8'));
const CARD = 'hex_shieldwall';

/** The card's own ref — the shape server/match/hextech.js addHexRef writes. `ratioPct` overrides `effect.shieldwall`. */
function hexRef(ratioPct = null) {
  const rec = HEXTECH.playerHexes[CARD];
  assert.ok(rec, `data/hextech.json has no ${CARD}`);
  const effect = ratioPct == null
    ? rec.effect
    : { ...rec.effect, shieldwall: { ...rec.effect.shieldwall, ratio: ratioPct } };
  return {
    id: `hex:${CARD}`, key: `hex:${CARD}`, name: rec.name, desc: rec.desc, iconKind: 'hex', iconId: rec.icon,
    counter: null, battle: true, params: { ...effect, hexId: CARD, rarity: rec.rarity },
    data: { hexId: CARD, rarity: rec.rarity },
  };
}

/** A squishy 近卫 — the operator that GETS protected (it need not be a 重装: owner's answer A). */
const warrior = (id) => chessRec({ id, profession: 'WARRIOR', position: 'MELEE', stats: { maxHp: 10000, atk: 0, def: 0, res: 0, blockCnt: 1 }, skill: null });
/** A 【重装】 — the only profession that joins a 盾墙 pool. */
const tank = (id) => chessRec({ id, profession: 'TANK', position: 'MELEE', stats: { maxHp: 10000, atk: 0, def: 0, res: 0, blockCnt: 3 }, skill: null });

const DEFS = { chess: { w_a: warrior('w_a'), t_a: tank('t_a'), w_b: warrior('w_b'), t_b: tank('t_b') } };

/** A unit piece on an explicit FIELD tile (`abs: true`: no `colOffset` mapping). */
const at = (uid, chessId, row, col) => ({ uid, kind: 'chess', chessId, row, col, abs: true });
const player = (playerId, seat, units, playerEffects = []) => ({
  playerId, seat, side: 'L', colOffset: 0, bonds: {}, bandId: null, playerEffects, units,
});

/** A battle over the synthetic stage, with the card's script installed by the production content path. */
function mk(players) {
  return makeBattle({
    defs: DEFS, players, enemies: [], kind: 'normal', timeLimit: 60, autoFinish: false,
    hooks: ['hit', 'damaged', 'heal'], captureNoisy: true,
  });
}

/** One owner (`p1`) holding the card (optionally at `ratioPct`); runs one step so the units are deployed and alive. */
function solo(units, { ratioPct = null, effects = undefined } = {}) {
  const h = mk([player('p1', 0, units, effects ?? [hexRef(ratioPct)])]);
  h.run(1);
  return h;
}

/** Deal `amount` at `target`, undodgeable, from no source; returns the HP actually removed. */
const deal = (h, target, amount, type = 'true') =>
  h.battle.dealDamage(null, target, h.battle.makeDamage({ amount, type, canDodge: false }));

/** HP lost by each of `units` across `fn()` — one entry per unit, in the given order. */
function deltas(units, fn) {
  const before = units.map((u) => u.hp);
  fn();
  return units.map((u, i) => before[i] - u.hp);
}

/** HP gained by each of `units` across `fn()`. */
function gains(units, fn) {
  return deltas(units, fn).map((d) => -d);
}

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const hookCount = (h, name) => (h.battle._hooks[name] || []).length;

// =====================================================================================================================
// adjacentTanks — the pool rule itself
// =====================================================================================================================

test('adjacentTanks: 4-neighbour TANKs of the same owner, tileR-then-tileC ordered, no diagonals', () => {
  const h = solo([
    at(1, 'w_a', 10, 5),   // the measured operator (a 近卫: never in its own pool)
    at(2, 't_a', 10, 6),   // right  → member
    at(3, 't_a', 9, 5),    // up     → member
    at(4, 't_a', 11, 5),   // down   → member
    at(5, 't_a', 10, 4),   // left   → member
    at(6, 't_a', 9, 6),    // diagonal (Manhattan 2) → NOT a member
    at(7, 't_a', 10, 7),   // two tiles away → NOT a member
    at(8, 'w_a', 10, 3),   // adjacent, but a 近卫 → NOT a member
  ]);
  const w = h.unit(1);
  const pool = adjacentTanks(h.battle, w, 'p1');
  assert.deepEqual(pool.map((u) => [u.tileR, u.tileC]), [[9, 5], [10, 4], [10, 6], [11, 5]]);
  assert.ok(pool.every((u) => u.def.profession === 'TANK'), 'only 重装 join the pool');
  assert.ok(!pool.includes(w), 'the measured unit is never in its own pool');
  assert.equal(adjacentTanks(h.battle, w, 'p2').length, 0, 'an owner with no unit there has an empty pool');
});

test('adjacentTanks: a knocked-out / undeployed 重装 is off the board and out of the pool', () => {
  const h = solo([at(1, 'w_a', 10, 5), at(2, 't_a', 10, 6), at(3, 't_a', 9, 5)]);
  const w = h.unit(1), t2 = h.unit(3);
  assert.equal(adjacentTanks(h.battle, w, 'p1').length, 2, 'both are members while on the field');
  h.battle.retreat(t2, { reason: 'retreat' }); // down, not removed: still in battle.allyUnits, no longer on the field
  assert.equal(adjacentTanks(h.battle, w, 'p1').length, 1, 'the downed operator left the pool');
  assert.ok(h.battle.allyUnits.includes(t2), 'and it is still listed — the filter is `onField`, not absence');
});

test('adjacentTanks: another owner\'s 重装 is never a member (the owner must match)', () => {
  const h = mk([
    player('p1', 0, [at(1, 'w_a', 10, 5)], [hexRef()]),
    player('p2', 1, [at(9, 't_b', 9, 5)], []), // adjacent to w_a, a 重装, OWNED BY p2
  ]);
  h.run(1);
  assert.equal(adjacentTanks(h.battle, h.unit(1), 'p1').length, 0, 'the teammate\'s 重装 is not in p1\'s pool');
  assert.equal(adjacentTanks(h.battle, h.unit(9), 'p2').length, 0, 'and p1\'s 近卫 is no 重装 for p2 either');
});

// =====================================================================================================================
// damage split
// =====================================================================================================================

test('shieldwall damage: one adjacent 重装 takes the whole 50 % share', () => {
  const h = solo([at(1, 'w_a', 10, 5), at(2, 't_a', 10, 6)]);
  const w = h.unit(1), t = h.unit(2);
  const [dw, dt] = deltas([w, t], () => deal(h, w, 200));
  assert.ok(near(dw, 100), `the 近卫 kept half (lost ${dw})`);
  assert.ok(near(dt, 100), `the 重装 bore the other half (lost ${dt})`);
  assert.equal(h.battle.errors.length, 0);
  h.invariants();
});

test('shieldwall damage: two adjacent 重装 split the share evenly', () => {
  const h = solo([at(1, 'w_a', 10, 5), at(2, 't_a', 10, 6), at(3, 't_a', 9, 5)]);
  const w = h.unit(1), t1 = h.unit(2), t2 = h.unit(3);
  const [dw, d1, d2] = deltas([w, t1, t2], () => deal(h, w, 200));
  assert.ok(near(dw, 100), 'the target kept 100');
  assert.ok(near(d1, 50) && near(d2, 50), 'each 重装 bore 50 of the 100 split');
  assert.ok(near(dw + d1 + d2, 200), 'nothing is created or lost');
  h.invariants();
});

test('shieldwall damage: the split is re-dealt sourceless, as true damage, tagged hex:shieldwall', () => {
  const h = solo([at(1, 'w_a', 10, 5), at(2, 't_a', 10, 6)]);
  const w = h.unit(1), t = h.unit(2);
  const seen = [];
  h.battle.on('hit', (c) => {
    if (c.dmg && c.dmg.shellSplit) seen.push({ source: c.source, type: c.dmg.type, tags: [...(c.dmg.tags || [])], amount: c.dmg.amount, canDodge: c.dmg.canDodge });
  }, { priority: 50 }); // priority 50 runs before the script's own -20 handler
  const [, dt] = deltas([w, t], () => deal(h, w, 200));
  assert.equal(seen.length, 1, 'exactly one handed-out instance');
  assert.equal(seen[0].source, null, 'sourceless: never scaled a second time by whoever swung');
  assert.equal(seen[0].type, 'true', 'true damage: never mitigated a second time');
  assert.equal(seen[0].canDodge, false);
  assert.deepEqual(seen[0].tags, ['hex:shieldwall']);
  assert.ok(near(seen[0].amount, 100), 'the share is base × ratio ÷ pool.length');
  assert.ok(near(dt, 100));
});

test('shieldwall damage: the ratio is read from the VICTIM\'s owner card (percentage; 50 is the default)', () => {
  // two owners, two ratios: p1 fields 25 % (keeps 75 %), p2 fields 50 % — a hit is split by the ratio of whoever owns
  // the operator that was hit.
  const h = mk([
    player('p1', 0, [at(1, 'w_a', 10, 5), at(2, 't_a', 10, 6)], [hexRef(25)]),
    player('p2', 1, [at(3, 'w_b', 11, 5), at(4, 't_b', 11, 6)], [hexRef(50)]),
  ]);
  h.run(1);
  const w1 = h.unit(1), t1 = h.unit(2), w2 = h.unit(3), t2 = h.unit(4);
  const [l1, m1] = deltas([w1, t1], () => deal(h, w1, 200));
  assert.ok(near(l1, 150), `p1's 近卫 kept 75 % of 200 (lost ${l1})`);
  assert.ok(near(m1, 50), `p1's 重装 took the 25 % cut (lost ${m1})`);
  const [l2, m2] = deltas([w2, t2], () => deal(h, w2, 200));
  assert.ok(near(l2, 100), `p2's 近卫 kept 50 % (lost ${l2})`);
  assert.ok(near(m2, 100), `p2's 重装 took the 50 % cut (lost ${m2})`);
  h.invariants();
});

test('shieldwall damage: an upstream cut composes — the split takes its share of what is LEFT', () => {
  // 坚守盟约's redirect cuts `dmg.mul` in the same -20 slot. A second cutter at -19 runs first (higher priority =
  // earlier), which is exactly the "cut first, then split what is left" composition the header names.
  const h = solo([at(1, 'w_a', 10, 5), at(2, 't_a', 10, 6)]);
  const w = h.unit(1), t = h.unit(2);
  h.battle.on('hit', (c) => { if (c.target === w && c.dmg && !c.dmg.shellCut && !c.dmg.shellSplit) c.dmg.mul *= 0.5; }, { priority: -19 });
  const [dw, dt] = deltas([w, t], () => deal(h, w, 200));
  assert.ok(near(dw, 50), `200 → 100 upstream, then half of that to the target (lost ${dw})`);
  assert.ok(near(dt, 50), `the 重装 bore the other half of the post-cut 100 (lost ${dt})`);
});

test('shieldwall damage: a split instance is never split again (no chain onto a member\'s neighbour)', () => {
  // w_a(10,5) — t_a(10,6) — t_a(10,7): the member has a 重装 neighbour of its own. If the handed-out instance could
  // split, t_a2 would take half of t_a1's share.
  const h = solo([at(1, 'w_a', 10, 5), at(2, 't_a', 10, 6), at(3, 't_a', 10, 7)]);
  const w = h.unit(1), t1 = h.unit(2), t2 = h.unit(3);
  const [dw, d1, d2] = deltas([w, t1, t2], () => deal(h, w, 200));
  assert.ok(near(dw, 100), 'the target kept 100');
  assert.ok(near(d1, 100), 'the member took its whole 100 share, unsplit');
  assert.ok(near(d2, 0), 'the member\'s own neighbour was never touched');
  assert.equal(h.battle.errors.length, 0);
});

test('shieldwall damage: 流失 and an 元素损伤 fill are not split', () => {
  const h = solo([at(1, 'w_a', 10, 5), at(2, 't_a', 10, 6), at(3, 'w_b', 11, 5), at(4, 't_b', 11, 6)]);
  const w = h.unit(1), t = h.unit(2), w2 = h.unit(3), t2 = h.unit(4);
  const [lw, lt] = deltas([w, t], () => h.battle.loseHp(w, 200, {})); // 流失: no 受到伤害 (isHpLoss)
  assert.ok(near(lw, 200), `a 流失 lands in full (lost ${lw})`);
  assert.ok(near(lt, 0), 'nothing is split for a 流失');
  // dealDamage routes a type-'element' instance to the gauge BEFORE the `hit` hook ever runs, so an element fill can
  // never reach the split; drive the guard directly to prove the handler itself refuses one.
  const el = h.battle.makeDamage({ amount: 200, type: 'element', element: 'burn', canDodge: false });
  h.battle.emit('hit', { source: null, target: w2, dmg: el, credit: null });
  assert.equal(el.mul, 1, 'an 元素损伤 fill is not cut');
  assert.equal(el.shellCut, undefined, 'and it is not marked for a share either');
  assert.ok(near(t2.hp, t2.s.maxHp));
  h.invariants();
});

test('shieldwall damage: an already-split instance and a retaliation are skipped', () => {
  const h = solo([at(1, 'w_a', 10, 5), at(2, 't_a', 10, 6)]);
  const w = h.unit(1), t = h.unit(2);
  const flagged = h.battle.makeDamage({ amount: 200, type: 'true', canDodge: false });
  flagged.shellSplit = true;                                      // our own instance marker (rule 3)
  const [l1, t1] = deltas([w, t], () => h.battle.dealDamage(null, w, flagged));
  assert.ok(near(l1, 200), 'shellSplit damage never re-enters the split');
  assert.ok(near(t1, 0));

  const thorn = h.battle.makeDamage({ amount: 200, type: 'true', canDodge: false, tags: ['counter'] });
  const [l2, t2] = deltas([w, t], () => h.battle.dealDamage(null, w, thorn)); // isRetaliation
  assert.ok(near(l2, 200), 'a retaliation is not a 受到伤害 and is never split');
  assert.ok(near(t2, 0));
  h.invariants();
});

// =====================================================================================================================
// the "nothing happens" boundaries — non-adjacent / non-TANK / cross-owner / empty pool
// =====================================================================================================================

test('shieldwall damage: an adjacent NON-重装 does not take a share (empty pool → the hit lands in full)', () => {
  const h = solo([at(1, 'w_a', 10, 5), at(2, 'w_a', 10, 6)]);
  const w = h.unit(1), other = h.unit(2);
  const [dw, do_] = deltas([w, other], () => deal(h, w, 200));
  assert.ok(near(dw, 200), `the hit landed in full (lost ${dw})`);
  assert.ok(near(do_, 0), 'a 近卫 next door is not a 盾墙 member');
});

test('shieldwall damage: a 重装 two tiles away does not take a share', () => {
  const h = solo([at(1, 'w_a', 10, 5), at(2, 't_a', 10, 7)]);
  const w = h.unit(1), t = h.unit(2);
  const [dw, dt] = deltas([w, t], () => deal(h, w, 200));
  assert.ok(near(dw, 200), `out of reach: the hit landed in full (lost ${dw})`);
  assert.ok(near(dt, 0));
});

test('shieldwall damage: a diagonal 重装 does not take a share (4-neighbour only)', () => {
  const h = solo([at(1, 'w_a', 10, 5), at(2, 't_a', 9, 6), at(3, 't_a', 11, 4)]);
  const w = h.unit(1), t1 = h.unit(2), t2 = h.unit(3);
  const [dw, d1, d2] = deltas([w, t1, t2], () => deal(h, w, 200));
  assert.ok(near(dw, 200), `diagonals are Manhattan 2: the hit landed in full (lost ${dw})`);
  assert.ok(near(d1, 0) && near(d2, 0));
});

test('shieldwall damage: a teammate\'s adjacent 重装 is never billed (same owner only)', () => {
  const h = mk([
    player('p1', 0, [at(1, 'w_a', 10, 5), at(2, 't_a', 10, 6)], [hexRef()]),
    player('p2', 1, [at(3, 't_b', 9, 5)], []), // adjacent, a 重装, but p2's
  ]);
  h.run(1);
  const w = h.unit(1), own = h.unit(2), mate = h.unit(3);
  const [dw, down, dmate] = deltas([w, own, mate], () => deal(h, w, 200));
  assert.ok(near(dw, 100), 'the target still kept half (its own 重装 was in the pool)');
  assert.ok(near(down, 100), 'only p1\'s own 重装 took the share');
  assert.ok(near(dmate, 0), 'the teammate\'s 重装 was never billed');
  h.invariants();
});

test('shieldwall damage: no 盾墙 owner → the script registers nothing and the hit is untouched', () => {
  const h = mk([player('p1', 0, [at(1, 'w_a', 10, 5), at(2, 't_a', 10, 6)], [])]);
  h.run(1);
  const [dw, dt] = deltas([h.unit(1), h.unit(2)], () => deal(h, h.unit(1), 200));
  assert.ok(near(dw, 200) && near(dt, 0), 'with no owner the card is a no-op');
});

// =====================================================================================================================
// a member leaving the field — its share is LOST, never re-divided (rule 9)
// =====================================================================================================================

test('shieldwall damage: a 重装 downed BEFORE the hit is out of the pool (the survivor is not over-billed)', () => {
  const h = solo([at(1, 'w_a', 10, 5), at(2, 't_a', 10, 6), at(3, 't_a', 9, 5)]);
  const w = h.unit(1), t1 = h.unit(2), t2 = h.unit(3);
  deal(h, t2, 1e9); // the second 重装 dies (its own hit finds no 重装 pool: w_a is a 近卫)
  assert.equal(t2.alive, false, 'the 重装 is down (premise)');
  const [dw, d1] = deltas([w, t1], () => deal(h, w, 200));
  assert.ok(near(dw, 100), 'the target still keeps its half');
  assert.ok(near(d1, 100), 'the surviving 重装 takes the whole 50 % cut — not an over-billed 75 %');
});

test('shieldwall damage: a member leaving between the cut and the share loses its part (no re-division)', () => {
  const h = solo([at(1, 'w_a', 10, 5), at(2, 't_a', 10, 6), at(3, 't_a', 9, 5)]);
  const w = h.unit(1), t1 = h.unit(2), t2 = h.unit(3);
  // Priority -30 runs AFTER the script's -20: the pool is already measured and the cut already taken, so retreating t2
  // here reproduces "a member leaves at that instant" (rule 9) exactly — its part must be lost, not re-divided.
  h.battle.on('hit', (c) => {
    if (c.dmg && c.dmg.shellCut && !c.dmg.shellSplit) h.battle.retreat(t2, { reason: 'retreat' });
  }, { priority: -30 });
  const [dw, d1] = deltas([w, t1], () => deal(h, w, 200));
  assert.ok(near(dw, 100), 'the target kept 100');
  assert.ok(near(d1, 50), `the survivor took only its own 50 — the lost 50 is not re-divided (took ${d1})`);
  assert.equal(t2.alive, false, 'the member left the field');
  assert.ok(near(dw + d1, 150), 'the departed member\'s 50 is lost, not redistributed');
  h.invariants();
});

test('shieldwall damage: the pool is re-measured per hit (nothing is cached across hits)', () => {
  const h = solo([at(1, 'w_a', 10, 5), at(2, 't_a', 10, 6)]);
  const w = h.unit(1), t = h.unit(2);
  const [, d1] = deltas([w, t], () => deal(h, w, 200));
  assert.ok(near(d1, 100), 'first hit: the one member takes 100');
  h.battle.retreat(t, { reason: 'retreat' }); // the pool is now empty
  const [dw2, dt2] = deltas([w, t], () => deal(h, w, 200));
  assert.ok(near(dw2, 200) && near(dt2, 0), 'second hit: nobody adjacent → the hit lands in full');
});

// =====================================================================================================================
// healing split
// =====================================================================================================================

test('shieldwall healing: the same 50 % split, symmetric, and it does not recurse', () => {
  const h = solo([at(1, 'w_a', 10, 5), at(2, 't_a', 10, 6)]);
  const w = h.unit(1), t = h.unit(2);
  w.hp = 5000; t.hp = 5000;
  let applied = 0;
  const [gw, gt] = gains([w, t], () => { applied = h.battle.heal(null, w, 100); });
  assert.ok(near(applied, 50), `the target gained 50 % (got ${applied})`);
  assert.ok(near(gw, 50) && near(gt, 50), 'the target and the 重装 gained 50 each');
  assert.equal(h.battle.errors.length, 0, 'no hookDepth: the transfer did not recurse');
});

test('shieldwall healing: two 重装 split the share evenly and nothing is created', () => {
  const h = solo([at(1, 'w_a', 10, 5), at(2, 't_a', 10, 6), at(3, 't_a', 9, 5)]);
  const w = h.unit(1), t1 = h.unit(2), t2 = h.unit(3);
  w.hp = 5000; t1.hp = 5000; t2.hp = 5000;
  const [gw, g1, g2] = gains([w, t1, t2], () => { h.battle.heal(null, w, 100); });
  assert.ok(near(gw, 50), 'the target gained 50');
  assert.ok(near(g1, 25) && near(g2, 25), 'each 重装 gained 25');
  assert.ok(near(gw + g1 + g2, 100), 'the total healed is the total cast');
  assert.equal(h.battle.errors.length, 0);
});

test('shieldwall healing: a member at full HP gains nothing, and the split still does not recurse', () => {
  const h = solo([at(1, 'w_a', 10, 5), at(2, 't_a', 10, 6)]);
  const w = h.unit(1), t = h.unit(2);
  w.hp = 5000; t.hp = t.s.maxHp; // the member is already full
  let applied = 0;
  const [gw, gt] = gains([w, t], () => { applied = h.battle.heal(null, w, 100); });
  assert.ok(near(applied, 50), 'the target still only gains its half');
  assert.ok(near(gw, 50) && near(gt, 0), 'the full member gains nothing');
  assert.equal(h.battle.errors.length, 0, 'a member at full HP still must not recurse');
});

test('shieldwall healing: 每秒回血 (regen) is not a 治疗 and is never split', () => {
  const h = solo([at(1, 'w_a', 10, 5), at(2, 't_a', 10, 6)]);
  const w = h.unit(1), t = h.unit(2);
  w.hp = 5000; t.hp = 5000;
  const [gw, gt] = gains([w, t], () => h.battle.heal(null, w, 100, { regen: true }));
  assert.ok(near(gw, 100), 'the target took the whole regen tick');
  assert.ok(near(gt, 0), 'a regen tick is not split onto a 重装');
});

test('shieldwall healing: the pool is positional — no adjacent 重装 → the whole heal lands', () => {
  const h = solo([at(1, 'w_a', 10, 5), at(2, 't_a', 10, 8)]);
  const w = h.unit(1), t = h.unit(2);
  w.hp = 5000; t.hp = 5000;
  let applied = 0;
  const [gw, gt] = gains([w, t], () => { applied = h.battle.heal(null, w, 100); });
  assert.equal(applied, 100, 'nobody was in the pool');
  assert.ok(near(gw, 100) && near(gt, 0));
});

test('shieldwall healing: a 重装 already off the field is not in the pool (rule 16)', () => {
  // The pool is measured inside the `heal` handler, at that instant: an operator already down is simply absent, so the
  // one 重装 left takes the whole share — this is the healing twin of "downed before the hit".
  const h = solo([at(1, 'w_a', 10, 5), at(2, 't_a', 10, 6), at(3, 't_a', 9, 5)]);
  const w = h.unit(1), t1 = h.unit(2), t2 = h.unit(3);
  w.hp = 5000; t1.hp = 5000; t2.hp = 5000;
  h.battle.retreat(t2, { reason: 'retreat' });
  let applied = 0;
  const [, g1, g2] = gains([w, t1, t2], () => { applied = h.battle.heal(null, w, 100); });
  assert.ok(near(applied, 50), 'the target keeps its half');
  assert.ok(near(g1, 50), 'the surviving 重装 takes the whole 50 % cut');
  assert.ok(near(g2, 0), 'the downed 重装 gains nothing');
});

test('shieldwall healing: a member that leaves during the transfer loses its part (rule 16 skip)', () => {
  // Rule 16's guard: the pool is measured once, and a member that is off the field when its turn comes is skipped and its
  // share LOST. A nested transfer is the one moment that can change mid-loop, so a watcher on the recursion-guarded
  // channel knocks the second member out during the first member's heal.
  const h = solo([at(1, 'w_a', 10, 5), at(2, 't_a', 9, 5), at(3, 't_a', 10, 6)]); // pool order: (9,5) then (10,6)
  const w = h.unit(1), first = h.unit(2), second = h.unit(3);
  w.hp = 5000; first.hp = 5000; second.hp = 5000;
  h.battle.on('heal', (ctx) => {
    if (ctx.opts && ctx.opts.hexShellHeal === true) h.battle.retreat(second, { reason: 'retreat' });
  }, { priority: 100 });
  let applied = 0;
  const [gw, g1, g2] = gains([w, first, second], () => { applied = h.battle.heal(null, w, 100); });
  assert.ok(near(applied, 50), 'the target keeps its half');
  assert.ok(near(g1, 25), `the first member took its own 25 (got ${g1})`);
  assert.ok(near(g2, 0), 'the member that left mid-transfer gained nothing');
  assert.ok(near(gw + g1, 75), 'the departed member\'s 25 is lost, not re-divided');
  h.invariants();
});

test('shieldwall healing: 禁疗 on a member is respected by battle.heal, not second-guessed (rule 17)', () => {
  const h = solo([at(1, 'w_a', 10, 5), at(2, 't_a', 10, 6)]);
  const w = h.unit(1), t = h.unit(2);
  w.hp = 5000; t.hp = 5000;
  h.battle.addBuff(t, { key: 'test:healFree', flags: { healFree: true }, persist: true, allowDead: true });
  let applied = 0;
  const [gw, gt] = gains([w, t], () => { applied = h.battle.heal(null, w, 100); });
  assert.ok(near(applied, 50), 'the target still only gets its half — the refused share is not returned to it');
  assert.ok(near(gw, 50) && near(gt, 0), 'the 禁疗 member gained nothing');
  assert.equal(h.battle.errors.length, 0);
});

// =====================================================================================================================
// the install contract
// =====================================================================================================================

test('installShieldwall: production wiring adds exactly one handler per event, in 坚守\'s -20 hit slot', () => {
  const withCard = mk([player('p1', 0, [at(1, 'w_a', 10, 5), at(2, 't_a', 10, 6)], [hexRef()])]);
  const without = mk([player('p1', 0, [at(1, 'w_a', 10, 5), at(2, 't_a', 10, 6)], [])]);
  // server/sim/content/hextech.js install() → installHexCards() → installShieldwall(hexHooks(battle)): the card adds
  // exactly one handler to each of the three events, and the `hit` one takes 坚守盟约's -20 slot (cut first, split after).
  assert.equal(hookCount(withCard, 'hit') - hookCount(without, 'hit'), 1);
  assert.equal(hookCount(withCard, 'damaged') - hookCount(without, 'damaged'), 1);
  assert.equal(hookCount(withCard, 'heal') - hookCount(without, 'heal'), 1);
  const twenty = (h) => (h.battle._hooks.hit || []).filter((x) => x.priority === -20).length;
  assert.equal(twenty(withCard) - twenty(without), 1, 'the split cut takes the -20 slot');
});

test('installShieldwall: returns the covered operator count, 0 when the card is absent', () => {
  // The documented return value. Called on a FRESH battle each time: the module registers its handlers on install, so a
  // second install into the same battle would double them (production installs once per battle).
  const withCard = mk([player('p1', 0, [at(1, 'w_a', 10, 5), at(2, 't_a', 10, 6)], [hexRef()])]);
  const absent = mk([player('p1', 0, [at(1, 'w_a', 10, 5)], [])]);
  assert.deepEqual(installShieldwall(hexHooks(withCard.battle)), { onUnits: 2 });
  assert.deepEqual(installShieldwall(hexHooks(absent.battle)), { onUnits: 0 });
});

test('installShieldwall: the split follows every owner of the card, not just the first', () => {
  const h = mk([
    player('p1', 0, [at(1, 'w_a', 10, 5), at(2, 't_a', 10, 6)], [hexRef()]),
    player('p2', 1, [at(3, 'w_b', 11, 5), at(4, 't_b', 11, 6)], [hexRef()]),
  ]);
  h.run(1);
  const [d1, dt1] = deltas([h.unit(1), h.unit(2)], () => deal(h, h.unit(1), 200));
  const [d2, dt2] = deltas([h.unit(3), h.unit(4)], () => deal(h, h.unit(3), 200));
  assert.ok(near(d1, 100) && near(dt1, 100), 'the first owner\'s board is protected');
  assert.ok(near(d2, 100) && near(dt2, 100), 'and so is the second owner\'s — one shared handler set covers both');
});
