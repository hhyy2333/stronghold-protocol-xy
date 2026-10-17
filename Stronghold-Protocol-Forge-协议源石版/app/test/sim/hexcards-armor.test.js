// test/sim/hexcards-armor.test.js — 反击装甲 (hex_armor): the riposte of server/sim/content/hexcards/armor.js.
//
// The module is driven in isolation, exactly as ../hextech.js `installHexCards()` drives it: a real sim Battle from
// test/helpers/battleHarness.js, the production hook bundle `hexHooks(battle)`, and effect refs built the way
// server/match/hextech.js `addHexRef` writes them (see test/sim/hextech-battle.test.js). `content: 'generic'` keeps
// installContent from running content/hextech.js `install()`, so the card's own always-on `battle` passive
// (+18 % DEF / +10 RES, `hex:hex_armor`) cannot hide inside the numbers this suite measures — the LAST test runs the
// full `install(battle)` to prove the two halves coexist.
//
// Acceptance (task-2), one test each:
//   1. a riposte deals 100 % of the carrier's CURRENT DEF as TRUE damage, credited to the carrier and tagged;
//   2. several hits in the SAME tick each answer (no "one riposte per tick" throttle);
//   3. 无来源 damage is skipped (there is nobody to strike back at);
//   4. the riposte never answers a riposte: a counter / reflect / another carrier's riposte breaks the chain (no
//      hookDepth abort);
//   5. the amount follows the carrier's DEF at FIRE time (a DEF buff applied between two hits moves the second one).
// Plus the card's other boundaries: 元素损伤 and 流失 are not 受到伤害, another player's operator / a non-operator is not
// a carrier, the record's `defRatio` is read, and an absent card installs nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { hexHooks } from '../../server/sim/content/hexcards/hooks.js';
import { installArmor } from '../../server/sim/content/hexcards/armor.js';
import { install } from '../../server/sim/content/hextech.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HEXTECH = JSON.parse(readFileSync(path.join(ROOT, 'data', 'hextech.json'), 'utf8'));

/** The card id (the module's own lookup key). */
const CARD = 'hex_armor';
/** Tag every riposte instance carries (the module's `TAG`). */
const TAG = 'hex:armor';

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

/** A sturdy melee operator the riposte is measured on: 200 DEF, 2000 HP. */
const guard = (o = {}) => chessRec({ id: 'test_guard', stats: { maxHp: 2000, atk: 500, def: 200, res: 0, blockCnt: 1, respawnTime: 20 }, skill: null, ...o });
/** A tough, slow enemy that never reaches the operators: the battle stays quiet for the whole window. */
const dummy = () => enemyRec({ key: 'enemy_dummy', hp: 1000000, atk: 0, def: 0, speed: 0 });

/** A player input with the given effects and board units. */
const seat = (playerId, i, { effects = [], units = [] } = {}) => ({
  playerId, seat: i, side: 'L', colOffset: i === 0 ? 0 : 8, bonds: {}, playerEffects: effects, units,
});

/** A chess piece on the board (board coordinates; seat i > 0 lands +8 columns away on a 联防 field). */
const at = (uid, row, col) => ({ uid, kind: 'chess', chessId: 'test_guard', row, col });

/** A quiet harness battle over the given seats (no auto-finish; every `damaged` context is captured). */
function field(kind, players, { timeLimit = 30 } = {}) {
  return makeBattle({
    kind,
    content: 'generic',
    defs: { chess: { test_guard: guard() }, enemies: { enemy_dummy: dummy() } },
    players,
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }],
    autoFinish: false,
    timeLimit,
    captureNoisy: true,
    hooks: ['damaged'],
  });
}

/** Every ally operator on the field (deployed after `run(1)`). */
const ops = (h) => h.battle.allyUnits.filter((u) => u && u.kind === 'op' && u.side === 'ally');
/** The enemy of the field. */
const foeOf = (h) => h.battle.enemies[0];

/** Every captured `damaged` context whose instance is one of this module's ripostes. */
const ripostes = (h) => h.hooksOf('damaged').filter((c) => c && c.dmg && Array.isArray(c.dmg.tags) && c.dmg.tags.includes(TAG));

/** Drive the module exactly as ../hextech.js installHexCards does, then step once so the deployment runs. */
function run(h) {
  const inst = installArmor(hexHooks(h.battle));
  assert.equal(typeof inst, 'object', 'installArmor returns the live tally handle');
  assert.equal(inst.fired, 0, 'nothing has fired at install time');
  assert.equal(Number(inst), 0, 'and the numeric coercion reads the same tally');
  h.run(1);
  return inst;
}

/**
 * One hit on the carrier from the enemy, `true` type by default so the incoming number is exact (a `phys` amount is
 * mitigated by the carrier's own 200 DEF — measured on its own below). canDodge false: the dodge roll never muddies it.
 */
const hit = (h, target, amount = 300, over = {}) => h.battle.dealDamage(foeOf(h), target, { amount, type: 'true', canDodge: false, ...over });

// =====================================================================================================================
// 1. the riposte itself

test('反击装甲: a hit on the carrier deals 100 % of its CURRENT DEF back as TRUE damage, tagged and credited', () => {
  const h = field('normal', [seat('p1', 0, { effects: [refOf(CARD)], units: [at(1, 9, 6)] })]);
  const inst = run(h);
  const u = ops(h)[0];
  const foe = foeOf(h);
  assert.equal(u.s.def, 200, 'premise: the bare operator has 200 DEF (the static passive is NOT part of this module)');
  const hp0 = foe.hp;

  const dealt = hit(h, u);
  assert.equal(dealt, 300, 'the incoming hit landed on the carrier in full (premise)');
  assert.equal(u.hp, 2000 - 300, 'the carrier lost the incoming 300');
  assert.equal(hp0 - foe.hp, 200, 'the enemy lost exactly the riposte: 100 % of 200 DEF');
  assert.equal(inst.fired, 1, 'one riposte');

  const r = ripostes(h);
  assert.equal(r.length, 1, 'one riposte instance reached the `damaged` hook');
  assert.equal(r[0].dmg.type, 'true', 'it is 真伤 — never cut a second time by the attacker’s DEF');
  assert.equal(r[0].amount, 200, 'the amount equals the carrier’s DEF');
  assert.equal(r[0].source, u, 'the OPERATOR is the source (the knock-out credit and the stats land on it)');
  assert.equal(r[0].target, foe, 'the attacker is the target');
  assert.ok(r[0].dmg.isSkill, 'built as a skill instance, like the module contract says');
  h.invariants();
});

test('反击装甲: no card on the field installs no handler and answers nothing', () => {
  const h = field('normal', [seat('p1', 0, { effects: [], units: [at(1, 9, 6)] })]);
  const inst = run(h);
  const foe = foeOf(h);
  const hp0 = foe.hp;
  hit(h, ops(h)[0]);
  assert.equal(foe.hp, hp0, 'the enemy never moved — nothing came back');
  assert.equal(inst.fired, 0);
  assert.equal(ripostes(h).length, 0);
  h.invariants();
});

// =====================================================================================================================
// 2. several hits in the SAME tick

test('反击装甲: several hits in the same tick each answer — the riposte is not throttled per tick', () => {
  const h = field('normal', [seat('p1', 0, { effects: [refOf(CARD)], units: [at(1, 9, 6)] })]);
  const inst = run(h);
  const u = ops(h)[0];
  const foe = foeOf(h);
  const hp0 = foe.hp;

  // three hits with NO step in between: all three resolve inside one battle tick
  const t0 = h.battle.time;
  hit(h, u, 100);
  hit(h, u, 100);
  hit(h, u, 100);
  assert.equal(h.battle.time, t0, 'premise: the tick never advanced between the three hits');
  assert.equal(inst.fired, 3, 'three hits → three ripostes');
  assert.equal(hp0 - foe.hp, 3 * 200, 'each of the three answered with its own 200 DEF riposte');
  assert.equal(2000 - u.hp, 300, 'and the carrier took the three incoming 100s');
  assert.equal(ripostes(h).length, 3, 'three instances reached the hook, all in that one tick');
  h.invariants();
});

// =====================================================================================================================
// 3. 无来源 / 元素损伤 / 流失 skip

test('反击装甲: 无来源 damage is skipped — there is nobody to strike back at', () => {
  const h = field('normal', [seat('p1', 0, { effects: [refOf(CARD)], units: [at(1, 9, 6)] })]);
  const inst = run(h);
  const u = ops(h)[0];
  const foe = foeOf(h);
  const hp0 = foe.hp;

  // a sourceless zone tick / element-burst blow: `source: null`, `credit` names the filler (NOT the attacker)
  h.battle.dealDamage(null, u, { amount: 500, type: 'true', sourceless: true, canDodge: false, tags: ['dot'] });
  assert.equal(u.hp, 2000 - 500, 'the sourceless damage landed on the carrier (premise)');
  assert.equal(foe.hp, hp0, 'nobody was struck back at');
  assert.equal(inst.fired, 0);
  assert.equal(ripostes(h).length, 0);
  h.invariants();
});

test('反击装甲: 元素损伤 (type element) is not a 受到伤害 — the gauge fills, nothing comes back', () => {
  const h = field('normal', [seat('p1', 0, { effects: [refOf(CARD)], units: [at(1, 9, 6)] })]);
  const inst = run(h);
  const u = ops(h)[0];
  const foe = foeOf(h);
  const hp0 = foe.hp;

  h.battle.dealDamage(foe, u, { amount: 400, type: 'element', element: 'burn', canDodge: false });
  assert.ok(u.elem.burn > 0, 'the element gauge filled (premise)');
  assert.equal(u.hp, 2000, 'no HP was lost');
  assert.equal(foe.hp, hp0, 'no riposte answered the element damage');
  assert.equal(inst.fired, 0);
  h.invariants();
});

test('反击装甲: 流失 (hpLoss) never fires a riposte — "生命流失…不会触发反伤"', () => {
  const h = field('normal', [seat('p1', 0, { effects: [refOf(CARD)], units: [at(1, 9, 6)] })]);
  const inst = run(h);
  const u = ops(h)[0];
  const foe = foeOf(h);
  const hp0 = foe.hp;

  const lost = h.battle.loseHp(u, 250, { source: foe });
  assert.equal(lost, 250, 'the 流失 removed HP (premise)');
  assert.equal(foe.hp, hp0, 'no riposte');
  assert.equal(inst.fired, 0);
  assert.equal(ripostes(h).length, 0);
  h.invariants();
});

// =====================================================================================================================
// 4. recursion — the riposte must never answer itself (and no counter/reflect may start a chain)

test('反击装甲: a counter / reflect instance never starts a chain (isRetaliation bail-out)', () => {
  const h = field('normal', [seat('p1', 0, { effects: [refOf(CARD)], units: [at(1, 9, 6)] })]);
  const inst = run(h);
  const u = ops(h)[0];
  const foe = foeOf(h);
  const hp0 = foe.hp;

  // the tags server/sim/damage.js RETALIATION_TAGS knows, plus 坚守's marker flags
  h.battle.dealDamage(foe, u, { amount: 300, type: 'phys', canDodge: false, tags: ['counter'] });
  h.battle.dealDamage(foe, u, { amount: 300, type: 'arts', canDodge: false, tags: ['reflect'] });
  h.battle.dealDamage(foe, u, { amount: 300, type: 'true', canDodge: false, tags: ['springCounter'] });
  const thorn = h.battle.makeDamage({ amount: 300, type: 'arts', canDodge: false });
  thorn.steadThorn = true;
  h.battle.dealDamage(foe, u, thorn);
  assert.equal(inst.fired, 0, 'an answer to being hit is not a 受到伤害 that answers back');
  assert.equal(foe.hp, hp0);
  h.invariants();
});

test('反击装甲: two carriers do not ping-pong — the riposte is flagged and answered with nothing', () => {
  // both players own the card, so the riposte lands on ANOTHER carrier: without the `hexRiposte` flag this pair would
  // answer each other until the engine's 32-deep hook cap silently ate the tick (§29.10)
  const h = field('unite', [
    seat('p1', 0, { effects: [refOf(CARD)], units: [at(1, 9, 6)] }),
    seat('p2', 1, { effects: [refOf(CARD)], units: [at(2, 10, 6)] }),
  ]);
  const inst = run(h);
  const [a, b] = ops(h);
  assert.equal(a.ownerId, 'p1');
  assert.equal(b.ownerId, 'p2');
  const hpA0 = a.hp;
  const hpB0 = b.hp;

  // p2's operator swings at p1's — a friendly hit, but the hooks do not care about the side here
  h.battle.dealDamage(b, a, { amount: 200, type: 'true', canDodge: false, tags: ['test'] });
  assert.equal(hpA0 - a.hp, 200, 'the swing landed on A (premise)');
  assert.equal(hpB0 - b.hp, a.s.def, 'A answered with exactly one riposte of its own DEF');
  assert.equal(inst.fired, 1, 'exactly ONE riposte — B did not answer the answer');
  assert.equal(ripostes(h).length, 1);

  const depth = h.battle.errors.filter((e) => String(e.label).includes('hookDepth'));
  assert.deepEqual(depth, [], 'no hook-depth abort: the chain ended on the flag, not on the engine cap');
  h.invariants();
});

test('反击装甲: an instance carrying our own tag is skipped even without the flag', () => {
  const h = field('normal', [seat('p1', 0, { effects: [refOf(CARD)], units: [at(1, 9, 6)] })]);
  const inst = run(h);
  const u = ops(h)[0];
  const foe = foeOf(h);
  const hp0 = foe.hp;

  // the tag alone (a copy another content re-created without the flag) must not start a chain
  h.battle.dealDamage(foe, u, { amount: 300, type: 'true', canDodge: false, tags: [TAG] });
  assert.equal(inst.fired, 0);
  assert.equal(foe.hp, hp0);
  h.invariants();
});

// =====================================================================================================================
// 5. the amount follows the carrier's DEF at FIRE time

test('反击装甲: the riposte re-reads DEF at fire time — a DEF buff between two hits moves the second amount', () => {
  const h = field('normal', [seat('p1', 0, { effects: [refOf(CARD)], units: [at(1, 9, 6)] })]);
  const inst = run(h);
  const u = ops(h)[0];
  const foe = foeOf(h);

  const hp0 = foe.hp;
  hit(h, u, 100);
  assert.equal(hp0 - foe.hp, 200, 'first riposte = the carrier’s 200 DEF');

  // +100 flat DEF lands between the two hits; `s` is lazily recomputed on the next read
  h.battle.addBuff(u, { key: 'test:def', mods: { defFlat: 100 } });
  assert.equal(u.s.def, 300, 'premise: the DEF buff took');

  const hp1 = foe.hp;
  hit(h, u, 100);
  assert.equal(hp1 - foe.hp, 300, 'second riposte = the NEW 300 DEF');
  assert.equal(inst.fired, 2);
  const amounts = ripostes(h).map((c) => c.amount);
  assert.deepEqual(amounts, [200, 300], 'the two instances read DEF at their own fire time');
  h.invariants();
});

// =====================================================================================================================
// 6. carriers only — own ally OPERATORS

test('反击装甲: only an owned OPERATOR is a carrier — another player’s operator answers nothing', () => {
  const h = field('unite', [
    seat('p1', 0, { effects: [refOf(CARD)], units: [at(1, 9, 6)] }),
    seat('p2', 1, { effects: [], units: [at(2, 10, 6)] }),
  ]);
  const inst = run(h);
  const mine = ops(h).find((u) => u.ownerId === 'p1');
  const theirs = ops(h).find((u) => u.ownerId === 'p2');
  const foe = foeOf(h);

  const hp0 = foe.hp;
  hit(h, theirs, 300);
  assert.equal(foe.hp, hp0, 'the card belongs to p1 — p2’s operator is not a carrier');
  assert.equal(inst.fired, 0);

  hit(h, mine, 300);
  assert.equal(inst.fired, 1, 'the owner’s own operator still answers');
  assert.equal(ripostes(h).length, 1);
  h.invariants();
});

test('反击装甲: damage TO an enemy (or any non-operator) is not a 受到伤害 of a carrier', () => {
  const h = field('normal', [seat('p1', 0, { effects: [refOf(CARD)], units: [at(1, 9, 6)] })]);
  const inst = run(h);
  const u = ops(h)[0];
  const foe = foeOf(h);

  const foeHp0 = foe.hp;
  const dealt = h.battle.dealDamage(u, foe, { amount: 300, type: 'phys', canDodge: false });
  assert.equal(dealt, 300, 'the operator’s own hit landed (premise)');
  assert.equal(foeHp0 - foe.hp, 300, 'only the operator’s hit — the enemy is no carrier');
  assert.equal(inst.fired, 0);
  h.invariants();
});

test('反击装甲: a knocked-out carrier fires nothing', () => {
  const h = field('normal', [seat('p1', 0, { effects: [refOf(CARD)], units: [at(1, 9, 6)] })]);
  const inst = run(h);
  const u = ops(h)[0];
  const foe = foeOf(h);

  // alive: the riposte fires (premise)
  const live0 = foe.hp;
  h.battle.dealDamage(foe, u, { amount: 100, type: 'true', canDodge: false });
  assert.equal(live0 - foe.hp, 200, 'the live carrier answers');
  assert.equal(inst.fired, 1);

  // knocked out: `damaged` only ever reaches a live unit, but the rule is guarded anyway
  u.alive = false;
  const dead0 = foe.hp;
  h.battle.emit('damaged', { source: foe, target: u, amount: 100, type: 'true', dmg: h.battle.makeDamage({ amount: 100, type: 'true', canDodge: false }) });
  assert.equal(foe.hp, dead0, 'a knocked-out carrier answers nothing');
  assert.equal(inst.fired, 1, 'still the one riposte from the live carrier');

  // and an undeployed / hidden carrier is guarded the same way
  u.alive = true;
  u.deployed = false;
  h.battle.emit('damaged', { source: foe, target: u, amount: 100, type: 'true', dmg: h.battle.makeDamage({ amount: 100, type: 'true', canDodge: false }) });
  assert.equal(foe.hp, dead0, 'an undeployed carrier answers nothing');
  assert.equal(inst.fired, 1);
  u.deployed = true;
  h.invariants();
});

// =====================================================================================================================
// 7. the record's own numbers

test('反击装甲: the record’s defRatio is read (50 → half the DEF), with 100 as the fallback', () => {
  const custom = refOf(CARD, { battle: { defPct: 18, resFlat: 10 }, armor: { defRatio: 50 } });
  const h = field('normal', [seat('p1', 0, { effects: [custom], units: [at(1, 9, 6)] })]);
  const inst = run(h);
  const u = ops(h)[0];
  const foe = foeOf(h);
  const hp0 = foe.hp;

  hit(h, u, 100);
  assert.equal(hp0 - foe.hp, 100, '50 % of 200 DEF = 100');
  assert.equal(inst.fired, 1);
  h.invariants();
});

// =====================================================================================================================
// 8. the production wiring: the static passive AND the script, through install()

test('反击装甲 (hextech install): the +18 % DEF / +10 RES passive and the riposte coexist on one operator', () => {
  // `install(battle)` is the production dispatch: it applies `battle: { defPct: 18, resFlat: 10 }` as the ref-keyed
  // passive `hex:hex_armor` AND calls installHexCards() → installArmor. The riposte must read the BUFFED DEF (236),
  // which is exactly why the module re-reads `u.s.def` at fire time.
  const h = makeBattle({
    kind: 'normal',
    content: 'generic',
    defs: { chess: { test_guard: guard() }, enemies: { enemy_dummy: dummy() } },
    players: [seat('p1', 0, { effects: [refOf(CARD)], units: [at(1, 9, 6)] })],
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }],
    autoFinish: false,
    timeLimit: 30,
    captureNoisy: true,
    hooks: ['damaged'],
    extraContent: [{ install: (b) => install(b) }],
  });
  h.run(1);
  const u = ops(h)[0];
  const foe = foeOf(h);
  assert.ok(Math.abs(u.s.def - 200 * 1.18) < 1e-9, `+18 % DEF: 200 → 236 (got ${u.s.def})`);
  assert.equal(u.s.res, 10, '+10 RES');
  assert.equal((u.buffs || []).filter((b) => b.key === 'hex:hex_armor').length, 1, 'the static passive is on the operator');

  const hp0 = foe.hp;
  h.battle.dealDamage(foe, u, { amount: 100, type: 'phys', canDodge: false });
  assert.equal(hp0 - foe.hp, 236, 'the riposte uses the buffed 236 DEF, not the base 200');
  const r = ripostes(h);
  assert.equal(r.length, 1);
  assert.equal(r[0].amount, 236);
  h.invariants();
});
