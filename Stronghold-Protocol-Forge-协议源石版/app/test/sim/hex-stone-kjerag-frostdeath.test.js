// test/sim/hex-stone-kjerag-frostdeath.test.js — 第二十一批（业主 2026-10-31）：谢拉格 ·【困毙之雪】
// hex_kjerag_frostdeath 的战斗半边（server/sim/content/hexcards/stone_kjerag_frostdeath.js
// installKjeragFrostDeath）。
//
// 驱动方式与 hex-stone-kjerag-laterano.test.js 一致：真实 sim Battle（test/helpers/battleHarness.js 的
// makeBattle / chessRec / enemyRec）+ 生产用的 `hexHooks(battle)` 手工安装，effect ref 按 server/match/hextech.js
// `addHexRef` 的形状手搓（`{ id:'hex:<id>', key:'hex:<id>', params:{ ...effect, hexId, rarity }, data:{…} }`），
// 所以本套件不依赖 content/hextech.js 的接线是否已经落地。`content: 'generic'` 让 installContent 不跑
// content/hextech.js 的 `install()`、也不装盟约内容（层数只当数据用），于是这些数字只可能来自被测模块。
//
// 覆盖（设计稿 §3 的每条关键路径，一条一个 test）：
//   没有卡 / N=2 不解锁；N=3 的冻结叠层与每层 defPct+5% / aspd−5；攻击施寒（层数 0 不掷骰、概率封顶 1）；
//   解冻未死 ⇒ 半径 1.5 内 +1（半径外不加、冻结中死亡不算）；无冻结敌人每 5s +1；
//   5 层进冰封（消耗清零、flags、阻挡 +1、免疫伤害、无法攻击 / 技能 / 治疗、冰封期间不叠层、5 秒后解除）；
//   冰封干员阻挡的敌人每秒 100+40L 真伤；N=6 死亡冻结全场 5s + 全体 −2 层；
//   N=6 全员冰封 ⇒ 15 秒每秒 100+50L 真伤 + 寒冷；参数读卡面。
//
// [ASSUMED]（模块头注释里有完整口径，这里是测试侧的断言口径）：
//   1. 每层霜寒是引擎的加算 mod（`add[k] += v × stacks`），所以 3 层 = 防御 ×1.15、攻速 −15 点。
//   2. 「攻击时施寒」的概率封顶 100%：默认卡 30%/层，4 层即 120% → 必定施寒（不依赖 seed）。
//   3. 「解冻未死」只在冻结真的结束时结算：冻结中被打死不算（敌人已离场）。
//   4. 本卡自己打出的真伤（冰封阻挡 / 全冰封脉冲）不再触发施寒（模块 [ASSUMED] 2）。
//   5. 6 名档的死亡判定把刚倒下的那名干员算进去（否则「第 6 名倒下」永远不触发）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { hexHooks } from '../../server/sim/content/hexcards/hooks.js';
import { installKjeragFrostDeath } from '../../server/sim/content/hexcards/stone_kjerag_frostdeath.js';
import { makeDamageInfo } from '../../server/sim/damage.js';
import { bondLayers } from '../../server/sim/content/support/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HEXTECH = JSON.parse(readFileSync(path.join(ROOT, 'data', 'hextech.json'), 'utf8'));

/** 设计稿 §2 的参数（卡面 effect 就是这一份；模块只读卡面）。 */
const FD = Object.freeze({
  unlockCount: 3, frostMax: 5, defPctPerStack: 5, aspdPerStack: 5, sealSec: 5,
  coldChancePerStack: 30, coldSec: 5, freezeEndRadius: 1.5, idleFrostSec: 5,
  sealedBlockDmg: 100, sealedBlockDmgPerLayer: 40,
  highCount: 6, deathFreezeSec: 5, deathRemoveStacks: 2,
  allSealedDmg: 100, allSealedDmgPerLayer: 50, allSealedSec: 15,
});

const CARD = 'hex_kjerag_frostdeath';
const SPEC = 'kjeragFrostDeath';
/** 霜寒 / 冰封的 buff 键（与模块一致）。 */
const FROST = 'hex:kjeragfrost:frost';
const SEAL = 'hex:kjeragfrost:seal';
/** 6 名档的档位。 */
const HIGH = 6;

/**
 * One playerEffects entry, the shape server/match/hextech.js addHexRef writes. `effect` overrides the design values
 * (a card whose record carries different numbers — the module must read them).
 */
function refOf(hexId, key, effect, rarity = 'gold') {
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
 * 谢拉格干员：0 攻击（整场安静，数字只来自被测模块自己打的那几发）、防御 200（5% 一层好算）、
 * 攻击范围只有脚下这一格（站在旁边的敌人不会被顺手打一下，从而不会顺手掷寒）。
 */
const kjOp = (id, o = {}) => chessRec({
  id, bonds: ['kjeragShip'],
  stats: { maxHp: 2000, atk: 0, def: 200, res: 0, blockCnt: 1, respawnTime: 20 },
  rangeGrid: [[0, 0]],
  ...o,
});

/** 不属于任何一个盟约的干员（证明「是不是谢拉格成员」才是判据）。 */
const plainOp = (id) => chessRec({
  id, bonds: [],
  stats: { maxHp: 2000, atk: 0, def: 200, res: 0, blockCnt: 1, respawnTime: 20 },
  rangeGrid: [[0, 0]],
});

/** 六名不同干员（`baseChessId` 各不相同 ⇒ 数「不同干员」时各算一个）。 */
const KJ_IDS = ['test_kj1', 'test_kj2', 'test_kj3', 'test_kj4', 'test_kj5', 'test_kj6'];

/** 一个血厚、不动、不还手的敌人：整场安静。 */
const dummy = () => enemyRec({ key: 'enemy_dummy', hp: 1000000, atk: 0, def: 0, speed: 0 });

/**
 * 一名「够得着但不阻挡」的谢拉格干员（射程 2 格、有攻击力）：用来验证冰封的「无法攻击」——
 * 敌人在两格外（不在阻挡半径里）时，冰封前会挨打、冰封后一发都挨不到。
 */
const kjOpReach = (id) => kjOp(id, {
  stats: { maxHp: 2000, atk: 500, def: 200, res: 0, blockCnt: 1, respawnTime: 20 },
  rangeGrid: [[0, 0], [0, 1], [0, 2]],
});

/** 测试用的数据表（六名谢拉格干员 + 一名远射程成员 + 一名非成员 + 木桩敌人）。 */
function defsOf() {
  const chess = {};
  for (const id of KJ_IDS) chess[id] = kjOp(id);
  chess.test_kj_reach = kjOpReach('test_kj_reach');
  chess.test_plain = plainOp('test_plain');
  return { chess, enemies: { enemy_dummy: dummy() } };
}

/** 盟约状态（战斗内加层的活数据：`bondLayers` 读 `layers`）。 */
const bondsOf = (o = {}) => ({ kjeragShip: { count: 2, active: true, tier: 1, layers: 0, ...(o.kjeragShip || {}) } });

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
    hooks: ['hit', 'statusApplied', 'death', 'kill', 'battleStart', 'deploy'],
  });
}

/** 带卡的一个席位 + 若干谢拉格干员（effects 默认就是设计稿那组参数）。 */
const seatWithCard = (units, { effect = FD, bonds = bondsOf(), playerId = 'p1', seatIndex = 0 } = {}) =>
  seat(playerId, seatIndex, { effects: [refOf(CARD, SPEC, effect)], units, bonds });

/** 场上（活着 / 已部署 / 未隐匿）的己方【谢拉格】干员，按 uid 排序（断言顺序稳定）。 */
const kjOnField = (h, pid = 'p1') => h.battle.allyUnits
  .filter((u) => u && u.kind === 'op' && u.side === 'ally' && u.ownerId === pid && u.alive && u.deployed && !u.hidden)
  .sort((a, b) => a.uid - b.uid);
/** 场上的敌人。 */
const foes = (h) => h.battle.enemies.filter((e) => e && e.alive);
/** 一名干员身上霜寒的层数（没有 buff ⇒ 0）。 */
const stacksOf = (u) => {
  const b = u.findBuff(FROST);
  return b ? b.stacks : 0;
};
/** 浮点比较（引擎的 def / aspd 是 double 累加出来的）。 */
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}（实际 ${a}，期望 ${b}）`);

/**
 * 让 `u` 叠 `n` 层霜寒：对同一名敌人连续 `reenter` 冻结 `n` 次（`entered` 强制为真 ⇒ 每次都算「冻结敌人」）。
 * 冻结时长取 `holdSec`（默认 30 = 整场冻着，避免解冻回层与「无冻结敌人」两条来源干扰断言）。
 */
const stackFrost = (h, u, foe, n, holdSec = 30) => {
  for (let i = 0; i < n; i++) h.battle.applyStatus(foe, 'freeze', { duration: holdSec, source: u, reenter: true });
};

// =====================================================================================================================
// 没有卡 / 未解锁

test('困毙之雪: 没有这张卡 ⇒ install 返回 0，冻结敌人不叠霜寒', () => {
  const h = field([seat('p1', 0, { effects: [], units: [at(1, 9, 4, 'test_kj1'), at(2, 10, 4, 'test_kj2'), at(3, 11, 4, 'test_kj3')], bonds: bondsOf() })]);
  const inst = installKjeragFrostDeath(hexHooks(h.battle));
  assert.equal(inst, 0, '没有卡 ⇒ install 返回 0');
  h.run(1);
  const u = kjOnField(h)[0];
  const foe = foes(h)[0];
  stackFrost(h, u, foe, 3);
  assert.equal(u.findBuff(FROST), null, '没有霜寒 buff');
  assert.equal(u.s.def, 200, '防御没有变化');
  assert.equal(u.s.aspd, 100, '攻速没有变化');
  h.invariants();
});

test('困毙之雪: 在场只有 2 名不同谢拉格干员 ⇒ 未解锁，冻结不叠霜寒、攻击不施寒', () => {
  const h = field([seatWithCard([at(1, 9, 4, 'test_kj1'), at(2, 10, 4, 'test_kj2')])]);
  const inst = installKjeragFrostDeath(hexHooks(h.battle));
  assert.equal(inst, 2, '安装覆盖面 = 2 名谢拉格干员');
  h.run(1);
  const [u] = kjOnField(h);
  const foe = foes(h)[0];
  stackFrost(h, u, foe, 3);
  assert.equal(u.findBuff(FROST), null, 'N=2 ⇒ 完全不解锁，一层都不叠');
  h.battle.removeStatus(foe, 'freeze');
  // 攻击也不施寒（就算硬塞一个层数进去也不该有）
  assert.equal(h.battle.dealDamage(u, foe, makeDamageInfo({ amount: 100, type: 'phys', canDodge: false, isAttack: true })), 100);
  assert.equal(foe.findBuff('cold'), null, '未解锁 ⇒ 攻击不施寒');
  h.invariants();
});

// =====================================================================================================================
// N ≥ 3：冻结叠层 / 每层面板

test('困毙之雪: N=3 时冻结敌人 ⇒ 该干员 +1 层霜寒，每层防御 +5%、攻速 −5', () => {
  const h = field([seatWithCard([at(1, 9, 4, 'test_kj1'), at(2, 10, 4, 'test_kj2'), at(3, 11, 4, 'test_kj3')])]);
  const inst = installKjeragFrostDeath(hexHooks(h.battle));
  assert.equal(inst, 3);
  h.run(1);
  const [u, other] = kjOnField(h);
  const foe = foes(h)[0];

  h.battle.applyStatus(foe, 'freeze', { duration: 30, source: u });
  const b1 = u.findBuff(FROST);
  assert.ok(b1, '获得霜寒');
  assert.equal(b1.stacks, 1, '1 层');
  near(u.s.def, 210, '200 × (1 + 5%)');
  near(u.s.aspd, 95, '100 − 5');

  // 第二层：同一名敌人再冻结一次（`entered` 为真才算「冻结敌人」）
  h.battle.applyStatus(foe, 'freeze', { duration: 30, source: u, reenter: true });
  assert.equal(stacksOf(u), 2);
  near(u.s.def, 220, '200 × (1 + 10%)');
  near(u.s.aspd, 90, '100 − 10');

  // 第三层：3 层 = 防御 +15% / 攻速 −15
  h.battle.applyStatus(foe, 'freeze', { duration: 30, source: u, reenter: true });
  assert.equal(stacksOf(u), 3);
  near(u.s.def, 230, '200 × (1 + 15%)');
  near(u.s.aspd, 85, '100 − 15');

  assert.equal(other.findBuff(FROST), null, '冻结是这名干员冻的，只有他叠层');
  const applied = h.hooksOf('statusApplied').filter((c) => c && c.status === 'freeze');
  assert.equal(applied.length, 3, '三次冻结都走了 statusApplied');
  h.invariants();
});

// =====================================================================================================================
// N ≥ 3：攻击施寒

test('困毙之雪: 层数为 0 时不掷骰、不施寒；4 层（30%×4 = 120% 封顶 100%）时必定施寒 5 秒', () => {
  // frostMax 调大，好让 4 层停在那儿不进冰封（其余参数仍是卡面默认）
  const effect = { ...FD, frostMax: 99 };
  const h = field([seatWithCard([at(1, 9, 4, 'test_kj1'), at(2, 10, 4, 'test_kj2'), at(3, 11, 4, 'test_kj3')], { effect })]);
  installKjeragFrostDeath(hexHooks(h.battle));
  h.run(1);
  const u = kjOnField(h)[0];
  const foe = foes(h)[0];
  const hit = () => h.battle.dealDamage(u, foe, makeDamageInfo({ amount: 100, type: 'phys', canDodge: false, isAttack: true }));

  assert.equal(stacksOf(u), 0);
  assert.equal(hit(), 100, 'premise: 普通一发 100');
  assert.equal(foe.findBuff('cold'), null, '0 层不施寒');

  stackFrost(h, u, foe, 4);
  assert.equal(stacksOf(u), 4, 'premise: 4 层');
  h.battle.removeStatus(foe, 'freeze');       // 清掉冻结，只看这一次攻击有没有施加寒冷
  assert.equal(foe.findBuff('freeze'), null);

  assert.equal(hit(), 100);
  const cold = foe.findBuff('cold');
  assert.ok(cold, '4 层 ⇒ 120% 封顶 100%，必定施加寒冷');
  near(cold.timeLeft, FD.coldSec, '寒冷持续 5 秒（coldSec 读卡面）');
  h.invariants();
});

test('困毙之雪: 本卡自己打出的真伤不再触发施寒（不会自己喂自己）', () => {
  const h = field([seatWithCard([at(1, 9, 4, 'test_kj1'), at(2, 10, 4, 'test_kj2'), at(3, 11, 4, 'test_kj3')], { effect: { ...FD, frostMax: 99 } })]);
  installKjeragFrostDeath(hexHooks(h.battle));
  h.run(1);
  const u = kjOnField(h)[0];
  const foe = foes(h)[0];
  stackFrost(h, u, foe, 4);
  h.battle.removeStatus(foe, 'freeze');
  // 带本卡 tag 的真伤：`hit` 钩子认得它，不掷寒
  h.battle.dealDamage(u, foe, makeDamageInfo({ amount: 100, type: 'true', canDodge: false, tags: ['hex', 'hex:kjeragfrost'] }));
  assert.equal(foe.findBuff('cold'), null, '本卡的真伤不施寒');
  h.invariants();
});

// =====================================================================================================================
// N ≥ 3：解冻回层 / 无冻结敌人每 5s 叠层

test('困毙之雪: 敌人冻结结束时未被击杀 ⇒ 半径 1.5 内所有谢拉格干员 +1 层（半径外不加，冻结中死亡不算）', () => {
  const h = field(
    [seatWithCard([at(1, 10, 6, 'test_kj1'), at(2, 10, 8, 'test_kj2'), at(3, 9, 4, 'test_kj3')])],
    { enemies: [
      { key: 'enemy_dummy', time: 0, route: 0, pos: [10, 9] },   // 离 kj2 一格（半径内），离 kj1 三格、kj3 五格
      { key: 'enemy_dummy', time: 0, route: 0, pos: [10, 7] },   // 冻结中被打死：不算「冻结结束」
    ] },
  );
  installKjeragFrostDeath(hexHooks(h.battle));
  h.run(1);
  const [far, nearOp] = [kjOnField(h)[0], kjOnField(h)[1]];
  const [thawing, doomed] = foes(h);
  assert.equal(kjOnField(h).length, 3, 'premise: 三名干员在场');
  near(Math.hypot(nearOp.x - thawing.x, nearOp.y - thawing.y), 1, 'premise: kj2 离解冻的敌人 1 格');

  h.battle.applyStatus(thawing, 'freeze', { duration: 0.5 });      // 无来源：不给任何干员叠层
  h.battle.applyStatus(doomed, 'freeze', { duration: 30 });        // 冻着的时候被打死
  h.battle.kill(doomed);
  assert.equal(doomed.alive, false, 'premise: 第二个敌人死了');

  h.run(1.5);                                                     // 到 t=2.5：冻结在 1.5 结束，轮询在下一拍补层
  assert.equal(stacksOf(nearOp), 1, '半径内的谢拉格干员 +1 层');
  assert.equal(stacksOf(far), 0, '半径外的干员不加');
  assert.equal(stacksOf(kjOnField(h)[2]), 0, '第三名也在半径外');
  h.invariants();
});

test('困毙之雪: 场上没有任何敌人处于冻结状态 ⇒ 每 5 秒所有在场谢拉格干员 +1 层', () => {
  const h = field([seatWithCard([at(1, 9, 4, 'test_kj1'), at(2, 10, 4, 'test_kj2'), at(3, 11, 4, 'test_kj3')])]);
  installKjeragFrostDeath(hexHooks(h.battle));
  h.run(4.5);
  for (const u of kjOnField(h)) assert.equal(stacksOf(u), 0, '还没到 5 秒');
  h.run(0.7);                                                     // t = 5.2
  for (const u of kjOnField(h)) {
    assert.equal(stacksOf(u), 1, 't=5s：每名在场谢拉格干员 +1 层');
    near(u.s.def, 210, '每层防御 +5%');
  }
  h.invariants();
});

test('困毙之雪: 场上有敌人被冻结时，5 秒的累积不触发', () => {
  const h = field([seatWithCard([at(1, 9, 4, 'test_kj1'), at(2, 10, 4, 'test_kj2'), at(3, 11, 4, 'test_kj3')])]);
  installKjeragFrostDeath(hexHooks(h.battle));
  h.run(1);
  const foe = foes(h)[0];
  const [u] = kjOnField(h);
  h.battle.applyStatus(foe, 'freeze', { duration: 30, source: u });   // 只有 u 叠了 1 层
  assert.equal(stacksOf(u), 1);
  h.run(4.5);                                                         // 跨过 t=5s 的累积点
  assert.equal(stacksOf(u), 1, '有敌人被冻结 ⇒ 不累积');
  for (const other of kjOnField(h).slice(1)) assert.equal(stacksOf(other), 0, '其他人一层都没有');
  h.invariants();
});

// =====================================================================================================================
// 冰封

test('困毙之雪: 5 层 ⇒ 消耗全部霜寒进入冰封（无法攻击 / 技能 / 治疗，阻挡 +1，免疫伤害）', () => {
  const h = field(
    [seatWithCard([at(1, 9, 4, 'test_kj_reach'), at(2, 10, 4, 'test_kj1'), at(3, 11, 4, 'test_kj2')])],
    { enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [9, 6] }] },   // 两格外：够得着，但不会被阻挡
  );
  installKjeragFrostDeath(hexHooks(h.battle));
  h.run(1);
  const u = kjOnField(h)[0];
  const mate = kjOnField(h)[1];
  const foe = foes(h)[0];
  assert.equal(u.defId, 'test_kj_reach', 'premise: 第一名是射程 2 格的那位');
  assert.equal(foe.blockedBy, null, 'premise: 敌人没被阻挡');
  const hitsOf = () => h.hooksOf('hit').filter((c) => c && c.source === u).length;
  assert.ok(hitsOf() > 0, 'premise: 冰封前打得到这名敌人');
  assert.equal(u.s.blockCnt, 1, 'premise: 基础阻挡 1');

  stackFrost(h, u, foe, 4);
  assert.equal(stacksOf(u), 4, 'premise: 4 层还没进冰封');
  assert.equal(u.findBuff(SEAL), null);
  stackFrost(h, u, foe, 1);                       // 第 5 层 ⇒ 冰封
  assert.equal(u.findBuff(FROST), null, '霜寒被消耗清零');
  const seal = u.findBuff(SEAL);
  assert.ok(seal, '挂上冰封');
  near(seal.timeLeft, FD.sealSec, '冰封持续 5 秒');

  const f = u.s.flags;
  assert.equal(f.disarm, true, '无法攻击');
  assert.equal(f.silence, true, '无法使用技能');
  assert.equal(f.noHeal, true, '无法被治疗（队友的治疗）');
  assert.equal(f.healFree, true, '无法被治疗（自己的回复）');
  assert.equal(f.invulnerable, true, '免疫所有伤害');
  assert.equal(u.s.blockCnt, 2, '阻挡数 +1');

  // 免疫伤害：真伤也归零
  const hp = u.hp;
  assert.equal(h.battle.dealDamage(foe, u, makeDamageInfo({ amount: 500, type: 'true', canDodge: false })), 0, '免疫伤害');
  assert.equal(u.hp, hp, '生命值不变');

  // 无法被治疗
  u.hp = 500;
  assert.equal(h.battle.heal(mate, u, 300), 0, '无法被治疗');
  assert.equal(u.hp, 500, '生命值不变');

  // 无法攻击：冰封之后一发都打不出来（敌人就站在射程里）
  const hits = hitsOf();
  const foeHp = foe.hp;
  h.run(1);
  assert.equal(hitsOf(), hits, 'disarm ⇒ 冰封期间一发都不打');
  assert.equal(foe.hp, foeHp, '敌人一点血都没掉');
  h.invariants();
});

test('困毙之雪: 冰封期间不再获得霜寒；5 秒后解除并从 0 重新叠', () => {
  const h = field([seatWithCard([at(1, 9, 4, 'test_kj1'), at(2, 10, 4, 'test_kj2'), at(3, 11, 4, 'test_kj3')])]);
  installKjeragFrostDeath(hexHooks(h.battle));
  h.run(1);
  const [u] = kjOnField(h);
  const foe = foes(h)[0];
  stackFrost(h, u, foe, 5);
  assert.ok(u.findBuff(SEAL), 'premise: 已进入冰封');

  // 冰封期间再冻结敌人：不叠霜寒
  stackFrost(h, u, foe, 3);
  assert.equal(u.findBuff(FROST), null, '冰封期间不叠霜寒');

  h.run(5.2);                                     // t = 6.2：冰封在 6.0 结束
  assert.equal(u.findBuff(SEAL), null, '5 秒后解除');
  assert.equal(u.findBuff(FROST), null, '解除后从 0 开始');
  assert.ok(!u.s.flags.disarm, '恢复行动');
  assert.ok(!u.s.flags.invulnerable, '不再免疫');
  assert.equal(u.s.blockCnt, 1, '阻挡数回到 1');

  stackFrost(h, u, foe, 1);
  assert.equal(stacksOf(u), 1, '解除后可以重新叠');
  h.invariants();
});

test('困毙之雪: 冰封干员阻挡的敌人每秒受到 100 + 40L 真实伤害（L = 谢拉格层数）', () => {
  const h = field(
    [seatWithCard([at(1, 9, 6, 'test_kj1'), at(2, 10, 4, 'test_kj2'), at(3, 11, 4, 'test_kj3')], {
      bonds: bondsOf({ kjeragShip: { layers: 2 } }),
    })],
    { enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [9, 6] }] },   // 站在 kj1 脚下 ⇒ 被它阻挡
  );
  installKjeragFrostDeath(hexHooks(h.battle));
  h.run(1);
  const u = kjOnField(h)[0];
  const foe = foes(h)[0];
  assert.equal(foe.blockedBy, u, 'premise: 敌人被这名干员阻挡');
  assert.equal(bondLayers(h.battle, 'p1', 'kjeragShip'), 2, 'premise: 谢拉格 2 层');

  stackFrost(h, u, foe, 5);
  assert.ok(u.findBuff(SEAL), 'premise: 已进入冰封');
  const hp = foe.hp;
  h.run(0.05);                                    // 跨过 t=1.0 的那一拍（every(1) 在安装时挂上，due = 1.0）
  near(foe.hp, hp - (100 + 40 * 2), '每秒 100 + 40 × 2 = 180 真实伤害');
  assert.equal(foe.blockedBy, u, '仍然阻挡着');

  // 下一拍再来一次
  const hp2 = foe.hp;
  h.run(1);
  near(foe.hp, hp2 - 180, '每秒一拍，不是一次性');
  h.invariants();
});

// =====================================================================================================================
// 6 名档

test('困毙之雪: N=6 时谢拉格干员死亡 ⇒ 冻结全场敌人 5 秒 + 全体谢拉格干员移除 2 层霜寒', () => {
  const units = KJ_IDS.map((id, i) => at(i + 1, 9 + (i % 4), 4 + (i >= 4 ? 1 : 0), id));
  const h = field(
    [seatWithCard(units)],
    { enemies: [{ key: 'enemy_dummy', time: 0, route: 0, count: 3 }] },
  );
  installKjeragFrostDeath(hexHooks(h.battle));
  h.run(1);
  const ops = kjOnField(h);
  assert.equal(ops.length, HIGH, 'premise: 六名谢拉格干员在场');
  const enemies = foes(h);
  assert.equal(enemies.length, 3, 'premise: 三个敌人');

  // 每名干员先攒 3 层（冻结 0.04 秒就化，免得干扰后面的冻结断言）
  for (const u of ops) for (const e of enemies) h.battle.applyStatus(e, 'freeze', { duration: 0.04, source: u, reenter: true });
  h.run(0.3);
  for (const u of ops) assert.equal(stacksOf(u), 3, 'premise: 每人 3 层');
  for (const e of enemies) assert.equal(e.findBuff('freeze'), null, 'premise: 冻结都已结束');

  const dead = ops[0];
  h.battle.kill(dead);
  assert.equal(dead.alive, false, 'premise: 一名谢拉格干员阵亡');

  for (const e of enemies) {
    const fz = e.findBuff('freeze');
    assert.ok(fz, '全场敌人被冻结');
    near(fz.timeLeft, FD.deathFreezeSec, '冻结 5 秒');
  }
  for (const u of ops.slice(1)) {
    assert.equal(stacksOf(u), 1, '全体移除 2 层（3 → 1）');
  }
  h.invariants();
});

test('困毙之雪: N=6 且全员冰封 ⇒ 15 秒内每秒对全场敌人造成 100 + 50L 真实伤害并施加寒冷', () => {
  const units = KJ_IDS.map((id, i) => at(i + 1, 9 + (i % 4), 4 + (i >= 4 ? 1 : 0), id));
  const h = field([seatWithCard(units, { bonds: bondsOf({ kjeragShip: { layers: 2 } }) })]);
  installKjeragFrostDeath(hexHooks(h.battle));
  h.run(1);
  const ops = kjOnField(h);
  assert.equal(ops.length, HIGH);
  const foe = foes(h)[0];
  const hp0 = foe.hp;

  for (const u of ops) {
    stackFrost(h, u, foe, 5);
    assert.ok(u.findBuff(SEAL), 'premise: 六名干员全部冰封');
  }
  assert.equal(stacksOf(ops[0]), 0, '冰封消耗了霜寒');

  h.run(1.1);                                     // t = 2.1：脉冲在 t=1 启动，t=2 打出第一拍
  near(foe.hp, hp0 - (100 + 50 * 2), '每秒 100 + 50 × 2 = 200 真实伤害');
  assert.ok(foe.findBuff('cold'), '并对全场敌人施加寒冷');

  h.run(2);                                       // t = 4.1：再两拍
  near(foe.hp, hp0 - 3 * 200, '持续每秒一拍（到这里共 3 拍）');
  assert.ok(foe.findBuff('cold') || foe.findBuff('freeze'), '寒冷 / 冻结仍在施加');

  // 15 秒的窗口：t=2 起共 15 拍（到 t=16），之后不再有脉冲
  h.run(12);                                      // t = 16.1
  near(foe.hp, hp0 - 15 * 200, '15 秒 = 15 拍，总共 3000 真实伤害');
  h.run(2);                                       // t = 18.1：冰封早已结束、也没人再冰封 ⇒ 不再启动
  near(foe.hp, hp0 - 15 * 200, '脉冲结束后不再造成伤害');
  h.invariants();
});

test('困毙之雪: 未满 6 名时不触发 6 名档（死亡不冻结全场、全员冰封不起脉冲）', () => {
  // ① 只有 3 名：谢拉格干员阵亡不冻结全场
  const dead = field([seatWithCard([at(1, 9, 4, 'test_kj1'), at(2, 10, 4, 'test_kj2'), at(3, 11, 4, 'test_kj3')])]);
  installKjeragFrostDeath(hexHooks(dead.battle));
  dead.run(1);
  const foeA = foes(dead)[0];
  dead.battle.kill(kjOnField(dead)[0]);
  assert.equal(foeA.findBuff('freeze'), null, '未满 6 名 ⇒ 死亡不冻结全场');
  dead.invariants();

  // ② 只有 3 名、但全员冰封：不起全冰封脉冲
  const h = field([seatWithCard([at(1, 9, 4, 'test_kj1'), at(2, 10, 4, 'test_kj2'), at(3, 11, 4, 'test_kj3')])]);
  installKjeragFrostDeath(hexHooks(h.battle));
  h.run(1);
  const ops = kjOnField(h);
  const foe = foes(h)[0];
  for (const u of ops) stackFrost(h, u, foe, 5);
  assert.ok(ops.every((u) => u.findBuff(SEAL)), 'premise: 在场三人全部冰封');
  const hp0 = foe.hp;
  h.run(2.1);
  near(foe.hp, hp0, '没有 6 名档 ⇒ 没有全冰封脉冲');
  h.invariants();
});

// =====================================================================================================================
// 参数读卡面

test('困毙之雪: 数字读卡面 —— 换一整套参数，解锁 / 每层面板 / 冰封 / 施寒全都跟着变', () => {
  const effect = {
    ...FD,
    unlockCount: 2,          // 2 名就解锁
    frostMax: 3,             // 3 层进冰封
    defPctPerStack: 10,      // 每层防御 +10%
    aspdPerStack: 2,         // 每层攻速 −2
    sealSec: 2,              // 冰封 2 秒
    coldChancePerStack: 100, // 每层 100% 施寒
    coldSec: 7,              // 寒冷 7 秒
  };
  const h = field([seatWithCard([at(1, 9, 4, 'test_kj1'), at(2, 10, 4, 'test_kj2')], { effect })]);
  installKjeragFrostDeath(hexHooks(h.battle));
  h.run(1);
  const [u] = kjOnField(h);
  const foe = foes(h)[0];

  // unlockCount 2：两名干员就解锁了
  h.battle.applyStatus(foe, 'freeze', { duration: 30, source: u });
  assert.equal(stacksOf(u), 1, 'unlockCount 2 ⇒ 解锁');
  near(u.s.def, 220, '每层 +10%');
  near(u.s.aspd, 98, '每层 −2');

  // 第二层：还没到 frostMax 3 ⇒ 不冰封
  h.battle.applyStatus(foe, 'freeze', { duration: 30, source: u, reenter: true });
  assert.equal(stacksOf(u), 2, 'premise: 2 层还没进冰封');
  assert.equal(u.findBuff(SEAL), null);

  // coldChancePerStack 100 ⇒ 1 层就必定施寒，coldSec 7 秒
  h.battle.removeStatus(foe, 'freeze');
  h.battle.dealDamage(u, foe, makeDamageInfo({ amount: 100, type: 'phys', canDodge: false, isAttack: true }));
  const cold = foe.findBuff('cold');
  assert.ok(cold, '1 层 100% 施寒');
  near(cold.timeLeft, 7, '寒冷 7 秒（coldSec 读卡面）');

  // frostMax 3 ⇒ 3 层进冰封；sealSec 2 ⇒ 2 秒后解除
  h.battle.applyStatus(foe, 'freeze', { duration: 30, source: u, reenter: true });
  assert.equal(u.findBuff(FROST), null, '3 层 ⇒ 霜寒清零');
  const seal = u.findBuff(SEAL);
  assert.ok(seal, 'frostMax 3 ⇒ 3 层就冰封');
  near(seal.timeLeft, 2, 'sealSec 2 秒');
  assert.equal(u.s.blockCnt, 2);

  h.run(2.2);
  assert.equal(u.findBuff(SEAL), null, '2 秒后解除');
  h.invariants();
});

test('困毙之雪: 只认拥有者自己的【谢拉格】干员 —— 自己的非成员、别人的谢拉格都不叠霜寒', () => {
  const h = field([
    seat('p1', 0, {
      effects: [refOf(CARD, SPEC, FD)],
      units: [at(1, 9, 4, 'test_plain'), at(2, 10, 4, 'test_kj1'), at(3, 11, 4, 'test_kj2')],
      bonds: bondsOf(),
    }),
    seat('p2', 1, { effects: [], units: [at(4, 9, 6, 'test_kj3'), at(5, 10, 6, 'test_kj4')], bonds: bondsOf() }),
  ], { kind: 'unite', enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }] });
  installKjeragFrostDeath(hexHooks(h.battle));
  h.run(1);
  const foe = foes(h)[0];
  const mine = h.battle.allyUnits.find((u) => u.ownerId === 'p1' && u.defId === 'test_plain');
  const theirs = h.battle.allyUnits.find((u) => u.ownerId === 'p2' && u.defId === 'test_kj3');
  assert.ok(mine && theirs, 'premise: 两名干员都在场');

  h.battle.applyStatus(foe, 'freeze', { duration: 30, source: mine });
  assert.equal(mine.findBuff(FROST), null, '自己的非谢拉格干员不叠霜寒');

  h.battle.applyStatus(foe, 'freeze', { duration: 30, source: theirs, reenter: true });
  assert.equal(theirs.findBuff(FROST), null, '别人的谢拉格干员不归这张卡管');
  assert.equal(h.battle.allyUnits.filter((u) => u && u.findBuff && u.findBuff(FROST)).length, 0, '场上没有任何霜寒');
  h.invariants();
});
