// test/sim/hex-stone-deathdance.test.js — 第二十四批（业主 2026-10-31）：3 阶普通卡【死亡之舞】
// hex_deathdance 的战斗半边（server/sim/content/hexcards/stone_deathdance.js installDeathDance）。
//
// 驱动方式与 hex-stone-kjerag-frostdeath.test.js 一致：真实 sim Battle（test/helpers/battleHarness.js 的
// makeBattle / chessRec / enemyRec）+ 生产用的 `hexHooks(battle)` 手工安装，effect ref 按 server/match/hextech.js
// `addHexRef` 的形状手搓（`{ id:'hex:<id>', key:'hex:<id>', params:{ ...effect, hexId, rarity }, data:{…} }`），
// 所以本套件不依赖 content/hextech.js 的接线是否已经落地。`content: 'generic'` 让 installContent 不跑
// content/hextech.js 的 `install()`、也不装盟约内容，于是这些数字只可能来自被测模块。
//
// 覆盖（设计稿 §3.1 的每条关键路径，一条一个 test）：
//   无卡 ⇒ 伤害立即扣；有卡一次 300 伤害 ⇒ 立即 0、3 秒 6 跳每跳 50 扣完；可致死；护盾先挡（只延迟超出部分）；
//   同一 tick 的多份伤害各排各的、一条都不丢；周围八格有敌人死亡 ⇒ 回复 5% 最大生命（八格外 / 别人的干员 / 漏怪
//   都不回）；只对拥有者自己的干员生效；参数读卡面（delaySec / tickSec / healPct）。
//
// [ASSUMED]（模块头注释里有完整口径，这里是测试侧的断言口径）：
//   1. 一份伤害一条队列条目、各自按自己的 3 秒摊完（同一 tick 的两份各扣各的）。
//   2. 第一跳在收到伤害 tickSec 之后（全局脉冲只在到点时扣），所以 6 跳正好铺满 3 秒。
//   3. 延迟伤害走流失通道：不重入 hpDamage，但可致死、击杀归属照原 source。
//   4. 「周围八格」= 敌人格与干员格的切比雪夫距离 ≤ 1（斜角算相邻）。
//   5. 回血是自我治疗（吃治疗加成 / 上限截断），漏怪（reason 'leak'）不算死亡。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { hexHooks } from '../../server/sim/content/hexcards/hooks.js';
import { installDeathDance } from '../../server/sim/content/hexcards/stone_deathdance.js';
import { makeDamageInfo } from '../../server/sim/damage.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HEXTECH = JSON.parse(readFileSync(path.join(ROOT, 'data', 'hextech.json'), 'utf8'));

/** 设计稿 §2 的参数（卡面 effect 就是这一份；模块只读卡面）。 */
const DD = Object.freeze({ delaySec: 3, tickSec: 0.5, healPct: 5 });

const CARD = 'hex_deathdance';
const SPEC = 'deathDance';

/**
 * One playerEffects entry, the shape server/match/hextech.js addHexRef writes. `effect` overrides the design values
 * (a card whose record carries different numbers — the module must read them).
 */
function refOf(hexId, key, effect, rarity = 'prismatic') {
  const rec = HEXTECH.playerHexes[hexId];
  return {
    id: `hex:${hexId}`, key: `hex:${hexId}`,
    name: (rec && rec.name) || hexId, desc: (rec && rec.desc) || '', iconKind: 'hex', iconId: hexId,
    counter: null, battle: true,
    params: { [key]: { ...effect }, hexId, rarity: (rec && rec.rarity) || rarity },
    data: { hexId, rarity: (rec && rec.rarity) || rarity },
  };
}

/**
 * 一名普通干员：2000 生命、0 防御 0 法抗（伤害公式不参与，数字干净）、0 攻击（不会顺手打死木桩）、
 * 攻击范围只有脚下这一格（站在旁边的敌人不会被顺手打）。
 */
const op = (id, o = {}) => chessRec({
  id,
  stats: { maxHp: 2000, atk: 0, def: 0, res: 0, blockCnt: 1, respawnTime: 20 },
  rangeGrid: [[0, 0]],
  ...o,
});

/** 一个血厚、不动、不还手的敌人。 */
const dummy = () => enemyRec({ key: 'enemy_dummy', hp: 1000000, atk: 0, def: 0, speed: 0 });

/** 测试用的数据表。 */
function defsOf() {
  return {
    chess: { test_op1: op('test_op1'), test_op2: op('test_op2'), test_op3: op('test_op3'), test_op4: op('test_op4') },
    enemies: { enemy_dummy: dummy() },
  };
}

/** 一个席位（多玩家场：seat 1 落在 +8 列外）。 */
const seat = (playerId, i, { effects = [], units = [], bonds = {} } = {}) => ({
  playerId, seat: i, side: 'L', colOffset: i === 0 ? 0 : 8, bonds, playerEffects: effects, units,
});
/** 棋盘上的一枚棋子。 */
const at = (uid, row, col, chessId) => ({ uid, kind: 'chess', chessId, row, col });

/** 一个安静的测试场（不自动结束；捕获我们关心的钩子）。 */
function field(players, { kind = 'normal', enemies = [{ key: 'enemy_dummy', time: 0, route: 0 }] } = {}) {
  return makeBattle({
    kind,
    content: 'generic',
    defs: defsOf(),
    players,
    enemies,
    autoFinish: false,
    timeLimit: 60,
    captureNoisy: true,
    hooks: ['hpDamage', 'damaged', 'death', 'kill', 'battleStart', 'deploy'],
  });
}

/** 带卡的一个席位（effects 默认就是设计稿那组参数）。 */
const seatWithCard = (units, { effect = DD, playerId = 'p1', seatIndex = 0 } = {}) =>
  seat(playerId, seatIndex, { effects: [refOf(CARD, SPEC, effect)], units });

/** 场上（活着 / 已部署 / 未隐匿）的干员，按 uid 排序（断言顺序稳定）。 */
const opsOnField = (h, pid = 'p1') => h.battle.allyUnits
  .filter((u) => u && u.kind === 'op' && u.side === 'ally' && u.ownerId === pid && u.alive && u.deployed && !u.hidden)
  .sort((a, b) => a.uid - b.uid);
/** 场上的敌人。 */
const foes = (h) => h.battle.enemies.filter((e) => e && e.alive);
/** 浮点比较（生命值是 double 累加出来的）。 */
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}（实际 ${a}，期望 ${b}）`);

/** 一发真实伤害（0 防御 / 0 法抗，最终伤害 = amount，最干净的断言口径）。 */
const hitFor = (h, target, amount, over = {}) =>
  h.battle.dealDamage(null, target, makeDamageInfo({ amount, type: 'true', canDodge: false, ...over }));

// =====================================================================================================================
// 没有卡 / 延迟

test('死亡之舞: 没有这张卡 ⇒ install 返回 0，伤害立即扣', () => {
  const h = field([seat('p1', 0, { effects: [], units: [at(1, 10, 6, 'test_op1')] })]);
  const inst = installDeathDance(hexHooks(h.battle));
  assert.equal(inst, 0, '没有卡 ⇒ install 返回 0');
  h.run(1);
  const [u] = opsOnField(h);
  assert.equal(u.hp, 2000, 'premise: 满血');
  hitFor(h, u, 300);
  assert.equal(u.hp, 1700, '没有卡 ⇒ 立即扣 300');
  h.invariants();
});

test('死亡之舞: 一次 300 伤害 ⇒ 立即一点不掉，3 秒 6 跳每跳 50 扣完', () => {
  const h = field([seatWithCard([at(1, 10, 6, 'test_op1')])]);
  const inst = installDeathDance(hexHooks(h.battle));
  assert.equal(inst, 1, '安装覆盖面 = 1 名干员');
  h.run(1);                                          // t = 1.0
  const [u] = opsOnField(h);
  assert.equal(u.hp, 2000);

  hitFor(h, u, 300);
  assert.equal(u.hp, 2000, '立即不掉血：这一份被压进待扣队列');
  const applied = h.hooksOf('hpDamage').filter((c) => c && c.target === u);
  assert.equal(applied.length, 1, '伤害走了 hpDamage 钩子');

  h.run(0.4);                                        // t = 1.4：还没到第一跳（收到伤害 0.5 秒后）
  assert.equal(u.hp, 2000, '第一跳在收到伤害 0.5 秒之后');

  h.run(0.2);                                        // t = 1.6：第一跳（t=1.5）
  near(u.hp, 1950, '第一跳扣 300 / 6 = 50');

  h.run(2.5);                                        // t = 4.1：六跳（1.5 / 2.0 / 2.5 / 3.0 / 3.5 / 4.0）走完
  near(u.hp, 1700, '3 秒内 6 跳扣完 300');

  h.run(1);                                          // 之后不再扣
  near(u.hp, 1700, '扣完就停');
  h.invariants();
});

test('死亡之舞: 延迟伤害可致死（6 跳里的第 4 跳把 2000 血扣到 0）', () => {
  const h = field([seatWithCard([at(1, 10, 6, 'test_op1')])]);
  installDeathDance(hexHooks(h.battle));
  h.run(1);
  const [u] = opsOnField(h);
  hitFor(h, u, 3000);                                // 3000 / 6 = 每跳 500
  assert.equal(u.hp, 2000, '立即不掉血');

  h.run(1.1);                                        // t = 2.1：两跳（1.5 / 2.0）⇒ −1000
  near(u.hp, 1000);
  assert.equal(u.alive, true);

  h.run(1);                                          // t = 3.1：第三、四跳（2.5 / 3.0）⇒ 0
  assert.equal(u.alive, false, '第 4 跳把血扣光 ⇒ 阵亡');
  assert.equal(u.hp, 0);
  assert.equal(u.removeReason, 'killed');
  const deaths = h.hooksOf('death').filter((c) => c && c.unit === u);
  assert.equal(deaths.length, 1, '走的是正常阵亡');
  assert.equal(deaths[0].reason, 'killed');

  h.run(2);                                          // 队列已经丢掉，不再对倒下的干员扣血
  assert.equal(u.hp, 0);
  h.invariants();
});

test('死亡之舞: 护盾先挡，只延迟超出护盾的那一部分', () => {
  const h = field([seatWithCard([at(1, 10, 6, 'test_op1')])]);
  installDeathDance(hexHooks(h.battle));
  h.run(1);
  const [u] = opsOnField(h);
  h.battle.addBuff(u, { key: 'test:shield', shield: 100, tags: ['test'] });
  assert.equal(u.s.shield, 100, 'premise: 100 点护盾');

  hitFor(h, u, 300);
  assert.equal(u.hp, 2000, '立即不掉血');
  assert.equal(u.s.shield, 0, '护盾先把 100 挡掉了');
  // 只延迟了超出护盾的 200：第一跳 = 200 / 6（harness 捕获的 ctx 是模块改完之后的样子，所以这里看生命值）
  h.run(0.6);                                        // t = 1.6：第一跳（1.5）
  near(u.hp, 2000 - 200 / 6, '队列里只有 200');

  h.run(2.5);                                        // t = 4.1：六跳走完
  near(u.hp, 1800, '只扣了 200（护盾挡掉的 100 不延迟）');
  h.invariants();
});

test('死亡之舞: 同一 tick 的多份伤害各排各的，一条都不丢（300 + 200）', () => {
  const h = field([seatWithCard([at(1, 10, 6, 'test_op1')])]);
  installDeathDance(hexHooks(h.battle));
  h.run(1);
  const [u] = opsOnField(h);
  hitFor(h, u, 300);
  hitFor(h, u, 200);
  assert.equal(u.hp, 2000, '两份都压进队列了');

  h.run(0.6);                                        // t = 1.6：第一跳（两份各扣自己那一份）
  near(u.hp, 2000 - 50 - 200 / 6, '300/6 + 200/6 同一跳各扣各的');

  h.run(2.5);                                        // t = 4.1：六跳走完
  near(u.hp, 1500, '两份都扣完：300 + 200');
  h.invariants();
});

test('死亡之舞: 只延迟拥有者自己的干员 —— 别人的干员照常立即扣血', () => {
  const h = field([
    seatWithCard([at(1, 10, 6, 'test_op1')]),
    seat('p2', 1, { units: [at(2, 9, 6, 'test_op2')] }),
  ], { kind: 'unite' });
  installDeathDance(hexHooks(h.battle));
  h.run(1);
  const mine = opsOnField(h, 'p1')[0];
  const theirs = opsOnField(h, 'p2')[0];

  hitFor(h, mine, 300);
  hitFor(h, theirs, 300);
  assert.equal(mine.hp, 2000, '自己的干员：延迟');
  assert.equal(theirs.hp, 1700, '别人的干员：立即扣');

  h.run(3.1);
  near(mine.hp, 1700, '自己的那份 3 秒后扣完');
  assert.equal(theirs.hp, 1700, '别人的没被二次扣');
  h.invariants();
});

// =====================================================================================================================
// 周围八格有敌人死亡 ⇒ 回复 5% 最大生命

test('死亡之舞: 敌人死在干员周围八格内 ⇒ 该干员回复 5% 最大生命（八格外 / 别人的干员不回）', () => {
  const h = field([
    seatWithCard([at(1, 10, 6, 'test_op1'), at(2, 10, 4, 'test_op2'), at(3, 11, 8, 'test_op3')]),
    seat('p2', 1, { units: [at(4, 9, 0, 'test_op4')] }),      // 场上坐标 (9, 8)
  ], { kind: 'unite', enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [10, 7] }] });
  installDeathDance(hexHooks(h.battle));
  h.run(1);
  const [adjacent, far, diagonal] = opsOnField(h, 'p1');
  const theirs = opsOnField(h, 'p2')[0];
  const foe = foes(h)[0];
  assert.deepEqual([foe.y, foe.x], [10, 7], 'premise: 敌人站在 (10,7)');
  assert.deepEqual([adjacent.tileR, adjacent.tileC], [10, 6], 'premise: 正相邻');
  assert.deepEqual([far.tileR, far.tileC], [10, 4], 'premise: 隔 3 格');
  assert.deepEqual([diagonal.tileR, diagonal.tileC], [11, 8], 'premise: 斜角相邻');
  assert.deepEqual([theirs.tileR, theirs.tileC], [9, 8], 'premise: 别人的干员也斜角相邻');

  // 四名干员都掉到一半血，好看出回血量
  for (const u of [adjacent, far, diagonal, theirs]) u.hp = 1000;

  h.battle.kill(foe);                                // 敌人被击杀（reason 'killed'）
  near(adjacent.hp, 1100, '正相邻：回复 5% × 2000 = 100');
  near(diagonal.hp, 1100, '斜角也算「周围八格」');
  near(far.hp, 1000, '隔 3 格不回');
  near(theirs.hp, 1000, '别人的干员不回');
  h.invariants();
});

test('死亡之舞: 漏怪（reason 不是 killed）不算「敌人死亡」，不回血', () => {
  const h = field([seatWithCard([at(1, 10, 6, 'test_op1')])],
    { enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [10, 7] }] });
  installDeathDance(hexHooks(h.battle));
  h.run(1);
  const [u] = opsOnField(h);
  const foe = foes(h)[0];
  u.hp = 1000;
  h.battle.leak(foe);                                // 漏怪：_remove(e, 'leak')
  assert.equal(foe.alive, false, 'premise: 敌人离场了');
  near(u.hp, 1000, '漏怪不回血');

  // 对照组：真的击杀会回血
  const foe2 = h.spawn('enemy_dummy', { pos: [10, 7] });
  h.battle.kill(foe2);
  near(u.hp, 1100, '击杀才回血');
  h.invariants();
});

test('死亡之舞: 回血吃治疗上限截断（满血时不会溢出）', () => {
  const h = field([seatWithCard([at(1, 10, 6, 'test_op1')])],
    { enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [10, 7] }] });
  installDeathDance(hexHooks(h.battle));
  h.run(1);
  const [u] = opsOnField(h);
  u.hp = 1950;
  h.battle.kill(foes(h)[0]);
  assert.equal(u.hp, 2000, '1950 + 100 截到上限 2000');
  h.invariants();
});

// =====================================================================================================================
// 参数读卡面

test('死亡之舞: 数字读卡面 —— delaySec 1 / tickSec 0.25 / healPct 10 全都跟着变', () => {
  const effect = { delaySec: 1, tickSec: 0.25, healPct: 10 };
  const h = field([seatWithCard([at(1, 10, 6, 'test_op1')], { effect })],
    { enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [10, 7] }] });
  installDeathDance(hexHooks(h.battle));
  h.run(1);
  const [u] = opsOnField(h);

  hitFor(h, u, 300);
  assert.equal(u.hp, 2000, '立即不掉血');
  h.run(0.2);                                        // t = 1.2：还没到 0.25 秒后的第一跳
  assert.equal(u.hp, 2000);
  h.run(0.1);                                        // t = 1.3：第一跳（1.25）
  near(u.hp, 1925, '4 跳 × 75');
  h.run(0.8);                                        // t = 2.1：1.25 / 1.5 / 1.75 / 2.0 四跳走完
  near(u.hp, 1700, 'delaySec 1 ⇒ 4 跳，总共 300');

  // healPct 10 ⇒ 回 200
  u.hp = 1000;
  h.battle.kill(foes(h)[0]);
  near(u.hp, 1200, 'healPct 10 ⇒ 回复 10% × 2000 = 200');
  h.invariants();
});
