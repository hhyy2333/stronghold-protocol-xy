// test/sim/hex-stone-kazimierz.test.js — 装备【骑士徽章】的真实 Battle 用例（BY_ITEM 生产接线见 items/protocol.js）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { installKnightBadge, KNIGHTBADGE_ITEM_KEY } from '../../server/sim/content/items/knightbadge.js';

const ITEM = 'chess_item_9_98_e_a';
const INDOM = { indomShip: { count: 1, active: false, tier: 0, layers: 0 } };
const op = (id, bonds = []) => chessRec({ id, bonds, skill: null, stats: { maxHp: 5000, atk: 500, def: 0, res: 0, blockCnt: 1 } });
const dummy = () => enemyRec({ key: 'e_d', hp: 1e7, atk: 0, def: 0, res: 0, speed: 0 });
function field({ units, bonds = INDOM } = {}) {
  return makeBattle({
    content: 'generic',
    defs: { chess: { knight: op('knight'), kaz: op('kaz', ['kazimierzShip']), plain: op('plain') }, enemies: { e_d: dummy() } },
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds, playerEffects: [], units }],
    enemies: [{ key: 'e_d', time: 0, pos: [12, 2] }],
    autoFinish: false, timeLimit: 60,
  });
}
const opOf = (h, id) => h.b.allyUnits.find((u) => u.kind === 'op' && u.defId === id);
const enemyOf = (h) => h.b.enemies.find((e) => e.alive);

test('骑士徽章: a 卡西米尔 operator’s HP damage is taken by the knight instead', () => {
  const h = field({ units: [
    { uid: 1, kind: 'chess', chessId: 'knight', row: 9, col: 4, items: [ITEM] },
    { uid: 2, kind: 'chess', chessId: 'kaz', row: 10, col: 4 },
  ] });
  h.run(0.2);
  installKnightBadge(h.b);
  const knight = opOf(h, 'knight');
  const kaz = opOf(h, 'kaz');
  const e = enemyOf(h);
  const kh = knight.hp, zh = kaz.hp;
  h.b.dealDamage(e, kaz, { amount: 1000, type: 'true', canDodge: false });
  assert.equal(kaz.hp, zh, 'the 卡西米尔 operator takes nothing');
  assert.equal(knight.hp, kh - 1000, 'the knight takes it as true damage');
});

test('骑士徽章: 卡西米尔 true damage is ×3, other damage is not', () => {
  const h = field({ units: [
    { uid: 1, kind: 'chess', chessId: 'knight', row: 9, col: 4, items: [ITEM] },
    { uid: 2, kind: 'chess', chessId: 'kaz', row: 10, col: 4 },
    { uid: 3, kind: 'chess', chessId: 'plain', row: 11, col: 4 },
  ] });
  h.run(0.2);
  installKnightBadge(h.b);
  const kaz = opOf(h, 'kaz'), plain = opOf(h, 'plain');
  const e = enemyOf(h);
  let hp = e.hp;
  h.b.dealDamage(kaz, e, { amount: 100, type: 'true', canDodge: false });
  assert.equal(hp - e.hp, 300, 'true damage ×3');
  hp = e.hp;
  h.b.dealDamage(plain, e, { amount: 100, type: 'true', canDodge: false });
  assert.equal(hp - e.hp, 100, 'non-卡西米尔 not scaled');
  hp = e.hp;
  h.b.dealDamage(kaz, e, { amount: 100, type: 'phys', canDodge: false });
  assert.equal(hp - e.hp, 100, 'physical not scaled');
});

test('骑士徽章: a fatal hit on a 卡西米尔 operator is banked by the knight (+5 不屈, survives)', () => {
  const h = field({ units: [
    { uid: 1, kind: 'chess', chessId: 'knight', row: 9, col: 4, items: [ITEM] },
    { uid: 2, kind: 'chess', chessId: 'kaz', row: 10, col: 4 },
  ] });
  h.run(0.2);
  installKnightBadge(h.b);
  const knight = opOf(h, 'knight');
  const kaz = opOf(h, 'kaz');
  const e = enemyOf(h);
  h.b.dealDamage(e, kaz, { amount: 99999, type: 'true', canDodge: false });
  assert.equal(kaz.alive, true, 'the redirected fatal does not kill the 卡西米尔 operator');
  assert.equal(knight.alive, true, 'the knight is saved by the badge');
  assert.ok((h.b.getPlayer('p1').bonds.indomShip.layers || 0) >= 5, '+5 不屈 layers');
});

test('骑士徽章: without the equipment none of it happens (the 卡西米尔 operator dies)', () => {
  const h = field({ units: [{ uid: 1, kind: 'chess', chessId: 'kaz', row: 10, col: 4 }] });
  h.run(0.2);
  installKnightBadge(h.b);
  const kaz = opOf(h, 'kaz');
  const e = enemyOf(h);
  h.b.dealDamage(e, kaz, { amount: 99999, type: 'true', canDodge: false });
  assert.equal(kaz.alive, false, 'no badge, no death ward');
  assert.equal((h.b.getPlayer('p1').bonds.indomShip.layers || 0), 0, 'no 不屈 layers');
});
