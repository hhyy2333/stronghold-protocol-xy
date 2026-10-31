// test/sim/hex-mode-modules-ra.test.js — 第二十三批（业主 2026-10-31）：协议源石【特限恢复】hex_mode_modules 的
// **RA（生息演算）** 特限模组战斗半边（server/sim/content/hexcards/stone_mode_modules_ra.js installModeModulesRa）。
//
// 驱动方式与 hex-stone-kjerag-laterano.test.js / hexcards-armor.test.js 一致：真实 sim Battle
// （test/helpers/battleHarness.js 的 makeBattle / chessRec / enemyRec）+ 生产用的 `hexHooks(battle)` 手工安装，
// effect ref 按 server/match/hextech.js `addHexRef` 的形状手搓（含 `params.modeModules`），所以本套件不依赖
// content/hextech.js 的接线是否已经落地。`content: 'generic'` 让 installContent 不跑 content/hextech.js 的
// `install()`、也不装盟约内容与干员 kit，于是这些数字只可能来自被测模块。
//
// 模组的形状是 data/chess.json 记录里的 `module`（shared/loadoutRecord.js：选中模组时
// `{ id, name, type: typeName, level, active: true }`，选「不装备」时 `{ id: null, type: null, active: false }`），
// 所以测试给 chessRec 的记录补一个 `module` 字段即可。
//
// 覆盖（设计稿 §4.3 的 RA 三行 + 通用口径，一条一个 test）：
//   无卡无效果；百炼嘉维尔首次开技能后 生命上限 / 攻击力 / 防御力 ×1.5（本场一次，不叠）；
//   异客让拥有者的干员免疫自然环境伤害（'terrain' 标签；普通伤害与深水【水蚀】照常；异客不在场时光环关闭）、
//   自身攻击力 +60% 与每秒技力 +1；佩佩再部署时间 -50%；非 RA 模组一条都不生效；别人的干员不生效；
//   生产链路（真实棋子 + 选中 RA 模组，模组在 `def.raw.module` 上）同样生效。
//
// [ASSUMED]（模块头注释里有完整口径，这里是测试侧的断言口径）：
//   1. 「提升至 150%」是乘算 hpMul / atkMul / defMul = 1.5，且**每名干员本场一次**（再开技能不会叠成 2.25 倍）。
//   2. 自然环境伤害的判据是 DamageInfo `tags` 含 `'terrain'`（devices.js 活性源石的 tick 是唯一打这个标签的来源；
//      深水区的【水蚀】是 `dot / periodic / deepsea`，devices.js 明确注释「不属于环境伤害」）。「-100%」= 完全免疫
//      （`hit` 阶段 `dmg.cancel`，一点血都不掉）。
//   3. 异客的光环要求它自己**在场**（活着 / 已部署 / 未隐匿）。
//   4. 佩佩「若携带资源」在卫戍协议里没有对应概念 ⇒ 恒定为再部署时间 -50%（`redeployMul 0.5`）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { hexHooks } from '../../server/sim/content/hexcards/hooks.js';
import { installModeModulesRa } from '../../server/sim/content/hexcards/stone_mode_modules_ra.js';
import { makeDamageInfo } from '../../server/sim/damage.js';

const CARD = 'hex_mode_modules';
/** 卡面 effect（tools/hextech/roster.mjs / data/hextech.json）：只有 level 与 types，逐干员的数字是模块兜底。 */
const SPEC = Object.freeze({ level: 3, types: ['ISW', 'SO', 'RA'] });

/** 模块里的 buff 键（与 stone_mode_modules_ra.js 一致）。 */
const KEY_JIAWEIL = 'hex:modemodules:ra:jiaweil';
const KEY_YIKE = 'hex:modemodules:ra:yike';
const KEY_PEPE = 'hex:modemodules:ra:pepe';

/** 一枚启用中的 RA- 特限模组（`over` 可以改 type / active 造非 RA 或未启用的情形）。 */
const RA = (over = {}) => ({ id: 'uniequip_test_ra', name: 'RA 模组', type: 'RA-A', level: 1, active: true, ...over });
/** 一枚别的模组（集成战略 / 常规模组）。 */
const other = (type) => ({ id: `uniequip_test_${type}`, name: '别的模组', type, level: 1, active: true });

/** 一个不自己开的技能（spCost 高、duration 0 ⇒ instant；测试自己调 activate，避免战斗里自动开技能干扰断言）。 */
const IDLE_SKILL = Object.freeze({ durationType: 'NONE', duration: 0, spCost: 100, initSp: 0, maxChargeTime: 1 });

/**
 * 一套测试记录：设计稿 §4.3 的三个 RA 干员 + 一个普通干员。
 * `mods` 可以逐个别覆盖（`{ jiaweil: other('CEN-X') }`），传 null 表示这名干员不带模组。
 */
function roster(mods = {}) {
  const pick = (k) => (Object.prototype.hasOwnProperty.call(mods, k) ? mods[k] : RA());
  const rec = (id, module, o) => {
    const r = chessRec({ id, ...o });
    if (module) r.module = module;
    return r;
  };
  return {
    // 百炼嘉维尔：0 法抗、100 防御，方便断言 1.5 倍的乘算
    chess_char_4_23_b: rec('chess_char_4_23_b', pick('jiaweil'), { stats: { maxHp: 2000, atk: 500, def: 100, blockCnt: 1 }, skill: IDLE_SKILL }),
    // 异客：基础技力回复 1/秒
    chess_char_6_05_b: rec('chess_char_6_05_b', pick('yike'), { profession: 'CASTER', stats: { maxHp: 1500, atk: 500, def: 0, blockCnt: 1, spRecovery: 1 }, skill: null }),
    // 佩佩：再部署时间 20 秒
    chess_char_6_06_b: rec('chess_char_6_06_b', pick('pepe'), { stats: { maxHp: 3000, atk: 600, def: 300, blockCnt: 1, respawnTime: 20 }, skill: null }),
    // 不属于任何一组、也不带模组的普通干员
    test_plain: rec('test_plain', null, { stats: { maxHp: 1000, atk: 100, def: 0, blockCnt: 1 }, skill: null }),
  };
}

/** 一个血厚、不动、不还手的敌人：整场安静，数字只来自测试自己打的那几发。 */
const dummy = () => enemyRec({ key: 'enemy_dummy', hp: 1000000, atk: 0, def: 0, speed: 0 });

/** 【特限恢复】的 effect ref（server/match/hextech.js addHexRef 的形状，含 params.modeModules）。 */
function cardRef(effect = SPEC) {
  return {
    id: `hex:${CARD}`, key: `hex:${CARD}`,
    name: '特限恢复', desc: '', iconKind: 'hex', iconId: CARD, counter: null, battle: true,
    params: { modeModules: { ...effect }, hexId: CARD },
    data: { hexId: CARD },
  };
}

/** 一个席位（多玩家场：seat 1 落在 +8 列外）。 */
const seat = (playerId, i, { effects = [], units = [] } = {}) => ({ playerId, seat: i, side: 'L', colOffset: i === 0 ? 0 : 8, bonds: {}, playerEffects: effects, units });
/** 棋盘上的一枚棋子。 */
const at = (uid, row, col, chessId) => ({ uid, kind: 'chess', chessId, row, col });

/** 一个安静的测试场。 */
function field(players, { kind = 'normal', defs = null, hooks = ['hit', 'skillStart', 'battleStart', 'deploy'] } = {}) {
  return makeBattle({
    kind,
    content: 'generic',
    defs: { chess: defs ?? roster(), enemies: { enemy_dummy: dummy() } },
    players,
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }],
    autoFinish: false,
    timeLimit: 30,
    captureNoisy: true,
    hooks,
  });
}

/** 按棋子 id 找一名干员。 */
const op = (h, chessId) => h.battle.allyUnits.find((u) => u && u.kind === 'op' && u.defId === chessId);

/** 一次「自然环境伤害」（devices.js infectionDamage 的同一形状：无来源真伤 + 'terrain' 标签）。 */
const terrainHit = (h, target, amount = 70) => h.battle.dealDamage(null, target, { amount, type: 'true', canDodge: false, tags: ['terrain'] });

// =====================================================================================================================
// 没有卡

test('特限恢复 RA: 没有这张卡时 install 返回 0，三个干员的效果一条都不出现', () => {
  const h = field([seat('p1', 0, {
    units: [at(1, 9, 4, 'chess_char_4_23_b'), at(2, 10, 4, 'chess_char_6_05_b'), at(3, 11, 4, 'chess_char_6_06_b'), at(4, 9, 6, 'test_plain')],
  })]);
  const inst = installModeModulesRa(hexHooks(h.battle));
  assert.equal(inst, 0, '没有卡 ⇒ install 返回 0');
  h.run(1);

  const jw = op(h, 'chess_char_4_23_b');
  const yk = op(h, 'chess_char_6_05_b');
  const pp = op(h, 'chess_char_6_06_b');
  const plain = op(h, 'test_plain');
  assert.ok(jw && yk && pp && plain, 'premise: 四名干员都在场上');

  assert.equal(jw.s.atk, 500, 'premise: 嘉维尔的基础攻击力');
  jw.skill.activate('test', { free: true });
  assert.equal(jw.s.atk, 500, '没有卡：开技能不会 1.5 倍');
  assert.equal(jw.s.maxHp, 2000);

  assert.equal(yk.s.atk, 500, '没有卡：异客攻击力不加 60%');
  assert.equal(yk.s.spRecovery, 1, '没有卡：技力回复不加 1');
  assert.equal(pp.s.redeployMul, 1, '没有卡：再部署时间不变');

  assert.equal(terrainHit(h, plain, 70), 70, '没有卡：环境伤害照常结算');
  h.invariants();
});

// =====================================================================================================================
// 百炼嘉维尔 · 首次开启技能后 150%

test('特限恢复 RA: 百炼嘉维尔首次开启技能后 生命上限/攻击力/防御力 ×1.5（本场一次，再开技能不叠）', () => {
  const h = field([seat('p1', 0, { effects: [cardRef()], units: [at(1, 9, 4, 'chess_char_4_23_b')] })]);
  const inst = installModeModulesRa(hexHooks(h.battle));
  assert.ok(inst && typeof inst === 'object', '有卡 ⇒ 返回活句柄');
  h.run(1);

  const jw = op(h, 'chess_char_4_23_b');
  assert.equal(jw.s.maxHp, 2000, 'premise: 技能开启前是基础生命上限');
  assert.equal(jw.s.atk, 500, 'premise: 技能开启前是基础攻击力');
  assert.equal(jw.s.def, 100, 'premise: 技能开启前是基础防御力');
  assert.equal(inst.boosted, 0, '还没开过技能');
  assert.equal(jw.findBuff(KEY_JIAWEIL), null, '还没有那 1.5 倍的 buff');

  jw.skill.activate('test', { free: true });
  assert.equal(jw.s.maxHp, 3000, '生命上限 ×1.5 = 3000');
  assert.equal(jw.s.atk, 750, '攻击力 ×1.5 = 750');
  assert.equal(jw.s.def, 150, '防御力 ×1.5 = 150');
  assert.ok(jw.findBuff(KEY_JIAWEIL), '挂上了常驻 buff');
  assert.equal(inst.boosted, 1, '触发一次');

  jw.skill.activate('test', { free: true });
  assert.equal(jw.s.atk, 750, '本场一次：第二次开技能不会叠成 2.25 倍');
  assert.equal(jw.s.maxHp, 3000);
  assert.equal(inst.boosted, 1, '只记一次');
  h.invariants();
});

test('特限恢复 RA: 百炼嘉维尔的 1.5 倍只在启用的 RA- 模组下给（CEN-X / active:false 都不生效）', () => {
  for (const [label, module] of [['非 RA 模组（CEN-X）', other('CEN-X')], ['RA- 但未启用', RA({ active: false })]]) {
    const h = field([seat('p1', 0, { effects: [cardRef()], units: [at(1, 9, 4, 'chess_char_4_23_b')] })], { defs: roster({ jiaweil: module }) });
    const inst = installModeModulesRa(hexHooks(h.battle));
    h.run(1);
    const jw = op(h, 'chess_char_4_23_b');
    jw.skill.activate('test', { free: true });
    assert.equal(jw.s.atk, 500, `${label}: 攻击力不变`);
    assert.equal(jw.s.maxHp, 2000, `${label}: 生命上限不变`);
    assert.equal(inst.boosted, 0, `${label}: 一次都没触发`);
    assert.equal(inst.carriers, 0, `${label}: 没有 RA- 模组的携带者`);
    h.invariants();
  }
});

// =====================================================================================================================
// 异客 · 自然环境伤害 -100%

test('特限恢复 RA: 异客让拥有者的干员免疫自然环境伤害（普通伤害与深水【水蚀】照常）', () => {
  const h = field([seat('p1', 0, {
    effects: [cardRef()],
    units: [at(1, 10, 4, 'chess_char_6_05_b'), at(2, 9, 6, 'test_plain')],
  })]);
  const inst = installModeModulesRa(hexHooks(h.battle));
  h.run(1);
  const yk = op(h, 'chess_char_6_05_b');
  const plain = op(h, 'test_plain');

  assert.equal(terrainHit(h, yk, 70), 0, '异客自己：环境伤害被完全免疫');
  assert.equal(yk.hp, yk.s.maxHp, '一点血都没掉');
  assert.equal(terrainHit(h, plain, 70), 0, '友方干员：同样免疫');
  assert.equal(inst.immunized, 2, '两次环境伤害被吃掉');

  // 不是环境伤害的实例照常结算
  assert.equal(h.battle.dealDamage(null, plain, makeDamageInfo({ amount: 100, type: 'true', canDodge: false })), 100, '普通真伤照常');
  // 深水区的【水蚀】是 dot / periodic / deepsea，devices.js 明确「不属于环境伤害」
  assert.equal(
    h.battle.dealDamage(null, plain, { amount: 40, type: 'true', canDodge: false, sourceless: true, noSp: true, tags: ['dot', 'periodic', 'deepsea'] }),
    40,
    '深水【水蚀】不是环境伤害，不免疫',
  );
  assert.equal(inst.immunized, 2, '只数环境伤害');

  // 光环的来源必须在场：异客被击倒后，环境伤害照常打进来
  h.battle.kill(yk);
  assert.equal(terrainHit(h, plain, 70), 70, '异客不在场：光环关闭');
  h.invariants();
});

test('特限恢复 RA: 异客自身 攻击力 +60%、每秒技力 +1', () => {
  const h = field([seat('p1', 0, { effects: [cardRef()], units: [at(1, 10, 4, 'chess_char_6_05_b')] })]);
  installModeModulesRa(hexHooks(h.battle));
  h.run(1);
  const yk = op(h, 'chess_char_6_05_b');
  assert.equal(yk.s.atk, 800, '500 × (1 + 60%) = 800（加算百分比）');
  assert.equal(yk.s.spRecovery, 2, '基础 1/秒 + 1/秒 = 2/秒');
  assert.ok(yk.findBuff(KEY_YIKE), '挂上了常驻 buff');
  h.invariants();
});

// =====================================================================================================================
// 佩佩 · 再部署时间 -50% [ASSUMED]

test('特限恢复 RA: 佩佩 再部署时间 -50% [ASSUMED]（redeployMul 0.5，实际复活计时减半）', () => {
  const h = field([seat('p1', 0, { effects: [cardRef()], units: [at(1, 9, 4, 'chess_char_6_06_b')] })]);
  installModeModulesRa(hexHooks(h.battle));
  h.run(1);
  const pp = op(h, 'chess_char_6_06_b');
  assert.equal(pp.base.respawnTime, 20, 'premise: 基础再部署时间 20 秒');
  assert.equal(pp.s.redeployMul, 0.5, '再部署时间 ×0.5');
  assert.ok(pp.findBuff(KEY_PEPE), '挂上了常驻 buff');

  const t = h.battle.time;
  h.battle.kill(pp);
  assert.ok(Math.abs(pp.respawnAt - t - 10) < 1e-9, `复活计时 20 × 0.5 = 10 秒（实际 ${pp.respawnAt - t}）`);
  h.invariants();
});

test('特限恢复 RA: 生产链路（真实棋子 + 选中 RA 模组，模组挂在 def.raw.module 上）同样生效', () => {
  // simdata normalizeChess 只把原始记录留在 def.raw 下：真实 data/chess.json 记录的选中模组在 `def.raw.module`
  // （`def.module` 不存在），模块两个位置都读，这条测试锁住的是真实形状。
  // 真实技能自己也会改面板（S3 攻击力 +100% 之类），所以拿**同一场里没有这张卡**的对照场按比例比。
  const realField = (withCard) => {
    const h = makeBattle({
      content: 'generic',
      units: [{ chessId: 'chess_char_4_23_b', moduleId: 'uniequip_004_gvial2', row: 9, col: 4 }],
      defs: { enemies: { enemy_dummy: dummy() } },
      enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }],
      autoFinish: false,
      timeLimit: 20,
      captureNoisy: true,
      hooks: ['hit', 'skillStart', 'battleStart', 'deploy'],
    });
    if (withCard) {
      // 卡挂到 p1（单玩家场的 playerId）
      const pid = h.battle.players[0].playerId;
      h.battle.getPlayer(pid).playerEffects.push(cardRef());
    }
    const inst = installModeModulesRa(hexHooks(h.battle));
    h.run(1);
    const jw = op(h, 'chess_char_4_23_b');
    return { h, inst, jw };
  };

  const ctl = realField(false);
  assert.equal(ctl.inst, 0, '对照场没有卡');
  const card = realField(true);
  assert.ok(card.inst && typeof card.inst === 'object', '有卡 ⇒ 返回活句柄');

  assert.equal(card.jw.def.raw.module.type, 'RA-A', 'premise: 选中模组的类型是 RA-A');
  assert.equal(card.jw.def.raw.module.active, true, 'premise: 模组是启用的');
  assert.equal(card.inst.boosted, 0, 'premise: 这一秒里没有自动开过技能');

  ctl.jw.skill.activate('test', { free: true });
  card.jw.skill.activate('test', { free: true });
  for (const [k, label] of [['atk', '攻击力'], ['maxHp', '生命上限'], ['def', '防御力']]) {
    const ratio = card.jw.s[k] / ctl.jw.s[k];
    assert.ok(Math.abs(ratio - 1.5) < 1e-9, `${label} ×1.5（对照 ${ctl.jw.s[k]} → 有卡 ${card.jw.s[k]}，比 ${ratio}）`);
  }
  assert.equal(card.inst.boosted, 1);
  card.h.invariants();
  ctl.h.invariants();
});

// =====================================================================================================================
// 非 RA 模组 / 别人的干员

test('特限恢复 RA: 三个干员都带非 RA 模组（ISW- / HAM-X）时一条效果都不给', () => {
  const h = field([seat('p1', 0, {
    effects: [cardRef()],
    units: [at(1, 9, 4, 'chess_char_4_23_b'), at(2, 10, 4, 'chess_char_6_05_b'), at(3, 11, 4, 'chess_char_6_06_b'), at(4, 9, 6, 'test_plain')],
  })], { defs: roster({ jiaweil: other('ISW-A'), yike: other('ISW-A'), pepe: other('HAM-X') }) });
  const inst = installModeModulesRa(hexHooks(h.battle));
  h.run(1);
  const jw = op(h, 'chess_char_4_23_b');
  const yk = op(h, 'chess_char_6_05_b');
  const pp = op(h, 'chess_char_6_06_b');
  const plain = op(h, 'test_plain');

  jw.skill.activate('test', { free: true });
  assert.equal(jw.s.atk, 500, '嘉维尔：非 RA 模组不 1.5 倍');
  assert.equal(yk.s.atk, 500, '异客：非 RA 模组不加攻击力');
  assert.equal(yk.s.spRecovery, 1, '异客：非 RA 模组不加技力回复');
  assert.equal(pp.s.redeployMul, 1, '佩佩：非 RA 模组不减再部署时间');
  assert.equal(terrainHit(h, plain, 70), 70, '异客：非 RA 模组没有环境伤害免疫');
  assert.equal(inst.carriers, 0, '场上没有 RA- 模组的携带者');
  assert.equal(inst.boosted, 0);
  assert.equal(inst.immunized, 0);
  h.invariants();
});

test('特限恢复 RA: 别人的干员不生效（只认拥有者自己的干员）', () => {
  const h = field([
    seat('p1', 0, { effects: [cardRef()], units: [at(1, 9, 4, 'chess_char_4_23_b')] }),
    seat('p2', 1, {
      units: [at(2, 9, 4, 'chess_char_4_23_b'), at(3, 10, 4, 'chess_char_6_05_b'), at(4, 11, 4, 'chess_char_6_06_b'), at(5, 9, 6, 'test_plain')],
    }),
  ], { kind: 'unite' });
  const inst = installModeModulesRa(hexHooks(h.battle));
  h.run(1);

  const mine = h.battle.allyUnits.find((u) => u && u.kind === 'op' && u.ownerId === 'p1' && u.defId === 'chess_char_4_23_b');
  const theirJw = h.battle.allyUnits.find((u) => u && u.kind === 'op' && u.ownerId === 'p2' && u.defId === 'chess_char_4_23_b');
  const theirYk = h.battle.allyUnits.find((u) => u && u.kind === 'op' && u.ownerId === 'p2' && u.defId === 'chess_char_6_05_b');
  const theirPp = h.battle.allyUnits.find((u) => u && u.kind === 'op' && u.ownerId === 'p2' && u.defId === 'chess_char_6_06_b');
  const theirPlain = h.battle.allyUnits.find((u) => u && u.kind === 'op' && u.ownerId === 'p2' && u.defId === 'test_plain');
  assert.ok(mine && theirJw && theirYk && theirPp && theirPlain, 'premise: 双方各有一名对应干员');

  // 自己的干员照常生效
  mine.skill.activate('test', { free: true });
  assert.equal(mine.s.atk, 750, '自己的嘉维尔：1.5 倍');

  // 别人的干员一条都不吃
  theirJw.skill.activate('test', { free: true });
  assert.equal(theirJw.s.atk, 500, '别人的嘉维尔：不 1.5 倍');
  assert.equal(theirYk.s.atk, 500, '别人的异客：不加攻击力');
  assert.equal(theirYk.s.spRecovery, 1, '别人的异客：不加技力回复');
  assert.equal(theirPp.s.redeployMul, 1, '别人的佩佩：不减再部署时间');
  assert.equal(terrainHit(h, theirPlain, 70), 70, '别人的干员：不免疫环境伤害');
  assert.equal(inst.carriers, 1, '只有拥有者自己的那一枚 RA- 携带者算数');
  assert.equal(inst.immunized, 0);
  h.invariants();
});
