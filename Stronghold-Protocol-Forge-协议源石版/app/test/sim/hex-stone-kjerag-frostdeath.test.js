// test/sim/hex-stone-kjerag-frostdeath.test.js — 第二十一批（业主 2026-10-31，2026-11-01 改口径）：
// 谢拉格 ·【困毙之雪】hex_kjerag_frostdeath 的战斗半边
// （server/sim/content/hexcards/stone_kjerag_frostdeath.js installKjeragFrostDeath）。
//
// 驱动方式与 hex-stone-kjerag-laterano.test.js 一致：真实 sim Battle（test/helpers/battleHarness.js 的
// makeBattle / chessRec / enemyRec）+ 生产用的 `hexHooks(battle)` 手工安装，effect ref 按 server/match/hextech.js
// `addHexRef` 的形状手搓（`{ id:'hex:<id>', key:'hex:<id>', params:{ ...effect, hexId, rarity }, data:{…} }`），
// 所以本套件不依赖 content/hextech.js 的接线是否已经落地。`content: 'generic'` 让 installContent 不跑
// content/hextech.js 的 `install()`、也不装盟约内容（层数只当数据用），于是这些数字只可能来自被测模块。
//
// 业主 2026-11-01 改版后的口径（模块头注释 = 权威口径）：
//   基础      每层霜寒 防御 +5% / 攻速 −5；所有己方在场【谢拉格】干员每 5 秒 +1 层（**完全无条件**，N<3 也叠）；
//             霜寒到 frostMax 10 层 ⇒ 消耗清零进冰封 5 秒（disarm / silence / noHeal / healFree / invulnerable
//             + blockCnt 1），冰封期间不叠层、结束后从 0 叠。
//   N ≥ 3     ① 敌人被冻结（statusApplied freeze + entered，来源不限）⇒ 全体在场谢拉格各 +1 层；
//             ② 每个冰封干员周围八格（切比雪夫 ≤ sealedAuraRadius 1，格心判定）内的活敌人每秒受
//                sealedAuraDmg 100 + sealedAuraDmgPerLayer 40 × L 真实伤害（L = bondLayers kjeragShip），
//                被这一发打死的敌人 ⇒ battle.addLayers(pid,'kjeragShip', sealedAuraKillLayers 1)。
//   N ≥ 6     ① 谢拉格干员死亡（reason === 'killed'，刚死那名计入 N）⇒ 冻结全场敌人 5 秒 + 全体在场谢拉格移除
//                deathRemoveStacks 4 层霜寒；
//             ② 全员冰封 ⇒ 5 秒窗口，每秒对全场敌人 allSealedDmg 100 + allSealedDmgPerLayer 50 × L 真伤
//                + 寒冷 allSealedColdSec 5 秒，被这一发打死的敌人 ⇒ 层数 +allSealedKillLayers 2。
//
// 2026-11-01 改版**已删除**（本套件不再测试）：攻击时 30%/层施寒、解冻回层（半径 1.5）、
// 无冻结敌人时每 5 秒叠层的旧分支（idleFrostUnconditional）、冰封阻挡真伤（sealedBlockDmg*）。
//
// [ASSUMED]（模块头注释里有完整口径，这里是测试侧的断言口径）：
//   1. 每层霜寒是引擎的加算 mod（`add[k] += v × stacks`）⇒ 10 层 = 防御 ×1.5、攻速 −50 点。
//      但 frostMax 10 时第 10 层会立刻进冰封并清空霜寒，所以「10 层的面板」只能用 frostMax 调大的同一张卡来看
//      （见「每层霜寒」那条 test）；卡面上限本身由「10 层进冰封」那条 test 覆盖。
//   2. 「被冻结」= statusApplied 里 `status === 'freeze' && entered === true`；冻结的**来源不影响**叠层
//      （无来源 / 队友干员 / 敌人自己冻的都算）。
//   3. 「周围八格」= 切比雪夫距离 ≤ 1 的格心判定（干员用 tileR/tileC，敌人用 round(x/y)）。
//   4. 击杀返层只认「这一发打之前活着、打之后倒下」，按敌人条数结算。
//   5. 6 名档的死亡判定把刚倒下的那名干员算进去（否则「第 6 名倒下」永远触发不了）。
//   6. 真伤窗口是闩：期间不重启、不叠加；5 秒按绝对截止时刻算 ⇒ 从触发时刻起正好 5 拍。
//   7. 返层走 engine 的 addLayers：普通场（kind 'normal'）`flags.layerGainsEnabled` 为 true 才会真的加层。
//
// 运行：node test/sim/hex-stone-kjerag-frostdeath.test.js（沙箱禁 node --test，直接跑文件）。

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

/** 卡面 effect.kjeragFrostDeath（业主 2026-11-01 改版；tools/hextech/roster.mjs 与 data/hextech.json 同值）。 */
const FD = Object.freeze({
  // 基础
  unlockCount: 3, frostMax: 10, defPctPerStack: 5, aspdPerStack: 5, sealSec: 5, idleFrostSec: 5,
  // 3 名档
  sealedAuraDmg: 100, sealedAuraDmgPerLayer: 40, sealedAuraRadius: 1, sealedAuraKillLayers: 1,
  // 6 名档
  highCount: 6, deathFreezeSec: 5, deathRemoveStacks: 4,
  allSealedDmg: 100, allSealedDmgPerLayer: 50, allSealedSec: 5, allSealedColdSec: 5, allSealedKillLayers: 2,
});

const CARD = 'hex_kjerag_frostdeath';
const SPEC = 'kjeragFrostDeath';
/** 霜寒 / 冰封的 buff 键（与模块一致）。 */
const FROST = 'hex:kjeragfrost:frost';
const SEAL = 'hex:kjeragfrost:seal';
/** 本卡自己打出的真伤带的 tag（模块 SELF_TAG）。 */
const SELF_TAG = 'hex:kjeragfrost';
/** 6 名档的档位。 */
const HIGH = 6;

/**
 * One playerEffects entry, the shape server/match/hextech.js addHexRef writes. `effect` overrides the card-face
 * values (a record carrying different numbers — the module must read them).
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
 * 攻击范围只有脚下这一格（站在旁边的敌人不会被顺手打一下）。
 */
const kjOp = (id, o = {}) => chessRec({
  id, bonds: ['kjeragShip'],
  stats: { maxHp: 2000, atk: 0, def: 200, res: 0, blockCnt: 1, respawnTime: 20 },
  rangeGrid: [[0, 0]],
  ...o,
});

/** 不属于任何一个盟约的干员（证明「是不是谢拉格成员」才是判据，与「谁冻的」无关）。 */
const plainOp = (id) => chessRec({
  id, bonds: [],
  stats: { maxHp: 2000, atk: 0, def: 200, res: 0, blockCnt: 1, respawnTime: 20 },
  rangeGrid: [[0, 0]],
});

/** 六名不同干员（`baseChessId` 各不相同 ⇒ 数「不同干员」时各算一个）。 */
const KJ_IDS = ['test_kj1', 'test_kj2', 'test_kj3', 'test_kj4', 'test_kj5', 'test_kj6'];

/** 一个血厚、不动、不还手的敌人：整场安静（真伤能打进去，但打不死）。 */
const dummy = (o = {}) => enemyRec({ key: 'enemy_dummy', hp: 1000000, atk: 0, def: 0, speed: 0, ...o });

/** 一个 100 血的木桩：用来验证「被这一发真伤打死就返层」。 */
const frail = () => enemyRec({ key: 'enemy_frail', hp: 100, atk: 0, def: 0, speed: 0 });

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
  return { chess, enemies: { enemy_dummy: dummy(), enemy_frail: frail() } };
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
    timeLimit: 120,
    captureNoisy: true,
    hooks: ['hit', 'damaged', 'statusApplied', 'death', 'kill', 'layerGain', 'battleStart', 'deploy'],
  });
}

/** 带卡的一个席位 + 若干谢拉格干员（effects 默认就是卡面那组参数）。 */
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
/** 六名不同谢拉格干员的棋盘（站位彼此分开、都够不到木桩）。 */
const sixKjerag = () => KJ_IDS.map((id, i) => at(i + 1, 9 + (i % 4), 4 + (i >= 4 ? 1 : 0), id));
/** 浮点比较（引擎的 def / aspd 是 double 累加出来的；`tol` 用于「刚打出来的 buff 还剩多少秒」）。 */
const near = (a, b, msg, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${msg}（实际 ${a}，期望 ${b}）`);

/**
 * 让 `foe` 被「冻结」`n` 次：`reenter` 强制 `entered === true` ⇒ 每次都算「敌人被冻结」，
 * 于是 3 名档每冻一次就给所有在场谢拉格 +1 层。`source` 缺省 = 无来源（冻结来源不影响叠层）。
 */
const frostTimes = (h, foe, n = 1, source = null) => {
  for (let i = 0; i < n; i++) h.battle.applyStatus(foe, 'freeze', { duration: 0.04, source, reenter: true });
};

/**
 * 把 `ops` 全部推到霜寒上限并进入冰封（靠「敌人被冻结 ⇒ 全体 +1 层」，每冻一次一层）。
 * 循环到全员冰封为止，所以卡面 frostMax 换成别的数字也不用改测试。
 */
const sealAll = (h, ops, foe) => {
  for (let i = 0; i < 64 && !ops.every((u) => !!u.findBuff(SEAL)); i++) {
    h.battle.applyStatus(foe, 'freeze', { duration: 0.04, reenter: true });
  }
  assert.ok(ops.every((u) => !!u.findBuff(SEAL)), 'premise: 在场谢拉格干员全部进入冰封');
};

/** 记下本卡自己打出的真伤（tags 带 hex:kjeragfrost）的每一拍：`{ t, amt, tgt }`。 */
function beatsOf(h) {
  const out = [];
  h.battle.on('damaged', (c) => {
    const d = c && c.dmg;
    if (d && Array.isArray(d.tags) && d.tags.includes(SELF_TAG)) out.push({ t: h.battle.time, amt: d.amount, tgt: c.target });
  });
  return out;
}

// =====================================================================================================================
// 没有卡

test('困毙之雪: 没有这张卡 ⇒ install 返回 0，冻结敌人不叠霜寒，每 5 秒也不叠', () => {
  const h = field([seat('p1', 0, {
    effects: [],
    units: [at(1, 9, 4, 'test_kj1'), at(2, 10, 4, 'test_kj2'), at(3, 11, 4, 'test_kj3')],
    bonds: bondsOf(),
  })]);
  const inst = installKjeragFrostDeath(hexHooks(h.battle));
  assert.equal(inst, 0, '没有卡 ⇒ install 返回 0');
  h.run(1);
  const u = kjOnField(h)[0];
  const foe = foes(h)[0];
  frostTimes(h, foe, 3);
  assert.equal(u.findBuff(FROST), null, '没有霜寒 buff');
  h.run(5);                                                 // 跨过 t=5 的基础叠层点
  for (const op of kjOnField(h)) assert.equal(op.findBuff(FROST), null, '没有卡 ⇒ 每 5 秒也不叠');
  assert.equal(u.s.def, 200, '防御没有变化');
  assert.equal(u.s.aspd, 100, '攻速没有变化');
  h.invariants();
});

// =====================================================================================================================
// N = 2：3 名档不解锁，基础效果照旧

test('困毙之雪: 在场只有 2 名不同谢拉格干员 ⇒ 3 名档不解锁（冻结不叠、冰封没有八格真伤），基础每 5 秒照旧叠层', () => {
  // ① 冻结不给层（3 名档），但 t=5 的基础那一拍照样给
  const h = field([seatWithCard([at(1, 9, 4, 'test_kj1'), at(2, 10, 4, 'test_kj2')])]);
  const inst = installKjeragFrostDeath(hexHooks(h.battle));
  assert.equal(inst, 2, '安装覆盖面 = 2 名谢拉格干员');
  h.run(1);
  let ops = kjOnField(h);
  const foe = foes(h)[0];
  frostTimes(h, foe, 3);
  assert.equal(ops[0].findBuff(FROST), null, 'N=2 ⇒ 敌人被冻结也不叠霜寒');
  h.run(4.3);                                                // t ≈ 5.3：跨过基础效果的 t=5
  ops = kjOnField(h);
  for (const op of ops) assert.equal(stacksOf(op), 1, 'N < 3 也每 5 秒 +1 层（基础效果完全无条件）');
  near(ops[0].s.def, 210, '每层防御 +5%');
  h.invariants();

  // ② N=2 也能叠满并进冰封（基础效果不看人数），但冰封**没有**八格真伤（那一条挂在 3 名档下）
  // 只把基础叠层的间隔调快（idleFrostSec 0.5），霜寒上限 / 解锁人数仍是卡面值。
  const fast = field([seatWithCard([at(1, 10, 6, 'test_kj1'), at(2, 9, 4, 'test_kj2')], { effect: { ...FD, idleFrostSec: 0.5 } })],
    { enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [11, 7] }] });   // 斜一格 ⇒ 3 名档口径下在八格里
  installKjeragFrostDeath(hexHooks(fast.battle));
  fast.run(1);
  const ops2 = kjOnField(fast);
  const foe2 = foes(fast)[0];
  const cheb = Math.max(Math.abs(Math.round(foe2.y) - ops2[0].tileR), Math.abs(Math.round(foe2.x) - ops2[0].tileC));
  assert.equal(cheb, 1, 'premise: 敌人站在第一名干员的斜角（切比雪夫 1）');
  const hp0 = foe2.hp;
  fast.run(4.5);                                             // t ≈ 5.5：10 层 ⇒ 冰封
  assert.ok(ops2.every((u) => !!u.findBuff(SEAL)), 'premise: N=2 也照样能叠满并进入冰封');
  fast.run(2.5);                                             // 冰封期间跨过两拍 every(1)
  assert.equal(foe2.hp, hp0, 'N=2 ⇒ 冰封没有八格真伤');
  fast.invariants();
});

// =====================================================================================================================
// N ≥ 3：① 敌人被冻结 ⇒ 全体在场谢拉格 +1 层

test('困毙之雪: N=3 时敌人被冻结 ⇒ 所有在场谢拉格干员各 +1 层（冻结来源不限）', () => {
  const h = field([seatWithCard([
    at(1, 9, 4, 'test_kj1'), at(2, 10, 4, 'test_kj2'), at(3, 11, 4, 'test_kj3'), at(4, 12, 4, 'test_plain'),
  ])]);
  const inst = installKjeragFrostDeath(hexHooks(h.battle));
  assert.equal(inst, 3, '安装覆盖面只数己方谢拉格干员（非成员不算）');
  h.run(1);
  const ops = kjOnField(h).filter((u) => u.defId !== 'test_plain');
  const plain = kjOnField(h).find((u) => u.defId === 'test_plain');
  assert.equal(ops.length, 3, 'premise: 三名谢拉格干员在场');
  const foe = foes(h)[0];

  // 无来源的冻结（敌人被寒冷成对冻上）：照样给全体 +1 层
  h.battle.applyStatus(foe, 'freeze', { duration: 30, source: null });
  for (const op of ops) {
    assert.equal(stacksOf(op), 1, '敌人被冻结 ⇒ 全体在场谢拉格各 +1 层');
    near(op.s.def, 210, '1 层 = 防御 200 × (1 + 5%)');
    near(op.s.aspd, 95, '1 层 = 攻速 100 − 5');
  }
  assert.equal(plain.findBuff(FROST), null, '非谢拉格成员不叠霜寒');

  // 来源不是谢拉格干员（一名非成员冻的）：受益者仍是全体
  h.battle.applyStatus(foe, 'freeze', { duration: 30, source: plain, reenter: true });
  for (const op of ops) {
    assert.equal(stacksOf(op), 2, '冻结来源不是谢拉格干员也照样给全体 +1 层');
    near(op.s.def, 220, '2 层 = 防御 +10%');
    near(op.s.aspd, 90, '2 层 = 攻速 −10');
  }
  assert.equal(plain.findBuff(FROST), null, '非谢拉格成员还是没叠');

  const applied = h.hooksOf('statusApplied').filter((c) => c && c.status === 'freeze');
  assert.equal(applied.length, 2, '两次冻结都走了 statusApplied');
  h.invariants();
});

test('困毙之雪: 每层霜寒 = 防御 +5% / 攻速 −5 ⇒ 10 层 = 防御 +50%、攻速 −50', () => {
  // 卡面上限 frostMax 10 时第 10 层当场进冰封并清空霜寒（下一条 test），所以这里把上限调大才看得到「10 层」的面板；
  // defPctPerStack / aspdPerStack 仍是卡面值。
  const h = field([seatWithCard([at(1, 9, 4, 'test_kj1'), at(2, 10, 4, 'test_kj2'), at(3, 11, 4, 'test_kj3')], {
    effect: { ...FD, frostMax: 20 },
  })]);
  installKjeragFrostDeath(hexHooks(h.battle));
  h.run(1);
  const [u] = kjOnField(h);
  const foe = foes(h)[0];

  frostTimes(h, foe, 3);
  assert.equal(stacksOf(u), 3, 'premise: 3 层');
  near(u.s.def, 230, '3 层 = 防御 200 × (1 + 3 × 5%)');
  near(u.s.aspd, 85, '3 层 = 攻速 100 − 3 × 5');

  frostTimes(h, foe, 7);
  assert.equal(stacksOf(u), 10, 'premise: 10 层（frostMax 调到 20，所以还没进冰封）');
  assert.equal(u.findBuff(SEAL), null, 'premise: 没进冰封');
  near(u.s.def, 300, '10 层 = 防御 200 × (1 + 50%) = 300');
  near(u.s.aspd, 50, '10 层 = 攻速 100 − 50 = 50');
  h.invariants();
});

// =====================================================================================================================
// 基础：10 层 ⇒ 冰封

test('困毙之雪: 霜寒叠到 10 层 ⇒ 消耗全部霜寒进入冰封（阻挡 +1 / 免疫伤害 / 无法攻击 / 无法被治疗 / 期间不叠层 / 5 秒后解除）', () => {
  const h = field(
    [seatWithCard([at(1, 9, 4, 'test_kj_reach'), at(2, 10, 4, 'test_kj1'), at(3, 11, 4, 'test_kj2')])],
    { enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [9, 6] }] },   // 两格外：够得着，但不会被阻挡
  );
  installKjeragFrostDeath(hexHooks(h.battle));
  h.run(1);
  const ops = kjOnField(h);
  const u = ops[0];
  const mate = ops[1];
  const foe = foes(h)[0];
  const hitsOf = () => h.hooksOf('hit').filter((c) => c && c.source === u).length;
  assert.equal(u.defId, 'test_kj_reach', 'premise: 第一名是射程 2 格的那位');
  assert.equal(foe.blockedBy, null, 'premise: 敌人没被阻挡');
  assert.ok(hitsOf() > 0, 'premise: 冰封前打得到这名敌人');
  assert.equal(u.s.blockCnt, 1, 'premise: 基础阻挡 1');

  frostTimes(h, foe, 9);
  assert.equal(stacksOf(u), 9, 'premise: 9 层还没进冰封');
  assert.equal(u.findBuff(SEAL), null);
  frostTimes(h, foe, 1);                                     // 第 10 层 ⇒ 冰封
  for (const op of ops) {
    assert.equal(op.findBuff(FROST), null, '霜寒被消耗清零');
    assert.ok(op.findBuff(SEAL), '挂上冰封');
  }
  const seal = u.findBuff(SEAL);
  near(seal.timeLeft, FD.sealSec, '冰封持续 5 秒（sealSec 读卡面）');

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

  // 冰封期间不再获得霜寒（3 名档的来源也被挡）
  frostTimes(h, foe, 3);
  for (const op of ops) assert.equal(op.findBuff(FROST), null, '冰封期间不叠霜寒');

  // 5 秒后解除，并从 0 重新叠
  h.run(5.2);                                                // 冰封在 t≈6.0 结束
  for (const op of ops) {
    assert.equal(op.findBuff(SEAL), null, '5 秒后解除');
    assert.equal(op.findBuff(FROST), null, '解除后从 0 开始');
  }
  assert.ok(!u.s.flags.disarm, '恢复行动');
  assert.ok(!u.s.flags.invulnerable, '不再免疫');
  assert.equal(u.s.blockCnt, 1, '阻挡数回到 1');
  frostTimes(h, foe, 1);
  for (const op of ops) assert.equal(stacksOf(op), 1, '解除后可以重新叠');
  h.invariants();
});

// =====================================================================================================================
// N ≥ 3：② 冰封干员周围八格真伤

test('困毙之雪: 冰封干员周围八格内的敌人每秒受到 100 + 40L 真实伤害（格外挨不到）', () => {
  const h = field(
    [seatWithCard([at(1, 10, 6, 'test_kj1'), at(2, 9, 4, 'test_kj2'), at(3, 12, 4, 'test_kj3')], {
      bonds: bondsOf({ kjeragShip: { layers: 2 } }),
    })],
    { enemies: [
      { key: 'enemy_dummy', time: 0, route: 0, pos: [11, 7] },   // 离 kj1 斜角一格（八格内），离另外两名 ≥ 2 格
      { key: 'enemy_dummy', time: 0, route: 0, pos: [10, 2] },   // 离谁都 ≥ 2 格
    ] },
  );
  const beats = beatsOf(h);
  installKjeragFrostDeath(hexHooks(h.battle));
  h.run(1.5);
  const ops = kjOnField(h);
  const [inside, outside] = foes(h);
  assert.equal(bondLayers(h.battle, 'p1', 'kjeragShip'), 2, 'premise: 谢拉格 2 层');
  assert.equal(Math.max(Math.abs(Math.round(inside.y) - 10), Math.abs(Math.round(inside.x) - 6)), 1, 'premise: 敌人在 kj1 的斜角');
  assert.equal(Math.max(Math.abs(Math.round(outside.y) - 10), Math.abs(Math.round(outside.x) - 6)), 4, 'premise: 另一名敌人在四格外');

  const hpInside = inside.hp;
  const hpOutside = outside.hp;
  sealAll(h, ops, inside);
  assert.equal(beats.length, 0, 'premise: 还没到下一拍，一发都还没打');
  h.run(3);                                                  // 跨过 t≈2/3/4 的三拍
  const mine = beats.filter((b) => b.tgt === inside);
  assert.equal(mine.length, 3, '冰封期间每秒一拍，3 秒打 3 发');
  for (const b of mine) near(b.amt, 100 + 40 * 2, '每发 100 + 40 × 2 = 180 真实伤害');
  near(hpInside - inside.hp, 3 * 180, '八格内：三拍共 540 真实伤害');
  near(mine[1].t - mine[0].t, 1, '两拍之间正好 1 秒');
  assert.equal(beats.filter((b) => b.tgt === outside).length, 0, '八格外的敌人挨不到');
  assert.equal(outside.hp, hpOutside, '八格外的敌人一点血都没掉');
  h.invariants();
});

test('困毙之雪: 冰封干员的八格真伤杀死敌人 ⇒ 谢拉格层数 +1', () => {
  const h = field(
    [seatWithCard([at(1, 10, 6, 'test_kj1'), at(2, 9, 4, 'test_kj2'), at(3, 12, 4, 'test_kj3')])],
    { enemies: [{ key: 'enemy_frail', time: 0, route: 0, pos: [11, 7] }] },   // 100 血，站在 kj1 斜角
  );
  installKjeragFrostDeath(hexHooks(h.battle));
  h.run(1.5);
  const ops = kjOnField(h);
  const foe = foes(h)[0];
  assert.equal(foe.hp, 100, 'premise: 敌人 100 血');
  assert.equal(bondLayers(h.battle, 'p1', 'kjeragShip'), 0, 'premise: 谢拉格 0 层');

  sealAll(h, ops, foe);
  h.run(1.5);                                                // 第一拍：100 + 40 × 0 = 100 真伤，正好打死
  assert.equal(foe.alive, false, '被八格真伤打死');
  assert.equal(bondLayers(h.battle, 'p1', 'kjeragShip'), 1, '被这一发杀死 ⇒ 谢拉格层数 +1（sealedAuraKillLayers）');

  h.run(2);                                                  // 敌人已经倒下：不会再返层
  assert.equal(bondLayers(h.battle, 'p1', 'kjeragShip'), 1, '同一个敌人只返一次层');
  h.invariants();
});

// =====================================================================================================================
// N ≥ 6：① 谢拉格干员死亡

test('困毙之雪: N=6 时谢拉格干员死亡 ⇒ 冻结全场敌人 5 秒 + 全体在场谢拉格移除 4 层霜寒', () => {
  const h = field(
    [seatWithCard(sixKjerag())],
    { enemies: [
      { key: 'enemy_dummy', time: 0, route: 0, pos: [12, 14] },
      { key: 'enemy_dummy', time: 0, route: 0, pos: [12, 16] },
      { key: 'enemy_dummy', time: 0, route: 0, pos: [11, 14] },
    ] },
  );
  installKjeragFrostDeath(hexHooks(h.battle));
  h.run(1);
  const ops = kjOnField(h);
  const enemies = foes(h);
  assert.equal(ops.length, HIGH, 'premise: 六名谢拉格干员在场');
  assert.equal(enemies.length, 3, 'premise: 三个敌人');

  // 每人先攒 6 层（冻结 0.04 秒就化，免得干扰后面的冻结断言）
  frostTimes(h, enemies[0], 6);
  h.run(0.3);
  for (const u of ops) assert.equal(stacksOf(u), 6, 'premise: 每人 6 层');
  for (const e of enemies) assert.equal(e.findBuff('freeze'), null, 'premise: 冻结都已结束');

  const dead = ops[0];
  h.battle.kill(dead);
  assert.equal(dead.alive, false, 'premise: 一名谢拉格干员阵亡');

  for (const e of enemies) {
    const fz = e.findBuff('freeze');
    assert.ok(fz, '全场敌人被冻结');
    near(fz.timeLeft, FD.deathFreezeSec, '冻结 5 秒（deathFreezeSec 读卡面）');
  }
  // 注意这一拍的顺序（实现里「先冻结全场、再移除层数」，两条口径各自都成立）：冻结每名敌人本身又会触发 3 名档的
  // 「敌人被冻结 ⇒ 全体 +1 层」，所以 6 层的人最后是 6 + 3（被冻的 3 名敌人）− 4（deathRemoveStacks）= 5 层。
  const expected = 6 + enemies.length - FD.deathRemoveStacks;
  for (const u of ops.slice(1)) {
    assert.equal(stacksOf(u), expected, `全体在场谢拉格移除 4 层（6 + ${enemies.length} 冻结返层 − 4 = ${expected}）`);
  }
  h.invariants();
});

// =====================================================================================================================
// N ≥ 6：② 全员冰封 ⇒ 5 秒真伤窗口

test('困毙之雪: N=6 且全员冰封 ⇒ 5 秒真伤窗口（每秒 100 + 50L + 寒冷，跑满 5 拍后停止）', () => {
  const h = field(
    [seatWithCard(sixKjerag(), { bonds: bondsOf({ kjeragShip: { layers: 2 } }) })],
    { enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [12, 14] }] },   // 远离所有干员：只有窗口能打到它
  );
  const beats = beatsOf(h);
  installKjeragFrostDeath(hexHooks(h.battle));
  h.run(1);
  const ops = kjOnField(h);
  const foe = foes(h)[0];
  assert.equal(ops.length, HIGH, 'premise: 六名谢拉格干员在场');
  assert.equal(bondLayers(h.battle, 'p1', 'kjeragShip'), 2, 'premise: 谢拉格 2 层');

  sealAll(h, ops, foe);
  const hp0 = foe.hp;
  h.run(1.05);                                               // 第一拍
  near(hp0 - foe.hp, 100 + 50 * 2, '第一拍 = 100 + 50 × 2 = 200 真实伤害');
  const cold = foe.findBuff('cold') || foe.findBuff('freeze');
  assert.ok(cold, '并对全场敌人施加寒冷（寒冷第二次会成对变成冻结）');
  assert.ok(cold.timeLeft > FD.allSealedColdSec - 0.2 && cold.timeLeft <= FD.allSealedColdSec,
    `寒冷持续 5 秒（allSealedColdSec 读卡面，实际 ${cold.timeLeft}）`);

  h.run(4.5);                                                // 跑满 5 拍：t≈2/3/4/5/6
  assert.equal(beats.length, 5, '窗口正好 5 拍');
  for (const b of beats) near(b.amt, 200, '每一拍都是 200 真实伤害');
  near(hp0 - foe.hp, 5 * 200, '5 拍共 1000 真实伤害');
  near(beats[4].t - beats[0].t, 4, '5 拍铺满 4 秒的间隔（触发后 1…5 秒各一拍）');

  const hp1 = foe.hp;
  h.run(3);                                                  // 窗口结束后不再打
  assert.equal(beats.length, 5, '窗口结束后不再有真伤拍');
  assert.equal(foe.hp, hp1, '窗口结束后敌人不再掉血');
  h.invariants();
});

test('困毙之雪: 全冰封窗口的真伤杀死敌人 ⇒ 谢拉格层数 +2', () => {
  const h = field(
    [seatWithCard(sixKjerag())],
    { enemies: [{ key: 'enemy_frail', time: 0, route: 0, pos: [12, 14] }] },   // 100 血、远离所有干员
  );
  const beats = beatsOf(h);
  installKjeragFrostDeath(hexHooks(h.battle));
  h.run(1);
  const ops = kjOnField(h);
  const foe = foes(h)[0];
  assert.equal(foe.hp, 100, 'premise: 敌人 100 血');
  assert.equal(bondLayers(h.battle, 'p1', 'kjeragShip'), 0, 'premise: 谢拉格 0 层');

  sealAll(h, ops, foe);
  h.run(1.5);                                                // 第一拍 = 100 + 50 × 0 = 100 真伤，正好打死
  assert.equal(foe.alive, false, '被全冰封窗口的真伤打死');
  assert.equal(beats.length, 1, 'premise: 只打了一拍');
  assert.equal(bondLayers(h.battle, 'p1', 'kjeragShip'), 2, '被这一发杀死 ⇒ 谢拉格层数 +2（allSealedKillLayers）');

  h.run(3);                                                  // 窗口继续跑，但场上没有敌人了
  assert.equal(bondLayers(h.battle, 'p1', 'kjeragShip'), 2, '同一个敌人只返一次层');
  h.invariants();
});

// =====================================================================================================================
// 档位：未满 6 名

test('困毙之雪: 未满 6 名时不触发 6 名档（死亡不冻结全场、全员冰封不起真伤窗口）', () => {
  // ① 只有 3 名：谢拉格干员阵亡不冻结全场
  const dead = field([seatWithCard([at(1, 9, 4, 'test_kj1'), at(2, 10, 4, 'test_kj2'), at(3, 11, 4, 'test_kj3')])],
    { enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [12, 14] }] });
  installKjeragFrostDeath(hexHooks(dead.battle));
  dead.run(1);
  const foeA = foes(dead)[0];
  dead.battle.kill(kjOnField(dead)[0]);
  assert.equal(foeA.findBuff('freeze'), null, '未满 6 名 ⇒ 死亡不冻结全场');
  dead.invariants();

  // ② 只有 3 名、但全员冰封：不起全冰封真伤窗口（八格外的敌人一点血都不掉）
  const h = field([seatWithCard([at(1, 10, 6, 'test_kj1'), at(2, 9, 4, 'test_kj2'), at(3, 12, 4, 'test_kj3')])],
    { enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [12, 14] }] });
  installKjeragFrostDeath(hexHooks(h.battle));
  h.run(1);
  const ops = kjOnField(h);
  const foe = foes(h)[0];
  sealAll(h, ops, foe);
  const hp0 = foe.hp;
  h.run(3);
  assert.equal(foe.hp, hp0, '没有 6 名档 ⇒ 没有全冰封真伤窗口');
  h.invariants();
});

// =====================================================================================================================
// 参数读卡面

test('困毙之雪: 数字读卡面 ① —— 解锁人数 / 霜寒上限 / 每层面板 / 冰封时长 / 基础叠层间隔', () => {
  const effect = {
    ...FD,
    unlockCount: 2,          // 2 名就解锁
    frostMax: 3,             // 3 层进冰封
    defPctPerStack: 10,      // 每层防御 +10%
    aspdPerStack: 2,         // 每层攻速 −2
    sealSec: 2,              // 冰封 2 秒
    idleFrostSec: 1,         // 每 1 秒基础 +1 层
  };
  const h = field([seatWithCard([at(1, 9, 4, 'test_kj1'), at(2, 10, 4, 'test_kj2')], { effect })]);
  const inst = installKjeragFrostDeath(hexHooks(h.battle));
  assert.equal(inst, 2);
  h.run(0.9);
  const [u] = kjOnField(h);
  const foe = foes(h)[0];
  assert.equal(stacksOf(u), 0, 'idleFrostSec 1 ⇒ 还没到 1 秒');

  h.run(0.5);                                                // t ≈ 1.4：基础那一拍
  assert.equal(stacksOf(u), 1, 'idleFrostSec 1 ⇒ 1 秒 +1 层（N=2 也叠）');
  near(u.s.def, 220, '每层 +10%');
  near(u.s.aspd, 98, '每层 −2');

  // unlockCount 2 ⇒ 敌人被冻结也叠（卡面默认 3 名才解锁）
  h.battle.applyStatus(foe, 'freeze', { duration: 30, source: null });
  assert.equal(stacksOf(u), 2, 'unlockCount 2 ⇒ 冻结也给层');
  near(u.s.def, 240, '2 层 = +20%');

  // frostMax 3 ⇒ 第 3 层进冰封；sealSec 2 ⇒ 2 秒后解除
  h.battle.applyStatus(foe, 'freeze', { duration: 30, source: null, reenter: true });
  assert.equal(u.findBuff(FROST), null, '3 层 ⇒ 霜寒清零');
  const seal = u.findBuff(SEAL);
  assert.ok(seal, 'frostMax 3 ⇒ 3 层就冰封');
  near(seal.timeLeft, 2, 'sealSec 2 秒');
  assert.equal(u.s.blockCnt, 2, '阻挡 +1');

  h.run(2.2);
  assert.equal(u.findBuff(SEAL), null, '2 秒后解除');
  assert.equal(u.s.blockCnt, 1, '阻挡回到 1');
  h.invariants();
});

test('困毙之雪: 数字读卡面 ② —— 3 名档的真伤数值与击杀返层跟着卡面走', () => {
  const effect = { ...FD, sealedAuraDmg: 50, sealedAuraDmgPerLayer: 10, sealedAuraKillLayers: 3 };
  const h = field(
    [seatWithCard([at(1, 10, 6, 'test_kj1'), at(2, 9, 4, 'test_kj2'), at(3, 12, 4, 'test_kj3')], {
      effect, bonds: bondsOf({ kjeragShip: { layers: 2 } }),
    })],
    { enemies: [{ key: 'enemy_frail', time: 0, route: 0, pos: [11, 7] }] },   // 100 血，站在 kj1 斜角
  );
  const beats = beatsOf(h);
  installKjeragFrostDeath(hexHooks(h.battle));
  h.run(1.5);
  const ops = kjOnField(h);
  const foe = foes(h)[0];

  sealAll(h, ops, foe);
  h.run(2.5);                                                // 两拍 50 + 10 × 2 = 70：70 + 70 > 100 血
  assert.equal(foe.alive, false, 'premise: 敌人两拍被打死');
  assert.ok(beats.length >= 2, 'premise: 至少两拍');
  for (const b of beats) near(b.amt, 50 + 10 * 2, '每发 50 + 10 × 2 = 70 真实伤害');
  // 击杀返层的数量读卡面（sealedAuraKillLayers 3）；本场谢拉格已有 2 层，所以是 2 + 3
  assert.equal(bondLayers(h.battle, 'p1', 'kjeragShip'), 2 + effect.sealedAuraKillLayers,
    '被这一发杀死 ⇒ 层数 +3（sealedAuraKillLayers 读卡面）');
  h.invariants();
});

test('困毙之雪: 数字读卡面 ③ —— 6 名档的档位、真伤窗口与死亡数值跟着卡面走', () => {
  const effect = {
    ...FD,
    unlockCount: 2, frostMax: 3,
    // 冰封 1 秒，短于真伤窗口 2 秒：窗口跑满之后场上已经没有人冰封，所以不会因为「全员仍然冰封」而紧接着再开一个
    // 新窗口（模块 [ASSUMED] 7/8：窗口是与冰封解耦的固定时长，窗口一结束就能再次触发）。本 test 只跑到窗口结束，
    // 不去踩 t=5 的基础叠层（那一拍会把两人再推到 3 层、再冰封一次 —— 那是另一条口径，见上面「基础」两条 test）。
    sealSec: 1,
    highCount: 2,                                  // 2 名就算「全员」
    allSealedDmg: 30, allSealedDmgPerLayer: 5, allSealedSec: 2, allSealedColdSec: 3,
    deathFreezeSec: 2, deathRemoveStacks: 1,
  };

  // ① 全员冰封：每秒 30 + 5 × 0 = 30，窗口 2 秒
  const h = field(
    [seatWithCard([at(1, 10, 6, 'test_kj1'), at(2, 9, 4, 'test_kj2')], { effect })],
    { enemies: [
      { key: 'enemy_dummy', time: 0, route: 0, pos: [12, 14] },
      { key: 'enemy_dummy', time: 0, route: 0, pos: [12, 16] },
    ] },
  );
  const beats = beatsOf(h);
  installKjeragFrostDeath(hexHooks(h.battle));
  h.run(1.5);
  const ops = kjOnField(h);
  const [a, b] = foes(h);
  sealAll(h, ops, a);
  near(ops[0].findBuff(SEAL).timeLeft, 1, 'sealSec 1 秒');
  const t0 = h.battle.time;
  const hp0a = a.hp;
  const hp0b = b.hp;

  h.run(2.05);                                               // 跨过 t0+1、t0+2 两拍
  assert.equal(beats.length, 4, 'allSealedSec 2 ⇒ 2 拍，每拍都打两名敌人');
  for (const x of beats) near(x.amt, 30, '每拍 30 + 5 × 0 = 30 真实伤害');
  near(hp0a - a.hp, 2 * 30, '敌人 A 挨 2 拍共 60');
  near(hp0b - b.hp, 2 * 30, '敌人 B 挨 2 拍共 60');
  const times = [...new Set(beats.map((x) => Math.round((x.t - t0) * 1e5) / 1e5))].sort((x, y) => x - y);
  assert.equal(times.length, 2, '窗口只有 2 拍');
  near(times[0], 1, '第一拍 = 全员冰封后 1 秒');
  near(times[1], 2, '最后一拍 = 全员冰封后 2 秒（allSealedSec 读卡面）');

  const cold = a.findBuff('cold') || a.findBuff('freeze');
  assert.ok(cold, '并施加寒冷');
  assert.ok(cold.timeLeft > 3 - 0.3 && cold.timeLeft <= 3, `寒冷 3 秒（allSealedColdSec 读卡面，实际 ${cold.timeLeft}）`);

  assert.ok(ops.every((u) => !u.findBuff(SEAL)), 'premise: 冰封 1 秒就结束（真伤窗口与冰封解耦）');
  h.run(1);                                                  // t0+3.05：窗口若没停，这里就该有第三拍
  assert.equal(beats.length, 4, '窗口结束后不再有真伤拍');
  assert.equal(a.hp, hp0a - 2 * 30, '窗口结束后 A 不再掉血');
  assert.equal(b.hp, hp0b - 2 * 30, '窗口结束后 B 不再掉血');
  h.invariants();

  // ② 死亡：highCount 2 ⇒ 一名谢拉格阵亡就冻结全场 2 秒，并给全体移除 1 层
  const d = field([seatWithCard([at(1, 10, 6, 'test_kj1'), at(2, 9, 4, 'test_kj2'), at(3, 12, 4, 'test_kj3')], { effect })],
    { enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [12, 14] }] });
  installKjeragFrostDeath(hexHooks(d.battle));
  d.run(1.5);
  const dOps = kjOnField(d);
  const dFoe = foes(d)[0];
  frostTimes(d, dFoe, 1);                                    // 每人 1 层（frostMax 3 ⇒ 还没进冰封）
  d.run(0.2);
  for (const u of dOps) assert.equal(stacksOf(u), 1, 'premise: 每人 1 层');
  assert.ok(dOps.every((u) => !u.findBuff(SEAL)), 'premise: 都还没冰封');
  d.battle.kill(dOps[0]);
  const fz = dFoe.findBuff('freeze');
  assert.ok(fz, 'highCount 2 ⇒ 阵亡就冻结全场');
  near(fz.timeLeft, 2, 'deathFreezeSec 2 秒');
  // 与上面 N=6 那条同理：死亡这一拍先把敌人冻上（每冻一只 ⇒ 3 名档给全体 +1 层），再移除 deathRemoveStacks 层。
  for (const u of dOps.slice(1)) assert.equal(stacksOf(u), 1 + 1 - effect.deathRemoveStacks, 'deathRemoveStacks 1 ⇒ 1 + 1 − 1 = 1 层');
  d.invariants();
});
