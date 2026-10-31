// test/sim/hex-stone-victoria-decay.test.js — 2 阶盟约专属协议源石 维多利亚【衰朽的骄矜】(hex_victoria_decay) 的
// 战斗半边：server/sim/content/hexcards/stone_victoria_decay.js 的 installVictoriaDecay。
//
// 设计稿：04-文档/协议源石-专属协议-衰朽的骄矜与炎百兽-设计稿-20261031.md §1（业主原文见模块头注释）。
//
// 驱动方式与 hex-stone-kjerag-laterano.test.js 一致：真实 sim Battle（test/helpers/battleHarness.js 的
// makeBattle / chessRec / enemyRec）+ 生产用的 `hexHooks(battle)` 手工安装，effect ref 按 server/match/hextech.js
// `addHexRef` 的形状手搓（`{ id:'hex:<id>', key:'hex:<id>', params:{ [key]: {...effect}, hexId, rarity }, data:{ hexId, rarity } }`），
// 所以本套件不依赖 content/hextech.js 的接线是否已经落地。`content: 'generic'` 让 installContent 不跑
// content/hextech.js 的 `install()`、也不装盟约内容（层数只当数据用），于是这些数字只可能来自被测模块。
//
// 覆盖（设计稿 §1.3 的每条关键路径，一条一个 test）：
//   无卡无效果；N 按 baseChessId 去重；N=2 / 4 / 6 各档不触发；3 名档无视防御法抗 + 每秒流失 0.5%；5 名档面板
//   （生命 >80% 才挂、掉到门槛下撤销、层数随 L 增长）+ 额外流失（装备维式重锤为 0）；7 名档再额外 1%；
//   衰朽（锁血 / 阻挡归零 / 攻击力 +100% / 攻速 +7、3 杀回 50% 最大生命并脱离、不足 3 杀强制撤退、窗口内第二次致命
//   不重复进入也不延长、本场第二次致命正常阵亡、别人的干员 / 非成员不管）；参数读卡面。
//
// [ASSUMED]（模块头注释里有完整口径，这里是测试侧的断言口径）：
//   1. N = 场上己方【维多利亚】干员按 `baseChessId` 去重的数量（普通 / 精锐同名只算一个），不是 `bondState.count`。
//   2. 「在场」= alive && deployed && !hidden（`hexHooks.onField`）；被击倒的干员不流失、不挂面板。
//   3. 流失是**每秒一次**（`battle.every(1)`，第一个脉冲在 t = 1s），按**当时**的最大生命上限算；面板加成抬高的上限
//      也算在里面，且引擎在 maxHp 变化时按比例缩放当前 HP（units.js `_recalc`），所以满血干员挂上 buff 后仍是满血。
//   4. 「生命值高于 80%」按当前（含本卡）maxHp 判，严格大于。
//   5. 衰朽的击杀只算**该干员自己的**、敌方单位、且在 8 秒窗口内；回复量按结算时的最大生命上限算。

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { hexHooks } from '../../server/sim/content/hexcards/hooks.js';
import { installVictoriaDecay } from '../../server/sim/content/hexcards/stone_victoria_decay.js';
import { makeDamageInfo } from '../../server/sim/damage.js';

const CARD = 'hex_victoria_decay';
const KEY = 'victoriaDecay';
/** 5 名档面板加成的 buff 键（与模块一致；条件不满足时按它撤销）。 */
const STAT_KEY = 'hex:victoriadecay:stat';
/** 衰朽期间的 buff 键。 */
const DECAY_KEY = 'hex:victoriadecay:decay';

/** 设计稿 §1.2 的卡面参数（模块只读卡面；测试也用这一份做基准，改参数即改结果）。 */
const VD = Object.freeze({
  equipCount: 3, drainPct: 0.5,
  buffCount: 5, buffHpPct: 80, hpFlat: 50, hpPerLayer: 10, defFlat: 50, defPerLayer: 3,
  atkFlat: 100, atkPerLayer: 5, aspd: 7, aspdPerLayer: 0.5,
  extraDrainPct: 0.5,
  hammerKeys: ['chess_item_1_01_e', 'chess_item_2_03_e', 'chess_item_3_09_e', 'chess_item_3_10_e', 'chess_item_4_09_e'],
  highCount: 7, highDrainPct: 1,
  decaySec: 8, decayKills: 3, decayAtkPct: 100, decayAspd: 7, decayAspdPerLayer: 0.5, decayHealPct: 50,
});

/** One playerEffects entry, the shape server/match/hextech.js addHexRef writes. `effect` overrides the design values. */
const refOf = (effect = VD) => ({
  id: `hex:${CARD}`, key: `hex:${CARD}`, name: CARD, desc: '', iconKind: 'hex', iconId: CARD,
  counter: null, battle: true,
  params: { [KEY]: { ...effect }, hexId: CARD, rarity: 'gold' },
  data: { hexId: CARD, rarity: 'gold' },
});

/** 【维多利亚】干员：2000 生命 / 500 攻击 / 0 防御 / 2 阻挡（衰朽要看得见阻挡归零）。 */
const vicOp = (n, o = {}) => chessRec({
  id: `test_vic${n}`, bonds: ['victoriaShip'],
  stats: { maxHp: 2000, atk: 500, def: 0, res: 0, blockCnt: 2, respawnTime: 20 }, skill: null, ...o,
});
/** 不属于任何一个盟约的干员（证明判据是「是不是维多利亚干员」，不是「是不是干员」）。 */
const plainOp = (o = {}) => chessRec({
  id: 'test_plain', bonds: [], stats: { maxHp: 2000, atk: 500, def: 0, res: 0, blockCnt: 2, respawnTime: 20 }, skill: null, ...o,
});

const CHESS = {
  test_vic1: vicOp(1), test_vic2: vicOp(2), test_vic3: vicOp(3), test_vic4: vicOp(4),
  test_vic5: vicOp(5), test_vic6: vicOp(6), test_vic7: vicOp(7),
  // 同名干员的精锐形态：`baseChessId` 与 test_vic1 相同 ⇒ N 只算一名
  test_vic1b: vicOp(1, { id: 'test_vic1b', baseId: 'test_vic1', golden: true }),
  test_plain: plainOp(),
};

/** 血厚、不动、不还手的靶子；`enemy_armor` 带 500 防御 / 50 法抗（量「无视防御法抗」）；`enemy_weak` 一击就倒。 */
const ENEMIES = {
  enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1000000, atk: 0, def: 0, res: 0, speed: 0 }),
  enemy_armor: enemyRec({ key: 'enemy_armor', hp: 1000000, atk: 0, def: 500, res: 50, speed: 0 }),
  enemy_weak: enemyRec({ key: 'enemy_weak', hp: 10, atk: 0, def: 0, res: 0, speed: 0 }),
};

/** 盟约状态（战斗内加层的活数据：面板 buff 的「随层数增长」读这里的 layers）。 */
const bondsOf = (layers = 0) => ({ victoriaShip: { count: 3, active: true, tier: 1, layers } });

/** 一个席位（多玩家场：seat 1 落在 +8 列外）。 */
const seat = (playerId, i, { effects = [], units = [], bonds = {} } = {}) => ({
  playerId, seat: i, side: 'L', colOffset: i === 0 ? 0 : 8, bonds, playerEffects: effects, units,
});
/** 棋盘上的一枚棋子（`items` = 装备的具体 id）。 */
const at = (uid, row, col, chessId, items) => ({ uid, kind: 'chess', chessId, row, col, ...(items ? { items } : null) });

/** 一个安静的测试场（不自动结束；敌人停在 [12,2]，够不着 row 9 的干员）。 */
function field(players, { enemies = [{ key: 'enemy_dummy', time: 0, route: 0, pos: [12, 2] }] } = {}) {
  return makeBattle({
    kind: players.length > 1 ? 'unite' : 'normal',
    content: 'generic',
    defs: { chess: CHESS, enemies: ENEMIES },
    players,
    enemies,
    autoFinish: false,
    timeLimit: 30,
    captureNoisy: true,
    hooks: ['hit', 'fatal', 'kill', 'battleStart', 'deploy'],
  });
}

/** 全场干员（按 uid 顺序）。 */
const ops = (h) => h.battle.allyUnits.filter((u) => u && u.kind === 'op');
/** 一发「攻击命中」实例（目标 500 防御 / 50 法抗时，穿透与否差一倍）。 */
const hitOf = (h, u, foe, over = {}) => h.battle.dealDamage(u, foe, makeDamageInfo({ amount: 1000, type: 'phys', canDodge: false, isAttack: true, ...over }));
/** 致命一击（`fatal` 钩子走这里）。 */
const fatalHit = (h, foe, u) => h.battle.dealDamage(foe, u, makeDamageInfo({ amount: 99999, type: 'true', canDodge: false }));

/** n 名不同维多利亚干员（row 9，col 4 起）。 */
const vicUnits = (n, itemsFor = {}) => Array.from({ length: n }, (_, i) => at(i + 1, 9, 4 + i, `test_vic${i + 1}`, itemsFor[i + 1]));

// =====================================================================================================================
// 无卡 / 阈值以下

test('衰朽的骄矜: 没有这张卡时 install 返回 0，流失 / 面板 / 穿透 / 锁血全部不生效', () => {
  const h = field([seat('p1', 0, {
    effects: [],
    units: vicUnits(5, { 1: ['chess_item_1_02_e_a'] }),
    bonds: bondsOf(),
  })], { enemies: [{ key: 'enemy_armor', time: 0, route: 0, pos: [12, 2] }] });
  const inst = installVictoriaDecay(hexHooks(h.battle));
  assert.equal(inst, 0, '没有卡 ⇒ install 返回 0');
  h.run(2);
  const [a] = ops(h);
  assert.equal(a.hp, 2000, '没有流失');
  assert.equal(a.s.maxHp, 2000, '没有面板加成');
  assert.equal(a.s.atk, 500);
  assert.equal(a.findBuff(STAT_KEY), null);
  const foe = h.enemies()[0];
  assert.equal(hitOf(h, a, foe), 500, '500 防御照常减伤（没有无视防御）');
  assert.equal(h.hooksOf('hit').at(-1).dmg.defIgnorePct, 0);
  fatalHit(h, foe, a);
  assert.equal(a.alive, false, '没有锁血');
  h.invariants();
});

test('衰朽的骄矜: 在场 2 名维多利亚干员时一个效果都不触发', () => {
  const h = field([seat('p1', 0, {
    effects: [refOf()],
    units: vicUnits(2, { 1: ['chess_item_1_02_e_a'] }),
    bonds: bondsOf(),
  })], { enemies: [{ key: 'enemy_armor', time: 0, route: 0, pos: [12, 2] }] });
  const inst = installVictoriaDecay(hexHooks(h.battle));
  h.run(2);
  const [a] = ops(h);
  assert.equal(a.hp, 2000, '不到 3 名：不流失');
  assert.equal(a.findBuff(STAT_KEY), null, '不到 5 名：没有面板');
  assert.equal(inst.drains, 0);
  assert.equal(hitOf(h, a, h.enemies()[0]), 500, '不到 3 名：不穿透');
  assert.equal(h.hooksOf('hit').at(-1).dmg.defIgnorePct, 0);
  h.invariants();
});

test('衰朽的骄矜: N 按 baseChessId 去重 — 普通 + 精锐同名只算一名（3 个单位仍是 N=2）', () => {
  const h = field([seat('p1', 0, {
    effects: [refOf()],
    units: [
      at(1, 9, 4, 'test_vic1', ['chess_item_1_02_e_a']),
      at(2, 9, 5, 'test_vic1b'),        // 同 baseChessId
      at(3, 9, 6, 'test_vic2'),
    ],
    bonds: bondsOf(),
  })], { enemies: [{ key: 'enemy_armor', time: 0, route: 0, pos: [12, 2] }] });
  const inst = installVictoriaDecay(hexHooks(h.battle));
  h.run(2);
  const [a] = ops(h);
  assert.equal(a.hp, 2000, '去重后只有 2 名不同干员 ⇒ 不流失');
  assert.equal(inst.drains, 0);
  assert.equal(hitOf(h, a, h.enemies()[0]), 500, '去重后不到 3 名 ⇒ 不穿透');
  h.invariants();
});

// =====================================================================================================================
// 3 名档

test('衰朽的骄矜: 在场 3 名 — 携带装备者无视防御法抗，每秒流失 0.5% 最大生命', () => {
  const h = field([seat('p1', 0, {
    effects: [refOf()],
    units: vicUnits(3, { 1: ['chess_item_1_02_e_a'] }),
    bonds: bondsOf(),
  })], { enemies: [{ key: 'enemy_armor', time: 0, route: 0, pos: [12, 2] }] });
  const inst = installVictoriaDecay(hexHooks(h.battle));
  h.run(1.5);                                   // 一个脉冲（t = 1）
  const [armed, bare] = ops(h);
  const foe = h.enemies()[0];

  // 每秒流失 0.5% 最大生命（N < 5 ⇒ 没有额外那一份）
  const lost = 2000 - armed.hp;
  assert.ok(Math.abs(lost - 2000 * 0.005) < 1e-6, '每秒流失 0.5% 最大生命 = 10，实际 ' + lost);
  assert.equal(inst.drains, 3, '三名干员各一次');

  // 携带装备者：无视防御 / 法抗
  assert.equal(hitOf(h, armed, foe), 1000, '无视防御：500 点防御被整段穿透');
  const hit = h.hooksOf('hit').at(-1);
  assert.equal(hit.dmg.defIgnorePct, 1);
  assert.equal(hit.dmg.resIgnorePct, 1);
  assert.equal(hitOf(h, armed, foe, { type: 'arts' }), 1000, '无视法抗：50 法抗被整段穿透');

  // 没带装备的维多利亚干员：不穿透
  assert.equal(hitOf(h, bare, foe), 500, '「携带装备的」才无视防御');
  assert.equal(h.hooksOf('hit').at(-1).dmg.defIgnorePct, 0);
  h.invariants();
});

test('衰朽的骄矜: 流失 / 反伤 / 链式附加 / 元素损伤都不吃「无视防御法抗」', () => {
  const h = field([seat('p1', 0, {
    effects: [refOf()],
    units: vicUnits(3, { 1: ['chess_item_1_02_e_a'] }),
    bonds: bondsOf(),
  })], { enemies: [{ key: 'enemy_armor', time: 0, route: 0, pos: [12, 2] }] });
  installVictoriaDecay(hexHooks(h.battle));
  h.run(0.2);
  const [armed] = ops(h);
  const foe = h.enemies()[0];
  const lastDmg = () => h.hooksOf('hit').at(-1).dmg;

  h.b.dealDamage(armed, foe, makeDamageInfo({ amount: 1000, type: 'phys', canDodge: false, tags: ['hpLoss'] }));
  assert.equal(lastDmg().defIgnorePct, 0, '流失不是攻击');

  h.b.dealDamage(armed, foe, makeDamageInfo({ amount: 1000, type: 'phys', canDodge: false, tags: ['counter'] }));
  assert.equal(lastDmg().defIgnorePct, 0, '反伤不是攻击');

  const chained = makeDamageInfo({ amount: 1000, type: 'phys', canDodge: false });
  chained.chained = true;
  h.b.dealDamage(armed, foe, chained);
  assert.equal(lastDmg().defIgnorePct, 0, '链式附加不是攻击');

  const before = h.hooksOf('hit').length;
  h.b.dealDamage(armed, foe, makeDamageInfo({ amount: 10, type: 'element', element: 'burn', canDodge: false }));
  assert.equal(h.hooksOf('hit').length, before, '元素损伤根本走不到 hit 钩子');
  h.invariants();
});

test('衰朽的骄矜: 别人的干员 / 非维多利亚干员不受影响', () => {
  const h = field([
    seat('p1', 0, {
      effects: [refOf()],
      units: [
        at(1, 9, 4, 'test_vic1', ['chess_item_1_02_e_a']),
        at(2, 9, 5, 'test_vic2'),
        at(3, 9, 6, 'test_vic3'),
        at(4, 9, 7, 'test_plain'),
      ],
      bonds: bondsOf(),
    }),
    seat('p2', 1, {
      effects: [],
      units: [at(5, 9, 12, 'test_vic4', ['chess_item_1_02_e_a'])],
      bonds: bondsOf(),
    }),
  ], { enemies: [{ key: 'enemy_armor', time: 0, route: 0, pos: [12, 2] }] });
  installVictoriaDecay(hexHooks(h.battle));
  h.run(1.5);
  const mine = ops(h).find((u) => u.ownerId === 'p1' && u.defId === 'test_vic1');
  const plain = ops(h).find((u) => u.defId === 'test_plain');
  const theirs = ops(h).find((u) => u.ownerId === 'p2');
  const foe = h.enemies()[0];

  assert.equal(hitOf(h, mine, foe), 1000, '自己的维多利亚干员穿透');
  assert.equal(hitOf(h, plain, foe), 500, '非【维多利亚】干员不穿透');
  assert.equal(hitOf(h, theirs, foe), 500, '别人的维多利亚干员不穿透');
  assert.ok(Math.abs(2000 - theirs.hp) < 1e-6, '别人的干员不流失');
  fatalHit(h, foe, theirs);
  assert.equal(theirs.alive, false, '别人的维多利亚干员不进衰朽');
  h.invariants();
});

// =====================================================================================================================
// 5 名档

test('衰朽的骄矜: 在场 4 名时还没有 5 名档（没有面板加成、没有额外流失）', () => {
  const h = field([seat('p1', 0, { effects: [refOf()], units: vicUnits(4), bonds: bondsOf() })]);
  installVictoriaDecay(hexHooks(h.battle));
  h.run(1.5);
  const [a] = ops(h);
  assert.equal(a.findBuff(STAT_KEY), null, '不到 5 名：没有面板');
  assert.equal(a.s.maxHp, 2000);
  assert.equal(a.s.atk, 500);
  assert.ok(Math.abs((2000 - a.hp) - 10) < 1e-6, '只有 3 名档的 0.5%，没有额外那一份');
  h.invariants();
});

test('衰朽的骄矜: 在场 5 名 — 生命 >80% 时生命 +50 防御 +50 攻击 +100 攻速 +7，掉到门槛下撤销', () => {
  const h = field([seat('p1', 0, { effects: [refOf()], units: vicUnits(5), bonds: bondsOf(0) })]);
  installVictoriaDecay(hexHooks(h.battle));
  h.run(0.2);
  const [a] = ops(h);
  assert.equal(a.findBuff(STAT_KEY)?.key, STAT_KEY, '满血 ⇒ 挂上面板 buff');
  assert.equal(a.s.maxHp, 2050, '生命 +50（L=0）');
  assert.equal(a.s.def, 50, '防御 +50');
  assert.equal(a.s.atk, 600, '攻击力 +100');
  assert.equal(a.s.aspd, 107, '攻速 +7');
  assert.equal(a.hp, 2050, '上限提高时当前生命按比例跟上（引擎 units.js _recalc）');

  // 掉到 80% 以下 ⇒ 撤销（0.5s 复核）
  a.hp = 1500;                       // 2050 × 0.8 = 1640
  h.run(0.6);
  assert.equal(a.findBuff(STAT_KEY), null, '低于 80% ⇒ 摘掉');
  assert.equal(a.s.maxHp, 2000);
  assert.equal(a.s.atk, 500);

  // 回到 80% 以上 ⇒ 重新挂上
  a.hp = 2000;
  h.run(0.6);
  assert.equal(a.s.maxHp, 2050, '回到 80% 以上 ⇒ 重新挂上');
  assert.equal(a.s.atk, 600);
  h.invariants();
});

test('衰朽的骄矜: 5 名档的「随层数增长」读【维多利亚】层数', () => {
  const h = field([seat('p1', 0, { effects: [refOf()], units: vicUnits(5), bonds: bondsOf(4) })]);
  installVictoriaDecay(hexHooks(h.battle));
  h.run(0.2);
  const [a] = ops(h);
  assert.equal(a.s.maxHp, 2000 + (50 + 10 * 4), '生命 50+10L = 90');
  assert.equal(a.s.def, 50 + 3 * 4, '防御 50+3L = 62');
  assert.equal(a.s.atk, 500 + (100 + 5 * 4), '攻击 100+5L = 120');
  assert.equal(a.s.aspd, 100 + (7 + 0.5 * 4), '攻速 7+0.5L = 9');

  // 层数变化 ⇒ 复核时跟着刷新
  h.battle.getPlayer('p1').bonds.victoriaShip.layers = 10;
  h.run(0.6);
  assert.equal(a.s.maxHp, 2000 + (50 + 10 * 10), '层数涨到 10 ⇒ 生命 150');
  assert.equal(a.s.atk, 500 + (100 + 5 * 10), '攻击 150');
  h.invariants();
});

test('衰朽的骄矜: 5 名档额外流失 0.5%，装备维式重锤的那名干员为 0', () => {
  const h = field([seat('p1', 0, {
    effects: [refOf()],
    units: vicUnits(5, { 1: ['chess_item_1_01_e_a'] }),   // 维式重锤
    bonds: bondsOf(),
  })]);
  installVictoriaDecay(hexHooks(h.battle));
  h.run(1.5);                                   // 一个脉冲
  const [hammered, ...rest] = ops(h);
  const per = hammered.s.maxHp;                 // 面板加成后的上限
  assert.equal(hammered.s.maxHp, rest[0].s.maxHp, 'premise: 上限一致');
  assert.ok(Math.abs((per - hammered.hp) - per * 0.005) < 1e-6, '装备锤子 ⇒ 只有 0.5%：' + (per - hammered.hp));
  for (const u of rest) {
    assert.ok(Math.abs((per - u.hp) - per * 0.01) < 1e-6, '没装备锤子 ⇒ 0.5% + 0.5%：' + (per - u.hp));
  }
  h.invariants();
});

// =====================================================================================================================
// 7 名档

test('衰朽的骄矜: 在场 6 名时还没有 7 名档；7 名时再额外流失 1%', () => {
  const mk = (n) => {
    const h = field([seat('p1', 0, { effects: [refOf()], units: vicUnits(n), bonds: bondsOf() })]);
    installVictoriaDecay(hexHooks(h.battle));
    h.run(1.5);
    const [a] = ops(h);
    return { lost: a.s.maxHp - a.hp, maxHp: a.s.maxHp };
  };
  const six = mk(6);
  assert.ok(Math.abs(six.lost - six.maxHp * 0.01) < 1e-6, '6 名：0.5% + 0.5% = 1%：' + six.lost);
  const seven = mk(7);
  assert.ok(Math.abs(seven.lost - seven.maxHp * 0.02) < 1e-6, '7 名：0.5% + 0.5% + 1% = 2%：' + seven.lost);
});

// =====================================================================================================================
// 衰朽

test('衰朽的骄矜: 首次致命不撤退 — 锁血进衰朽，阻挡归零、攻击力 +100%、攻速 +7', () => {
  const h = field([seat('p1', 0, { effects: [refOf()], units: [at(1, 9, 4, 'test_vic1')], bonds: bondsOf(0) })]);
  const inst = installVictoriaDecay(hexHooks(h.battle));
  h.run(0.2);
  const [u] = ops(h);
  const foe = h.enemies()[0];
  assert.equal(u.s.blockCnt, 2, 'premise: 进入前的阻挡数');
  const t0 = h.battle.time;

  fatalHit(h, foe, u);
  assert.equal(u.alive, true, '锁血：不撤退');
  assert.equal(u.hp, 1, '引擎把 HP 抬到 1（c.prevented）');
  assert.equal(inst.decays, 1, '进入一次衰朽');
  assert.equal(u.s.blockCnt, 0, '阻挡数归零');
  assert.equal(u.s.atk, 1000, '攻击力 +100%');
  assert.equal(u.s.aspd, 107, '攻速 +7（L=0）');
  assert.equal(u.findBuff(DECAY_KEY)?.key, DECAY_KEY, '衰朽 buff 在身');
  const st = u.mem.victoriaDecay;
  assert.equal(st.used, true);
  assert.equal(st.kills, 0);
  assert.ok(Math.abs(st.until - (t0 + VD.decaySec)) < 1e-6, '窗口 = 8 秒');
  h.invariants();
});

test('衰朽的骄矜: 8 秒内本人累计击杀 3 名敌人 ⇒ 回复 50% 最大生命并脱离衰朽', () => {
  const h = field([seat('p1', 0, { effects: [refOf()], units: [at(1, 9, 4, 'test_vic1')], bonds: bondsOf(0) })]);
  const inst = installVictoriaDecay(hexHooks(h.battle));
  h.run(0.2);
  const [u] = ops(h);
  const foe = h.enemies()[0];
  fatalHit(h, foe, u);
  assert.equal(u.alive, true);

  for (let i = 0; i < VD.decayKills; i++) {
    const e = h.spawn('enemy_weak', { pos: [12, 3 + i] });
    assert.ok(e && e.alive, 'premise: 弱怪上场');
    h.b.dealDamage(u, e, makeDamageInfo({ amount: 99999, type: 'true', canDodge: false }));
    assert.equal(e.alive, false, 'premise: 由这名干员击杀');
  }
  assert.equal(u.mem.victoriaDecay.kills, 3, '衰朽期间 3 杀');

  h.run(8.5);                                    // 窗口结束（battle.after(8)）
  assert.equal(u.alive, true, '脱离衰朽，没有撤退');
  assert.equal(u.findBuff(DECAY_KEY), null, '衰朽 buff 被摘掉');
  assert.ok(Math.abs(u.hp - (1 + 2000 * 0.5)) < 1e-6, '回复 50% 最大生命：1 + 1000，实际 ' + u.hp);
  assert.equal(inst.heals, 1);
  assert.equal(inst.retreats, 0);

  // 衰朽已经用过 ⇒ 本场再受致命伤正常阵亡
  fatalHit(h, foe, u);
  assert.equal(u.alive, false, '每名干员每场只能进一次衰朽');
  h.invariants();
});

test('衰朽的骄矜: 8 秒内不足 3 杀 ⇒ 强制撤退（permanent）', () => {
  const h = field([seat('p1', 0, { effects: [refOf()], units: [at(1, 9, 4, 'test_vic1')], bonds: bondsOf(0) })]);
  const inst = installVictoriaDecay(hexHooks(h.battle));
  h.run(0.2);
  const [u] = ops(h);
  const foe = h.enemies()[0];
  fatalHit(h, foe, u);
  // 只杀 2 个
  for (let i = 0; i < 2; i++) {
    const e = h.spawn('enemy_weak', { pos: [12, 3 + i] });
    h.b.dealDamage(u, e, makeDamageInfo({ amount: 99999, type: 'true', canDodge: false }));
  }
  assert.equal(u.mem.victoriaDecay.kills, 2);

  h.run(8.5);
  assert.equal(u.alive, false, '不足 3 杀 ⇒ 强制撤退');
  assert.equal(u.removeReason, 'retreat');
  assert.equal(u.removed, true, 'permanent：本场不再回来');
  assert.equal(inst.retreats, 1);
  assert.equal(inst.heals, 0);
  h.invariants();
});

test('衰朽的骄矜: 窗口内第二次致命只免死 — 不重复进入、不延长窗口', () => {
  const h = field([seat('p1', 0, { effects: [refOf()], units: [at(1, 9, 4, 'test_vic1')], bonds: bondsOf(0) })]);
  const inst = installVictoriaDecay(hexHooks(h.battle));
  h.run(0.2);
  const [u] = ops(h);
  const foe = h.enemies()[0];
  fatalHit(h, foe, u);
  const until = u.mem.victoriaDecay.until;
  const buff = u.findBuff(DECAY_KEY);

  h.run(1);
  fatalHit(h, foe, u);
  assert.equal(u.alive, true, '窗口内再致命仍然不撤退');
  assert.equal(u.hp, 1);
  assert.equal(inst.decays, 1, '不重复进入衰朽');
  assert.equal(inst.prevented, 2, '两次致命都被免掉');
  assert.equal(u.mem.victoriaDecay.until, until, '窗口不延长');
  assert.equal(u.buffs.filter((b) => b.key === DECAY_KEY).length, 1, '只有一个衰朽 buff 实例');
  assert.equal(u.findBuff(DECAY_KEY), buff, '同一个实例（没有重建）');
  assert.equal(u.s.blockCnt, 0, '阻挡仍然是 0（没有被 -0 覆盖回去）');
  h.invariants();
});

test('衰朽的骄矜: 非【维多利亚】干员 / 别人的干员不会进衰朽', () => {
  const h = field([
    seat('p1', 0, { effects: [refOf()], units: [at(1, 9, 4, 'test_plain')], bonds: bondsOf() }),
    seat('p2', 1, { effects: [], units: [at(2, 9, 12, 'test_vic1')], bonds: bondsOf() }),
  ], { enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [12, 2] }] });
  const inst = installVictoriaDecay(hexHooks(h.battle));
  h.run(0.2);
  const plain = ops(h).find((u) => u.defId === 'test_plain');
  const theirs = ops(h).find((u) => u.ownerId === 'p2');
  const foe = h.enemies()[0];

  fatalHit(h, foe, plain);
  assert.equal(plain.alive, false, '非【维多利亚】干员正常阵亡');
  fatalHit(h, foe, theirs);
  assert.equal(theirs.alive, false, '别人的维多利亚干员正常阵亡');
  assert.equal(inst.decays, 0);
  h.invariants();
});

// =====================================================================================================================
// 参数读卡面

test('衰朽的骄矜: 数字读卡面 — drainPct 1 / atkFlat 200 / decayKills 1 时按卡面算', () => {
  // 流失
  const h = field([seat('p1', 0, {
    effects: [refOf({ ...VD, drainPct: 1 })],
    units: vicUnits(3),
    bonds: bondsOf(),
  })]);
  installVictoriaDecay(hexHooks(h.battle));
  h.run(1.5);
  const [a] = ops(h);
  assert.ok(Math.abs((2000 - a.hp) - 2000 * 0.01) < 1e-6, 'drainPct 1 ⇒ 每秒 1%：' + (2000 - a.hp));

  // 面板
  const h2 = field([seat('p1', 0, { effects: [refOf({ ...VD, atkFlat: 200 })], units: vicUnits(5), bonds: bondsOf() })]);
  installVictoriaDecay(hexHooks(h2.battle));
  h2.run(0.2);
  const [b] = ops(h2);
  assert.equal(b.s.atk, 500 + 200, 'atkFlat 200 ⇒ 攻击 +200');

  // 衰朽门槛：1 杀就够
  const h3 = field([seat('p1', 0, { effects: [refOf({ ...VD, decayKills: 1 })], units: [at(1, 9, 4, 'test_vic1')], bonds: bondsOf() })]);
  const inst = installVictoriaDecay(hexHooks(h3.battle));
  h3.run(0.2);
  const [c] = ops(h3);
  fatalHit(h3, h3.enemies()[0], c);
  const e = h3.spawn('enemy_weak', { pos: [12, 3] });
  h3.b.dealDamage(c, e, makeDamageInfo({ amount: 99999, type: 'true', canDodge: false }));
  h3.run(8.5);
  assert.equal(c.alive, true, 'decayKills 1 ⇒ 1 杀就脱离衰朽');
  assert.equal(inst.heals, 1);
  h3.invariants();
});
