// test/sim/hex-stone-kjerag-laterano.test.js — 第 7 回合（盟约专属协议）两张卡的战斗半边：
// 谢拉格【冰雪消融】hex_kjerag_thaw（server/sim/content/hexcards/stone_kjerag_laterano.js installKjeragThaw）与
// 拉特兰【圣佑】hex_laterano_sanctuary（同文件 installLateranoSanctuary）。
//
// 驱动方式与 hexcards-armor.test.js 一致：真实 sim Battle（test/helpers/battleHarness.js 的 makeBattle / chessRec /
// enemyRec）+ 生产用的 `hexHooks(battle)` 手工安装，effect ref 按 server/match/hextech.js `addHexRef` 的形状手搓
// （`{ id:'hex:<id>', key:'hex:<id>', params:{ ...effect, hexId, rarity }, data:{ hexId, rarity }, battle:true }`），
// 所以本套件不依赖 content/hextech.js 的接线是否已经落地。`content: 'generic'` 让 installContent 不跑
// content/hextech.js 的 `install()`、也不装盟约内容（层数只当数据用），于是这些数字只可能来自被测模块。
//
// 覆盖（设计稿 §3.3 / §3.4 的每条关键路径，一条一个 test）：
//   冰雪消融：无卡无效果；寒冷命中 100%→130%、冻结命中 100%→260%；解除状态、+1 层、40% 减速 6 秒；
//             只有「攻击命中活着的敌人」才算（非攻击实例 / 链式附加 / 反伤 / 流失 / 元素损伤都不算）；
//             只认拥有者自己的【谢拉格】干员；75 层被动（含掉层撤销、layerGain 现场跨过阈值）；参数读卡面。
//   圣佑：无卡无效果；每消耗 1 发弹药回复所有己方【拉特兰】干员 5% 最大生命；致命伤害时仍有弹药 ⇒ 免死 +
//         清空弹药 + 1 层次数盾（下一发被吸收）；无弹药不免死；非【拉特兰】干员 / 别人的干员不免死；流失不免死；
//         参数读卡面。
//   数据：data/hextech.json 里两张卡的记录与设计稿口径一致（Lead 接线用）。
//
// [ASSUMED]（模块头注释里有完整口径，这里是测试侧的断言口径）：
//   1. 「这次伤害提升至 130%/260%」按**最终伤害**的倍率读（DamageInfo 的 `mul`），所以断言的是「同样一发 100 点
//      伤害，命中带状态的目标结算成 130 / 260」，不是面板攻击力的变化。
//   2. 「≥75 层」判**当前层数**，掉回阈值以下要撤销被动（不是「本场曾经到过」）。
//   3. 圣佑的治疗是各自最大生命上限的 5%，只算在场（活着 / 已部署 / 未隐匿）的己方【拉特兰】干员。
//   4. 免死只认「受到伤害」：生命流失（`isHpLoss`）不免死；护盾是下一次受击才消耗。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { hexHooks } from '../../server/sim/content/hexcards/hooks.js';
import { installKjeragThaw, installLateranoSanctuary } from '../../server/sim/content/hexcards/stone_kjerag_laterano.js';
import { makeDamageInfo } from '../../server/sim/damage.js';
import { bondLayers } from '../../server/sim/content/support/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HEXTECH = JSON.parse(readFileSync(path.join(ROOT, 'data', 'hextech.json'), 'utf8'));

/** 设计稿 §3.3 / §3.4 的参数（卡面 effect 就是这一份；模块只读卡面）。 */
const KJ = Object.freeze({ layers: 1, coldMul: 130, frozenMul: 260, slowPct: 40, slowSec: 6, buffLayer: 75, atkPct: 50, hpPct: 50 });
const LA = Object.freeze({ healPct: 5, shieldHits: 1 });

const CARD_KJ = 'hex_kjerag_thaw';
const CARD_LA = 'hex_laterano_sanctuary';
/** 75 层被动的 buff 键（与模块一致；掉层时按它撤销）。 */
const PASSIVE_KJ = 'hex:kjeragthaw';
/** 免死那 1 层次数盾的 buff 键。 */
const SHIELD_LA = 'hex:laterano:shield';

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

/** 拉特兰的弹药技能：durationType AMMO ⇒ genericSkillSpec 给出 kind 'ammo'，激活时 ammoLeft = bb.ammo。 */
const AMMO_SKILL = Object.freeze({
  skillType: 'MANUAL', durationType: 'AMMO', duration: -1, spCost: 1, initSp: 0, maxChargeTime: 1,
  bb: { ammo: 3 }, trigger: { rule: 'DEFAULT' }, index: 1,
});

/** 谢拉格干员：0 防御，方便「同样一发 100 点伤害」的倍率断言。 */
const kjOp = (o = {}) => chessRec({
  id: 'test_kjerag', bonds: ['kjeragShip'],
  stats: { maxHp: 2000, atk: 500, def: 0, res: 0, blockCnt: 1, respawnTime: 20 }, skill: null, ...o,
});
/** 拉特兰干员：1000 生命 + 弹药技能（未激活时 ammoLeft = 0）。 */
const laOp = (o = {}) => chessRec({
  id: 'test_laterano', bonds: ['lateranoShip'], profession: 'SNIPER',
  stats: { maxHp: 1000, atk: 100, def: 0, res: 0, blockCnt: 1, respawnTime: 20 }, skill: AMMO_SKILL, ...o,
});
/** 不属于任何一个盟约的干员（同样带弹药技能，用来证明「是不是成员」才是判据，不是有没有弹药）。 */
const plainOp = (o = {}) => chessRec({
  id: 'test_plain', bonds: [],
  stats: { maxHp: 2000, atk: 100, def: 0, res: 0, blockCnt: 1, respawnTime: 20 }, skill: AMMO_SKILL, ...o,
});
/** 一个血厚、不动、不还手的敌人：整场安静，数字只来自测试自己打的那几发。 */
const dummy = () => enemyRec({ key: 'enemy_dummy', hp: 1000000, atk: 0, def: 0, speed: 0 });

/** 盟约状态（战斗内加层的活数据：addLayers 只写已存在的 ps.bonds[bondId]）。 */
const bondsOf = (o = {}) => ({
  kjeragShip: { count: 2, active: true, tier: 1, layers: 0, ...(o.kjeragShip || {}) },
  lateranoShip: { count: 1, active: true, tier: 1, layers: 0, ...(o.lateranoShip || {}) },
});

/** 一个席位（多玩家场：seat 1 落在 +8 列外）。 */
const seat = (playerId, i, { effects = [], units = [], bonds = {} } = {}) => ({
  playerId, seat: i, side: 'L', colOffset: i === 0 ? 0 : 8, bonds, playerEffects: effects, units,
});
/** 棋盘上的一枚棋子。 */
const at = (uid, row, col, chessId) => ({ uid, kind: 'chess', chessId, row, col });

/** 一个安静的测试场（不自动结束；捕获我们关心的钩子）。 */
function field(players, { kind = 'normal', hooks = ['hit', 'fatal', 'ammoUsed', 'layerGain', 'battleStart', 'deploy'] } = {}) {
  return makeBattle({
    kind,
    content: 'generic',
    defs: {
      chess: { test_kjerag: kjOp(), test_laterano: laOp(), test_plain: plainOp() },
      enemies: { enemy_dummy: dummy() },
    },
    players,
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }],
    autoFinish: false,
    timeLimit: 30,
    captureNoisy: true,
    hooks,
  });
}

/** 全场干员。 */
const ops = (h) => h.battle.allyUnits.filter((u) => u && u.kind === 'op');
/** 场上的敌人。 */
const foes = (h) => h.battle.enemies.filter((e) => e && e.alive);
/** 一名玩家在某个盟约上的实时层数。 */
const layersOf = (h, pid, bond = 'kjeragShip') => bondLayers(h.battle, pid, bond);

/** 一发「攻击命中」实例（isAttack 真：普攻 / 技能覆盖的那次攻击；0 防御的敌人 ⇒ 最终伤害 = amount × mul）。 */
const attackHit = (h, u, foe, amount = 100, over = {}) => h.battle.dealDamage(u, foe, makeDamageInfo({ amount, type: 'phys', canDodge: false, isAttack: true, ...over }));

// =====================================================================================================================
// 冰雪消融 · 没有卡 / 没有状态

test('冰雪消融: 没有这张卡时不装任何 handler，寒冷命中照常结算、状态不被解除', () => {
  const h = field([seat('p1', 0, { effects: [], units: [at(1, 9, 6, 'test_kjerag')], bonds: bondsOf() })]);
  const inst = installKjeragThaw(hexHooks(h.battle));
  assert.equal(inst, 0, '没有卡 ⇒ install 返回 0');
  h.run(1);
  const [u] = ops(h);
  const foe = foes(h)[0];
  h.battle.applyStatus(foe, 'cold', { duration: 3, source: u });
  const dealt = attackHit(h, u, foe);
  assert.equal(dealt, 100, '寒冷没有带来任何倍率');
  assert.ok(foe.findBuff('cold'), '寒冷还在');
  assert.equal(foe.findBuff('slow'), null, '没有减速');
  assert.equal(layersOf(h, 'p1'), 0, '没有加层');
  h.invariants();
});

test('冰雪消融: 敌人既没有寒冷也没有冻结时，命中什么都不发生', () => {
  const h = field([seat('p1', 0, { effects: [refOf(CARD_KJ, 'kjeragThaw', KJ)], units: [at(1, 9, 6, 'test_kjerag')], bonds: bondsOf() })]);
  const inst = installKjeragThaw(hexHooks(h.battle));
  h.run(1);
  const [u] = ops(h);
  const foe = foes(h)[0];
  assert.equal(attackHit(h, u, foe), 100, '普通命中');
  assert.equal(layersOf(h, 'p1'), 0);
  assert.equal(foe.findBuff('slow'), null);
  assert.equal(inst.thaws, 0);
  h.invariants();
});

// =====================================================================================================================
// 冰雪消融 · 命中寒冷 / 冻结

test('冰雪消融: 命中寒冷的敌人 — 解除寒冷、+1 层谢拉格、这次伤害 130%、40% 减速 6 秒', () => {
  const h = field([seat('p1', 0, { effects: [refOf(CARD_KJ, 'kjeragThaw', KJ)], units: [at(1, 9, 6, 'test_kjerag')], bonds: bondsOf() })]);
  const inst = installKjeragThaw(hexHooks(h.battle));
  h.run(1);
  const [u] = ops(h);
  const foe = foes(h)[0];
  assert.equal(attackHit(h, u, foe), 100, 'premise: 不带状态的同一发是 100');

  h.battle.applyStatus(foe, 'cold', { duration: 3, source: u });
  assert.ok(foe.findBuff('cold'), 'premise: 寒冷挂上了');
  const dealt = attackHit(h, u, foe);

  assert.equal(dealt, 130, '100 × 130% = 130（最终伤害倍率）');
  assert.equal(foe.findBuff('cold'), null, '寒冷被解除');
  assert.equal(layersOf(h, 'p1'), 1, '+1 层谢拉格');
  const slow = foe.findBuff('slow');
  assert.ok(slow, '施加了减速');
  assert.equal(slow.mods.moveMul, 0.6, '40% 减速 ⇒ 移速 ×0.6');
  assert.ok(Math.abs(slow.timeLeft - 6) < 1e-9, `持续 6 秒（实际 ${slow.timeLeft}）`);
  assert.equal(inst.thaws, 1, '一次消融');
  const gains = h.hooksOf('layerGain').filter((c) => c && c.bondId === 'kjeragShip');
  assert.equal(gains.length, 1, '加层走引擎的 layerGain 钩子');
  assert.equal(gains[0].n, 1, '一次 +1 层');
  assert.equal(gains[0].playerId, 'p1');
  assert.equal(gains[0].source, u, '来源是出手的干员');
  h.invariants();
});

test('冰雪消融: 命中冻结的敌人 — 解除冻结、这次伤害 260%（比寒冷更高的一档）', () => {
  const h = field([seat('p1', 0, { effects: [refOf(CARD_KJ, 'kjeragThaw', KJ)], units: [at(1, 9, 6, 'test_kjerag')], bonds: bondsOf() })]);
  const inst = installKjeragThaw(hexHooks(h.battle));
  h.run(1);
  const [u] = ops(h);
  const foe = foes(h)[0];
  h.battle.applyStatus(foe, 'freeze', { duration: 3, source: u });
  assert.ok(foe.findBuff('freeze'), 'premise: 冻结挂上了');
  assert.equal(attackHit(h, u, foe), 260, '100 × 260% = 260');
  assert.equal(foe.findBuff('freeze'), null, '冻结被解除');
  assert.equal(foe.findBuff('cold'), null, '寒冷也没有残留');
  assert.equal(layersOf(h, 'p1'), 1);
  assert.ok(foe.findBuff('slow'), '减速照常施加');
  assert.equal(inst.thaws, 1);
  h.invariants();
});

test('冰雪消融: 连续两次命中两个带状态的敌人，各算各的一次（2 层 / 两次消融）', () => {
  const h = makeBattle({
    kind: 'normal',
    content: 'generic',
    defs: { chess: { test_kjerag: kjOp() }, enemies: { enemy_dummy: dummy() } },
    players: [seat('p1', 0, { effects: [refOf(CARD_KJ, 'kjeragThaw', KJ)], units: [at(1, 9, 6, 'test_kjerag')], bonds: bondsOf() })],
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0, count: 2 }],
    autoFinish: false,
    timeLimit: 30,
    captureNoisy: true,
  });
  const inst = installKjeragThaw(hexHooks(h.battle));
  h.run(1);
  const [u] = ops(h);
  const [a, b] = foes(h);
  assert.equal(foes(h).length, 2, 'premise: 场上有两个敌人');
  h.battle.applyStatus(a, 'cold', { duration: 3, source: u });
  h.battle.applyStatus(b, 'freeze', { duration: 3, source: u });
  assert.equal(attackHit(h, u, a), 130);
  assert.equal(attackHit(h, u, b), 260);
  assert.equal(layersOf(h, 'p1'), 2, '两次命中 = 两次 +1 层');
  assert.equal(inst.thaws, 2);
  assert.equal(a.findBuff('cold'), null);
  assert.equal(b.findBuff('freeze'), null);
  h.invariants();
});

// =====================================================================================================================
// 冰雪消融 · 什么算「攻击命中」

test('冰雪消融: 不是攻击的伤害实例不算（非攻击 / 链式附加 / 反伤），状态与层数都不动', () => {
  const h = field([seat('p1', 0, { effects: [refOf(CARD_KJ, 'kjeragThaw', KJ)], units: [at(1, 9, 6, 'test_kjerag')], bonds: bondsOf() })]);
  const inst = installKjeragThaw(hexHooks(h.battle));
  h.run(1);
  const [u] = ops(h);
  const foe = foes(h)[0];

  h.battle.applyStatus(foe, 'cold', { duration: 5, source: u });
  // 卡片伤害 / 持续伤害：isAttack 假
  assert.equal(attackHit(h, u, foe, 100, { isAttack: false }), 100, '非攻击实例不吃倍率');
  // 在另一次结算里打出来的附加伤害：dmg.chained（引擎自己打标记的同一字段）
  const chained = makeDamageInfo({ amount: 100, type: 'phys', canDodge: false, isAttack: true });
  chained.chained = true;
  assert.equal(h.battle.dealDamage(u, foe, chained), 100, '链式附加伤害不吃倍率');
  // 反伤 / 反击
  assert.equal(attackHit(h, u, foe, 100, { tags: ['counter'] }), 100, '反伤不吃倍率');
  assert.ok(foe.findBuff('cold'), '寒冷还在：一次都没有被解除');
  assert.equal(layersOf(h, 'p1'), 0, '一层都没加');
  assert.equal(inst.thaws, 0);
  h.invariants();
});

test('冰雪消融: 流失与元素损伤都不是「受到攻击」，不消融、不加层', () => {
  const h = field([seat('p1', 0, { effects: [refOf(CARD_KJ, 'kjeragThaw', KJ)], units: [at(1, 9, 6, 'test_kjerag')], bonds: bondsOf() })]);
  const inst = installKjeragThaw(hexHooks(h.battle));
  h.run(1);
  const [u] = ops(h);
  const foe = foes(h)[0];

  h.battle.applyStatus(foe, 'cold', { duration: 5, source: u });
  h.battle.loseHp(foe, 100, { source: u });                                    // 流失：不走 hit 钩子
  h.battle.dealDamage(u, foe, { type: 'element', element: 'burn', amount: 100 }); // 元素损伤：灌槽，不是伤害
  assert.ok(foe.findBuff('cold'), '寒冷还在');
  assert.equal(layersOf(h, 'p1'), 0);
  assert.equal(inst.thaws, 0);
  h.invariants();
});

test('冰雪消融: 只认拥有者自己的【谢拉格】干员 — 自己的非谢拉格干员、别人的谢拉格干员都不算', () => {
  const h = field([
    seat('p1', 0, { effects: [refOf(CARD_KJ, 'kjeragThaw', KJ)], units: [at(1, 9, 6, 'test_plain')], bonds: bondsOf() }),
    seat('p2', 1, { effects: [], units: [at(2, 10, 6, 'test_kjerag')], bonds: bondsOf() }),
  ], { kind: 'unite' });
  const inst = installKjeragThaw(hexHooks(h.battle));
  h.run(1);
  const foe = foes(h)[0];
  const mine = ops(h).find((u) => u.ownerId === 'p1');
  const theirs = ops(h).find((u) => u.ownerId === 'p2');
  assert.equal(mine.defId, 'test_plain');
  assert.equal(theirs.defId, 'test_kjerag');

  // 自己的干员不是【谢拉格】成员
  h.battle.applyStatus(foe, 'cold', { duration: 5, source: mine });
  assert.equal(attackHit(h, mine, foe), 100, '非成员不吃倍率');
  assert.ok(foe.findBuff('cold'), '寒冷没被解除');
  // 别人的【谢拉格】干员不归这张卡管
  h.battle.removeStatus(foe, 'cold');
  h.battle.applyStatus(foe, 'cold', { duration: 5, source: theirs });
  assert.equal(attackHit(h, theirs, foe), 100, '别人的干员不吃倍率');
  assert.ok(foe.findBuff('cold'));
  assert.equal(layersOf(h, 'p1'), 0, 'p1 没有加层');
  assert.equal(layersOf(h, 'p2'), 0, 'p2 也没有');
  assert.equal(inst.thaws, 0);
  h.invariants();
});

test('冰雪消融: 数字读卡面 — coldMul 200 时同样的命中结算成 200', () => {
  const custom = refOf(CARD_KJ, 'kjeragThaw', { ...KJ, coldMul: 200 });
  const h = field([seat('p1', 0, { effects: [custom], units: [at(1, 9, 6, 'test_kjerag')], bonds: bondsOf() })]);
  installKjeragThaw(hexHooks(h.battle));
  h.run(1);
  const [u] = ops(h);
  const foe = foes(h)[0];
  h.battle.applyStatus(foe, 'cold', { duration: 3, source: u });
  assert.equal(attackHit(h, u, foe), 200, '200% 从卡面读出来');
  h.invariants();
});

// =====================================================================================================================
// 冰雪消融 · 【谢拉格】≥ 75 层

test('冰雪消融: 谢拉格 ≥75 层时，谢拉格干员攻击力 / 生命上限 +50%（非谢拉格干员不吃）', () => {
  const h = field([seat('p1', 0, {
    effects: [refOf(CARD_KJ, 'kjeragThaw', KJ)],
    units: [at(1, 9, 6, 'test_kjerag'), at(2, 10, 6, 'test_plain')],
    bonds: bondsOf({ kjeragShip: { layers: 75 } }),
  })]);
  installKjeragThaw(hexHooks(h.battle));
  h.run(1);
  const kj = ops(h).find((u) => u.defId === 'test_kjerag');
  const plain = ops(h).find((u) => u.defId === 'test_plain');
  assert.equal(kj.s.atk, 750, '500 × 1.5');
  assert.equal(kj.s.maxHp, 3000, '2000 × 1.5');
  assert.equal(kj.buffs.filter((b) => b.key === PASSIVE_KJ).length, 1, '一个被动实例');
  assert.equal(plain.s.atk, 100, '非谢拉格干员没有被动（premise: 100 攻击）');
  assert.equal(plain.s.maxHp, 2000);
  assert.equal(plain.buffs.filter((b) => b.key === PASSIVE_KJ).length, 0);
  h.invariants();
});

test('冰雪消融: 层数掉回阈值以下，被动被撤销（不是留一个不再刷新的旧值）', () => {
  const h = field([seat('p1', 0, {
    effects: [refOf(CARD_KJ, 'kjeragThaw', KJ)],
    units: [at(1, 9, 6, 'test_kjerag')],
    bonds: bondsOf({ kjeragShip: { layers: 75 } }),
  })]);
  const inst = installKjeragThaw(hexHooks(h.battle));
  h.run(1);
  const [u] = ops(h);
  assert.equal(u.s.atk, 750, 'premise: 75 层时吃到被动');
  // 层数被打回去（只有引擎 / 备战侧会这么做，这里直接改活数据再走模块的刷新入口）
  h.battle.getPlayer('p1').bonds.kjeragShip.layers = 74;
  inst.refresh();
  assert.equal(u.s.atk, 500, '攻击力回到 500');
  assert.equal(u.s.maxHp, 2000, '生命上限回到 2000');
  assert.equal(u.buffs.filter((b) => b.key === PASSIVE_KJ).length, 0, '被动被撤销');
  // 再涨回 75 层，同一个 refresh 入口重新装上
  h.battle.getPlayer('p1').bonds.kjeragShip.layers = 75;
  inst.refresh();
  assert.equal(u.s.atk, 750);
  assert.equal(u.buffs.filter((b) => b.key === PASSIVE_KJ).length, 1);
  h.invariants();
});

test('冰雪消融: 命中消融现场把层数推过 75 —— 同一个 tick 就吃到被动，走一 tick 后仍在', () => {
  const h = field([seat('p1', 0, {
    effects: [refOf(CARD_KJ, 'kjeragThaw', KJ)],
    units: [at(1, 9, 6, 'test_kjerag')],
    bonds: bondsOf({ kjeragShip: { layers: 74 } }),
  })]);
  installKjeragThaw(hexHooks(h.battle));
  h.run(1);
  const [u] = ops(h);
  const foe = foes(h)[0];
  assert.equal(u.s.atk, 500, 'premise: 74 层还没到阈值');
  h.battle.applyStatus(foe, 'cold', { duration: 3, source: u });
  attackHit(h, u, foe);                      // 74 + 1 = 75
  assert.equal(layersOf(h, 'p1'), 75, 'premise: 层数到 75');
  assert.equal(u.s.atk, 750, '同一 tick 里就吃到 +50% 攻击力');
  h.run(0.5);                                // layerGain 的对账（battle.after(0)）跑完
  assert.equal(u.s.atk, 750, '对账之后仍然是 750');
  assert.equal(u.buffs.filter((b) => b.key === PASSIVE_KJ).length, 1, '只有一个被动实例');
  h.invariants();
});

// =====================================================================================================================
// 圣佑 · 弹药治疗

test('圣佑: 没有这张卡时，消耗弹药不治疗、致命伤害照常致死', () => {
  const h = field([seat('p1', 0, { effects: [], units: [at(1, 9, 6, 'test_laterano')], bonds: bondsOf() })]);
  const inst = installLateranoSanctuary(hexHooks(h.battle));
  assert.equal(inst, 0, '没有卡 ⇒ install 返回 0');
  h.run(1);
  const [u] = ops(h);
  const foe = foes(h)[0];
  u.hp = 500;
  assert.equal(u.skill.activate('test', { free: true }), true, 'premise: 弹药技能开起来');
  assert.equal(h.battle.forceAttack(u, [foe]), true, 'premise: 打一发（消耗 1 发弹药）');
  assert.equal(u.hp, 500, '没有治疗');
  h.battle.dealDamage(foe, u, makeDamageInfo({ amount: 99999, type: 'true', canDodge: false }));
  assert.equal(u.alive, false, '没有免死');
  h.invariants();
});

test('圣佑: 每消耗 1 颗弹药，回复所有己方【拉特兰】干员 5% 最大生命', () => {
  const h = field([seat('p1', 0, {
    effects: [refOf(CARD_LA, 'lateranoSanctuary', LA)],
    units: [at(1, 9, 6, 'test_laterano'), at(2, 10, 6, 'test_laterano'), at(3, 9, 4, 'test_plain')],
    bonds: bondsOf(),
  })]);
  const inst = installLateranoSanctuary(hexHooks(h.battle));
  h.run(1);
  const [a, b, plain] = ops(h);
  const foe = foes(h)[0];
  assert.equal(a.defId, 'test_laterano');
  assert.equal(plain.defId, 'test_plain');
  a.hp = 500;      // 1000 上限 → 5% = 50
  b.hp = 1000;     // 满血：治疗被上限吃掉
  plain.hp = 1000; // 不是拉特兰干员

  assert.equal(a.skill.activate('test', { free: true }), true);
  assert.equal(a.skill.ammoLeft, 3, 'premise: 3 发弹药');
  assert.equal(h.battle.forceAttack(a, [foe]), true, 'premise: 打一发');
  assert.equal(a.skill.ammoLeft, 2, 'premise: 消耗了 1 发');

  assert.equal(a.hp, 550, '自己回复 5% 最大生命 = 50');
  assert.equal(b.hp, 1000, '满血的同伴不会超过上限');
  assert.equal(plain.hp, 1000, '非【拉特兰】干员不治疗（premise: 本来就是满血，这里只是确认没被动过）');
  assert.equal(inst.heals, 1, '一次弹药消耗 = 一次治疗结算');
  h.invariants();
});

test('圣佑: 别人的【拉特兰】干员不在治疗名单里', () => {
  const h = field([
    seat('p1', 0, { effects: [refOf(CARD_LA, 'lateranoSanctuary', LA)], units: [at(1, 9, 6, 'test_laterano')], bonds: bondsOf() }),
    seat('p2', 1, { effects: [], units: [at(2, 10, 6, 'test_laterano')], bonds: bondsOf() }),
  ], { kind: 'unite' });
  installLateranoSanctuary(hexHooks(h.battle));
  h.run(1);
  const mine = ops(h).find((u) => u.ownerId === 'p1');
  const theirs = ops(h).find((u) => u.ownerId === 'p2');
  const foe = foes(h)[0];
  mine.hp = 500;
  theirs.hp = 500;
  mine.skill.activate('test', { free: true });
  h.battle.forceAttack(mine, [foe]);
  assert.equal(mine.hp, 550, '自己的干员被治疗');
  assert.equal(theirs.hp, 500, '别人的干员没有');
  h.invariants();
});

// =====================================================================================================================
// 圣佑 · 致命免死

test('圣佑: 受到致命伤害时仍有弹药 — 免死、清空弹药、获得 1 层次数盾（下一发被吸收）', () => {
  const h = field([seat('p1', 0, { effects: [refOf(CARD_LA, 'lateranoSanctuary', LA)], units: [at(1, 9, 6, 'test_laterano')], bonds: bondsOf() })]);
  const inst = installLateranoSanctuary(hexHooks(h.battle));
  h.run(1);
  const [u] = ops(h);
  const foe = foes(h)[0];
  u.skill.activate('test', { free: true });
  assert.equal(u.skill.ammoLeft, 3, 'premise: 有 3 发弹药');
  assert.equal(u.skill.active, true, 'premise: 技能生效中');

  h.battle.dealDamage(foe, u, makeDamageInfo({ amount: 99999, type: 'true', canDodge: false }));
  assert.equal(u.alive, true, '免死：没有倒下');
  assert.equal(u.hp, 1, '引擎把 HP 抬到 1');
  assert.equal(inst.prevented, 1, '一次免死');
  assert.equal(u.skill.ammoLeft, 0, '弹药被清空');
  assert.equal(u.skill.active, false, '打空的技能正常结束（不留一个 0 发仍在生效的技能）');
  const shield = u.findBuff(SHIELD_LA);
  assert.ok(shield, '获得了次数盾');
  assert.equal(shield.shieldHits, 1, '1 层次数盾');

  // 下一发被次数盾整发吸收
  const absorbed = h.battle.dealDamage(foe, u, makeDamageInfo({ amount: 40, type: 'true', canDodge: false }));
  assert.equal(absorbed, 0, '整发被盾吸收');
  assert.equal(u.hp, 1, 'HP 没动');
  assert.equal(u.findBuff(SHIELD_LA), null, '盾用掉了');
  assert.equal(inst.prevented, 1, '这次不再需要免死');
  h.invariants();
});

test('圣佑: 没有弹药时不免死（弹药是这条免死的条件）', () => {
  const h = field([seat('p1', 0, { effects: [refOf(CARD_LA, 'lateranoSanctuary', LA)], units: [at(1, 9, 6, 'test_laterano')], bonds: bondsOf() })]);
  const inst = installLateranoSanctuary(hexHooks(h.battle));
  h.run(1);
  const [u] = ops(h);
  const foe = foes(h)[0];
  assert.equal(u.skill.ammoLeft, 0, 'premise: 技能没开，0 发弹药');
  h.battle.dealDamage(foe, u, makeDamageInfo({ amount: 99999, type: 'true', canDodge: false }));
  assert.equal(u.alive, false, '倒下了');
  assert.equal(inst.prevented, 0);
  assert.equal(u.findBuff(SHIELD_LA), null, '没有盾');
  h.invariants();
});

test('圣佑: 非【拉特兰】干员（哪怕带着弹药）不免死；别人的【拉特兰】干员也不归这张卡管', () => {
  const h = field([
    seat('p1', 0, {
      effects: [refOf(CARD_LA, 'lateranoSanctuary', LA)],
      units: [at(1, 9, 6, 'test_plain')],
      bonds: bondsOf(),
    }),
    seat('p2', 1, { effects: [], units: [at(2, 10, 6, 'test_laterano')], bonds: bondsOf() }),
  ], { kind: 'unite' });
  const inst = installLateranoSanctuary(hexHooks(h.battle));
  h.run(1);
  const mine = ops(h).find((u) => u.ownerId === 'p1');
  const theirs = ops(h).find((u) => u.ownerId === 'p2');
  const foe = foes(h)[0];

  mine.skill.activate('test', { free: true });
  assert.equal(mine.skill.ammoLeft, 3, 'premise: 非拉特兰干员也有弹药');
  h.battle.dealDamage(foe, mine, makeDamageInfo({ amount: 99999, type: 'true', canDodge: false }));
  assert.equal(mine.alive, false, '非成员不免死');

  theirs.skill.activate('test', { free: true });
  h.battle.dealDamage(foe, theirs, makeDamageInfo({ amount: 99999, type: 'true', canDodge: false }));
  assert.equal(theirs.alive, false, '别人的拉特兰干员不免死');
  assert.equal(inst.prevented, 0);
  h.invariants();
});

test('圣佑: 生命流失不是「受到伤害」，不免死', () => {
  const h = field([seat('p1', 0, { effects: [refOf(CARD_LA, 'lateranoSanctuary', LA)], units: [at(1, 9, 6, 'test_laterano')], bonds: bondsOf() })]);
  const inst = installLateranoSanctuary(hexHooks(h.battle));
  h.run(1);
  const [u] = ops(h);
  u.skill.activate('test', { free: true });
  assert.equal(u.skill.ammoLeft, 3, 'premise: 有弹药');
  h.battle.loseHp(u, 99999, { source: null });
  assert.equal(u.alive, false, '流失照样致死');
  assert.equal(inst.prevented, 0, '没有免死');
  h.invariants();
});

test('圣佑: 数字读卡面 — healPct 10 时一次弹药消耗回复 10% 最大生命', () => {
  const custom = refOf(CARD_LA, 'lateranoSanctuary', { ...LA, healPct: 10 });
  const h = field([seat('p1', 0, { effects: [custom], units: [at(1, 9, 6, 'test_laterano')], bonds: bondsOf() })]);
  installLateranoSanctuary(hexHooks(h.battle));
  h.run(1);
  const [u] = ops(h);
  const foe = foes(h)[0];
  u.hp = 500;
  u.skill.activate('test', { free: true });
  h.battle.forceAttack(u, [foe]);
  assert.equal(u.hp, 600, '1000 的 10% = 100');
  h.invariants();
});

// =====================================================================================================================
// 卡面数据（Lead 接线用）：data/hextech.json 与设计稿口径一致

test('数据: data/hextech.json 的两张卡记录与设计稿 §3.3 / §3.4 的参数一致', () => {
  const kj = HEXTECH.playerHexes[CARD_KJ];
  assert.ok(kj, `data/hextech.json 里没有 ${CARD_KJ}`);
  assert.equal(kj.requiresBond, 'kjeragShip', '只在【谢拉格】激活时出现');
  assert.equal(kj.rarity, 'prismatic', '3 阶（棱彩）');
  assert.deepEqual(kj.effect.kjeragThaw, KJ, 'kjeragThaw 参数与设计稿一致（调数时同步改这里与设计稿）');

  const la = HEXTECH.playerHexes[CARD_LA];
  assert.ok(la, `data/hextech.json 里没有 ${CARD_LA}`);
  assert.equal(la.requiresBond, 'lateranoShip', '只在【拉特兰】激活时出现');
  assert.equal(la.rarity, 'prismatic', '3 阶（棱彩）');
  assert.deepEqual(la.effect.lateranoSanctuary, LA, 'lateranoSanctuary 参数与设计稿一致（调数时同步改这里与设计稿）');
});
