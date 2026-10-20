// test/sim/hextech-wanted-lane.test.js — 通缉令 (ehex_wanted) 在**多路线**场地（联防）里挑哪条道。
//
// 业主 2026-10-20「联防时敌方协议悬赏令的怪路径有问题」：这个 verb 原来硬编码 routeIndex 0。联防场把每条漏怪波次的
// 路线都带进来，routes[0] 常常是飞行道（FLY）——一条路线就是一串折线，引擎不沿地形寻路，所以地面怪被放上飞行道就是
// 直接穿过悬崖和岩石（实测 482 tick 站在不可通行格上；同场走 WALK 道的怪是 0）。
//
// 这里用真实 Battle + 真实 content，钉住两条：地面怪上非 FLY 道，飞行怪上 FLY 道。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle } from '../helpers/battleHarness.js';

const GROUND = 'enemy_1001_bigbo';   // 大鲍勃：WALK
const FLYER = 'enemy_9009_acfort';   // 假想敌：黑云 —— FLY

// Two lanes with DIFFERENT starts, so which one the spawn took is visible in its position alone.
const LANE_FLY = { motion: 'FLY', start: [9, 10], end: [9, 2], checkpoints: [{ type: 'MOVE', pos: [9, 2], time: 0 }] };
const LANE_WALK = { motion: 'WALK', start: [9, 20], end: [9, 2], checkpoints: [{ type: 'MOVE', pos: [9, 2], time: 0 }] };

function battleWith(wantedKey) {
  return makeBattle({
    rect: { r0: 9, r1: 12, c0: 0, c1: 20 },
    routes: [LANE_FLY, LANE_WALK],
    spawns: [],
    flags: { enemyHexIds: ['ehex_wanted'], enemyHexWanted: wantedKey },
    captureNoisy: true,
  });
}

test('通缉令的地面怪不走飞行道（联防：routes[0] 是 FLY）', () => {
  const h = battleWith(GROUND);
  h.step();
  const e = h.b.enemies.find((x) => x.defId === GROUND);
  assert.ok(e, 'the wanted enemy spawned');
  assert.equal(e.motion, 'WALK');
  assert.equal(Math.round(e.spawnC ?? e.spawnX), 20, `took the WALK lane (col 20), got col ${e.spawnX}`);
});

test('通缉令的飞行怪优先走飞行道', () => {
  const h = battleWith(FLYER);
  h.step();
  const e = h.b.enemies.find((x) => x.defId === FLYER);
  assert.ok(e, 'the wanted flyer spawned');
  assert.equal(e.motion, 'FLY');
  assert.equal(Math.round(e.spawnX), 10, `took the FLY lane (col 10), got col ${e.spawnX}`);
});

test('只有一种道时照旧能生（没有同类型的道就退回 0，不生事）', () => {
  const h = makeBattle({
    rect: { r0: 9, r1: 12, c0: 0, c1: 20 },
    routes: [LANE_FLY],
    spawns: [],
    flags: { enemyHexIds: ['ehex_wanted'], enemyHexWanted: GROUND },
    captureNoisy: true,
  });
  h.step();
  const e = h.b.enemies.find((x) => x.defId === GROUND);
  assert.ok(e, 'still spawns when only a FLY lane exists');
  assert.equal(Math.round(e.spawnX), 10);
});