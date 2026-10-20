// test/content/hexcards-15a.test.js — 第十四批前四张卡的战斗脚本（server/sim/content/hexcards/batch15a.js）。
//
// 覆盖的卡（业主原文见 batch15a.js 文件头）：
//   hex_canlight       残光     —— 装备者伤害 (1 + 30% x)，每次攻击掷 4x% 自伤，触发后 x 归零
//   hex_glasscannon    玻璃大炮 —— 己方干员伤害 x1.5、最大生命 x0.8
//   hex_heavyload      身负重担 —— 打带负面状态的敌人时额外 400 点法术伤害 x 状态数
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
import { installArmor } from '../../server/sim/content/hexcards/armor.js';

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
// 身负重担 × 反击装甲: 两卡互相触发过一次（业主 2026-10-20「物理伤害加额外造成一段真实伤害试试」）
//
// 反击装甲（hex_armor）在己方干员**造成伤害**时回一发 200% 防御力的真实伤害。旧的身负重担把「对伤害的回答」也当成
// 一次攻击，于是两条规则接成环：主伤害 → 附伤(法术) → 反击装甲回真伤 → 身负重担又加附伤 → …
// 实测 1 次物理攻击打出 **63 个伤害实例、26,920 伤害**（靠引擎的钩子深度上限才停住）。现在身负重担挡掉
// isRetaliation / hexRiposte，这条链只剩一层。
// =====================================================================================================================

test('身负重担 + 反击装甲: one physical hit stays bounded (no ping-pong between the two scripts)', () => {
  const h = solo({
    units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
    enemies: [],
  });
  h.run(0.1);
  // both cards on the same player, through the production installers
  inject(h, 'hex_heavyload');
  inject(h, 'hex_armor');
  installHeavyLoad(hexHooks(h.battle));
  installArmor(hexHooks(h.battle));
  const u = one(h);
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  assert.ok(e && e.alive, 'premise: an enemy on the field');
  h.battle.applyStatus(e, 'stun', { duration: 10, source: u });
  let instances = 0;
  h.battle.on('hit', () => { instances += 1; });
  const before = e.hp;
  h.battle.dealDamage(u, e, h.battle.makeDamage({ amount: 1000, type: 'phys', canDodge: false, isAttack: true }));
  const loss = before - e.hp;
  // the chain is: main hit + our 400 arts + the armour's answer(s) — a handful, not dozens
  assert.ok(instances <= 6, `bounded instance count, got ${instances}`);
  assert.ok(loss < 5000, `bounded damage, got ${Math.round(loss)}`);
  assert.ok(loss >= 1000, 'premise: at least the main hit landed');
  h.invariants();
});

test('身负重担 + 天马之枪: the extra TRUE damage of the item set does not chain either', () => {
  // 天马之盔 + 天马之枪 = every damage instance the carrier deals also deals 30 % ATK true damage (tags ['item', …]).
  // That proc used to re-enter 身负重担 the same way 反击装甲 did; the engine now marks a nested instance
  // (`dmg.chained`) and the card skips it, so the chain stops after one round instead of running to the depth cap.
  const PEGASUS = ['chess_item_5_09_e_a', 'chess_item_6_01_e_a'];
  const h = makeBattle({
    content: 'full',
    defs: {
      chess: { char_4064_mlynar: chessRec({ id: 'char_4064_mlynar', stats: { maxHp: 5000, atk: 1000, def: 300, res: 0, aspd: 10, bat: 1 }, skill: null }) },
      enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, atk: 0, def: 0, speed: 0 }) },
    },
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [refOf('hex_heavyload')],
      units: [{ uid: 1, kind: 'chess', chessId: 'char_4064_mlynar', row: 10, col: 4, dir: 'RIGHT', items: PEGASUS }] }],
    enemies: [{ key: 'enemy_dummy', time: 0, pos: [10, 5] }],
    autoFinish: false, captureNoisy: true, timeLimit: 60,
  });
  h.run(0.2);
  const u = one(h);
  const e = h.enemies()[0];
  h.b.applyStatus(e, 'stun', { duration: 60, source: u });
  h.b.applyStatus(e, 'slow', { duration: 60, source: u });
  let instances = 0;
  h.b.on('hit', () => { instances += 1; });
  const before = e.hp;
  h.b.dealDamage(u, e, h.b.makeDamage({ amount: 1000, type: 'phys', canDodge: false, isAttack: true }));
  const loss = before - e.hp;
  assert.ok(instances <= 6, `bounded instance count, got ${instances}`);
  assert.ok(loss < 5000, `bounded damage, got ${Math.round(loss)}`);
  // and the card still does its job: the extra 400 x 2 statuses is in there
  assert.ok(loss > 1000 + 400 * 2 - 1, `the flat extra damage is still applied, got ${Math.round(loss)}`);
  h.invariants();
});

// =====================================================================================================================
// data set guard
// =====================================================================================================================

test('batch15a: the four records carry the spec keys the scripts read', () => {
  assert.deepEqual(effectOf('hex_canlight').canlight, { perHitPct: 30, perHitRiskPct: 4 });
  assert.deepEqual(effectOf('hex_canlight').onPick, { item: { id: 'chess_item_9_92_e_a', count: 1 } });
  assert.deepEqual(effectOf('hex_glasscannon').glasscannon, { dmgPct: 150, hpPct: 80 });
  assert.deepEqual(effectOf('hex_heavyload').heavyload, { flatDamage: 400 });
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
// 身负重担: 打带负面状态的敌人时额外 400 点法术伤害 x 状态数
// =====================================================================================================================

test('身负重担: each negative status adds a FLAT 400-damage ARTS instance (not a multiplier)', () => {
  const h = solo({
    hexId: 'hex_heavyload',
    units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
    enemies: [],
  });
  h.run(0.1);
  installHeavyLoad(hexHooks(h.battle));
  const u = one(h);
  const e = h.spawn('enemy_dummy', { pos: [11, 6] });
  assert.ok(e && e.alive, 'premise: an enemy on the field');
  /** Fire one hit; report the main instance's mul and the HP the extra instances removed. */
  const hit = () => {
    const before = e.hp;
    const info = h.battle.makeDamage({ amount: 100, type: 'phys', isAttack: true });
    h.battle.emit('hit', { source: u, target: e, dmg: info });
    return { mul: info.mul, extra: before - e.hp };
  };
  // clean enemy: the main damage is never multiplied and nothing extra is dealt
  const clean = hit();
  assert.equal(clean.mul, 1, 'the main damage is never multiplied');
  // one negative status: one extra 400-point arts instance (the dummy has 0 RES)
  h.battle.applyStatus(e, 'stun', { duration: 10, source: u });
  assert.ok(e.buffs.some((b) => b.status === 'stun'), 'premise: the stun landed');
  const oneHit = hit();
  assert.equal(oneHit.mul, 1, 'still no multiplier on the main hit');
  assert.ok(Math.abs(oneHit.extra - clean.extra - 400) < 1, 'one status -> one extra 400-damage hit, got ' + (oneHit.extra - clean.extra));
  // two distinct statuses: 800
  h.battle.applyStatus(e, 'cold', { duration: 10, source: u });
  const twoHit = hit();
  assert.ok(Math.abs(twoHit.extra - clean.extra - 800) < 1, 'two statuses -> 800 extra, got ' + (twoHit.extra - clean.extra));
  // the same status twice does not double-count (kind, not layer)
  h.battle.applyStatus(e, 'stun', { duration: 10, source: u });
  const againHit = hit();
  assert.ok(Math.abs(againHit.extra - clean.extra - 800) < 1, 'a repeated status does not stack the extra, got ' + (againHit.extra - clean.extra));
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

