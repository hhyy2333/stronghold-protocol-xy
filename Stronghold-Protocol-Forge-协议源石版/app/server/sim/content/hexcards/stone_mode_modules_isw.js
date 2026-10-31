// server/sim/content/hexcards/stone_mode_modules_isw.js — 第二十三批（业主 2026-10-31）：协议源石【特限恢复】
// (hex_mode_modules, 2 阶 / gold / 普通卡) 的 **ISW** 特限模组战斗效果。
//
// 设计稿：04-文档/协议源石-突破极限与特限恢复-设计稿-20261031.md §4.3。
// 口径：拥有者的干员，当前装备模组 `u.def.module.type` 以 `ISW-` 开头时，模组「在集成战略中…」的专属效果在
// 卫戍协议里生效。数值全部读卡面 `params.modeModules`（tools/hextech/roster.mjs）。
//
// 设计稿 §4.3 的表一共 12 条记录 / 11 名干员，按模组前缀分三族（ISW- / SO- / RA-）。本文件**只**做 ISW- 那 8 名
// 干员（空弦 / 水月 / 灵知 / 夕 / 归溟幽灵鲨 / 安洁莉娜 / 迷迭香 / 琳琅诗怀雅）；RA- 三行在
// stone_mode_modules_ra.js（同一个批次），SO- 在后续模块里，互相不 import。
//
// CONTRACT: export function installModeModulesIsw(hooks) — hooks is the shared `hexHooks(battle)` bundle
// (server/sim/content/hexcards/hooks.js)。没有这张卡（或 hooks 形状不对）时返回 0，否则返回活句柄
// （owners / carriers / ticks / extras / massApplied / refresh），与其它 stone_* 模块同一个形状。安装只注册 hook：
// 安装时**不改**战斗状态。
//
// 口径：
//   * **作用域**：拥有该卡的玩家自己的**干员** —— `u.kind === 'op' && u.side === 'ally' && u.ownerId` ∈ 拥有者
//     （`hooks.ownersOf('hex_mode_modules')`；生产接线里那个 ownersOf 已经按卡面 `params.modeModules` 的 `types`
//     门控过，模块不再自己读 `types` —— 两处各判一次只会让「卡在不在」有两个答案）。多玩家（联防）场上别人的干员
//     一律不算：每个 handler 都先查拥有者。
//   * **哪名干员吃哪条**：按棋子基名（`def.id` 去掉 `_a` / `_b` 后缀，同 stone_mode_modules_ra.js 的 `opKeyOf`）
//     对设计稿 §4.3 的表。模组本身只有精锐棋子可选（shared/loadoutRecord.js「golden chess only」），所以设计稿
//     列的 `_b` 记录就是实际会吃到这些效果的形态；按基名归一只是一层保险。
//   * **模组判据**：`u.def.module` 的 `type` 以 `ISW-` 开头且 `active === true`。`def.module` 来自
//     shared/loadoutRecord.js（选中模组时 `{ id, name, type: typeName, level, active: true }`；选「不装备」时
//     `{ id: null, type: null, active: false }`）；`simdata.normalizeChess` 只把原始记录留在 `def.raw` 下，所以这里
//     `def.module ?? def.raw.module` 两个位置都读（生产链路上两条都指同一份选中模组）。前缀不是 ISW-（SO- / RA- /
//     普通 MAR-Y …）或模组未启用 ⇒ 这张卡的 ISW 半边对那名干员完全不生效。
//   * **数值**：每条效果的兜底 = 设计稿 §4.3 的落地值；卡面 `params.modeModules` 里给了同名键就以卡面为准
//     （`numOf`，允许 0 / 小数 —— 与 stone_victoria_decay.js / stone_mode_modules_ra.js 同一个读法，
//     `hooks.optNumber` 只收 > 0 所以不用它）。
//   * **确定性**：没有 Math.random / Date / Node API；计时只用 `battle.every` / 事件钩子，随机一个都不用。
//
// 逐条效果与 [ASSUMED]（设计稿 §4.3 的「落地」列 + 本文件的实现口径）：
//
//   1. 空弦 chess_char_3_21_b / ISW-A 「每有一名携带攻击回复技能的干员在场，攻击距离 +1（最高 +3）」
//      → `rangeExtend = min(archetMax, 携带 spType === 'attack' 的己方干员数)`（常驻 passiveBuff；引擎
//      units.js `_recalc` 的 `baseRangeExtend` 会把它算进初始攻击范围，battle/queries.js `rangeChanged` 在变化时
//      重建 rangeKeys）。
//      [ASSUMED] 1) 「己方」= 拥有者自己的己方干员（多玩家场上不借队友的干员数，与「只对拥有者的干员生效」同一
//      口径）；2) 数的是**在场**（alive + deployed + !hidden）的干员，含空弦自己（她自己的技能是攻击回复时也算一名）；
//      3) 重算时机 = `battleStart` / `deploy` / `death` —— 设计稿只写了前两个，「在场」的自然读法还要在有人离场时
//      掉回去，所以补了 `death`（不加计时器，避免每 tick 重建 buff）。
//
//   2. 水月 chess_char_4_09_b / ISW-A 「攻击速度 +50，每秒恢复 4% 生命值」
//      → 常驻 `{ aspd: +50, hpRegenRatio: 0.04 }`（units.js `_recalc`：`hpRegen = … + hpRegenRatio × maxHp`）。
//      [ASSUMED] 「每秒恢复 4% 生命值」= 最大生命上限的 4%/s（不是当前生命），走引擎的生命回复属性（禁疗 /
//      治疗加成的规则由引擎统一管，本卡不另造一套回复）。
//
//   3. 灵知 chess_char_4_13_b / ISW-A 「自身在场时，寒冷 / 冻结的敌人每 0.5 秒受到攻击力 50% 的法术伤害」
//      → `battle.every(0.5)`：对每个带 `cold` / `freeze` 的活敌人，由每名在场的灵知各打一发
//      `0.5 × 自身 ATK` 的法术伤害（来源 = 灵知，tags 标 hex）。
//      [ASSUMED] 1) 只认**状态在身**的敌人（`findBuff('cold')` / `findBuff('freeze')`），不看它是怎么被挂上的；
//      2) 脉冲时点 = t = 0.5s, 1.0s, …（`battle.every` 的第一个脉冲在一个间隔之后）；3) 伤害是**每一名**在场的灵知
//      各一份（两名灵知 = 两发），不是全场只发一发；4) 这一发不可闪避，走正常减伤（法抗照算）。
//
//   4. 夕 chess_char_5_12_b / ISW-A 「额外攻击一个目标」→ 常驻 `{ maxTargets: +1 }`（ai.js 的选目标数读它）。
//
//   5. 归溟幽灵鲨 chess_char_5_13_b / ISW-A 「自身与替身造成的物理 / 法术伤害 +40%，受到的物理 / 法术伤害 -40%」
//      → 常驻 `{ physDealtMul: 1.4, artsDealtMul: 1.4, physTakenMul: 0.6, artsTakenMul: 0.6 }`。
//      [ASSUMED] 1) 她的**替身**在引擎里是同一个 Unit 的另一个形态（professions.js installDollkeeper：
//      `unit.form = 'doll'` / `unit.trait.doll`），本体挂着的那条 buff 本来就跟着走，不需要另挂；2) 为了也覆盖
//      「替身是一枚 token」的写法（`u.kind === 'token'`、同玩家、defId / 名字像替身），deploy / battleStart 时给这类
//      token 补同一份倍率；3) 「+40%」按**乘算**读（×1.4），不是加算百分比。
//
//   6. 安洁莉娜 chess_char_5_20_b / ISW-A 「在场时全场敌人重量 -1」
//      → 对全场敌人挂 `{ massFlat: -1 }`（units.js：`massLevel = max(0, base + ΣmassFlat)`）。
//      [ASSUMED] 1) 重量下限仍是引擎的 0（`Math.max(0, …)`），不额外拦「减到负数」；2) 补挂时机 = `battleStart` /
//      `deploy` / `enemySpawn`，外加 `battle.every(0.5)` 对一次账（她阵亡 / 撤退后要把这一份撤掉，新刷的敌人也不漏）；
//      3) 只对**敌方**单位挂，己方不挂；4) 多名拥有者同时在场时取最重的一份（不叠加）。
//
//   7. 迷迭香 chess_char_6_12_b / ISW-A 「攻击额外造成一次攻击力 100% 的法术伤害」
//      → `hit` 钩子：她自己的**攻击命中**（`dmg.isAttack`）时，对同一目标再打一发 `1.0 × 自身 ATK` 法术伤害。
//      [ASSUMED] 1) 排除元素损伤（`type === 'element'`）/ 流失（`isHpLoss`）/ 反伤（`isRetaliation`）/
//      链式附加（`isChained`，在另一次伤害结算里打出来的）；2) 附伤自己带 `hexModeRosmon` 标记，且引擎会给它盖
//      `chained`，所以不会自己再触发自己（batch15a.js 记录的那种 63 个实例的环）；3) 「额外造成一次」按**独立的一发**
//      结算（各自过减伤 / 护盾），不是把主伤害乘 2；4) 附伤的伤害类型是**法术**（卡面原文）。
//
//   8. 琳琅诗怀雅 chess_char_3_04_b / ISW-A 「部署与在场消耗的部署费用 -30%；每消耗 1 点费用令再部署时间最短的
//      干员 -2 秒」
//      → 只实现「再部署时间 -30%」：常驻 `{ redeployMul: 0.7 }`（lifecycle.js：`respawnAt = deathAt +
//      respawnTime × persist.redeployMul × s.redeployMul`）。
//      [ASSUMED] 卫戍协议的战斗里**没有部署费用**（费用是备战侧的事），所以「部署与在场消耗的费用 -30%」与
//      「每消耗 1 点费用令再部署时间最短的干员 -2 秒」这两半无法建模、整条跳过；只保留设计稿 §4.3 给的等价落地
//      「再部署时间 -30%」。

import { passiveBuff } from '../support/index.js';
import { isChained, isHpLoss, isRetaliation, makeDamageInfo } from '../../damage.js';

/** 卡 id（模块自己的查表键）。 */
const CARD = 'hex_mode_modules';
/** 卡面 effect 里那段参数的名字。 */
const SPEC = 'modeModules';
/** 特限模组的类型前缀（ISW = 集成战略）。 */
const ISW_PREFIX = 'ISW-';
/** 本模块所有附加伤害 / buff 的标记前缀。 */
const TAG = 'hex:modemodules';

/** 常驻被动 buff 的键（每个干员一条；同名替换 = 幂等，掉效果时按同一个键撤销）。 */
const KEY = Object.freeze({
  archet: `${TAG}:isw:archet`,     // 空弦：rangeExtend
  mizuki: `${TAG}:isw:mizuki`,     // 水月：aspd / hpRegenRatio
  dusk: `${TAG}:isw:dusk`,         // 夕：maxTargets
  ghost2: `${TAG}:isw:ghost2`,     // 归溟幽灵鲨（与替身）：dealt / taken 倍率
  swire2: `${TAG}:isw:swire2`,     // 琳琅诗怀雅：redeployMul
});
/** 安洁莉娜挂在**敌人**身上的减重 buff 键（她离场时按它撤销）。 */
const KEY_MASS = `${TAG}:isw:aglina:mass`;

/** 设计稿 §4.3 的八名干员（棋子基名，见文件头「哪名干员吃哪条」）。 */
const GROUP_ARCHET = Object.freeze(new Set(['chess_char_3_21']));   // 空弦
const GROUP_MIZUKI = Object.freeze(new Set(['chess_char_4_09']));   // 水月
const GROUP_GNOSIS = Object.freeze(new Set(['chess_char_4_13']));   // 灵知
const GROUP_DUSK = Object.freeze(new Set(['chess_char_5_12']));     // 夕
const GROUP_GHOST2 = Object.freeze(new Set(['chess_char_5_13']));   // 归溟幽灵鲨
const GROUP_AGLINA = Object.freeze(new Set(['chess_char_5_20']));   // 安洁莉娜
const GROUP_ROSMON = Object.freeze(new Set(['chess_char_6_12']));   // 迷迭香
const GROUP_SWIRE2 = Object.freeze(new Set(['chess_char_3_04']));   // 琳琅诗怀雅

/** 替身 token 的判据：同玩家、`kind === 'token'`、defId / 名字像替身（见文件头 [ASSUMED] 5-2）。 */
const DOLL_RE = /替身|doll|shadow/i;

/**
 * 读一个卡面数字。**不能**用 `hooks.optNumber`：它只接受 `> 0`（0 当未配置），而这里的 `mizukiRegen: 0.04`、
 * `gnosisAtkScale: 0.5` 都是合法的小数。
 * @param {any} spec 卡面参数对象 @param {string} key @param {number} fallback 缺省（设计稿 §4.3 口径）
 * @returns {number}
 */
function numOf(spec, key, fallback) {
  if (!spec || typeof spec !== 'object') return fallback;
  const raw = spec[key];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

/** 「卡片存在 + 包形状对」守卫：没有卡（或 hooks 不是 hexHooks 的返回对象）时是个 no-op。 */
function ownersOfCard(hooks, hexId) {
  if (!hooks || typeof hooks !== 'object') return null;
  const { battle, ownersOf } = hooks;
  if (!battle || typeof battle.on !== 'function' || typeof ownersOf !== 'function') return null;
  const owners = ownersOf(hexId);
  return owners && owners.length ? owners : null;
}

/** 棋子基名（`chess_char_3_21_b` → `chess_char_3_21`），用来对设计稿的分组表。 */
function opKeyOf(u) {
  const id = String(u?.def?.id ?? u?.defId ?? '');
  const base = id || String(u?.def?.baseId ?? '');
  return base.replace(/_[ab]$/, '');
}

/**
 * 这名干员当前装备的**启用的 ISW- 特限模组**，否则 null。
 * 生产链路 `def.module`（shared/loadoutRecord.js）；`def.raw.module` 是同一个对象在原始记录里的位置（simdata
 * normalizeChess 只把记录留在 raw 下），两条都读。
 * @param {any} u an ally unit
 * @returns {any|null}
 */
function iswModuleOf(u) {
  const m = u && u.def ? (u.def.module ?? u.def.raw?.module) : null;
  if (!m || typeof m !== 'object') return null;
  if (m.active !== true) return null;                          // 未启用 / 选了「不装备」
  if (typeof m.type !== 'string' || !m.type.toUpperCase().startsWith(ISW_PREFIX)) return null;
  return m;
}

/**
 * 【特限恢复】hex_mode_modules 的 ISW 特限模组战斗半边。
 * 口径与逐条 [ASSUMED] 见文件头。
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number|{owners:number,carriers:number,ticks:number,extras:number,massApplied:number,refresh:Function}}
 *          0 when the card is absent, else the live handle
 */
export function installModeModulesIsw(hooks) {
  const owners = ownersOfCard(hooks, CARD);
  if (!owners) return 0;
  const { battle, specOf, onField } = hooks;
  const owned = new Set(owners);

  /** 每个拥有者的卡面参数（只读一次；缺席的键用设计稿 §4.3 的兜底，调数只改卡面）。 */
  const plan = new Map();
  for (const pid of owners) {
    const spec = typeof specOf === 'function' ? specOf(pid, CARD, SPEC) : {};
    plan.set(pid, {
      // 空弦：每有一名攻击回复干员 +1 攻击距离，最高 +3
      archetMax: Math.max(0, Math.round(numOf(spec, 'archetMax', 3))),
      // 水月：攻速 +50、每秒回复 4% 最大生命
      mizukiAspd: numOf(spec, 'mizukiAspd', 50),
      mizukiRegen: numOf(spec, 'mizukiRegen', 0.04),
      // 灵知：每 0.5 秒一次，0.5×ATK 法术伤害
      gnosisTickSec: Math.max(0.1, numOf(spec, 'gnosisTickSec', 0.5)),
      gnosisAtkScale: numOf(spec, 'gnosisAtkScale', 0.5),
      // 夕：额外攻击一个目标
      duskTargets: numOf(spec, 'duskTargets', 1),
      // 归溟幽灵鲨：造成 +40%（×1.4）、受到 -40%（×0.6）
      ghostDealtMul: numOf(spec, 'ghostDealtMul', 1.4),
      ghostTakenMul: numOf(spec, 'ghostTakenMul', 0.6),
      // 安洁莉娜：全场敌人重量 -1
      aglinaMass: numOf(spec, 'aglinaMass', 1),
      // 迷迭香：每次攻击额外 1.0×ATK 法术伤害
      rosmonAtkScale: numOf(spec, 'rosmonAtkScale', 1),
      // 琳琅诗怀雅：再部署时间 -30%
      swireRedeployMul: numOf(spec, 'swireRedeployMul', 0.7),
    });
  }

  /** 「在场」：与 hexHooks.onField 同一口径（手搓 hooks 时退回同一条判据）。 */
  const isOnField = typeof onField === 'function' ? onField : (u) => !!u && !!u.alive && !!u.deployed && !u.hidden;
  /** 拥有者的己方**干员**（召唤物 / 队友的干员都不算）。 */
  const isOwnOp = (u, pid = null) => !!u && u.kind === 'op' && u.side === 'ally' && owned.has(u.ownerId) && (pid == null || u.ownerId === pid);
  /** 这名干员是不是「拥有者的干员 + 装了启用的 ISW- 特限模组」。 */
  const isIswCarrier = (u) => isOwnOp(u) && !!iswModuleOf(u);
  /** 这名干员属于设计稿的哪一组（不是那八名 ⇒ false）。 */
  const inGroup = (u, set) => set.has(opKeyOf(u));
  /** 拥有者 pid 的、装着 ISW- 模组、属于某一组的**在场**干员。 */
  const fieldCarriers = (pid, set) => battle.allyUnits.filter((u) => isOwnOp(u, pid) && isOnField(u) && inGroup(u, set) && !!iswModuleOf(u));
  /** 攻击回复技能：引擎把 spType 归一成 'attack' / 'time' / 'hurt' / 'none'（simdata.js normSpType）。 */
  const spTypeOf = (u) => {
    const s = (u && u.skill && u.skill.spType) ?? (u && u.def && u.def.skill && u.def.skill.spType) ?? '';
    return typeof s === 'string' ? s.toLowerCase() : '';
  };
  /** 同玩家、像替身的 token（归溟幽灵鲨的覆盖，见文件头 [ASSUMED] 5-2）。 */
  const isDollToken = (u, pid) => !!u && u.kind === 'token' && u.ownerId === pid && DOLL_RE.test(`${u.defId ?? ''} ${u.name ?? ''}`);

  let ticks = 0;        // 灵知的脉冲次数（诊断 / 测试用）
  let extras = 0;       // 迷迭香的附伤次数
  let massApplied = 0;  // 安洁莉娜的减重补挂次数

  // ===================================================================================================================
  // 空弦 · 攻击回复干员数 → rangeExtend（最高 +3）

  /** 拥有者 pid 当前该给的 rangeExtend：在场的、带攻击回复技能的己方干员数，封顶 archetMax。 */
  const archetExtend = (pid) => {
    const p = plan.get(pid);
    if (!p) return 0;
    let n = 0;
    for (const u of battle.allyUnits) if (isOwnOp(u, pid) && isOnField(u) && spTypeOf(u) === 'attack') n++;
    return Math.min(p.archetMax, n);
  };

  /** 按**当前**人数给拥有者的空弦装 / 改 / 撤 rangeExtend（数值没变就不重建 buff 实例）。 */
  const refreshArchet = (pid) => {
    const p = plan.get(pid);
    if (!p) return;
    const n = archetExtend(pid);
    for (const u of battle.allyUnits) {
      if (!isOwnOp(u, pid) || !inGroup(u, GROUP_ARCHET) || !iswModuleOf(u)) continue;
      const has = typeof u.findBuff === 'function' ? u.findBuff(KEY.archet) : null;
      if (n > 0) {
        if (has && has.mods && has.mods.rangeExtend === n) continue;
        passiveBuff(battle, u, KEY.archet, { rangeExtend: n }, { tags: ['hex'] });
      } else if (has) {
        battle.removeBuff(u, KEY.archet);
      }
    }
  };

  // ===================================================================================================================
  // 水月 / 夕 / 归溟幽灵鲨 / 琳琅诗怀雅 · 常驻面板

  /** 效果组的常驻 mods（空弦按人数重算、灵知是计时脉冲，都不在这里）。 */
  const statMods = (u, p) => {
    if (inGroup(u, GROUP_MIZUKI)) return { aspd: p.mizukiAspd, hpRegenRatio: p.mizukiRegen };
    if (inGroup(u, GROUP_DUSK)) return { maxTargets: p.duskTargets };
    if (inGroup(u, GROUP_GHOST2)) {
      return {
        physDealtMul: p.ghostDealtMul, artsDealtMul: p.ghostDealtMul,
        physTakenMul: p.ghostTakenMul, artsTakenMul: p.ghostTakenMul,
      };
    }
    if (inGroup(u, GROUP_SWIRE2)) return { redeployMul: p.swireRedeployMul };
    return null;
  };

  /** 常驻面板的 buff 键（与效果组一一对应）。 */
  const statKey = (u) => {
    if (inGroup(u, GROUP_MIZUKI)) return KEY.mizuki;
    if (inGroup(u, GROUP_DUSK)) return KEY.dusk;
    if (inGroup(u, GROUP_GHOST2)) return KEY.ghost2;
    if (inGroup(u, GROUP_SWIRE2)) return KEY.swire2;
    return null;
  };

  /**
   * 给一名干员挂它那一组的面板（幂等：`passiveBuff` 同名替换 ⇒ battleStart / deploy / refresh 反复调用安全）。
   * 归溟幽灵鲨的**替身 token** 也在这里补上同一份倍率（她的 tokens 在数据里是空的，替身通常就是本体换形态）。
   */
  const applySelfPassive = (u) => {
    if (!u) return;
    const p = plan.get(u.ownerId);
    if (!p) return;
    if (isIswCarrier(u)) {
      const mods = statMods(u, p);
      const key = statKey(u);
      if (mods && key) passiveBuff(battle, u, key, mods, { tags: ['hex'] });
      return;
    }
    if (isDollToken(u, u.ownerId) && battle.allyUnits.some((o) => isOwnOp(o, u.ownerId) && inGroup(o, GROUP_GHOST2) && !!iswModuleOf(o))) {
      passiveBuff(battle, u, KEY.ghost2, {
        physDealtMul: p.ghostDealtMul, artsDealtMul: p.ghostDealtMul,
        physTakenMul: p.ghostTakenMul, artsTakenMul: p.ghostTakenMul,
      }, { tags: ['hex'] });
    }
  };

  // ===================================================================================================================
  // 安洁莉娜 · 在场时全场敌人 massFlat -1

  /** 安洁莉娜在场时该给敌人的减重量（多拥有者取最重的一份；都不在场 ⇒ 0）。 */
  const massDelta = () => {
    let v = 0;
    for (const pid of owners) {
      if (!fieldCarriers(pid, GROUP_AGLINA).length) continue;
      v = Math.min(v, -Math.abs(plan.get(pid).aglinaMass));
    }
    return v;
  };

  /** 对账：在场的安洁莉娜 ⇒ 每个活敌人都挂上（值变了就换），不在场 ⇒ 全部撤掉。 */
  const refreshMass = () => {
    const v = massDelta();
    for (const e of battle.enemies) {
      if (!e || e.side !== 'enemy') continue;
      const has = typeof e.findBuff === 'function' ? e.findBuff(KEY_MASS) : null;
      if (v === 0) {
        if (has) battle.removeBuff(e, KEY_MASS);
        continue;
      }
      if (!e.alive) continue;
      if (has && has.mods && has.mods.massFlat === v) continue;
      if (has) battle.removeBuff(e, KEY_MASS);
      battle.addBuff(e, { key: KEY_MASS, mods: { massFlat: v }, duration: Infinity, tags: ['hex'] });
      massApplied++;
    }
  };

  // ===================================================================================================================
  // 注册：battleStart / deploy / death / enemySpawn

  /** 全场扫一遍（battleStart / refresh 的入口）：常驻面板 + 空弦那一份 + 安洁莉娜的减重。 */
  const refresh = () => {
    for (const u of battle.allyUnits) applySelfPassive(u);
    for (const pid of owners) refreshArchet(pid);
    refreshMass();
  };

  battle.on('battleStart', () => refresh(), { priority: -10 });

  battle.on('deploy', (c) => {
    const u = c && c.unit;
    if (!u || u.side !== 'ally' || !owned.has(u.ownerId)) return;
    applySelfPassive(u);
    refreshArchet(u.ownerId);
    refreshMass();
  });

  // 「在场」掉回去时把空弦那一份收回来（设计稿只写了 battleStart / deploy，见文件头 [ASSUMED] 1-3）
  battle.on('death', (c) => {
    const u = c && c.unit;
    if (!u || !owned.has(u.ownerId)) return;
    refreshArchet(u.ownerId);
  });

  // 新刷出来的敌人也要减重（安洁莉娜在不在场由 refreshMass 自己判）
  battle.on('enemySpawn', () => refreshMass());

  // ===================================================================================================================
  // 灵知 · 带寒冷 / 冻结的敌人每 0.5s 吃 0.5×ATK 法术伤害

  for (const pid of owners) {
    const p = plan.get(pid);
    battle.every(p.gnosisTickSec, () => {
      const gs = fieldCarriers(pid, GROUP_GNOSIS);
      if (!gs.length) return;
      for (const e of battle.enemies) {
        if (!e || e.side !== 'enemy' || !e.alive) continue;
        const cold = typeof e.findBuff === 'function' && !!(e.findBuff('cold') || e.findBuff('freeze'));
        if (!cold) continue;
        for (const g of gs) {
          const amount = g.s.atk * p.gnosisAtkScale;
          if (!(amount > 0)) continue;
          ticks++;
          battle.dealDamage(g, e, makeDamageInfo({
            amount, type: 'arts', isSkill: true, canDodge: false, tags: ['hex', TAG, 'isw'],
          }));
        }
      }
    });
  }

  // 安洁莉娜的对账（她阵亡 / 撤退、以及迟到的敌人都在这里补上；battleStart / deploy / enemySpawn 之外的那一道）
  battle.every(0.5, () => refreshMass());

  // ===================================================================================================================
  // 迷迭香 · 每次攻击额外造成 1.0×ATK 法术伤害

  battle.on('hit', (c) => {
    const dmg = c && c.dmg;
    if (!dmg || dmg.cancel) return;
    if (dmg.hexModeRosmon) return;                 // 本卡自己的附伤不再触发本卡（双保险：引擎还会盖 chained）
    if (!dmg.isAttack) return;                     // 「攻击」：普攻 / 技能覆盖的那一次攻击
    if (dmg.type === 'element') return;            // 元素损伤不是伤害
    if (isHpLoss(dmg) || isRetaliation(dmg) || isChained(dmg)) return;
    const src = c.source;
    if (!isIswCarrier(src) || !inGroup(src, GROUP_ROSMON)) return;
    if (!isOnField(src)) return;
    const p = plan.get(src.ownerId);
    if (!p) return;
    const tgt = c.target;
    if (!tgt || tgt.side !== 'enemy' || !tgt.alive) return;
    const amount = src.s.atk * p.rosmonAtkScale;
    if (!(amount > 0)) return;
    const info = makeDamageInfo({ amount, type: 'arts', isSkill: true, canDodge: false, tags: ['hex', TAG, 'isw'] });
    info.hexModeRosmon = true;
    extras++;
    battle.dealDamage(src, tgt, info);
  });

  return {
    get owners() { return owners.length; },
    /** 当前带着启用的 ISW- 特限模组的、拥有者自己的干员数。 */
    get carriers() { return battle.allyUnits.filter((u) => isIswCarrier(u)).length; },
    get ticks() { return ticks; },
    get extras() { return extras; },
    get massApplied() { return massApplied; },
    refresh,
  };
}
