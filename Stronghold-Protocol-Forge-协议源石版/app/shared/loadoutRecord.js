// shared/loadoutRecord.js — operator loadouts (DESIGN §16, DATA.md §2.2): a data/chess.json record as the selected
// skill / module make it. Pure ESM shared by the simulation (server/sim/simdata.js re-exports it: getChess(id, loadout)
// builds unit defs from it) and the client UI (the detail card shows the stats / 特性 / talents the unit fights with —
// user playtest #2 integration: an elite on 不装备 showed its default module's ATK and trait; attackRangeGrid = the range
// it is deployed with, also the board overlay and the deploy wheel — extendedGrid is the battle's own 攻击距离 growth,
// re-exported by server/sim/targeting.js). One implementation, so the card and the battle never disagree. (Which
// choices a player may make: shared/protocol.js loadoutOptions.) A loadout may carry the operator's potential (潜能 1–6,
// the player's 干员调配 setting since 0.2.2 — shared/potential.js): the record is composed at it first.
//
// 模组的 3 级形态（协议源石【特限恢复】）由 withModuleLevel3 组合：同一个模组的 equipLevel 3 数据替换 attr /
// traitOverride / talentChanges，`module.level` 变 3（普通形态也用它的默认模组）。调用方是 server/sim/simdata.js
// getChess（loadout.moduleLevel === 3）。
//
// Two readings of the Chinese texts drive that preview — 「被动效果：攻击范围扩大」 on a skill and 「攻击范围扩大」 /
// 「集成战略」 on a module's trait line — and the client previews the *localized* record, whose texts the game-text overlay
// has replaced (upstream GitHub #700: en / ja / ko lost a tile of 精锐莱恩哈特's preview, 引星棘刺 S3 stopped widening it,
// and 空弦 ISW-A's 集成战略 module started adding one). So each reading is also a boolean — `passiveRange` on the skill,
// `rangeExpand` / `modeOnly` on the trait — derived from the Chinese record and cached on the localized one when the data
// is loaded (`withRangeFlags`, called by public/js/data.js; the data/*.json files keep no such field). Every reader below
// takes the boolean first and the Simplified line as the fallback — the Chinese data, a kit's own record, a plugin's. The
// field names are upstream's, so storing them in the data later changes nothing here.

import { GEO } from './constants.js';
import { atPotential, isPotential, POTENTIAL_DEFAULT } from './potential.js';

/**
 * Resolve a loadout against a chess record. `potential` (潜能 1–6; anything else = 6, full potential — the default)
 * rides along: loadoutRecord composes the record at it (shared/potential.js atPotential).
 * @param {object|null} rec data/chess.json record
 * @param {{ skillIndex?: number, moduleId?: string, skill?: number, module?: string, potential?: number }|null} [loadout]
 * @returns {{ skillIndex: number|null, moduleId: string|null, potential: number, skillIsDefault: boolean,
 *             moduleIsDefault: boolean, potentialIsDefault: boolean, isDefault: boolean }|null} null without a record;
 *             `moduleId` null for chess without module choices
 */
export function resolveRecordLoadout(rec, loadout = null) {
  if (!rec || typeof rec !== 'object') return null;
  const skills = Array.isArray(rec.skills) ? rec.skills : null;
  const defSkill = rec.skill && Number.isInteger(rec.skill.index) ? rec.skill.index : (skills?.find((s) => s && s.isDefault)?.index ?? null);
  const lo = loadout && typeof loadout === 'object' ? loadout : {};
  const wantSkill = lo.skillIndex ?? lo.skill;
  const skillIndex = skills && Number.isInteger(wantSkill) && skills.some((s) => s && s.index === wantSkill) ? wantSkill : defSkill;
  const mods = Array.isArray(rec.modules) ? rec.modules : null;
  const defMod = mods ? (mods.find((m) => m && m.isDefault)?.uniEquipId ?? 'none') : null;
  const wantMod = lo.moduleId ?? lo.module;
  const moduleId = mods && (wantMod === 'none' || (typeof wantMod === 'string' && mods.some((m) => m && m.uniEquipId === wantMod))) ? wantMod : defMod;
  const potential = isPotential(lo.potential) ? lo.potential : POTENTIAL_DEFAULT;
  const skillIsDefault = skillIndex === defSkill;
  const moduleIsDefault = moduleId === defMod;
  const potentialIsDefault = potential === POTENTIAL_DEFAULT;
  return {
    skillIndex, moduleId, potential, skillIsDefault, moduleIsDefault, potentialIsDefault,
    isDefault: skillIsDefault && moduleIsDefault && potentialIsDefault,
  };
}

const clean6 = (v) => (typeof v !== 'number' || !Number.isFinite(v) || Number.isInteger(v) || Math.abs(v) >= 1e6 ? v : Math.round(v * 1e6) / 1e6);

/** Stats with a module: the no-module `statsBase` + the module's flat `attr` (same arithmetic as tools/build-data.mjs). */
export function composeStats(statsBase, attr) {
  const s = { ...(statsBase || {}) };
  for (const [f, v] of Object.entries(attr || {})) s[f] = clean6((s[f] || 0) + v);
  return s;
}

/**
 * A talent entry without its potential chain (shared/potential.js: `potMin` / `potBelow`).
 * @param {any} t
 * @returns {any}
 */
const unchained = ({ potMin: _m, potBelow: _b, ...t }) => t;

/**
 * Talents with a module: apply ModuleRecord.talentChanges to the no-module talents — the merge rule of
 * tools/build-data.mjs mergeTalentChanges (override of an existing index: module values win, base keys the module does
 * not restate are kept; otherwise appended; empty placeholders dropped). The result carries no potential chains: a merged
 * list is composed at one potential (resolve the inputs first — shared/potential.js atPotential).
 */
export function composeTalents(base, changes) {
  const talents = (base || []).map(unchained);
  for (const ch0 of changes || []) {
    const { talentIndex, ...rest } = unchained(ch0);
    const rec = { index: talentIndex, ...rest, fromModule: true };
    const at = talentIndex >= 0 ? talents.findIndex((x) => x.index === talentIndex) : -1;
    if (at >= 0) {
      const old = talents[at];
      talents[at] = {
        ...rec,
        name: rec.name || old.name, desc: rec.desc ?? old.desc, descRaw: rec.descRaw ?? old.descRaw,
        bb: { ...old.bb, ...rec.bb }, bbStr: { ...old.bbStr, ...rec.bbStr },
        rangeGrid: rec.rangeGrid || old.rangeGrid, tokenKey: rec.tokenKey || old.tokenKey,
        hidden: old.hidden && rec.hidden,
      };
    } else {
      talents.push(rec);
    }
  }
  return talents.filter((t) => t.name || t.desc || Object.keys(t.bb || {}).length || t.tokenKey);
}

/**
 * The chess record as the selected loadout makes it (a new object; the input is never mutated): at a potential below 6
 * the record at that potential first (stats / statsBase / talents / talentsBase / module talent changes — shared/potential.js
 * atPotential); `skill` = the selected SkillRecord; golden chess with a non-default module choice: `stats` = statsBase +
 * module attr, `trait` = the module's traitOverride or traitBase, `talents` = talentsBase + talentChanges, `module` =
 * the chosen module (`active:false`, id null for 'none'). A talent that summons through a container token (凛御银灰)
 * follows the selected skill's token. The default loadout returns `rec` itself.
 * @param {object} rec0 data/chess.json record
 * @param {object} lo resolveRecordLoadout(rec0, …)
 */
export function loadoutRecord(rec0, lo) {
  if (!rec0 || !lo || lo.isDefault) return rec0;
  const rec = lo.potentialIsDefault === false ? atPotential(rec0, lo.potential) : rec0;
  const out = { ...rec };
  if (!lo.moduleIsDefault && Array.isArray(rec.modules)) {
    const m = lo.moduleId === 'none' ? null : rec.modules.find((x) => x.uniEquipId === lo.moduleId) ?? null;
    out.stats = composeStats(rec.statsBase ?? rec.stats, m ? m.attr : null);
    out.trait = (m && m.traitOverride) || rec.traitBase || rec.trait;
    out.talents = composeTalents(rec.talentsBase ?? rec.talents, m ? m.talentChanges : null);
    out.module = m
      ? { id: m.uniEquipId, name: m.name ?? null, type: m.typeName ?? null, level: m.level ?? rec.module?.level ?? 0, active: true }
      : { id: null, name: null, type: null, level: rec.module?.level ?? 0, active: false };
  }
  if (!lo.skillIsDefault && Array.isArray(rec.skills)) {
    const s = rec.skills.find((x) => x.index === lo.skillIndex);
    if (s) {
      out.skill = s;
      if (rec.assets) out.assets = { ...rec.assets, skillIcon: s.iconId ?? rec.assets.skillIcon };
      const tok = s.overrideTokenKey;
      if (tok && (rec.tokens || []).includes(tok) && (out.talents || []).some((t) => t && t.containerTokenKey)) {
        out.talents = out.talents.map((t) => (t && t.containerTokenKey ? { ...t, tokenKey: tok } : t));
      }
    }
  }
  return out;
}

/**
 * 模组的 3 级形态（协议源石【特限恢复】, 04-文档/协议源石-突破极限与特限恢复-设计稿-20261031.md §4.1/§4.2）：
 * `rec` 换成「同一个模组的 equipLevel 3 数据」组合出来的那份记录 —— `stats` = statsBase + 3 级 attr、`trait` =
 * 3 级 traitOverride（没有则 traitBase）、`talents` = talentsBase + 3 级 talentChanges、`module.level = 3`。
 *
 * 目标模组 id：给了 `moduleId` 就用它（自选编队的 pick），否则用 `rec.module.id` —— 这正是**普通形态**（`_a`，
 * `module.active === false`，`level` 0/1）拿默认模组 3 级数据的那条路：build-data 把精锐形态的默认模组 id 也写在
 * 普通记录的 `module` 上。`moduleLevels` 里查不到该 id（干员没有模组数据 / 该模组没有 3 级记录 / 传了 'none'）⇒
 * 原样返回 `rec`，调用方不必先判断。**不改 rec 原对象**（data/*.json 是冻结的共享数据）：返回的一定是新对象，除了
 * 上面那几个字段以外逐字段与 rec 相同；`modules` 列表里同一个模组的条目也换成 3 级那份（攻击范围的判定
 * attackRangeGrid 读的是 `modules`，不换会出现「面板说范围大了、战斗里没有」）。
 *
 * [ASSUMED] `moduleLevel` 只有 3 这一档（数据文件只生成 equipLevel 3），所以调用方只需判断 === 3；别的数字当作没开。
 * @param {object|null} rec 一条 chess 记录，或 loadoutRecord 组合出来的记录
 * @param {Readonly<Record<string, any>>|null|undefined} moduleLevels data/moduleLevels.json（server/data.js rawModuleLevels）
 * @param {string|null} [moduleId] 目标模组 id；缺省 = rec.module.id
 * @returns {object} 新记录，或 rec 本身（查不到 3 级记录）
 */
export function withModuleLevel3(rec, moduleLevels, moduleId = null) {
  if (!rec || typeof rec !== 'object') return rec;
  if (!moduleLevels || typeof moduleLevels !== 'object') return rec;
  if (moduleId === 'none') return rec; // 明说「不装备模组」：没有模组就没有 3 级数据
  const own = rec.module && typeof rec.module === 'object' ? rec.module : null;
  const want = typeof moduleId === 'string' && moduleId ? moduleId : (own && typeof own.id === 'string' ? own.id : null);
  if (!want || want === 'none' || !Object.hasOwn(moduleLevels, want)) return rec;
  const m = moduleLevels[want];
  if (!m || typeof m !== 'object') return rec;
  const out = { ...rec };
  out.stats = composeStats(rec.statsBase ?? rec.stats, m.attr);
  out.trait = m.traitOverride || rec.traitBase || rec.trait;
  out.talents = composeTalents(rec.talentsBase ?? rec.talents, m.talentChanges);
  out.module = {
    ...(own || {}),
    id: m.uniEquipId ?? want,
    name: m.name ?? (own ? own.name : null) ?? null,
    type: m.typeName ?? (own ? own.type : null) ?? null,
    level: 3,
    active: true,
  };
  if (Array.isArray(rec.modules)) {
    out.modules = rec.modules.map((x) => (x && typeof x === 'object' && x.uniEquipId === want ? { ...x, ...m } : x));
  }
  return out;
}

/**
 * Whether the selected skill's `rangeGrid` is the range the operator is deployed with (「被动效果：攻击范围扩大」,
 * 引星棘刺 S3). `passiveRange` — the Chinese reading of the skill text, cached at load — comes first, because the
 * previewed record's `desc` no longer has the Simplified line (GitHub #700). Without it the line is matched, which is
 * the Chinese data and a plugin's record. [ASSUMED] A plugin may set `passiveRange: true` without the line; any other
 * value, `false` included, falls through to the line as `placeOnRanged` does (shared/highGround.js).
 * @param {object|null} sk a SkillRecord
 * @returns {boolean}
 */
function skillCarriesOwnRange(sk) {
  if (!sk || !Array.isArray(sk.rangeGrid) || !sk.rangeGrid.length) return false;
  if (sk.passiveRange === true) return true;
  return /被动效果：攻击范围扩大/.test(String(sk.desc ?? '')); // i18n-ignore: fallback match, not player text
}

/**
 * Whether the equipped module's added trait line widens the attack range (「攻击范围扩大」, 莱恩哈特 SPC-X).
 * `trait.rangeExpand` — the Chinese reading of `moduleDesc`, cached at load (GitHub #700) — comes first; absent, the
 * Simplified line. [ASSUMED] A plugin may set `rangeExpand: true` without the line; `false` still falls through to it.
 * @param {object|null} trait the record's or a module's trait
 * @returns {boolean}
 */
function moduleWidensRange(trait) {
  if (trait?.rangeExpand === true) return true;
  return /攻击范围扩大/.test(String(trait?.moduleDesc ?? '')); // i18n-ignore: fallback match, not player text
}

/**
 * The attack range a (loadout-resolved) chess record fights with from its deployment — the detail card without a live
 * entry, the board's range overlay and the deploy wheel (DESIGN §16), the same tiles the battle unit starts with (prep
 * m.unitStats `range`): the selected skill's grid when it is that skill's own range (`passiveRange`, or the Chinese
 * line "被动效果：攻击范围扩大" when the boolean is absent — 引星棘刺 S3 3-9: her own range while she carries it, her
 * kit); else an elite whose equipped module widens the range (`trait.rangeExpand`, or "攻击范围扩大" when the boolean is
 * absent) uses that module's own grid — its range-only talent change (talentIndex −1), e.g. SPC-X = the 3×3 caster range
 * + the centre tile [0,3] — as the kits do (kits/shared/tier4.js moduleRangeGrid, shared/tier5.js moduleRangeUp); anything
 * else its `rangeGrid`. Then grown by the 特性's permanent 攻击距离 (traitRangeExtend: 信仰搅拌机 SPT-Y "攻击距离+1").
 * A running skill's range is the live entry's.
 * @param {object|null} rec loadoutRecord(…) output (or a data/chess.json record: its default module)
 * @returns {number[][]|null}
 */
export function attackRangeGrid(rec) {
  if (!rec || typeof rec !== 'object') return null;
  let g = Array.isArray(rec.rangeGrid) ? rec.rangeGrid : null;
  const sk = rec.skill;
  const m = rec.module;
  if (skillCarriesOwnRange(sk)) {
    g = sk.rangeGrid;
  } else if (rec.isGolden && m && m.active && m.id && moduleWidensRange(rec.trait)) {
    const mod = (Array.isArray(rec.modules) ? rec.modules : []).find((x) => x && x.uniEquipId === m.id);
    const mg = (mod?.talentChanges || []).find((t) => t && t.talentIndex === -1 && Array.isArray(t.rangeGrid) && t.rangeGrid.length)?.rangeGrid;
    if (mg) g = mg;
  }
  const ext = traitRangeExtend(rec);
  return g && ext ? extendedGrid(g, ext) : g;
}

/**
 * The permanent 攻击距离 (ability_range_forward_extend) a record's 特性 grants — a module's, e.g. 信仰搅拌机 SPT-Y
 * "攻击距离+1" (its kit's rangeUp: a persistent rangeExtend buff, s.baseRangeExtend); 0 for one that works "在集成战略中" only
 * (空弦 ISW-A). `trait.modeOnly` — the Chinese reading of `moduleDesc`, cached at load (GitHub #700) — refuses it on a
 * localized record too; absent, the Simplified line 「集成战略」. [ASSUMED] A plugin may set `modeOnly: true` without the
 * line; `false` still falls through to it. The other 攻击距离 of the mode are skills' (their running range).
 * @param {object|null} rec loadoutRecord(…) output
 */
export function traitRangeExtend(rec) {
  const t = rec && typeof rec === 'object' ? rec.trait : null;
  if (!t || typeof t !== 'object') return 0;
  if (t.modeOnly === true || /集成战略/.test(String(t.moduleDesc ?? ''))) return 0; // i18n-ignore: fallback match, not player text
  const n = Math.floor(Number(t.bb?.ability_range_forward_extend) || 0);
  return n > 0 ? n : 0;
}

/**
 * `rec` — a localized copy of the record `zh` — with the range readings of its Chinese texts cached on it (GitHub #700):
 * `passiveRange` on each skill, `rangeExpand` / `modeOnly` on the record's `trait` and on every module's `traitOverride`.
 * What public/js/data.js puts on the chess table it hands the interface, because the overlay has replaced those texts by
 * then. Copies are made only along the paths that gain a boolean; a record that gains none is returned as it is. `zh` is
 * the record before localization (`data.getRaw('chess')`), the same entry by id.
 * [ASSUMED] Nothing derives the booleans for a record with no Chinese twin (a plugin's own chess): it keeps the text.
 * @param {object} rec the localized record
 * @param {object} zh its Chinese original
 * @returns {object} rec, or the same record with the readings
 */
export function withRangeFlags(rec, zh) {
  if (!rec || typeof rec !== 'object' || !zh || typeof zh !== 'object') return rec;
  let out = rec;
  // the boolean pair a Chinese trait line yields (the trait itself when it yields none)
  const traitFlags = (t, zhT) => {
    if (!t || typeof t !== 'object' || !zhT || typeof zhT !== 'object') return t;
    const md = String(zhT.moduleDesc ?? '');
    const add = {};
    if (t.rangeExpand !== true && /攻击范围扩大/.test(md)) add.rangeExpand = true;
    if (t.modeOnly !== true && /集成战略/.test(md)) add.modeOnly = true;
    return Object.keys(add).length ? { ...t, ...add } : t;
  };
  const flaggedSkill = (sk, zhSk) => {
    if (!sk || typeof sk !== 'object' || sk.passiveRange === true) return sk;
    if (!zhSk || !Array.isArray(sk.rangeGrid) || !sk.rangeGrid.length) return sk;
    return /被动效果：攻击范围扩大/.test(String(zhSk.desc ?? '')) ? { ...sk, passiveRange: true } : sk; // i18n-ignore: the reading itself
  };
  // the skill list, then the `skill` pointer into it (a localized record's copy of the same Chinese entry)
  const zhSkills = new Map();
  for (const s of Array.isArray(zh.skills) ? zh.skills : []) if (s && Number.isInteger(s.index)) zhSkills.set(s.index, s);
  const zhSkillOf = (s) => (s && Number.isInteger(s.index) ? zhSkills.get(s.index) : undefined) ?? zh.skill ?? null;
  if (Array.isArray(rec.skills)) {
    let list = rec.skills;
    rec.skills.forEach((s, i) => {
      const next = flaggedSkill(s, zhSkillOf(s));
      if (next === s) return;
      if (list === rec.skills) list = rec.skills.slice();
      list[i] = next;
    });
    if (list !== rec.skills) out = { ...out, skills: list };
  }
  if (rec.skill && typeof rec.skill === 'object') {
    const next = flaggedSkill(rec.skill, zhSkillOf(rec.skill));
    if (next !== rec.skill) out = { ...out, skill: next };
  }
  // the record's own trait line (an elite's carries the default module's `moduleDesc`)
  const trait = traitFlags(out.trait, zh.trait);
  if (trait !== out.trait) out = { ...out, trait };
  // every module's trait override — what loadoutRecord puts in `trait` for a non-default module
  if (Array.isArray(rec.modules) && Array.isArray(zh.modules)) {
    const byId = new Map();
    for (const m of zh.modules) if (m && typeof m.uniEquipId === 'string') byId.set(m.uniEquipId, m);
    let list = rec.modules;
    rec.modules.forEach((m, i) => {
      if (!m || typeof m !== 'object') return;
      const zhM = byId.get(m.uniEquipId) ?? zh.modules[i] ?? null;
      const next = traitFlags(m.traitOverride, zhM?.traitOverride ?? null);
      if (next === m.traitOverride) return;
      if (list === rec.modules) list = rec.modules.slice();
      list[i] = { ...m, traitOverride: next };
    });
    if (list !== rec.modules) out = { ...out, modules: list };
  }
  return out;
}

/**
 * A range grid (`[dRow, dCol]`, facing RIGHT) grown by `extend` (rangeExtend / 攻击距离, DESIGN §3): every row gains
 * the whole tiles 1 … ⌊extend⌋ beyond its far (+dCol) end — the relative form of what server/sim/targeting.js
 * absoluteRangeKeys builds, deduplicated, junk entries dropped. One implementation for the battle (re-exported by
 * targeting.js: Battle._refreshRange keeps it as `unit.liveRangeGrid`, the card's live 攻击范围, when an extend applies)
 * and the record's attackRangeGrid.
 * @param {Array<[number, number]>|null|undefined} grid
 * @param {number} [extend]
 * @returns {Array<[number, number]>}
 */
export function extendedGrid(grid, extend = 0) {
  const out = [];
  const seen = new Set();
  const add = (dr, dc) => { const k = `${dr},${dc}`; if (!seen.has(k)) { seen.add(k); out.push([dr, dc]); } };
  if (!Array.isArray(grid)) return out;
  const cells = grid.filter((p) => Array.isArray(p) && Number.isInteger(p[0]) && Number.isInteger(p[1]));
  for (const [dr, dc] of cells) add(dr, dc);
  if (extend > 0 && Number.isFinite(extend)) {
    const maxByRow = new Map();
    for (const [dr, dc] of cells) maxByRow.set(dr, Math.max(maxByRow.get(dr) ?? -Infinity, dc));
    // the cap is the canvas' column count, the same bound server/sim/targeting.js absoluteRangeKeys clamps an extend to
    for (const [dr, mx] of maxByRow) for (let k = 1; k <= Math.min(extend, GEO.CANVAS_COLS); k++) add(dr, mx + k);
  }
  return out;
}
