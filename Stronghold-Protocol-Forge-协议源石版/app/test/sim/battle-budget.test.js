// 单场作战的两道「病态」闸 (server/sim/constants.js MAX_BATTLE_ERRORS / MAX_TICK_DAMAGE_INSTANCES).
//
// 为什么需要它们：2026-10-30 一台线上主机 100% CPU 空转两小时，日志在刷 `hook nesting deeper than 32`。原来的熔断只数
// *engine* 错误（`_handlerError(..., internal = true)`，`MAX_INTERNAL_ERRORS = 200`），而 hook 深度违规是以 **content**
// 错误记的 —— 于是「跳过嵌套回调、继续跑」可以无限重复，战斗永远结束不了。互反伤循环更连错误都不产生，只在一次
// `step()` 里解析掉无数个伤害实例。两道闸都**只数次数、不读时钟**，所以重放同一场战斗会在同一 tick 结束。
//
// 每个用例都把闸口调小（`maxBattleErrors` / `maxTickDamageInstances` 是 Battle 的 opt，未传则用常量），所以这里验证的
// 是同一段代码路径，只是阈值小到几行就能触发。
//
// Run: `node test/sim/battle-budget.test.js`

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { MAX_BATTLE_ERRORS, MAX_TICK_DAMAGE_INSTANCES } from '../../server/sim/constants.js';

const ENEMY = { key: 'enemy_9901_dummy', hp: 1e9, atk: 0, def: 0, speed: 0 };

/** A battle with one silent operator and one punching bag, plus whatever caps the case wants. */
function arena(caps = {}) {
  const h = makeBattle({
    units: [{ chessId: 't_gun', row: 10, col: 5 }],
    defs: { chess: { t_gun: chessRec({ id: 't_gun', profession: 'SNIPER', projectile: 'none', stats: { atk: 100, maxHp: 10000, bat: 1 }, rangeGrid: [[0, 0], [0, 6]], skill: null }) } },
    kits: { t_gun: () => ({ trait: { noAttack: true } }) },
    enemies: [ENEMY],
    autoFinish: false,
    timeLimit: 60,
    ...caps,
  });
  h.step();
  return h;
}

test('the shipping caps are the constants, not something tiny', () => {
  const h = arena();
  assert.equal(h.b.maxBattleErrors, MAX_BATTLE_ERRORS);
  assert.equal(h.b.maxTickDamageInstances, MAX_TICK_DAMAGE_INSTANCES);
  assert.ok(MAX_BATTLE_ERRORS >= 1000, 'a real battle may raise a handful of isolated content errors');
  assert.ok(MAX_TICK_DAMAGE_INSTANCES >= 1000, 'a normal tick resolves a few instances, never thousands');
});

test('handler errors: an endless storm force-ends the battle as a timeout (the case MAX_INTERNAL_ERRORS missed)', () => {
  const h = arena({ maxBattleErrors: 5 });
  const e = h.spawn('enemy_9901_dummy', { pos: [10, 8], routeIndex: 0 });
  // An isolated content error: `internal = false`, so the old breaker never counted it — exactly the observed storm.
  h.b.on('damaged', () => { throw new Error('boom'); });
  for (let i = 0; i < 12 && !h.b.finished; i++) h.b.dealDamage(null, e, { amount: 1, type: 'true', canDodge: false });
  assert.ok(h.b.errorCount > 5, `errors were counted (${h.b.errorCount})`);
  assert.equal(h.b.finished, true, 'the battle ended instead of spinning forever');
  assert.equal(h.b.reason, 'timeout', 'it is a timeout, i.e. the field is abandoned rather than scored');
});

test('damage instances: one tick resolving past the cap force-ends the battle (no error is ever raised)', () => {
  const h = arena({ maxTickDamageInstances: 10 });
  const e = h.spawn('enemy_9901_dummy', { pos: [10, 8], routeIndex: 0 });
  h.b.dmgInstances = 0;                       // as `step()` does at the top of a tick
  // The mutual-damage loop: A↔B reflect, unlimited instances, zero errors.
  for (let i = 0; i < 25 && !h.b.finished; i++) h.b.dealDamage(null, e, { amount: 1, type: 'true', canDodge: false });
  assert.ok(h.b.dmgInstances > 10, `the tick went over its budget (${h.b.dmgInstances})`);
  assert.equal(h.b.finished, true, 'the battle was abandoned inside the tick that went pathological');
  assert.equal(h.b.reason, 'timeout');
});

test('both counters reset: a normal tick afterwards is free again', () => {
  const h = arena({ maxTickDamageInstances: 100 });
  const e = h.spawn('enemy_9901_dummy', { pos: [10, 8], routeIndex: 0 });
  h.run(0.5);
  const before = h.b.dmgInstances;
  h.run(0.5);
  assert.ok(h.b.dmgInstances <= 100, `a fresh tick restarts the count (was ${before}, now ${h.b.dmgInstances})`);
  assert.equal(h.b.finished, false, 'a quiet battle is untouched by either cap');
  assert.equal(h.b.errorCount ?? 0, 0, 'and raises no errors at all');
  checkInvariants(h.b);
});
