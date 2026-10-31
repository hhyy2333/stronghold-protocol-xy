#!/usr/bin/env node
// tools/custom-ops.mjs — 自制/联动干员（fix-up 进官方表的那几个）
//
// 目的：本树的《明日方舟》官方表里**已经有**结城理（char_4217_makoto）与丰川祥子（char_4182_oblvns）
// 这两名联动干员的角色、技能（各 10 级）、天赋与模组数据 —— 他们缺的不是数据，而是「进对局」的那几行：
//   * charChessDataDict / charShopChessDatas —— 商店里那一行（普通 + 精锐两条记录）；
//   * chessNormalIdLookupDict —— 精锐 → 普通；
//   * bondInfoDict.<核心盟约>.chessIdList —— 盟约成员（否则盟约人数永远差他们一个）；
//   * character_table 里的召唤物（结城理的人格面具 俄耳甫斯 / 塔纳托斯，官方表把它们放在角色 prefab 里，
//     没有独立 character 记录，而本引擎的召唤物必须是一条 character 记录）。
//
// 这里声明这些行，由 tools/build-data.mjs 在 buildChess / buildBackups / buildBonds 之前合并进
// （内存里的）官方表。数据本身一个字节不改：属性、技能、天赋、模组全部照官方表的原值走。
//
// 用法（由 tools/build-data.mjs 调用，不单独运行）：
//   import { applyCustomOps, FIXED_CHESS_IDS, FIXED_OP_IDS } from './custom-ops.mjs';
//   applyCustomOps(ctx);   // ctx = loadContext() 的返回值，就地修改
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'gamedata', 'excel');

/**
 * 两个联动干员的商店行（业主 2026-10-25：「把结城理和丰川祥子的完整技能补全」）。
 *
 * 数值全部来自官方 character_table / skill_table / uniequip_table：
 *   结城理 6★ 特种·傀儡师（dollkeeper），攻击 1-1、阻挡 2、部署费用 16（满潜 14），
 *     特性「受到致命伤时不撤退，切换成<替身>作战（替身阻挡数为 0），持续 20 秒后自身再次替换<替身>」，
 *     天赋 1 不羁之力（替身状态下 +攻击力 / 攻击间隔、切换时停顿附近敌人）、天赋 2 S.E.E.S.队长
 *     （替身结束后的总攻击），模组 PUM-Y 彼此的声音（替身生命上限 +20%）。
 *   丰川祥子 6★ 近卫·领主（lord），近战但可远程（远程攻击力 80%）、阻挡 2、部署费用 20（满潜 18），
 *     天赋 1 颂乐音符（持续攻击 + 音符穿透）、天赋 2 毋畏遗忘（造成伤害时 Fever+、范围内攻速+），
 *     模组 LOR-Y 无言的约定（攻击范围内 2 名以上敌人时攻速 +12）。
 *
 * 商店行本身没有「平衡」判断：tier / price / sortId 是业主口径（两人都是 6 阶、4 费），
 * 与同阶官方干员一致（data/chess.json 里 20 + 2 个六阶都是 4 费）。
 */
export const FIXED_CHESS = Object.freeze({
  // 结城理 —— chess_char_6_21_a/_b（identifier 266 / 267，接在官方 265 之后）
  chess_char_6_21_a: Object.freeze({
    charId: 'char_4217_makoto', name: '结城理', tier: 6, price: 4, sellPrice: 1, shopSortId: 21, identifier: 266,
    bondIds: ['lateranoShip'], garrisonIds: [], defaultSkillIndex: 0, defaultUniEquipId: 'uniequip_002_makoto',
  }),
  chess_char_6_21_b: Object.freeze({ charId: 'char_4217_makoto', eliteOf: 'chess_char_6_21_a', identifier: 267 }),
  // 丰川祥子 —— chess_char_6_22_a/_b（identifier 268 / 269）
  chess_char_6_22_a: Object.freeze({
    charId: 'char_4182_oblvns', name: '丰川祥子', tier: 6, price: 4, sellPrice: 1, shopSortId: 22, identifier: 268,
    bondIds: ['miraShip'], garrisonIds: [], defaultSkillIndex: 0, defaultUniEquipId: 'uniequip_002_oblvns',
  }),
  chess_char_6_22_b: Object.freeze({ charId: 'char_4182_oblvns', eliteOf: 'chess_char_6_22_a', identifier: 269 }),
});

export const FIXED_CHESS_IDS = Object.freeze(Object.keys(FIXED_CHESS).sort());
export const FIXED_OP_IDS = Object.freeze([...new Set(Object.values(FIXED_CHESS).map((c) => c.charId))].sort());
/** 他们的「休整期特质」行：本树不提供（两人都没有官方特质），build-data 会按空数组处理。 */
export const FIXED_GARRISON_IDS = Object.freeze([]);

/**
 * 官方表里没有独立记录、但本引擎必须有的召唤物：结城理的人格面具。
 *
 * 为什么必须补：官方把「替身状态下召唤俄耳甫斯 / 塔纳托斯」写在技能描述里，角色 prefab 直接引用一个
 * 召唤物 prefab；而本引擎的 spawnToken 只认 character_table 的记录（data/tokens.json 由它生成）。
 * 没有这两条，结城理的 S1/S2/S3 只能做成「自己打」，人格式神就完全不存在。
 *
 * 数值口径：基础值取自《明日方舟》同名召唤物（攻击 677 / 生命 1000 / 攻击间隔 1.1 s / 占 9 格近战位、
 * 可对空、法术伤害），与 gamepress / PRTS 的「人格面具」条目一致。天赋 damage_scale 1.5（俄耳甫斯）
 * 由 kit 实现，不写进这条记录。
 */
export const CUSTOM_TOKENS = Object.freeze({
  token_makoto_orpheus: Object.freeze({
    name: '俄耳甫斯', appellation: 'Orpheus', owner: 'char_4217_makoto', maxHp: 1000, atk: 677, def: 0, res: 0,
    bat: 1.1, blockCnt: 0, rangeGrid: 'melee9', dmgType: 'arts', canHitFly: true,
  }),
  token_makoto_thanatos: Object.freeze({
    name: '塔纳托斯', appellation: 'Thanatos', owner: 'char_4217_makoto', maxHp: 1000, atk: 677, def: 0, res: 0,
    bat: 1.1, blockCnt: 0, rangeGrid: 'melee9', dmgType: 'arts', canHitFly: true,
  }),
});
export const CUSTOM_TOKEN_IDS = Object.freeze(Object.keys(CUSTOM_TOKENS).sort());

/** 九格近战范围（row, col，朝右）。 */
const MELEE9 = Object.freeze([[1, -1], [1, 0], [1, 1], [0, -1], [0, 0], [0, 1], [-1, -1], [-1, 0], [-1, 1]]);

const load = (f) => (existsSync(join(CACHE, f + '.json')) ? JSON.parse(readFileSync(join(CACHE, f + '.json'), 'utf8')) : null);

/** 一个合成召唤物的 character_table 记录（照 token_10022_kazema_shadow 的形状，字段全给）。 */
function tokenChar(spec) {
  const level = (hp, atk) => ({
    level: 1, data: {
      maxHp: hp, atk, def: spec.def, magicResistance: spec.res, cost: 0, blockCnt: spec.blockCnt, moveSpeed: 1,
      attackSpeed: 100, baseAttackTime: spec.bat, respawnTime: 70, hpRecoveryPerSec: 0, spRecoveryPerSec: 1,
      maxDeployCount: 1, maxDeckStackCnt: 0, tauntLevel: 0, massLevel: 0, baseForceLevel: 0,
      stunImmune: false, silenceImmune: false, sleepImmune: false, frozenImmune: false, levitateImmune: false,
      disarmedCombatImmune: false, fearedImmune: false, palsyImmune: false, attractImmune: false, teleportImmune: false,
      groundBoundImmune: false,
    },
  });
  return {
    name: spec.name, description: null, sortIndex: 0, spTargetType: 'NONE', spTargetId: null,
    canUseGeneralPotentialItem: false, canUseActivityPotentialItem: false, potentialItemId: null,
    activityPotentialItemId: null, classicPotentialItemId: null, nationId: null, groupId: null, teamId: null,
    // position ALL + 特性写「法术伤害」：classifyToken 会把这种「近战位但能打远处」的召唤物判成
    // arts / ranged / canHitFly（人格面具在游戏里就是能对空的法术攻击）
    mainPower: null, subPower: null, displayNumber: null, appellation: spec.appellation, position: 'ALL',
    tagList: null, itemUsage: null, itemDesc: null, itemObtainApproach: null, isNotObtainable: false, isSpChar: false,
    maxPotentialLevel: 0, rarity: 'TIER_6', profession: 'TOKEN', subProfessionId: 'notchar1',
    trait: { candidates: [{ unlockCondition: { phase: 'PHASE_0', level: 1 }, requiredPotentialRank: 0, blackboard: [], overrideDescripton: '不阻挡敌人，攻击造成法术伤害', prefabKey: null, rangeId: null }] },
    phases: [
      { characterPrefabKey: null, rangeId: 'x-4', maxLevel: 50, attributesKeyFrames: [level(spec.maxHp, spec.atk), level(spec.maxHp, spec.atk)] },
      { characterPrefabKey: null, rangeId: 'x-4', maxLevel: 80, attributesKeyFrames: [level(spec.maxHp, spec.atk), level(spec.maxHp, spec.atk)] },
      { characterPrefabKey: null, rangeId: 'x-4', maxLevel: 90, attributesKeyFrames: [level(spec.maxHp, spec.atk), level(spec.maxHp, spec.atk)] },
    ],
    skills: [null, null],
    displayTokenDict: null,
    talents: [],
    potentialRanks: [],
    favorKeyFrames: [],
    allSkillLvlup: [],
  };
}

/**
 * 把 FIXED_CHESS / CUSTOM_TOKENS 合并进 build-data 的 ctx（就地）。幂等：第二次调用返回空数组。
 * @param {{ act: any, charTable: any }} ctx
 * @returns {string[]} 这次真正加进去的 id
 */
export function applyCustomOps(ctx) {
  const added = [];
  const act = ctx && ctx.act;
  const chars = ctx && ctx.charTable;
  if (!act || !chars) throw new Error('applyCustomOps: needs { act, charTable }');
  act.charChessDataDict = act.charChessDataDict || {};
  act.charShopChessDatas = act.charShopChessDatas || {};
  act.chessNormalIdLookupDict = act.chessNormalIdLookupDict || {};
  act.bondInfoDict = act.bondInfoDict || {};
  act.shopStateTokenDict = act.shopStateTokenDict || {};
  // 先普通后精锐：普通那条是「商店行」的本体（buildChess 用 baseId = chessNormalIdLookupDict[chessId]
  // 去 charShopChessDatas 找它，精锐的 baseId 指回普通）。
  for (const [chessId, spec] of Object.entries(FIXED_CHESS)) {
    if (spec.eliteOf) continue;   // elite rows are handled below, once their normal exists
    if (act.charChessDataDict[chessId]) continue;
    const eliteId = chessId.replace(/_a$/, '_b');
    const eliteSpec = FIXED_CHESS[eliteId];
    act.charChessDataDict[chessId] = {
      chessId, identifier: spec.identifier, isGolden: false,
      status: { evolvePhase: 'PHASE_2', charLevel: 1, skillLevel: 4, favorPoint: 0, equipLevel: 0 },
      upgradeChessId: eliteSpec ? eliteId : null, upgradeNum: eliteSpec ? 3 : 0,
      bondIds: [...spec.bondIds], garrisonIds: [...spec.garrisonIds],
    };
    act.charShopChessDatas[chessId] = {
      chessId, goldenChessId: eliteSpec ? eliteId : null, chessLevel: spec.tier, shopLevelSortId: spec.shopSortId,
      chessType: 'PRESET', charId: spec.charId, tmplId: null,
      defaultSkillIndex: spec.defaultSkillIndex, defaultUniEquipId: spec.defaultUniEquipId,
      backupCharId: spec.charId, backupTmplId: null, backupCharSkillIndex: spec.defaultSkillIndex,
      backupCharUniEquipId: spec.defaultUniEquipId, backupCharPotRank: 0, isHidden: false,
    };
    act.chessNormalIdLookupDict[chessId] = chessId;
    added.push(chessId);
  }
  for (const [chessId, spec] of Object.entries(FIXED_CHESS)) {
    if (!spec.eliteOf) continue;
    if (act.charChessDataDict[chessId]) continue;
    const normal = FIXED_CHESS[spec.eliteOf];
    act.charChessDataDict[chessId] = {
      chessId, identifier: spec.identifier, isGolden: true,
      status: { evolvePhase: 'PHASE_2', charLevel: 60, skillLevel: 7, favorPoint: 0, equipLevel: 3 },
      upgradeChessId: null, upgradeNum: 0,
      bondIds: [...normal.bondIds], garrisonIds: [...normal.garrisonIds],
    };
    act.chessNormalIdLookupDict[chessId] = spec.eliteOf;
    added.push(chessId);
  }
  // 核心盟约成员：官方成员的名单里普通与精锐两条都列（_b 也在），这里照做
  for (const [normalId, spec] of Object.entries(FIXED_CHESS)) {
    if (spec.eliteOf) continue;
    const eliteId = normalId.replace(/_a$/, '_b');
    for (const bondId of spec.bondIds) {
      const bond = act.bondInfoDict[bondId];
      if (!bond) continue;
      bond.chessIdList = bond.chessIdList || [];
      for (const id of [normalId, eliteId]) {
        if (FIXED_CHESS[id] && !bond.chessIdList.includes(id)) bond.chessIdList.push(id);
      }
    }
  }
  // 召唤物的展示类型（HIDDEN：不手牌化，由技能直接生成）。表在 autoChessData（ctx.ac），不是赛季表。
  const tokenDicts = [act.shopStateTokenDict, ctx.ac && ctx.ac.shopStateTokenDict].filter(Boolean);
  for (const dict of tokenDicts) {
    for (const tokenId of Object.keys(CUSTOM_TOKENS)) {
      if (!dict[tokenId]) dict[tokenId] = { tokenId, tokenDisplayType: 'HIDDEN' };
    }
  }
  // 召唤物 character 记录
  for (const [tokenId, spec] of Object.entries(CUSTOM_TOKENS)) {
    if (chars[tokenId]) continue;
    chars[tokenId] = tokenChar(spec);
    added.push(tokenId);
    const owner = chars[spec.owner];
    if (owner) {
      owner.displayTokenDict = owner.displayTokenDict || {};
      owner.displayTokenDict[tokenId] = tokenId;
    }
  }
  return added;
}

/** 官方表里该角色是否真有 10 级技能数据（给测试/工具判断是否可用）。 */
export function hasOfficialRows(id) {
  const chars = load('character_table');
  const skills = load('skill_table');
  return !!(chars && chars[id] && (chars[id].skills || []).every((s) => !s || !s.skillId || (skills && skills[s.skillId])));
}
