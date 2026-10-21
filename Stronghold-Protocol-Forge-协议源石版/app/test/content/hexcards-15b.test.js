// test/content/hexcards-15b.test.js — 第十四批后四张卡的战斗脚本（server/sim/content/hexcards/batch15b.js）。
//
// 覆盖的卡（业主原文见 batch15b.js 文件头）：
//   hex_warding      加护     —— 装备者受到同类型伤害 -60%
//   hex_voidreturn   万物归虚 —— 装备者按「移出备战区人数」层：+20% 攻击力/层、-30 点受伤/层
//   hex_corpsehill   尸山     —— 战斗开始击杀其他己方干员（不可重部署），装备者累加他们的基础属性
//   hex_oldpower     旧日之力 —— 技力消耗 +20%，伤害 140%
//
// 与 hexcards-15a.test.js 同一套驱动：真实 Battle + 生产同源的 hexHooks(battle)。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { FORCED_EXIT } from '../../server/sim/constants.js';
import { hexHooks } from '../../server/sim/content/hexcards/hooks.js';
import {
  installWarding, installVoidReturn, installCorpseHill, installOldPower,
  WARDING_ITEM_KEY, VOIDRETURN_ITEM_KEY, CORPSEHILL_ITEM_KEY,
} from '../../server/sim/content/hexcards/batch15b.js';

const HEXTECH = JSON.parse(readFileSync(new URL('../../data/hextech.json', import.meta.url), 'utf8'));
const ITEMS = JSON.parse(readFileSync(new URL('../../data/items.json', import.meta.url), 'utf8'));
const IMPL = {
  hex_warding: installWarding, hex_voidreturn: installVoidReturn,
  hex_corpsehill: installCorpseHill, hex_oldpower: installOldPower,
};

const effectOf = (hexId) => {
  const rec = HEXTECH.playerHexes[hexId];
  assert.ok(rec, 'data/hextech.json has no ' + hexId);
  return rec.effect;
};
const refOf = (hexId, extra = {}) => {
  const rec = HEXTECH.playerHexes[hexId];
  return {
    id: 'hex:' + hexId, key: 'hex:' + hexId, name: rec.name, desc: rec.desc, iconKind: 'hex',
    params: { ...rec.effect, hexId, rarity: rec.rarity, ...extra }, data: { hexId, rarity: rec.rarity },
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

function solo({ hexId = null, extra = {}, units = [], enemies = [], defs = {}, kits = null, timeLimit = 40 } = {}) {
  const h = makeBattle({
    defs: { chess: { test_guard: guard(), ...(defs.chess || {}) }, enemies: { enemy_dummy: dummy(), ...(defs.enemies || {}) }, ...defs },
    units, playerEffects: [], enemies, kits, autoFinish: false, timeLimit,
  });
  if (!hexId) return h;
  const player = (h.battle.players || []).find((p) => p && p.playerId === 'p1');
  if (!Array.isArray(player.playerEffects)) player.playerEffects = [];
  player.playerEffects.push(refOf(hexId, extra));
  return h;
}

// =====================================================================================================================
// data set guard
// =====================================================================================================================

test('batch15b: the four records carry the spec keys the scripts read, and their items exist', () => {
  assert.deepEqual(effectOf('hex_warding').warding, { cutPct: 60 });
  assert.deepEqual(effectOf('hex_voidreturn').voidreturn, { atkPctPerLayer: 20, dmgCutPerLayer: 30 });
  assert.deepEqual(effectOf('hex_corpsehill').corpsehill, { spRecovery: 1, regenPct: 1 });
  assert.deepEqual(effectOf('hex_oldpower').oldpower, { spCostPct: 20, dmgPct: 140 });
  // the four granted items exist in data/items.json (build-data CUSTOM_ITEMS) and are never sold
  for (const [hexId, itemId, key] of [
    ['hex_warding', 'chess_item_9_93_e_a', WARDING_ITEM_KEY],
    ['hex_voidreturn', 'chess_item_9_94_e_a', VOIDRETURN_ITEM_KEY],
    ['hex_corpsehill', 'chess_item_9_95_e_a', CORPSEHILL_ITEM_KEY],
  ]) {
    assert.deepEqual(effectOf(hexId).onPick, { item: { id: itemId, count: 1 } }, hexId + ' grants its item');
    assert.ok(ITEMS[itemId], itemId + ' exists in data/items.json');
    assert.equal(ITEMS[itemId].hideInShop, true, itemId + ' is not sold');
    assert.equal(key, itemId.replace(/_a$/, ''), 'the script key is the item id without _a');
  }
});

test('batch15b: every installer is a no-op (returns 0) without its card or with a malformed bundle', () => {
  const h = solo({ units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }] });
  for (const [hexId, install] of Object.entries(IMPL)) {
    assert.equal(install(hexHooks(h.battle)), 0, hexId + ': no owner -> 0');
    assert.equal(install(undefined), 0, hexId + ': undefined bundle -> 0');
    assert.equal(install({}), 0, hexId + ': empty bundle -> 0');
    assert.equal(install({ battle: h.battle }), 0, hexId + ': bundle missing ownersOf -> 0');
  }
});

// =====================================================================================================================
// 加护: 受到同类型伤害 -60%
// =====================================================================================================================

test('加护: a hit of the carrier\'s own damage type is cut 60 %; the other type is untouched', () => {
  const h = solo({ hexId: 'hex_warding', units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6, items: ['chess_item_9_93_e_a'] }] });
  h.run(0.1);
  installWarding(hexHooks(h.battle));
  const u = one(h);
  const e = h.spawn('enemy_dummy', { pos: [11, 6] });
  assert.equal(u.dmgType, 'phys', 'premise: the test operator is a physical attacker');
  const phys = h.battle.makeDamage({ amount: 100, type: 'phys' });
  h.battle.emit('hit', { source: e, target: u, dmg: phys });
  assert.ok(Math.abs(phys.mul - 0.4) < 1e-9, 'same type -> x0.4, got ' + phys.mul);
  const arts = h.battle.makeDamage({ amount: 100, type: 'arts' });
  h.battle.emit('hit', { source: e, target: u, dmg: arts });
  assert.equal(arts.mul, 1, 'a different damage type is not cut');
});

test('加护: the reduction needs the 加护 equipment on the carrier', () => {
  const h = solo({ hexId: 'hex_warding', units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }] });
  h.run(0.1);
  installWarding(hexHooks(h.battle));
  const u = one(h);
  const e = h.spawn('enemy_dummy', { pos: [11, 6] });
  const phys = h.battle.makeDamage({ amount: 100, type: 'phys' });
  h.battle.emit('hit', { source: e, target: u, dmg: phys });
  assert.equal(phys.mul, 1, 'no equipment -> no reduction');
});

// =====================================================================================================================
// 旧日之力: 技力消耗 +20%，伤害 140%
// =====================================================================================================================

const SP_KIT = () => ({ skill: { kind: 'instant', spCost: 10, spType: 'time', trigger: 'NEVER' } });

test('旧日之力: own operators deal x1.4 and their skills cost 20 % more SP', () => {
  const h = solo({
    hexId: 'hex_oldpower',
    units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
    kits: { test_guard: SP_KIT },
  });
  h.run(0.1);
  installOldPower(hexHooks(h.battle));
  const u = one(h);
  assert.ok(Math.abs(u.s.dmgDealtMul - 1.4) < 1e-9, 'damage x1.4, got ' + u.s.dmgDealtMul);
  assert.ok(u.skill, 'premise: the operator has a skill');
  assert.equal(u.skill.baseSpCost, 10, 'premise: base SP cost 10');
  assert.equal(u.skill.spCost, 12, 'SP cost +20 % -> 12, got ' + u.skill.spCost);
});

test('旧日之力: an operator of a player without the card is untouched', () => {
  const h = solo({ units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }], kits: { test_guard: SP_KIT } });
  assert.equal(installOldPower(hexHooks(h.battle)), 0);
  h.run(0.1);
  const u = one(h);
  assert.equal(u.s.dmgDealtMul, 1, 'no card -> plain damage');
  assert.equal(u.skill.spCost, 10, 'no card -> base SP cost');
});

// =====================================================================================================================
// 万物归虚: 层数（备战区被移除人数）→ +20% 攻击力/层、-30 点受伤/层
// =====================================================================================================================

test('万物归虚: each layer gives +20 % ATK and a flat -30 damage taken', () => {
  const h = solo({
    hexId: 'hex_voidreturn', extra: { voidLayers: 2 },
    units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6, items: ['chess_item_9_94_e_a'] }],
  });
  h.run(0.1);
  installVoidReturn(hexHooks(h.battle));
  const u = one(h);
  const e = h.spawn('enemy_dummy', { pos: [11, 6] });
  // two layers: +40 % ATK
  assert.ok(u.s.atk > 500, 'attack went up with the layers, got ' + u.s.atk);
  // two layers: 60 flat off each hit. A 500 damage phys hit vs 200 DEF: mitigate -> max(500-200, 5%) = 300, then -60
  const info = h.battle.makeDamage({ amount: 500, type: 'phys' });
  h.battle.emit('hit', { source: e, target: u, dmg: info });
  assert.ok(info.mul < 1, 'the flat reduction folded into the instance, mul = ' + info.mul);
});

test('万物归虚: no layers (nothing removed) and no equipment => nothing happens', () => {
  const bare = solo({
    hexId: 'hex_voidreturn',
    units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6, items: ['chess_item_9_94_e_a'] }],
  });
  bare.run(0.1);
  installVoidReturn(hexHooks(bare.battle));
  const u = one(bare);
  const e = bare.spawn('enemy_dummy', { pos: [11, 6] });
  const info = bare.battle.makeDamage({ amount: 500, type: 'phys' });
  bare.battle.emit('hit', { source: e, target: u, dmg: info });
  assert.equal(info.mul, 1, 'zero layers -> no reduction');
  const noItem = solo({ hexId: 'hex_voidreturn', units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }] });
  noItem.run(0.1);
  installVoidReturn(hexHooks(noItem.battle));
  assert.equal(one(noItem).s.atk, 500, 'no equipment -> no ATK bonus');
});

// 业主 2026-10-22「协议『尸山』的装备『尸山』联防不生效」：联防把**自己那场已经倒下的干员**按 `carryState.down` 送进来，
// 它们入场后立刻被强制退场 —— 到 `battleStart` 时 `alive === false`，对象却还在 `allyUnits` 里。原来按 `alive` 过滤，
// 于是「其他己方干员」一个都不剩、装备者拿不到任何属性。下面这条钉住：自己那场已经倒下的干员，属性照样被吞掉。
// 业主「尸山在联防和打 boss 时会吞掉队友的干员」：联防 / boss 双人场上队友的干员不杀、属性也不吃 ——
// 只认 `ownerId === carrier.ownerId`。所以这里 p_1 的那份 down 不再算进 6000 / 1500。
test('尸山: 联防里自己已经倒下的干员照样被吞属性，队友的（down 或站着）一律不碰', () => {
  const h = makeBattle({
    kind: 'unite', content: 'generic',
    defs: { chess: { test_guard: guard() }, enemies: { enemy_dummy: dummy() } },
    players: [
      { playerId: 'p_0', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [refOf('hex_corpsehill')],
        units: [
          { uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6, items: ['chess_item_9_95_e_a'] },
          { uid: 2, kind: 'chess', chessId: 'test_guard', row: 9, col: 7, carryState: { down: true } },
        ] },
      { playerId: 'p_1', seat: 1, side: 'L', colOffset: 8, bonds: {}, playerEffects: [],
        units: [{ uid: 3, kind: 'chess', chessId: 'test_guard', row: 9, col: 6, carryState: { down: true } }] },
    ],
    enemies: [{ key: 'enemy_dummy', time: 0, pos: [10, 6] }], autoFinish: false, timeLimit: 40,
  });
  // install BEFORE the first step: the handler runs on the engine's own `battleStart`
  const inst = installCorpseHill(hexHooks(h.battle));
  h.run(0.3);
  const alive = opsOf(h).filter((u) => u.alive);
  assert.equal(alive.length, 1, 'only the carrier is left standing, got ' + alive.length);
  const carrier = alive[0];
  assert.equal(inst.kills, 0, 'nobody was killed again (they were already down), got ' + inst.kills);
  // the carrier's own 2000 + its own down 2000; p_1's down is NOT counted
  assert.ok(Math.abs(carrier.s.maxHp - 4000) < 1e-6, 'max HP = carrier 2000 + own down 2000, got ' + carrier.s.maxHp);
  assert.ok(Math.abs(carrier.s.atk - 1000) < 1e-6, 'ATK = own 500 x 2, got ' + carrier.s.atk);
  assert.ok(Math.abs(carrier.s.spRecovery - 1) < 1e-9, 'SP recovery +1, got ' + carrier.s.spRecovery);
  // the teammate's operator was already down on its own account: untouched by 尸山
  assert.equal(h.unit(3).removeReason, FORCED_EXIT, 'p_1\'s operator is still the engine\'s forced exit, not corpsehill');
});

test('尸山: 联防场上站着的队友干员不被执行、也不被吃属性', () => {
  const h = makeBattle({
    kind: 'unite', content: 'generic',
    defs: { chess: { test_guard: guard() }, enemies: { enemy_dummy: dummy() } },
    players: [
      { playerId: 'p_0', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [refOf('hex_corpsehill')],
        units: [
          { uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6, items: ['chess_item_9_95_e_a'] },
          { uid: 2, kind: 'chess', chessId: 'test_guard', row: 9, col: 7 },
        ] },
      { playerId: 'p_1', seat: 1, side: 'L', colOffset: 8, bonds: {}, playerEffects: [],
        units: [{ uid: 3, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }] },
    ],
    enemies: [{ key: 'enemy_dummy', time: 0, pos: [10, 6] }], autoFinish: false, timeLimit: 40,
  });
  const inst = installCorpseHill(hexHooks(h.battle));
  h.run(0.3);
  assert.equal(inst.kills, 1, 'only the card owner\'s other operator is executed, got ' + inst.kills);
  const carrier = h.unit(1);
  const mate = h.unit(3);
  assert.ok(carrier.alive && mate.alive, 'the carrier and the teammate\'s operator are both standing');
  assert.equal(mate.removeReason, undefined, 'the teammate\'s operator was not retired');
  assert.ok(Math.abs(carrier.s.maxHp - 4000) < 1e-6, 'max HP = carrier 2000 + own 2000 (the teammate\'s 2000 is not eaten), got ' + carrier.s.maxHp);
  assert.ok(Math.abs(carrier.s.atk - 1000) < 1e-6, 'ATK = own 500 x 2, got ' + carrier.s.atk);
});

test('尸山: boss 双人场里另一半玩家的干员不被执行、也不被吃属性', () => {
  const h = makeBattle({
    kind: 'boss', content: 'generic',
    defs: { chess: { test_guard: guard() }, enemies: { enemy_dummy: dummy() } },
    players: [
      { playerId: 'p_0', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [refOf('hex_corpsehill')],
        units: [
          { uid: 1, kind: 'chess', chessId: 'test_guard', row: 10, col: 3, items: ['chess_item_9_95_e_a'] },
          { uid: 2, kind: 'chess', chessId: 'test_guard', row: 10, col: 4 },
        ] },
      { playerId: 'p_1', seat: 1, side: 'R', bonds: {}, playerEffects: [],
        units: [{ uid: 3, kind: 'chess', chessId: 'test_guard', row: 10, col: 3 }] },
    ],
    autoFinish: false, timeLimit: 40,
  });
  const inst = installCorpseHill(hexHooks(h.battle));
  h.run(0.3);
  assert.equal(inst.kills, 1, 'only the card owner\'s other operator is executed, got ' + inst.kills);
  const carrier = h.unit(1);
  const partner = h.unit(3);
  assert.equal(partner.ownerId, 'p_1', 'premise: the partner\'s operator keeps its own ownerId');
  assert.ok(carrier.alive && partner.alive, 'the carrier and the partner\'s operator are both standing');
  assert.equal(partner.removeReason, undefined, 'the partner\'s operator was not retired');
  assert.ok(Math.abs(carrier.s.maxHp - 4000) < 1e-6, 'max HP = carrier 2000 + own 2000, got ' + carrier.s.maxHp);
  assert.ok(Math.abs(carrier.s.atk - 1000) < 1e-6, 'ATK = own 500 x 2, got ' + carrier.s.atk);
});

// =====================================================================================================================
// 尸山: 战斗开始击杀其他己方干员（不可重部署），装备者累加他们的基础属性；
//       技力回复 +1 与每秒回复 1% 最大生命是定值（不随击杀数放大）
// =====================================================================================================================

test('尸山: the carrier executes every other own operator and adds up their BASE stats', () => {
  const h = solo({
    hexId: 'hex_corpsehill',
    units: [
      // 装备者：base 2000 HP / 500 ATK / 200 DEF / 1 阻挡 / 0 法抗
      { uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6, items: ['chess_item_9_95_e_a'] },
      // 另外两个：各 2000 / 500 / 200 / 1 / 0 → 累加后应 +4000 HP、+1000 ATK、+400 DEF、+2 阻挡
      { uid: 2, kind: 'chess', chessId: 'test_guard', row: 9, col: 7 },
      { uid: 3, kind: 'chess', chessId: 'test_guard', row: 9, col: 8 },
    ],
    defs: { chess: { test_guard: guard() } },
  });
  h.run(0.2);
  const inst = installCorpseHill(hexHooks(h.battle));
  assert.ok(inst && inst.owners === 1, 'installed for the owner');
  // battleStart already fired in h.run; drive the execute path the way the engine does
  h.battle.emit('battleStart', {});
  const alive = opsOf(h).filter((u) => u.alive);
  assert.equal(alive.length, 1, 'only the carrier survives, got ' + alive.length);
  const carrier = alive[0];
  assert.ok(carrier.items.includes('chess_item_9_95_e_a'), 'the survivor is the equipment carrier');
  assert.equal(inst.kills, 2, 'two operators executed');
  // stats: the carrier's own 2000 HP + 2000 + 2000, 500 ATK + 500 + 500, 200 DEF + 200 + 200, block 1 + 1 + 1, RES 0
  assert.ok(Math.abs(carrier.s.maxHp - 6000) < 1e-6, 'max HP = 2000 + 2000 + 2000, got ' + carrier.s.maxHp);
  assert.ok(Math.abs(carrier.s.atk - 1500) < 1e-6, 'ATK = 500 + 500 + 500 (最终加算), got ' + carrier.s.atk);
  assert.ok(Math.abs(carrier.s.def - 600) < 1e-6, 'DEF = 200 + 200 + 200, got ' + carrier.s.def);
  assert.ok(Math.abs(carrier.s.blockCnt - 3) < 1e-6, 'block = 1 + 1 + 1, got ' + carrier.s.blockCnt);
  // the two FLAT numbers are awarded once, not per kill
  assert.ok(Math.abs(carrier.s.spRecovery - 1) < 1e-9, 'SP recovery +1 once (not +2), got ' + carrier.s.spRecovery);
  assert.ok(Math.abs(carrier.s.hpRegen - carrier.s.maxHp * 0.01) < 1e-6, '1 % max HP a second once, got ' + carrier.s.hpRegen);
});

test('尸山: with no other own operator nothing is executed and no bonus lands', () => {
  const h = solo({
    hexId: 'hex_corpsehill',
    units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6, items: ['chess_item_9_95_e_a'] }],
  });
  h.run(0.2);
  const inst = installCorpseHill(hexHooks(h.battle));
  h.battle.emit('battleStart', {});
  assert.equal(inst.kills, 0, 'nobody to execute');
  const carrier = opsOf(h).find((u) => u.alive);
  assert.equal(opsOf(h).filter((u) => u.alive).length, 1, 'the carrier is untouched');
  assert.equal(carrier.s.maxHp, 2000, 'no stat bonus without a victim');
  assert.equal(carrier.s.atk, 500, 'no ATK bonus without a victim');
  assert.equal(carrier.s.spRecovery, 0, 'no SP recovery without a victim');
});

test('尸山: the equipment is what decides WHO eats — a carrier without it eats nobody', () => {
  const h = solo({
    hexId: 'hex_corpsehill',
    units: [
      { uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }, // owner of the card, NO item
      { uid: 2, kind: 'chess', chessId: 'test_guard', row: 9, col: 7 },
    ],
    defs: { chess: { test_guard: guard() } },
  });
  h.run(0.2);
  const inst = installCorpseHill(hexHooks(h.battle));
  h.battle.emit('battleStart', {});
  assert.equal(inst.kills, 0, 'the card alone does not execute: the item does');
  assert.equal(opsOf(h).filter((u) => u.alive).length, 2, 'both operators are still standing');
});

