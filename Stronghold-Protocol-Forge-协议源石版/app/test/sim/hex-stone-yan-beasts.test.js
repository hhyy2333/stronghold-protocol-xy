// test/sim/hex-stone-yan-beasts.test.js — 第 7 回合（盟约专属协议）2 阶专属卡 炎【炎百兽】hex_yan_beasts 的战斗半边
// （server/sim/content/hexcards/stone_yan_beasts.js 的 installYanBeasts）。
//
// 驱动方式与 hex-stone-kjerag-laterano.test.js 一致：真实 sim Battle（test/helpers/battleHarness.js 的
// makeBattle / chessRec / enemyRec）+ 生产用的 `hexHooks(battle)` 手工安装，effect ref 按 server/match/hextech.js
// `addHexRef` 的形状手搓（`{ id:'hex:<id>', key:'hex:<id>', params:{ ...effect, hexId, rarity }, data:{ hexId, rarity },
// battle:true }`），所以本套件不依赖 content/hextech.js 的接线是否已经落地。`content: 'generic'` 让 installContent
// 不跑 content/hextech.js 的 `install()`、也不装盟约内容（层数只当数据用），于是这些数字只可能来自被测模块。
// 唯一的例外是最后那条「祛恶之焰真的锁定 2 个目标」：祛恶之焰的 kit 住在 content/tokens.js，只有 `content: 'full'`
// 才会装它 —— 那一条把 ref 的 `yanBeasts` 参数摘掉（生产接线的 ownersOf 闸门因此滤掉拥有者，只剩手动 install 生效），
// 模块读不到参数就用与卡面同数的兜底值，于是生产内容在场而数字仍只来自被测模块。
//
// 覆盖（设计稿 §2.3 的每条关键路径，一条一个 test）：
//   1. 无卡 ⇒ install 返回 0 且没有任何效果；
//   2. 技力消耗：N=3 → ×1.05、N=5 → ×1.10、N=7 → ×1.15；装备【天师古鼎】的【炎】干员豁免；非【炎】干员不受影响；
//      引擎读到的 spCost 跟着涨；重新部署不重复乘（skill 上的 flag）；
//   3. 召唤：战斗开始时每名在场己方【炎】干员各一只炎佑，属性 = 模板 + 对应干员的 (80+0.4L)%；防御力 / 法抗
//      **直接等于**对应干员（业主 2026-11-01，比例读卡面 inheritDefPct / inheritResPct，缺省 100）；
//   4. 生命共享（同血池）：对干员造成 X ⇒ 配对的炎佑掉 X；对炎佑造成 X ⇒ 干员掉 X；元素损伤不镜像；
//   4b. 生命共享的**回复方向**（业主 2026-11-01「干员被回血对应的炎佑不回血」）：治干员 ⇒ 炎佑同样回血、
//      治炎佑 ⇒ 干员回血、不递归、超量治疗不凭空造血、比例读卡面 shareHealPct、5 名档每秒回血也镜像；
//   5. 5 名档：炎干员 s.hpRegen = 20+0.5L，N=4 没有；层数变化后刷新；
//   6. 7 名档：己方炎佑 mem.flameTargets === 2、mem.flameScaleFn() = (60+0.2L)/100，N=6 没有；原盟约召唤的炎佑
//      同样被覆盖；跑到祛恶之焰真的开起来，锁定 2 个目标；
//   7. 参数读卡面：换掉卡面参数，结果跟着变；缺格子时用兜底值。
//
// [ASSUMED]（模块头注释里有完整口径，这里是测试侧的断言口径）：
//   a. 「在场」= alive && deployed && !hidden（hexHooks.onField），N 按 baseChessId 去重；
//   b. 生命共享对任何 HP 伤害生效（元素损伤与共享自身的流失除外），流失用 battle.loseHp 结算、无来源；
//   c. 干员阵亡时配对的那只炎佑一起撤退（反方向不做）；
//   d. 回血共享的比例按「同血池 = 同样数值」（shareHealPct 缺省 100），5 名档的每秒回血也算「回血」；
//   e. 防御 / 法抗按「直接等于」继承（替换模板的 200 / 0，干员 0 防 ⇒ 炎佑 0 防），只取召唤那一刻的面板。

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { hexHooks } from '../../server/sim/content/hexcards/hooks.js';
import { installYanBeasts } from '../../server/sim/content/hexcards/stone_yan_beasts.js';
import { bondLayers, TOKEN_IDS } from '../../server/sim/content/support/index.js';
import { spawnYanyou } from '../../server/sim/content/tokens.js';

const CARD = 'hex_yan_beasts';
const SPEC = 'yanBeasts';
/** 炎佑 token 模板属性（data/enemies.json enemy_9012_acloon；spawnYanyou 把加成加到这两个数上）。 */
const YANYOU_ATK = 600;
const YANYOU_HP = 12000;
/** 5 名档回血的 buff 键（与模块一致）。 */
const REGEN_KEY = 'hex:yanbeasts:regen';

/** 设计稿 §2.2 的参数（卡面 effect 就是这一份；模块只读卡面）。 */
const SPEC_FULL = Object.freeze({
  spCostPct: 5, spCostTierPct: 5, censerKey: 'chess_item_6_03_e',
  summonPct: 80, summonPerLayerPct: 0.4,
  regenCount: 5, regen: 20, regenPerLayer: 0.5,
  flameCount: 7, flameTargets: 2, flameScale: 60, flameScalePerLayer: 0.2,
});

/** One playerEffects entry, the shape server/match/hextech.js addHexRef writes. `effect` overrides the design values. */
function refOf(effect = {}) {
  return {
    id: `hex:${CARD}`, key: `hex:${CARD}`, name: '炎百兽', desc: '', iconKind: 'hex', iconId: CARD,
    counter: null, battle: true,
    params: { [SPEC]: { ...SPEC_FULL, ...effect }, hexId: CARD, rarity: 'gold' },
    data: { hexId: CARD, rarity: 'gold' },
  };
}

/** 一枚棋子。 */
const at = (uid, row, col, chessId, extra = {}) => ({ uid, kind: 'chess', chessId, row, col, ...extra });
/** 一个席位。 */
const seat = (playerId, i, { effects = [], units = [], bonds = {} } = {}) => ({
  playerId, seat: i, side: 'L', colOffset: i === 0 ? 0 : 8, bonds, playerEffects: effects, units,
});
/** 盟约状态（层数只当数据用：content:'generic' 不装盟约内容）。 */
const bondsOf = (count = 3, layers = 0) => ({ yanShip: { count, active: true, tier: 1, layers } });

/** 【炎】干员：0 防御，方便「同样一发 X 点真实伤害」的断言。 */
const yanOp = (id, o = {}) => chessRec({
  id, bonds: ['yanShip'],
  stats: { maxHp: 2000, atk: 500, def: 0, res: 0, blockCnt: 1, respawnTime: 20 }, ...o,
});
/** 不属于【炎】的干员（同样有技能，用来证明「是不是成员」才是判据）。 */
const plainOp = (id, o = {}) => chessRec({
  id, bonds: [],
  stats: { maxHp: 2000, atk: 500, def: 0, res: 0, blockCnt: 1, respawnTime: 20 }, ...o,
});
/** 一个血厚、不动、不还手的敌人：整场安静，数字只来自测试自己打的那几发。 */
const dummy = () => enemyRec({ key: 'enemy_dummy', hp: 1000000, atk: 0, def: 0, speed: 0 });

/** 12 个可部署格（和 hextech-batch6 的 capBattle 同一批）。 */
const TILES = [[9, 4], [9, 5], [9, 6], [9, 7], [10, 4], [10, 5], [10, 6], [10, 7], [11, 4], [11, 5], [11, 6], [11, 7]];

/** `n` 名【炎】干员（id 各不相同 ⇒ N 按 baseChessId 去重后就是 n）。 */
const yanUnits = (n, o = {}) => Array.from({ length: n }, (_, i) => at(i + 1, TILES[i][0], TILES[i][1], `test_yan${i + 1}`, o));

/** 测试用棋子记录（7 名【炎】+ 1 名非【炎】+ 1 名技力消耗 20 点的【炎】干员）。 */
const CHESS = Object.freeze(Object.fromEntries([
  ...Array.from({ length: 7 }, (_, i) => [`test_yan${i + 1}`, yanOp(`test_yan${i + 1}`)]),
  ['test_yan20', yanOp('test_yan20', { skill: { spCost: 20 } })],
  ['test_medic', plainOp('test_medic', { profession: 'MEDIC' })],
  // 防御 / 法抗继承用：一条「高防 + 中法抗」，一条「0 防 + 高法抗」的对照
  ['test_yan_def', yanOp('test_yan_def', { stats: { maxHp: 2000, atk: 500, def: 300, res: 40, blockCnt: 1, respawnTime: 20 } })],
  ['test_yan_res', yanOp('test_yan_res', { stats: { maxHp: 2000, atk: 500, def: 0, res: 70, blockCnt: 1, respawnTime: 20 } })],
  ['test_plain', plainOp('test_plain')],
]));

/** 一个安静的测试场。 */
function field(players, { kind = 'normal', content = 'generic', enemies = [{ key: 'enemy_dummy', time: 0, route: 0 }], setup = null, hooks } = {}) {
  return makeBattle({
    kind,
    content,
    defs: { chess: CHESS, enemies: { enemy_dummy: dummy() } },
    players,
    enemies,
    autoFinish: false,
    timeLimit: 30,
    captureNoisy: true,
    setup: setup || undefined,
    hooks: hooks ?? ['battleStart', 'deploy', 'damaged', 'death', 'heal', 'layerGain', 'kill'],
  });
}

/** 全场干员。 */
const ops = (h) => h.battle.allyUnits.filter((u) => u && u.kind === 'op');
/** 场上的炎佑（活着的）。 */
const yanyouOf = (h) => h.battle.allyUnits.filter((u) => u && u.kind === 'token' && u.defId === TOKEN_IDS.yanyou && u.alive);
/** 一名干员的实时层数。 */
const layersOf = (h, pid = 'p1') => bondLayers(h.battle, pid, 'yanShip');
/** 浮点断言。 */
function close(actual, expected, msg, eps = 1e-9) {
  assert.ok(Math.abs(actual - expected) < eps, `${msg}: expected ${expected}, got ${actual}`);
}
/** 一发真实伤害（不吃防御 / 法抗）。 */
const hitTrue = (h, target, amount) => h.battle.dealDamage(null, target, { amount, type: 'true', canDodge: false, tags: ['test'] });

// =====================================================================================================================
// 1. 没有这张卡

test('炎百兽: 没有这张卡时 install 返回 0，技力消耗 / 生命 / 炎佑都不变', () => {
  const h = field([seat('p1', 0, { effects: [], units: yanUnits(3), bonds: bondsOf(3) })]);
  const inst = installYanBeasts(hexHooks(h.battle));
  assert.equal(inst, 0, '没有卡 ⇒ install 返回 0');
  h.run(1);
  assert.equal(ops(h).length, 3, 'premise: 三名干员在场');
  assert.equal(yanyouOf(h).length, 0, '没有召唤任何炎佑');
  for (const u of ops(h)) {
    assert.equal(u.skill.spCostMul, 1, `${u.defId} 的技力消耗没有变`);
    assert.equal(u.s.hpRegen, 0, `${u.defId} 没有回血`);
    assert.equal(u.findBuff(REGEN_KEY), null, `${u.defId} 没有回血 buff`);
  }
  h.invariants();
});

test('炎百兽: hooks 不是 hexHooks 的返回对象时也是 no-op（返回 0）', () => {
  assert.equal(installYanBeasts(null), 0);
  assert.equal(installYanBeasts({}), 0);
  assert.equal(installYanBeasts({ battle: {}, ownersOf: () => ['p1'] }), 0);
});

// =====================================================================================================================
// 2. 技力消耗

test('炎百兽: 己方【炎】干员技力消耗 +5%（N=3）', () => {
  const h = field([seat('p1', 0, { effects: [refOf()], units: yanUnits(3), bonds: bondsOf(3) })]);
  assert.ok(installYanBeasts(hexHooks(h.battle)) > 0, '有卡 ⇒ install 返回被覆盖的干员数');
  h.run(1);
  for (const u of ops(h)) close(u.skill.spCostMul, 1.05, `${u.defId} 的 spCostMul`);
  h.invariants();
});

test('炎百兽: 引擎读到的实际技力消耗也跟着涨（20 点基础消耗 ⇒ 21）', () => {
  const h = field([seat('p1', 0, {
    effects: [refOf()],
    units: [at(1, 9, 4, 'test_yan20'), at(2, 9, 5, 'test_yan2'), at(3, 9, 6, 'test_yan3')],
    bonds: bondsOf(3),
  })]);
  installYanBeasts(hexHooks(h.battle));
  h.run(1);
  const u = h.unit('test_yan20');
  close(u.skill.spCostMul, 1.05, 'N=3 ⇒ ×1.05');
  assert.equal(u.skill.spCost, 21, '引擎的 spCost = floor(20 × 1.05) = 21');
  h.invariants();
});

test('炎百兽: 5 名档再 +5%（N=5 ⇒ ×1.10），7 名档再 +5%（N=7 ⇒ ×1.15）', () => {
  for (const [n, mul] of [[4, 1.05], [5, 1.1], [6, 1.1], [7, 1.15]]) {
    const h = field([seat('p1', 0, { effects: [refOf()], units: yanUnits(n), bonds: bondsOf(n) })]);
    installYanBeasts(hexHooks(h.battle));
    h.run(1);
    assert.equal(ops(h).length, n, `premise: ${n} 名干员在场`);
    for (const u of ops(h)) close(u.skill.spCostMul, mul, `N=${n} 的 ${u.defId} spCostMul`);
    h.invariants();
  }
});

test('炎百兽: 装备【天师古鼎】的【炎】干员豁免技力消耗增加', () => {
  const h = field([seat('p1', 0, {
    effects: [refOf()],
    units: [at(1, 9, 4, 'test_yan1', { items: ['chess_item_6_03_e_a'] }), at(2, 9, 5, 'test_yan2'), at(3, 9, 6, 'test_yan3')],
    bonds: bondsOf(3),
  })]);
  installYanBeasts(hexHooks(h.battle));
  h.run(1);
  const censer = h.unit('test_yan1');
  assert.deepEqual(censer.items, ['chess_item_6_03_e_a'], 'premise: 带着天师古鼎');
  assert.equal(censer.skill.spCostMul, 1, '带天师古鼎 ⇒ 不增加');
  assert.equal(censer.skill.spCost, 10, '实际技力消耗也没变');
  close(h.unit('test_yan2').skill.spCostMul, 1.05, '没带天师古鼎的【炎】干员照常 +5%');
  h.invariants();
});

test('炎百兽: 非【炎】干员不受技力消耗影响', () => {
  const h = field([seat('p1', 0, {
    effects: [refOf()],
    units: [at(1, 9, 4, 'test_yan1'), at(2, 9, 5, 'test_yan2'), at(3, 9, 6, 'test_yan3'), at(4, 9, 7, 'test_plain')],
    bonds: bondsOf(4),
  })]);
  installYanBeasts(hexHooks(h.battle));
  h.run(1);
  close(h.unit('test_yan1').skill.spCostMul, 1.05, '【炎】干员 +5%');
  assert.equal(h.unit('test_plain').skill.spCostMul, 1, '非【炎】干员不变');
  h.invariants();
});

test('炎百兽: 重新部署不会重复乘技力消耗（skill 上的 flag 防重复）', () => {
  const h = field([seat('p1', 0, { effects: [refOf()], units: yanUnits(5), bonds: bondsOf(5) })]);
  installYanBeasts(hexHooks(h.battle));
  h.run(1);
  const u = ops(h)[0];
  close(u.skill.spCostMul, 1.1, 'N=5 ⇒ ×1.10');
  h.battle.retreat(u, { reason: 'raid' });
  assert.ok(h.battle._deploy(u), 'premise: 重新部署成功');
  close(u.skill.spCostMul, 1.1, '重新部署后仍然只乘了一次');
  close(u.s.hpRegen, 20, '回血 buff 也还在（persist）');
  h.invariants();
});

// =====================================================================================================================
// 3. 召唤

test('炎百兽: 战斗开始时每名在场己方【炎】干员各一只炎佑，属性 = 模板 + 对应干员的 80%', () => {
  const h = field([seat('p1', 0, { effects: [refOf()], units: yanUnits(3), bonds: bondsOf(3, 0) })]);
  installYanBeasts(hexHooks(h.battle));
  h.run(1);
  const yy = yanyouOf(h);
  assert.equal(yy.length, 3, '三名【炎】干员 ⇒ 三只炎佑');
  for (const y of yy) {
    close(y.s.atk, YANYOU_ATK + 500 * 0.8, '炎佑攻击力 = 模板 + 干员攻击力 × 80%');
    close(y.s.maxHp, YANYOU_HP + 2000 * 0.8, '炎佑生命 = 模板 + 干员生命 × 80%');
    close(y.hp, y.s.maxHp, '炎佑满血登场');
  }
  h.invariants();
});

test('炎百兽: 炎佑属性随【炎】层数增长（80 + 0.4L %）', () => {
  const h = field([seat('p1', 0, { effects: [refOf()], units: yanUnits(3), bonds: bondsOf(3, 50) })]);
  installYanBeasts(hexHooks(h.battle));
  h.run(1);
  assert.equal(layersOf(h), 50, 'premise: 50 层');
  const yy = yanyouOf(h);
  assert.equal(yy.length, 3);
  for (const y of yy) {
    close(y.s.atk, YANYOU_ATK + 500 * 1.0, 'L=50 ⇒ pct = 100%');
    close(y.s.maxHp, YANYOU_HP + 2000 * 1.0, 'L=50 ⇒ pct = 100%');
  }
  h.invariants();
});

test('炎百兽: 非【炎】干员、别人的【炎】干员都不召唤', () => {
  const h = field([
    seat('p1', 0, { effects: [refOf()], units: [at(1, 9, 4, 'test_yan1'), at(2, 9, 5, 'test_plain')], bonds: bondsOf(2) }),
    seat('p2', 1, { effects: [], units: [at(11, 10, 6, 'test_yan2')], bonds: bondsOf(1) }),
  ], { kind: 'unite' });
  installYanBeasts(hexHooks(h.battle));
  h.run(1);
  const yy = yanyouOf(h);
  assert.equal(yy.length, 1, '只有 p1 的那一名【炎】干员召唤了炎佑');
  assert.equal(yy[0].ownerId, 'p1', '炎佑属于 p1');
  h.invariants();
});

// ---- 3b. 防御 / 法抗继承（业主 2026-11-01：「防御力/法抗 100% 继承」） ------------------------------------------

test('炎百兽: 炎佑的防御力 / 法抗直接等于对应干员（100%，不是 80%，也不是模板的 200 / 0）', () => {
  const h = field([seat('p1', 0, {
    effects: [refOf()],
    units: [at(1, 9, 4, 'test_yan_def'), at(2, 9, 5, 'test_yan_res')],
    bonds: bondsOf(2),
  })]);
  installYanBeasts(hexHooks(h.battle));
  h.run(1);
  const hiDef = h.unit('test_yan_def');
  const hiRes = h.unit('test_yan_res');
  assert.deepEqual([hiDef.s.def, hiDef.s.res], [300, 40], 'premise: 高防 / 中法抗');
  assert.deepEqual([hiRes.s.def, hiRes.s.res], [0, 70], 'premise: 0 防 / 高法抗');
  const yy = yanyouOf(h);
  assert.equal(yy.length, 2, 'premise: 两只炎佑');
  // 一只 300/40、一只 0/70 —— 模板的 200 与 0 都不该出现
  assert.deepEqual(yy.map((y) => `${y.s.def}/${y.s.res}`).sort(), ['0/70', '300/40']);
  h.invariants();
});

test('炎百兽: 防御 / 法抗继承比例读卡面 inheritDefPct / inheritResPct', () => {
  const h = field([seat('p1', 0, {
    effects: [refOf({ inheritDefPct: 50, inheritResPct: 50 })],
    units: [at(1, 9, 4, 'test_yan_def')],
    bonds: bondsOf(1),
  })]);
  installYanBeasts(hexHooks(h.battle));
  h.run(1);
  const [y] = yanyouOf(h);
  close(y.s.def, 150, 'inheritDefPct 50 ⇒ 300 × 50% = 150');
  close(y.s.res, 20, 'inheritResPct 50 ⇒ 40 × 50% = 20');
  h.invariants();
});

test('炎百兽: inheritDefPct 0 ⇒ 不继承（炎佑沿用 token 模板的 200 / 0）', () => {
  const h = field([seat('p1', 0, {
    effects: [refOf({ inheritDefPct: 0, inheritResPct: 0 })],
    units: [at(1, 9, 4, 'test_yan_def')],
    bonds: bondsOf(1),
  })]);
  installYanBeasts(hexHooks(h.battle));
  h.run(1);
  const [y] = yanyouOf(h);
  close(y.s.def, 200, '比例 0 ⇒ 模板防御 200');
  close(y.s.res, 0, '比例 0 ⇒ 模板法抗 0');
  h.invariants();
});


// =====================================================================================================================
// 4. 生命共享（同血池）

test('炎百兽: 干员受到 X 点伤害 ⇒ 配对的炎佑也掉 X；炎佑受到 X ⇒ 干员也掉 X', () => {
  const h = field([seat('p1', 0, { effects: [refOf()], units: yanUnits(3), bonds: bondsOf(3) })]);
  installYanBeasts(hexHooks(h.battle));
  h.run(1);
  const yy = yanyouOf(h);
  assert.equal(yy.length, 3, 'premise: 三只炎佑');

  // 打干员 300：配对的那只炎佑也掉 300（同血池：不是 50/50 分摊）
  const before = new Map([...ops(h), ...yy].map((u) => [u, u.hp]));
  const op = ops(h)[0];
  hitTrue(h, op, 300);
  close(op.hp, before.get(op) - 300, '干员掉了 300');
  const drained = yy.filter((y) => Math.abs(before.get(y) - y.hp - 300) < 1e-9);
  assert.equal(drained.length, 1, '正好一只炎佑跟着掉了 300');
  for (const y of yy) if (y !== drained[0]) close(y.hp, before.get(y), '其它炎佑没掉血');

  // 打炎佑 200：配对的干员也掉 200
  const before2 = new Map([...ops(h), ...yy].map((u) => [u, u.hp]));
  hitTrue(h, drained[0], 200);
  close(drained[0].hp, before2.get(drained[0]) - 200, '炎佑掉了 200');
  const hitOps = ops(h).filter((u) => Math.abs(before2.get(u) - u.hp - 200) < 1e-9);
  assert.equal(hitOps.length, 1, '正好一名干员跟着掉了 200');
  assert.equal(hitOps[0], op, '跟着掉血的就是它的搭档');
  h.invariants();
});

test('炎百兽: 元素损伤不是 HP 伤害，不镜像；共享自己的流失不再镜像（防递归）', () => {
  const h = field([seat('p1', 0, { effects: [refOf()], units: yanUnits(3), bonds: bondsOf(3) })]);
  installYanBeasts(hexHooks(h.battle));
  h.run(1);
  const yy = yanyouOf(h);
  const op = ops(h)[0];
  const before = new Map([...ops(h), ...yy].map((u) => [u, u.hp]));

  // 元素损伤：damaged 会以 type 'element' 发出来，但它不是 HP 伤害
  h.battle.dealDamage(null, op, { type: 'element', element: 'burn', amount: 100, canDodge: false, tags: ['test'] });
  close(op.hp, before.get(op), '元素损伤没有掉血');
  for (const y of yy) close(y.hp, before.get(y), '元素损伤没有镜像给炎佑');

  // 带共享 tag 的流失本身不再镜像（否则一条流失会在两者之间来回弹）
  const op2 = ops(h)[1];
  const before2 = new Map([...ops(h), ...yy].map((u) => [u, u.hp]));
  h.battle.loseHp(op2, 120, { tags: ['hpLoss', 'hex:yanbeasts:share'] });
  close(op2.hp, before2.get(op2) - 120, '流失自己生效');
  for (const y of yy) close(y.hp, before2.get(y), '带共享 tag 的流失没有再镜像出去');
  h.invariants();
});

test('炎百兽: 干员阵亡时配对的炎佑一起撤退', () => {
  const h = field([seat('p1', 0, { effects: [refOf()], units: yanUnits(2), bonds: bondsOf(2) })]);
  installYanBeasts(hexHooks(h.battle));
  h.run(1);
  const yy = yanyouOf(h);
  assert.equal(yy.length, 2, 'premise: 两只炎佑');
  const op = ops(h)[0];
  hitTrue(h, op, op.s.maxHp * 2);            // 致命一击：干员倒下
  assert.equal(op.alive, false, 'premise: 干员阵亡');
  assert.equal(op.removeReason, 'killed', 'premise: 真的被击倒（不是撤退）');
  assert.equal(yy.filter((y) => y.alive).length, 1, '只剩搭档没死的那一只炎佑');
  h.invariants();
});

// =====================================================================================================================
// 4b. 生命共享 · 回复方向（业主 2026-11-01：「干员被回血对应的炎佑不回血」）

/** 一个带医疗干员的场：`n` 名【炎】干员 + 1 名非【炎】医疗（治疗来源，避免被当成共享对象）。 */
const healField = (n = 2, effect = {}) => field([seat('p1', 0, {
  effects: [refOf(effect)],
  units: [...yanUnits(n), at(90, 10, 4, 'test_medic')],
  bonds: bondsOf(n),
})]);

test('炎百兽: 干员被治疗 ⇒ 配对的炎佑同样回血（同血池：同样数值，不是分摊）', () => {
  const h = healField(2);
  installYanBeasts(hexHooks(h.battle));
  h.run(1);
  const yy = yanyouOf(h);
  assert.equal(yy.length, 2, 'premise: 两只炎佑');
  const op = h.unit('test_yan1');
  const med = h.unit('test_medic');
  hitTrue(h, op, 400);                                   // 先掉血，才有得治（炎佑也掉 400）
  const opHp0 = op.hp;
  const y0 = yy.map((y) => y.hp);
  close(h.battle.heal(med, op, 300), 300, '医疗干员治了 300');
  close(op.hp, opHp0 + 300, '干员回血 300');
  const gained = yy.map((y, i) => y.hp - y0[i]);
  assert.equal(gained.filter((d) => Math.abs(d - 300) < 1e-9).length, 1, '正好一只炎佑也回了 300');
  assert.equal(gained.filter((d) => Math.abs(d) < 1e-9).length, 1, '另一只炎佑没回血');
  h.invariants();
});

test('炎百兽: 回血共享不递归，超量治疗不给炎佑凭空造血', () => {
  const h = healField(2);
  installYanBeasts(hexHooks(h.battle));
  h.run(1);
  const yy = yanyouOf(h);
  const op = h.unit('test_yan1');
  const med = h.unit('test_medic');

  // 1) 干员满血：治疗落不下 ⇒ 炎佑一点都不涨
  const yFull = yy.map((y) => y.hp);
  close(h.battle.heal(med, op, 500), 0, '满血治不上');
  yy.forEach((y, i) => close(y.hp, yFull[i], '炎佑没有被凭空治疗'));

  // 2) 干员差 100、治 500：引擎只落下 100 ⇒ 炎佑也只涨 100（不是 500，也不会来回弹）
  hitTrue(h, op, 100);
  const y0 = yy.map((y) => y.hp);
  const opHp0 = op.hp;
  close(h.battle.heal(med, op, 500), 100, '超量治疗只落下 100');
  close(op.hp, opHp0 + 100, '干员只涨 100（镜像没有回灌到自己身上）');
  const gained = yy.map((y, i) => y.hp - y0[i]);
  assert.equal(gained.filter((d) => Math.abs(d - 100) < 1e-9).length, 1, '炎佑只涨 100');
  assert.equal(gained.filter((d) => Math.abs(d) < 1e-9).length, 1, '另一只炎佑没涨');
  h.invariants();
});

test('炎百兽: 炎佑被回复 ⇒ 配对的干员也回血（反方向）', () => {
  const h = healField(2);
  installYanBeasts(hexHooks(h.battle));
  h.run(1);
  const yy = yanyouOf(h);
  const op = h.unit('test_yan1');
  const med = h.unit('test_medic');
  hitTrue(h, op, 400);                                   // 干员 -400，配对的炎佑 -400
  const y = yy.find((x) => x.hp < x.s.maxHp);
  assert.ok(y, 'premise: 有一只炎佑掉了血');
  const opHp0 = op.hp;
  const y0 = y.hp;
  // 引擎不给友方召唤物「别人的治疗」（damage.js heal 的规则，也就是设计稿说的【禁疗】）：
  assert.equal(h.battle.heal(med, y, 500), 0, '别人治不到炎佑');
  // 能真的治到炎佑的只有它自己的回复 —— 共享走的就是这条路（self heal）
  close(h.battle.heal(y, y, 150), 150, '炎佑自我回复 150');
  close(y.hp, y0 + 150, '炎佑回血 150');
  close(op.hp, opHp0 + 150, '配对的干员也跟着回 150');
  h.invariants();
});

test('炎百兽: 回血共享的比例读卡面 shareHealPct', () => {
  const h = healField(2, { shareHealPct: 50 });
  installYanBeasts(hexHooks(h.battle));
  h.run(1);
  const yy = yanyouOf(h);
  const op = h.unit('test_yan1');
  const med = h.unit('test_medic');
  hitTrue(h, op, 400);
  const y0 = yy.map((x) => x.hp);
  close(h.battle.heal(med, op, 300), 300, '干员回血 300');
  const gained = yy.map((x, i) => x.hp - y0[i]);
  assert.equal(gained.filter((d) => Math.abs(d - 150) < 1e-9).length, 1, 'shareHealPct 50 ⇒ 炎佑只回一半（150）');
  assert.equal(gained.filter((d) => Math.abs(d) < 1e-9).length, 1, '另一只炎佑没回血');
  h.invariants();
});

test('炎百兽: 没有配对的干员被治疗时，炎佑一点不动（只认配对）', () => {
  const h = healField(2);
  installYanBeasts(hexHooks(h.battle));
  h.run(1);
  const yy = yanyouOf(h);
  const med = h.unit('test_medic');
  // 治疗来源自己：不是任何炎佑的搭档
  hitTrue(h, med, 400);
  const y0 = yy.map((y) => y.hp);
  close(h.battle.heal(med, med, 300), 300, '医疗干员给自己治了 300');
  yy.forEach((y, i) => close(y.hp, y0[i], '没有配对 ⇒ 炎佑不跟着回血'));
  h.invariants();
});

test('炎百兽: 5 名档的每秒回血也按生命共享镜像给炎佑（[ASSUMED]）', () => {
  const h = field([seat('p1', 0, { effects: [refOf()], units: yanUnits(5), bonds: bondsOf(5, 0) })]);
  installYanBeasts(hexHooks(h.battle));
  h.run(1);
  const yy = yanyouOf(h);
  const op = ops(h)[0];
  assert.ok(op.findBuff(REGEN_KEY), 'premise: 5 名档的回血 buff 在');
  hitTrue(h, op, 200);                                   // 掉 200，炎佑也掉 200
  const opHp0 = op.hp;
  const y0 = yy.map((y) => y.hp);
  h.run(2);
  const opGain = op.hp - opHp0;
  assert.ok(opGain > 0, 'premise: 干员的每秒回血在走');
  const total = yy.reduce((s, y, i) => s + (y.hp - y0[i]), 0);
  close(total, opGain, '炎佑那边涨的总量 = 干员回的血（同一份回复，不是另造一份）', 1e-6);
  h.invariants();
});

// =====================================================================================================================
// 5. 5 名档 · 每秒回血

test('炎百兽: 5 名档给【炎】干员挂常驻回血 buff（20 + 0.5L），N=4 没有', () => {
  for (const [n, regen] of [[4, null], [5, 20], [7, 20]]) {
    const h = field([seat('p1', 0, { effects: [refOf()], units: yanUnits(n), bonds: bondsOf(n, 0) })]);
    installYanBeasts(hexHooks(h.battle));
    h.run(1);
    for (const u of ops(h)) {
      if (regen == null) {
        assert.equal(u.s.hpRegen, 0, `N=${n} ⇒ 没有回血`);
        assert.equal(u.findBuff(REGEN_KEY), null, `N=${n} ⇒ 没有回血 buff`);
      } else {
        close(u.s.hpRegen, regen, `N=${n} ⇒ 每秒回复 ${regen}（L=0）`);
        assert.ok(u.findBuff(REGEN_KEY), `N=${n} ⇒ 有回血 buff`);
      }
    }
    h.invariants();
  }
});

test('炎百兽: 5 名档的回血随层数增长，层数变化后刷新', () => {
  const h = field([seat('p1', 0, { effects: [refOf()], units: yanUnits(5), bonds: bondsOf(5, 10) })]);
  installYanBeasts(hexHooks(h.battle));
  h.run(1);
  for (const u of ops(h)) close(u.s.hpRegen, 20 + 0.5 * 10, 'L=10 ⇒ 25');
  // 战斗中加 20 层（炎百兽自己不会加层，这里模拟别处的加层）⇒ 回血跟着涨
  h.battle.addLayers('p1', 'yanShip', 20, 'test');
  h.run(1);
  assert.equal(layersOf(h), 30, 'premise: 30 层');
  for (const u of ops(h)) close(u.s.hpRegen, 20 + 0.5 * 30, 'L=30 ⇒ 35');
  h.invariants();
});

// =====================================================================================================================
// 6. 7 名档 · 祛恶之焰

test('炎百兽: 7 名档把己方炎佑的祛恶之焰改成锁定 2 个目标、伤害倍率随层数增长', () => {
  const h = field([seat('p1', 0, { effects: [refOf()], units: yanUnits(7), bonds: bondsOf(7, 100) })]);
  installYanBeasts(hexHooks(h.battle));
  h.run(1);
  const yy = yanyouOf(h);
  assert.equal(yy.length, 7, 'premise: 七只炎佑');
  for (const y of yy) {
    assert.equal(y.mem.flameTargets, 2, '锁定 2 个目标');
    assert.equal(typeof y.mem.flameScaleFn, 'function', '伤害倍率是运行时函数');
    close(y.mem.flameScaleFn(), (60 + 0.2 * 100) / 100, 'L=100 ⇒ 0.8');
  }
  h.invariants();
});

test('炎百兽: N=6 时没有 7 名档的覆盖（炎佑保持默认 1 目标 / 数据 60%）', () => {
  const h = field([seat('p1', 0, { effects: [refOf()], units: yanUnits(6), bonds: bondsOf(6, 100) })]);
  installYanBeasts(hexHooks(h.battle));
  h.run(1);
  const yy = yanyouOf(h);
  assert.equal(yy.length, 6);
  for (const y of yy) {
    assert.equal(y.mem.flameTargets, undefined, 'N=6 ⇒ 不设置目标数');
    assert.equal(y.mem.flameScaleFn, undefined, 'N=6 ⇒ 不设置倍率');
  }
  h.invariants();
});

test('炎百兽: 7 名档也覆盖原【炎】盟约召唤的炎佑（不只是本卡召唤的）', () => {
  // setup 里注册一个「盟约召唤」：优先级 0，排在【炎百兽】的 battleStart（-10）之前 —— 与生产里 bonds/core.js
  // installYan 的召唤同一时机
  const bondSummon = (b) => b.on('battleStart', () => { spawnYanyou(b, 'p1', { atk: 1, hp: 1, count: 1 }); });
  const h = field([seat('p1', 0, { effects: [refOf()], units: yanUnits(7), bonds: bondsOf(7, 0) })], { setup: bondSummon });
  installYanBeasts(hexHooks(h.battle));
  h.run(1);
  const yy = yanyouOf(h);
  assert.equal(yy.length, 8, 'premise: 盟约 1 只 + 本卡 7 只');
  for (const y of yy) {
    assert.equal(y.mem.flameTargets, 2, '每一只（含盟约召唤的）都锁定 2 个目标');
    close(y.mem.flameScaleFn(), 60 / 100, 'L=0 ⇒ 0.6');
  }
  h.invariants();
});

test('炎百兽: 7 名档下祛恶之焰真的同时锁定 2 个目标（跑到技能自己开起来）', () => {
  // 这一条必须用 content:'full'：祛恶之焰的 kit 住在 content/tokens.js（yanyouKit），'generic' 档不装它，炎佑只会
  // 拿到一个 passive 技能。为了让生产接线不重复安装这张卡，这里的 ref **不带** `yanBeasts` 参数 —— 生产 install 的
  // `ownersOf` 闸门会把拥有者滤掉，于是只有下面这一次手动 install 生效；模块读不到参数就用设计稿口径的兜底值
  // （与卡面同数），所以 7 名档照样成立。
  const bareRef = { ...refOf(), params: { hexId: CARD, rarity: 'gold' } };
  const h = field([seat('p1', 0, { effects: [bareRef], units: yanUnits(7), bonds: bondsOf(7, 0) })], {
    content: 'full',
    enemies: [
      { key: 'enemy_dummy', time: 0, pos: [9, 2] },
      { key: 'enemy_dummy', time: 0, pos: [10, 2] },
      { key: 'enemy_dummy', time: 0, pos: [11, 2] },
    ],
    hooks: ['battleStart', 'deploy', 'damaged', 'death', 'skillStart', 'tick'],
  });
  assert.equal(installYanBeasts(hexHooks(h.battle)), 7, 'premise: 七名【炎】干员被覆盖');
  h.run(1);
  const yy = yanyouOf(h);
  // 生产 content 里【炎】盟约 6 名档自己也会召唤一只（bonds/core.js 给它打 mem.bondYan），本卡的 7 只叠在它上面
  const bondSummoned = yy.filter((y) => y.mem.bondYan);
  const mine = yy.filter((y) => !y.mem.bondYan);
  assert.equal(mine.length, 7, 'premise: 本卡召唤的七只炎佑');
  assert.equal(bondSummoned.length, 1, 'premise: 盟约自己那一只');
  // 祛恶之焰是「时间型技力」的持续技能：spCost 15、spRecovery 1/s ⇒ 约 15 秒后自己开起来（引擎的 DEFAULT 触发）。
  // 炎佑同时飞向敌人，所以给它足够的秒数。
  h.run(20);
  const started = yy.filter((y) => y.mem.flame && Array.isArray(y.mem.flame.targets));
  assert.equal(started.length, yy.length, '每一只炎佑（含盟约召唤的那只）的祛恶之焰都开了');
  for (const y of started) assert.equal(y.mem.flame.targets.length, 2, '每只都锁定 2 个目标');
  h.invariants();
});

// =====================================================================================================================
// 7. 参数读卡面

test('炎百兽: 参数全部读卡面（改卡面就改结果）', () => {
  const h = field([seat('p1', 0, {
    effects: [refOf({
      spCostPct: 10, spCostTierPct: 20,
      summonPct: 50, summonPerLayerPct: 1,
      regenCount: 2, regen: 40, regenPerLayer: 2,
      flameCount: 2, flameTargets: 3, flameScale: 90, flameScalePerLayer: 1,
    })],
    units: yanUnits(3),
    bonds: bondsOf(3, 10),
  })]);
  installYanBeasts(hexHooks(h.battle));
  h.run(1);
  // 技力消耗：10% 常驻 + 2 名档 20% + 2 名档 20%（阈值都改成 2）⇒ ×1.5
  for (const u of ops(h)) close(u.skill.spCostMul, 1 + (10 + 20 + 20) / 100, '卡面的 spCostPct / spCostTierPct');
  // 召唤：pct = (50 + 1 × 10) / 100 = 60%
  const yy = yanyouOf(h);
  assert.equal(yy.length, 3);
  for (const y of yy) {
    close(y.s.atk, YANYOU_ATK + 500 * 0.6, '卡面的 summonPct / summonPerLayerPct');
    close(y.s.maxHp, YANYOU_HP + 2000 * 0.6, '卡面的 summonPct / summonPerLayerPct');
  }
  // 回血：40 + 2 × 10 = 60
  for (const u of ops(h)) close(u.s.hpRegen, 40 + 2 * 10, '卡面的 regen / regenPerLayer');
  // 祛恶之焰：3 个目标、(90 + 1 × 10) / 100 = 1.0
  for (const y of yy) {
    assert.equal(y.mem.flameTargets, 3, '卡面的 flameTargets');
    close(y.mem.flameScaleFn(), (90 + 1 * 10) / 100, '卡面的 flameScale / flameScalePerLayer');
  }
  h.invariants();
});

test('炎百兽: 卡面缺格子时用设计稿口径兜底', () => {
  const h = field([seat('p1', 0, { effects: [refOf({ summonPct: undefined, summonPerLayerPct: undefined })], units: yanUnits(3), bonds: bondsOf(3, 0) })]);
  installYanBeasts(hexHooks(h.battle));
  h.run(1);
  const yy = yanyouOf(h);
  assert.equal(yy.length, 3);
  for (const y of yy) close(y.s.atk, YANYOU_ATK + 500 * 0.8, '缺 summonPct ⇒ 兜底 80%');
  h.invariants();
});
