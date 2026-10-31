// test/match/hex-break-limit-unite.test.js — 【突破极限】`hex_break_limit` 在**联防**里也能叠层（业主 2026-11-01）。
//
// 口径（业主原文：「只有拥有这张卡的玩家在联防战斗里也能叠盟约层，其他人照旧不加」）：
//   * 卡面参数：`effect.bondCap = { cap: 9999, uniteLayers: true }`（数据由 Lead 生成；本测试在记录缺失时用手写的等价记录，
//     走的是同一条 `addHexRef` → `params.bondCap` 路径）。
//   * 联防 spec 整场仍然是 `layerGainsEnabled: false`（老 spec 逐字节不变），另给**每玩家**一份
//     `flags.layerGainsByPlayer = { [pid]: true }`，只点名拥有者；一个拥有者都没有时**不写这个键**
//     （server/match/match/unitePhase.js `_uniteOpts`）。
//   * 战斗内的闸门在 sim：`Battle.layerGainsOn(playerId)`（server/sim/battle/economy.js；`support.gainLayers` 走同一条），
//     没有那张表时 `layerGainsOn(pid) === !!flags.layerGainsEnabled` —— 与功能落地前完全等价。
//   * 结算（settle.js）只把**拥有者**那份联防层数入账（同一条 `layerGainRoom` + `bondLayerCapOf` 通道）；客户端结果校验
//     （fields.js）按每玩家放行/打回；客户端盟约条（public/js/battle/runner.js）按每玩家显示。

import test from 'node:test';
import assert from 'node:assert/strict';
import { PHASE, BOND_LAYER_CAP } from '../../shared/constants.js';
import { DATA, makeMatch, checkInvariants } from './harness.js';
import { FakeBattle } from './fakeBattle.js';
import { applyHex, BREAK_LIMIT_HEX_ID } from '../../server/match/hextech.js';
import { specBounds, validateClientResult } from '../../server/match/fields.js';
import { uniteLayerGainsOn, uniteLayerGainsByPlayer } from '../../server/match/match/unitePhase.js';
import { gainLayers } from '../../server/sim/content/support/index.js';
import { createBattleRunner } from '../../public/js/battle/runner.js';
import { createStore, initialState } from '../../public/js/store.js';
import * as specMod from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';
import { makeBattle } from '../helpers/battleHarness.js';

/** 真实卡面记录（Lead 已重建 data/hextech.json），缺失时手写一份等价记录。 */
const CARD = (DATA.hextech && DATA.hextech.playerHexes && DATA.hextech.playerHexes[BREAK_LIMIT_HEX_ID])
  || { id: BREAK_LIMIT_HEX_ID, name: '突破极限', desc: '联防战斗中也能获得盟约层数', rarity: 'prismatic', effect: { bondCap: { cap: 9999, uniteLayers: true } } };

/** 两张牌桌的联防输入：同一张盟约、同样的起始层数。 */
const unitePlayers = (layers = 10) => ['p1', 'p2'].map((pid, i) => ({
  playerId: pid, seat: i, side: 'L', colOffset: 0,
  bonds: { yanShip: { count: 3, active: true, tier: 1, layers } }, playerEffects: [], units: [],
}));

// ---- 1. sim 的每玩家闸门 ------------------------------------------------------------------------------------------------

test('sim: 联防战场里只有 flags.layerGainsByPlayer 点名的玩家能加层（整场仍是 false）', () => {
  const h = makeBattle({
    kind: 'unite', content: 'none', players: unitePlayers(), enemies: [],
    flags: { layerGainsEnabled: false, layerGainsByPlayer: { p1: true } },
  });
  h.step();
  assert.equal(h.b.flags.layerGainsEnabled, false, '整场仍然关着（老行为）');
  assert.equal(h.b.layerGainsOn('p1'), true, '拥有者：这一场对他是开的');
  assert.equal(h.b.layerGainsOn('p2'), false, '没卡的玩家：关着');
  assert.equal(h.b.addLayers('p1', 'yanShip', 5, 'test'), 5, '拥有者在联防里照常加层');
  assert.equal(h.b.addLayers('p2', 'yanShip', 5, 'test'), 0, '没卡的玩家加不了');
  // 特质那条主路径（support.gainLayers）走同一个闸门
  assert.equal(gainLayers(h.b, { playerId: 'p2', bonds: 'yanShip', n: 3, requireActive: false }), 0);
  assert.equal(gainLayers(h.b, { playerId: 'p1', bonds: 'yanShip', n: 3, requireActive: false }), 3);
  assert.equal(h.b.getPlayer('p1').bonds.yanShip.layers, 18, '10 + 5 + 3');
  assert.equal(h.b.getPlayer('p2').bonds.yanShip.layers, 10, '非拥有者的活层数没动');
  h.b.forceEnd('forced');
  const r = h.result();
  assert.deepEqual(r.perPlayer.p1.layerGains, { yanShip: 8 }, '战报里只有拥有者那份');
  assert.deepEqual(r.perPlayer.p2.layerGains, {}, '非拥有者一份都没有');
});

test('没有 layerGainsByPlayer 的 spec 与从前逐字节等价：整场 flag 说了算', () => {
  // 联防（整场 false，无表）⇒ 每玩家也是 false，与功能落地前一样
  const unite = makeBattle({ kind: 'unite', content: 'none', players: unitePlayers(), flags: { layerGainsEnabled: false }, enemies: [] });
  unite.step();
  for (const pid of ['p1', 'p2']) assert.equal(unite.b.layerGainsOn(pid), false, `${pid}: 无表 + 整场 false`);
  assert.equal(unite.b.addLayers('p1', 'yanShip', 5, 'test'), 0);
  assert.equal(gainLayers(unite.b, { playerId: 'p1', bonds: 'yanShip', n: 3, requireActive: false }), 0);
  // 普通战场（整场 true，无表）⇒ 每玩家 true，加层照旧
  const normal = makeBattle({ content: 'none', bonds: { yanShip: { count: 3, active: true, tier: 1, layers: 10 } } });
  normal.step();
  assert.equal(normal.b.layerGainsOn('p1'), true, '无表 + 整场 true');
  assert.equal(normal.b.addLayers('p1', 'yanShip', 5, 'test'), 5);
  // 表里点名 false 的玩家：哪怕整场 true 也不加（每玩家表的优先级）
  const off = makeBattle({
    content: 'none', bonds: { yanShip: { count: 3, active: true, tier: 1, layers: 10 } },
    flags: { layerGainsByPlayer: { p1: false } },
  });
  off.step();
  assert.equal(off.b.layerGainsOn('p1'), false);
  assert.equal(off.b.addLayers('p1', 'yanShip', 5, 'test'), 0);
});

// ---- 2. 卡面开关的读法 --------------------------------------------------------------------------------------------------

test('uniteLayerGainsOn / uniteLayerGainsByPlayer：读卡面 params.bondCap.uniteLayers，只点名拥有者', () => {
  const ref = (params, data) => ({ id: `hex:${BREAK_LIMIT_HEX_ID}`, key: `hex:${BREAK_LIMIT_HEX_ID}`, params, data });
  const on = { effects: [ref({ bondCap: { cap: 9999, uniteLayers: true } }, { hexId: BREAK_LIMIT_HEX_ID })] };
  const explicitOff = { effects: [ref({ bondCap: { cap: 9999, uniteLayers: false } }, { hexId: BREAK_LIMIT_HEX_ID })] };
  const legacy = { effects: [ref({ bondCap: { cap: 9999 } }, { hexId: BREAK_LIMIT_HEX_ID })] };
  const other = { effects: [{ id: 'hex:hex_somethingelse', key: 'hex:hex_somethingelse', params: { bondCap: { cap: 9999, uniteLayers: true } }, data: { hexId: 'hex_somethingelse' } }] };
  assert.equal(uniteLayerGainsOn(on), true);
  assert.equal(uniteLayerGainsOn(explicitOff), false, 'uniteLayers: false 明确关掉');
  assert.equal(uniteLayerGainsOn(legacy), true, '老 ref 没有这个字段：按拥有这张卡算 [ASSUMED]');
  assert.equal(uniteLayerGainsOn(other), false, '别的卡不算');
  assert.equal(uniteLayerGainsOn(null), false);
  assert.equal(uniteLayerGainsOn({ effects: [] }), false);
  // 只认 key 的 ref（存档 / 手写 / 策略「管理员」的复制件）
  assert.equal(uniteLayerGainsOn({ effects: [{ key: `hex:${BREAK_LIMIT_HEX_ID}`, params: { bondCap: { uniteLayers: true } } }] }), true);
  // 每玩家表：只有拥有者，一个都没有时 null（调用方据此不写这个键）
  assert.deepEqual(uniteLayerGainsByPlayer([{ playerId: 'p_0', ...on }, { playerId: 'p_1', ...other }]), { p_0: true });
  assert.equal(uniteLayerGainsByPlayer([{ playerId: 'p_1', ...other }]), null);
  assert.equal(uniteLayerGainsByPlayer([]), null);
});

// ---- 3. 联防 spec：每玩家开关只在真有拥有者时出现 ----------------------------------------------------------------------

const LEAK_SCRIPT = (b) => (b.round === 1 && b.kind === 'normal' ? { leaks: { p_2: 2 } } : {});

/** 打到联防（p_0 / p_1 完美、p_2 漏怪 ⇒ 两名帮手），返回这一轮联防战场的 FakeBattle。 */
function uniteField(seed, { withCard }) {
  const h = makeMatch({ mode: 'coop', humans: 3, seed, fake: true, script: LEAK_SCRIPT }).start();
  const m = h.m;
  if (withCard) applyHex(m, h.ps('p_0'), CARD);
  const first = FakeBattle.instances.length;
  h.toPrep(1);
  h.drive(() => m.phase === PHASE.UNITE || m.phase === PHASE.SETTLE);
  const u = FakeBattle.instances.slice(first).find((x) => x.kind === 'unite');
  assert.ok(u, '联防战场开出来了（前提）');
  return { h, m, u };
}

test('联防 spec：拥有者写进 flags.layerGainsByPlayer；一个拥有者都没有时这个键不存在（逐字节不变）', () => {
  const withCard = uniteField(95, { withCard: true });
  assert.deepEqual(withCard.u.opts.flags.layerGainsByPlayer, { p_0: true }, '只点名拥有者');
  assert.equal(withCard.u.opts.flags.layerGainsEnabled, false, '整场仍然 false');
  assert.equal(withCard.u.opts.flags.layerGainsEnabled, false, '整场仍然 false');

  const plain = uniteField(95, { withCard: false });
  const { layerGainsByPlayer: dropped, ...rest } = withCard.u.opts.flags;
  assert.deepEqual(dropped, { p_0: true }, '前提：有卡那一场只多这一个键');
  assert.equal('layerGainsByPlayer' in plain.u.opts.flags, false, '没有拥有者 ⇒ 不写这个键');
  assert.deepEqual(plain.u.opts.flags, rest, '除这个新键外逐字段相同（同 seed，其余标志一致）');
  assert.equal(JSON.stringify(plain.u.opts.flags), JSON.stringify(rest), '连键顺序都一样（老 spec 逐字节不变）');
  assert.equal(plain.u.opts.flags.layerGainsEnabled, false, '整场仍然 false');
  withCard.m.dispose();
  plain.m.dispose();
});

// ---- 4. 结算：只有拥有者那份入账 ----------------------------------------------------------------------------------------

test('结算：联防战报里拥有者的层数入账，非拥有者那份被丢弃（同一场、同一张盟约）', () => {
  const h = makeMatch({
    mode: 'coop', humans: 3, seed: 97, fake: true,
    script: (b) => (b.kind === 'unite'
      ? { layerGains: { p_0: { yanShip: 12 }, p_1: { yanShip: 12 } } }
      : LEAK_SCRIPT(b)),
  }).start();
  const m = h.m;
  const owner = h.ps('p_0');
  const other = h.ps('p_1');
  applyHex(m, owner, CARD);
  owner.layers.yanShip = 100;
  other.layers.yanShip = 100;
  owner.recompute();
  other.recompute();
  h.drive(() => m.phase === PHASE.PREP && m.round === 2);
  assert.equal(owner.layers.yanShip, 112, '拥有者：100 + 联防里叠的 12 层');
  assert.equal(other.layers.yanShip, 100, '非拥有者：战报里那 12 层被丢弃');
  checkInvariants(m);
  m.dispose();
});

test('结算：拥有者在联防里的层数仍受 9999 上限约束（不是无上限）', () => {
  const h = makeMatch({
    mode: 'coop', humans: 3, seed: 98, fake: true,
    script: (b) => (b.kind === 'unite' ? { layerGains: { p_0: { yanShip: 500 } } } : LEAK_SCRIPT(b)),
  }).start();
  const m = h.m;
  const owner = h.ps('p_0');
  applyHex(m, owner, CARD);
  owner.layers.yanShip = BOND_LAYER_CAP; // 999
  owner.recompute();
  h.drive(() => m.phase === PHASE.PREP && m.round === 2);
  assert.equal(owner.layers.yanShip, 1499, '999 + 500，仍然在 9999 之内');
  checkInvariants(m);
  m.dispose();
});

test('relay（阶段 1 + 阶段 2）：两段的联防层数都并回最终战果（combineUniteResults 会丢掉它们）', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 99, fake: true }).start();
  const m = h.m;
  let captured = null;
  m.settle = (plan, res) => { captured = res; };
  m._withForgiven = (plan) => plan;
  const plan = { helpers: [], leakers: [], leaked: [], notReentered: new Map() };
  m._phase1Settle = { plan, result: { perPlayer: { p_0: { layerGains: { yanShip: 5 } } } }, forgiven: new Map() };
  m._finishRelayRound(plan, { perPlayer: { p_0: { layerGains: { yanShip: 7 } } } });
  assert.ok(captured, 'settle 被调用（前提）');
  assert.deepEqual(captured.perPlayer.p_0.layerGains, { yanShip: 12 }, '阶段 1 的 5 + 阶段 2 的 7');
  m.dispose();
});

// ---- 5. 客户端结果校验：按玩家放行 / 打回 -------------------------------------------------------------------------------

test('客户端结果校验：联防里拥有者的层数被接受，非拥有者伪造的被打回', () => {
  const spec = {
    kind: 'unite', round: 5, timeLimit: 60, spawns: [],
    flags: { layerGainsEnabled: false, layerGainsByPlayer: { p_0: true } },
    players: [
      { playerId: 'p_0', seat: 0, side: 'L', colOffset: 0, units: [], bonds: { yanShip: { count: 3, active: true, tier: 1, layers: 100 } }, bondLayerCap: 9999 },
      { playerId: 'p_1', seat: 1, side: 'L', colOffset: 0, units: [], bonds: { yanShip: { count: 3, active: true, tier: 1, layers: 100 } } },
    ],
  };
  const raw = (gains) => ({
    reason: 'cleared', time: 10,
    perPlayer: Object.fromEntries(['p_0', 'p_1'].map((pid) => [pid, {
      killed: 0, total: 0, leaked: [], perfect: true, coins: 0, layerGains: gains[pid] || {}, unitsEnd: [], unitStats: [],
    }])),
  });
  const B = specBounds(spec, DATA);
  assert.equal(B.players.get('p_0').layerGainsOn, true, '拥有者：这一场对他开');
  assert.equal(B.players.get('p_1').layerGainsOn, false, '非拥有者：关');
  const ok = validateClientResult(spec, raw({ p_0: { yanShip: 12 } }), { gd: DATA });
  assert.equal(ok.ok, true, `拥有者的合法战报被接受（got ${JSON.stringify(ok)}）`);
  assert.equal(ok.result.perPlayer.p_0.layerGains.yanShip, 12);
  const bad = validateClientResult(spec, raw({ p_1: { yanShip: 12 } }), { gd: DATA });
  assert.equal(bad.ok, false, '非拥有者伪造的层数被打回');
  assert.equal(bad.reason, 'layers disabled');
  // 没有这张表的联防 spec（老形状）⇒ 谁都加不了，与从前一样
  const legacy = { ...spec, flags: { layerGainsEnabled: false } };
  assert.equal(specBounds(legacy, DATA).players.get('p_0').layerGainsOn, false);
  assert.equal(validateClientResult(legacy, raw({ p_0: { yanShip: 12 } }), { gd: DATA }).reason, 'layers disabled');
});

// ---- 6. 客户端盟约条：按玩家显示实时层数 --------------------------------------------------------------------------------

const DS = new DataSource(DATA, null);

/** A real b.start of a normal round-2 battle (client-side combat), then mutated into a 联防 spec. */
function realStart(seed = 7302) {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed, captureFrames: false, clientCombat: true, clients: false });
  h.autoHumans();
  h.m.start();
  h.run(() => h.m.phase === PHASE.COMBAT && h.m.round === 2, { maxSteps: 3e6 });
  const msg = h.lastTo('p_0', 'b.start');
  h.m.dispose();
  return JSON.parse(JSON.stringify(msg));
}

function rig() {
  let t = 1000;
  const frames = [];
  const handlers = new Map();
  const net = {
    on(type, fn) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); return () => handlers.get(type).delete(fn); },
    emit(type, msg) { for (const fn of handlers.get(type) || []) fn({ t: type, ...msg }); },
    send() { return true; },
    request() { return Promise.resolve({ t: 'ok' }); },
  };
  const store = createStore(initialState);
  const runner = createBattleRunner({
    net, store, doc: { hidden: false, addEventListener() {} }, now: () => t,
    raf: (fn) => { frames.push(fn); return frames.length; }, caf() {}, setInterval: () => 1, clearInterval() {},
    loadSim: async () => ({ spec: specMod, ds: DS }), logger: { error() {}, warn() {}, info() {}, debug() {} },
  });
  return {
    runner, net, store,
    advance(ms, step = 1000 / 60) { const end = t + ms; while (t < end) { t = Math.min(end, t + step); for (const fn of frames.splice(0)) fn(t); } },
    async settle() { for (let i = 0; i < 50; i++) { await new Promise((res) => setImmediate(res)); for (const fn of frames.splice(0)) fn(t); } },
  };
}

test('客户端盟约条：联防 spec 的每玩家开关让拥有者的层数显示出来，非拥有者的不显示', async () => {
  const start = realStart();
  start.kind = 'unite';
  start.fieldId = 'u';
  const sp = start.spec.players.find((p) => p.playerId === 'p_0');
  const [b1] = Object.keys(sp.bonds);
  assert.ok(b1, 'spec 带着盟约快照（前提）');
  sp.bonds[b1].layers = 10;
  const other = JSON.parse(JSON.stringify(sp));
  other.playerId = 'p_1';
  other.seat = 1;
  other.bonds[b1].layers = 10;
  start.spec.players.push(other);
  start.spec.flags = { ...(start.spec.flags || {}), layerGainsEnabled: false, layerGainsByPlayer: { p_0: true } };
  const r = rig();
  r.net.emit('b.start', start);
  await r.settle();
  const e = r.runner._entries.get(start.battleId);
  assert.ok(e, 'battle 建起来了（前提）');
  assert.equal(e.battle.flags.layerGainsEnabled, false);
  e.battle.addLayers('p_0', b1, 5, 'test');
  e.battle.addLayers('p_1', b1, 5, 'test');
  r.advance(40);
  assert.deepEqual(r.store.get().match.battle.bondLayers, { p_0: { [b1]: 15 } }, '只发布拥有者那份（10 + 5）');
});
