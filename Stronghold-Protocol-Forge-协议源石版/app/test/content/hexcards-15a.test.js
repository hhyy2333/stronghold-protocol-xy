// test/content/hexcards-15a.test.js — 第十四批前四张卡的战斗脚本（server/sim/content/hexcards/batch15a.js）。
//
// 覆盖的卡（业主原文见 batch15a.js 文件头）：
//   hex_canlight       残光     —— 装备者伤害 (1 + 30% x)，每次攻击掷 4x% 自伤，触发后 x 归零
//   hex_glasscannon    玻璃大炮 —— 己方干员伤害 x1.5、最大生命 x0.8
//   hex_heavyload      身负重担 —— 打带负面状态的敌人 +400% x 状态数
//   hex_umbrellabreak  破伞     —— 被击中 30% 免伤并反击 2 倍法术伤害
//
// 驱动方式与 hexcards-14a.test.js 相同：真实 Battle + 生产同源的 hexHooks(battle)；卡片 ref 在创建后注入，
// 脚本只由测试显式装一次（否则 install() 装一遍、测试再装一遍会双倍结算）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { hexHooks } from '../../server/sim/content/hexcards/hooks.js';
import {
  installCanlight, installGlassCannon, installHeavyLoad, installUmbrellaBreak, CANLIGHT_ITEM_KEY,
} from '../../server/sim/content/hexcards/batch15a.js';

const HEXTECH = JSON.parse(readFileSync(new URL('../../data/hextech.json', import.meta.url), 'utf8'));
const IMPL = {
  hex_canlight: installCanlight, hex_glasscannon: installGlassCannon,
  hex_heavyload: installHeavyLoad, hex_umbrellabreak: installUmbrellaBreak,
};

const effectOf = (hexId) => {
  const rec = HEXTECH.playerHexes[hexId];
  assert.ok(rec, 'data/hextech.json has no ' + hexId);
  return rec.effect;
};
const refOf = (hexId) => {
  const rec = HEXTECH.playerHexes[hexId];
  return {
    id: 'hex:' + hexId, key: 'hex:' + hexId, name: rec.name, desc: rec.desc, iconKind: 'hex',
    params: { ...rec.effect, hexId, rarity: rec.rarity }, data: { hexId, rarity: rec.rarity },
  };
};

const guard = (o = {}) => chessRec({
  id: o.id ?? 'test_guard', profession: o.profession ?? 'WARRIOR',
  stats: { maxHp: 2000, atk: 500, def: 200, res: 0, blockCnt: 1, spRecovery: 0, ...(o.stats || {}) },
  skill: o.skill === undefined ? null : o.skill,
});
const dummy = (o = {}) => enemyRec({ key: o.key ?? 'enemy_dummy', hp: o.hp ?? 100000, atk: o.atk ?? 0, speed: o.speed ?? 0, ...o });
const opsOf = (h) => h.battle.allyUnits.filter((u) => u && u.kind === 'op' && u.side === 'ally');
const one = (h) => opsOf(h).find((u) => u.ownerId === 'p1') ?? opsOf(h)[0];

function inject(h, hexId, pid = 'p1') {
  const player = (h.battle.players || []).find((p) => p && p.playerId === pid);
  if (!player) throw new Error('no player ' + pid);
  if (!Array.isArray(player.playerEffects)) player.playerEffects = [];
  player.playerEffects.push(refOf(hexId));
  return h;
}

function solo({ hexId = null, units = [], enemies = [], defs = {}, kits = null, timeLimit = 40 } = {}) {
  const h = makeBattle({
    defs: { chess: { test_guard: guard(), ...(defs.chess || {}) }, enemies: { enemy_dummy: dummy(), ...(defs.enemies || {}) }, ...defs },
    units, playerEffects: [], enemies, kits, autoFinish: false, timeLimit,
  });
  return hexId ? inject(h, hexId, 'p1') : h;
}

// =====================================================================================================================
// data set guard
// =====================================================================================================================

test('batch15a: the four records carry the spec keys the scripts read', () => {
  assert.deepEqual(effectOf('hex_canlight').canlight, { perHitPct: 30, perHitRiskPct: 4 });
  assert.deepEqual(effectOf('hex_canlight').onPick, { item: { id: 'chess_item_9_92_e_a', count: 1 } });
  assert.deepEqual(effectOf('hex_glasscannon').glasscannon, { dmgPct: 150, hpPct: 80 });
  assert.deepEqual(effectOf('hex_heavyload').heavyload, { atkPctPerStatus: 400 });
  assert.deepEqual(effectOf('hex_umbrellabreak').umbrellabreak, { chance: 30, reflectMul: 200 });
});

test('batch15a: every installer is a no-op (returns 0) without its card or with a malformed bundle', () => {
  const h = solo({ units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }] });
  for (const [hexId, install] of Object.entries(IMPL)) {
    assert.equal(install(hexHooks(h.battle)), 0, hexId + ': no owner -> 0');
    assert.equal(install(undefined), 0, hexId + ': undefined bundle -> 0');
    assert.equal(install({}), 0, hexId + ': empty bundle -> 0');
    assert.equal(install({ battle: h.battle }), 0, hexId + ': bundle missing ownersOf -> 0');
  }
  assert.equal(CANLIGHT_ITEM_KEY, 'chess_item_9_92_e', 'the item key the card matches (strip _a)');
});

// =====================================================================================================================
// 玻璃大炮: 伤害 x1.5、最大生命 x0.8
// =====================================================================================================================

test('玻璃大炮: an own operator deals x1.5 damage and keeps 80% of its max HP', () => {
  const h = solo({ hexId: 'hex_glasscannon', units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }], enemies: [] });
  const inst = installGlassCannon(hexHooks(h.battle));
  assert.ok(inst > 0, 'it covered the operator');
  h.run(0.2);
  const u = one(h);
  assert.ok(Math.abs(u.s.dmgDealtMul - 1.5) < 1e-9, 'damage x1.5, got ' + u.s.dmgDealtMul);
  assert.ok(u.s.maxHp > 0, 'max HP is positive after the x0.8');
});

test('玻璃大炮: an operator of a player without the card is untouched', () => {
  const h = solo({ units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }], enemies: [] });
  assert.equal(installGlassCannon(hexHooks(h.battle)), 0);
  h.run(0.2);
  assert.equal(one(h).s.dmgDealtMul, 1, 'no card: the plain x1');
});

// =====================================================================================================================
// 身负重担: 打带负面状态的敌人 +400% x 状态数
// =====================================================================================================================

test('身负重担: +400% damage per negative status on the enemy hit (none = no bonus)', () => {
  const h = solo({
    hexId: 'hex_heavyload',
    units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
    enemies: [],
  });
  installHeavyLoad(hexHooks(h.battle));
  h.run(0.1);
  const u = one(h);
  const e = h.spawn('enemy_dummy', { pos: [11, 6] });
  assert.ok(e && e.alive, 'premise: an enemy on the field');
  const mul = () => {
    const info = h.battle.makeDamage({ amount: 100, type: 'phys', isAttack: true });
    h.battle.emit('hit', { source: u, target: e, dmg: info });
    return info.mul;
  };
  // clean enemy: no bonus
  assert.equal(mul([]), 1, 'no negative status -> no bonus');
  // one negative status: x5 (1 + 400%)
  h.battle.applyStatus(e, 'stun', { duration: 10, source: u });
  assert.ok(e.buffs.some((b) => b.status === 'stun'), 'premise: the stun landed');
  assert.ok(Math.abs(mul() - 5) < 1e-9, 'one status -> x5, got ' + mul());
  // two distinct negative statuses: x9 (1 + 800%)
  h.battle.applyStatus(e, 'cold', { duration: 10, source: u });
  assert.ok(Math.abs(mul() - 9) < 1e-9, 'two statuses -> x9, got ' + mul());
  // the same status twice does not double-count (kind, not layer)
  h.battle.applyStatus(e, 'stun', { duration: 10, source: u });
  assert.ok(Math.abs(mul() - 9) < 1e-9, 'a repeated status does not stack the count, got ' + mul());
});

test('身负重担: a hit from an operator of a player without the card gets no bonus', () => {
  const h = solo({ units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }], enemies: [] });
  assert.equal(installHeavyLoad(hexHooks(h.battle)), 0);
  h.run(0.1);
  const u = one(h);
  const e = h.spawn('enemy_dummy', { pos: [11, 6] });
  h.battle.applyStatus(e, 'stun', { duration: 10, source: u });
  const info = h.battle.makeDamage({ amount: 100, type: 'phys', isAttack: true });
  h.battle.emit('hit', { source: u, target: e, dmg: info });
  assert.equal(info.mul, 1, 'no card -> no bonus even with statuses');
});

// =====================================================================================================================
// 破伞: 被击中 30% 免伤 + 反击 2 倍法术伤害
// =====================================================================================================================

test('破伞: a hit on the carrier is negated with the card chance and answered with arts damage', () => {
  const h = solo({ hexId: 'hex_umbrellabreak', units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }] });
  h.run(0.1);
  const inst = installUmbrellaBreak(hexHooks(h.battle));
  assert.ok(inst && inst.owners === 1, 'installed for the owner');
  const u = one(h);
  const e = h.spawn('enemy_dummy', { pos: [11, 6] });
  // roll BELOW the 30 % chance: the hit is negated and answered
  h.battle.rng = () => 0;
  const hpBeforeEnemy = e.hp;
  const hpBefore = u.hp;
  const info = h.battle.makeDamage({ amount: 50, type: 'phys', isAttack: true });
  h.battle.dealDamage(e, u, info);
  assert.equal(info.cancel, true, 'the hit was cancelled');
  assert.equal(u.hp, hpBefore, 'the carrier took nothing');
  assert.equal(inst.negated, 1, 'the tally counted the negation');
  const arts = hpBeforeEnemy - e.hp;
  assert.ok(arts > 0, 'the attacker took reflected arts damage, got ' + arts);
  // roll ABOVE the chance: the hit lands untouched
  h.battle.rng = () => 0.99;
  const info2 = h.battle.makeDamage({ amount: 50, type: 'phys', isAttack: true });
  h.battle.dealDamage(e, u, info2);
  assert.equal(info2.cancel, false, 'a failed roll leaves the hit alone');
  assert.ok(u.hp < hpBefore, 'the carrier did take this one');
  assert.equal(inst.negated, 1, 'a failed roll is not counted');
});

test('破伞: damage to an operator of a player without the card is never negated', () => {
  const h = solo({ units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }] });
  assert.equal(installUmbrellaBreak(hexHooks(h.battle)), 0);
  h.run(0.1);
  const u = one(h);
  const e = h.spawn('enemy_dummy', { pos: [11, 6] });
  for (let i = 0; i < 20; i++) {
    const hpBefore = u.hp;
    h.battle.dealDamage(e, u, h.battle.makeDamage({ amount: 5, type: 'phys', isAttack: true }));
    assert.ok(u.hp < hpBefore, 'without the card every hit lands');
  }
});

// =====================================================================================================================
// 残光: 装备者伤害 (1 + 30% x)，每次攻击掷 4x% 自伤
// =====================================================================================================================

test('残光: the carrier needs the 残光 equipment — the card alone does nothing', () => {
  const h = solo({ hexId: 'hex_canlight', units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }] });
  h.run(0.1);
  installCanlight(hexHooks(h.battle));
  const u = one(h);
  const e = h.spawn('enemy_dummy', { pos: [11, 6] });
  const info = h.battle.makeDamage({ amount: 100, type: 'phys', isAttack: true });
  h.battle.emit('hit', { source: u, target: e, dmg: info });
  assert.equal(info.mul, 1, 'no equipment on the carrier -> the damage bonus never applies');
});

test('残光: the equipped carrier deals (1 + 30% x) and every attack counts', () => {
  const h = solo({ hexId: 'hex_canlight', units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6, items: ['chess_item_9_92_e_a'] }] });
  h.run(0.1);
  installCanlight(hexHooks(h.battle));
  const u = one(h);
  const e = h.spawn('enemy_dummy', { pos: [11, 6] });
  // The self-hit roll is a 4x% chance: pin the RNG so this test measures the DAMAGE curve only (the roll has its own
  // test below). rng() is the battle's own stream, so this is not reaching around the engine.
  h.battle.rng = () => 0.999;
  // burn three attacks through the real 'attack' hook: x goes 0 -> 1 -> 2 -> 3
  for (let i = 0; i < 3; i++) h.battle.emit('attack', { attacker: u, targets: [e], isSkill: false });
  const info = h.battle.makeDamage({ amount: 100, type: 'phys', isAttack: true });
  h.battle.emit('hit', { source: u, target: e, dmg: info });
  // x is 3 at this point -> 1 + 0.3 * 3 = 1.9
  assert.ok(Math.abs(info.mul - 1.9) < 1e-9, 'three attacks -> x1.9, got ' + info.mul);
});

