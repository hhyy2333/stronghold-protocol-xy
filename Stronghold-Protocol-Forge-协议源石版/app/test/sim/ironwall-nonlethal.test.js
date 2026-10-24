// 业主 2026-10-24「敌方协议铁壁修改成反伤不会致死」：反伤是惩罚，不该由它把人打死（攻击者保留至少 1 点生命）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

const ATK = 600;
const RATIO = 0.1;

/** A frail operator (maxHp tiny) that stands in the enemy's way and keeps hitting it. */
const frail = (o = {}) => chessRec({
  id: 'test_frail', stats: { maxHp: o.maxHp ?? 60, atk: 30, def: 0, res: 0, blockCnt: 1, respawnTime: 20 }, skill: null,
});
const beast = () => enemyRec({ key: 'enemy_beast', hp: 10000000, atk: ATK, def: 0, res: 0, speed: 0, bat: 3 });

function battle({ maxHp = 60, hpStart = null, timeLimit = 25 } = {}) {
  const h = makeBattle({
    defs: { chess: { test_frail: frail({ maxHp }) }, enemies: { enemy_beast: beast() } },
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [], units: [{ uid: 1, kind: 'chess', chessId: 'test_frail', row: 9, col: 6 }] }],
    enemies: [{ key: 'enemy_beast', time: 0, route: 0, pos: [9, 7] }],
    autoFinish: false, timeLimit, captureNoisy: true, hooks: ['damaged', 'death'],
    flags: { enemyHexIds: ['ehex_ironwall'] },
  });
  h.run(0.4);                                  // let it deploy
  const u = h.battle.allyUnits.find((x) => x.kind === 'op');
  assert.ok(u, 'premise: the operator is on the field');
  if (hpStart != null) { u.hp = hpStart; u.markDirty(); }
  // hooks recorded before the HP was rewritten are not interesting: the reflect may already have landed once
  const mark = h.hooksOf('damaged').length;
  return { h, u, mark };
}

test('铁壁: the reflect never kills the attacker — it always leaves 1 HP', () => {
  // a 1-HP operator walking into an ATK-600 wall: the old code delivered its full 60 and knocked it out
  const { h, u } = battle({ maxHp: 60, hpStart: 1 });
  h.run(20);
  assert.ok(u.alive, 'the operator survived the reflect');
  const back = h.hooksOf('damaged').filter((c) => c.dmg && c.dmg.steadThorn);
  assert.ok(back.length > 0, 'the wall still reflected (it is a punishment, not a mercy)');
  for (const c of back) {
    if (!c.target || c.target !== u) continue;
    assert.ok(u.hp >= 1 - 1e-9, `HP stays at or above 1 (${u.hp})`);
  }
  h.invariants();
});

test('铁壁: a healthy operator still takes the full 10 % share', () => {
  const { h, u } = battle({ maxHp: 999999 });
  h.run(20);
  const back = h.hooksOf('damaged').filter((c) => c.dmg && c.dmg.steadThorn && c.target === u);
  assert.ok(back.length > 0, 'reflected at least once');
  for (const c of back) assert.ok(Math.abs(c.amount - ATK * RATIO) < 1e-6, `full share (${c.amount})`);
  assert.ok(u.alive, 'and it is nowhere near dying');
  h.invariants();
});

test('铁壁: an operator down to 3 HP is clipped to 2, not killed', () => {
  const { h, u, mark } = battle({ maxHp: 200, hpStart: 3 });
  h.run(12);
  if (!u.alive) assert.fail('the reflect killed it');
  const hits = h.hooksOf('damaged').slice(mark).filter((c) => c.dmg && c.dmg.steadThorn && c.target === u && c.amount > 0);
  assert.ok(hits.length > 0, 'premise: the reflect landed');
  // the first clipped reflect must not deliver more than the HP that was left above 1
  assert.ok(hits[0].amount <= 2 + 1e-6, `clipped to the room above 1 HP (${hits[0].amount})`);
  h.invariants();
});
