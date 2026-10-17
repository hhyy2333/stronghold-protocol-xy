// test/match/unite-squad-relay.test.js — 100 座变体的分队兜底（业主 2026-10-16 的设计缺口修复）。
//
// 缺口：「有漏怪但**本队没人完美**」的那一队，以前在 planUniteBySquad 里被 `continue` 直接跳过 —— 它既不开阶段 1 的
// 战场（对：没人能当帮手），也就**不进 plans**；而阶段 2 的输入正是阶段 1 跑过的那些计划（unitePhase._afterUniteRound
// 的 phase1 来自 plans），于是它的漏怪成了盲区：另一队就算全员完美满编也帮不上忙，直接各扣各的 LP。
//
// 修法：这类队仍然产出一个计划（`helpers: []`、`noHelper: true`），unhandled 直接等于它自己的全部漏怪 ——
// 它不上场，但会被 planRelayBySquad 看见，于是阶段 2 能把漏怪交给另一队。
// 这些是纯函数（unite100.mjs），不需要真对局。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planUniteBySquad, canRelay, takeUnhandled, planRelayBySquad, relayPlanFor, squadIndexOf } from '../../server/match/unite100.mjs';
import { DATA } from './harness.js';

const UNITE = DATA.config.unite;

/** 一个 8 人（2 队）的假 match + 每人的战果。`leakBySeat[seat] = 漏了几个`（0 = 完美）。 */
function match8(leakBySeat) {
  const order = Array.from({ length: 8 }, (_, i) => ({
    playerId: `p_${i}`, seat: i, alive: true, isBot: false, name: `P${i}`, bounties: [], board: new Map(), effects: [],
  }));
  const m = {
    isSolo: false, order, players: new Map(order.map((p) => [p.playerId, p])), seatCap: 20,
    alivePlayers: () => order.filter((p) => p.alive),
    gd: { enemy: (k) => (k ? {} : null), unite: UNITE },
  };
  const results = new Map();
  for (const p of order) {
    const n = leakBySeat[p.seat] || 0;
    results.set(p.playerId, n > 0
      ? { leaked: Array.from({ length: n }, (_, i) => ({ enemyKey: `e${i}`, lpr: 1, counted: true, sourcePlayerId: p.playerId })), perfect: false, unitsEnd: [{ defId: 'chess_x', alive: true }] }
      : { leaked: [], perfect: true, unitsEnd: [{ defId: 'chess_x', alive: true }] });
  }
  return { m, results };
}

/** _afterUniteRound 里 phase1 的那一段（noHelper 直接用自己的漏怪当 unhandled）。 */
function phase1Of(m, plans) {
  return plans.map((p) => {
    if (p.noHelper) {
      const leaked = (p.leaked || []).filter((l) => canRelay(m.gd, l)).map((l) => ({ ...l, squad: p.squad }));
      return {
        plan: p, result: null,
        unhandled: { plan: { squad: p.squad, helpers: [], leakers: p.leakers, leaked, notReentered: new Map() }, relayable: leaked.length, settled: p.leaked.length - leaked.length, leakers: p.leakers.map((x) => x.playerId) },
      };
    }
    return { plan: p, result: null, unhandled: takeUnhandled(m.gd, p, null) };
  });
}

test('8 人 = 2 队，每队 4 座（seat 0–3 / 4–7）', () => {
  assert.equal(squadIndexOf(0), 0);
  assert.equal(squadIndexOf(3), 0);
  assert.equal(squadIndexOf(4), 1);
  assert.equal(squadIndexOf(7), 1);
});

test('队内兜底：3 漏 1 完美 → 那一队的完美成员上场（helpers 非空、不标 noHelper）', () => {
  const { m, results } = match8({ 0: 1, 1: 1, 2: 1 });
  const plans = planUniteBySquad(m, results);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].squad, 0);
  assert.ok(plans[0].helpers.length > 0, '有帮手');
  assert.equal(plans[0].noHelper, false);
  assert.equal(plans[0].leaked.length, 3);
});

test('设计缺口修复：本队全漏（没人完美）时，漏怪交给另一队去兜（阶段 2），而不是直接各扣各的', () => {
  // 前 4 人（第 1 队）全漏、后 4 人（第 2 队）全完美。
  const { m, results } = match8({ 0: 1, 1: 1, 2: 1, 3: 1 });
  const plans = planUniteBySquad(m, results);
  assert.equal(plans.length, 1, '全漏的那一队仍然产出一个计划（修复前是 0）');
  const p0 = plans.find((p) => p.squad === 0);
  assert.ok(p0, '第 1 队的计划在');
  assert.equal(p0.noHelper, true, '标了 noHelper（没人能上场）');
  assert.equal(p0.helpers.length, 0, '没有帮手');
  assert.equal(p0.leaked.length, 4, '它的 4 个漏怪都在');
  const phase1 = phase1Of(m, plans);
  assert.equal(phase1[0].unhandled.relayable, 4, '全部 4 个漏怪都是「待接力」的');
  const relays = planRelayBySquad(m, phase1, results);
  assert.equal(relays.length, 1, '阶段 2 接到了这一棒');
  assert.equal(relays[0].from, 0, '从第 1 队传出');
  assert.equal(relays[0].to, 1, '交给状态更好的第 2 队');
  assert.equal(relays[0].plan.leaked.length, 4, '4 个漏怪都传给接收队');
  assert.deepEqual([...new Set(relays[0].plan.leaked.map((l) => l.sourcePlayerId))].sort(), ['p_0', 'p_1', 'p_2', 'p_3'], '每个漏怪仍带原主的 sourcePlayerId（结算按它扣 LP，不扣接收队）');
});

test('两队各有一份计划：全漏的第 1 队（noHelper）与有完美的第 2 队并存', () => {
  // 第 1 队全漏；第 2 队只 p_4 漏、p_5/p_6/p_7 完美 ⇒ 第 2 队自己能开阶段 1 的战场。
  const { m, results } = match8({ 0: 1, 1: 1, 2: 1, 3: 1, 4: 1 });
  const plans = planUniteBySquad(m, results);
  assert.equal(plans.length, 2, '两队各有一份计划');
  const p0 = plans.find((p) => p.squad === 0);
  const p1 = plans.find((p) => p.squad === 1);
  assert.equal(p0.noHelper, true, '第 1 队没人完美');
  assert.equal(p1.noHelper, false, '第 2 队有完美成员');
  assert.ok(p1.helpers.length > 0, '第 2 队能上场');
  // 第 1 队的漏怪全部待接力；第 2 队要真打完自己的战场才知道拦住几个（result 为 null 时 relayable 自然是 0）
  const phase1 = phase1Of(m, plans);
  assert.equal(phase1.find((x) => x.plan.squad === 0).unhandled.relayable, 4, '第 1 队 4 个待接力');
  const relays = planRelayBySquad(m, phase1, results);
  assert.equal(relays.length, 1, '第 1 队的那一棒被接走');
  assert.equal(relays[0].from, 0);
});

test('没人完美的那一队不会被拉去开战场（helpers 空 ⇒ 上层过滤掉）', () => {
  const { m, results } = match8({ 0: 1, 1: 1, 2: 1, 3: 1 });
  const plans = planUniteBySquad(m, results);
  const fieldPlans = plans.filter((p) => Array.isArray(p.helpers) && p.helpers.length > 0);
  assert.equal(fieldPlans.length, 0, '没有任何队可以开阶段 1 的战场');
});

test('未知敌 key 的漏怪没有可接力形态：在 planUniteBySquad 里就落进 notReentered，一律不接力', () => {
  const { m, results } = match8({ 0: 1, 1: 1, 2: 1, 3: 1 });
  // 把第 1 队的漏怪换成 gd 不认识的 key（`gd.enemy` 只认 'e…'）
  m.gd.enemy = (k) => (String(k).startsWith('e') ? {} : null);
  for (const pid of ['p_0', 'p_1', 'p_2', 'p_3']) results.get(pid).leaked.forEach((l) => { l.enemyKey = 'unknown_x'; });
  const plans = planUniteBySquad(m, results);
  const p0 = plans.find((p) => p.squad === 0);
  assert.ok(p0, '计划仍在（漏怪只是没有可接力的形态）');
  assert.equal(p0.leaked.length, 0, '可接力的漏怪列表为空');
  assert.equal(p0.notReentered.get('p_0'), 1, '未知 key 记进 notReentered（结算直接扣）');
  const phase1 = phase1Of(m, plans);
  assert.equal(phase1.find((x) => x.plan.squad === 0).unhandled.relayable, 0, '没有可接力的');
  assert.equal(planRelayBySquad(m, phase1, results).length, 0, '不产生接力');
});

// ---------------------------------------------------------------------------------------------------
// 接手队的硬条件（业主 2026-10-16）：pickRelaySquad 只按「剩余实力」挑人，却没要求那队**有完美者能上场** ——
// 而那是 relayPlanFor 开战场的前提。于是选中一队全漏的队之后 relayPlanFor 返回 null、这一棒被
// _enterRelayBattlefield 静默丢掉，真正能兜的队从未被考虑。实测（3 队 12 人）：2 棒全丢，唯一有完美者的
// 那队只因「单位少 = 实力低」而落选。修法：能不能接手是**硬条件**，实力只是排序；判据与 relayPlanFor 共用
// 同一份 perfectMembersOf。
// ---------------------------------------------------------------------------------------------------

/** 12 人 = 3 队（seat 0–3 / 4–7 / 8–11）。`unitsBySeat` 决定每人的场上单位数 —— 也就是「实力」。 */
function match12(leakBySeat, unitsBySeat = {}) {
  const order = Array.from({ length: 12 }, (_, i) => ({
    playerId: `p_${i}`, seat: i, alive: true, isBot: false, name: `P${i}`, bounties: [], effects: [], layers: {},
    board: new Map(Array.from({ length: unitsBySeat[i] || 1 }, (_, k) => [`u${i}_${k}`, { uid: `u${i}_${k}`, kind: 'chess' }])),
  }));
  const m = {
    isSolo: false, order, players: new Map(order.map((p) => [p.playerId, p])), seatCap: 20,
    alivePlayers: () => order.filter((p) => p.alive),
    gd: { enemy: (k) => (k ? {} : null), unite: UNITE },
  };
  const results = new Map();
  for (const p of order) {
    const n = leakBySeat[p.seat] || 0;
    results.set(p.playerId, n > 0
      ? { leaked: Array.from({ length: n }, (_, i) => ({ enemyKey: `e${i}`, lpr: 1, counted: true, sourcePlayerId: p.playerId })), perfect: false, unitsEnd: [{ defId: 'chess_x', alive: true }] }
      : { leaked: [], perfect: true, unitsEnd: [{ defId: 'chess_x', alive: true }] });
  }
  return { m, results };
}

test('接手队必须有完美者：实力最高但全队都漏的队不会被选中', () => {
  // 队0 与队1 全漏；队2 全完美。给队1 最多的单位（实力最高），但它**没人能上场**。
  const { m, results } = match12(
    { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 },
    { 4: 9, 5: 9, 6: 9, 7: 9 },   // 队1 = 实力最高
  );
  const phase1 = phase1Of(m, planUniteBySquad(m, results));
  const relays = planRelayBySquad(m, phase1, results);
  assert.ok(relays.length > 0, '产生了接力');
  for (const r of relays) {
    assert.notEqual(r.to, 1, '实力最高但没完美者的队不许接手');
    assert.ok(relayPlanFor(m, r.to, r.plan, results), `接手的队 ${r.to} 必须真的能开战场`);
  }
  assert.ok(relays.every((r) => r.to === 2), '三个队里只有队2 有完美者 ⇒ 接力只能给它');
});

test('不会把一棒丢给「同样没人完美」的队：实测的两个全漏队互传场景', () => {
  // 队0 与队1 都全漏（都没有完美者）、队2 有完美者。改前两队互传（0→1、1→0）且两棒全丢。
  const { m, results } = match12({ 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 }, { 4: 9, 5: 9, 6: 9, 7: 9 });
  const phase1 = phase1Of(m, planUniteBySquad(m, results));
  const relays = planRelayBySquad(m, phase1, results);
  assert.equal(relays.length, 1, '一队每轮只能接一次 ⇒ 只有一个全漏队能递出去');
  const dropped = relays.filter((r) => !relayPlanFor(m, r.to, r.plan, results));
  assert.deepEqual(dropped, [], '没有一棒被丢给开不了战场的队');
});

test('没人能接手时返回 null（调用方据此直接结算），而不是给一个接不了的队', () => {
  // 全体全漏 ⇒ 没有任何队有完美者 ⇒ 无人可接。
  const { m, results } = match12(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i, 1])));
  const plans = planUniteBySquad(m, results);
  assert.equal(plans.length, 3, '三队各有一份计划');
  assert.ok(plans.every((p) => p.noHelper), '三队都没人完美');
  const phase1 = phase1Of(m, plans);
  assert.equal(planRelayBySquad(m, phase1, results).length, 0, '没有人能接手 ⇒ 不产生接力（调用方直接结算）');
});
