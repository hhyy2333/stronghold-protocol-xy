// test/sim/hex-stone-egir-siracusa.test.js — 【协同进化】/【教父】的真实 Battle 用例（生产 install() 已接线，不再手动装）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { hexHooks } from '../../server/sim/content/hexcards/hooks.js';
import { installEgirSymbiosis, installSiracusaGodfather } from '../../server/sim/content/hexcards/stone_egir_siracusa.js';

const EGIR = { statPct: 80 };
const GOD = { vulnPct: 10, maxPct: 200 };
const refOf = (hexId, key, effect) => ({
  id: 'hex:' + hexId, key: 'hex:' + hexId, name: hexId, desc: '', iconKind: 'hex', iconId: null,
  counter: null, battle: true, params: { [key]: effect, hexId }, data: { hexId },
});
const egir = (id, atk, maxHp) => chessRec({ id, bonds: ['egirShip'], skill: null, stats: { atk, maxHp, def: 0, res: 0, blockCnt: 1 } });
const sir = (id) => chessRec({ id, bonds: ['siracusaShip'], skill: null, stats: { atk: 500, maxHp: 2000, def: 0, res: 0, blockCnt: 1 } });
const dummy = () => enemyRec({ key: 'enemy_dummy', hp: 1e9, atk: 0, def: 0, res: 0, speed: 0 });

function field({ effects = [], units, bonds = {}, defs, enemyPos = [12, 2] } = {}) {
  return makeBattle({
    defs: defs || { chess: { g_big: egir('g_big', 2000, 20000), g_mid: egir('g_mid', 1000, 10000), g_low: egir('g_low', 500, 5000), g_glass: egir('g_glass', 3000, 2000), gun: sir('gun') }, enemies: { enemy_dummy: dummy() } },
    // content 'generic'：不跑各领域模块（阿戈尔盟约的 +35% 生命等），数字就是本卡自己的数字；hextech install 照常跑。
    content: 'generic',
    // content 'generic' 不跑 hextech 域安装，所以模块由 extraContent 手动装（与生产同一时机：battleStart 之前）。
    extraContent: [
      { install: (b) => installEgirSymbiosis(hexHooks(b)) },
      { install: (b) => installSiracusaGodfather(hexHooks(b)) },
    ],
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds, playerEffects: effects.map((h) => refOf(...h)), units }],
    enemies: [{ key: 'enemy_dummy', time: 0, pos: enemyPos }],
    autoFinish: false, timeLimit: 60,
  });
}
const opOf = (h, defId) => h.b.allyUnits.find((u) => u.kind === 'op' && u.defId === defId);

test('协同进化: devour end raises every 阿戈尔 to 80% of the maximum on each axis, never lowering', () => {
  const h = field({
    effects: [['hex_egir_symbiosis', 'egirSymbiosis', EGIR]],
    bonds: { egirShip: { active: true, count: 3, layers: 0 } },
    units: [
      { uid: 1, kind: 'chess', chessId: 'g_big', row: 9, col: 2 },
      { uid: 2, kind: 'chess', chessId: 'g_mid', row: 10, col: 2 },
      { uid: 3, kind: 'chess', chessId: 'g_low', row: 11, col: 2 },
      { uid: 4, kind: 'chess', chessId: 'g_glass', row: 12, col: 2 },
    ],
  });
  h.run(0.2);
  const big = opOf(h, 'g_big'), mid = opOf(h, 'g_mid'), low = opOf(h, 'g_low'), glass = opOf(h, 'g_glass');
  h.b.emit('egirDevourEnd', { playerId: 'p1' });
  assert.equal(big.s.atk, 2400);   // 2000 < 80% of 3000
  assert.equal(mid.s.atk, 2400);
  assert.equal(low.s.atk, 2400);
  assert.equal(glass.s.atk, 3000); // already the maximum, not lowered
  assert.equal(big.s.maxHp, 20000); // already the maximum
  assert.equal(mid.s.maxHp, 16000);
  assert.equal(low.s.maxHp, 16000);
  assert.equal(glass.s.maxHp, 16000);
});

test('协同进化: without the card nothing is raised', () => {
  const h = field({ units: [{ uid: 1, kind: 'chess', chessId: 'g_big', row: 9, col: 2 }] });
  h.run(0.2);
  const big = opOf(h, 'g_big');
  h.b.emit('egirDevourEnd', { playerId: 'p1' });
  assert.equal(big.s.atk, 2000);
  assert.equal(big.s.maxHp, 20000);
});

test('教父: every own damage instance gives the enemy +10% vulnerable, capped at +200%', () => {
  const h = field({ effects: [['hex_siracusa_godfather', 'siracusaGodfather', GOD]], units: [{ uid: 1, kind: 'chess', chessId: 'gun', row: 9, col: 2 }] });
  h.run(0.2);
  const u = opOf(h, 'gun');
  const e = h.enemies()[0];
  const hp = () => e.hp;
  let before = hp();
  h.b.dealDamage(u, e, { amount: 300, type: 'true', canDodge: false });
  assert.equal(before - hp(), 300, 'first hit not yet vulnerable');
  assert.ok(Math.abs(e.s.dmgTakenMul - 1.1) < 1e-9, 'then +10%');
  before = hp();
  h.b.dealDamage(u, e, { amount: 300, type: 'true', canDodge: false });
  assert.equal(before - hp(), 330, 'second hit ×1.1');
  for (let i = 0; i < 25; i++) h.b.dealDamage(u, e, { amount: 10, type: 'true', canDodge: false });
  assert.ok(Math.abs(e.s.dmgTakenMul - 3) < 1e-9, 'capped at ×3 (+200%)');
});
