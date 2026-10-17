// test/sim/hextech-battle.test.js — the BATTLE side of the third-batch 海克斯 (DESIGN §29.7), run through the real
// simulation. The two other 海克斯 suites cover the draft (test/match/hextech.test.js) and the content/vocabulary layer
// (test/content/hextech.test.js); neither ever hands a hex ref to a battle, so 击倒馈赠 / 技能层涌 / 北境长城 /
// 装甲破坏 / 精准穿透 / 深度吞噬 / 不屈余烬 / 盟约裂变 and the two `battle.emit` events (devourGain, bondTrigger) had
// **no regression net at all** — their correctness rested on the comments in server/sim/content/hextech.js.
//
// Everything here builds the ref exactly as the match sends it (server/match/hextech.js addHexRef:
// `{ id: 'hex:<id>', key: 'hex:<id>', name, desc, iconKind: 'hex', iconId, params: <the effect record>, data: { hexId, rarity } }`)
// and runs the real Battle through test/helpers/battleHarness.js, so a change to `install()` that breaks one of these
// passives fails here rather than in a playtest.
//
// Placement notes (the harness's synthetic flat stage): the operator must be ON the enemy's walking line (route 0 walks
// row 9 from col 10 towards col 2) to be engaged, and a unit is only `deployed` (and thus `alive` for the engine) after
// the first step — hence `h.run(...)` before asserting on battleStart grants.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { isHitCount, abOf } from '../../server/sim/content/enemies/helpers.js';
import { canTargetEnemy, enemyStealthed } from '../../server/sim/targeting.js';
import { HUSK_REBIRTH } from '../../server/sim/content/enemies.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HEXTECH = JSON.parse(readFileSync(path.join(ROOT, 'data', 'hextech.json'), 'utf8'));

/** The hex record of data/hextech.json (player pool first, then enemy), or a clear failure. */
function hex(id) {
  const rec = HEXTECH.playerHexes[id] || HEXTECH.enemyHexes[id];
  assert.ok(rec, `data/hextech.json has no ${id}`);
  return rec;
}

/**
 * One playerEffects entry, the shape server/match/hextech.js addHexRef writes (the sim reads `key`, `params` and
 * `data.hexId`; `iconKind`/`iconId` are for the client's effects column).
 * @param {string} hexId a player hex id
 * @param {object} [over] overrides (e.g. a lapsed 孤注一掷's expireRound)
 */
const refOf = (hexId, over = {}) => {
  const rec = hex(hexId);
  return {
    id: `hex:${hexId}`, key: `hex:${hexId}`, name: rec.name, desc: rec.desc, iconKind: 'hex', iconId: rec.icon,
    counter: null, battle: true, params: { ...rec.effect, hexId, rarity: rec.rarity }, data: { hexId, rarity: rec.rarity },
    ...over,
  };
};

/** A sturdy melee operator the passives can be measured on. */
const guard = (o = {}) => chessRec({ id: 'test_guard', stats: { maxHp: 2000, atk: 500, def: 200, res: 0, blockCnt: 1, respawnTime: 20 }, skill: null, ...o });

/** A tough, slow enemy that survives long enough to be hit many times (speed 0: it stands where spawned). */
const dummy = (o = {}) => enemyRec({ key: 'enemy_dummy', hp: 100000, atk: 1, speed: 0, ...o });
/** A fast, frail enemy: it walks in and dies quickly (for the kill-driven passives). */
const walker = (o = {}) => enemyRec({ key: 'enemy_walker', hp: 400, atk: 1, speed: 2, ...o });
/** A ranged operator with the whole field in range (for selection assertions far from the walking line). */
const gun = () => chessRec({
  id: 't_gun', profession: 'SNIPER', projectile: 'none',
  stats: { atk: 50, maxHp: 1e7, bat: 1, blockCnt: 0 },
  rangeGrid: Array.from({ length: 19 }, (_, dr) => Array.from({ length: 41 }, (_, dc) => [dr - 9, dc - 20])).flat(),
  skill: null,
});

/**
 * One player with `playerEffects`, `units` on the board and the given enemies. Defaults place the operator ON the
 * walking line so route-0 enemies engage it.
 */
function soloBattle({ hexes = [], units = null, enemies = null, players = null, chess = null, enemy = null, ...opts } = {}) {
  const effects = hexes.map((h) => (typeof h === 'string' ? refOf(h) : h));
  const list = players || [{
    playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: effects,
    units: units || [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
  }];
  const defs = chess ? { chess } : { chess: { test_guard: guard() } };
  return makeBattle({
    defs: { ...defs, enemies: enemy ? { [enemy.key]: enemy } : { enemy_dummy: dummy(), enemy_walker: walker() } },
    players: list,
    enemies: enemies || [{ key: 'enemy_dummy', time: 0, route: 0 }],
    autoFinish: false,
    timeLimit: opts.timeLimit ?? 30,
    ...opts,
  });
}

/** The ally operators of a harness (after deployment). */
const ops = (h) => h.battle.allyUnits.filter((u) => u && u.kind === 'op' && u.side === 'ally');
const one = (h) => ops(h)[0];
/** The buffs of a unit with a given key. */
const buffsOf = (u, key) => (u.buffs || []).filter((b) => b.key === key);

// =====================================================================================================================

test('击倒馈赠 (killGift): the operator that lands the knock-out stacks +atkPct, and only it', () => {
  const h = soloBattle({ hexes: ['hex_killgift'], enemies: [{ key: 'enemy_walker', time: 0, route: 0 }], timeLimit: 30 });
  h.run(1);
  const u = one(h);
  assert.equal(buffsOf(u, 'hex:killgift').length, 0, 'nothing before a kill');
  assert.ok(h.runUntil(() => h.enemies().length === 0, 40), 'the walker died (premise)');
  const st = buffsOf(u, 'hex:killgift');
  assert.equal(st.length, 1, 'one stack entry');
  assert.equal(st[0].stacks, 1, 'one knock-out → one stack');
  assert.ok(Math.abs(st[0].mods.atkPct - 0.10) < 1e-9, `the record’s +10% (got ${st[0].mods && st[0].mods.atkPct})`);
  h.invariants();
});

test('击倒馈赠: three knock-outs stack three times on the same operator', () => {
  const h = soloBattle({ hexes: ['hex_killgift'], enemies: [], timeLimit: 60 });
  h.run(1);
  const u = one(h);
  for (let i = 0; i < 3; i++) {
    h.spawn('enemy_walker', { route: 0 });
    const n = h.enemies().length;
    assert.ok(h.runUntil(() => h.enemies().length < n, 40), `walker ${i + 1} died`);
    assert.equal(h.enemies().length, 0, 'the operator cleared it alone');
  }
  const st = buffsOf(u, 'hex:killgift');
  assert.equal(st.length, 1, 'one buff entry, refreshed as a stack');
  assert.equal(st[0].stacks, 3, 'three knock-outs → three stacks');
  h.invariants();
});

test('装甲破坏 (armorBreak): allied PHYSICAL hits shred the enemy DEF, stacking for the battle', () => {
  // the enemy must WALK into range (a speed-0 dummy never reaches the operator) and must survive the window, so it is
  // the tough dummy with a walking speed and a real DEF (enemyRec defaults def to 0 — nothing to shred then)
  const marcher = () => enemyRec({ key: 'enemy_dummy', hp: 100000, atk: 1, def: 150, speed: 1 });
  const plain = soloBattle({ hexes: [], enemy: marcher(), enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }], timeLimit: 20, hooks: ['hit'], captureNoisy: true });
  assert.ok(plain.runUntil(() => plain.hooksOf('hit').length > 0, 20), 'the operator engaged (premise)');
  plain.run(4);
  const plainDef = plain.battle.enemies[0].s.def;
  assert.ok(plainDef > 0, 'the enemy has DEF to shred (premise)');

  const h = soloBattle({ hexes: ['hex_armorbreak'], enemy: marcher(), enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }], timeLimit: 20, hooks: ['hit'], captureNoisy: true });
  assert.ok(h.runUntil(() => h.hooksOf('hit').length > 0, 20), 'the operator engaged (premise)');
  h.run(4);
  const foe = h.battle.enemies[0];
  assert.ok(foe && foe.alive, 'the enemy survived the window (premise)');
  // the `hit` hook fires for BOTH directions, so only the ally→enemy physical hits count (that is what the hex reads)
  const hits = h.hooksOf('hit').filter((c) => c && c.source && c.source.side === 'ally' && c.target && c.target.side === 'enemy' && c.dmg && c.dmg.type === 'phys');
  assert.ok(hits.length > 0, 'the allies landed physical hits (premise)');
  assert.equal(foe.s.def, plainDef - 20 * hits.length, `20 DEF per allied physical hit: ${plainDef} − 20×${hits.length}`);
  const st = buffsOf(foe, 'hex:armorbreak')[0];
  assert.equal(st.stacks, hits.length, 'one stack per allied physical hit');
  h.invariants();
});

test('装甲破坏: the DEF shred is not applied to another player’s physical hits', () => {
  const players = [
    { playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [refOf('hex_armorbreak')], units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }] },
    { playerId: 'p2', seat: 1, side: 'L', colOffset: 8, bonds: {}, playerEffects: [], units: [{ uid: 2, kind: 'chess', chessId: 'test_guard', row: 10, col: 15 }] },
  ];
  const h = soloBattle({ players, chess: { test_guard: guard() }, enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }], timeLimit: 8 });
  h.run(5);
  const foe = h.battle.enemies[0];
  const stacks = buffsOf(foe, 'hex:armorbreak');
  const n = stacks.length ? stacks[0].stacks : 0;
  // p1 is the one in contact here; whatever the count, it must equal p1's own hits (p2 is far away and ranged-less)
  assert.equal(n, h.hooksOf('hit').filter((c) => c.source && c.source.ownerId === 'p1').length);
  h.invariants();
});

test('北境长城 (northWall): the rightmost own column opens at 50% and grows 5% of max HP a second to 100%', () => {
  const h = soloBattle({
    hexes: ['hex_northwall'],
    units: [
      { uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 5 },
      { uid: 2, kind: 'chess', chessId: 'test_guard', row: 9, col: 8 },    // the rightmost owned column
      { uid: 3, kind: 'chess', chessId: 'test_guard', row: 10, col: 8 },   //   (shared by two)
    ],
    timeLimit: 20,
  });
  h.run(0.5);                                              // battleStart grants (the first growth tick is t = 1)
  const list = ops(h);
  assert.equal(list.length, 3, 'three operators on the board');
  const right = list.filter((u) => u.homeC === 8);
  assert.equal(right.length, 2, 'two of them in the rightmost column');
  for (const u of right) {
    const sh = buffsOf(u, 'hex:northwall');
    assert.equal(sh.length, 1, `uid ${u.uid} is shielded`);
    assert.equal(sh[0].shield, u.s.maxHp * 0.5, 'the record’s shieldPct 50 = half of its max HP');
  }
  const other = list.find((u) => u.homeC === 5);
  assert.equal(buffsOf(other, 'hex:northwall').length, 0, 'the left column is not shielded');
  h.run(3);                                                // ticks at t = 1, 2, 3 → 50% + 3×5%
  for (const u of right) assert.ok(Math.abs(buffsOf(u, 'hex:northwall')[0].shield - u.s.maxHp * 0.65) < 1, `uid ${u.uid} grew to 65%`);
  h.run(7);                                                // ticks 4 … 10 → the 100% cap, and it stops there
  for (const u of right) assert.equal(buffsOf(u, 'hex:northwall')[0].shield, u.s.maxHp, `uid ${u.uid} capped at its max HP`);
  h.invariants();
});

test('北境长城: the record drives the start, the step and the cap (shieldPct 20 / stepPct 10 / capPct 40)', () => {
  const custom = {
    id: 'hex_northwall', key: 'hex:hex_northwall', iconKind: 'hex',
    params: { northWall: { shieldPct: 20, stepPct: 10, capPct: 40 }, hexId: 'hex_northwall', rarity: 'silver' }, data: { hexId: 'hex_northwall' },
  };
  const h = soloBattle({ hexes: [custom], timeLimit: 20 });
  h.run(0.5);
  const u = one(h);
  assert.equal(buffsOf(u, 'hex:northwall')[0].shield, u.s.maxHp * 0.2, 'starts at the record’s 20%');
  h.run(2);                                                // ticks at t = 1, 2 → +20% → the 40% cap
  assert.ok(Math.abs(buffsOf(u, 'hex:northwall')[0].shield - u.s.maxHp * 0.4) < 1, 'two steps reach the 40% cap');
  h.run(5);
  assert.ok(Math.abs(buffsOf(u, 'hex:northwall')[0].shield - u.s.maxHp * 0.4) < 1, 'never past the cap');
  h.invariants();
});

test('精准穿透 (precisionPen): floor(layers / perLayers) steps of DEF/RES penetration on the 精准 member', () => {
  // the operator must actually be a 精准 member (the chess record names the bond; isMember reads it)
  const member = guard({ bonds: ['preciShip'] });
  const at = (layers) => {
    const h = soloBattle({
      hexes: ['hex_precisionpen'],
      chess: { test_guard: member },
      players: [{
        playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
        bonds: { preciShip: { count: 3, active: true, tier: 1, layers } },
        playerEffects: [refOf('hex_precisionpen')],
        units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
      }],
      timeLimit: 5,
    });
    h.run(0.5);
    return { h, b: buffsOf(one(h), 'hex:precisionpen')[0] };
  };
  const below = at(5);                                     // floor(5/10) = 0 steps
  assert.equal(below.b, undefined, 'below one step nothing is granted');
  const one25 = at(25);                                    // floor(25/10) * 2% = 4%
  assert.ok(one25.b, 'granted from one step up');
  assert.ok(Math.abs(one25.b.mods.defIgnorePct - 0.04) < 1e-9, `4% (got ${one25.b.mods.defIgnorePct})`);
  assert.ok(Math.abs(one25.b.mods.resIgnorePct - 0.04) < 1e-9);
  const ten = at(100);                                     // floor(100/10) * 2% = 20%
  assert.ok(Math.abs(ten.b.mods.defIgnorePct - 0.20) < 1e-9, `20% (got ${ten.b.mods.defIgnorePct})`);
  below.h.invariants(); one25.h.invariants(); ten.h.invariants();
});

test('精准穿透: a RANGED operator is covered even without the 精准 bond, a melee one is not', () => {
  const ranged = chessRec({ id: 'test_ranged', position: 'RANGED', stats: { maxHp: 1000, atk: 300, def: 100, res: 0, respawnTime: 20, rangeGrid: [[0, -1]] }, skill: null });
  const h = soloBattle({
    hexes: ['hex_precisionpen'],
    chess: { test_guard: guard(), test_ranged: ranged },
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
      bonds: { preciShip: { count: 3, active: true, tier: 1, layers: 25 } },
      playerEffects: [refOf('hex_precisionpen')],
      units: [
        { uid: 1, kind: 'chess', chessId: 'test_ranged', row: 9, col: 6 },   // RANGED → covered
        { uid: 2, kind: 'chess', chessId: 'test_guard', row: 10, col: 6 },   // melee, not a 精准 member → not covered
      ],
    }],
    timeLimit: 5,
  });
  h.run(0.5);
  const list = ops(h);
  const r = list.find((u) => u.defId === 'test_ranged');
  const m = list.find((u) => u.defId === 'test_guard');
  assert.equal(buffsOf(r, 'hex:precisionpen').length, 1, 'the RANGED operator gets the penetration');
  assert.equal(buffsOf(m, 'hex:precisionpen').length, 0, 'a melee operator outside 精准 does not');
  h.invariants();
});

/**
 * A kit whose skill opens exactly once, deterministically: `activateOnDeploy` fires one `skillStart` at deployment
 * (test/sim/skills.test.js's own pattern). An AUTO skill never opened here — the operator has no enemy to cast at.
 */
const opensOnce = () => ({ skill: { kind: 'duration', activateOnDeploy: true, duration: 4, spCost: 0, spType: 'none', trigger: 'NEVER', mods: { atkPct: 1 } } });

test('技能层涌 (skillFlow): a skill opening adds layers to the caster’s own active bonds', () => {
  // the caster must carry the bond for `unitBonds(unit)` to name it (the chess record is where the sim reads bonds)
  const build = (withHex) => soloBattle({
    hexes: withHex ? ['hex_skillflow'] : [],
    chess: { test_guard: guard({ bonds: ['yanShip'] }) },
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
      bonds: { yanShip: { count: 2, active: true, tier: 1, layers: 0 } },
      playerEffects: withHex ? [refOf('hex_skillflow')] : [],
      units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
    }],
    kits: { test_guard: opensOnce },
    timeLimit: 10,
  });
  const h = build(true);
  h.run(1);
  const starts = h.hooksOf('skillStart').length;
  assert.equal(starts, 1, 'the operator opened exactly one skill (premise)');
  const gains = h.hooksOf('layerGain').filter((c) => c && c.bondId === 'yanShip' && c.reason === 'hex');
  assert.equal(gains.length, 1, 'the opening fed the bond through the hex');
  assert.equal(gains.reduce((s, c) => s + c.n, 0), starts, 'the record’s layers: 1 per opening');
  h.invariants();
});

test('技能层涌: 40 layers per bond per battle is the cap, and it is per BOND, not per card', () => {
  // `maxLayersPerBond` (the owner's correction of 2026-10-14, replacing the 20-openings cap of the day before) bounds
  // what THIS CARD stacks on ONE bond in one battle. A battle IS one round, so the tally lives in the handler's closure
  // — a fresh install per field, never shared across battles.
  // Drive the openings directly instead of through a kit: `skillStart` is the exact event the card listens to, and the
  // point of this test is the CAP, not the cast machinery (the two tests above cover a real opening).
  const build = (bonds, active) => {
    const h = soloBattle({
      hexes: ['hex_skillflow'],
      chess: { test_guard: guard({ bonds }) },
      players: [{
        playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
        bonds: Object.fromEntries(bonds.map((b) => [b, { count: 2, active: active.includes(b), tier: 1, layers: 0 }])),
        playerEffects: [refOf('hex_skillflow')],
        units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
      }],
      timeLimit: 10,
    });
    h.run(0.5); // the unit becomes `deployed` (and thus a legal caster) after the first step
    return h;
  };
  const emit = (h, unit, n) => { for (let i = 0; i < n; i++) h.battle.emit('skillStart', { unit }); };
  const fed = (h, bondId) => h.hooksOf('layerGain').filter((c) => c && c.bondId === bondId && c.reason === 'hex');
  const fedTotal = (h, bondId) => fed(h, bondId).reduce((s, c) => s + c.n, 0);

  // 100 openings on one bond: it stops at exactly 40 layers
  const capped = build(['yanShip'], ['yanShip']);
  emit(capped, one(capped), 100);
  assert.equal(fedTotal(capped, 'yanShip'), 40, 'the card stacks at most 40 layers on one bond');
  assert.equal(fed(capped, 'yanShip').length, 40, 'one layer per opening until the cap is reached, then nothing');
  assert.equal(capped.battle.getPlayer('p1').bonds.yanShip.layers, 40, 'and the bond really holds 40');
  // exactly 40 openings all pay
  const exact = build(['yanShip'], ['yanShip']);
  emit(exact, one(exact), 40);
  assert.equal(fedTotal(exact, 'yanShip'), 40, '40 openings all pay');
  assert.equal(fed(exact, 'yanShip').length, 40, 'and the 40th is not clipped');

  // the cap is PER BOND: a caster in two active bonds feeds each of them to its own 40
  const two = build(['yanShip', 'visiShip'], ['yanShip', 'visiShip']);
  emit(two, one(two), 100);
  assert.equal(fedTotal(two, 'yanShip'), 40, 'the first bond is capped on its own');
  assert.equal(fedTotal(two, 'visiShip'), 40, 'and so is the second — the first did not consume the other\'s budget');
  // an INACTIVE bond is never fed (the card's own rule), so it cannot consume budget either
  const mixed = build(['yanShip', 'visiShip'], ['yanShip']);
  emit(mixed, one(mixed), 100);
  assert.equal(fedTotal(mixed, 'yanShip'), 40, 'the active bond reaches its cap');
  assert.equal(fed(mixed, 'visiShip').length, 0, 'an inactive bond is never fed');
  capped.invariants(); exact.invariants(); two.invariants(); mixed.invariants();
});

test('技能层涌: without the hex the same skill opening grants no bond layers', () => {
  const mk = (withHex) => soloBattle({
    hexes: withHex ? ['hex_skillflow'] : [],
    chess: { test_guard: guard({ bonds: ['yanShip'] }) },
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: { yanShip: { count: 2, active: true, tier: 1, layers: 0 } }, playerEffects: withHex ? [refOf('hex_skillflow')] : [], units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }] }],
    kits: { test_guard: opensOnce }, timeLimit: 10,
  });
  const withHex = mk(true);
  const without = mk(false);
  withHex.run(1); without.run(1);
  assert.equal(withHex.hooksOf('skillStart').length, 1, 'the hex side opened a skill');
  assert.equal(without.hooksOf('skillStart').length, 1, 'the plain side opened the same skill');
  assert.equal(withHex.hooksOf('layerGain').filter((c) => c.reason === 'hex').length, 1, 'the hex side fed layers');
  assert.equal(without.hooksOf('layerGain').filter((c) => c.reason === 'hex').length, 0, 'the plain side did not');
  withHex.invariants(); without.invariants();
});

test('深度吞噬 (devourTarget): the devour gives the marker +1 attack target, and only once', () => {
  // the bond emits `devourGain` on the devourer (bonds/core.js); the hex answers with a maxTargets passive on the
  // marker. Driven through the real emit, so the hook name and payload shape are exercised as the bond sends them.
  const h = soloBattle({ hexes: ['hex_deepdevour'], timeLimit: 5 });
  h.run(0.5);
  const marker = one(h);
  const before = marker.s.maxTargets;
  h.battle.emit('devourGain', { marker, targets: [{ base: { def: 400 } }, { base: { def: 100 } }] });
  assert.equal(marker.s.maxTargets, before + 1, '+1 attack target');
  h.battle.emit('devourGain', { marker, targets: [{ base: { def: 400 } }] });
  assert.equal(marker.s.maxTargets, before + 1, 'a second devour replaces the same key — still +1');
  h.invariants();
});

test('深度吞噬: without the hex the emit changes nothing', () => {
  const h = soloBattle({ hexes: [], timeLimit: 5 });
  h.run(0.5);
  const marker = one(h);
  const before = marker.s.maxTargets;
  h.battle.emit('devourGain', { marker, targets: [{ base: { def: 400 } }] });
  assert.equal(marker.s.maxTargets, before, 'no hex, no extra attack target');
  h.invariants();
});

test('深度吞噬: another player’s marker gets nothing', () => {
  const players = [
    { playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [refOf('hex_deepdevour')], units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }] },
    { playerId: 'p2', seat: 1, side: 'L', colOffset: 8, bonds: {}, playerEffects: [], units: [{ uid: 2, kind: 'chess', chessId: 'test_guard', row: 10, col: 15 }] },
  ];
  const h = soloBattle({ players, timeLimit: 5 });
  h.run(0.5);
  const [mine, theirs] = ops(h);
  const before = theirs.s.maxTargets;
  h.battle.emit('devourGain', { marker: theirs, targets: [{ base: { def: 400 } }] });
  assert.equal(theirs.s.maxTargets, before, 'the hex belongs to p1, not to p2’s marker');
  assert.ok(mine, 'premise: p1 also has a board');
  h.invariants();
});

test('不屈余烬 (indomEmber): 不屈’s trigger grants +2 block for 6 s — and NO HP floor any more', () => {
  const h = soloBattle({ hexes: ['hex_indomember'], timeLimit: 20 });
  h.run(0.5);
  const u = one(h);
  const block0 = u.s.blockCnt;                             // the live stat before the card fires (premise)
  h.battle.emit('bondTrigger', { bondId: 'indomShip', unit: u });
  const ember = buffsOf(u, 'hex:indomember')[0];
  assert.ok(ember, 'the buff is applied');
  assert.equal(ember.duration, 6, 'the record’s seconds: 6 (raised from 4 on 2026-10-13)');
  assert.equal(ember.mods.blockCnt, 2, 'the record’s block: +2');
  assert.equal(u.s.blockCnt, block0 + 2, 'and the +2 really reaches the unit’s live block count');
  // The HP floor (锁血) was removed on 2026-10-14 (owner: 「不屈余烬去掉锁血」). The card no longer arms a window and
  // no longer touches the `fatal` hook, so a lethal hit inside the 6 s is NOT prevented by this card.
  assert.equal(u.mem.hexEmberUntil, undefined, 'no window is armed any more');
  const fatal = { unit: u, prevented: false, dmg: { amount: 1e9 } };
  h.battle.emit('fatal', fatal);
  assert.equal(fatal.prevented, false, 'the card never floors HP now');
  h.invariants();
});

test('不屈余烬: another bond’s trigger is ignored, and the buff lapses with its 6 s', () => {
  const h = soloBattle({ hexes: ['hex_indomember'], timeLimit: 20 });
  h.run(0.5);
  const u = one(h);
  h.battle.emit('bondTrigger', { bondId: 'yanShip', unit: u });
  assert.equal(buffsOf(u, 'hex:indomember').length, 0, 'only 不屈 (indomShip) arms it');
  h.battle.emit('bondTrigger', { bondId: 'indomShip', unit: u });
  assert.equal(buffsOf(u, 'hex:indomember').length, 1, 'armed by 不屈');
  h.run(7);                                                // past the 6 s window
  assert.equal(buffsOf(u, 'hex:indomember').length, 0, 'the buff lapsed on its own timer');
  // a lethal hit after the window is (and always was) not prevented — the card has no `fatal` half at all now
  const late = { unit: u, prevented: false, dmg: { amount: 1e9 } };
  h.battle.emit('fatal', late);
  assert.equal(late.prevented, false, 'no HP floor at any time');
  h.invariants();
});

test('盟约裂变 (bondFission): only the two bonds with the most layers gain ×3 in battle', () => {
  const bonds = {
    yanShip: { count: 3, active: true, tier: 1, layers: 30 },
    sargonShip: { count: 3, active: true, tier: 1, layers: 20 },
    victoriaShip: { count: 3, active: true, tier: 1, layers: 10 },
  };
  const h = soloBattle({
    hexes: ['hex_bondfission'],
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds, playerEffects: [refOf('hex_bondfission')], units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }] }],
    timeLimit: 5,
  });
  h.run(0.2);
  const gain = (bondId) => { const ev = { playerId: 'p1', bondId, n: 5, reason: 'test' }; h.battle.emit('layerGain', ev); return ev.n; };
  assert.equal(gain('yanShip'), 15, 'the 30-layer bond is kept → ×3');
  assert.equal(gain('sargonShip'), 15, 'the 20-layer bond is kept → ×3');
  assert.equal(gain('victoriaShip'), 5, 'the 10-layer bond is not kept → unchanged');
  h.invariants();
});

test('盟约裂变: equal layers resolve by DATA order (the shared rule the prep side also calls)', () => {
  const ties = ['yanShip', 'sargonShip', 'victoriaShip'];
  const bonds = Object.fromEntries(ties.map((id) => [id, { count: 3, active: true, tier: 1, layers: 10 }]));
  const h = soloBattle({
    hexes: ['hex_bondfission'],
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds, playerEffects: [refOf('hex_bondfission')], units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }] }],
    timeLimit: 5,
  });
  h.run(0.2);
  const gain = (bondId) => { const ev = { playerId: 'p1', bondId, n: 5, reason: 'test' }; h.battle.emit('layerGain', ev); return ev.n; };
  assert.equal(gain('yanShip'), 15, 'first in data order → kept');
  assert.equal(gain('sargonShip'), 15, 'second in data order → kept');
  assert.equal(gain('victoriaShip'), 5, 'third → dropped on the tie');
  h.invariants();
});

test('孤注一掷 (battleForRounds): a lapsed ref is skipped, an active one still applies', () => {
  const allin = (expireRound, round) => {
    const rec = hex('hex_allin');
    const ref = refOf('hex_allin', { params: { ...rec.effect, battle: { atkPct: 200 }, expireRound, hexId: 'hex_allin', rarity: rec.rarity } });
    return soloBattle({ hexes: [ref], round, timeLimit: 5 });
  };
  // addHexRef: active in the pick round and the three after it
  const active = allin(4, 4);
  active.run(0.5);
  assert.equal(buffsOf(one(active), 'hex:hex_allin').length, 1, 'inside the window the passive is applied');
  const lapsed = allin(4, 5);
  lapsed.run(0.5);
  assert.equal(buffsOf(one(lapsed), 'hex:hex_allin').length, 0, 'past expireRound the ref is skipped');
  active.invariants(); lapsed.invariants();
});

test('先锋之势 (firstKillBy): the first knock-out by a 先锋 pays coins once, through the bounty channel', () => {
  const pioneer = guard({ profession: 'PIONEER' });
  const h = soloBattle({
    hexes: ['hex_vanguard'],
    chess: { test_guard: pioneer },
    enemies: [],
    timeLimit: 60,
  });
  h.run(1);
  for (let i = 0; i < 2; i++) {
    h.spawn('enemy_walker', { route: 0 });
    const n = h.enemies().length;
    assert.ok(h.runUntil(() => h.enemies().length < n, 40), `walker ${i + 1} died`);
    assert.equal(h.enemies().length, 0);
  }
  const res = h.result();
  assert.equal(res.perPlayer.p1.coins, 4, 'exactly one payment of the record’s 4 — not one per kill');
  h.invariants();
});

test('先锋之势 (firstAttackBy): a 先锋’s own first attack buffs itself +30% ATK for 10 s, once', () => {
  const pioneer = guard({ profession: 'PIONEER' });
  const h = soloBattle({
    hexes: ['hex_vanguard'],
    chess: { test_guard: pioneer },
    enemy: enemyRec({ key: 'enemy_dummy', hp: 100000, atk: 1, speed: 1 }),
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }],
    timeLimit: 40,
  });
  h.run(1);
  const u = one(h);
  assert.equal(buffsOf(u, 'hex:vanguard').length, 0, 'nothing before its first attack');
  assert.ok(h.runUntil(() => buffsOf(u, 'hex:vanguard').length > 0, 20), 'its first attack armed the buff');
  const b = buffsOf(u, 'hex:vanguard')[0];
  assert.ok(Math.abs(b.mods.atkPct - 0.3) < 1e-9, `+30% ATK (got ${b.mods && b.mods.atkPct})`);
  assert.ok(Math.abs(b.timeLeft - 10) < 0.6, `10 s left at the grant (got ${b.timeLeft})`);
  h.run(3);
  assert.equal(buffsOf(u, 'hex:vanguard').length, 1, 'later attacks do not add a second entry');
  h.run(8);
  assert.equal(buffsOf(u, 'hex:vanguard').length, 0, 'it lapses after 10 s');
  h.invariants();
});

test('先锋之势: a non-先锋 killer pays nothing', () => {
  const h = soloBattle({ hexes: ['hex_vanguard'], enemies: [{ key: 'enemy_walker', time: 0, route: 0 }], timeLimit: 40 });
  h.run(1);
  assert.ok(h.runUntil(() => h.enemies().length === 0, 40), 'the walker died');
  assert.equal(h.result().perPlayer.p1.coins, 0, 'the killer is not a 先锋');
  h.invariants();
});

test('深度吞噬/不屈余烬-style ownership-only hexes still register their refs (install reads data.hexId)', () => {
  // a ref keyed only by `key` (no data.hexId) must still be recognised — the fallback path in install()
  const bare = { id: 'hex:hex_killgift', key: 'hex:hex_killgift', iconKind: 'hex', params: { ...hex('hex_killgift').effect, hexId: 'hex_killgift' }, data: null };
  const h = soloBattle({ hexes: [bare], enemies: [{ key: 'enemy_walker', time: 0, route: 0 }], timeLimit: 40 });
  h.run(1);
  assert.ok(h.runUntil(() => h.enemies().length === 0, 40), 'the walker died');
  assert.equal(buffsOf(one(h), 'hex:killgift').length, 1, 'the key prefix alone identified the hex');
  h.invariants();
});

test('several hexes at once: their passives all apply to the same operator', () => {
  const h = soloBattle({
    hexes: ['hex_killgift', 'hex_northwall', 'hex_armorbreak'],
    enemies: [{ key: 'enemy_walker', time: 0, route: 0 }],
    timeLimit: 40,
  });
  h.run(1);
  const u = one(h);
  assert.equal(buffsOf(u, 'hex:northwall').length, 1, '北境长城 applied');
  assert.ok(h.runUntil(() => h.enemies().length === 0, 40), 'the walker died');
  assert.equal(buffsOf(u, 'hex:killgift').length, 1, '击倒馈赠 applied');
  h.invariants();
});

// =====================================================================================================================
// fourth batch (the owner's review of 2026-10-09) — the six new battle scripts
// =====================================================================================================================

test('盾墙/教官批注 (battleModsOf): block +1, max HP +20%, +0.3 SP/s on the real operator', () => {
  const h = soloBattle({ hexes: ['hex_shieldwall', 'hex_drillsergeant'], timeLimit: 10 });
  h.run(1);
  const u = one(h);
  assert.equal(u.s.blockCnt, 2, '盾墙: +1 block slot');
  assert.ok(Math.abs(u.s.maxHp - 2400) < 1, `盾墙: 2000 → 2400 max HP (got ${u.s.maxHp})`);
  assert.ok(Math.abs(u.s.spRecovery - 1.3) < 1e-9, `教官批注: 1 → 1.3 SP/s (got ${u.s.spRecovery})`);
  h.invariants();
});

test('不灭壁垒 (immortalRevive): a knocked-out operator redeploys itself once, and only once', () => {
  const h = soloBattle({ hexes: ['hex_immortal'], timeLimit: 30 });
  h.run(1);
  const u = one(h);
  assert.ok(u.alive, 'premise: it is deployed');
  const hp0 = u.s.maxHp;
  h.battle.kill(u, null);
  assert.equal(u.alive, true, 'the death hook revived it where it stood');
  assert.equal(u.mem.hexImmortalRevives, 1, 'one revive spent');
  assert.ok(Math.abs(u.hp - hp0) < 1e-9, `revived at full HP (got ${u.hp} of ${hp0})`);
  h.battle.kill(u, null);
  assert.equal(u.alive, false, 'the second knock-out sticks');
  assert.equal(u.mem.hexImmortalRevives, 1, 'no second revive');
  h.invariants();
});

test('浴血 (holdLine): the DEF step follows the HP lost, stacks to the cap, never regresses', () => {
  const h = soloBattle({ hexes: ['hex_holdline'], timeLimit: 20 });
  h.run(1);
  const u = one(h);
  const def0 = u.s.def;
  assert.equal(buffsOf(u, 'hex:holdline').length, 0, 'nothing at full HP');
  // knock it to 50 % → floor(50 / 25) = 2 stacks
  u.hp = u.s.maxHp * 0.5;
  h.battle.emit('damaged', { source: null, target: u, amount: 0, type: 'true' });
  u.markDirty();
  let st = buffsOf(u, 'hex:holdline');
  assert.equal(st.length, 1, 'one stack entry');
  assert.equal(st[0].stacks, 2, '50 % lost → 2 stacks');
  assert.ok(Math.abs(u.s.def - (def0 + 80)) < 1e-9, `+40 × 2 = +80 DEF (got ${u.s.def - def0})`);
  // deeper: 80 % → floor(80 / 25) = 3 stacks, and the buff is not re-added per hit
  u.hp = u.s.maxHp * 0.2;
  h.battle.emit('damaged', { source: null, target: u, amount: 0, type: 'true' });
  u.markDirty();
  st = buffsOf(u, 'hex:holdline');
  assert.equal(st.length, 1, 'still one entry');
  assert.equal(st[0].stacks, 3, '80 % lost → 3 stacks');
  // healing back up never removes what was earned (the cap is on the stacks, not the current HP)
  u.hp = u.s.maxHp;
  h.battle.emit('damaged', { source: null, target: u, amount: 0, type: 'true' });
  u.markDirty();
  assert.equal(buffsOf(u, 'hex:holdline')[0].stacks, 3, 'the earned stacks stay');
  h.invariants();
});

test('火力延伸 (rangedExtend): a SNIPER gains the range tile, a non-sniper does not', () => {
  const sniper = () => chessRec({
    id: 'test_sniper', profession: 'SNIPER', position: 'RANGED',
    stats: { maxHp: 1200, atk: 200, def: 0, res: 0, aspd: 100, bat: 1, blockCnt: 0, respawnTime: 20 },
    skill: null,
  });
  const h = soloBattle({ hexes: ['hex_firingline'], chess: { test_guard: guard(), test_sniper: sniper() }, timeLimit: 10 });
  // the harness places test_guard by default: swap the board to the sniper
  const h2 = makeBattle({
    defs: { chess: { test_guard: guard(), test_sniper: sniper() }, enemies: { enemy_dummy: dummy() } },
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [refOf('hex_firingline')],
      units: [{ uid: 1, kind: 'chess', chessId: 'test_sniper', row: 9, col: 5 }] }],
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }], autoFinish: false, timeLimit: 10,
  });
  for (let i = 0; i < 60; i++) h2.step();
  const sn = h2.battle.allyUnits.find((u) => u.kind === 'op');
  assert.equal(sn.s.baseRangeExtend, 1, 'the sniper gained a permanent +1 range');
  // a WARRIOR is untouched by the card
  const h3 = makeBattle({
    defs: { chess: { test_guard: guard() }, enemies: { enemy_dummy: dummy() } },
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [refOf('hex_firingline')],
      units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }] }],
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }], autoFinish: false, timeLimit: 10,
  });
  for (let i = 0; i < 60; i++) h3.step();
  assert.equal(h3.battle.allyUnits.find((u) => u.kind === 'op').s.baseRangeExtend, 0, 'a non-sniper gains nothing');
  h.invariants();
  void h;
});

test('先驱 (lastStand): lethal damage is prevented inside the window, and lands after it', () => {
  const h = soloBattle({ hexes: ['hex_laststand'], timeLimit: 60 });
  h.run(1);
  const u = one(h);
  u.hp = 10;
  h.battle.loseHp(u, 99999, { source: null });
  assert.ok(u.alive && u.hp >= 1, `inside the 30 s window the operator survives (hp ${u.hp})`);
  // past the window the shield is gone: the same blow kills
  const h2 = soloBattle({ hexes: ['hex_laststand'], timeLimit: 60 });
  h2.run(31);
  const u2 = one(h2);
  assert.ok(u2 && u2.alive, 'the operator is still alive at t = 31 (premise)');
  u2.hp = 10;
  h2.battle.loseHp(u2, 99999, { source: null });
  assert.ok(!u2.alive, 'after 30 s the blow lands');
  h.invariants();
});

test('超载协议 (overdrive): every skill start drains 4 % of max HP, never lethally', () => {
  const h = soloBattle({ hexes: ['hex_overdrive'], timeLimit: 10 });
  h.run(1);
  const u = one(h);
  assert.equal(u.s.spCostFlat, -3, 'the SP-cost cut is on the operator');
  const hp0 = u.hp;
  const sp0 = u.skill ? u.skill.sp : null;
  h.battle.emit('skillStart', { unit: u, skill: { id: 'test' }, reason: 'manual' });
  assert.ok(Math.abs((hp0 - u.hp) - u.s.maxHp * 0.04) < 1e-9, `4 % of 2000 = 80 drained (got ${hp0 - u.hp})`);
  // it is 流失 (Battle.loseHp), not 受到伤害: "受到伤害时" content skips it — the drain grants no 受击回复 SP
  // (stats.taken does count it, damage.js isHpLoss keeps the `damaged` hook for stats/HP thresholds)
  if (sp0 != null) assert.equal(u.skill.sp, sp0, 'a 流失 grants no 受击回复 SP');
  assert.ok(u.buffs.every((b) => !(b.flags && b.flags.burstLock)), 'a 流失 is not an element burst');
  // and it can never kill: at 1 HP the drain is skipped
  u.hp = 1;
  h.battle.emit('skillStart', { unit: u, skill: { id: 'test' }, reason: 'manual' });
  assert.ok(u.alive && u.hp >= 1, 'the drain never kills its own caster');
  h.invariants();
});

test('战地医院 (fieldHospital): each knock-out heals the lowest-HP-ratio ally by 10 % of its max HP', () => {
  const h = soloBattle({ hexes: ['hex_fieldhospital'], enemies: [{ key: 'enemy_walker', time: 0, route: 0 }], timeLimit: 40 });
  h.run(1);
  const u = one(h);
  u.hp = u.s.maxHp * 0.3;
  const hp0 = u.hp;
  h.battle.emit('kill', { killer: u, victim: { side: 'enemy', alive: false } });
  assert.ok(Math.abs((u.hp - hp0) - u.s.maxHp * 0.1) < 1e-6, `+10 % of 2000 = 200 (got ${u.hp - hp0})`);
  // a full-HP operator is not overhealed
  u.hp = u.s.maxHp;
  h.battle.emit('kill', { killer: u, victim: { side: 'enemy', alive: false } });
  assert.equal(u.hp, u.s.maxHp, 'no overheal at full HP');
  // a knock-out by another owner's operator does not heal this player's board
  u.hp = u.s.maxHp * 0.3;
  const before = u.hp;
  h.battle.emit('kill', { killer: { side: 'ally', ownerId: 'someone_else' }, victim: { side: 'enemy', alive: false } });
  assert.equal(u.hp, before, 'another player’s kill heals nothing here');
  h.invariants();
});

test('损伤加强 (elemAmp): enemies take the element-GAUGE multiplier, including one spawned mid-battle', () => {
  const h = soloBattle({ hexes: ['hex_lossamp'], timeLimit: 10 });
  h.run(1);
  const e0 = h.enemies()[0];
  assert.ok(e0, 'an enemy is on the field (premise)');
  assert.ok(Math.abs(e0.s.elemTakenMul - 1.5) < 1e-9, `elemTakenMul 1.5 (got ${e0.s.elemTakenMul})`);
  // it is the GAUGE multiplier, not the HP-damage one
  assert.ok(Math.abs(e0.s.dmgTakenMul - 1) < 1e-9, 'dmgTakenMul (受到的伤害) is untouched');
  // a later spawn is covered too
  h.spawn('enemy_walker', { route: 0 });
  const e1 = h.enemies().find((e) => e !== e0);
  assert.ok(e1 && Math.abs(e1.s.elemTakenMul - 1.5) < 1e-9, 'a mid-battle spawn is covered');
  h.invariants();
});

// =====================================================================================================================
// enemy VERBS (DESIGN §29.10) — the channel that lifts the enemy side above stat multipliers.
//
// These drive `flags.enemyHexIds`, the exact field `server/match/match/combat.js newBattle` writes, so a card reaches a
// battle the way it does in a real match. Before this batch the field did not exist and an enemy verb was impossible.
// =====================================================================================================================

/** A sturdy enemy that stands and fights (so a verb's per-hit / per-damage hooks actually fire). */
const marcher = () => enemyRec({ key: 'enemy_march', hp: 100000, atk: 100, def: 0, speed: 1 });

/**
 * 回响's 2026-10-13 rebalance made the split a CHANCE that grows with the round (0.1 + 0.1x). A test about what a split
 * DOES (the copies, the gates, the accounting) must not be at the mercy of that roll, so it fights at this round: the
 * chance saturates at 1 from R9 on, which makes the split certain while leaving the rest of the card untouched.
 */
const ECHO_CERTAIN_ROUND = 9;

/**
 * A battle with one enemy verb installed through the REAL flag channel. `hexId` is the enemy hex id; its record is read
 * out of data/hextech.json by the sim exactly as a match would.
 */
function enemyVerbBattle(hexId, { enemyKey = 'enemy_march', enemyKeys = null, flags = null, ...opts } = {}) {
  const keys = enemyKeys || [enemyKey];
  const rows = keys.map((key, i) => ({ key, time: 0, route: 0, ...(i ? { pos: [10 + i, 6] } : {}) }));
  const defs = {
    chess: { test_guard: guard() },
    enemies: Object.fromEntries(keys.map((k) => [k, k === 'enemy_walker' ? walker() : marcher()])),
  };
  return makeBattle({
    defs,
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [],
      units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
    }],
    enemies: rows,
    autoFinish: false,
    timeLimit: opts.timeLimit ?? 30,
    captureNoisy: true,
    hooks: ['damaged'],
    flags: flags ?? { enemyHexIds: [hexId] },
    ...opts,
  });
}

test('enemy verbs: the id reaches the battle through flags.enemyHexIds and its script installs', () => {
  const h = enemyVerbBattle('ehex_stealth', { enemyKey: 'enemy_march' });
  h.run(0.5);
  assert.equal(h.battle._enemyVerbsInstalled, true, 'install saw the flag');
  const e = h.enemies()[0];
  assert.ok(e, 'the enemy is on the field (premise)');
  assert.ok(e.findBuff('ab:stealth'), '隐匿: it opens stealthed');
  h.invariants();
});

test('enemy verbs: an empty flag installs nothing, and an unknown verb never throws', () => {
  const h = enemyVerbBattle('ehex_stealth', { enemyKey: 'enemy_march', flags: {} });
  h.run(0.5);
  assert.ok(!h.battle._enemyVerbsInstalled, 'no flag → no install');
  const e = h.enemies()[0];
  assert.ok(e && !e.findBuff('ab:stealth'), 'and no stealth buff');
  h.invariants();
  // a flag naming an id the data does not have is a no-op (the build rejects it; the battle must not crash)
  const h2 = enemyVerbBattle('ehex_stealth', { enemyKey: 'enemy_march', flags: { enemyHexIds: ['ehex_nope'] } });
  h2.run(0.5);
  assert.ok(!h2.enemies()[0].findBuff('ab:stealth'), 'an unknown id installs nothing');
  h2.invariants();
});

// The 2026-10-12 rebalance: 隐匿 only reaches GROUND, non-boss enemies (a flyer has no block to break it and no ground
// path to hide along; a hidden boss would hide the stage's main threat).
test('隐匿 (stealth): a ground enemy opens hidden, a flyer and a boss do not', () => {
  const ground = enemyVerbBattle('ehex_stealth', { enemyKey: 'enemy_march' });
  ground.run(0.5);
  assert.ok(ground.enemies()[0].findBuff('ab:stealth'), 'a ground enemy opens hidden (premise)');
  ground.invariants();
  const air = enemyVerbBattle('ehex_stealth', {
    enemyKey: 'enemy_flyer',
    defs: { chess: { test_guard: guard() }, enemies: { enemy_flyer: enemyRec({ key: 'enemy_flyer', hp: 100000, atk: 100, def: 0, speed: 1, motion: 'FLY' }) } },
  });
  air.run(0.5);
  const f = air.enemies()[0];
  assert.ok(f && f.isFlying, 'the enemy really is airborne (premise)');
  assert.ok(!f.findBuff('ab:stealth'), '隐匿 skips a flyer');
  air.invariants();
  const boss = enemyVerbBattle('ehex_stealth', {
    enemyKey: 'enemy_march',
    enemies: [{ key: 'enemy_march', time: 0, route: 0, tag: 'boss', pos: [10, 6] }],
  });
  boss.run(0.5);
  const b = boss.enemies().find((e) => e.isBoss);
  assert.ok(b, 'the tagged boss is on the field (premise)');
  assert.ok(!b.findBuff('ab:stealth'), '隐匿 skips a boss');
  boss.invariants();
});

// The 2026-10-12 follow-up: a 次数怪 (a 频次 / hit-count unit) never opens hidden either. Its only reveal line is
// 被阻挡 and the 器物 are 无法被阻挡, so the two together left it permanently unselectable — the death-spawned
// 木制瑞印 of 磨砻 walked into the goal with nobody able to touch it (owner's report).
test('隐匿 (stealth): a 次数怪 does not open hidden — a death-spawned 器物 stays selectable, a plain enemy does not', () => {
  const h = enemyVerbBattle('ehex_stealth', { enemyKey: 'enemy_march' });
  h.run(0.5);
  // a hit-count unit spawned through the real engine, the way a death spawn or a leader's summon makes one
  const kid = h.b.spawnEnemy('enemy_1196_msfyin', { pos: [11, 6], route: { motion: 'WALK', start: [11, 6], end: [9, 2], checkpoints: [] } });
  assert.ok(kid && isHitCount(kid), 'the spawned unit really is a 次数怪 (premise)');
  assert.ok(!kid.findBuff('ab:stealth'), '隐匿 never reaches a 次数怪');
  assert.ok(canTargetEnemy(h.unit('test_guard'), kid, h.unit('test_guard').profile), 'and it is targetable, unlike before');
  assert.ok(h.enemies()[0].findBuff('ab:stealth'), 'a plain ground enemy still opens hidden (premise)');
  h.invariants();
});

// The official kits' OWN 隐匿 is not this card: 逐火's 余烬 / 再生's 傀儡 hide through their own kits (the husk buff
// `ab:ember` carries `flags.stealth`; targeting.js enemyStealthed reads the flag, not `ab:stealth`). A naive
// "a 次数怪 never hides" rule in targeting.js would have broken exactly this unit, so the gate sits in the card's own
// spawn hook and this test keeps the kit honest.
test('隐匿 (stealth): the official kits’ own 隐匿 is untouched — 深池逐火’s 余烬 still hides, blocked-only as before', () => {
  // the REAL record (a synthetic key would carry no 天赋 numbers for husk) and the card through the real flag channel
  const h = makeBattle({
    defs: { chess: { t_gun: gun() } },
    units: [{ chessId: 't_gun', row: 9, col: 6 }],
    enemies: [{ key: 'enemy_1288_duskls', time: 0, route: 0 }],
    flags: { enemyHexIds: ['ehex_stealth'] },
    timeLimit: 40,
    autoFinish: false,
  });
  h.run(0.5);
  const e = h.enemies()[0];
  assert.ok(e && e.defId === 'enemy_1288_duskls', 'the warrior is on the field (premise)');
  assert.ok(e.findBuff('ab:stealth'), 'the card still hides the warrior itself (premise)');
  h.b.kill(e, null);
  h.run(HUSK_REBIRTH + 0.05);
  assert.ok(e.alive, 'the knock-out left the 余烬 standing (premise)');
  assert.ok(isHitCount(e), 'the 余烬 is a 次数怪 (premise) — the card must not be what keeps it visible');
  assert.ok(e.s.flags.stealth && enemyStealthed(e), 'its own 隐匿 is untouched by the card');
  const u = h.unit('t_gun');
  assert.equal(canTargetEnemy(u, e, u.profile), false, 'and unblocked it stays unselectable, exactly as the kit intends');
  h.invariants();
});

test('破甲弹 (armorbreak): the enemy’s physical hits shred the struck operator’s DEF, stacking to the cap', () => {
  const h = enemyVerbBattle('ehex_armorbreak', { enemyKey: 'enemy_march', timeLimit: 30 });
  h.run(30);
  const u = h.allies()[0];
  const b = u.findBuff('hexverb:armorbreak');
  assert.ok(b, 'the operator was hit physically');
  assert.ok(b.stacks > 0 && b.stacks <= 8, `stacks 1..8 (got ${b.stacks})`);
  assert.equal(b.mods.defFlat, -25, 'each stack is −25 DEF');
  h.invariants();
});

test('莱茵护甲 (hitShield): 敌人血量不变，额外挡 3 次攻击（业主 2026-10-16）', () => {
  // 业主报「莱茵护甲怎么把怪的生命值改了」。旧实现是 `hitCount` + `setHits`，而 `setHits` 会把 `base.maxHp`
  // 整个**覆盖**成"次数"（helpers.js 的注释就是 `maxHp := hits`）—— 十万血的首领也变成 3 点血、血条消失。
  // `hitCount` 是给器物 / 频次怪用的另一种机制（它们本来就是"打 N 次才倒"），不是给"加一层盾"用的。
  // 真正的一层盾是引擎自己的 `ab.hitShield`（enemies.js onHitIn：整段物理/法术伤害被 cancel、扣 1 层、
  // 破盾放 shieldBreak），官方莱茵生命防卫科高级成员与假想敌：再生用的都是它。
  const h = enemyVerbBattle('ehex_leine', { enemyKey: 'enemy_dummy', timeLimit: 30 });
  h.run(0.5);
  const e = h.enemies()[0];
  const b = h.battle;
  assert.ok(e, 'the enemy is on the field (premise)');
  assert.equal(e.s.maxHp, 100000, 'the HP is untouched (the bug made this 3)');
  assert.ok(!isHitCount(e), 'it is NOT a 频次 unit: that mechanic exists for 器物, not for a shield');
  assert.equal(abOf(b, e).hitShield, 3, '3 layers of the real hit shield');
  const breaks = [];
  const fx = b.fx.bind(b);
  b.fx = (k, p) => { if (k === 'shieldBreak') breaks.push(p.id); return fx(k, p); };
  for (let i = 1; i <= 3; i++) {
    assert.equal(b.dealDamage(null, e, { amount: 25000, type: 'phys', ignoreSleep: true }), 0, `hit ${i}: the whole instance is negated`);
    assert.equal(e.hp, 100000, `hit ${i}: no HP was lost`);
    assert.equal(abOf(b, e).hitShield, 3 - i, `hit ${i}: ${3 - i} layers left`);
  }
  assert.deepEqual(breaks, [e.id], 'the shield breaks once, with its fx');
  assert.equal(b.dealDamage(null, e, { amount: 25000, type: 'phys', ignoreSleep: true }), 25000, 'the 4th hit lands');
  assert.equal(e.hp, 75000);
  h.invariants();
});

test('铁壁 (ironwall): physical damage is reflected, and the recursion guard stops it looping forever', () => {
  const h = enemyVerbBattle('ehex_ironwall', { enemyKey: 'enemy_march', timeLimit: 20 });
  // the real assertion is that this returns at all: an unguarded `hurt` on the attacker re-enters `damaged` forever
  h.run(20);
  assert.ok(h.battle.time >= 19, `the battle ran to its limit (got ${h.battle.time})`);
  h.invariants();
});

test('淬毒 (venom): the enemy’s attacks carry element damage', () => {
  const h = enemyVerbBattle('ehex_venom', { enemyKey: 'enemy_march', timeLimit: 30 });
  h.run(30);
  const elem = h.hooksOf('damaged').filter((c) => c && (c.type === 'element' || c.type === 'elemental'));
  assert.ok(elem.length > 0, `element damage was dealt (got ${elem.length})`);
  h.invariants();
});

test('亡语 (deathrattle): a knock-out damages the operators around the corpse', () => {
  const h = enemyVerbBattle('ehex_deathrattle', { timeLimit: 30 });
  h.run(1);
  const u = h.allies()[0];
  const hp0 = u.hp;
  const e = h.enemies()[0];
  e.x = u.x; e.y = u.y;
  h.battle.kill(e, u);
  assert.ok(u.hp < hp0, `the operator took the deathrattle (hp ${Math.round(hp0)} → ${Math.round(u.hp)})`);
  h.invariants();
});

test('回响 (echo): a knock-out splits the enemy into weaker copies', () => {
  const h = enemyVerbBattle('ehex_echo', { timeLimit: 30, round: ECHO_CERTAIN_ROUND });
  h.run(0.5);
  const before = h.battle.enemies.length;
  h.battle.kill(h.enemies()[0], h.allies()[0]);
  h.run(0.5);
  assert.ok(h.battle.enemies.length > before - 1, `the split replaced the corpse (${before} → ${h.battle.enemies.length})`);
  h.invariants();
});

test('军旗 (banner): a knock-out empowers the surviving enemies', () => {
  const h = enemyVerbBattle('ehex_banner', { enemyKeys: ['enemy_walker', 'enemy_march'], timeLimit: 30 });
  h.run(1);
  const survivor = h.battle.enemies.find((e) => e.defId === 'enemy_march');
  assert.ok(survivor, 'the tough enemy is alive (premise)');
  const a0 = survivor.s.atk;
  const victim = h.battle.enemies.find((e) => e.defId === 'enemy_walker');
  h.battle.kill(victim, h.allies()[0]);
  h.run(0.2);
  assert.ok(survivor.s.atk > a0, `the survivor gained ATK (${a0} → ${survivor.s.atk})`);
  h.invariants();
});

test('狂化 (frenzy): attack speed is gained once the enemy drops under the threshold', () => {
  const h = enemyVerbBattle('ehex_frenzy', { enemyKey: 'enemy_march', timeLimit: 30 });
  h.run(1);
  const e = h.enemies()[0];
  const a0 = e.s.aspd;
  e.hp = e.s.maxHp * 0.4;
  h.battle.emit('damaged', { source: null, target: e, amount: 0, type: 'true' });
  e.markDirty();
  assert.ok(e.s.aspd > a0, `ASPD rose (${a0} → ${e.s.aspd})`);
  h.invariants();
});

test('腐蚀领域 (corrode): a zone is planted and detonates for true damage', () => {
  const h = enemyVerbBattle('ehex_corrodefield', { enemyKey: 'enemy_march', timeLimit: 30 });
  h.run(1);
  const u = h.allies()[0];
  const hp0 = u.hp;
  h.run(7);
  assert.ok(u.hp < hp0, `the operator took the blast (hp ${Math.round(hp0)} → ${Math.round(u.hp)})`);
  h.invariants();
});

// The blast is `damage + damagePerRound × x`, x = the round being fought (read from battle.round — fixed for the whole
// battle by the match, 0 in a bare harness battle). The slope was 40 until 2026-10-14, when the owner set it to 25.
test('腐蚀领域 (corrode): the blast is 80 + 25x true damage, x = the round being fought', () => {
  /** Every true-damage hit on the (single) operator in the first 7 s = the first blast only (planted t=4, fused 2 s). */
  const blasts = (round) => {
    const h = enemyVerbBattle('ehex_corrodefield', { enemyKey: 'enemy_march', timeLimit: 30, round });
    h.run(7);
    const u = h.allies()[0];
    assert.ok(u, 'the operator is on the field (premise)');
    return { h, amounts: h.hooks.damaged.filter((d) => d.target === u && d.type === 'true').map((d) => d.amount) };
  };
  // the record is the authority for the slope (the handler only reads params)
  assert.equal(hex('ehex_corrodefield').params.damage, 80, 'the flat part');
  assert.equal(hex('ehex_corrodefield').params.damagePerRound, 25, 'and the per-round slope');
  const r11 = blasts(11);
  assert.deepEqual(r11.amounts, [355], '80 + 25 × 11');
  r11.h.invariants();
  const r0 = blasts(0);
  assert.deepEqual(r0.amounts, [80], 'a bare harness battle carries no round, so only the flat part lands');
  r0.h.invariants();
  const r14 = blasts(14);
  assert.deepEqual(r14.amounts, [430], '80 + 25 × 14 (uncapped)');
  r14.h.invariants();
});

test('嗜血 (bloodthirst): the enemy heals off the damage it deals', () => {
  const h = enemyVerbBattle('ehex_bloodthirst', { enemyKey: 'enemy_march', timeLimit: 30 });
  h.run(1);
  const e = h.enemies()[0];
  const u = h.allies()[0];
  e.hp = e.s.maxHp * 0.5;
  const hp0 = e.hp;
  // the rule is "heals a share of the damage it deals", so drive one damage instance with the enemy as its source
  // (fighting it directly is not decisive: the operator out-damages the 40 % return)
  h.battle.emit('damaged', { source: e, target: u, amount: 1000, type: 'phys' });
  assert.ok(e.hp > hp0, `the enemy healed off its own damage (hp ${Math.round(hp0)} → ${Math.round(e.hp)})`);
  h.invariants();
});

// =====================================================================================================================
// 社区反馈 (2026-10-11): the two enemy verb cards whose `death` handler answered a LEAK, and the reflect a
// double mitigation swallowed. Each case below is the reported symptom written down as an assertion.
// =====================================================================================================================

/** An enemy that survives a manual hit and reaches the goal on its own (speed 1, no operator on its lane). */
function leakyBattle(hexId, opts = {}) {
  return makeBattle({
    defs: { chess: { test_guard: guard() }, enemies: { enemy_march: marcher() } },
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [], units: opts.units ?? [] }],
    enemies: [{ key: 'enemy_march', time: 0, route: 0, count: opts.count ?? 1 }],
    autoFinish: false,
    timeLimit: opts.timeLimit ?? 120,
    captureNoisy: true,
    hooks: ['damaged'],
    ...(hexId ? { flags: { enemyHexIds: [hexId] } } : {}),
  });
}

test('回响 (echo): a LEAK never splits — one leaked enemy bills the leaker once, not three times', () => {
  // The report: "敌人有个词条死亡分裂2个50%血怪没有正常生效，反倒是计算漏怪时生效了…人机漏次数怪分裂后计算成了273只怪"
  // `Battle._remove` fires `death` for a leak as well (`reason: 'leak'`), so the split ran at the goal and its two
  // children leaked too — every one of them `counted`, so ONE scheduled enemy became 3 counted leaks, forever.
  const h = leakyBattle('ehex_echo');
  h.runToEnd(120);
  assert.equal(h.b.total, 1, 'the stage scheduled one enemy and the denominator never moves');
  assert.equal(h.b.leakedCount, 1, 'one leaked enemy is ONE counted leak (was 3)');
  assert.equal(h.b.leakedInTotal, 1, 'and one 漏掉 of the stage\'s own list');
  assert.equal(h.result().perPlayer.p1.leaked.length, 1, 'the result bills the leaker once');
  h.invariants();

  // the same stage without the hex gives the identical reading — 回响 is 被击倒, it must not touch a leak at all
  const plain = leakyBattle(null);
  plain.runToEnd(120);
  assert.equal(plain.b.leakedCount, h.b.leakedCount, 'a leaking stage is indistinguishable from one without 回响');
  plain.invariants();

  // a stale-count guard: 5 leaked enemies stay 5 (the reported inflation was 5 → 15)
  const five = leakyBattle('ehex_echo', { count: 5, timeLimit: 240 });
  five.runToEnd(240);
  assert.equal(five.b.leakedCount, 5, `5 leaked enemies are 5 counted leaks (got ${five.b.leakedCount})`);
  assert.equal(five.b.total, 5);
  five.invariants();
});

test('回响 (echo): a KNOCK-OUT still splits into two half-HP copies that continue the route', () => {
  // the card's actual rule must survive the leak fix: 被击倒 → 2 copies at 50 % HP. R9 is where the 2026-10-13 chance
  // reaches 1, so the roll cannot make this test flaky.
  const h = enemyVerbBattle('ehex_echo', { timeLimit: 30, round: ECHO_CERTAIN_ROUND });
  h.run(0.5);
  const e = h.enemies()[0];
  assert.ok(e.inTotal, 'the parent is the stage\'s own enemy (premise)');
  h.battle.kill(e, h.allies()[0]);
  h.run(0.5);
  const kids = h.b.enemies.filter((k) => k.alive);
  assert.equal(kids.length, 2, 'the corpse split into 2 copies');
  for (const k of kids) {
    assert.equal(k.hp, k.s.maxHp * 0.5, `each copy starts at 50 % HP (${k.hp}/${k.s.maxHp})`);
    assert.ok(!k.inTotal, 'a split child is a runtime spawn: it moves no capsule number');
    assert.ok(k.counted, '… but it still costs LP when it leaks');
  }
  assert.equal(h.b.killedInTotal, 1, 'the parent resolved the capsule on its own');
  h.invariants();
});

// The 2026-10-13 rebalance: the split became a CHANCE, `0.1 + 0.1x` (x = the round being fought). Below R9 it is a real
// roll, so this test drives the roll itself rather than the battle: it pins the formula at both ends and in the middle.
test('回响 (echo): the split chance is 0.1 + 0.1x — certain from R9 on, a real roll before that', () => {
  // the record carries the numbers (data is the authority, like 腐蚀领域's damagePerRound)
  const rec = hex('ehex_echo');
  assert.equal(rec.params.chance, 0.1, 'the flat part');
  assert.equal(rec.params.chancePerRound, 0.1, 'and the per-round part');
  // R1 → 20 %: over many independent corpses the split rate must land near it, never at 0 or 1
  const rate = (round, n) => {
    let split = 0;
    for (let i = 0; i < n; i++) {
      const h = enemyVerbBattle('ehex_echo', { timeLimit: 30, round, seed: 1000 + i });
      h.run(0.5);
      h.b.kill(h.enemies()[0], h.allies()[0]);
      h.run(0.3);
      if (h.b.enemies.filter((k) => k.alive).length === 2) split++;
    }
    return split / n;
  };
  const r1 = rate(1, 120);
  assert.ok(r1 > 0.05 && r1 < 0.4, `R1 is a real roll around 20 % (got ${(r1 * 100).toFixed(1)} %)`);
  const r5 = rate(5, 120);
  assert.ok(r5 > r1 - 0.1 && r5 < 0.85, `R5 (60 %) splits more often than R1 (got ${(r5 * 100).toFixed(1)} %)`);
  // R9+ is certain: every corpse splits, whatever the seed
  const r12 = rate(12, 40);
  assert.equal(r12, 1, 'from R9 on the chance has saturated — every knock-out splits');
});

test('回响 (echo): a split child may not split again, and a boss is never split', () => {
  const h = enemyVerbBattle('ehex_echo', { timeLimit: 30, round: ECHO_CERTAIN_ROUND });
  h.run(0.5);
  h.battle.kill(h.enemies()[0], h.allies()[0]);
  h.run(0.3);
  const kid = h.b.enemies.find((k) => k.alive);
  h.battle.kill(kid, h.allies()[0]);
  h.run(0.3);
  assert.equal(h.b.enemies.filter((k) => k.alive).length, 1, 'one child was killed and only its sibling remains');
  h.invariants();
});

test('亡语 (deathrattle): a LEAK never detonates — only a knock-out damages the operators around the corpse', () => {
  // same class of bug as 回响: the card says 被击倒, but `death` also fires for a leak, so an enemy that ESCAPED
  // damaged the operators it walked past.
  const h = enemyVerbBattle('ehex_deathrattle', { timeLimit: 30 });
  h.run(0.5);
  const u = h.allies()[0];
  const e = h.enemies()[0];
  e.x = u.x; e.y = u.y;
  const hp0 = u.hp;
  h.battle.leak(e);
  h.run(0.3);
  assert.equal(u.hp, hp0, 'a leaked enemy dealt no deathrattle (it was not 被击倒)');
  h.invariants();

  // the knock-out path still fires
  const h2 = enemyVerbBattle('ehex_deathrattle', { timeLimit: 30 });
  h2.run(1);
  const u2 = h2.allies()[0];
  const e2 = h2.enemies()[0];
  e2.x = u2.x; e2.y = u2.y;
  const hp2 = u2.hp;
  h2.battle.kill(e2, u2);
  assert.ok(u2.hp < hp2, `the knock-out still detonated (hp ${Math.round(hp2)} → ${Math.round(u2.hp)})`);
  h2.invariants();
});

test('铁壁 (ironwall): 20 % of the ENEMY’S OWN ATK, the same at every operator DEF (§29.39)', () => {
  // §29.15's report was "敌人词条造成物理伤害应该给干员反伤这个好像也没生效": the reflect was `phys` of `taken × 15 %` and
  // went through `mitigate` against the attacker's DEF a second time, collapsing onto the 5 % floor on a high-DEF
  // operator. The owner's rebalance of 2026-10-14 changes WHAT it scales with as well: 20 % of the enemy's own ATK, read
  // live off the attacker (`t.s.atk`), so the card neither grows with the player's damage nor shrinks with the
  // player's DEF — and an ATK-0 enemy reflects nothing at all.
  const ATK = 600;
  const slap = (def) => chessRec({ id: 'test_slap', stats: { maxHp: 999999, atk: 1000, def, res: 0, blockCnt: 1 }, skill: null });
  const beast = () => enemyRec({ key: 'enemy_beast', hp: 10000000, atk: ATK, def: 0, res: 0, speed: 1, bat: 3 });
  const totals = [];
  for (const DEF of [0, 200, 800]) {
    const h = makeBattle({
      defs: { chess: { test_slap: slap(DEF) }, enemies: { enemy_beast: beast() } },
      players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [], units: [{ uid: 1, kind: 'chess', chessId: 'test_slap', row: 9, col: 6 }] }],
      enemies: [{ key: 'enemy_beast', time: 0, route: 0 }],
      autoFinish: false, timeLimit: 20, captureNoisy: true, hooks: ['damaged'],
      flags: { enemyHexIds: ['ehex_ironwall'] },
    });
    h.run(20);
    const back = h.hooksOf('damaged').filter((c) => c.dmg && c.dmg.steadThorn);
    assert.ok(back.length > 0, `the enemy reflected at least once (DEF ${DEF})`);
    // every instance is the full 20 % of the enemy's ATK — nothing cuts it a second time
    for (const c of back) assert.ok(Math.abs(c.amount - ATK * 0.2) < 1e-6, `reflect = 20 % of the enemy's ATK (DEF ${DEF}: ${c.amount})`);
    totals.push(back.reduce((s, c) => s + c.amount, 0));
    h.invariants();
  }
  // the operator's DEF no longer enters the formula at all: the three runs are the same battle otherwise, so the totals match
  assert.deepEqual(totals, [totals[0], totals[0], totals[0]], `the reflect does not depend on the operator's DEF (${totals.join(' / ')})`);

  // an ATK-0 enemy has nothing to reflect with (器物 / support carriers), whatever the damage it takes
  const h0 = makeBattle({
    defs: { chess: { test_slap: slap(200) }, enemies: { enemy_beast: enemyRec({ key: 'enemy_beast', hp: 10000000, atk: 0, def: 0, res: 0, speed: 1, bat: 3 }) } },
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [], units: [{ uid: 1, kind: 'chess', chessId: 'test_slap', row: 9, col: 6 }] }],
    enemies: [{ key: 'enemy_beast', time: 0, route: 0 }],
    autoFinish: false, timeLimit: 20, captureNoisy: true, hooks: ['damaged'],
    flags: { enemyHexIds: ['ehex_ironwall'] },
  });
  h0.run(20);
  const dealt0 = h0.hooksOf('damaged').filter((c) => c.source && c.source.side === 'ally' && c.target && c.target.side === 'enemy' && c.type === 'phys')
    .reduce((s, c) => s + c.amount, 0);
  assert.ok(dealt0 > 0, 'the operator still hit the ATK-0 enemy');
  assert.equal(h0.hooksOf('damaged').filter((c) => c.dmg && c.dmg.steadThorn).length, 0, 'and it reflected nothing (ATK 0 × 20 % = 0)');
  h0.invariants();
});

// ---------------------------------------------------------------------------------------------------------------------
// 回响 (echo) and the fields that are NOT the stage's own enemies (§29.15). The card splits every non-`boss` knock-out
// into copies that KEEP the parent's key, which surfaced three further facets of the same defect:
//   1. the copies inherited neither the parent's `counted` reading nor its neutral marker;
//   2. a copy of a content-made neutral (隐德来希's 心烛) resolved through the FALLBACK record and walked to the goal;
//   3. the match's honest-result validator could not see same-key children, so it rejected legitimate client results.

test('回响 (echo): a copy of an UNCOUNTED spawn stays uncounted (never starts costing LP)', () => {
  // `spawnChildren` passes no `countInTotal`, so a copy used to fall back to `counted: true`: an uncounted summon's
  // children began to leak for real LP and 完美作战 damage.
  const h = enemyVerbBattle('ehex_echo', { timeLimit: 30, round: ECHO_CERTAIN_ROUND });
  h.run(0.5);
  const e = h.enemies()[0];
  // a stage enemy spawned as an uncounted body, the shape a kit summon has (countInTotal: false)
  const neutral = h.b.spawnEnemy('enemy_march', {
    pos: [e.y, e.x + 1], route: { motion: 'WALK', start: [Math.round(e.y), Math.round(e.x + 1)], end: [Math.round(e.y), Math.round(e.x + 1)], checkpoints: [] },
    countInTotal: false, ownerPlayerId: e.ownerId,
  });
  assert.ok(neutral, 'the uncounted body spawned (premise)');
  assert.equal(neutral.counted, false, 'premise: it does not count');
  h.b.kill(neutral, h.allies()[0]);
  h.run(0.2);
  const kids = h.b.enemies.filter((k) => k.alive && k.defId === 'enemy_march' && k !== e);
  assert.ok(kids.length > 0, 'the uncounted body still split (the card is about knock-outs, not about counting)');
  for (const k of kids) assert.equal(k.counted, false, 'a copy of an uncounted spawn never becomes counted');
  h.invariants();
});

test('回响 (echo): a content-made NEUTRAL (mem.noLeak) is never split — no goal-walking garbage copies', () => {
  // 隐德来希's 心烛 is placed with an inline record absent from data/enemies.json, `countInTotal: false` and `mem.noLeak`.
  // `spawnChildren` re-derived a route from the parent's own stay route (`start === end`), so `spawnEnemy` appended the
  // stage's GOAL leg and the copy — resolved through the FALLBACK record (speed 1) — walked off the map and leaked:
  // one 心烛 billed 3 counted leaks where the whole summon is worth 0.
  const h = enemyVerbBattle('ehex_echo', { timeLimit: 30, round: ECHO_CERTAIN_ROUND });
  h.run(0.5);
  const e = h.enemies()[0];
  const def = { name: '心烛', rank: 'NORMAL', applyWay: 'NONE', motion: 'WALK', notCountInTotal: true, lifePointReduce: 0, stats: { maxHp: 1000, atk: 0, def: 0, magicResistance: 0, moveSpeed: 0, massLevel: 1 } };
  const r = Math.round(e.y), c = Math.round(e.x);
  const candle = h.b.spawnEnemy('enemy_5601_entlec', {
    def, pos: [e.y, e.x], route: { motion: 'WALK', start: [r, c], end: [r, c], checkpoints: [] },
    countInTotal: false, ownerPlayerId: e.ownerId,
  });
  assert.ok(candle, 'the neutral spawned (premise)');
  candle.mem.noLeak = true;
  const leaked0 = h.b.leakedCount;
  h.b.kill(candle, null);
  h.run(0.3);
  const copies = h.b.enemies.filter((k) => k.alive && k.defId === 'enemy_5601_entlec');
  assert.equal(copies.length, 0, `a content-made neutral is never split (got ${copies.length} copies)`);
  assert.equal(h.b.leakedCount, leaked0, 'and nothing leaked for it');
  h.invariants();
  // the card still splits an ordinary enemy (the gate must be the neutral marker, not "no splitting at all"); R9 keeps
  // the 2026-10-13 chance at 1, so this half tests the gate rather than the roll
  const h2 = enemyVerbBattle('ehex_echo', { timeLimit: 30, round: ECHO_CERTAIN_ROUND });
  h2.run(0.5);
  h2.b.kill(h2.enemies()[0], h2.allies()[0]);
  h2.run(0.2);
  assert.equal(h2.b.enemies.filter((k) => k.alive).length, 2, 'an ordinary knock-out still splits into 2');
  h2.invariants();
});

test('回响 (echo): a same-key copy is billed to the parent\'s own key, never as a foreign leak', () => {
  // The copies keep the parent's key, so a leaked copy is a leak of THAT key — never a key the schedule does not name.
  // The result's leaked list must therefore only ever name keys the spec scheduled (the validator's 'leak key' case).
  const h = enemyVerbBattle('ehex_echo', { timeLimit: 30, round: ECHO_CERTAIN_ROUND });
  h.run(0.5);
  const scheduled = new Set(h.enemies().map((e) => e.defId));
  h.b.kill(h.enemies()[0], h.allies()[0]);
  h.run(0.2);
  for (const k of h.b.enemies.filter((x) => x.alive)) h.b.leak(k);
  h.run(0.2);
  const r = h.result();
  for (const pid of Object.keys(r.perPlayer)) {
    for (const l of r.perPlayer[pid].leaked || []) {
      assert.ok(scheduled.has(l.enemyKey), `a leaked copy names a scheduled key (got ${l.enemyKey})`);
      assert.equal(l.counted, true, 'and carries the parent\'s counted reading');
    }
  }
  h.invariants();
});

// =====================================================================================================================
// eighth batch (the owner's list of 2026-10-12, §29.23)

test('回响形态 (extraCharges): every own skill gains a charge of headroom, and only a NON-timed skill becomes chargeable', () => {
  // chessRec's default skill carries duration 10, so `withSkill(n)` is a 持续技能 (kind 'duration') unless it says otherwise.
  const withSkill = (mct) => guard({ skill: { maxChargeTime: mct, charges: mct, spCost: 20 } });
  const plain = soloBattle({ hexes: [], chess: { test_guard: withSkill(2) }, timeLimit: 5 });
  plain.run(0.5);
  const base = one(plain).skill;
  assert.ok(base && !base.noSkill, 'premise: the synthetic operator has a real skill');
  assert.equal(base.maxCharges, 2, 'premise: a two-charge skill');
  const h = soloBattle({ hexes: ['hex_echoform'], chess: { test_guard: withSkill(2) }, timeLimit: 5 });
  h.run(0.5);
  const sk = one(h).skill;
  assert.equal(sk.maxCharges, 3, 'the card adds one charge of headroom');
  // A TIMED skill must keep its kind: 'charges' drops it out of `isTimed`, so its duration timer never runs and the
  // cast ends at once (GitHub #549: 持续技能直接结束).
  assert.equal(sk.kind, 'duration', 'a 持续技能 stays a duration skill — the card only widens its charges');
  assert.equal(sk.isTimed, true, 'and therefore still counts as timed');
  // …and a skill that could not hold a charge at all (no duration, one charge, kind instant) becomes a charges skill
  const inst = soloBattle({ hexes: ['hex_echoform'], chess: { test_guard: guard({ skill: { duration: 0, maxChargeTime: 1, charges: 1, spCost: 20 } }) }, timeLimit: 5 });
  inst.run(0.5);
  const ik = one(inst).skill;
  assert.equal(ik.maxCharges, 2, 'an instant skill can now hold two');
  assert.equal(ik.kind, 'charges', 'which is what the charge loop reads');
  h.invariants();
  inst.invariants();
});

test('回响形态 (extraCharges): a 持续技能 still runs its full duration with the card (GitHub #549)', () => {
  // The reported bug: with the card the cast ended immediately — at the activation instant, or on its first attack.
  const duration = (extra) => guard({ skill: { duration: 8, spCost: 20, maxChargeTime: 1, charges: 1, attack: { atkScale: 2 }, ...extra } });
  for (const hexes of [[], ['hex_echoform']]) {
    const h = soloBattle({ hexes, chess: { test_guard: duration() }, timeLimit: 20 });
    h.run(0.5);
    const u = one(h);
    const sk = u.skill;
    sk.addCharge(1);                        // ready without waiting for 20 SP
    assert.equal(sk.activate('test'), true, 'the skill starts');
    h.run(2);
    assert.equal(sk.active, true, `with hexes=${JSON.stringify(hexes)} the cast is still running 2 s in (duration 8)`);
    assert.equal(h.hooksOf('skillEnd').length, 0, 'and it has not ended early');
    h.run(7);
    assert.equal(sk.active, false, 'it ends on its own timer, not early');
    assert.deepEqual(h.hooksOf('skillEnd').map((c) => c.reason), ['duration'], 'and the reason is the duration, not instant/ammo');
    h.invariants();
  }
});

test('恶魔形态 (demonForm): only the operator CARRYING 恶魔之契 gains +10 % ATK every second, uncapped', () => {
  // The owner's report of 2026-10-13 (§29.32): the card used to draw ONE RANDOM own operator at battle start, which the
  // player could not steer. The equipment now decides: no carrier ⇒ no growth at all.
  const bare = soloBattle({ hexes: ['hex_demonform'], timeLimit: 30 });
  bare.run(5);
  assert.equal(buffsOf(one(bare), 'hex:demonform').length, 0, 'no carrier on the field ⇒ nothing grows');
  bare.invariants();

  // one guard carries the pact, one does not: only the carrier grows
  const two = soloBattle({
    hexes: ['hex_demonform'], timeLimit: 30,
    units: [
      { uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6, items: ['chess_item_9_91_e_a'] },
      { uid: 2, kind: 'chess', chessId: 'test_guard', row: 12, col: 6 },
    ],
  });
  two.run(0.5);
  const [carrier, other] = ops(two);
  assert.ok(carrier && other, 'both operators are on the field');
  assert.equal(buffsOf(carrier, 'hex:demonform').length, 0, 'nothing in the first half-second');
  two.run(5);
  const b = buffsOf(carrier, 'hex:demonform');
  assert.equal(b.length, 1, 'one stacking entry');
  assert.ok(b[0].stacks >= 4, `about one stack a second (got ${b[0].stacks})`);
  assert.equal(b[0].stacks, Math.floor(two.b.time), 'exactly one a second');
  assert.ok(Math.abs(b[0].mods.atkPct - 0.1) < 1e-9, `+10 % ATK a stack (got ${b[0].mods && b[0].mods.atkPct})`);
  assert.equal(buffsOf(other, 'hex:demonform').length, 0, 'the operator without the pact is untouched');
  two.invariants();
});

test('群蛇形态 (serpentKills): the count the match wrote into the ref kills that many enemies at the start', () => {
  const ref = {
    ...refOf('hex_serpentform'),
    params: { ...hex('hex_serpentform').effect, serpentKills: { perPoint: 1, count: 2 } },
  };
  const wave = [
    { key: 'enemy_walker', time: 0, route: 0 },
    { key: 'enemy_walker', time: 0, route: 0 },
    { key: 'enemy_walker', time: 0, route: 0 },
    { key: 'enemy_walker', time: 0, route: 0 },
  ];
  const h = soloBattle({ hexes: [ref], enemies: wave, timeLimit: 30, hooks: ['death'], captureNoisy: true });
  h.run(0.5);
  assert.equal(h.b.enemies.filter((e) => e.alive).length, 2, 'two of the four died on arrival');
  assert.equal(h.hooksOf('death').length, 2, 'each one a real knock-out (they were spawned, then killed)');
  // the ref's own perPoint is what the match reads; a ref without a count kills nothing
  const none = soloBattle({ hexes: ['hex_serpentform'], enemies: wave, timeLimit: 30 });
  none.run(0.5);
  assert.equal(none.b.enemies.filter((e) => e.alive).length, 4, 'no count, no kills');
  h.invariants();
  none.invariants();
});

// =====================================================================================================================
// tenth batch (the owner's list of 2026-10-12, §29.27): 逻各斯 and 你我一体

test('逻各斯 (logos): an enemy in range below 120 % of the operator’s ATK is executed by 9999999 无来源 true damage', () => {
  // The guard has ATK 500, so the threshold is 600 HP and the frail walker (400 HP) is under it. The operator is
  // DISARMED from the battle start, so its own attacks can never be what kills the walker — the execution must be.
  const h = soloBattle({
    hexes: ['hex_logos'],
    enemies: [{ key: 'enemy_walker', time: 0, route: 0 }],
    timeLimit: 30, hooks: ['hit', 'death'], captureNoisy: true,
    setup: (b) => b.on('battleStart', () => { for (const u of b.allyUnits) b.addBuff(u, { key: 'test:disarm', flags: { disarm: true }, persist: true, allowDead: true }); }, { priority: 100 }),
  });
  h.run(1);
  const u = one(h);
  assert.ok(u, 'the operator deployed');
  assert.ok(400 < 1.2 * u.s.atk, `the walker (400 HP) is below the threshold (${1.2 * u.s.atk})`);
  assert.ok(h.runUntil(() => h.enemies().length === 0, 20), 'the walker was executed');
  const hit = h.hooksOf('hit').find((c) => c.dmg && (c.dmg.tags || []).includes('logos'));
  assert.ok(hit, 'the execution ran through the damage pipeline (not a bare kill)');
  assert.deepEqual(
    [hit.source, hit.credit, hit.dmg.type, hit.dmg.sourceless, hit.dmg.canDodge, hit.dmg.amount, !!hit.dmg.isAttack],
    [null, u, 'true', true, false, 9999999, false],
    '无来源 true damage of 9999999, credited to the operator, not an attack',
  );
  h.invariants();
});

test('逻各斯: the aura does NOT fire above the threshold, and does not need an attack (不依赖攻击行为)', () => {
  // a speed-0 dummy with far more HP than 120 % of the operator's ATK never qualifies (and it is disarmed, so the only
  // possible damage would be the aura's)
  const tough = enemyRec({ key: 'enemy_dummy', hp: 100000, atk: 1, speed: 0 });
  const disarm = (b) => b.on('battleStart', () => { for (const u of b.allyUnits) b.addBuff(u, { key: 'test:disarm', flags: { disarm: true }, persist: true, allowDead: true }); }, { priority: 100 });
  const h = soloBattle({ hexes: ['hex_logos'], enemy: tough, enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }], timeLimit: 6, setup: disarm });
  h.run(5);
  assert.equal(h.enemies().length, 1, 'the enemy is alive');
  assert.equal(h.enemies()[0].hp, h.enemies()[0].s.maxHp, 'it took no execution damage');
  // and the aura runs while the operator is DISARMED — that IS 「不依赖攻击行为」 (no attack is ever made here)
  const d = soloBattle({ hexes: ['hex_logos'], enemies: [{ key: 'enemy_walker', time: 0, route: 0 }], timeLimit: 30, setup: disarm });
  assert.ok(d.runUntil(() => d.enemies().length === 0, 20), 'a disarmed operator still executes');
  assert.equal(d.b.allyUnits.reduce((s, x) => s + (x.stats ? x.stats.attacks : 0), 0), 0, 'and it never attacked');
  h.invariants();
  d.invariants();
});

test('逻各斯: an enemy that survived one try is never tried again (the official S1 殁亡 rule)', () => {
  // A 频次 unit (flags hitCount): every damage instance removes exactly 1 HP, so 9999999 cannot execute it. The operator
  // is disarmed, so the aura's single instance is the only damage the enemy ever takes.
  const h = soloBattle({
    hexes: ['hex_logos'], enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [9, 7] }], timeLimit: 20,
    enemy: enemyRec({ key: 'enemy_dummy', hp: 100000, atk: 1, speed: 0 }),
    setup: (b) => b.on('battleStart', () => { for (const u of b.allyUnits) b.addBuff(u, { key: 'test:disarm', flags: { disarm: true }, persist: true, allowDead: true }); }, { priority: 100 }),
  });
  h.run(0.5);
  const e = h.enemies()[0];
  h.b.addBuff(e, { key: 'test:hitcount', flags: { hitCount: true }, persist: true, allowDead: true });
  e.hp = 50; // far under the threshold; such a unit's maxHp IS its hit count
  h.run(1);
  const hp1 = e.hp;
  assert.ok(hp1 > 0 && hp1 < 50, `the frequency unit lost exactly 1 HP to the execution (got ${hp1})`);
  // it survived, so it is `spared`: a later tick must not touch it again
  h.run(5);
  assert.equal(e.alive, true, 'still standing');
  assert.equal(e.hp, hp1, 'never tried again after surviving');
  h.invariants();
});

test('你我一体 (oneBody): identical operators share ONE summed HP pool', () => {
  const h = soloBattle({
    hexes: ['hex_onebody'],
    units: [
      { uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 5 },
      { uid: 2, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 },
    ],
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }],
    timeLimit: 20,
  });
  h.run(0.5);
  const list = ops(h);
  assert.equal(list.length, 2, 'both copies deployed (premise)');
  const solo = 2000; // guard()'s maxHp
  for (const u of list) {
    assert.equal(u.s.maxHp, solo * 2, `uid ${u.uid}: max HP is the summed pool`);
    assert.equal(u.hp, solo * 2, `uid ${u.uid}: both hold the whole pool`);
  }
  // a lone operator (no duplicate) is untouched: the same card with one copy
  const lone = soloBattle({ hexes: ['hex_onebody'], timeLimit: 3 });
  lone.run(0.5);
  assert.equal(one(lone).s.maxHp, solo, 'a single copy gains nothing');
  h.invariants();
  lone.invariants();
});

test('你我一体: damage to one member is damage to the whole pool, and a lethal blow takes the group', () => {
  const h = soloBattle({
    hexes: ['hex_onebody'],
    units: [
      { uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 5 },
      { uid: 2, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 },
    ],
    enemies: [], timeLimit: 20,
  });
  h.run(0.5);
  const [a, b] = ops(h);
  const pool = a.s.maxHp;
  h.b.dealDamage(null, a, { amount: 1000, type: 'true', canDodge: false });
  assert.equal(a.hp, pool - 1000, 'the struck member lost 1000');
  assert.equal(b.hp, pool - 1000, 'the other member lost the same 1000 — one pool');
  // a 流失 is an HP loss too, so it shares as well
  h.b.loseHp(a, 500, { source: null });
  assert.equal(a.hp, pool - 1500, 'a 流失 shares');
  assert.equal(b.hp, pool - 1500, 'a 流失 shares');
  // a lethal blow on one member takes the whole group (they are one pool)
  h.b.dealDamage(null, a, { amount: pool * 2, type: 'true', canDodge: false });
  assert.equal(a.alive, false, 'the struck member is knocked out');
  assert.equal(b.alive, false, 'and so is the other — one pool at 0');
  h.invariants();
});

test('你我一体: healing one member heals the pool', () => {
  const h = soloBattle({
    hexes: ['hex_onebody'],
    units: [
      { uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 5 },
      { uid: 2, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 },
    ],
    enemies: [], timeLimit: 20,
  });
  h.run(0.5);
  const [a, b] = ops(h);
  const pool = a.s.maxHp;
  h.b.dealDamage(null, a, { amount: 1000, type: 'true', canDodge: false });
  assert.equal(b.hp, pool - 1000, 'premise: the pool moved');
  h.b.heal(null, a, 400);
  assert.equal(a.hp, pool - 600, 'the healed member went up');
  assert.equal(b.hp, pool - 600, 'and the pool followed');
  h.invariants();
});

test('你我一体: two members attacking the SAME enemy deal ×1.5; a lone attacker does not', () => {
  // Two RANGED copies of the same operator both cover the enemy's tile, and the enemy never moves (speed 0), so both of
  // them attack the SAME enemy — the precondition of the card's second half. The boost rides the DamageInfo's own `mul`,
  // which the pipeline applies AFTER the `hit` hook, so the DELIVERED amount is read off the `damaged` hook.
  const sniper = chessRec({
    id: 'test_sniper', profession: 'SNIPER', skill: null,
    stats: { maxHp: 2000, atk: 500, def: 200, res: 0, blockCnt: 1, respawnTime: 20 },
    rangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3]],
  });
  const still = enemyRec({ key: 'enemy_dummy', hp: 100000, atk: 1, def: 0, speed: 0 });
  const mk = (hexes, units) => makeBattle({
    defs: { chess: { test_sniper: sniper }, enemies: { enemy_dummy: still } },
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: hexes.map(refOf), units }],
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [9, 6] }],
    autoFinish: false, timeLimit: 25, hooks: ['damaged'], captureNoisy: true,
  });
  const allied = (h) => h.hooksOf('damaged').filter((c) => c.source && c.source.side === 'ally' && c.dmg && c.dmg.isAttack && c.target && c.target.side === 'enemy');
  const two = [{ uid: 1, kind: 'chess', chessId: 'test_sniper', row: 9, col: 4 }, { uid: 2, kind: 'chess', chessId: 'test_sniper', row: 9, col: 5 }];

  const plain = mk([], two);
  assert.ok(plain.runUntil(() => new Set(allied(plain).map((c) => c.source.uid)).size >= 2, 25), 'both attacked (premise)');
  const baseDmg = allied(plain).pop().amount;

  const h = mk(['hex_onebody'], two);
  assert.ok(h.runUntil(() => new Set(allied(h).map((c) => c.source.uid)).size >= 2, 25), 'both attacked (premise)');
  const boosted = allied(h).pop().amount;
  assert.ok(Math.abs(boosted - baseDmg * 1.5) < 1e-6, `×1.5 on a shared target (${baseDmg} → ${boosted})`);

  // a single copy never reaches two attackers, so it stays at ×1
  const lone = mk(['hex_onebody'], [two[0]]);
  assert.ok(lone.runUntil(() => allied(lone).length >= 2, 25), 'it attacked (premise)');
  assert.ok(Math.abs(allied(lone).pop().amount - baseDmg) < 1e-6, 'a lone copy is unboosted');
  h.invariants();
  plain.invariants();
  lone.invariants();
});

// =====================================================================================================================
// §29.33 (the owner's report of 2026-10-13): 回响 no longer splits a 器物 / 次数怪 — 木制瑞印 and its 13 siblings are
// hit-count OBJECTS, and the second generation (a death-spawned seal splitting again) multiplied the bodies without bound.

test('回响 (echo): a 器物 (木制瑞印 and its kind) is never split, while an ordinary enemy still is', () => {
  const h = enemyVerbBattle('ehex_echo', { timeLimit: 30, round: ECHO_CERTAIN_ROUND });
  h.run(0.5);
  const e = h.enemies()[0];
  // 木制瑞印 = `enemy_1196_msfyin` (kitTimes: 2 hits, 不可阻挡) — the 器物 at the end of 磨砻's DeadSpawn
  const seal = h.b.spawnEnemy('enemy_1196_msfyin', {
    pos: [e.y, e.x + 1],
    route: { motion: 'WALK', start: [Math.round(e.y), Math.round(e.x + 1)], end: [9, 2], checkpoints: [] },
    countInTotal: false, ownerPlayerId: e.ownerId,
  });
  assert.ok(seal, 'the 器物 spawned (premise)');
  assert.equal(isHitCount(seal), true, 'premise: it is a hit-count unit');
  h.b.kill(seal, h.allies()[0]);
  h.run(0.3);
  assert.equal(h.b.enemies.filter((k) => k.alive && k.defId === 'enemy_1196_msfyin').length, 0, 'no 器物 copy is ever created');
  h.invariants();
  // the gate is the 器物 marker, not "no splitting at all": an ordinary knock-out still splits into 2 (R9: chance 1)
  const h2 = enemyVerbBattle('ehex_echo', { timeLimit: 30, round: ECHO_CERTAIN_ROUND });
  h2.run(0.5);
  h2.b.kill(h2.enemies()[0], h2.allies()[0]);
  h2.run(0.2);
  assert.equal(h2.b.enemies.filter((k) => k.alive).length, 2, 'an ordinary knock-out still splits into 2');
  h2.invariants();
});

test('回响 (echo): 磨砻 still splits, and its 木制瑞印 children are the leaf of the chain (real data)', () => {
  const h = makeBattle({
    defs: { chess: { test_guard: guard() } },
    units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 5 }],
    enemies: [{ key: 'enemy_1195_sfyin', pos: [9, 7] }],
    autoFinish: false, timeLimit: 30, hooks: ['death'], round: ECHO_CERTAIN_ROUND,
    flags: { enemyHexIds: ['ehex_echo'] },
  });
  h.run(0.6);
  const parent = h.b.enemies.find((e) => e.defId === 'enemy_1195_sfyin');
  assert.ok(parent, '磨砻 is on the field (premise)');
  assert.equal(isHitCount(parent), false, 'premise: 磨砻 itself is no 器物 — its kit is a plain DeadSpawn');
  h.b.kill(parent, h.allies()[0]);
  h.run(0.3);
  const seals = () => h.b.enemies.filter((e) => e.alive && e.defId === 'enemy_1196_msfyin');
  assert.equal(seals().length, 2, 'the DeadSpawn still makes its 2 木制瑞印 — the first generation is the card’s own point');
  assert.equal(h.b.enemies.filter((e) => e.alive && e.defId === 'enemy_1195_sfyin').length, 2, 'and 磨砻 itself still split');
  h.b.kill(seals()[0], h.allies()[0]);
  h.run(0.3);
  assert.equal(seals().length, 1, 'a knocked-out 器物 leaves nothing behind — the chain ends here');
  h.invariants();
});

// =====================================================================================================================
// §29.32 (the owner's report of 2026-10-13): 腐蚀领域 hit the team's own traps, and a damaged trap then soaked the
// team's heals. Both halves are the two rules below; the third is 损伤加强's new per-second erosion burn.

/** A trap piece on the board (kind 'token', `defId` = the trap token sim/traps.js keys off). */
const trapUnit = (tokenId, row, col, uid = 2) => ({ uid, kind: 'token', tokenId, ownerUid: 1, row, col });

/** A range grid covering the whole flat stage (the heal selector is what is under test, not the range). */
const allTiles = Array.from({ length: 19 }, (_, dr) => Array.from({ length: 21 }, (_, dc) => [dr - 9, dc - 10])).flat();

test('腐蚀领域 (corrode): the zone is planted on 干员 and blasts 干员 only — a trap inside the radius is untouched', () => {
  // The card's own text is 「对范围内我方干员造成…真实伤害」, but both halves used `battle.allies()` /
  // `alliesInRadius`, which include every TOKEN: the zone could be planted under 多萝西's mine or 望's 棋子 and blow it
  // up. The trap here stands one tile from the operator, so the 1.5-radius blast circle does cover it.
  const players = [{
    playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [],
    units: [
      { uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 },
      trapUnit('token_10025_doroth_recttp', 10, 6),
    ],
  }];
  const h = enemyVerbBattle('ehex_corrodefield', { players });
  h.run(1);
  const op = h.allies().find((u) => u.kind === 'op');
  const trap = h.allies().find((u) => u.kind === 'token');
  assert.ok(op && trap, 'the operator and the trap are both on the field (premise)');
  h.run(7);
  // the blast is a SOURCELESS true-damage instance (hurt(battle, null, …)) — the decisive marker, whatever else the
  // enemy does to the field
  const blasts = h.hooksOf('damaged').filter((c) => c.source == null && c.dmg && c.dmg.type === 'true');
  assert.ok(blasts.some((c) => c.target === op), 'the operator took the blast');
  assert.equal(blasts.filter((c) => c.target === trap).length, 0, 'the trap took no blast at all');
  assert.equal(trap.hp, trap.s.maxHp, 'and it is at full HP');
  h.invariants();
});

test('陷阱 (mines / 棋子): a damaged one is never healed — not by a medic, not by 战地医院', () => {
  const medic = chessRec({
    id: 't_medic', profession: 'MEDIC', dmgType: 'heal', skill: null,
    stats: { maxHp: 1500, atk: 100, def: 100, res: 0, bat: 1, blockCnt: 0 },
    rangeGrid: allTiles,
  });
  const h = makeBattle({
    defs: { chess: { t_medic: medic, test_guard: guard() } },
    units: [
      { uid: 1, kind: 'chess', chessId: 't_medic', row: 12, col: 4 },
      { uid: 3, kind: 'chess', chessId: 'test_guard', row: 12, col: 3 },
      trapUnit('token_10025_doroth_recttp', 12, 5),
    ],
    enemies: [], autoFinish: false, timeLimit: 6,
    hooks: ['heal'], captureNoisy: true,
  });
  h.run(0.5);
  const trap = h.b.allyUnits.find((u) => u.kind === 'token');
  const op = h.b.allyUnits.find((u) => u.kind === 'op' && u.uid === 3);
  assert.ok(trap && op, 'the trap and the other operator are on the field (premise)');
  trap.hp = trap.s.maxHp * 0.5; trap.markDirty();
  op.hp = op.s.maxHp * 0.5; op.markDirty();
  h.run(3);
  const heals = h.hooksOf('heal');
  assert.equal(heals.filter((c) => c.target === trap).length, 0, 'no heal reached the trap');
  assert.ok(heals.some((c) => c.target === op), 'the medic healed the damaged operator instead');
  // the pipeline itself refuses one, so 战地医院's own `battle.heal` (or an aura) cannot reach a trap either
  assert.equal(h.b.heal(null, trap, 300), 0, 'heal() returns nothing for a trap');
  assert.equal(trap.hp, trap.s.maxHp * 0.5, 'the trap is still damaged');
  h.invariants();
});

test('损伤加强 (elemAmp): every second every enemy on the field takes 100 erosion gauge damage', () => {
  const h = soloBattle({
    hexes: ['hex_lossamp'],
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }, { key: 'enemy_dummy', time: 0, route: 0, pos: [11, 6] }],
    timeLimit: 30,
  });
  h.run(0.5);
  const es = h.enemies();
  assert.equal(es.length, 2, 'two enemies on the field (premise)');
  for (const e of es) assert.equal(e.elem.erosion, 0, 'nothing before the first tick');
  h.run(3);
  const gained = es.map((e) => e.elem.erosion);
  // 3 ticks × (100 × the card's own 1.5 gauge multiplier) — the two halves feed the same `elementIntake` path
  for (const g of gained) assert.ok(Math.abs(g - 450) < 1e-6, `three seconds of 100 × 1.5 (got ${g})`);
  h.invariants();
});

// =====================================================================================================================
// §29.34 (the owner's own list of 2026-10-13): 背水一战's battle half. The sim has no LP, so the match stamps whether
// the card's window is open into the ref (`onBattleStart.lastDitchArm`); the sim only reads that flag.

test('背水一战 (lastDitch): while the window is open every bond layer gain in battle is ×2', () => {
  const rec = HEXTECH.playerHexes.hex_lastditch;
  const pact = (active) => ({
    ...refOf('hex_lastditch'),
    params: { ...rec.effect, lastDitch: { ...rec.effect.lastDitch, active } },
  });
  const mk = (ref) => makeBattle({
    defs: { chess: { test_guard: guard() }, enemies: { enemy_dummy: dummy() } },
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0, playerEffects: [ref], bonds: { preciShip: { count: 3, active: true, tier: 2, layers: 0 } },
      units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
    }],
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }],
    autoFinish: false, timeLimit: 10,
  });
  const open = mk(pact(true));
  open.run(0.5);
  open.b.addLayers('p1', 'preciShip', 5);
  assert.equal(open.b.getPlayer('p1').bonds.preciShip.layers, 10, 'the open window doubles the gain');
  const closed = mk(pact(false));
  closed.run(0.5);
  closed.b.addLayers('p1', 'preciShip', 5);
  assert.equal(closed.b.getPlayer('p1').bonds.preciShip.layers, 5, 'a closed window leaves the gain alone');
  // an older saved ref (no `active` key at all) is closed too
  const legacy = mk({ ...refOf('hex_lastditch') });
  legacy.run(0.5);
  legacy.b.addLayers('p1', 'preciShip', 5);
  assert.equal(legacy.b.getPlayer('p1').bonds.preciShip.layers, 5, 'no flag ⇒ no doubling');
  open.invariants();
  closed.invariants();
  legacy.invariants();
});

