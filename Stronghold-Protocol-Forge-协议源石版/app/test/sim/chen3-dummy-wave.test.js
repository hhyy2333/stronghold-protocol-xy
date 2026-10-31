// test/sim/chen3-dummy-wave.test.js — 业主 2026-11-01「火陈打最后的木桩 boss 伤害奇高，每次龙创一下都能明显掉血并且
// 能打死，看看原因」的回归套件。
//
// 现场：赤刃明霄陈 (char_1050_chen3) 的 S3 赤霄·天喟 会放出一道 龙剑气（server/sim/content/kits/ops/op-chen3.js 的
// `unit.mem.chen3Wave`）；第 16 回合「木桩演练」的木桩 enemy_9901_dummy（server/sim/content/enemies/dummy.js：
// 20 亿血 + 20 亿/s 自愈 + `fatal` 锁血）。
//
// 根因（已定位并修复，见 op-chen3.js 的 tick 注释）：剑气的「每段直行只命中一次」靠一张 `hit` 集合实现，而集合原来在
// **每一次转向** 时被清空。波被墙角 / 边界卡住时一帧会连转 4 次、位置一动不动 ⇒ 集合每帧被清空一次 ⇒ 同一只木桩
// **每 tick 命中一次（30 次/秒）**，每次 6% 当前生命 = 1.2 亿 ⇒ 血量被打到 ~52% 并卡住（修复前实测 6 秒 128.9 亿）。
// 现在只在「真的开始了一段新的直行」（转了向且这一帧确实在走）时清空 —— PRTS「转向后忘记打过的敌人」的语义保留。
//
// 另一条被怀疑的路径（锁血被绕过）**不成立**：`fatal` 钩子在 `c.prevented` 之后由 applyHpLoss 把 HP 抬到 1，
// 同一 tick 里的第二发、第三发…… 每一发都会重新判定并且**每一发都会被挡**（`prevented` 是每一发自己的），所以
// 木桩打不死；而且 6% × 当前生命 永远追不上 100%/s 的自愈（稳态 ≥ 3.95% 血池），数学上也到不了 0。
//
// 覆盖：
//   1. 波被卡在死角时，同一只木桩只结算一次（修复前 30 次/秒）；
//   2. 波自然扫过木桩 30 秒：每秒命中次数 ≤ 这一段里开始的直行次数，木桩不死、血量回到满；
//   3. 锁血：同一 tick 内连续 30 次致死伤害 / 3 倍血池 / 逐 tick 连续致死 —— 都停在 1 血且活着；
//   4. 最坏情形（波钉在死角连打 30 秒）木桩仍然不死、0 次 death。
//
// 驱动方式同 test/sim/dummy.test.js / test/content/op_chen3.test.js：真实 sim Battle（test/helpers/battleHarness.js）
// + `content: 'full'`（装上真正的陈 kit 与木桩 kit），陈按生产路径用 自选槽 + `diy` 落场。
// Run: `node test/sim/chen3-dummy-wave.test.js`（沙箱里 `node --test` 会 spawn EPERM，所以直接跑文件）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const CHEN3 = 'char_1050_chen3';
const SLOT6 = 'chess_char_6_diy1_a';
const DUMMY = 'enemy_9901_dummy';
/** 让 MANUAL 的 S3 能起手的靶子（离剑气的测试落点很远，不参与断言）。 */
const TRIGGER = 'enemy_trigger';

/** 木桩的契约数值（data/enemies.json：20 亿血 / 20 亿每秒自愈）。 */
const HP = 2_000_000_000;
const REGEN = 2_000_000_000;

/** 只用来触发技能的靶子：血厚、不动、不还手。 */
const triggerRec = () => enemyRec({ key: TRIGGER, hp: 1e9, atk: 0, def: 0, speed: 0 });

/**
 * 一场平关（flat 合成关）：赤刃明霄陈按自选 6 阶落场（E2 Lv60 / 技能 7 级 / 无模组），朝向可指定。
 * `content: 'full'` ⇒ 装上真正的 op-chen3 kit 与 enemies/dummy.js 的木桩 kit。
 */
function field({ row = 10, col = 5, dir = 'RIGHT' } = {}) {
  const h = makeBattle({
    content: 'full',
    autoFinish: false,
    timeLimit: 400,
    captureNoisy: true,
    hooks: ['damaged', 'death', 'kill', 'fatal', 'heal', 'skillStart', 'skillEnd'],
    defs: { chess: {}, enemies: { [TRIGGER]: triggerRec() } },
    units: [{ uid: 1, dir, diy: { slot: SLOT6, charId: CHEN3, skillIndex: 2, uniEquipId: null }, elite: true, row, col }],
  });
  h.step();
  return { h, u: h.unit(1) };
}

/** 起手 S3（先放一只靶子在 3-12 里，MANUAL 技能才会开）。 */
function castS3(h, u, at = [10, 7]) {
  const trigger = h.b.spawnEnemy(TRIGGER, { pos: at, routeIndex: 0 });
  assert.ok(trigger, 'premise: 触发技能的靶子刷出来了');
  u.skill.gainSp(999);
  assert.ok(h.runUntil(() => u.skill.active, 2), 'premise: S3 起手了');
  return trigger;
}

/** 剑气命中某只敌人的 `damaged` 事件。 */
const waveHitsOn = (h, u, e) => h.hooksOf('damaged').filter((c) => c.source === u && c.target === e && (c.dmg?.tags || []).includes('chen3:wave'));

/**
 * 平关里一个「四向探针全被挡」的死角：波走到这里会原地打转（行 9 左侧两列是墙、左边是侵入点那一列之外）。
 * 坐标与 `waveBlocked` 的同一套取整口径算出：右/左/上/下四个 0.25 探针分别落在 (9,1)/(9,0)/(9,1)/(9,1)，
 * 全是 '#' 或 'E'。
 */
const DEAD_CORNER = Object.freeze({ x: 1.1, y: 9 });

/** 把波搬进死角（模拟它自己走进去 —— 走进去之后就再也出不来，位置与方向都不再变化）。 */
function plantWaveInDeadCorner(u) {
  const w = u.mem.chen3Wave;
  assert.ok(w, 'premise: 剑气还在');
  w.x = DEAD_CORNER.x;
  w.y = DEAD_CORNER.y;
  w.dr = 0; w.dc = -1;      // 朝左
  w.runDr = 0; w.runDc = -1; // 与当前直行方向一致（不是刚转向）
  return w;
}

// =====================================================================================================================
// 1. 波卡在死角：同一只木桩只结算一次

test('龙剑气被卡在死角时，同一只木桩只结算一次（修复前是每 tick 一次 = 30 次/秒）', () => {
  const { h, u } = field();
  castS3(h, u, [10, 7]);
  // 木桩就放在死角旁边（中心距 0.9 < 1.3 命中半径）
  const e = h.b.spawnEnemy(DUMMY, { pos: [DEAD_CORNER.y, 2], routeIndex: 0 });
  assert.ok(e, 'premise: 木桩刷出来了');
  assert.equal(e.s.maxHp, HP, 'premise: 木桩 20 亿血');
  assert.equal(e.s.hpRegen, REGEN, 'premise: 自愈 20 亿/s');
  const w = plantWaveInDeadCorner(u);

  h.run(5);

  assert.deepEqual([w.x, w.y], [DEAD_CORNER.x, DEAD_CORNER.y], 'premise: 波真的被卡住了（一帧转 4 次、原地不动）');
  const hits = waveHitsOn(h, u, e);
  assert.equal(hits.length, 1, `5 秒 150 个 tick 里只该结算 1 次（实际 ${hits.length} 次）`);
  // 一次命中 = 6% 当前生命（20 亿 × 0.06 = 1.2 亿），不是「每 tick 1.2 亿 × 150」
  assert.ok(Math.abs(hits[0].amount - HP * 0.06) < 1, `一次 6% 当前生命：${hits[0].amount}`);
  assert.equal(e.alive, true, '木桩还活着');
  assert.equal(e.hp, e.s.maxHp, '血量被自愈拉回满');
  checkInvariants(h.b);
});

test('龙剑气被卡在死角时，旁边有第二只木桩也只各结算一次（不是每 tick 一轮）', () => {
  const { h, u } = field();
  castS3(h, u, [10, 7]);
  const a = h.b.spawnEnemy(DUMMY, { pos: [9, 2], routeIndex: 0 });
  const b = h.b.spawnEnemy(DUMMY, { pos: [10, 2], routeIndex: 0 });
  plantWaveInDeadCorner(u);
  h.run(5);
  assert.equal(waveHitsOn(h, u, a).length, 1, '第一只：一次');
  assert.equal(waveHitsOn(h, u, b).length, 1, '第二只：一次');
  assert.ok(a.alive && b.alive);
  checkInvariants(h.b);
});

// =====================================================================================================================
// 2. 自然扫过：每秒命中次数 ≤ 直行次数

test('龙剑气自然扫过木桩 30 秒：每秒命中次数不超过这一段里开始的直行次数，木桩不死且血量回满', () => {
  const { h, u } = field({ row: 10, col: 5, dir: 'RIGHT' });
  castS3(h, u, [10, 7]);
  const e = h.b.spawnEnemy(DUMMY, { pos: [9, 6], routeIndex: 0 });

  // 逐 tick 采样波的方向：方向变化 = 新的一段直行开始（模块就在这一刻清空命中表）
  let runs = 1;                    // 起手那一段
  let prevDir = null;
  const perSecHits = [];
  const perSecRuns = [];
  let hits0 = 0;
  let runs0 = 1;
  let minHp = e.hp;
  for (let s = 0; s < 30; s++) {
    h.run(1);
    const w = u.mem.chen3Wave;
    if (w) {
      const dir = `${w.dr},${w.dc}`;
      if (prevDir !== null && dir !== prevDir) runs++;
      prevDir = dir;
    }
    const n = waveHitsOn(h, u, e).length;
    perSecHits.push(n - hits0);
    perSecRuns.push(runs - runs0);
    hits0 = n;
    runs0 = runs;
    if (e.hp < minHp) minHp = e.hp;
  }

  const hits = waveHitsOn(h, u, e).length;
  // 「同一段直行对同一目标最多结算一次」⇒ 总命中数不可能超过直行段数
  assert.ok(hits <= runs, `命中 ${hits} 次 ≤ 直行 ${runs} 段`);
  // 每秒同理（第 1 秒带上起手那一段，所以 +1）
  for (let s = 0; s < 30; s++) {
    assert.ok(perSecHits[s] <= perSecRuns[s] + 1, `第 ${s + 1} 秒：命中 ${perSecHits[s]} 次 ≤ 直行 ${perSecRuns[s] + 1} 段`);
    assert.ok(perSecHits[s] <= 4, `第 ${s + 1} 秒最多 4 次（实际 ${perSecHits[s]}）`);
  }
  assert.ok(hits >= 1, 'premise: 波确实扫到过木桩');
  assert.equal(e.alive, true, '30 秒后木桩还活着');
  assert.equal(h.hooksOf('death').filter((c) => c.unit === e).length, 0, '一次都没死');
  assert.equal(e.hp, e.s.maxHp, '血量回到满（自愈照旧 20 亿/s）');
  assert.ok(minHp > e.s.maxHp * 0.9, `血量最多掉到 ${(minHp / e.s.maxHp * 100).toFixed(2)}%（自愈追得上）`);
  checkInvariants(h.b);
});

// =====================================================================================================================
// 3. 锁血：同一 tick 多次致死也挡得住

test('木桩锁血：同一 tick 里连续 30 次致死伤害只把 HP 按在 1，木桩不死', () => {
  const { h, u } = field();
  const e = h.b.spawnEnemy(DUMMY, { pos: [10, 8], routeIndex: 0 });
  // 3 倍血池一发
  h.b.dealDamage(u, e, { amount: e.s.maxHp * 3, type: 'arts', canDodge: false });
  assert.equal(e.alive, true, '3 倍血池也打不死');
  assert.equal(e.hp, 1, '引擎把 HP 抬到 1');
  // 同一个 tick 里再连打 30 次致死
  for (let i = 0; i < 30; i++) h.b.dealDamage(u, e, { amount: e.s.maxHp, type: 'arts', canDodge: false });
  assert.equal(e.alive, true, '同一 tick 的 30 次致死全部被挡');
  assert.equal(e.hp, 1, '仍然是 1 血');
  assert.equal(h.hooksOf('death').filter((c) => c.unit === e).length, 0, '0 次死亡');
  // 逐 tick 再连打 30 发致死（跨越 tick 边界）
  for (let t = 0; t < 30; t++) {
    h.b.dealDamage(u, e, { amount: e.s.maxHp * 2, type: 'arts', canDodge: false });
    h.step();
    assert.equal(e.alive, true, `第 ${t + 1} 个 tick 之后还活着`);
  }
  h.run(2);
  assert.equal(e.hp, e.s.maxHp, '自愈把它拉回满血');
  checkInvariants(h.b);
});

test('木桩锁血不影响读数：一发 3 倍血池的「造成伤害」仍然是这一发打掉的血量', () => {
  const { h, u } = field();
  const e = h.b.spawnEnemy(DUMMY, { pos: [10, 8], routeIndex: 0 });
  const before = e.hp;
  const dealt = h.b.dealDamage(u, e, { amount: e.s.maxHp * 3, type: 'arts', canDodge: false });
  // 锁血只留下最后 1 点，所以记账就是「打掉的那些」而不是 0（否则量具读不出输出）。
  // 读数上限是目标当时剩下的血 —— 一发 3 倍血池也只能记下整整一个血池。
  assert.equal(dealt, before - 1, '读数 = 打掉的血量');
  assert.ok(dealt > e.s.maxHp * 0.99, `读数接近一整个血池（${dealt}）`);
  checkInvariants(h.b);
});

// =====================================================================================================================
// 4. 最坏情形：波钉在死角连打 30 秒

test('最坏情形：龙剑气钉在死角对木桩连打 30 秒，木桩不死、0 次 death、最后满血', () => {
  const { h, u } = field();
  castS3(h, u, [10, 7]);
  const e = h.b.spawnEnemy(DUMMY, { pos: [9, 2], routeIndex: 0 });
  const w = plantWaveInDeadCorner(u);
  let minHp = e.hp;
  for (let s = 0; s < 30; s++) {
    h.run(1);
    if (e.hp < minHp) minHp = e.hp;
    assert.equal(e.alive, true, `第 ${s + 1} 秒木桩还活着`);
  }
  assert.deepEqual([w.x, w.y], [DEAD_CORNER.x, DEAD_CORNER.y], '波整场都被卡在那里');
  assert.equal(h.hooksOf('death').filter((c) => c.unit === e).length, 0, '0 次死亡');
  assert.equal(e.hp, e.s.maxHp, '30 秒后满血');
  assert.ok(minHp > e.s.maxHp * 0.9, `整场最低血量 ${(minHp / e.s.maxHp * 100).toFixed(2)}%`);
  checkInvariants(h.b);
});
