#!/usr/bin/env node
// tools/custom-modules.mjs — 官方表里还没有的模组（合成记录 fix-up 进官方表的那几张）
//
// 目的：业主 2026-10-31 的「号角特限证章」（04-文档/协议源石-号角特限模组-设计稿-20261031.md §2）。
// 官方 gamedata（PRTS / BWIKI 也一样）里号角只有 001 / 002（FOR-X “典范之人”）/ 003（FOR-Y 旧日新装），
// 没有这张 ISW-A 特限模组。所以照 tools/custom-ops.mjs 的先例：在内存里合成一份**官方形状**的记录，注入
// uniequip_table / battle_equip_table，再由 tools/build-data.mjs 正常生成 —— 不改生成逻辑，不改任何其它 data 文件。
//
// 三处注入（build-data 只读这三处）：
//   * uniequip_table.equipDict[id]            —— 模组本体（名称 / 类型 / 解锁条件 / 材料），buildChess 的 rec.module 与
//                                                 rec.modules[].name / typeName / typeIcon 读它；
//   * uniequip_table.charEquip[charId]        —— 归属，buildChess 遍历它生成可选模组列表（精锐），追加在 001/002/003 之后；
//   * battle_equip_table[id].phases[]         —— 三个等级的 attributeBlackboard（面板）+ parts（特性 / 天赋），
//                                                buildChess / buildBackups 从它算 attr、traitOverride、talentChanges。
//
// 口径（业主 2026-10-31）：
//   * 1 级只给面板与特性追加行，**不动**天赋【军事要塞】（图上 01 STAGE 只有「基础数值提升」）；
//   * 2 / 3 级在天赋后面追加「在集成战略中…」那半（2 级光环 + 身前格数，3 级再加部署技力）；
//   * 默认模组不变：精锐默认仍是 uniequip_002_horn（FOR-X），这张是第 4 个可选模组；
//   * 「可以部署在目标点」只进文本（本作的目标点是保护目标点，不落地 —— 设计稿 §0 / §3.5）。
//
// 数值全部 [ASSUMED]（官方预览图只给「生命 / 攻击 / + / ++」没有数字，业主授权按同阶 ISW-A 量级自拟）：
//   1 级 max_hp+150 / atk+55、2 级 +190 / +70、3 级 +230 / +85（设计稿 §2.1）。
//
// 用法（由 tools/build-data.mjs 调用，不单独运行）：
//   import { applyCustomModules } from './custom-modules.mjs';
//   applyCustomModules(ctx);   // ctx = loadContext() 的返回值，就地修改
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'gamedata', 'excel');

/** 号角的角色 id（本作 5 阶重装·要塞，棋子 chess_char_5_08_a / _b）。 */
export const HORN_CHAR_ID = 'char_4039_horn';

/** 这张模组的 id：接在官方 001 / 002 / 003 之后。 */
export const HORN_ISW_A_ID = 'uniequip_004_horn';

/** 特性追加行（三级同一条，设计稿 §2.2）：官方形状里的 <@ba.kw> 富文本照写，data 里生成 desc / descRaw 两份。 */
export const HORN_TRAIT_ADDED = '在<@ba.kw>集成战略</>中，可以部署在目标点且可以攻击隐匿敌人';

/**
 * 天赋【军事要塞】2 / 3 级的文本（设计稿 §2.3）。1 级不写（天赋不变）。
 * 2 级：军事要塞原值不动，后面追加「在集成战略中…」；3 级另加部署技力。
 */
export const HORN_TALENT_L2 = '在场时所有重装干员的攻击力+23%（+3%）；在集成战略中，在场时额外使重装干员攻击力+8%、生命上限+12%，号角身前2格每部署1个友方单位，使号角攻击距离提升1格、远程攻击目标数提升1';
export const HORN_TALENT_L3 = `${HORN_TALENT_L2}；自身部署时立即获得10点技力（本场最多20点）`;

/** 黑板块（官方形状：{key, value, valueStr}）。 */
const bb = (key, value, valueStr = null) => ({ key, value, valueStr });

/** 面板黑板块：生命 / 攻击（[ASSUMED]，设计稿 §2.1）。 */
const attrBoard = (maxHp, atk) => [bb('max_hp', maxHp), bb('atk', atk)];

/**
 * 天赋黑板块（2 级；3 级另加两条技力）。
 * 键名与 server/sim/content/hexcards/stone_mode_modules_isw.js 的 numOf 兜底同名：卡面 params.modeModules 给了
 * 同名键就以卡面为准，没给就用这里的值（设计稿 §6）。
 */
const talentBoardL2 = () => [
  bb('atk', 0.23),            // 军事要塞本体（满潜 +23%）：照官方值重述一遍，模组不改它
  bb('horn_aura_atk', 0.08),  // 在集成战略中：全场己方重装干员额外 +8% 攻击力
  bb('horn_aura_hp', 0.12),   // 同上：生命上限 +12%
  bb('horn_front_range', 1),  // 号角身前每 1 名友方单位 → 攻击距离 +1 格
  bb('horn_front_targets', 1),// 同上：远程攻击目标数 +1
];
const talentBoardL3 = () => [...talentBoardL2(), bb('horn_sp', 10), bb('horn_sp_cap', 20)];

/** 特性 part（DISPLAY：只追加一行特性文本，不重写特性本体）。 */
function traitPart() {
  return {
    resKey: null,
    target: 'DISPLAY',
    isToken: false,
    validInGameTag: null,
    validInMapTag: null,
    addOrOverrideTalentDataBundle: { candidates: null },
    overrideTraitDataBundle: {
      candidates: [{
        additionalDescription: HORN_TRAIT_ADDED,
        unlockCondition: { phase: 'PHASE_2', level: 60 },
        requiredPotentialRank: 0,
        blackboard: [],
        overrideDescripton: null,
        prefabKey: null,
        rangeId: null,
      }],
    },
  };
}

/**
 * 天赋 part（TALENT：覆盖天赋 0 的文本 + 追加黑板块）。
 * `resKey` 照官方的 `<char>_equip_<n>_<level>_p<n>` 命名写一个（只是资源键，引擎不读）。
 */
function talentPart(equipLevel, upgradeDescription, blackboard) {
  return {
    resKey: `horn_equip_4_${equipLevel}_p1`,
    target: 'TALENT',
    isToken: false,
    validInGameTag: null,
    validInMapTag: null,
    addOrOverrideTalentDataBundle: {
      candidates: [{
        displayRangeId: false,
        upgradeDescription,
        talentIndex: 0,          // 军事要塞
        validModeIndices: null,
        unlockCondition: { phase: 'PHASE_2', level: 60 },
        requiredPotentialRank: 0,
        prefabKey: '10_root',
        name: '军事要塞',
        description: null,
        rangeId: null,
        blackboard,
        tokenKey: null,
        isHideTalent: false,
      }],
    },
    overrideTraitDataBundle: { candidates: null },
  };
}

/**
 * uniequip_table.equipDict 的合成记录（字段集合抄官方 uniequip_003_rosmon 迷迭香特限证章 ISW-A）。
 * `unlockFavors` / `itemCost` 照 rosmon 的值（特限证章统一价：mod_unlock_token × 1，三级同价）；
 * `uniEquipGetTime` / `uniEquipShowEnd` 是活动窗口，本作没有对应活动 ⇒ null。
 * `uniEquipDesc` 照官方特限证章的体例自写（官方原文没有公布，build-data 也不读这个字段，只是形状保真）。
 */
export const CUSTOM_UNIEQUIPS = Object.freeze({
  [HORN_ISW_A_ID]: Object.freeze({
    uniEquipId: HORN_ISW_A_ID,
    uniEquipName: '号角特限证章',
    uniEquipIcon: HORN_ISW_A_ID,
    uniEquipDesc: '号角已获得特别认证许可\n根据外勤部门决议\n在集成战略行动中以改良策略应对敌人\n特别颁发此证章\n以兹证明',
    typeIcon: 'isw-a',
    typeName1: 'ISW',
    typeName2: 'A',
    equipShiningColor: 'purple',
    showEvolvePhase: 'PHASE_2',
    unlockEvolvePhase: 'PHASE_2',
    charId: HORN_CHAR_ID,
    tmplId: null,
    showLevel: 1,
    unlockLevel: 60,
    missionList: [],
    unlockFavors: Object.freeze({ 1: 0, 2: 2732, 3: 10070 }),
    itemCost: Object.freeze({
      1: Object.freeze([Object.freeze({ id: 'mod_unlock_token', count: 1, type: 'MATERIAL' })]),
      2: Object.freeze([Object.freeze({ id: 'mod_unlock_token', count: 1, type: 'MATERIAL' })]),
      3: Object.freeze([Object.freeze({ id: 'mod_unlock_token', count: 1, type: 'MATERIAL' })]),
    }),
    type: 'ADVANCED',
    uniEquipGetTime: null,
    uniEquipShowEnd: null,
    charEquipOrder: 4,
    hasUnlockMission: false,
    isSpecialEquip: true,
    specialEquipDesc: '适配限定模式',
    specialEquipColor: '0098dc',
    charColor: '#0098dc',
  }),
});

/**
 * battle_equip_table 的合成记录（{ phases: [...] }，三个 equipLevel）。
 * 1 级：特性追加行 + 面板（天赋不动）；2 级：再加天赋追加行；3 级：再加技力两条黑板块。
 */
export const CUSTOM_BATTLE_EQUIPS = Object.freeze({
  [HORN_ISW_A_ID]: Object.freeze({
    phases: Object.freeze([
      Object.freeze({
        equipLevel: 1,
        parts: Object.freeze([traitPart()]),
        attributeBlackboard: Object.freeze(attrBoard(150, 55)),
        tokenAttributeBlackboard: Object.freeze({}),
      }),
      Object.freeze({
        equipLevel: 2,
        parts: Object.freeze([traitPart(), talentPart(2, HORN_TALENT_L2, talentBoardL2())]),
        attributeBlackboard: Object.freeze(attrBoard(190, 70)),
        tokenAttributeBlackboard: Object.freeze({}),
      }),
      Object.freeze({
        equipLevel: 3,
        parts: Object.freeze([traitPart(), talentPart(3, HORN_TALENT_L3, talentBoardL3())]),
        attributeBlackboard: Object.freeze(attrBoard(230, 85)),
        tokenAttributeBlackboard: Object.freeze({}),
      }),
    ]),
  }),
});

/** 合成记录的自检：形状不对时立刻抛错，而不是让 build-data 生成半截数据。 */
function checkShape(id) {
  const meta = CUSTOM_UNIEQUIPS[id];
  const be = CUSTOM_BATTLE_EQUIPS[id];
  if (!meta || !be) throw new Error(`custom module ${id}: missing equipDict or battle_equip record`);
  if (meta.uniEquipId !== id) throw new Error(`custom module ${id}: equipDict uniEquipId mismatch (${meta.uniEquipId})`);
  if (!meta.charId) throw new Error(`custom module ${id}: equipDict has no charId`);
  if (!Array.isArray(be.phases) || be.phases.length !== 3) throw new Error(`custom module ${id}: battle_equip needs 3 phases`);
  const levels = be.phases.map((p) => p && p.equipLevel).sort();
  if (levels.join(',') !== '1,2,3') throw new Error(`custom module ${id}: phases must be equipLevel 1/2/3 (got ${levels.join(',')})`);
  for (const ph of be.phases) {
    if (!Array.isArray(ph.parts)) throw new Error(`custom module ${id}: level ${ph.equipLevel} has no parts[]`);
    if (!Array.isArray(ph.attributeBlackboard)) throw new Error(`custom module ${id}: level ${ph.equipLevel} has no attributeBlackboard[]`);
    if (!ph.parts.some((pt) => pt && pt.overrideTraitDataBundle?.candidates?.length)) {
      throw new Error(`custom module ${id}: level ${ph.equipLevel} has no trait part`);
    }
  }
}

/**
 * 把 CUSTOM_UNIEQUIPS / CUSTOM_BATTLE_EQUIPS 合并进 build-data 的 ctx（就地）。幂等：第二次调用返回空数组。
 * @param {{ uniequip: any, battleEquip: any }} ctx
 * @returns {string[]} 这次真正加进去的模组 id
 */
export function applyCustomModules(ctx) {
  const u = ctx && ctx.uniequip;
  const be = ctx && ctx.battleEquip;
  if (!u || !be) throw new Error('applyCustomModules: needs { uniequip, battleEquip }');
  u.equipDict = u.equipDict || {};
  u.charEquip = u.charEquip || {};
  const added = [];
  for (const id of Object.keys(CUSTOM_UNIEQUIPS)) {
    checkShape(id);
    const meta = CUSTOM_UNIEQUIPS[id];
    let touched = false;
    if (!u.equipDict[id]) { u.equipDict[id] = meta; touched = true; }
    if (!be[id]) { be[id] = CUSTOM_BATTLE_EQUIPS[id]; touched = true; }
    // 归属：追加在该角色已有模组之后（去重），默认模组（charShopChessDatas.defaultUniEquipId）不动。
    const list = u.charEquip[meta.charId] || (u.charEquip[meta.charId] = []);
    if (!list.includes(id)) { list.push(id); touched = true; }
    if (touched) added.push(id);
  }
  return added;
}

/** 官方表里是否已经有这张模组（给测试/工具判断是否需要注入）。 */
export function hasOfficialRow(id) {
  const table = existsSync(join(CACHE, 'uniequip_table.json'))
    ? JSON.parse(readFileSync(join(CACHE, 'uniequip_table.json'), 'utf8'))
    : null;
  return !!(table && table.equipDict && table.equipDict[id]);
}
