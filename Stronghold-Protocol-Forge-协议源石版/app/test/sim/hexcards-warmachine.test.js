// test/sim/hexcards-warmachine.test.js — 战争机器 (hex_warmachine): the 联防 team aura of
// server/sim/content/hexcards/warmachine.js.
//
// The module is driven in isolation: the harness battle is a real sim Battle, the hook bundle is the production
// `hexHooks(battle)` (the same object ../hextech.js install() builds), and the effect refs are built exactly as
// server/match/hextech.js addHexRef writes them (see test/sim/hextech-battle.test.js). That isolates the aura from the
// card's always-on `battle: { atkPct: 16 }` passive, which install() applies as `hex:hex_warmachine` on the owner's OWN
// operators only — the whole point of this suite is that the two coexist and that the aura is 联防-only.
//
// Acceptance (task-4):
//   1. a NORMAL field (and a boss / hidden one) sees nothing — the aura key is absent everywhere;
//   2. a 联防 field buffs EVERY ally operator on it, including a teammate's whose owner does not own the card;
//   3. two owners of the card do not stack: one buff entry per unit, one set of values;
//   4. the three values are right and the card's own +16 % passive survives beside the aura (two keys, not a replace).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { hexHooks } from '../../server/sim/content/hexcards/hooks.js';
import { installWarmachine } from '../../server/sim/content/hexcards/warmachine.js';
import { install } from '../../server/sim/content/hextech.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HEXTECH = JSON.parse(readFileSync(path.join(ROOT, 'data', 'hextech.json'), 'utf8'));

/** The card id / script key / buff key of the module under test. */
const CARD = 'hex_warmachine';
const AURA = 'hex:warmachine:unite';
/** The card's own always-on battle passive, as ../hextech.js install() applies it (key = the ref id). */
const PASSIVE = 'hex:hex_warmachine';

/** One playerEffects entry, the shape server/match/hextech.js addHexRef writes. `effect` overrides the record's. */
function refOf(hexId, effect = null) {
  const rec = HEXTECH.playerHexes[hexId];
  assert.ok(rec, `data/hextech.json has no ${hexId}`);
  return {
    id: `hex:${hexId}`, key: `hex:${hexId}`, name: rec.name, desc: rec.desc, iconKind: 'hex', iconId: rec.icon,
    counter: null, battle: true, params: { ...(effect || rec.effect), hexId, rarity: rec.rarity },
    data: { hexId, rarity: rec.rarity },
  };
}

/** A sturdy melee operator every passives assertion can be measured on. */
const guard = (o = {}) => chessRec({ id: 'test_guard', stats: { maxHp: 2000, atk: 500, def: 200, res: 0, blockCnt: 1, respawnTime: 20 }, skill: null, ...o });
/** A slow enemy that never reaches the operators: the battle stays quiet for 30 s. */
const dummy = () => enemyRec({ key: 'enemy_dummy', hp: 100000, atk: 0, speed: 0 });

/** One player input with the given effects and board units. */
const seat = (playerId, i, { effects = [], units = [] } = {}) => ({
  playerId, seat: i, side: 'L', colOffset: i === 0 ? 0 : 8, bonds: {}, playerEffects: effects, units,
});

/** A chess piece on the board (row/col are board coordinates; seat 1 lands +8 columns away on a 联防 field). */
const at = (uid, row, col) => ({ uid, kind: 'chess', chessId: 'test_guard', row, col });

/**
 * A real harness battle over the given seats, with a quiet enemy and no auto-finish.
 *
 * `content: 'generic'` is essential: the harness default 'full' runs `installContent` → `content/hextech.js install()`,
 * which would apply the card's own `battle: { atkPct: 16 }` passive before the test can look at the aura alone. With
 * 'generic' the board is bare, the test drives `installWarmachine` itself, and ONE test below runs the full
 * `install(battle)` to prove the two halves coexist.
 */
function field(kind, players, { round = 1, timeLimit = 30 } = {}) {
  return makeBattle({
    kind,
    round,
    content: 'generic',
    defs: { chess: { test_guard: guard() }, enemies: { enemy_dummy: dummy() } },
    players,
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }],
    autoFinish: false,
    timeLimit,
  });
}

/** Every ally operator on the field (deployed or not). */
const ops = (h) => h.battle.allyUnits.filter((u) => u && u.kind === 'op' && u.side === 'ally');
/** The buffs of a unit with a given key. */
const buffsOf = (u, key) => (u.buffs || []).filter((b) => b.key === key);

/**
 * An `extraContent` module that runs `fn` at the level of `installHexCards` (the production dispatch inside
 * content/hextech.js install()). The harness installs it in the constructor, after the domain modules but BEFORE
 * `opts.setup` and before any step — the same point in the lifecycle, so its `battleStart` handler fires in order.
 */
const installAtContent = (fn) => ({ install: fn });

/** Drive the module exactly as ../hextech.js installHexCards does, then step once so the deployment + battleStart run. */
function run(h) {
  const n = installWarmachine(hexHooks(h.battle));
  h.run(1);
  return n;
}

// =====================================================================================================================
// 1. 联防 only

test('战争机器: a NORMAL field sees no aura at all (and the module reports 0)', () => {
  const h = field('normal', [seat('p1', 0, { effects: [refOf(CARD)], units: [at(1, 9, 6)] })]);
  const n = run(h);
  assert.equal(n, 0, 'not a 联防 field → nothing to cover');
  for (const u of ops(h)) assert.equal(buffsOf(u, AURA).length, 0, `${u.ownerId}: no 联防 aura on a normal field`);
  h.invariants();
});

test('战争机器: boss and hidden fields do not get the aura either', () => {
  for (const kind of ['boss', 'hidden']) {
    const b = field(kind, [
      seat('p1', 0, { effects: [refOf(CARD)], units: [at(1, 9, 6)] }),
      seat('p2', 1, { effects: [], units: [at(2, 10, 6)] }),
    ]);
    const n = installWarmachine(hexHooks(b.battle));
    b.run(1);
    assert.equal(n, 0, `${kind}: no aura`);
    for (const u of ops(b)) assert.equal(buffsOf(u, AURA).length, 0, `${kind}/${u.ownerId}: no aura`);
    b.invariants();
  }
});

test('战争机器: a 联防 field with no card anywhere installs nothing', () => {
  const h = field('unite', [
    seat('p1', 0, { effects: [], units: [at(1, 9, 6)] }),
    seat('p2', 1, { effects: [], units: [at(2, 10, 6)] }),
  ]);
  const n = run(h);
  assert.equal(n, 0, 'absent card → 0');
  for (const u of ops(h)) assert.equal(buffsOf(u, AURA).length, 0);
  h.invariants();
});

// =====================================================================================================================
// 2. the whole 联防 field, teammates included

test('战争机器: on a 联防 field the aura reaches every operator — including the teammate with no card', () => {
  const h = field('unite', [
    seat('p1', 0, { effects: [refOf(CARD)], units: [at(1, 9, 6)] }),
    seat('p2', 1, { effects: [], units: [at(2, 10, 6)] }),
  ]);
  const n = run(h);
  const units = ops(h);
  assert.equal(units.length, 2, 'premise: both seats fielded an operator');
  assert.equal(n, 2, 'the aura covers both operators');
  for (const u of units) {
    const st = buffsOf(u, AURA);
    assert.equal(st.length, 1, `${u.ownerId}: one aura entry per operator (the owner ${u.ownerId === 'p1' ? 'has' : 'has NOT'} the card)`);
    assert.ok(u.s.atk > 0 && u.s.def > 0 && u.s.maxHp > 0, 'the stats resolved');
  }
  // the carrier and the card-less teammate carry the exact same aura values
  const [a, c] = units.slice().sort((x, y) => (x.ownerId < y.ownerId ? -1 : 1));
  assert.deepEqual(a.buffs.find((b) => b.key === AURA).mods, c.buffs.find((b) => b.key === AURA).mods);
  h.invariants();
});

test('战争机器: the aura is a PERCENTAGE of max HP — the stats move by +30% atk / +30% def / +30% maxHp', () => {
  const h = field('unite', [seat('p1', 0, { effects: [refOf(CARD)], units: [at(1, 9, 6)] })]);
  run(h);
  const u = ops(h)[0];
  // baseline: the same board without the card (same content mode, no extra module installed)
  const base = field('unite', [seat('p1', 0, { effects: [], units: [at(1, 9, 6)] })]);
  base.run(1);
  const bu = ops(base)[0];
  assert.ok(h.battle.time > 0, 'the battle started (battleStart fired)');
  assert.ok(Math.abs(u.s.atk - bu.s.atk * 1.3) < 1e-6, `atk ${u.s.atk} vs ${bu.s.atk} (+30%)`);
  assert.ok(Math.abs(u.s.def - bu.s.def * 1.3) < 1e-6, `def ${u.s.def} vs ${bu.s.def} (+30%)`);
  assert.ok(Math.abs(u.s.maxHp - bu.s.maxHp * 1.3) < 1e-6, `maxHp ${u.s.maxHp} vs ${bu.s.maxHp} (+30% — a percentage, not a flat 30)`);
  assert.ok(Math.abs(u.s.maxHp - (bu.s.maxHp + 30)) > 1, `but not the flat +30 HP reading (${u.s.maxHp} vs ${bu.s.maxHp + 30})`);
  h.invariants();
  base.invariants();
});

test('战争机器: no op on the field → the module still reports 0 (and never throws)', () => {
  const h = field('unite', [seat('p1', 0, { effects: [refOf(CARD)], units: [] })]);
  const n = run(h);
  assert.equal(n, 0, 'an empty board has nothing to cover');
  h.invariants();
});

// =====================================================================================================================
// 3. several owners do not stack

test('战争机器: two owners of the card do not stack — one entry per operator, one value', () => {
  const h = field('unite', [
    seat('p1', 0, { effects: [refOf(CARD)], units: [at(1, 9, 6)] }),
    seat('p2', 1, { effects: [refOf(CARD)], units: [at(2, 10, 6)] }),
  ]);
  const n = run(h);
  assert.equal(n, 2, 'two operators covered');
  for (const u of ops(h)) {
    const st = buffsOf(u, AURA);
    assert.equal(st.length, 1, `${u.ownerId}: exactly one aura entry although two players own the card`);
    assert.ok(Math.abs(st[0].mods.atkPct - 0.30) < 1e-9, 'still +30 %, not +60 %');
  }
  // and the values equal the single-owner field: the aura is not doubled
  const one = field('unite', [seat('p1', 0, { effects: [refOf(CARD)], units: [at(1, 9, 6)] })]);
  run(one);
  const two = ops(h).find((u) => u.ownerId === 'p1');
  const single = ops(one).find((u) => u.ownerId === 'p1');
  assert.ok(Math.abs(two.s.atk - single.s.atk) < 1e-6, `two owners give the same ATK as one (${two.s.atk} vs ${single.s.atk})`);
  h.invariants();
  one.invariants();
});

test('战争机器: a second owner carrying DIFFERENT numbers cannot re-value the aura (first owner wins, one entry)', () => {
  // hand-written params: the second seat would ask for +80 % — the aura is read from the first owner only
  const h = field('unite', [
    seat('p1', 0, { effects: [refOf(CARD)], units: [at(1, 9, 6)] }),
    seat('p2', 1, { effects: [refOf(CARD, { team: true, warmachine: { atkPct: 80, defPct: 80, hpPct: 80 } })], units: [at(2, 10, 6)] }),
  ]);
  run(h);
  for (const u of ops(h)) {
    const st = buffsOf(u, AURA);
    assert.equal(st.length, 1);
    assert.ok(Math.abs(st[0].mods.atkPct - 0.30) < 1e-9, `${u.ownerId}: the first owner's +30 %, not the second's +80 %`);
  }
  h.invariants();
});

// =====================================================================================================================
// 4. the three values + coexistence with the card's own +16 % passive

test('战争机器: the values are read from the card spec — the three buckets all arrive (atkPct / defPct / hpPct)', () => {
  const h = field('unite', [seat('p1', 0, { effects: [refOf(CARD)], units: [at(1, 9, 6)] })]);
  run(h);
  const st = buffsOf(ops(h)[0], AURA);
  assert.equal(st.length, 1);
  assert.deepEqual(
    { atkPct: st[0].mods.atkPct, defPct: st[0].mods.defPct, hpPct: st[0].mods.hpPct },
    { atkPct: 0.3, defPct: 0.3, hpPct: 0.3 },
    'the record carries 30/30/30 percentage points → three 0.3 ratio mods',
  );
  h.invariants();
});

test('战争机器: a spec value overrides the default and the other two keep their 30 % fallbacks', () => {
  const h = field('unite', [seat('p1', 0, { effects: [refOf(CARD, { team: true, warmachine: { atkPct: 45 } })], units: [at(1, 9, 6)] })]);
  run(h);
  const m = buffsOf(ops(h)[0], AURA)[0].mods;
  assert.equal(m.atkPct, 0.45, 'atkPct read from the spec');
  assert.equal(m.defPct, 0.3, 'defPct falls back to 30');
  assert.equal(m.hpPct, 0.3, 'hpPct falls back to 30');
  h.invariants();
});

test('战争机器: the aura key differs from the card\'s own +16 % passive — the two coexist on the carrier', () => {
  // the full production path: install() applies `battle: { atkPct: 16 }` as `hex:hex_warmachine` on the owner's ops,
  // installHexCards() runs this module. A shared key would let `refresh: 'replace'` eat one of the two halves.
  const mk = (withCard) => {
    const players = [seat('p1', 0, { effects: withCard ? [refOf(CARD)] : [], units: [at(1, 9, 6)] })];
    return makeBattle({
      kind: 'unite',
      content: 'generic',
      defs: { chess: { test_guard: guard() }, enemies: { enemy_dummy: dummy() } },
      players,
      enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }],
      autoFinish: false,
      timeLimit: 30,
      // the production install order: content/hextech.js install() (static passives + installHexCards) at construction
      extraContent: [installAtContent((b) => install(b))],
    });
  };
  const h = mk(true);
  const plain = mk(false);
  h.run(1);
  plain.run(1);
  const u = ops(h)[0];
  const own = buffsOf(u, PASSIVE);
  const aura = buffsOf(u, AURA);
  assert.equal(own.length, 1, 'the card\'s own battle passive is installed as hex:hex_warmachine');
  assert.equal(aura.length, 1, 'the 联防 aura is installed as hex:warmachine:unite');
  assert.ok(Math.abs(own[0].mods.atkPct - 0.16) < 1e-9, 'the card\'s own +16 % is intact');
  assert.ok(Math.abs(aura[0].mods.atkPct - 0.30) < 1e-9, 'the aura\'s +30 % is intact');
  // 直接乘算 stack ADDITIVELY: 1 + 0.16 + 0.30 = 1.46 of the base ATK
  const bu = ops(plain)[0];
  assert.ok(Math.abs(u.s.atk - bu.s.atk * 1.46) < 1e-6, `${u.s.atk} vs base ${bu.s.atk} (×1.46)`);
  assert.ok(Math.abs(u.s.def - bu.s.def * 1.3) < 1e-6, 'the aura also raised DEF');
  assert.ok(Math.abs(u.s.maxHp - bu.s.maxHp * 1.3) < 1e-6, 'the aura also raised max HP');
  h.invariants();
  plain.invariants();
});

test('战争机器: the teammate without the card gets the aura but NOT the card\'s own +16 % passive', () => {
  const h = makeBattle({
    kind: 'unite',
    content: 'generic',
    defs: { chess: { test_guard: guard() }, enemies: { enemy_dummy: dummy() } },
    players: [
      seat('p1', 0, { effects: [refOf(CARD)], units: [at(1, 9, 6)] }),
      seat('p2', 1, { effects: [], units: [at(2, 10, 6)] }),
    ],
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }],
    autoFinish: false,
    timeLimit: 30,
    extraContent: [installAtContent((b) => install(b))],
  });
  h.run(1);
  const mate = ops(h).find((u) => u.ownerId === 'p2');
  assert.equal(buffsOf(mate, AURA).length, 1, 'the teammate is covered by the 联防 aura');
  assert.equal(buffsOf(mate, PASSIVE).length, 0, 'but it does not carry the card\'s owner-only +16 % passive');
  const carrier = ops(h).find((u) => u.ownerId === 'p1');
  assert.equal(buffsOf(carrier, PASSIVE).length, 1, 'the carrier keeps its own +16 % passive too');
  h.invariants();
});

test('战争机器: installation is idempotent — running the module twice keeps one aura entry per unit', () => {
  const h = field('unite', [seat('p1', 0, { effects: [refOf(CARD)], units: [at(1, 9, 6)] })]);
  const hk = hexHooks(h.battle);
  assert.equal(installWarmachine(hk), 1);
  assert.equal(installWarmachine(hk), 1, 'a second install re-registers the battleStart grant without changing the count');
  h.run(1);
  const u = ops(h)[0];
  assert.equal(buffsOf(u, AURA).length, 1, 'still one entry (same key, refresh replace)');
  assert.ok(Math.abs(u.s.atk - 500 * 1.3) < 1e-6, `+30 % of the 500 base ATK (got ${u.s.atk})`);
  h.invariants();
});
