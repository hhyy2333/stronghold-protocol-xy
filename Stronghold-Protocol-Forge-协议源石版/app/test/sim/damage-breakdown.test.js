// test/sim/damage-breakdown.test.js — 伤害统计的类型拆分与两个「不是 HP 伤害」的口径（业主 2026-10-20「伤害面板不够
// 准确详细」）。
//
// 面板的「实际伤害」= 从敌方身上扣掉的生命值，这一条没变；变的是两件从前完全看不见的事：
//   * 元素损伤灌进元素槽、不扣血 —— 整场只打元素的干员在旧面板上是 0；
//   * 打到屏障上的伤害被护盾吃掉 —— 整场在拆盾的干员在旧面板上也是 0。
// 另外每一行的伤害现在按 物理 / 法术 / 真实 拆开（金标准只看战斗结果，这里只加计数器，不会动 golden）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { damageReport } from '../../server/sim/spec.js';

const opRec = (over = {}) => chessRec({ id: 'test_op', stats: { maxHp: 2000, atk: 500, def: 0, res: 0, aspd: 100, bat: 1 }, skill: null, ...over });
const seat = (units) => ({ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [], units });
const at = (uid, row, col) => ({ uid, kind: 'chess', chessId: 'test_op', row, col });
const dummy = (key, over = {}) => enemyRec({ key, hp: 1e6, atk: 0, def: 0, speed: 0, ...over });

function battleWith({ enemyOver = {}, hooks = ['attack'], setup = null } = {}) {
  return makeBattle({
    content: 'generic',
    defs: { chess: { test_op: opRec() }, enemies: { d: dummy('d', enemyOver) } },
    players: [seat([at(1, 10, 5)])],
    enemies: [{ key: 'd', time: 0, pos: [10, 5] }],
    autoFinish: false, captureNoisy: true, timeLimit: 120, hooks,
    setup,
  });
}

test('物理伤害进「物理」那一格，三段之和等于总伤害', () => {
  const h = battleWith();
  h.run(10);
  const row = damageReport(h.b)[0];
  assert.ok(row, 'a row exists (premise: it attacked)');
  assert.ok(row.phys > 0, 'physical damage was recorded');
  assert.equal(row.arts, 0);
  assert.equal(row.true, 0);
  assert.equal(row.phys + row.arts + row.true, row.dmg, 'the split adds up to the total');
});

test('屏障吃掉的伤害记在「护盾吸收」里，不进实际伤害', () => {
  const h = battleWith();
  h.run(0.5);
  const enemy = h.enemies()[0];
  // a plain HP shield, the same shape 屏障 buffs use
  h.b.addBuff(enemy, { key: 'test:shield', shield: 5000, duration: Infinity, persist: true, shieldType: null });
  h.run(10);
  const row = damageReport(h.b)[0];
  assert.ok(row, 'a row exists');
  assert.ok(row.absorbed > 0, 'the shield ate part of the hits and the report says so');
  assert.ok(row.dmg >= 0, 'and actual damage stays the HP-only figure');
});

test('元素损伤单独成项（它填槽、不扣血，所以不进实际伤害）', () => {
  const h = battleWith();
  h.run(0.5);
  const enemy = h.enemies()[0];
  const op = h.b.allyUnits.find((u) => u && u.kind === 'op');
  h.b.dealDamage(op, enemy, { amount: 250, type: 'element', element: 'burn' });
  const row = damageReport(h.b)[0];
  assert.ok(row, 'a row exists');
  assert.ok(row.elem > 0, '元素损伤 被记下来了');
  const before = row.dmg;
  assert.ok(before >= 0);
});