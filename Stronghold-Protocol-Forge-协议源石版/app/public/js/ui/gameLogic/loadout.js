// ui/gameLogic/loadout.js — skill / module loadout shown on cards. Re-exported from ../gameLogic.js.

import { MODULE_NONE, loadoutOptions, resolveLoadout } from '../../../../shared/protocol.js';
import { loadoutRecord, normalFormModuleOf, resolveRecordLoadout, withModuleLevel3 } from '../../../../shared/loadoutRecord.js';
import { cultivationOf, cultivateMul, cultivatedStats, isPotential, isCultivate } from '../../../../shared/potential.js';
import { isObj } from './shared.js';
import { t } from '../../../../shared/i18n.js';

/** The summon owner's variant: exact chess id, normal sibling, then the first available variant. */
export function tokenVariantFor(token, ownerId = null) {
  const vs = token?.variants || {};
  if (typeof ownerId === 'string') {
    const v = vs[ownerId] || vs[ownerId.replace(/_b$/, '_a')];
    if (v) return v;
  }
  return Object.values(vs)[0] || null;
}

// ---- operator loadout (DESIGN §16) ----------------------------------------------------------------------------------

/**
 * The skill / module a chess fights with under the player's loadout (m.private.loadout, DESIGN §16) — what the shop
 * card and the detail panel show. Works with data that already lists every selectable skill (`skills[]`, elite
 * `modules[]`) and with older data (only the default `skill` / `module`).
 * 0.2.2: the record (stats, talents) is at the operator's 潜能 and its stats carry the 练度 multiplier — the player's
 * settings (`opts.ops`: m.private.ops / the 干员调配 store; missing = 潜能 6, 精英2 Lv.60), or a unit's own
 * (`opts.cultivation`: a teammate's UnitInfo — null = none); a 补位 stand-in / prototype 自选 record has neither
 * (shared/potential.js cultivationOf). The 练度 needs `opts.effects` (data/effects.json). A composed 自选 record is
 * already at its potential (gameLogic/diy.js: the pick's `potential`).
 * @param {any} chess the chess record (normal or elite)
 * @param {any} loadout m.private.loadout `{ [baseChessId]: { skill, module } }` (entries equal to the defaults may be
 *   missing); null → defaults
 * @param {(id: string) => any} [getChess]
 * @param {{ ops?: any, cultivation?: { potential?: number|null, cultivate?: number|null } | null, effects?: any }} [opts]
 * @returns {{ skill: any, skillIndex: number|null, defaultSkill: boolean, module: { id: string, name: string, typeName: string, none: boolean }|null,
 *   defaultModule: boolean, changed: boolean, choices: number, record: any,
 *   cultivation: { potential: number, cultivate: number|null } | null } | null}
 */
export function chessLoadout(chess, loadout, getChess = () => null, opts = {}) {
  if (!isObj(chess)) return null;
  const lo = isObj(loadout) && !Array.isArray(loadout) ? loadout : null;
  let r = { skillIndex: null, moduleId: null };
  try { r = resolveLoadout(lo, chess, getChess); } catch { /* defaults */ }
  const skills = Array.isArray(chess.skills) && chess.skills.length ? chess.skills.filter(isObj) : (isObj(chess.skill) ? [chess.skill] : []);
  const skill = skills.find((s) => s.index === r.skillIndex) || (isObj(chess.skill) ? chess.skill : null) || skills[0] || null;
  const base = chess.isGolden ? (getChess(chess.baseId) || chess) : chess;
  let opt = { defaultSkill: null, defaultModule: null, skills: [] };
  try { opt = loadoutOptions(base, chess.isGolden ? chess : null); } catch { /* defaults */ }
  const defIdx = opt.defaultSkill ?? chess.skill?.index ?? null;
  const defaultSkill = !skill || skill.index == null || defIdx == null || skill.index === defIdx;
  // 协议源石【特限恢复】(hex_mode_modules): `opts.moduleLevel === 3` ⇒ the operator fights with its module's equipLevel 3
  // data. For a **normal** form (`_a`, no `modules` list) that module is the one picked in 干员调配 — the same rule as the
  // battle (server/match/player/round.js + simdata getChess, 业主 2026-10-31「不生效对没有精锐的干员」).
  const moduleLevel = opts.moduleLevel === 3 ? 3 : null;
  // 普通形态在【特限恢复】下作战的模组（精锐记录才是模组表所在）：干员调配里选的那个，没选 ⇒ 精锐的默认模组，
  // 明说「不装备」⇒ none。与服务端同一条口径（PlayerState.battleInput 补 moduleId、simdata.getChess 缺省回落）。
  const normalMod = moduleLevel && !chess.isGolden ? normalFormModule(chess, lo, getChess) : null;
  let module = null;
  let defaultModule = true;
  if (chess.isGolden) {
    const id = r.moduleId ?? (chess.module?.active ? chess.module.id : MODULE_NONE);
    if (id === MODULE_NONE) module = { id: MODULE_NONE, name: t('未装备模组'), typeName: '', none: true };
    else {
      const rec = (Array.isArray(chess.modules) ? chess.modules : []).find((m) => isObj(m) && m.uniEquipId === id)
        || (isObj(chess.module) && chess.module.id === id ? { uniEquipId: id, name: chess.module.name, typeName: chess.module.type } : null);
      module = { id, name: rec?.name || id, typeName: rec?.typeName || rec?.type || '', none: false };
    }
    defaultModule = opt.defaultModule == null || id === opt.defaultModule;
  } else if (normalMod) {
    module = normalMod;
    defaultModule = normalMod.isDefault;
  }
  // 0.2.2: the operator's 潜能 / 练度 (the player's settings, or the unit's own)
  const cv = cultivationFor(chess, opts);
  // the record the unit fights with (stats / 特性 / talents of the chosen module or none, at its potential — the
  // battle's own composition, shared/loadoutRecord.js): the detail card must show what the sim runs
  let record = chess;
  try { record = loadoutRecord(chess, resolveRecordLoadout(chess, { skillIndex: r.skillIndex, moduleId: r.moduleId, potential: cv ? cv.potential : null })) || chess; } catch { /* the record as is */ }
  if (moduleLevel) {
    // 目标模组 id：普通形态就是上面那个（'none' 原样传进去 ⇒ withModuleLevel3 不套任何 3 级数据，与战斗一致）；
    // 精锐沿用记录自己的默认模组（null ⇒ withModuleLevel3 回落到 rec.module.id）。
    const want = chess.isGolden ? null : (normalMod ? normalMod.id : null);
    try { record = withModuleLevel3(record, opts.moduleLevels || {}, want) || record; } catch { /* the record as is */ }
  }
  const mul = cv && isCultivate(cv.cultivate) ? cultivateMul(opts?.effects, cv.cultivate) : null;
  if (mul && record && record.stats) record = { ...record, stats: cultivatedStats(record.stats, mul) };
  return { skill, skillIndex: skill?.index ?? null, defaultSkill, module, defaultModule, changed: !defaultSkill || !defaultModule,
    choices: Math.max(skills.length, opt.skills?.length || 0), record, cultivation: cv };
}

/**
 * 普通形态（未精锐）在【特限恢复】下卡片上显示的那个模组 —— `shared/loadoutRecord.js normalFormModuleOf`（与
 * `simdata.getChess` 缺省 moduleId 同一条判据），再补上卡片要的 `none` 名字与 `isDefault` 标记。
 * @returns {{ id: string, name: string, typeName: string, none: boolean, isDefault: boolean }|null}
 */
function normalFormModule(chess, loadout, getChess) {
  const m = normalFormModuleOf(chess, loadout, getChess);
  if (!m) return null;
  if (m.none) return { id: MODULE_NONE, name: t('未装备模组'), typeName: '', none: true, isDefault: false };
  return { id: m.id, name: m.name || m.id, typeName: m.typeName || '', none: false, isDefault: !!m.isDefault };
}

/**
 * The 潜能 / 练度 of a card's record (chessLoadout `opts`): the unit's own (`cultivation`, null = none) or the player's
 * settings (`ops`, shared/potential.js cultivationOf — null for a stand-in / prototype 自选 record).
 * @returns {{ potential: number, cultivate: number|null } | null}
 */
function cultivationFor(chess, opts) {
  if (opts && opts.cultivation !== undefined) {
    const c = opts.cultivation;
    if (!isObj(c) || !isObj(chess) || chess.standInFor || chess.diyProto) return null;
    return { potential: isPotential(c.potential) ? c.potential : 6, cultivate: isCultivate(c.cultivate) ? c.cultivate : null };
  }
  return cultivationOf(chess, opts ? opts.ops : null);
}

/**
 * The 潜能 / 练度 a battle / scouting unit fights at (UnitInfo `potential` — below 6 only — and `cultivate`, 0.2.2): for
 * chessLoadout `opts.cultivation`; null when the unit has neither (a stand-in, a prototype 自选 piece, a raw unit).
 * @param {any} unit UnitInfo
 */
export function unitCultivation(unit) {
  if (!isObj(unit)) return null;
  const pot = isPotential(unit.potential) ? unit.potential : 6;
  const cult = isCultivate(unit.cultivate) ? unit.cultivate : null;
  return cult == null && pot === 6 ? null : { potential: pot, cultivate: cult };
}

/**
 * The loadout (m.private.loadout shape) a battle / scouting unit fights with, from the unit itself — a teammate's
 * operator shows ITS owner's skill / module (DESIGN §16), not the viewer's nor the defaults: UnitInfo `skillIndex`
 * (sim units, prep scouting m.field units) and `moduleId` (elite only), keyed by the chess's base id for chessLoadout.
 * Null when the unit carries neither (the defaults).
 * @param {any} chess the unit's chess record (normal or elite)
 * @param {any} unit UnitInfo
 * @returns {Record<string, { skill?: number, module?: string }> | null}
 */
export function unitLoadout(chess, unit) {
  if (!isObj(chess) || !isObj(unit)) return null;
  const baseId = chess.baseId || chess.chessId;
  if (typeof baseId !== 'string' || !baseId) return null;
  const e = {};
  if (Number.isInteger(unit.skillIndex) && unit.skillIndex >= 0) e.skill = unit.skillIndex;
  if (chess.isGolden && typeof unit.moduleId === 'string' && unit.moduleId) e.module = unit.moduleId;
  return Object.keys(e).length ? { [baseId]: e } : null;
}
