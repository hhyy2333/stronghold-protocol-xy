// test/content/hexcards-15b.test.js — 第十四批后四张卡的战斗脚本（server/sim/content/hexcards/batch15b.js）。
//
// 覆盖的卡（业主原文见 batch15b.js 文件头）：
//   hex_warding      加护     —— 只剩「发装备」这一半；装备的战斗效果属于装备自己，见 test/content/items.test.js
//                               「加护 (9_93): the equipment alone …」（业主 2026-10-26）
//   hex_voidreturn   万物归虚 —— 同上（装备那半边在 test/content/items.test.js；备战半边在 test/match/hextech.test.js）
//   hex_corpsehill   尸山     —— 同上
//   hex_oldpower     旧日之力 —— 技力消耗 +20%，伤害 140%（卡级效果，没有装备，玩家拥有卡就生效）
//
// 与 hexcards-15a.test.js 同一套驱动：真实 Battle + 生产同源的 hexHooks(battle)。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { hexHooks } from '../../server/sim/content/hexcards/hooks.js';
import { installOldPower } from '../../server/sim/content/hexcards/batch15b.js';

const HEXTECH = JSON.parse(readFileSync(new URL('../../data/hextech.json', import.meta.url), 'utf8'));
const ITEMS = JSON.parse(readFileSync(new URL('../../data/items.json', import.meta.url), 'utf8'));
const IMPL = { hex_oldpower: installOldPower };

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

function solo({ hexId = null, units = [], enemies = [], defs = {}, kits = null, timeLimit = 40 } = {}) {
  const h = makeBattle({
    defs: { chess: { test_guard: guard(), ...(defs.chess || {}) }, enemies: { enemy_dummy: dummy(), ...(defs.enemies || {}) }, ...defs },
    units, playerEffects: [], enemies, kits, autoFinish: false, timeLimit,
  });
  if (!hexId) return h;
  const player = (h.battle.players || []).find((x) => x && x.playerId === 'p1');
  if (!Array.isArray(player.playerEffects)) player.playerEffects = [];
  player.playerEffects.push(refOf(hexId));
  return h;
}

// =====================================================================================================================
// data set guard
// =====================================================================================================================

test('batch15b: the four records keep their data, and the equipment they hand out exists', () => {
  assert.deepEqual(effectOf('hex_warding').warding, { cutPct: 60 });
  assert.deepEqual(effectOf('hex_voidreturn').voidreturn, { atkPctPerLayer: 20, dmgCutPerLayer: 30 });
  assert.deepEqual(effectOf('hex_corpsehill').corpsehill, { spRecovery: 1, regenPct: 1 });
  assert.deepEqual(effectOf('hex_oldpower').oldpower, { spCostPct: 20, dmgPct: 140 });
  // The three equipment-granting cards hand their item out and nothing else: the item's own numbers (data/items.json
  // params) are what the battle reads now (server/sim/content/items/protocol.js).
  for (const [hexId, itemId] of [
    ['hex_warding', 'chess_item_9_93_e_a'],
    ['hex_voidreturn', 'chess_item_9_94_e_a'],
    ['hex_corpsehill', 'chess_item_9_95_e_a'],
  ]) {
    assert.deepEqual(effectOf(hexId).onPick, { item: { id: itemId, count: 1 } }, hexId + ' grants its item');
    assert.ok(ITEMS[itemId], itemId + ' exists in data/items.json');
    assert.equal(ITEMS[itemId].hideInShop, true, itemId + ' is not sold');
    assert.ok(ITEMS[itemId].params && Object.keys(ITEMS[itemId].params).length, itemId + ' carries the numbers the item reads');
  }
});

test('batch15b: the remaining installer is a no-op (returns 0) without its card or with a malformed bundle', () => {
  const h = solo({ units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }] });
  for (const [hexId, install] of Object.entries(IMPL)) {
    assert.equal(install(hexHooks(h.battle)), 0, hexId + ': no owner -> 0');
    assert.equal(install(undefined), 0, hexId + ': undefined bundle -> 0');
    assert.equal(install({}), 0, hexId + ': empty bundle -> 0');
    assert.equal(install({ battle: h.battle }), 0, hexId + ': bundle missing ownersOf -> 0');
  }
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
