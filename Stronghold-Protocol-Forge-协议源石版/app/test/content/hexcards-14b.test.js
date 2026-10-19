// test/content/hexcards-14b.test.js — the five battle scripts of server/sim/content/hexcards/batch14b.js, driven in
// isolation exactly as server/sim/content/hextech.js installHexCards() drives them: a real sim Battle from
// test/helpers/battleHarness.js, the production hook bundle hexHooks(battle), and effect refs shaped like
// server/match/hextech.js addHexRef writes them. `content: 'generic'` keeps installContent from running
// content/hextech.js install(), so no card's own always-on passive can hide inside the numbers measured here.
//
// Every card is covered three ways at least: the mechanic itself, the ownership boundary (a field where another player
// owns the card never grants it), and recursion (a damage-dealing script must not answer its own output / no hookDepth).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { hexHooks } from '../../server/sim/content/hexcards/hooks.js';
import {
  installTapdance, installUltrefresh, installOmenpact, installProteinShake, installHeavyHitter,
} from '../../server/sim/content/hexcards/batch14b.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HEXTECH = JSON.parse(readFileSync(path.join(ROOT, 'data', 'hextech.json'), 'utf8'));

/** hex id → the script key its record must carry (hextech.js SCRIPT_KEY's half of the gate). */
const CARD_KEYS = Object.freeze({
  hex_tapdance: 'tapdance', hex_ultrefresh: 'ultrefresh', hex_omenpact: 'omenpact',
  hex_proteinshake: 'proteinshake', hex_heavyhitter: 'heavyhitter',
});

/**
 * One playerEffects entry, the shape server/match/hextech.js addHexRef writes. The record's own effect is preferred
 * (so the suite also proves the shape the roster hands the sim); `effect` is the fallback when the data has no record.
 */
function refOf(hexId, effect) {
  const rec = (HEXTECH.playerHexes || {})[hexId] || null;
  const params = { ...(rec && rec.effect ? rec.effect : effect), hexId, rarity: rec ? rec.rarity : 3 };
  return {
    id: `hex:${hexId}`, key: `hex:${hexId}`, name: rec ? rec.name : hexId, desc: rec ? rec.desc : hexId,
    iconKind: 'hex', iconId: hexId, counter: null, battle: true, params, data: { hexId, rarity: params.rarity },
  };
}

test('batch14b: data/hextech.json carries every card and its script key', () => {
  const rarity = { hex_tapdance: 'prismatic', hex_ultrefresh: 'prismatic', hex_omenpact: 'prismatic', hex_proteinshake: 'prismatic', hex_heavyhitter: 'silver' };
  for (const [hexId, key] of Object.entries(CARD_KEYS)) {
    const rec = (HEXTECH.playerHexes || {})[hexId];
    assert.ok(rec, `data/hextech.json has no ${hexId}`);
    assert.equal(rec.rarity, rarity[hexId], `${hexId} rarity`);
    assert.ok(rec.effect && rec.effect[key], `${hexId} carries the script key ${key}`);
  }
});

/** A player input with the given effects and board units. */
const seat = (playerId, i, { effects = [], units = [] } = {}) => ({
  playerId, seat: i, side: 'L', colOffset: i === 0 ? 0 : 8, bonds: {}, playerEffects: effects, units,
});

/** A chess piece on the board (board coordinates; seat i > 0 lands +8 columns away on a 联防 field). */
const at = (uid, row, col) => ({ uid, kind: 'chess', chessId: 'test_op', row, col });

/** A quiet harness battle over the given seats (no auto-finish). */
function field(players, { kind = 'normal', defs, enemies = [], hooks = ['attack', 'damaged', 'skillStart', 'skillEnd', 'heal'], timeLimit = 60 } = {}) {
  return makeBattle({ kind, content: 'generic', defs, players, enemies, autoFinish: false, captureNoisy: true, timeLimit, hooks });
}

/** Deployed ally operators. */
const ops = (h) => h.battle.allyUnits.filter((u) => u && u.kind === 'op' && u.side === 'ally');
/** A sturdy, immobile enemy: it never reaches the operator and takes a long time to knock out. */
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e6, atk: 0, def: 0, speed: 0, ...o });
/** The operator record used by every suite (100 base ASPD, 2000 HP, 500 ATK, no DEF/RES). */
const opRec = (extra = {}) => chessRec({ id: 'test_op', stats: { maxHp: 2000, atk: 500, def: 0, res: 0, aspd: 100, bat: 1 }, skill: null, ...extra });
/** The tag the heavy blow carries. */
const HEAVY = 'hex:heavyhitter';

// =====================================================================================================================
// 1. 踢踏舞 — every attack +7 ASPD, independent 2 s instances

test('踢踏舞: each attack adds +7 ASPD; each instance lasts 2 s on its own (attacks-in-2s × 7), then all expire', () => {
  const defs = { chess: { test_op: opRec() } };
  const h = field([seat('p1', 0, { effects: [refOf('hex_tapdance', { tapdance: { aspdPerHit: 7, idleSec: 2 } })], units: [at(1, 10, 5)] })], { defs });
  const inst = installTapdance(hexHooks(h.battle));
  assert.equal(typeof inst, 'object', 'installTapdance returns the live tally handle');
  h.run(1);
  const u = ops(h)[0];
  assert.equal(u.s.aspd, 100, 'premise: no attack yet, base ASPD');

  const swing = () => h.battle.emit('attack', { attacker: u, targets: [], isSkill: false });
  swing(); swing(); swing();
  assert.equal(u.buffs.filter((b) => b.key === 'hex:tapdance').length, 3, 'three attacks → three instances');
  assert.equal(u.s.aspd, 100 + 3 * 7, 'the instances are additive');

  h.run(1.5);
  assert.equal(u.s.aspd, 100 + 3 * 7, 'still inside every 2 s window');

  swing(); // a fourth attack at t ≈ 2.5
  h.run(1.5); // t ≈ 4.0: the three from t ≈ 1.0 have expired, the t ≈ 2.5 one has not
  assert.equal(u.buffs.filter((b) => b.key === 'hex:tapdance').length, 1, 'only the attacks within 2 s remain');
  assert.equal(u.s.aspd, 107);

  h.run(0.6); // 2 s after its last attack
  assert.equal(u.buffs.filter((b) => b.key === 'hex:tapdance').length, 0, '2 s without an attack clears everything');
  assert.equal(u.s.aspd, 100);
  h.invariants();
});

test('踢踏舞: a REAL attack of the sim grants the stack; another player’s operator never gets it', () => {
  const defs = { chess: { test_op: opRec() }, enemies: { dummy: dummy('dummy') } };
  const h = field([
    seat('p1', 0, { effects: [refOf('hex_tapdance', { tapdance: { aspdPerHit: 7, idleSec: 2 } })], units: [at(1, 10, 5)] }),
    seat('p2', 1, { effects: [], units: [at(2, 10, 6)] }),
  ], { kind: 'unite', defs, enemies: [{ key: 'dummy', time: 0, pos: [10, 6] }, { key: 'dummy', time: 0, pos: [10, 15] }] });
  installTapdance(hexHooks(h.battle));
  h.runUntil(() => ops(h).every((u) => u.stats.attacks > 0), 10);
  const [mine, theirs] = ops(h);
  assert.ok(mine.stats.attacks > 0, 'premise: the owner’s operator attacked');
  assert.ok(theirs.stats.attacks > 0, 'premise: the other player’s operator attacked too');
  assert.ok(mine.buffs.some((b) => b.key === 'hex:tapdance'), 'the owner’s operator carries the stacks');
  assert.ok(!theirs.buffs.some((b) => b.key === 'hex:tapdance'), 'the card belongs to p1 — p2’s operator gains nothing');
  assert.equal(theirs.s.aspd, 100);
  h.invariants();
});

test('踢踏舞: no card on the field installs nothing', () => {
  const defs = { chess: { test_op: opRec() } };
  const h = field([seat('p1', 0, { units: [at(1, 10, 5)] })], { defs });
  assert.equal(installTapdance(hexHooks(h.battle)), 0);
  h.run(1);
  h.battle.emit('attack', { attacker: ops(h)[0], targets: [], isSkill: false });
  assert.equal(ops(h)[0].buffs.filter((b) => b.key === 'hex:tapdance').length, 0);
  h.invariants();
});

// =====================================================================================================================
// 2. 终极刷新 — after a skill ends, cast it once more (per-operator 30 s cooldown)

test('终极刷新: a duration skill is cast again for free right after it ends (one charge spent, two casts)', () => {
  const defs = { chess: { test_op: opRec({ skill: { duration: 5, spCost: 10, initSp: 10 } }) } };
  const h = field([seat('p1', 0, { effects: [refOf('hex_ultrefresh', { ultrefresh: { cd: 30 } })], units: [at(1, 10, 5)] })], { defs });
  const inst = installUltrefresh(hexHooks(h.battle));
  h.run(1);
  const u = ops(h)[0];
  assert.equal(u.skill.kind, 'duration', 'premise: a timed skill');
  assert.ok(u.skill.activate('test'), 'the initial charge casts it');
  assert.equal(u.skill.activations, 1);
  assert.equal(u.skill.charges, 0, 'premise: the cast spent the charge');

  h.run(5.2); // the 5 s skill ends, the refresh is cast at the next tick
  const starts = () => h.hooksOf('skillStart').filter((c) => c.unit === u);
  assert.equal(starts().length, 2, 'the script cast it a second time');
  assert.ok(u.skill.active, 'the second cast runs');
  assert.equal(u.skill.activations, 2);
  assert.equal(inst.refreshed, 1);
  assert.equal(u.skill.charges, 0, 'the replay is free — it consumes no charge');

  // the replay's OWN end is inside the 30 s cooldown: it must not cascade
  u.skill.end('test');
  h.run(1);
  assert.equal(starts().length, 2, 'per-operator 30 s cooldown holds');
  h.invariants();
});

test('终极刷新: an instant skill’s replay does not recurse, and the 30 s cooldown then allows the next refresh', () => {
  const defs = { chess: { test_op: opRec({ skill: { duration: 0, spCost: 10, initSp: 10 } }) } };
  const h = field([seat('p1', 0, { effects: [refOf('hex_ultrefresh', { ultrefresh: { cd: 30 } })], units: [at(1, 10, 5)] })], { defs, timeLimit: 200 });
  const inst = installUltrefresh(hexHooks(h.battle));
  h.run(1);
  const u = ops(h)[0];
  assert.equal(u.skill.kind, 'instant', 'premise: an instant skill ends inside its own cast');
  assert.ok(u.skill.activate('test'));
  const starts = () => h.hooksOf('skillStart').filter((c) => c.unit === u);
  assert.equal(starts().length, 1);
  h.run(0.2); // the replay lands at the next tick, ends instantly, and must NOT queue another
  assert.equal(starts().length, 2, 'exactly one replay');
  assert.equal(inst.refreshed, 1);
  const depth = h.battle.errors.filter((e) => String(e.label).includes('hookDepth'));
  assert.deepEqual(depth, [], 'no hook-depth abort: the replay is not recursive');

  // past the cooldown the next end refreshes again (activate free: the charge is 0)
  h.run(31);
  assert.ok(u.skill.activate('test', { free: true }));
  u.skill.end('test');
  h.run(0.2);
  assert.equal(inst.refreshed, 2, 'the cooldown expired → a second refresh');
  assert.equal(starts().length, 4, 'the free cast + its replay');
  h.invariants();
});

test('终极刷新: only the card owner’s operators refresh their skills', () => {
  const defs = { chess: { test_op: opRec({ skill: { duration: 5, spCost: 10, initSp: 10 } }) } };
  const h = field([
    seat('p1', 0, { effects: [refOf('hex_ultrefresh', { ultrefresh: { cd: 30 } })], units: [at(1, 10, 5)] }),
    seat('p2', 1, { effects: [], units: [at(2, 10, 6)] }),
  ], { kind: 'unite', defs });
  installUltrefresh(hexHooks(h.battle));
  h.run(1);
  const [mine, theirs] = ops(h);
  assert.ok(theirs.skill.activate('test', { free: true }));
  theirs.skill.end('test');
  h.run(0.2);
  assert.equal(h.hooksOf('skillStart').filter((c) => c.unit === theirs).length, 1, 'p2 has no card → no replay');
  assert.ok(mine.skill.activate('test', { free: true }));
  mine.skill.end('test');
  h.run(0.2);
  assert.equal(h.hooksOf('skillStart').filter((c) => c.unit === mine).length, 2, 'the owner’s operator is replayed');
  h.invariants();
});

test('终极刷新: no card installs nothing', () => {
  const defs = { chess: { test_op: opRec({ skill: { duration: 5, spCost: 10, initSp: 10 } }) } };
  const h = field([seat('p1', 0, { units: [at(1, 10, 5)] })], { defs });
  assert.equal(installUltrefresh(hexHooks(h.battle)), 0);
  h.run(1);
  const u = ops(h)[0];
  assert.ok(u.skill.activate('test', { free: true }));
  u.skill.end('test');
  h.run(0.2);
  assert.equal(h.hooksOf('skillStart').filter((c) => c.unit === u).length, 1);
  h.invariants();
});

// =====================================================================================================================
// 3. 不祥契约 — ATK from missing HP (≤ +150 %), 40 % lifesteal, 5 % current HP per attack

test('不祥契约: ATK grows with missing HP up to +150 % and re-reads live HP every tick', () => {
  const defs = { chess: { test_op: opRec() } };
  const h = field([seat('p1', 0, { effects: [refOf('hex_omenpact', { omenpact: { atkMaxPct: 150, lifestealPct: 40, hpCostPct: 5 } })], units: [at(1, 10, 5)] })], { defs });
  installOmenpact(hexHooks(h.battle));
  h.run(1);
  const u = ops(h)[0];
  assert.equal(u.s.atk, 500, 'full HP → no bonus');

  u.hp = 1000; u.markDirty();
  h.run(0.1);
  assert.ok(Math.abs(u.s.atk - 500 * (1 + 0.75)) < 1e-6, `half HP → +75 % (got ${u.s.atk})`);

  u.hp = 1; u.markDirty();
  h.run(0.1);
  assert.ok(Math.abs(u.s.atk - 500 * (1 + 1.5 * (1 - 1 / 2000))) < 1e-6, `near death → almost +150 % (got ${u.s.atk})`);

  u.hp = 2000; u.markDirty();
  h.run(0.1);
  assert.ok(Math.abs(u.s.atk - 500) < 1e-6, 'healed back → the bonus is gone');
  h.invariants();
});

test('不祥契约: 40 % of the damage dealt to an enemy heals the carrier; attacks cost 5 % of current HP', () => {
  const defs = { chess: { test_op: opRec() }, enemies: { dummy: dummy('dummy') } };
  const h = field([seat('p1', 0, { effects: [refOf('hex_omenpact', { omenpact: { atkMaxPct: 150, lifestealPct: 40, hpCostPct: 5 } })], units: [at(1, 10, 5)] })], { defs, enemies: [{ key: 'dummy', time: 0, pos: [2, 2] }] });
  const inst = installOmenpact(hexHooks(h.battle));
  h.run(1);
  const u = ops(h)[0];
  const foe = h.battle.enemies[0];

  u.hp = 1000; u.markDirty();
  const dealt = h.battle.dealDamage(u, foe, { amount: 100, type: 'true', canDodge: false, isAttack: true });
  assert.equal(dealt, 100);
  assert.equal(u.hp, 1040, '40 % of 100 → +40 HP');
  assert.equal(inst.healed, 40);

  // the attack cost: 5 % of CURRENT HP (a 流失, never a hit — no counter, no second lifesteal)
  u.hp = 1000; u.markDirty();
  h.battle.emit('attack', { attacker: u, targets: [foe], isSkill: false });
  assert.equal(u.hp, 950, '5 % of the 1000 current HP');
  assert.equal(inst.paid, 50);
  assert.ok(u.hp > 0);

  // a REAL attack: at full HP the lifesteal is capped away and only the 5 % cost shows
  u.hp = u.s.maxHp; u.markDirty(); h.run(0.1);
  const foe2 = h.spawn('dummy', { pos: [10, 6] });
  assert.ok(foe2, 'premise: an enemy in range');
  h.runUntil(() => u.stats.attacks > 0, 5);
  assert.equal(foe2.hp, 1e6 - 500, 'premise: the operator’s 500 ATK landed (no ATK bonus at full HP)');
  assert.equal(u.hp, 1900, 'only the cost: 5 % of 2000, the lifesteal was capped at full HP');
  const depth = h.battle.errors.filter((e) => String(e.label).includes('hookDepth'));
  assert.deepEqual(depth, [], 'no hook-depth abort');
  h.invariants();
});

test('不祥契约: only the owner’s operators gain it — p2’s operator stays plain', () => {
  const defs = { chess: { test_op: opRec() } };
  const h = field([
    seat('p1', 0, { effects: [refOf('hex_omenpact', { omenpact: { atkMaxPct: 150, lifestealPct: 40, hpCostPct: 5 } })], units: [at(1, 10, 5)] }),
    seat('p2', 1, { effects: [], units: [at(2, 10, 6)] }),
  ], { kind: 'unite', defs });
  assert.equal(typeof installOmenpact(hexHooks(h.battle)), 'object', 'the card installs a live handle');
  h.run(1);
  const [mine, theirs] = ops(h);
  mine.hp = 1000; mine.markDirty();
  theirs.hp = 1000; theirs.markDirty();
  h.run(0.2);
  assert.ok(mine.s.atk > 500, 'the owner’s operator is buffed');
  assert.equal(theirs.s.atk, 500, 'p2’s operator is not a carrier');
  h.invariants();
});

test('不祥契约: no card installs nothing', () => {
  const defs = { chess: { test_op: opRec() } };
  const h = field([seat('p1', 0, { units: [at(1, 10, 5)] })], { defs });
  assert.equal(installOmenpact(hexHooks(h.battle)), 0);
  h.run(1);
  const u = ops(h)[0];
  u.hp = 1000; u.markDirty(); h.run(0.1);
  assert.equal(u.s.atk, 500);
  h.invariants();
});

// =====================================================================================================================
// 4. 蛋白粉奶昔 — per 100 max HP: +10 DEF, +0.1 RES, recomputed when max HP changes

test('蛋白粉奶昔: floor(maxHp / 100) × (10 DEF, 0.1 RES), re-scales when max HP changes', () => {
  const defs = { chess: { test_op: opRec() } };
  const h = field([seat('p1', 0, { effects: [refOf('hex_proteinshake', { proteinshake: { perHp: 100, def: 10, res: 0.1 } })], units: [at(1, 10, 5)] })], { defs });
  const inst = installProteinShake(hexHooks(h.battle));
  h.run(1);
  const u = ops(h)[0];
  assert.equal(u.s.def, 200, '2000 HP → 20 steps × 10 DEF');
  assert.equal(u.s.res, 2, '20 steps × 0.1 RES (2, NOT 200)');
  assert.equal(inst.applied, 20);

  h.battle.addBuff(u, { key: 'test:hp', mods: { hpFlat: 350 } });
  h.run(0.1);
  assert.equal(u.s.maxHp, 2350);
  assert.equal(u.s.def, 230, '2350 HP → 23 steps');
  assert.ok(Math.abs(u.s.res - 2.3) < 1e-9);

  h.battle.removeBuff(u, 'test:hp');
  h.run(0.1);
  assert.equal(u.s.def, 200, 'back to 2000 HP');
  assert.equal(u.s.res, 2);
  h.invariants();
});

test('蛋白粉奶昔: a max HP under 100 grants no step; only the owner’s operators are affected', () => {
  const defs = { chess: { test_op: opRec({ stats: { maxHp: 99, atk: 500, def: 0, res: 0, aspd: 100, bat: 1 } }) } };
  const h = field([
    seat('p1', 0, { effects: [refOf('hex_proteinshake', { proteinshake: { perHp: 100, def: 10, res: 0.1 } })], units: [at(1, 10, 5)] }),
    seat('p2', 1, { effects: [], units: [at(2, 10, 6)] }),
  ], { kind: 'unite', defs });
  installProteinShake(hexHooks(h.battle));
  h.run(1);
  const [mine, theirs] = ops(h);
  assert.equal(mine.s.def, 0, '99 HP is below the first 100-HP step');
  assert.equal(theirs.s.def, 0, 'p2’s operator is not a carrier');
  h.invariants();
});

test('蛋白粉奶昔: no card installs nothing', () => {
  const defs = { chess: { test_op: opRec() } };
  const h = field([seat('p1', 0, { units: [at(1, 10, 5)] })], { defs });
  assert.equal(installProteinShake(hexHooks(h.battle)), 0);
  h.run(1);
  assert.equal(ops(h)[0].s.def, 0);
  h.invariants();
});

// =====================================================================================================================
// 5. 重量级打击手 — normal attacks add 10 % max HP ARTS damage (owner's correction 2026-10-19: it was phys)

test('重量级打击手: every normal attack adds a separate 10 % max-HP ARTS instance', () => {
  const defs = { chess: { test_op: opRec() }, enemies: { dummy: dummy('dummy') } };
  const h = field([seat('p1', 0, { effects: [refOf('hex_heavyhitter', { heavyhitter: { maxHpPct: 10 } })], units: [at(1, 10, 5)] })], { defs, enemies: [{ key: 'dummy', time: 0, pos: [10, 6] }] });
  const inst = installHeavyHitter(hexHooks(h.battle));
  h.run(1);
  const u = ops(h)[0];
  const foe = h.battle.enemies[0];
  h.runUntil(() => u.stats.attacks > 0, 5);
  const hits = () => h.hooksOf('damaged').filter((c) => c.source === u && c.target === foe);
  const body = hits().filter((c) => c.dmg && c.dmg.isAttack);
  const extra = hits().filter((c) => c.dmg && Array.isArray(c.dmg.tags) && c.dmg.tags.includes(HEAVY));
  assert.equal(body.length, 1, 'one normal attack');
  assert.equal(body[0].amount, 500, 'premise: 500 ATK against 0 DEF');
  assert.equal(extra.length, 1, 'one extra instance');
  assert.equal(extra[0].amount, 200, '10 % of 2000 max HP');
  assert.equal(extra[0].dmg.type, 'arts', '额外法术伤害（业主 2026-10-19 改成法术）');
  assert.equal(extra[0].dmg.isAttack, false, 'a separate instance, not the attack itself');
  assert.equal(foe.hp, 1e6 - 700, 'the enemy lost the body hit + the bonus');
  assert.equal(inst.fired, 1);

  // the bonus reads MAX HP, never the attack multiplier: 500 → 1000 ATK leaves it at 200
  const bodiesOf = () => hits().filter((c) => c.dmg && c.dmg.isAttack);
  const extrasOf = () => hits().filter((c) => c.dmg && Array.isArray(c.dmg.tags) && c.dmg.tags.includes(HEAVY));
  h.battle.addBuff(u, { key: 'test:atk', mods: { atkPct: 1 } });
  h.run(0.1);
  assert.equal(u.s.atk, 1000, 'premise: the attack doubled');
  const seen = { body: bodiesOf().length, extra: extrasOf().length };
  const n0 = u.stats.attacks;
  h.runUntil(() => u.stats.attacks > n0, 5);
  const bodies = bodiesOf();
  const extras = extrasOf();
  assert.equal(bodies.length, seen.body + 1, 'exactly one more body hit');
  assert.equal(bodies[bodies.length - 1].amount, 1000, 'the body hit follows the attack multiplier');
  assert.equal(extras.length, seen.extra + 1, 'exactly one more bonus');
  assert.equal(extras[extras.length - 1].amount, 200, 'the bonus does not');
  const depth = h.battle.errors.filter((e) => String(e.label).includes('hookDepth'));
  assert.deepEqual(depth, [], 'the bonus never triggers itself');
  h.invariants();
});

test('重量级打击手: skill attacks and other players’ operators gain nothing', () => {
  const defs = { chess: { test_op: opRec() }, enemies: { dummy: dummy('dummy') } };
  const h = field([
    seat('p1', 0, { effects: [refOf('hex_heavyhitter', { heavyhitter: { maxHpPct: 10 } })], units: [at(1, 10, 5)] }),
    seat('p2', 1, { effects: [], units: [at(2, 10, 6)] }),
  ], { kind: 'unite', defs, enemies: [{ key: 'dummy', time: 0, pos: [10, 6] }, { key: 'dummy', time: 0, pos: [10, 15] }] });
  installHeavyHitter(hexHooks(h.battle));
  h.run(1);
  const [mine, theirs] = ops(h);
  const extrasNow = () => h.hooksOf('damaged').filter((c) => c.dmg && c.dmg.tags && c.dmg.tags.includes(HEAVY)).length;
  const before = extrasNow();
  // a skill attack of the owner is not a 普通攻击
  h.battle.emit('attack', { attacker: mine, targets: [h.battle.enemies[0]], isSkill: true });
  assert.equal(extrasNow(), before, 'no bonus on a skill attack');

  h.runUntil(() => mine.stats.attacks > 0 && theirs.stats.attacks > 0, 10);
  const extras = h.hooksOf('damaged').filter((c) => c.dmg && c.dmg.tags && c.dmg.tags.includes(HEAVY));
  assert.ok(extras.length > 0, 'the owner’s normal attacks add the bonus');
  assert.ok(extras.every((c) => c.source === mine), 'p2’s operator is not a carrier');
  h.invariants();
});

test('重量级打击手: no card installs nothing', () => {
  const defs = { chess: { test_op: opRec() }, enemies: { dummy: dummy('dummy') } };
  const h = field([seat('p1', 0, { units: [at(1, 10, 5)] })], { defs, enemies: [{ key: 'dummy', time: 0, pos: [10, 6] }] });
  assert.equal(installHeavyHitter(hexHooks(h.battle)), 0);
  h.run(1);
  const u = ops(h)[0];
  h.runUntil(() => u.stats.attacks > 0, 5);
  assert.equal(h.battle.enemies[0].hp, 1e6 - 500, 'only the body hit');
  h.invariants();
});
