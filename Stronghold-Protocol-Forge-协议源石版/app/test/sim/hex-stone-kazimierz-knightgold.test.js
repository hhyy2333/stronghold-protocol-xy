// test/sim/hex-stone-kazimierz-knightgold.test.js — 第二十二批（业主 2026-10-31）：卡西米尔 ·【骑士金神】
// hex_kazimierz_knightgold 的战斗半边（server/sim/content/hexcards/stone_kazimierz_knightgold.js
// installKazimierzKnightGold）。
//
// 驱动方式与 hex-stone-kjerag-laterano.test.js / hex-stone-kjerag-frostdeath.test.js 一致：真实 sim Battle
// （test/helpers/battleHarness.js 的 makeBattle / chessRec / enemyRec）+ 生产用的 `hexHooks(battle)` 手工安装，
// effect ref 按 server/match/hextech.js `addHexRef` 的形状手搓
// （`{ id:'hex:<id>', key:'hex:<id>', params:{ ...effect, hexId, rarity, battle:{ dmgPct } }, data:{ hexId, rarity } }`），
// 所以本套件不依赖 content/hextech.js 的接线是否已经落地。`content: 'generic'` 让 installContent 不跑
// content/hextech.js 的 `install()`、也不装盟约内容（层数只当数据用），于是这些数字只可能来自被测模块。
//
// 覆盖（设计稿 §0 已确认口径 + §3.2 的每条关键路径，一条一个 test）：
//   没有卡 ⇒ install 0、什么都不发生；N=4 ⇒ 5 名档整段不生效（不刷怪、无面板 buff）；
//   击杀金币：4 杀 +1 金、全队共享（两名干员各 2 杀 = 4 杀）、跨撤退保留、每场上限 min(9, 1+floor(L/50))
//             （L=0→1 / L=50→2 / L=450→封顶 9）、到上限后不再发、只认己方【卡西米尔】干员亲手击杀；
//   5 名档刷怪：L=0/60/150/250/350/450 各档的数量与种类（累计、≥400 不再增加），N=4 不刷；
//   5 名档等阶最高：atk 面板 +30+L、rangeExtend +1（攻击范围键真的变多），并列最高都加、低阶不加；
//   7 名档金币伤害：params.battle.dmgPct=40、N=7 ⇒ 所有己方干员 dmgDealtMul 1.4（含非卡西米尔），N=6 不挂、0 不挂；
//   参数读卡面：换一组参数，击杀步长 / 金币基数 / 攻击力 / 攻击范围 / 刷怪表全部跟着变。
//
// [ASSUMED]（模块头注释里有完整口径，这里是测试侧的断言口径）：
//   1. 「在场」= `alive && deployed && !hidden`（hexHooks.onField），N 按 `baseChessId` 去重。
//   2. 击杀只认**干员**（`kind === 'op'`）亲手打死的敌人：召唤物 / 无来源伤害不算「〖卡西米尔〗干员击杀」。
//   3. 「等阶最高」按 `tierOf`（干员记录的 tier）比较，并列最高**都加**。
//   4. 金币伤害给**所有**己方干员（不只卡西米尔）—— 业主 §0 明确「不只卡西米尔」。
//   5. 运行时刷怪不进 HUD 分母 / 备战预览（`spawnEnemy` 默认 `inTotal: false`），也不加敌方缩放。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { hexHooks } from '../../server/sim/content/hexcards/hooks.js';
import { installKazimierzKnightGold } from '../../server/sim/content/hexcards/stone_kazimierz_knightgold.js';
import { bondLayers } from '../../server/sim/content/support/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HEXTECH = JSON.parse(readFileSync(path.join(ROOT, 'data', 'hextech.json'), 'utf8'));

/** 设计稿 §2 的参数（卡面 effect 就是这一份；模块只读卡面）。 */
const KG = Object.freeze({
  killStep: 4, goldBase: 1, goldPerLayer: 50, goldCap: 9,
  highCount: 5, atkFlat: 30, atkPerLayer: 1, rangeExtend: 1,
  enemyTiers: [
    { min: 0, key: 'enemy_1183_mlasrt', count: 1 },
    { min: 50, key: 'enemy_1183_mlasrt', count: 1 },
    { min: 100, key: 'enemy_1184_cadkgt_3', count: 1 },
    { min: 200, key: 'enemy_1513_dekght', count: 1 },
    { min: 300, key: 'enemy_1513_dekght_2', count: 1 },
  ],
  sevenCount: 7,
});

const CARD = 'hex_kazimierz_knightgold';
const SPEC = 'kazimierzKnightGold';
/** 5 名档面板加成的 buff 键（与模块一致）。 */
const HIGH_KEY = 'hex:knightgold:high';
/** 7 名档金币伤害的 buff 键（与模块一致）。 */
const DMG_KEY = 'hex:knightgold:dmg';

/** 刷怪表里四种敌人的 id（与卡面 enemyTiers 对应）。 */
const MLASRT = 'enemy_1183_mlasrt';
const CADKGT = 'enemy_1184_cadkgt_3';
const DEKGHT = 'enemy_1513_dekght';
const DEKGHT2 = 'enemy_1513_dekght_2';

/**
 * One playerEffects entry, the shape server/match/hextech.js addHexRef writes. `effect` overrides the design values
 * (a card whose record carries different numbers — the module must read them). `battleParams` is the prep-side pot
 * (`applySpec` `goldDamage` writes `params.battle.dmgPct`).
 */
function refOf(hexId, key, effect, battleParams = null, rarity = 'gold') {
  const rec = HEXTECH.playerHexes[hexId];
  const params = { [key]: { ...effect }, hexId, rarity: (rec && rec.rarity) || rarity };
  if (battleParams) params.battle = { ...battleParams };
  return {
    id: `hex:${hexId}`, key: `hex:${hexId}`,
    name: (rec && rec.name) || hexId, desc: (rec && rec.desc) || '', iconKind: 'hex', iconId: hexId,
    counter: null, battle: true,
    params,
    data: { hexId, rarity: (rec && rec.rarity) || rarity },
  };
}

/** 卡西米尔干员：0 防御、0 攻击（整场安静，数字只来自测试自己打的那几发），射程两格。 */
const kzOp = (id, o = {}) => chessRec({
  id, bonds: ['kazimierzShip'],
  stats: { maxHp: 2000, atk: 0, def: 0, res: 0, blockCnt: 1, respawnTime: 20 },
  rangeGrid: [[0, 0], [0, 1]],
  ...o,
});

/** 不属于任何一个盟约的干员（证明「是不是卡西米尔成员」才是判据）。 */
const plainOp = (id) => chessRec({
  id, bonds: [],
  stats: { maxHp: 2000, atk: 0, def: 0, res: 0, blockCnt: 1, respawnTime: 20 },
  rangeGrid: [[0, 0], [0, 1]],
});

/** 七名不同干员（`baseChessId` 各不相同 ⇒ 数「不同干员」时各算一个）。 */
const KZ_IDS = ['test_kz1', 'test_kz2', 'test_kz3', 'test_kz4', 'test_kz5', 'test_kz6', 'test_kz7'];

/** 一个血厚、不动、不还手的敌人：整场安静（默认就一只，保证战斗不会因为「没有敌人」而提前结束）。 */
const dummy = () => enemyRec({ key: 'enemy_dummy', hp: 1000000, atk: 0, def: 0, speed: 0 });

/** 测试用的数据表（七名卡西米尔干员 + 一名非成员 + 木桩敌人）。 */
function defsOf() {
  const chess = {};
  for (const id of KZ_IDS) chess[id] = kzOp(id);
  chess.test_plain = plainOp('test_plain');
  return { chess, enemies: { enemy_dummy: dummy() } };
}

/** 盟约状态（战斗内加层的活数据：`bondLayers` 读 `layers`）。 */
const bondsOf = (o = {}) => ({ kazimierzShip: { count: 5, active: true, tier: 2, layers: 0, ...(o.kazimierzShip || {}) } });

/** 一个席位（多玩家场：seat 1 落在 +8 列外）。 */
const seat = (playerId, i, { effects = [], units = [], bonds = {} } = {}) => ({
  playerId, seat: i, side: 'L', colOffset: i === 0 ? 0 : 8, bonds, playerEffects: effects, units,
});
/** 棋盘上的一枚棋子。 */
const at = (uid, row, col, chessId) => ({ uid, kind: 'chess', chessId, row, col });

/** 平关的 7 个可部署地面格（row 9 的 'r' 一排 + row 10 的第一个 'r'）。 */
const TILES = [[9, 3], [9, 4], [9, 5], [9, 6], [9, 7], [9, 8], [9, 9], [10, 3], [10, 4]];

/** 把若干干员 id 摆到棋盘上（uid 从 1 起，位置按 TILES 顺序）。 */
const board = (ids) => ids.map((id, i) => at(i + 1, TILES[i][0], TILES[i][1], id));

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
    hooks: ['kill', 'battleStart', 'deploy', 'layerGain', 'enemySpawn'],
  });
}

/** 带卡的一个席位 + 若干干员（effect 默认就是设计稿那组参数）。 */
const seatWithCard = (units, { effect = KG, battleParams = null, bonds = bondsOf(), playerId = 'p1', seatIndex = 0 } = {}) =>
  seat(playerId, seatIndex, { effects: [refOf(CARD, SPEC, effect, battleParams)], units, bonds });

/** 场上（活着 / 已部署 / 未隐匿）的己方干员，按 uid 排序（断言顺序稳定）。 */
const alliesOnField = (h, pid = 'p1') => h.battle.allyUnits
  .filter((u) => u && u.kind === 'op' && u.side === 'ally' && u.ownerId === pid && u.alive && u.deployed && !u.hidden)
  .sort((a, b) => a.uid - b.uid);

/** 按 defId 找一名己方干员。 */
const opOf = (h, defId, pid = 'p1') => h.battle.allyUnits.find((u) => u && u.ownerId === pid && u.defId === defId) || null;

/** 一名玩家在【卡西米尔】上的实时层数。 */
const layersOf = (h, pid = 'p1') => bondLayers(h.battle, pid, 'kazimierzShip');

/** 场上的敌人（按 defId，排除那只会一直在场的木桩）。 */
const spawnedIds = (h) => h.battle.enemies.filter((e) => e && e.alive && e.defId !== 'enemy_dummy').map((e) => e.defId);

/** 现刷一只木桩并让 `u` 打死它（击杀计数走引擎的 `kill` 钩子，与真实击杀同一条路径）。 */
function killDummy(h, u) {
  const e = h.battle.spawnEnemy('enemy_dummy', { routeIndex: 0 });
  assert.ok(e, 'premise: 木桩刷出来了');
  h.battle.kill(e, u);
  return e;
}

/** 连杀 `n` 只木桩。 */
const killDummies = (h, u, n) => { for (let i = 0; i < n; i++) killDummy(h, u); };

/**
 * 一名玩家这一场拿到的金币。引擎把战斗内的资金记在 `_perPlayer[pid].coins`（`battle.getPlayer(pid)` 返回的席位状态
 * 只有 dp / bonds / playerEffects；`addCoins` 加的就是 `_perPlayer` 这一份），结算时进 `result.perPlayer[pid].coins`。
 */
const purseOf = (h, pid = 'p1') => h.battle._perPlayer[pid].coins;

// =====================================================================================================================
// 没有卡 / 不到 5 名档

test('骑士金神: 没有这张卡 ⇒ install 返回 0，击杀不给金币、不刷怪、不挂任何 buff', () => {
  const h = field([seat('p1', 0, { effects: [], units: board(KZ_IDS.slice(0, 5)), bonds: bondsOf() })]);
  const inst = installKazimierzKnightGold(hexHooks(h.battle));
  assert.equal(inst, 0, '没有卡 ⇒ install 返回 0');
  h.step(1);
  const u = opOf(h, 'test_kz1');
  killDummies(h, u, 8);
  assert.equal(purseOf(h), 0, '一枚金币都不发');
  assert.equal(spawnedIds(h).length, 0, '没有额外刷怪');
  assert.equal(alliesOnField(h).filter((a) => a.findBuff(HIGH_KEY)).length, 0, '没有面板 buff');
  assert.equal(alliesOnField(h).filter((a) => a.findBuff(DMG_KEY)).length, 0, '没有金币伤害 buff');
  h.invariants();
});

test('骑士金神: 在场只有 4 名不同卡西米尔 ⇒ 5 名档整段不生效（不刷怪、没有面板 buff）', () => {
  // L 拉满到 450：如果 5 名档被误判，这里会刷满 5 只
  const h = field([seatWithCard(board(KZ_IDS.slice(0, 4)), { bonds: bondsOf({ kazimierzShip: { layers: 450 } }) })]);
  const inst = installKazimierzKnightGold(hexHooks(h.battle));
  h.step(1);
  assert.equal(spawnedIds(h).length, 0, 'N=4 ⇒ 一只都不刷');
  assert.equal(alliesOnField(h).filter((a) => a.findBuff(HIGH_KEY)).length, 0, 'N=4 ⇒ 没有等阶最高 buff');
  assert.equal(inst.spawned, 0);
  h.invariants();
});

// =====================================================================================================================
// 击杀金币（无门槛）

test('骑士金神: 卡西米尔干员击杀 4 个敌人 ⇒ 得到 1 金（第 5 杀起不再发，L=0 的上限就是 1）', () => {
  const h = field([seatWithCard(board(['test_kz1']))]);
  installKazimierzKnightGold(hexHooks(h.battle));
  h.step(1);
  const u = opOf(h, 'test_kz1');
  assert.equal(purseOf(h), 0, 'premise: 开战 0 金');

  killDummies(h, u, 3);
  assert.equal(purseOf(h), 0, '3 杀还不够 4 杀');

  killDummies(h, u, 1);
  assert.equal(purseOf(h), 1, '第 4 杀 ⇒ +1 金');

  killDummies(h, u, 8);
  assert.equal(purseOf(h), 1, 'L=0 的上限是 1，之后不再发');
  h.invariants();
});

test('骑士金神: 击杀计数全队共享 —— 两名卡西米尔干员各 2 杀也算满 4 杀', () => {
  const h = field([seatWithCard(board(['test_kz1', 'test_kz2']))]);
  installKazimierzKnightGold(hexHooks(h.battle));
  h.step(1);
  const a = opOf(h, 'test_kz1');
  const b = opOf(h, 'test_kz2');

  killDummies(h, a, 2);
  assert.equal(purseOf(h), 0, '2 杀还不够');
  killDummies(h, b, 2);
  assert.equal(purseOf(h), 1, '另一名干员补满 4 杀 ⇒ +1 金（计数是全队共享的一份）');
  h.invariants();
});

test('骑士金神: 击杀计数跨撤退保留 —— 先撤掉一名干员，剩下那名干员接着凑满 4 杀照样 +1 金', () => {
  const h = field([seatWithCard(board(['test_kz1', 'test_kz2']))]);
  installKazimierzKnightGold(hexHooks(h.battle));
  h.step(1);
  const a = opOf(h, 'test_kz1');
  const b = opOf(h, 'test_kz2');

  killDummies(h, a, 2);
  h.battle.retreat(a, { reason: 'retreat', permanent: true });
  assert.equal(a.alive, false, 'premise: 干员已离场');
  killDummies(h, b, 2);
  assert.equal(purseOf(h), 1, '计数挂在 per-battle store 上，跨死亡 / 撤退保留');
  h.invariants();
});

test('骑士金神: 每场上限 = min(9, 1 + floor(L/50)) —— L=0→1、L=50→2、L=450→封顶 9', () => {
  for (const [layers, cap] of [[0, 1], [50, 2], [450, 9]]) {
    const h = field([seatWithCard(board(['test_kz1']), { bonds: bondsOf({ kazimierzShip: { layers } }) })]);
    installKazimierzKnightGold(hexHooks(h.battle));
    h.step(1);
    assert.equal(layersOf(h), layers, `premise: 层数 ${layers}`);
    const u = opOf(h, 'test_kz1');
    // 发满这一场上限，再多杀 8 只：多出来的击杀一枚金币都换不到
    killDummies(h, u, 4 * cap + 8);
    assert.equal(purseOf(h), cap, `L=${layers} ⇒ 上限 ${cap}`);
    h.invariants();
  }
});

test('骑士金神: 只认己方【卡西米尔】干员的击杀 —— 非成员、别人的干员、无来源死亡都不算', () => {
  const h = field([
    seatWithCard(board(['test_plain', 'test_kz1'])),
    seat('p2', 1, { effects: [], units: [at(9, 9, 6, 'test_kz2')], bonds: bondsOf() }),
  ], { kind: 'unite' });
  installKazimierzKnightGold(hexHooks(h.battle));
  h.step(1);
  const plain = opOf(h, 'test_plain');
  const theirs = opOf(h, 'test_kz2', 'p2');
  assert.ok(plain && theirs, 'premise: 两名干员都在场');

  killDummies(h, plain, 4);                       // 自己的非卡西米尔干员
  assert.equal(purseOf(h), 0, '非成员击杀不算');
  killDummies(h, theirs, 4);                      // 别人的卡西米尔干员
  assert.equal(purseOf(h), 0, '别人的干员不归这张卡管');
  assert.equal(purseOf(h, 'p2'), 0, 'p2 没有这张卡');
  // 无来源死亡（地形 / 流失一类）：killer 为 null
  const e = h.battle.spawnEnemy('enemy_dummy', { routeIndex: 0 });
  h.battle.kill(e, null);
  assert.equal(purseOf(h), 0, '无来源击杀不算');
  h.invariants();
});

// =====================================================================================================================
// 5 名档 · 敌人增加

test('骑士金神: 5 名档按层数累计刷怪 —— L=0/60/150/250/350/450 分别刷 1/2/3/4/5/5 只', () => {
  const cases = [
    [0, [MLASRT]],
    [60, [MLASRT, MLASRT]],
    [150, [MLASRT, MLASRT, CADKGT]],
    [250, [MLASRT, MLASRT, CADKGT, DEKGHT]],
    [350, [MLASRT, MLASRT, CADKGT, DEKGHT, DEKGHT2]],
    [450, [MLASRT, MLASRT, CADKGT, DEKGHT, DEKGHT2]],
  ];
  for (const [layers, expected] of cases) {
    const h = field([seatWithCard(board(KZ_IDS.slice(0, 5)), { bonds: bondsOf({ kazimierzShip: { layers } }) })]);
    const inst = installKazimierzKnightGold(hexHooks(h.battle));
    h.step(1);
    const ids = spawnedIds(h).sort();
    assert.deepEqual(ids, [...expected].sort(), `L=${layers} 的刷怪表`);
    assert.equal(inst.spawned, expected.length, `L=${layers} 一共 ${expected.length} 只`);
    // 运行时刷怪不进 HUD 分母：stage 自己排队的那只木桩才是 inTotal
    const inTotal = h.battle.enemies.filter((e) => e && e.inTotal).map((e) => e.defId);
    assert.deepEqual(inTotal, ['enemy_dummy'], `L=${layers}: 刷出来的这批不计入 HUD 分母`);
    h.invariants();
  }
});

test('骑士金神: 5 名档的刷怪只在战斗开始时发生一次（层数后来涨上去也不会补刷）', () => {
  const h = field([seatWithCard(board(KZ_IDS.slice(0, 5)))]);
  const inst = installKazimierzKnightGold(hexHooks(h.battle));
  h.step(1);
  assert.equal(inst.spawned, 1, 'premise: L=0 刷 1 只');
  // 战斗内加层到 350：卡面写的是「战斗开始时敌人增加」，所以本场不再补刷
  h.battle.addLayers('p1', 'kazimierzShip', 350, 'hex');
  h.run(1);
  assert.equal(layersOf(h), 350, 'premise: 层数涨上去了');
  assert.equal(inst.spawned, 1, '本场不补刷');
  assert.equal(spawnedIds(h).length, 1);
  h.invariants();
});

// =====================================================================================================================
// 5 名档 · 等阶最高的干员

test('骑士金神: 等阶最高的卡西米尔干员攻击力 +30+L、攻击范围 +1 格（低阶一点不加）', () => {
  const defs = defsOf();
  defs.chess.test_kz_top = kzOp('test_kz_top', { tier: 3 });
  defs.chess.test_kz_top2 = kzOp('test_kz_top2', { tier: 3 });
  defs.chess.test_kz_low = kzOp('test_kz_low', { tier: 1 });
  defs.chess.test_kz_mid = kzOp('test_kz_mid', { tier: 2 });
  const h = makeBattle({
    kind: 'normal', content: 'generic', defs,
    players: [seatWithCard(board(['test_kz_top', 'test_kz_top2', 'test_kz_mid', 'test_kz_low', 'test_kz1']), {
      bonds: bondsOf({ kazimierzShip: { layers: 40 } }),
    })],
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }],
    autoFinish: false, timeLimit: 60, captureNoisy: true,
    hooks: ['kill', 'battleStart', 'deploy', 'layerGain'],
  });
  installKazimierzKnightGold(hexHooks(h.battle));
  h.run(1);

  const top = opOf(h, 'test_kz_top');
  const top2 = opOf(h, 'test_kz_top2');
  const mid = opOf(h, 'test_kz_mid');
  const low = opOf(h, 'test_kz_low');

  // 攻击力：基础 0（kzOp 的 atk 是 0）+ 30 + 1×40 = 70
  assert.equal(top.s.atk, 70, '并列最高的第一名：+30 + 1×L');
  assert.equal(top2.s.atk, 70, '并列最高都加');
  assert.equal(mid.s.atk, 0, '低阶不加');
  assert.equal(low.s.atk, 0, '低阶不加');

  // 攻击范围：+1 格（引擎的 rangeExtend，buff 一挂就刷新 rangeKeys）
  assert.equal(top.s.rangeExtend, 1, 'rangeExtend +1');
  assert.equal(mid.s.rangeExtend, 0, '低阶没有');
  assert.ok(top.rangeKeys.length > mid.rangeKeys.length, `攻击范围键变多（${top.rangeKeys.length} > ${mid.rangeKeys.length}）`);
  assert.ok(top.findBuff(HIGH_KEY), '挂着常驻 buff');
  assert.equal(mid.findBuff(HIGH_KEY), null);
  h.invariants();
});

test('骑士金神: 等阶最高 buff 随层数刷新 —— layerGain 之后按新的 L 重算攻击力', () => {
  const defs = defsOf();
  defs.chess.test_kz_top = kzOp('test_kz_top', { tier: 3 });
  const h = makeBattle({
    kind: 'normal', content: 'generic', defs,
    players: [seatWithCard(board(['test_kz_top', 'test_kz2', 'test_kz3', 'test_kz4', 'test_kz5']))],
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }],
    autoFinish: false, timeLimit: 60, captureNoisy: true,
    hooks: ['kill', 'battleStart', 'deploy', 'layerGain'],
  });
  installKazimierzKnightGold(hexHooks(h.battle));
  h.run(1);
  const top = opOf(h, 'test_kz_top');
  assert.equal(top.s.atk, 30, 'L=0 ⇒ +30');

  h.battle.addLayers('p1', 'kazimierzShip', 100, 'hex');
  h.run(1);
  assert.equal(layersOf(h), 100, 'premise: 层数到了 100');
  assert.equal(top.s.atk, 130, 'L=100 ⇒ +30 + 100');
  h.invariants();
});

test('骑士金神: 掉到 4 名在场时，等阶最高的 buff 被撤销（不是留一个旧值）', () => {
  const h = field([seatWithCard(board(KZ_IDS.slice(0, 5)))]);
  installKazimierzKnightGold(hexHooks(h.battle));
  h.step(1);
  const gone = opOf(h, 'test_kz1');
  assert.ok(gone.findBuff(HIGH_KEY), 'premise: 5 名在场 ⇒ 挂着 buff');

  h.battle.retreat(gone, { reason: 'retreat', permanent: true });
  // 任何一次复核（这里走引擎真实的 `layerGain` 钩子：别的来源给【卡西米尔】加层）都会重新数 N
  h.battle.addLayers('p1', 'kazimierzShip', 10, 'hex');
  assert.equal(opOf(h, 'test_kz2').findBuff(HIGH_KEY), null, 'N 掉到 4 ⇒ 撤销');
  assert.equal(opOf(h, 'test_kz1').findBuff(HIGH_KEY), null, '离场的那名也撤销');
  h.run(1);
  assert.equal(opOf(h, 'test_kz2').findBuff(HIGH_KEY), null, '结算之后仍然不挂（不是留一个旧值）');
  h.invariants();
});

// =====================================================================================================================
// 7 名档 · 金币伤害

test('骑士金神: 7 名档 + dmgPct 40 ⇒ 所有己方干员伤害 ×1.4（非卡西米尔也吃）', () => {
  const h = field([seatWithCard(board([...KZ_IDS, 'test_plain']), { battleParams: { dmgPct: 40 } })]);
  installKazimierzKnightGold(hexHooks(h.battle));
  h.step(1);

  const mine = alliesOnField(h);
  assert.equal(mine.length, 8, 'premise: 7 名卡西米尔 + 1 名非成员都在场');
  for (const u of mine) {
    assert.equal(u.s.dmgDealtMul, 1.4, `${u.defId}: dmgDealtMul = 1 + 40/100`);
    assert.ok(u.findBuff(DMG_KEY), `${u.defId}: 挂着金币伤害 buff`);
  }
  h.invariants();
});

test('骑士金神: 只有 6 名在场时金币伤害不挂（7 名档未达成）', () => {
  const h = field([seatWithCard(board([...KZ_IDS.slice(0, 6), 'test_plain']), { battleParams: { dmgPct: 40 } })]);
  installKazimierzKnightGold(hexHooks(h.battle));
  h.step(1);
  for (const u of alliesOnField(h)) {
    assert.equal(u.s.dmgDealtMul, 1, `${u.defId}: N=6 ⇒ 不挂`);
    assert.equal(u.findBuff(DMG_KEY), null);
  }
  h.invariants();
});

test('骑士金神: dmgPct 为 0（本回合没花钱）⇒ 不挂金币伤害', () => {
  const h = field([seatWithCard(board(KZ_IDS), { battleParams: { dmgPct: 0 } })]);
  installKazimierzKnightGold(hexHooks(h.battle));
  h.step(1);
  for (const u of alliesOnField(h)) {
    assert.equal(u.s.dmgDealtMul, 1, `${u.defId}: dmgPct 0 ⇒ 不挂`);
    assert.equal(u.findBuff(DMG_KEY), null);
  }
  h.invariants();
});

test('骑士金神: 金币伤害可叠 —— dmgPct 100 ⇒ ×2', () => {
  const h = field([seatWithCard(board(KZ_IDS), { battleParams: { dmgPct: 100 } })]);
  installKazimierzKnightGold(hexHooks(h.battle));
  h.step(1);
  assert.equal(opOf(h, 'test_kz1').s.dmgDealtMul, 2, '1 + 100/100');
  h.invariants();
});

// =====================================================================================================================
// 参数读卡面

test('骑士金神: 数字读卡面 —— 换一组参数，击杀步长 / 金币基数 / 攻击力 / 范围 / 刷怪表全部跟着变', () => {
  const custom = {
    killStep: 2, goldBase: 2, goldPerLayer: 10, goldCap: 5,
    highCount: 5, atkFlat: 50, atkPerLayer: 2, rangeExtend: 2,
    enemyTiers: [{ min: 0, key: 'enemy_dummy', count: 2 }],
    sevenCount: 7,
  };
  const h = field([seatWithCard(board(KZ_IDS.slice(0, 5)), { effect: custom })]);
  const inst = installKazimierzKnightGold(hexHooks(h.battle));
  h.step(1);

  // 刷怪表：只有一档，刷 2 只（木桩）
  assert.equal(inst.spawned, 2, 'enemyTiers 读卡面');
  // 面板：+50 + 2×L（L=0 ⇒ 50），范围 +2
  const any = alliesOnField(h)[0];
  assert.equal(any.s.atk, 50, 'atkFlat 50 从卡面读出来');
  assert.equal(any.s.rangeExtend, 2, 'rangeExtend 2 从卡面读出来');
  // 击杀金币：killStep 2 ⇒ 2 杀 +1 金；goldBase 2 ⇒ L=0 的上限是 2
  const u = opOf(h, 'test_kz1');
  killDummies(h, u, 2);
  assert.equal(purseOf(h), 1, 'killStep 2 ⇒ 2 杀 1 金');
  killDummies(h, u, 2);
  assert.equal(purseOf(h), 2, 'goldBase 2 ⇒ 本场上限 2');
  killDummies(h, u, 8);
  assert.equal(purseOf(h), 2, '到上限后不再发');
  h.invariants();
});

test('骑士金神: 数据表里这张卡的记录与设计稿口径一致（接线用）', () => {
  const rec = HEXTECH.playerHexes[CARD];
  assert.ok(rec, 'data/hextech.json 里有这张卡');
  assert.equal(rec.rarity, 'gold', '2 阶 / gold');
  assert.equal(rec.requiresBond, 'kazimierzShip', 'requiresBond: kazimierzShip');
  const spec = rec.effect[SPEC];
  assert.ok(spec, `effect.${SPEC} 存在`);
  assert.equal(spec.killStep, 4);
  assert.equal(spec.goldBase, 1);
  assert.equal(spec.goldPerLayer, 50);
  assert.equal(spec.goldCap, 9);
  assert.equal(spec.highCount, 5);
  assert.equal(spec.atkFlat, 30);
  assert.equal(spec.atkPerLayer, 1);
  assert.equal(spec.rangeExtend, 1);
  assert.equal(spec.sevenCount, 7);
  assert.deepEqual(spec.enemyTiers.map((t) => [t.min, t.key, t.count]), [
    [0, MLASRT, 1], [50, MLASRT, 1], [100, CADKGT, 1], [200, DEKGHT, 1], [300, DEKGHT2, 1],
  ]);
  assert.deepEqual(rec.effect.onSpend, { goldDamage: { per: 3, pct: 20 } }, '备战侧：每 3 金 +20%');
  assert.deepEqual(rec.effect.onRoundStart, { goldDamageReset: true }, '备战侧：回合开始清零');
});
