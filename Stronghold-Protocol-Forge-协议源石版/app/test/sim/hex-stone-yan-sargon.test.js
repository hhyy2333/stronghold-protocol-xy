// test/sim/hex-stone-yan-sargon.test.js — 【燎原】(hex_yan_ember) 与【绿洲】(hex_sargon_oasis) 的真实 Battle 用例。
// 生产路径已在 install() 里接线，所以这些用例不手动安装模块（手动再装会注册第二套 handler）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { hexHooks } from '../../server/sim/content/hexcards/hooks.js';
import { installYanEmber } from '../../server/sim/content/hexcards/stone_yan_sargon.js';
import { makeDamageInfo } from '../../server/sim/damage.js';

const YAN = { burnPct: 2, burstLayer: 200, steadLayer: 300, steadRatio: 40, thorn: 850, thornPerLayer: 10, fragile: 40, fragileSec: 5, cd: 0.2 };
const SARGON = { shieldPct: 100 };
const refOf = (hexId, key, effect) => ({
  id: 'hex:' + hexId, key: 'hex:' + hexId, name: hexId, desc: '', iconKind: 'hex', iconId: hexId,
  counter: null, battle: true, params: { [key]: effect, hexId }, data: { hexId },
});
const guard = (o = {}) => chessRec({ id: 'test_guard', bonds: [], stats: { maxHp: 5000, atk: 500, def: 0, res: 0, blockCnt: 1 }, skill: null, ...o });
const yanOp = () => chessRec({ id: 'test_yan', bonds: ['yanShip'], stats: { maxHp: 5000, atk: 500, def: 0, res: 0, blockCnt: 1 }, skill: null });
const sargonOp = () => chessRec({ id: 'test_sargon', bonds: ['sargonShip'], profession: 'CASTER', stats: { maxHp: 3000, atk: 400, def: 0, res: 0, blockCnt: 0 }, skill: null });
const dummy = () => enemyRec({ key: 'enemy_dummy', hp: 100000, atk: 0, speed: 0 });

function battleOf({ hexes = [], units, bonds = {}, enemyPos = [12, 2] } = {}) {
  return makeBattle({
    defs: { chess: { test_guard: guard(), test_yan: yanOp(), test_sargon: sargonOp(), test_stead: chessRec({ id: 'test_stead', bonds: ['steadShip'], stats: { maxHp: 5000, atk: 500, def: 0, res: 0, blockCnt: 1 }, skill: null }) }, enemies: { enemy_dummy: dummy() } },
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds, playerEffects: hexes.map((h) => refOf(...h)), units }],
    enemies: [{ key: 'enemy_dummy', time: 0, pos: enemyPos }],
    autoFinish: false, timeLimit: 30,
  });
}
const opOf = (h, defId) => h.b.allyUnits.find((x) => x.kind === 'op' && (!defId || x.defId === defId));

test('燎原: no card -> installer returns 0 (nothing to install)', () => {
  const h = battleOf({ units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }] });
  h.run(0.2);
  assert.equal(installYanEmber(hexHooks(h.b)), 0);
});

test('燎原: own damage adds 2% ATK burning element damage', () => {
  const h = battleOf({ hexes: [['hex_yan_ember', 'yanEmber', YAN]], units: [{ uid: 1, kind: 'chess', chessId: 'test_yan', row: 9, col: 6 }] });
  h.run(0.2);
  const u = opOf(h);
  const e = h.enemies()[0];
  const before = e.elem.burn || 0;
  h.b.dealDamage(u, e, makeDamageInfo({ amount: 100, type: 'phys', canDodge: false, isAttack: true }));
  assert.ok((e.elem.burn || 0) > before, 'burn gauge filled: ' + before + ' -> ' + e.elem.burn);
});

test('燎原: at 200 炎 layers a burn burst is doubled', () => {
  const mk = (layers) => {
    const h = battleOf({ hexes: [['hex_yan_ember', 'yanEmber', YAN]], bonds: { yanShip: { active: true, count: 3, layers } }, units: [{ uid: 1, kind: 'chess', chessId: 'test_yan', row: 9, col: 6 }] });
    h.run(0.2);
    const u = opOf(h);
    const e = h.enemies()[0];
    const hp0 = e.hp;
    h.b.dealDamage(u, e, { amount: 7000, type: 'elemental', element: 'burn', sourceless: true, canDodge: false, tags: ['burst', 'burn'] });
    return hp0 - e.hp;
  };
  const low = mk(100);
  const high = mk(200);
  assert.ok(high > low * 1.9, 'doubled at 200 layers: ' + low + ' -> ' + high);
});

test('燎原: at 300 炎 layers a non-炎 ally takes 60% and the 炎 member takes 40%', () => {
  const h = battleOf({
    hexes: [['hex_yan_ember', 'yanEmber', YAN]],
    bonds: { yanShip: { active: true, count: 3, layers: 300 } },
    units: [
      { uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 },
      { uid: 2, kind: 'chess', chessId: 'test_yan', row: 9, col: 7 },
    ],
  });
  h.run(0.2);
  const g = opOf(h, 'test_guard');
  const y = opOf(h, 'test_yan');
  const e = h.enemies()[0];
  const g0 = g.hp, y0 = y.hp;
  h.b.dealDamage(e, g, makeDamageInfo({ amount: 1000, type: 'true', canDodge: false }));
  assert.ok(Math.abs((y0 - y.hp) - 400) < 2, '炎 member took 40%: ' + (y0 - y.hp));
  assert.ok(Math.abs((g0 - g.hp) - 600) < 2, 'guard took 60%: ' + (g0 - g.hp));
});

test('绿洲: a skill grants a 100% ATK shield and the next attack adds equal arts damage', () => {
  const h = battleOf({ hexes: [['hex_sargon_oasis', 'sargonOasis', SARGON]], units: [{ uid: 1, kind: 'chess', chessId: 'test_sargon', row: 9, col: 6 }] });
  h.run(0.2);
  const u = opOf(h);
  const e = h.enemies()[0];
  h.b.emit('skillStart', { unit: u, skill: u.skill, reason: 'test' });
  const b = u.findBuff('hex:sargon:oasis');
  assert.ok(b && b.shield >= 400, 'shield = 100% ATK');
  const hp0 = e.hp;
  h.b.emit('attack', { attacker: u, targets: [e], isSkill: false });
  assert.ok(hp0 - e.hp >= 390, 'next attack bonus: ' + (hp0 - e.hp));
});

test('燎原: 300 层且真【坚守】tier 2 在场时，炎干员并入坚守分担（4 人各 100）', () => {
  const h = battleOf({
    hexes: [['hex_yan_ember', 'yanEmber', YAN]],
    bonds: {
      yanShip: { active: true, count: 3, layers: 300 },
      steadShip: { active: true, count: 3, tier: 2, layers: 10 },
    },
    units: [
      { uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 },
      { uid: 2, kind: 'chess', chessId: 'test_yan', row: 9, col: 7 },
      { uid: 3, kind: 'chess', chessId: 'test_stead', row: 10, col: 6 },
      { uid: 4, kind: 'chess', chessId: 'test_stead', row: 10, col: 7 },
      { uid: 5, kind: 'chess', chessId: 'test_stead', row: 10, col: 8 },
    ],
  });
  h.run(0.2);
  const guard = opOf(h, 'test_guard');
  const yan = opOf(h, 'test_yan');
  const steads = h.b.allyUnits.filter((u) => u.kind === 'op' && u.defId === 'test_stead');
  const e = h.enemies()[0];
  const g0 = guard.hp, y0 = yan.hp;
  const s0 = steads.map((u) => u.hp);
  h.b.dealDamage(e, guard, makeDamageInfo({ amount: 1000, type: 'true', canDodge: false }));
  assert.equal(g0 - guard.hp, 600, '非坚守干员自己承担 60%');
  assert.equal(y0 - yan.hp, 100, '炎干员作为坚守成员分到 1/4');
  steads.forEach((u, i) => assert.equal(s0[i] - u.hp, 100, '真坚守成员也各分到 1/4'));
});
