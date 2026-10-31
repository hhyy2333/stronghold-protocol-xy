// test/sim/hex-mode-modules-isw.test.js — 【特限恢复】hex_mode_modules 的 **ISW** 特限模组战斗半边：
// server/sim/content/hexcards/stone_mode_modules_isw.js 的 installModeModulesIsw。
//
// 设计稿：04-文档/协议源石-突破极限与特限恢复-设计稿-20261031.md §4.3（ISW- 那 8 名干员），外加业主 2026-10-31
// 追加的第 9 名 **号角**「号角特限证章」（04-文档/协议源石-号角特限模组-设计稿-20261031.md §3）；
// RA- 三行在 hex-mode-modules-ra.test.js，SO- 在后续模块里）。
//
// 驱动方式与 hex-stone-victoria-decay.test.js 一致：真实 sim Battle（test/helpers/battleHarness.js 的
// makeBattle / chessRec / enemyRec）+ 生产用的 `hexHooks(battle)` 手工安装，effect ref 按 server/match/hextech.js
// `addHexRef` 的形状手搓（`{ id:'hex:hex_mode_modules', key:'hex:hex_mode_modules', params:{ modeModules:{ level:3,
// types:['ISW','SO','RA'] }, hexId }, data:{ hexId }, battle:true }`），所以本套件不依赖 content/hextech.js 的接线
// 是否已经落地。`content: 'generic'` 让 installContent 不跑 content/hextech.js 的 `install()`，于是这些数字只可能
// 来自被测模块。
//
// 「当前装备的模组」按 data/chess.json 记录的形状手写进 `defs.chess` 的记录里
// （`module: { id, type: 'ISW-A', level: 1, active: true }`；`chessRec()` 本身没有这个字段，所以在这里补）。
// simdata.normalizeChess 只把原始记录留在 `def.raw` 下，模块两处都读（`def.module ?? def.raw.module`）。
//
// 干员是**开打之后**才部署的（`battleStart` / `deploy` 才装被动），所以每个 test 都先 `h.run(0.1)` 把战斗跑起来
// 再断言；测试棋子的 `cost: 0` 让全部干员一开始就落地，不被部署费用挡住。
//
// 覆盖（设计稿 §4.3 的 ISW 八条 + 第 9 名号角，一条一个 test）：
//   无卡无效果；空弦（攻击回复干员数 → rangeExtend，最高 +3，离场掉回去）；水月（aspd +50 / 每秒 4% 最大生命）；
//   灵知（寒冷 / 冻结的敌人每 0.5s 吃 0.5×ATK 法术伤害）；夕（maxTargets +1）；归溟幽灵鲨（自身与替身
//   dealt ×1.4 / taken ×0.6）；安洁莉娜（全场敌人 massFlat -1，含新刷的敌人，离场撤销）；迷迭香（每次攻击额外
//   1.0×ATK 法术伤害，非攻击 / 流失 / 链式不算）；琳琅诗怀雅（再部署时间 -30%）；
//   号角（04-文档/协议源石-号角特限模组-设计稿-20261031.md §3：重装光环 atkPct +8% / hpPct +12%；身前 2 格
//   rangeExtend / maxTargets 各 +1、封顶 +2、人走了掉回去；3 级部署 +10 技力、本场封顶 20；可以攻击隐匿敌人）；
//   非 ISW- 模组 / 未启用模组不生效；别人的干员不生效；数值读卡面；
//   生产链路（真实棋子 + 选中 ISW 模组，模组在 `def.raw.module` 上）同样生效。
//
// [ASSUMED]（模块头注释里有完整口径，这里是测试侧的断言口径）：
//   1. 空弦数的「己方」= 拥有者自己的在场干员（含她自己），不是队友的干员；封顶 3。
//   2. 「在场」= alive && deployed && !hidden（`hexHooks.onField`）。
//   3. 灵知的脉冲在 t = 0.5s / 1.0s / …（`battle.every` 的第一个脉冲在一个间隔之后），伤害 = 0.5 × 自身 ATK、
//      法术、不可闪避。
//   4. 迷迭香的附伤是**独立的一发**法术伤害（1.0 × 自身 ATK），不是「主伤害 ×2」。
//   5. 琳琅诗怀雅只落地「再部署时间 -30%」（战斗内没有部署费用，其余整条跳过）。
//   6. 号角光环给**全场己方**重装（含队友的、含她自己），每 0.25 s 刷新 / 持续 0.5 s（`battleStart` / `deploy`
//      时立刻补一次）；与 1 天赋军事要塞叠加（本套件 `content: 'generic'` 没有 kit，所以只看得到模组那一份）。
//   7. 号角「身前 2 格」= 朝向的直线前 1、前 2 格，只数己方单位（干员 + 召唤物，装置不算），两张格子封顶 +2 / +2；
//      这份 rangeExtend 是常驻的（引擎算进 `baseRangeExtend`）。
//   8. 号角技力：每次部署 +10，本场累计封顶 20（`u.mem` 记账，按 `u.deploySeq` 幂等）。
//   9. `seeStealth` 只放开**索敌**：`canTargetEnemy` 为 true，`battle.foesInRadius` 的溅射仍然跳过隐匿。

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { hexHooks } from '../../server/sim/content/hexcards/hooks.js';
import { installModeModulesIsw } from '../../server/sim/content/hexcards/stone_mode_modules_isw.js';
import { makeDamageInfo } from '../../server/sim/damage.js';
import { canTargetEnemy, enemyStealthed } from '../../server/sim/targeting.js';

const CARD = 'hex_mode_modules';
const KEY = 'modeModules';

/** 卡面参数（生产接线按 `types` 门控 ownersOf；本模块自己不再读它）。 */
const SPEC = Object.freeze({ level: 3, types: ['ISW', 'SO', 'RA'] });

/** One playerEffects entry, the shape server/match/hextech.js addHexRef writes. */
const refOf = (effect = SPEC) => ({
  id: `hex:${CARD}`, key: `hex:${CARD}`, name: '特限恢复', desc: '', iconKind: 'hex', iconId: CARD,
  counter: null, battle: true,
  params: { [KEY]: { ...effect }, hexId: CARD },
  data: { hexId: CARD },
});

/** 一条模组记录（data/chess.json `module` 的形状）。 */
const modOf = (type, active = true) => ({ id: `uniequip_${type.replace(/-/g, '_').toLowerCase()}`, name: `${type} 证章`, type, level: 1, active });
const ISW = modOf('ISW-A');
const OTHER = modOf('MAR-Y');       // 普通模组：不是 ISW- 前缀
const OFF = modOf('ISW-A', false);  // ISW 模组但没启用

/** 攻击回复 / 时间回复技能（spType 由 simdata normSpType 归一成 'attack' / 'time'）。 */
const ATTACK_SKILL = Object.freeze({ spType: 'INCREASE_WHEN_ATTACK' });
const TIME_SKILL = Object.freeze({ spType: 'INCREASE_WITH_TIME' });

/**
 * 一个干员记录：真实棋子 id（`_b` 归一到 `_a` 才是设计稿的分组键）+ 手写的 module 字段。
 * `cost: 0` = 测试棋子不花部署费用，保证一开始就全部落地；`profession` 用来造号角光环的靶子（重装）。
 */
const opRec = (id, { module = ISW, stats = {}, skill = null, name = null, profession = undefined } = {}) => ({
  ...chessRec({
    id, name: name ?? id, skill, profession,
    stats: { maxHp: 2000, atk: 500, def: 0, res: 0, blockCnt: 1, respawnTime: 20, cost: 0, ...stats },
  }),
  module,
});

const CHESS = {
  chess_char_3_21_b: opRec('chess_char_3_21_b', { name: '空弦' }),                                   // 空弦（默认不带技能）
  chess_char_4_09_b: opRec('chess_char_4_09_b', { name: '水月', stats: { maxHp: 1000, atk: 100 } }),  // 水月
  chess_char_4_13_b: opRec('chess_char_4_13_b', { name: '灵知', stats: { atk: 500 } }),               // 灵知
  chess_char_5_12_b: opRec('chess_char_5_12_b', { name: '夕' }),                                      // 夕
  chess_char_5_13_b: opRec('chess_char_5_13_b', { name: '归溟幽灵鲨' }),                              // 归溟幽灵鲨
  chess_char_5_20_b: opRec('chess_char_5_20_b', { name: '安洁莉娜' }),                                // 安洁莉娜
  chess_char_6_12_b: opRec('chess_char_6_12_b', { name: '迷迭香', stats: { atk: 500 } }),             // 迷迭香
  chess_char_3_04_b: opRec('chess_char_3_04_b', { name: '琳琅诗怀雅' }),                              // 琳琅诗怀雅
  chess_char_5_08_b: opRec('chess_char_5_08_b', { name: '号角', profession: 'TANK' }),                // 号角（5 阶重装·要塞）
  // 只用来数「攻击回复干员」的棋子：没有模组，不参与任何效果
  test_atk1: opRec('test_atk1', { module: null, skill: ATTACK_SKILL }),
  test_atk2: opRec('test_atk2', { module: null, skill: ATTACK_SKILL }),
  test_atk3: opRec('test_atk3', { module: null, skill: ATTACK_SKILL }),
  test_timer: opRec('test_timer', { module: null, skill: TIME_SKILL }),   // 时间回复：不算「攻击回复」
  // 号角的靶子 / 身前格数用的己方单位（都没有模组，不吃任何效果）
  test_tank: opRec('test_tank', { module: null, name: 'test 重装', profession: 'TANK' }),
  test_ally: opRec('test_ally', { module: null, name: 'test 近卫' }),
};

/** 血厚、不动、不还手的靶子；`mass: 3` 让「重量 -1」看得见。 */
const ENEMIES = {
  enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1000000, atk: 0, def: 0, res: 0, speed: 0, mass: 3 }),
};

/** 一个席位（多玩家场：seat 1 落在 +8 列外）。 */
const seat = (playerId, i, { effects = [], units = [], bonds = {} } = {}) => ({
  playerId, seat: i, side: 'L', colOffset: i === 0 ? 0 : 8, bonds, playerEffects: effects, units,
});
/** 棋盘上的一枚棋子。 */
const at = (uid, row, col, chessId) => ({ uid, kind: 'chess', chessId, row, col });

/** 一个安静的测试场（不自动结束；敌人停在 [12,2]，够不着 row 9 的干员）。 */
function field(players, { enemies = [{ key: 'enemy_dummy', time: 0, route: 0, pos: [12, 2] }], chess = {} } = {}) {
  return makeBattle({
    kind: players.length > 1 ? 'unite' : 'normal',
    content: 'generic',
    defs: { chess: { ...CHESS, ...chess }, enemies: ENEMIES },
    players,
    enemies,
    autoFinish: false,
    timeLimit: 30,
    captureNoisy: true,
    hooks: ['hit', 'battleStart', 'deploy', 'death', 'enemySpawn', 'kill'],
  });
}

/** 把战斗跑起来（battleStart / 首次 deploy 之后被动才挂上），再断言。 */
const start = (h) => h.run(0.1);
/** 场上第一个活敌人。 */
const foeOf = (h) => h.enemies()[0];
/** 一发「攻击命中」实例（敌人 0 防 0 抗 ⇒ 最终伤害 = amount）。 */
const attackHit = (h, u, foe, amount = 1000, over = {}) =>
  h.battle.dealDamage(u, foe, makeDamageInfo({ amount, type: 'phys', canDodge: false, isAttack: true, ...over }));

// =====================================================================================================================
// 无卡

test('特限恢复 ISW: 没有这张卡时 install 返回 0，八条效果一条都不生效', () => {
  const h = field([seat('p1', 0, {
    units: [
      at(1, 9, 4, 'chess_char_4_09_b'),   // 水月
      at(2, 9, 5, 'chess_char_5_12_b'),   // 夕
      at(3, 9, 6, 'chess_char_5_13_b'),   // 归溟幽灵鲨
      at(4, 9, 7, 'chess_char_5_20_b'),   // 安洁莉娜
      at(5, 9, 8, 'chess_char_6_12_b'),   // 迷迭香
    ],
  })]);
  const inst = installModeModulesIsw(hexHooks(h.battle));
  assert.equal(inst, 0, '没有卡 ⇒ install 返回 0');
  start(h);
  assert.equal(h.unit('chess_char_4_09_b').s.aspd, 100, '水月没有攻速加成');
  assert.equal(h.unit('chess_char_5_12_b').s.maxTargets, 0, '夕没有额外目标');
  assert.equal(h.unit('chess_char_5_13_b').s.physDealtMul, 1, '归溟幽灵鲨没有倍率');
  assert.equal(foeOf(h).s.massLevel, 3, '安洁莉娜不减重');
  const foe = foeOf(h);
  const hp0 = foe.hp;
  attackHit(h, h.unit('chess_char_6_12_b'), foe);
  assert.equal(hp0 - foe.hp, 1000, '迷迭香只有主伤害');
});

// =====================================================================================================================
// 空弦

test('特限恢复 ISW: 空弦 — 每有一名攻击回复干员在场 rangeExtend +1，最高 +3', () => {
  // 空弦自己不带技能 + 一名攻击回复 + 一名时间回复 ⇒ 只有 1 名攻击回复
  const h = field([seat('p1', 0, {
    effects: [refOf()],
    units: [
      at(1, 9, 4, 'chess_char_3_21_b'),
      at(2, 9, 5, 'test_atk1'),
      at(3, 9, 6, 'test_timer'),
    ],
  })]);
  const inst = installModeModulesIsw(hexHooks(h.battle));
  assert.notEqual(inst, 0);
  start(h);
  assert.equal(inst.carriers, 1, '只有空弦带着 ISW 模组');
  const archet = h.unit('chess_char_3_21_b');
  assert.equal(archet.s.rangeExtend, 1, '1 名攻击回复 ⇒ +1');
  assert.equal(archet.s.baseRangeExtend, 1, '常驻（初始范围）那一份也是 +1');
  // 攻击范围真的变宽（rangeChanged 在下一 tick 重建 rangeKeys）
  h.run(0.2);
  assert.ok(archet.rangeKeys.length > 2, `攻击范围已扩展（${archet.rangeKeys.length} 格）`);
});

test('特限恢复 ISW: 空弦 — 攻击回复干员数封顶 +3，有人离场时掉回去', () => {
  // 空弦自己也带攻击回复技能 ⇒ 4 名攻击回复，封顶 3
  const h = field([seat('p1', 0, {
    effects: [refOf()],
    units: [
      at(1, 9, 4, 'chess_char_3_21_b'),
      at(2, 9, 5, 'test_atk1'),
      at(3, 9, 6, 'test_atk2'),
      at(4, 9, 7, 'test_atk3'),
    ],
  })], { chess: { chess_char_3_21_b: opRec('chess_char_3_21_b', { name: '空弦', skill: ATTACK_SKILL }) } });
  installModeModulesIsw(hexHooks(h.battle));
  start(h);
  const archet = h.unit('chess_char_3_21_b');
  assert.equal(archet.s.rangeExtend, 3, '4 名攻击回复 ⇒ 封顶 +3');
  // 击倒两名攻击回复 ⇒ 场上还剩 2 名（空弦 + test_atk1）
  h.battle.kill(h.unit('test_atk2'));
  h.battle.kill(h.unit('test_atk3'));
  assert.equal(archet.s.rangeExtend, 2, '有人离场 ⇒ 掉回 +2');
});

// =====================================================================================================================
// 水月

test('特限恢复 ISW: 水月 — 攻击速度 +50、每秒回复 4% 最大生命', () => {
  const h = field([seat('p1', 0, { effects: [refOf()], units: [at(1, 9, 4, 'chess_char_4_09_b')] })]);
  installModeModulesIsw(hexHooks(h.battle));
  start(h);
  const mizuki = h.unit('chess_char_4_09_b');
  assert.equal(mizuki.s.aspd, 150, '100 + 50');
  assert.equal(mizuki.s.hpRegen, 0.04 * mizuki.s.maxHp, '每秒 4% 最大生命');
  assert.equal(mizuki.s.maxHp, 1000, '只加攻速与回复，不动生命上限');
});

// =====================================================================================================================
// 灵知

test('特限恢复 ISW: 灵知 — 带寒冷 / 冻结的敌人每 0.5 秒吃 0.5×ATK 法术伤害', () => {
  const h = field([seat('p1', 0, { effects: [refOf()], units: [at(1, 9, 4, 'chess_char_4_13_b')] })]);
  const inst = installModeModulesIsw(hexHooks(h.battle));
  start(h);
  const gnosis = h.unit('chess_char_4_13_b');
  const foe = foeOf(h);
  // 没有寒冷 / 冻结：一滴血都不掉
  const hp0 = foe.hp;
  h.run(0.6);
  assert.equal(foe.hp, hp0, '没有寒冷 / 冻结 ⇒ 不掉血');
  assert.equal(inst.ticks, 0);
  // 寒冷 ⇒ 下一个脉冲 0.5 × 500 = 250 法术伤害（敌人 0 法抗）
  h.battle.applyStatus(foe, 'cold', { duration: 30, source: gnosis });
  const hp1 = foe.hp;
  h.run(0.6);
  assert.equal(hp1 - foe.hp, 250, '0.5 × ATK 法术伤害');
  assert.equal(inst.ticks, 1, '0.5 秒一次');
  // 冻结也算
  h.battle.applyStatus(foe, 'freeze', { duration: 30, source: gnosis });
  const hp2 = foe.hp;
  h.run(0.6);
  assert.equal(hp2 - foe.hp, 250, '冻结同样触发');
  // 灵知离场 ⇒ 脉冲停
  h.battle.kill(gnosis);
  const hp3 = foe.hp;
  h.run(1);
  assert.equal(foe.hp, hp3, '灵知不在场 ⇒ 不再掉血');
});

// =====================================================================================================================
// 夕

test('特限恢复 ISW: 夕 — 额外攻击一个目标（maxTargets +1）', () => {
  const h = field([seat('p1', 0, { effects: [refOf()], units: [at(1, 9, 4, 'chess_char_5_12_b')] })]);
  installModeModulesIsw(hexHooks(h.battle));
  start(h);
  assert.equal(h.unit('chess_char_5_12_b').s.maxTargets, 1);
});

// =====================================================================================================================
// 归溟幽灵鲨

test('特限恢复 ISW: 归溟幽灵鲨 — 自身与替身造成 +40% / 受到 -40%', () => {
  const h = field([seat('p1', 0, { effects: [refOf()], units: [at(1, 9, 4, 'chess_char_5_13_b')] })]);
  installModeModulesIsw(hexHooks(h.battle));
  start(h);
  const ghost = h.unit('chess_char_5_13_b');
  assert.equal(ghost.s.physDealtMul, 1.4, '造成物理 +40%');
  assert.equal(ghost.s.artsDealtMul, 1.4, '造成法术 +40%');
  assert.equal(ghost.s.physTakenMul, 0.6, '受到物理 -40%');
  assert.equal(ghost.s.artsTakenMul, 0.6, '受到法术 -40%');
  // 替身：同玩家、defId / 名字像替身的 token 吃同一份倍率（deploy 时补）
  const doll = h.battle.spawnToken(ghost, 'token_test_doll', 10, 4, {
    def: { name: '替身', stats: { maxHp: 800, atk: 100, def: 0, res: 0, blockCnt: 0 } },
  });
  assert.ok(doll, '替身 token 生成成功');
  assert.equal(doll.kind, 'token');
  assert.equal(doll.ownerId, 'p1');
  assert.equal(doll.s.physDealtMul, 1.4);
  assert.equal(doll.s.artsTakenMul, 0.6);
});

// =====================================================================================================================
// 安洁莉娜

test('特限恢复 ISW: 安洁莉娜 — 在场时全场敌人重量 -1（新刷的敌人也补），离场撤销', () => {
  const h = field([seat('p1', 0, { effects: [refOf()], units: [at(1, 9, 4, 'chess_char_5_20_b')] })]);
  const inst = installModeModulesIsw(hexHooks(h.battle));
  start(h);
  const foe = foeOf(h);
  assert.equal(foe.s.massLevel, 2, '3 - 1');
  // 战斗中新刷出来的敌人也要减重（battle.on('enemySpawn')）
  const late = h.spawn('enemy_dummy', { pos: [12, 5] });
  assert.ok(late, '新敌人生成成功');
  assert.equal(late.s.massLevel, 2, '新刷的敌人同样 -1');
  assert.ok(inst.massApplied >= 2, `补挂次数 ${inst.massApplied}`);
  // 她离场 ⇒ 减重撤销（battle.every(0.5) 对账）
  h.battle.kill(h.unit('chess_char_5_20_b'));
  h.run(0.6);
  assert.equal(foe.s.massLevel, 3, '安洁莉娜不在场 ⇒ 重量复原');
  assert.equal(late.s.massLevel, 3);
});

// =====================================================================================================================
// 迷迭香

test('特限恢复 ISW: 迷迭香 — 每次攻击额外造成 1.0×ATK 法术伤害', () => {
  const h = field([seat('p1', 0, { effects: [refOf()], units: [at(1, 9, 4, 'chess_char_6_12_b')] })]);
  const inst = installModeModulesIsw(hexHooks(h.battle));
  start(h);
  const rosmon = h.unit('chess_char_6_12_b');
  const foe = foeOf(h);
  // 一次 1000 物理攻击 ⇒ 1000 主伤害 + 500（1.0 × 500 ATK）法术附伤
  const hp0 = foe.hp;
  attackHit(h, rosmon, foe);
  assert.equal(hp0 - foe.hp, 1500, '主伤害 + 1.0×ATK 法术附伤');
  assert.equal(inst.extras, 1);
  // 不是「攻击」的伤害实例（isAttack 假）不附伤
  const hp1 = foe.hp;
  h.battle.dealDamage(rosmon, foe, makeDamageInfo({ amount: 1000, type: 'phys', canDodge: false }));
  assert.equal(hp1 - foe.hp, 1000, '非攻击实例不附伤');
  // 流失不附伤
  const hp2 = foe.hp;
  h.battle.loseHp(foe, 100, { tags: ['hpLoss'] });
  assert.equal(hp2 - foe.hp, 100, '流失不附伤');
  // 链式附加（在另一次伤害结算里打出来的）不附伤
  const hp3 = foe.hp;
  const chained = makeDamageInfo({ amount: 1000, type: 'phys', canDodge: false, isAttack: true });
  chained.chained = true;
  h.battle.dealDamage(rosmon, foe, chained);
  assert.equal(hp3 - foe.hp, 1000, '链式附加不附伤');
  assert.equal(inst.extras, 1, '只有第一次攻击附了伤');
});

// =====================================================================================================================
// 琳琅诗怀雅

test('特限恢复 ISW: 琳琅诗怀雅 — 只落地「再部署时间 -30%」[ASSUMED]', () => {
  const h = field([seat('p1', 0, { effects: [refOf()], units: [at(1, 9, 4, 'chess_char_3_04_b')] })]);
  installModeModulesIsw(hexHooks(h.battle));
  start(h);
  const swire = h.unit('chess_char_3_04_b');
  assert.equal(swire.s.redeployMul, 0.7, '-30% ⇒ ×0.7');
  assert.equal(swire.base.respawnTime * swire.s.redeployMul, 14, '20 秒 → 14 秒');
});

// =====================================================================================================================
// 模组判据 / 拥有者判据

test('特限恢复 ISW: 模组不是 ISW-（普通模组）或未启用时，一条效果都不生效', () => {
  const h = field([seat('p1', 0, {
    effects: [refOf()],
    units: [
      at(1, 9, 4, 'chess_char_4_09_b'),   // 水月 + 普通模组
      at(2, 9, 5, 'chess_char_6_12_b'),   // 迷迭香 + 未启用的 ISW 模组
      at(3, 9, 6, 'chess_char_5_20_b'),   // 安洁莉娜 + 普通模组
    ],
  })], {
    chess: {
      chess_char_4_09_b: opRec('chess_char_4_09_b', { module: OTHER, stats: { maxHp: 1000, atk: 100 } }),
      chess_char_6_12_b: opRec('chess_char_6_12_b', { module: OFF, stats: { atk: 500 } }),
      chess_char_5_20_b: opRec('chess_char_5_20_b', { module: OTHER }),
    },
  });
  const inst = installModeModulesIsw(hexHooks(h.battle));
  assert.notEqual(inst, 0, '卡在');
  start(h);
  assert.equal(inst.carriers, 0, '没有一名干员带着启用的 ISW 模组');
  assert.equal(h.unit('chess_char_4_09_b').s.aspd, 100, '水月不生效');
  assert.equal(foeOf(h).s.massLevel, 3, '安洁莉娜不生效');
  const foe = foeOf(h);
  const hp0 = foe.hp;
  attackHit(h, h.unit('chess_char_6_12_b'), foe);
  assert.equal(hp0 - foe.hp, 1000, '迷迭香不附伤（模组未启用）');
});

test('特限恢复 ISW: 只对拥有者的干员生效，别人的干员一条都不吃', () => {
  const h = field([
    seat('p1', 0, {
      effects: [refOf()],
      units: [at(1, 9, 4, 'chess_char_4_09_b')],                                  // p1（拥有者）的水月
    }),
    seat('p2', 1, {
      units: [
        at(2, 9, 4, 'chess_char_4_09_b'),   // p2 的水月
        at(3, 9, 5, 'chess_char_6_12_b'),   // p2 的迷迭香
        at(4, 9, 6, 'chess_char_5_20_b'),   // p2 的安洁莉娜
      ],
    }),
  ]);
  installModeModulesIsw(hexHooks(h.battle));
  start(h);
  const own = h.battle.allyUnits.find((u) => u.ownerId === 'p1' && u.defId === 'chess_char_4_09_b');
  const other = h.battle.allyUnits.find((u) => u.ownerId === 'p2' && u.defId === 'chess_char_4_09_b');
  const otherRosmon = h.battle.allyUnits.find((u) => u.ownerId === 'p2' && u.defId === 'chess_char_6_12_b');
  assert.equal(own.s.aspd, 150, '拥有者的水月吃加成');
  assert.equal(other.s.aspd, 100, '别人的水月不吃');
  // 别人的迷迭香不附伤
  const foe = foeOf(h);
  const hp0 = foe.hp;
  attackHit(h, otherRosmon, foe);
  assert.equal(hp0 - foe.hp, 1000, '别人的迷迭香不附伤');
  // 别人的安洁莉娜不减重
  assert.equal(foe.s.massLevel, 3, '别人的安洁莉娜不减重');
});

// =====================================================================================================================
// 号角（第 9 名 · 号角特限证章 ISW-A / 设计稿 04-文档/协议源石-号角特限模组-设计稿-20261031.md §3）

/** 浮点比较（1.08 / 1.12 这种倍率算出来不是整数）。 */
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/** 号角的测试场：p1 带（或不带）【特限恢复】，号角与 `units` 一起落地。 */
const hornField = (units, { withCard = true, chess = {} } = {}) =>
  field([seat('p1', 0, { effects: withCard ? [refOf()] : [], units })], { chess });

/** 把场上第一个敌人挂上隐匿（status `stealth`：flags.stealth ⇒ targeting.js enemyStealthed）。 */
const stealthFoe = (h) => {
  const foe = foeOf(h);
  h.battle.applyStatus(foe, 'stealth', { duration: 30 });
  assert.equal(enemyStealthed(foe), true, 'premise: 敌人处于隐匿');
  return foe;
};

test('特限恢复 ISW: 号角 — 在场时全场己方重装干员 atk +8% / 生命上限 +12%', () => {
  const units = [
    at(1, 9, 4, 'chess_char_5_08_b'),   // 号角（朝向 RIGHT）
    at(2, 10, 4, 'test_tank'),          // 同玩家的重装，不在号角身前
  ];
  const ctl = hornField(units, { withCard: false });
  assert.equal(installModeModulesIsw(hexHooks(ctl.battle)), 0, '对照场没有卡');
  start(ctl);
  const h = hornField(units);
  installModeModulesIsw(hexHooks(h.battle));
  start(h);
  const horn = h.unit('chess_char_5_08_b');
  assert.equal(horn.dir, 'RIGHT', 'premise: 号角朝向 RIGHT（身前 = (9,5) / (9,6)）');
  const t0 = ctl.unit('test_tank');
  const t1 = h.unit('test_tank');
  assert.equal(t0.s.atk, 500, '对照场：重装 500 攻');
  assert.equal(t0.s.maxHp, 2000, '对照场：重装 2000 生命');
  assert.ok(near(t1.s.atk, 540), `有卡：500 × 1.08 = 540（实际 ${t1.s.atk}）`);
  assert.ok(near(t1.s.maxHp, 2240), `有卡：2000 × 1.12 = 2240（实际 ${t1.s.maxHp}）`);
  assert.ok(near(horn.s.atk, 540), '号角自己也是重装 ⇒ 同样吃光环');
  // 号角离场 ⇒ 光环 0.5 秒内过期（0.25 s 的刷新不再补）
  h.battle.kill(horn);
  h.run(0.6);
  assert.ok(near(t1.s.atk, 500), `号角不在场 ⇒ 光环过期（实际 ${t1.s.atk}）`);
  assert.ok(near(t1.s.maxHp, 2000), '生命上限同样掉回去');
});

test('特限恢复 ISW: 号角 — 身前 2 格每名己方单位 rangeExtend +1 / maxTargets +1（封顶 +2，人走了掉回去）', () => {
  const HORN = (extra) => hornField([at(1, 9, 4, 'chess_char_5_08_b'), ...extra]);
  // 0 人：身后（左侧）那一个不算 —— 只数朝向的直线前两格
  const none = HORN([at(2, 9, 3, 'test_ally')]);
  installModeModulesIsw(hexHooks(none.battle));
  start(none);
  const horn0 = none.unit('chess_char_5_08_b');
  assert.equal(horn0.dir, 'RIGHT', 'premise: 朝向 RIGHT ⇒ 身前是 (9,5) / (9,6)');
  assert.equal(horn0.s.rangeExtend, 0, '身前 0 人 ⇒ 不加（身后那一个不算）');
  assert.equal(horn0.s.maxTargets, 0);
  // 1 人：前 1 格
  const one = HORN([at(2, 9, 5, 'test_ally')]);
  installModeModulesIsw(hexHooks(one.battle));
  start(one);
  const horn1 = one.unit('chess_char_5_08_b');
  assert.equal(horn1.s.rangeExtend, 1, '前 1 格有 1 人 ⇒ +1');
  assert.equal(horn1.s.maxTargets, 1);
  // 2 人：前 1、前 2 格
  const two = HORN([at(2, 9, 5, 'test_ally'), at(3, 9, 6, 'test_tank')]);
  installModeModulesIsw(hexHooks(two.battle));
  start(two);
  const horn2 = two.unit('chess_char_5_08_b');
  assert.equal(horn2.s.rangeExtend, 2, '两张格子各 1 名 ⇒ +2（封顶）');
  assert.equal(horn2.s.maxTargets, 2);
  assert.equal(horn2.s.baseRangeExtend, 2, '常驻的那一份也算进初始攻击范围');
  // 前 1 格的人撤掉 ⇒ 掉回 +1
  two.battle.kill(two.unit('test_ally'));
  assert.equal(horn2.s.rangeExtend, 1, '前 1 格的人走了 ⇒ 掉回 +1');
  assert.equal(horn2.s.maxTargets, 1);
  // 前 2 格的人也撤掉 ⇒ 0（buff 整个撤掉）
  two.battle.kill(two.unit('test_tank'));
  assert.equal(horn2.s.rangeExtend, 0, '身前没人了 ⇒ 回到 0');
  assert.equal(horn2.s.maxTargets, 0);
  assert.equal(horn2.findBuff('hex:modemodules:isw:horn:front'), null, 'buff 已撤销');
});

test('特限恢复 ISW: 号角 — 每次部署 +10 技力，本场累计封顶 20', () => {
  // spRecovery 0 ⇒ 没有时间回复，sp 只来自模组这一份；spCost 30 ⇒ 不会被充满（充能会把 sp 夹到 spCost）
  const skill = { spType: 'INCREASE_WITH_TIME', spCost: 30, initSp: 0 };
  const chess = {
    chess_char_5_08_b: opRec('chess_char_5_08_b', { name: '号角', profession: 'TANK', skill, stats: { spRecovery: 0 } }),
  };
  const h = hornField([at(1, 9, 4, 'chess_char_5_08_b')], { chess });
  installModeModulesIsw(hexHooks(h.battle));
  start(h);
  const horn = h.unit('chess_char_5_08_b');
  assert.equal(horn.skill.sp, 10, '首次部署 +10');
  // 再部署（保留技力）⇒ 本场累计 20
  h.battle.kill(horn);
  assert.equal(h.battle.redeploy(horn, { free: true, keepSp: true }), true, '第二次部署成功');
  assert.equal(horn.skill.sp, 20, '第二次部署 +10 ⇒ 20');
  // 第三次部署：本场封顶 20 ⇒ 不再加
  h.battle.kill(horn);
  assert.equal(h.battle.redeploy(horn, { free: true, keepSp: true }), true, '第三次部署成功');
  assert.equal(horn.skill.sp, 20, '封顶 20 ⇒ 不再加');
});

test('特限恢复 ISW: 号角 — 可以攻击隐匿的敌人（只放开索敌，溅射仍然跳过隐匿）', () => {
  const h = hornField([at(1, 9, 4, 'chess_char_5_08_b')]);
  installModeModulesIsw(hexHooks(h.battle));
  start(h);
  const horn = h.unit('chess_char_5_08_b');
  const foe = stealthFoe(h);
  assert.equal(horn.s.flags.seeStealth, true, '号角挂着 seeStealth');
  assert.equal(canTargetEnemy(horn, foe, horn.profile), true, '可以选中隐匿的敌人');
  // 溅射不跟着放开：foesInRadius 仍按 targeting.js enemyStealthed 跳过它
  assert.deepEqual(h.battle.foesInRadius(foe.x, foe.y, 1.5), [], '溅射仍然跳过隐匿');
  // 对照：没有这张卡 ⇒ 没有 seeStealth，也选不中
  const ctl = hornField([at(1, 9, 4, 'chess_char_5_08_b')], { withCard: false });
  installModeModulesIsw(hexHooks(ctl.battle));
  start(ctl);
  const ctlHorn = ctl.unit('chess_char_5_08_b');
  const ctlFoe = stealthFoe(ctl);
  assert.ok(!ctlHorn.s.flags.seeStealth, '没有卡 ⇒ 没有 seeStealth');
  assert.equal(canTargetEnemy(ctlHorn, ctlFoe, ctlHorn.profile), false, '没有卡 ⇒ 选不中隐匿的敌人');
});

test('特限恢复 ISW: 号角 — 别人的号角、非 ISW- 模组、模组未启用都不生效', () => {
  // 别人的号角（p2 的；卡在 p1 手上）：p1 的重装不吃光环，p2 的号角也没有 seeStealth / 技力
  const skill = { spType: 'INCREASE_WITH_TIME', spCost: 30, initSp: 0 };
  const chess = {
    chess_char_5_08_b: opRec('chess_char_5_08_b', { name: '号角', profession: 'TANK', skill, stats: { spRecovery: 0 } }),
  };
  const h = field([
    seat('p1', 0, { effects: [refOf()], units: [at(1, 10, 4, 'test_tank')] }),   // 拥有者的重装
    seat('p2', 1, { units: [at(2, 9, 4, 'chess_char_5_08_b')] }),               // 别人的号角
  ], { chess });
  installModeModulesIsw(hexHooks(h.battle));
  start(h);
  const otherHorn = h.battle.allyUnits.find((u) => u.ownerId === 'p2' && u.defId === 'chess_char_5_08_b');
  const ownTank = h.battle.allyUnits.find((u) => u.ownerId === 'p1' && u.defId === 'test_tank');
  assert.ok(otherHorn && ownTank, 'premise: 双方的单位都在场');
  assert.ok(!otherHorn.s.flags.seeStealth, '别人的号角没有 seeStealth');
  assert.equal(otherHorn.skill.sp, 0, '别人的号角不给技力');
  assert.equal(ownTank.s.atk, 500, '别人的号角不给光环');
  // 非 ISW- 模组 / 未启用：号角自己的那 4 条一条都不生效
  for (const [label, module] of [['非 ISW- 模组', OTHER], ['模组未启用', OFF]]) {
    const c = hornField([at(1, 9, 4, 'chess_char_5_08_b'), at(2, 9, 5, 'test_ally')], {
      chess: { chess_char_5_08_b: opRec('chess_char_5_08_b', { name: '号角', profession: 'TANK', module, skill, stats: { spRecovery: 0 } }) },
    });
    installModeModulesIsw(hexHooks(c.battle));
    start(c);
    const horn = c.unit('chess_char_5_08_b');
    const foe = stealthFoe(c);
    assert.ok(!horn.s.flags.seeStealth, `${label} ⇒ 没有 seeStealth`);
    assert.equal(canTargetEnemy(horn, foe, horn.profile), false, `${label} ⇒ 选不中隐匿的敌人`);
    assert.equal(horn.s.rangeExtend, 0, `${label} ⇒ 身前格数不加`);
    assert.equal(horn.skill.sp, 0, `${label} ⇒ 不给技力`);
  }
});

test('特限恢复 ISW: targeting 级 — attacker.s.flags.seeStealth 放开隐匿索敌，普通干员仍然选不中', () => {
  const h = field([seat('p1', 0, { units: [at(1, 9, 4, 'test_ally')] })]);
  start(h);
  const u = h.unit('test_ally');
  const foe = stealthFoe(h);
  assert.equal(canTargetEnemy(u, foe, u.profile), false, '普通干员选不中隐匿的敌人');
  h.battle.addBuff(u, { key: 'test:seeStealth', flags: { seeStealth: true }, duration: Infinity });
  assert.equal(u.s.flags.seeStealth, true, 'buff 的 flags 进了 s.flags');
  assert.equal(canTargetEnemy(u, foe, u.profile), true, '挂着 seeStealth ⇒ 能选中');
  // 只放开索敌：范围查询（溅射 / 格子选择）仍跳过隐匿
  assert.deepEqual(h.battle.foesInRadius(foe.x, foe.y, 1.5), [], 'foesInRadius 仍然跳过隐匿');
  h.battle.removeBuff(u, 'test:seeStealth');
  assert.ok(!u.s.flags.seeStealth, '撤掉 buff ⇒ flag 掉回去');
  assert.equal(canTargetEnemy(u, foe, u.profile), false, '没有 seeStealth ⇒ 又选不中了');
  h.battle.removeBuff(foe, 'stealth');
  assert.equal(h.battle.foesInRadius(foe.x, foe.y, 1.5).length, 1, '解除隐匿 ⇒ 溅射又能命中（证明上面为空是隐匿造成的）');
});

test('特限恢复 ISW: 生产链路 — 真实号角棋子 + 选中 uniequip_004_horn（ISW-A）同样生效', () => {
  // 号角的模组记录由 tools/custom-modules.mjs 注入官方表、build-data 生成（data/chess.json 的 `modules` 里已经有
  // `uniequip_004_horn`，默认模组仍是 uniequip_002_horn FOR-X —— 设计稿 §2 的口径）。这条锁的是**真实数据 + 选中
  // 模组**的形状：`def.raw.module` = `{ id, type: 'ISW-A', level: 1, active: true }`，四条效果里能脱离 kit 断言的那三条。
  const realField = (withCard) => {
    const h = makeBattle({
      content: 'generic',
      units: [
        { chessId: 'chess_char_5_08_b', moduleId: 'uniequip_004_horn', row: 9, col: 4 },   // 号角（真实棋子 + 这张模组）
        { chessId: 'chess_char_4_09_b', row: 9, col: 6 },                                 // 身前第 2 格那一个
      ],
      defs: { enemies: ENEMIES },
      enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [12, 2] }],
      autoFinish: false,
      timeLimit: 20,
      captureNoisy: true,
      hooks: ['hit', 'battleStart', 'deploy'],
    });
    if (withCard) h.battle.getPlayer(h.battle.players[0].playerId).playerEffects.push(refOf());
    const inst = installModeModulesIsw(hexHooks(h.battle));
    h.run(0.1);
    return { h, inst };
  };
  const ctl = realField(false);
  assert.equal(ctl.inst, 0, '对照场没有卡');
  const card = realField(true);
  assert.ok(card.inst && typeof card.inst === 'object', '有卡 ⇒ 返回活句柄');
  const horn = (r) => r.h.battle.allyUnits.find((u) => u.defId === 'chess_char_5_08_b');
  const ctlHorn = horn(ctl);
  const cardHorn = horn(card);
  assert.equal(cardHorn.def.raw.module.type, 'ISW-A', 'premise: 选中模组的类型是 ISW-A');
  assert.equal(cardHorn.def.raw.module.active, true, 'premise: 模组是启用的');
  assert.equal(card.inst.carriers, 1, '只有号角带着 ISW 模组');
  assert.equal(cardHorn.s.flags.seeStealth, true, '真实数据上：可以攻击隐匿敌人');
  assert.ok(!ctlHorn.s.flags.seeStealth, '没有卡 ⇒ 没有 seeStealth');
  assert.equal(cardHorn.s.rangeExtend - ctlHorn.s.rangeExtend, 1, '真实数据上：身前第 2 格那一个 ⇒ +1 攻击距离');
  assert.equal(cardHorn.s.maxTargets - ctlHorn.s.maxTargets, 1, '真实数据上：+1 远程目标数');
  assert.ok(near(cardHorn.s.atk, ctlHorn.s.atk * 1.08), `真实数据上：号角自己也是重装 ⇒ atk ×1.08（${ctlHorn.s.atk} → ${cardHorn.s.atk}）`);
  card.h.invariants();
  ctl.h.invariants();
});

// =====================================================================================================================
// 参数读卡面

test('特限恢复 ISW: 数值读卡面 params.modeModules（缺席的键才用设计稿兜底）', () => {
  const h = field([seat('p1', 0, {
    effects: [refOf({ ...SPEC, mizukiAspd: 30, mizukiRegen: 0.01, duskTargets: 2, archetMax: 1, swireRedeployMul: 0.5 })],
    units: [
      at(1, 9, 4, 'chess_char_4_09_b'),
      at(2, 9, 5, 'chess_char_5_12_b'),
      at(3, 9, 6, 'chess_char_3_21_b'),
      at(4, 9, 7, 'test_atk1'),
      at(5, 9, 8, 'test_atk2'),
      at(6, 9, 9, 'chess_char_3_04_b'),
    ],
  })]);
  installModeModulesIsw(hexHooks(h.battle));
  start(h);
  const mizuki = h.unit('chess_char_4_09_b');
  assert.equal(mizuki.s.aspd, 130, '卡面 mizukiAspd = 30');
  assert.equal(mizuki.s.hpRegen, 0.01 * mizuki.s.maxHp, '卡面 mizukiRegen = 0.01');
  assert.equal(h.unit('chess_char_5_12_b').s.maxTargets, 2, '卡面 duskTargets = 2');
  assert.equal(h.unit('chess_char_3_21_b').s.rangeExtend, 1, '卡面 archetMax = 1（2 名攻击回复被压到 1）');
  assert.equal(h.unit('chess_char_3_04_b').s.redeployMul, 0.5, '卡面 swireRedeployMul = 0.5');
});

// =====================================================================================================================
// 生产链路

test('特限恢复 ISW: 生产链路（真实棋子 + 选中 ISW 模组，模组挂在 def.raw.module 上）同样生效', () => {
  // simdata normalizeChess 只把原始记录留在 def.raw 下：真实 data/chess.json 记录的选中模组在 `def.raw.module`
  // （`def.module` 不存在），模块两个位置都读，这条测试锁住的是真实形状。真实棋子自己的特性 / 技能也会改面板，
  // 所以拿**同一套棋子、没有这张卡**的对照场做差。
  const realField = (withCard) => {
    const h = makeBattle({
      content: 'generic',
      units: [
        { chessId: 'chess_char_4_09_b', moduleId: 'uniequip_004_mizuki', row: 9, col: 4 },   // 水月 ISW-A
        { chessId: 'chess_char_5_12_b', moduleId: 'uniequip_004_dusk', row: 9, col: 5 },     // 夕 ISW-A
      ],
      defs: { enemies: ENEMIES },
      enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [12, 2] }],
      autoFinish: false,
      timeLimit: 20,
      captureNoisy: true,
      hooks: ['hit', 'battleStart', 'deploy'],
    });
    if (withCard) h.battle.getPlayer(h.battle.players[0].playerId).playerEffects.push(refOf());
    const inst = installModeModulesIsw(hexHooks(h.battle));
    h.run(0.1);
    return { h, inst };
  };
  const ctl = realField(false);
  assert.equal(ctl.inst, 0, '对照场没有卡');
  const card = realField(true);
  assert.ok(card.inst && typeof card.inst === 'object', '有卡 ⇒ 返回活句柄');

  const unit = (r, id) => r.h.battle.allyUnits.find((u) => u.defId === id);
  const mizuki = unit(card, 'chess_char_4_09_b');
  assert.equal(mizuki.def.raw.module.type, 'ISW-A', 'premise: 选中模组的类型是 ISW-A');
  assert.equal(mizuki.def.raw.module.active, true, 'premise: 模组是启用的');
  assert.equal(card.inst.carriers, 2, '两名干员都带着 ISW 模组');
  assert.equal(mizuki.s.aspd - unit(ctl, 'chess_char_4_09_b').s.aspd, 50, '真实数据上同样是 +50 攻速');
  assert.equal(unit(card, 'chess_char_5_12_b').s.maxTargets - unit(ctl, 'chess_char_5_12_b').s.maxTargets, 1, '真实数据上同样是 +1 目标');
  card.h.invariants();
  ctl.h.invariants();
});
