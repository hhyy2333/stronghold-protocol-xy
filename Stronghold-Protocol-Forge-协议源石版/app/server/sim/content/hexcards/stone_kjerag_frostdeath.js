// server/sim/content/hexcards/stone_kjerag_frostdeath.js — 第二十一批（业主 2026-10-31，2026-11-01 改口径）：
// 谢拉格 ·【困毙之雪】(hex_kjerag_frostdeath, 2 阶 / gold / requiresBond: kjeragShip) 的战斗半边。
//
// 设计稿：04-文档/协议源石-专属协议-困毙之雪-设计稿-20261031.md（§1 业主原文、§8 2026-11-01 改版口径）。
//
// 业主 2026-11-01 改版原文（逐字）：
//   「修改困毙之雪寒霜上限变到10层，3人口效果改为敌人被冻结时给所有谢拉格干员一层寒霜，冰封干员周围8格敌人每秒受到真伤，
//    若敌人被该真伤杀死则使谢拉格层数+1，六人口就改为谢拉格干员死亡移出4层寒霜，真伤持续时间改为5s，
//    被该真伤杀死的怪给谢拉格层数+2」
//
// —— 改版后的完整卡面（卡面 desc 与这里逐句对应）：
//   基础：每层霜寒使防御力 +5%、攻击速度 −5；所有【谢拉格】干员每 5 秒获得 1 层霜寒。
//         霜寒达到 10 层时消耗全部霜寒进入「冰封」5 秒：无法攻击、无法使用技能、无法被治疗，但阻挡数 +1 且免疫所有伤害。
//   <在场3名不同【谢拉格】干员>
//         · 敌人被冻结时，所有【谢拉格】干员获得 1 层霜寒；
//         · 冰封干员周围八格内的敌人每秒受到 100 点真实伤害（随【谢拉格】层数每层 +40），
//           被该真实伤害杀死的敌人使【谢拉格】层数 +1。
//   <在场6名不同【谢拉格】干员>
//         · 【谢拉格】干员死亡时，冻结全场敌人 5 秒，并为全体【谢拉格】干员移除 4 层霜寒；
//         · 若场上所有【谢拉格】干员同时处于冰封状态，则对所有敌人每秒造成 100 点真实伤害
//           （随【谢拉格】层数每层 +50）并施加寒冷，持续 5 秒，被该真实伤害杀死的敌人使【谢拉格】层数 +2。
//
// 2026-11-01 改版**删掉**的旧口径（旧代码在本文件的历史版本里，设计稿 §7 有记录）：
//   * 3 名档的「每有 1 层霜寒，攻击时有 30% 概率施加寒冷」（冷概率不再由本卡提供）；
//   * 3 名档的「敌人冻结结束时未被击杀 ⇒ 该敌人半径 1.5 内【谢拉格】干员 +1 层」（解冻回层）；
//   * 基础效果里「冻结敌人时**该干员** +1 层」（受益者改成**全体**，并归到 3 名档那一条）；
//   * 3 名档的「冰封干员**阻挡的**敌人」真伤（范围改成**周围八格**，并新增击杀返层）；
//   * 6 名档真伤窗口 15 秒（改成 5 秒）与移除 2 层霜寒（改成 4 层）。
//
// 口径（逐条对应下面实现里的注释；数值全部读卡面 `params.kjeragFrostDeath`，调数不改代码）：
//   * **作用域**：拥有该卡的玩家自己的【谢拉格】干员 —— `u.kind === 'op' && u.side === 'ally'`、
//     `u.ownerId` ∈ 拥有者、`isMember(battle, u, 'kjeragShip')`（与盟约内容同一处判据）。
//   * **「在场」**：`hexHooks.onField` = `alive && deployed && !hidden`。
//   * **N（不同干员数）**：场上己方【谢拉格】干员按 `baseChessId` 去重（普通 / 精锐只算一个），每处触发时现算。
//     N < `unlockCount` 时 3 名档**完全不解锁**：冻结不给层、冰封没有八格真伤。
//   * **霜寒**：`refresh: 'stack'` 的 buff（键 `hex:kjeragfrost:frost`，`maxStacks = frostMax` = 10），
//     `mods: { defPct: defPctPerStack/100, aspd: -aspdPerStack }`；引擎的加算 mod 按 `stacks` 乘值
//     （buffs.js aggregateMods：`add[k] += v * stacks`）⇒ 10 层 = 防御 +50%、攻速 −50。
//   * **获得霜寒**（该干员不在冰封中）：
//     ① **基础效果**（业主 2026-11-01 拍板，**完全无条件**）：`battle.every(idleFrostSec)` 每 5 秒让所有己方在场
//        【谢拉格】干员 +1 层 —— 不看在场人数（N < 3 也叠）、也不看有没有敌人被冻结，走
//        `gainFrost(u, 1, { ignoreUnlock: true })` 旁路 3 名档的总闸。
//     ② **3 名档**（N ≥ unlockCount）：`statusApplied` 钩子里，只要有敌人**被冻结**（`entered === true`），
//        就给**所有**己方在场【谢拉格】干员各 +1 层 —— 与冻结的来源无关（队友干员冻的、敌人自己冻的、被寒冷成对
//        冻上的都算，业主 2026-11-01 的「敌人被冻结时」）。
//   * **冰封**：霜寒叠到 `frostMax`（10）层 ⇒ 移除霜寒 buff（消耗清零）、挂 `hex:kjeragfrost:seal`，持续 `sealSec`：
//     `flags: { disarm, silence, noHeal, healFree, invulnerable }`、`mods: { blockCnt: 1 }`。冰封期间不再获得霜寒；
//     seal 靠 buff 自己的时长结束，结束后从 0 重新叠。
//   * **3 名档 · 冰封干员周围八格真伤**：`battle.every(1)`，对每个带 seal 的己方【谢拉格】干员，取它所在格，
//     **切比雪夫距离 ≤ `sealedAuraRadius`（默认 1 = 周围八格，与【惊惧】/【泰拉在上】同一口径）** 内所有活着的敌人
//     每秒受到 `sealedAuraDmg + sealedAuraDmgPerLayer × L` 真实伤害（来源 = 该干员，tags 标 `hex`）。
//     敌人**被这一发**杀死（打之前活着、打之后倒下）⇒ `battle.addLayers(pid, 'kjeragShip', sealedAuraKillLayers)`。
//   * **6 名档 · 死亡**：`death` 钩子，`c.unit` 是己方【谢拉格】干员且 `c.reason === 'killed'` ⇒
//     对全场活着的敌人 `applyStatus('freeze', { duration: deathFreezeSec })`；对全体己方在场【谢拉格】干员移除
//     `deathRemoveStacks`（4）层霜寒。档位判定把**刚阵亡的那名干员**算进去（否则「第 6 名倒下」永远触发不了）。
//   * **6 名档 · 全冰封（真伤窗口）**：一旦「场上所有己方【谢拉格】干员同时处于冰封状态」成立（且 N ≥ highCount），
//     就开一个**固定 `allSealedSec`（5）秒**的窗口：窗口内每秒对全场敌人造成
//     `allSealedDmg + allSealedDmgPerLayer × L` 真实伤害并 `applyStatus('cold', { duration: allSealedColdSec })`；
//     敌人**被这一发**杀死 ⇒ `battle.addLayers(pid, 'kjeragShip', allSealedKillLayers)`（+2）。
//     窗口是**闩**：期间不重启、不叠加；持续时间按绝对截止时刻算（`battle.time + allSealedSec`），不数拍数。
//
// [ASSUMED]（卡面没写死、实现时定下的口径）：
//   1. 「无法被治疗」= `noHeal + healFree`；「冰封」不是晕眩，仍然阻挡（不加 `stun`）。
//   2. 本卡自己打出的真伤带 tag `hex:kjeragfrost`（便于日志 / 排查分辨来源；改版后本卡不再施加寒冷，
//      所以这个 tag 不再有「别用自己的真伤给自己喂寒冷」的用途）。
//   3. 「周围八格」= 切比雪夫距离 ≤ 1 的格心判定（干员用 `tileR/tileC`，敌人用 `round(x/y)`），
//      与 batch16 的【惊惧】、batch10 的【泰拉在上】同一口径；`sealedAuraRadius` 可调。
//   4. 多名冰封干员的八格范围**会重叠**：每个冰封干员各打自己的一发（同一名敌人站在两个冰封干员中间 ⇒ 每秒挨两发）。
//   5. 击杀返层按**敌人条数**结算（一发真伤同时打死 3 名敌人 ⇒ +3 层；6 名档 ⇒ +6 层），
//      且只认「这一发打之前活着、打之后倒下」——被别的伤害抢先打死的敌人不返层。
//   6. 返层走 `battle.addLayers(pid, 'kjeragShip', n, 'hex', { source })`：联防 / 首领 / 隐藏场
//      （`flags.layerGainsEnabled === false`）里引擎自己会拒绝，本卡不必另判。
//   7. 6 名档的真伤窗口**不延长、不刷新**：窗口期间再有干员进入冰封不会重启计时；窗口结束后才能再次触发。
//   8. 窗口的 5 秒与「全员冰封」状态**解耦**：冰封（`sealSec` 5 秒）结束后真伤照打 —— 卡面写的是「持续 5 秒」。
//   9. 全冰封脉冲的真伤 / 寒冷来源每一拍现取（优先冰封中的那名；都不冰封了就用场上第一名）——
//      触发那一刻的干员之后死了 / 撤退了，真伤也不会哑。
//  10. 6 名档的「死亡冻结全场」本身也是一次「敌人被冻结」⇒ 会先触发 3 名档的「全体 +1 层」，**然后**才移除 4 层
//      （卡面顺序：先冻结、后移除）。所以净变化 = 新被冻上的敌人数 − 4：场上原本就有没被冻过的敌人时，
//      这次死亡实际只掉 3 层。业主 2026-11-01 没点这一条，按字面口径实现；要求「净 −4」就把 `death` 钩子里的
//      `loseFrost` 挪到冻结循环之前。
//
// 确定性：没有 Math.random / Date / Node API；随机走 `battle.rng()`（改版后本卡不再掷骰）；计时只用
// `battle.every` / `battle.after`。
//
// CONTRACT: export function installKjeragFrostDeath(hooks) — hooks is the shared `hexHooks(battle)` bundle
// (server/sim/content/hexcards/hooks.js). Returns 0 when the card is absent, else a count of covered operators.
// Install only REGISTERS hooks: no battle state changes at install time.

import { isMember, baseChessId, bondLayers } from '../support/index.js';
import { makeDamageInfo } from '../../damage.js';

/** 卡 id（模块自己的查表键）。 */
const CARD = 'hex_kjerag_frostdeath';
/** 卡面 effect 里那段参数的名字。 */
const SPEC = 'kjeragFrostDeath';
/** 【谢拉格】核心盟约 id（成员资格 / 层数都读它）。 */
const BOND = 'kjeragShip';
/** 霜寒 buff 键（`stacks` = 层数；冰封时整个移除）。 */
const FROST_KEY = 'hex:kjeragfrost:frost';
/** 冰封 buff 键（按 buff 自己的时长结束）。 */
const SEAL_KEY = 'hex:kjeragfrost:seal';
/** 本卡自己打出的真伤带的 tag（见 [ASSUMED] 2）。 */
const SELF_TAG = 'hex:kjeragfrost';

/**
 * 设计稿 §8 的兜底值：只在卡面缺这一格时用。数值一律以卡面为准，这里只为「记录比模块旧」的战斗兜底。
 */
const FALLBACK = Object.freeze({
  // 基础
  unlockCount: 3, frostMax: 10, defPctPerStack: 5, aspdPerStack: 5, sealSec: 5, idleFrostSec: 5,
  // 3 名档
  sealedAuraDmg: 100, sealedAuraDmgPerLayer: 40, sealedAuraRadius: 1, sealedAuraKillLayers: 1,
  // 6 名档
  highCount: 6, deathFreezeSec: 5, deathRemoveStacks: 4,
  allSealedDmg: 100, allSealedDmgPerLayer: 50, allSealedSec: 5, allSealedColdSec: 5, allSealedKillLayers: 2,
});

/**
 * 读一个卡面数字。**不能**用 `hooks.optNumber`：它只接受 `> 0`（0 当未配置），而这张卡的参数里有 0 是合法口径的
 * 格子（「击杀返 0 层」），`aspdPerStack` 的符号还要自己决定（卡面写正数 5 = 攻速 −5）。
 * @param {any} spec 卡面参数对象 @param {string} key @param {number} fallback 缺省（设计稿口径）
 * @returns {number}
 */
function numOf(spec, key, fallback) {
  if (!spec || typeof spec !== 'object') return fallback;
  const raw = spec[key];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

/** 正整数（人数阈值 / 层数 / 秒数），非法值退回兜底。 */
const countOf = (spec, key, fallback, min = 1) => Math.max(min, Math.round(numOf(spec, key, fallback)));

/** 「卡片存在 + 包形状对」守卫：没有卡（或 hooks 不是 hexHooks 的返回对象）时是个 no-op。 */
function ownersOfCard(hooks, hexId) {
  if (!hooks || typeof hooks !== 'object') return null;
  const { battle, ownersOf } = hooks;
  if (!battle || typeof battle.on !== 'function' || typeof ownersOf !== 'function') return null;
  const owners = ownersOf(hexId);
  return owners && owners.length ? owners : null;
}

/**
 * 【困毙之雪】hex_kjerag_frostdeath（2 阶 / gold，requiresBond: kjeragShip）的战斗半边。
 * 口径与逐条 [ASSUMED] 见文件头；卡面参数见设计稿 §2 / §8。
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number} 没有这张卡 ⇒ 0；有卡 ⇒ 被这张卡覆盖的己方【谢拉格】干员数（安装时的名册，含未部署的）
 */
export function installKjeragFrostDeath(hooks) {
  const owners = ownersOfCard(hooks, CARD);
  if (!owners) return 0;
  const { battle, specOf } = hooks;
  const owned = new Set(owners);
  /** 在场：沿用 hexHooks.onField 的口径（alive && deployed && !hidden）。 */
  const onField = typeof hooks.onField === 'function'
    ? hooks.onField
    : (u) => !!u && !!u.alive && !!u.deployed && !u.hidden;

  /** ownerId → 这张卡的参数（只读一次；数值都是设计稿的兜底，调数只改卡面）。 */
  const plan = new Map();
  for (const pid of owners) {
    const spec = typeof specOf === 'function' ? specOf(pid, CARD, SPEC) : {};
    plan.set(pid, {
      // 基础
      unlockCount: countOf(spec, 'unlockCount', FALLBACK.unlockCount),
      frostMax: countOf(spec, 'frostMax', FALLBACK.frostMax),
      defPct: numOf(spec, 'defPctPerStack', FALLBACK.defPctPerStack) / 100,
      aspd: -numOf(spec, 'aspdPerStack', FALLBACK.aspdPerStack),
      sealSec: Math.max(0, numOf(spec, 'sealSec', FALLBACK.sealSec)),
      idleFrostSec: Math.max(0.05, numOf(spec, 'idleFrostSec', FALLBACK.idleFrostSec)),
      // 3 名档 · 冰封干员周围八格真伤
      sealedAuraDmg: numOf(spec, 'sealedAuraDmg', FALLBACK.sealedAuraDmg),
      sealedAuraDmgPerLayer: numOf(spec, 'sealedAuraDmgPerLayer', FALLBACK.sealedAuraDmgPerLayer),
      sealedAuraRadius: Math.max(0, Math.round(numOf(spec, 'sealedAuraRadius', FALLBACK.sealedAuraRadius))),
      sealedAuraKillLayers: countOf(spec, 'sealedAuraKillLayers', FALLBACK.sealedAuraKillLayers, 0),
      // 6 名档
      highCount: countOf(spec, 'highCount', FALLBACK.highCount),
      deathFreezeSec: Math.max(0, numOf(spec, 'deathFreezeSec', FALLBACK.deathFreezeSec)),
      deathRemoveStacks: countOf(spec, 'deathRemoveStacks', FALLBACK.deathRemoveStacks, 0),
      allSealedDmg: numOf(spec, 'allSealedDmg', FALLBACK.allSealedDmg),
      allSealedDmgPerLayer: numOf(spec, 'allSealedDmgPerLayer', FALLBACK.allSealedDmgPerLayer),
      allSealedSec: countOf(spec, 'allSealedSec', FALLBACK.allSealedSec),
      allSealedColdSec: Math.max(0, numOf(spec, 'allSealedColdSec', FALLBACK.allSealedColdSec)),
      allSealedKillLayers: countOf(spec, 'allSealedKillLayers', FALLBACK.allSealedKillLayers, 0),
    });
  }

  /** 拥有者的己方【谢拉格】干员（召唤物 / 队友的干员都不算）。 */
  const isKjeragOp = (u) => !!u && u.kind === 'op' && u.side === 'ally' && owned.has(u.ownerId) && isMember(battle, u, BOND);
  /** 拥有者 pid 的在场【谢拉格】干员。 */
  const opsOnField = (pid) => battle.allyUnits.filter((u) => u && u.ownerId === pid && isKjeragOp(u) && onField(u));
  /**
   * N：场上己方【谢拉格】干员按 `baseChessId` 去重的「不同干员数」。
   * `extra` = 额外算一名（死亡的档位判定要把刚倒下的那名干员算进去，见文件头）。
   */
  const distinctCount = (pid, extra = null) => {
    const seen = new Set();
    // 刚阵亡的那名干员一般还躺在 `allyUnits` 里（干员阵亡不移除，等重部署）；万一哪天不是了，也把它补进来
    const list = extra && !battle.allyUnits.includes(extra) ? battle.allyUnits.concat([extra]) : battle.allyUnits;
    for (const u of list) {
      if (!u || u.ownerId !== pid || !isKjeragOp(u)) continue;
      if (!onField(u) && u !== extra) continue;
      const base = baseChessId(u);
      if (base) seen.add(base);
    }
    return seen.size;
  };
  /** 3 名档是否已解锁（N ≥ unlockCount）。 */
  const unlocked = (pid) => {
    const p = plan.get(pid);
    return !!p && distinctCount(pid) >= p.unlockCount;
  };
  /** 实时【谢拉格】层数（L）。 */
  const layersOf = (pid) => bondLayers(battle, pid, BOND);
  /** 该干员此刻是否处于冰封。 */
  const isSealed = (u) => !!(u && typeof u.findBuff === 'function' && u.findBuff(SEAL_KEY));
  /** 单位所在格（干员有 `tileR/tileC`；敌人 / 召唤物可能只有坐标）。 */
  const cellOf = (u) => [
    Number.isFinite(u.tileR) ? u.tileR : Math.round(u.y),
    Number.isFinite(u.tileC) ? u.tileC : Math.round(u.x),
  ];

  /**
   * 进入冰封：消耗全部霜寒（移除 buff ⇒ 清零）并挂 seal（时长到点由引擎自己摘掉）。
   * @param {any} u 干员 @param {any} p 该拥有者的卡面参数
   */
  const seal = (u, p) => {
    battle.removeBuff(u, FROST_KEY);
    battle.addBuff(u, {
      key: SEAL_KEY,
      duration: p.sealSec,
      refresh: 'replace',
      tags: ['hex', SEAL_KEY],
      // 「无法攻击、无法使用技能、无法被治疗，但阻挡数 +1 且免疫所有伤害」
      flags: { disarm: true, silence: true, noHeal: true, healFree: true, invulnerable: true },
      mods: { blockCnt: 1 },
    });
    // 事件驱动的 6 名档判定（业主 2026-11-01）：进入冰封的**这一刻**就检查「全员冰封」，不再等 0.25 秒轮询
    // —— 全员重叠的窗口可能短于轮询间隔（实测 0.1 秒的窗口会整段漏掉，真伤根本不触发）。
    maybeStartPulse(u.ownerId);
  };

  /**
   * 给一名干员加 `n` 层霜寒（叠满即进入冰封）。
   * @param {any} u 干员 @param {number} n 层数
   * @param {{ignoreUnlock?: boolean}} [opts] `ignoreUnlock` = 基础效果旁路 3 名档总闸
   * @returns {number} 加完之后剩下的层数（冰封 / 未解锁 / 不在场时 0）
   */
  const gainFrost = (u, n = 1, { ignoreUnlock = false } = {}) => {
    const pid = u && u.ownerId;
    const p = pid ? plan.get(pid) : null;
    if (!p || !isKjeragOp(u) || !onField(u)) return 0;
    if (!ignoreUnlock && !unlocked(pid)) return 0;      // N < 3：3 名档来源不解锁（基础效果走 ignoreUnlock 旁路）
    if (isSealed(u)) return 0;                          // 冰封期间不再获得霜寒
    for (let i = 0; i < n; i++) {
      battle.addBuff(u, {
        key: FROST_KEY,
        duration: Infinity,                             // 霜寒没有时长：只有冰封会把它清掉
        refresh: 'stack',
        stacks: 1,
        maxStacks: p.frostMax,
        mods: { defPct: p.defPct, aspd: p.aspd },
        tags: ['hex', FROST_KEY],
      });
    }
    const b = typeof u.findBuff === 'function' ? u.findBuff(FROST_KEY) : null;
    if (!b) return 0;
    if (b.stacks >= p.frostMax) {                       // 叠满 ⇒ 消耗全部霜寒进入冰封
      seal(u, p);
      return 0;
    }
    return b.stacks;
  };

  /**
   * 移除 `n` 层霜寒（≤ 0 就整个摘掉）。
   * @returns {number} 剩余层数
   */
  const loseFrost = (u, n) => {
    if (!(n > 0) || !u || typeof u.findBuff !== 'function') return 0;
    const b = u.findBuff(FROST_KEY);
    if (!b) return 0;
    b.stacks -= n;
    if (b.stacks <= 0) { battle.removeBuff(u, FROST_KEY); return 0; }
    u.markDirty();
    return b.stacks;
  };

  /** 本卡自己打出的一段真实伤害（tags 标 hex；见 [ASSUMED] 2）。 */
  const trueDamage = (src, tgt, amount) => {
    if (!src || !tgt || !tgt.alive || !(amount > 0)) return 0;
    return battle.dealDamage(src, tgt, makeDamageInfo({ amount, type: 'true', canDodge: false, tags: ['hex', SELF_TAG] }));
  };

  /**
   * 本卡的一发真伤 + 「被这一发杀死就返层」：打之前活着、打之后倒下才算（[ASSUMED] 5）。
   * @returns {boolean} 这一发是否真的打死了它
   */
  const trueDamageWithReward = (pid, src, tgt, amount, layers) => {
    if (!tgt || !tgt.alive) return false;
    const wasAlive = tgt.alive;
    trueDamage(src, tgt, amount);
    const killed = wasAlive && !tgt.alive;
    if (killed && layers > 0) battle.addLayers(pid, BOND, layers, 'hex', { source: src });
    return killed;
  };

  // ===================================================================================================================
  // 3 名档 · ① 敌人被冻结 ⇒ 所有己方【谢拉格】干员 +1 层霜寒

  battle.on('statusApplied', (c) => {
    if (!c || c.status !== 'freeze' || c.entered !== true) return;   // 「被冻结」= 这一次真的挂上了冻结
    const tgt = c.target;
    if (!tgt || tgt.side !== 'enemy') return;
    // 业主 2026-11-01：「敌人被冻结时给**所有**谢拉格干员一层寒霜」—— 不看冻结的来源（队友干员冻的、
    // 敌人自己冻的、被寒冷成对冻上的都算）。
    for (const pid of owners) {
      if (!plan.get(pid) || !unlocked(pid)) continue;                 // 3 名档才解锁
      for (const u of opsOnField(pid)) gainFrost(u, 1);
    }
  });

  // ===================================================================================================================
  // **基础效果** · 每 idleFrostSec 秒所有己方【谢拉格】干员 +1 层霜寒（完全无条件）

  for (const pid of owners) {
    const p = plan.get(pid);
    if (!p) continue;
    battle.every(p.idleFrostSec, () => {
      // 不看在场人数（0 名时场上没人可叠，自然什么都不发生）、不看有没有敌人被冻结
      for (const u of opsOnField(pid)) gainFrost(u, 1, { ignoreUnlock: true });
    });
  }

  // ===================================================================================================================
  // 3 名档 · ② 冰封干员周围八格内的敌人每秒受到 sealedAuraDmg + sealedAuraDmgPerLayer × L 真实伤害，
  //                被这一发杀死的敌人 ⇒【谢拉格】层数 +sealedAuraKillLayers

  for (const pid of owners) {
    battle.every(1, () => {
      const p = plan.get(pid);
      if (!p) return;
      // 3 名档效果：基础效果让冰封在 N < 3 也能发生，所以这道闸必须显式写出来（卡面把它列在 <在场3名> 里）
      if (!unlocked(pid)) return;
      const amount = p.sealedAuraDmg + p.sealedAuraDmgPerLayer * layersOf(pid);
      if (!(amount > 0)) return;
      const r = p.sealedAuraRadius;
      for (const u of opsOnField(pid)) {
        if (!isSealed(u)) continue;
        const [ur, uc] = cellOf(u);
        for (const e of battle.enemies.slice()) {
          if (!e || !e.alive) continue;
          const [er, ec] = cellOf(e);
          if (Math.max(Math.abs(er - ur), Math.abs(ec - uc)) > r) continue;   // 周围八格（切比雪夫，[ASSUMED] 3）
          trueDamageWithReward(pid, u, e, amount, p.sealedAuraKillLayers);
        }
      }
    });
  }

  // ===================================================================================================================
  // 6 名档 · 谢拉格干员死亡：冻结全场敌人 deathFreezeSec 秒 + 全体移除 deathRemoveStacks 层霜寒

  battle.on('death', (c) => {
    const u = c && c.unit;
    if (!u || !isKjeragOp(u)) return;
    if (c.reason !== 'killed') return;                   // 撤退 / 到期不是「死亡」
    const pid = u.ownerId;
    const p = plan.get(pid);
    if (!p) return;
    if (distinctCount(pid, u) < p.highCount) return;     // 6 名档未达成（把刚倒下的这名算进去）
    // 顺序照卡面：先冻结全场（这一发冻结会触发 3 名档的「全体 +1 层」，见 [ASSUMED] 10），再移除 4 层
    for (const e of battle.enemies) {
      if (e && e.alive) battle.applyStatus(e, 'freeze', { duration: p.deathFreezeSec, source: u });
    }
    for (const a of opsOnField(pid)) loseFrost(a, p.deathRemoveStacks);
  });

  // ===================================================================================================================
  // 6 名档 · 全冰封 ⇒ allSealedSec（5）秒的真伤窗口（真实伤害 + 寒冷 + 击杀返层）
  //
  // 触发是**事件驱动**（`seal()` 末尾调用 `maybeStartPulse`，不只靠 0.25 秒轮询采样）；持续时间是**绝对截止时刻**
  // （触发时刻 + allSealedSec），不数拍数；来源每一拍现取。

  /** pid → 本次窗口的绝对截止时刻（battle time）。有键 = 窗口正在跑（闩：期间不重启、不叠加）。 */
  const pulseUntil = new Map();

  /** 全场敌人吃一拍：allSealedDmg + allSealedDmgPerLayer × L 真实伤害 + 寒冷 + 击杀返层。 */
  const pulseBeat = (pid, p) => {
    const ops = opsOnField(pid);
    // 来源每一拍现取（优先冰封中的那名）：触发那一刻的干员之后死了 / 撤退了，真伤也不会哑
    const src = ops.find((u) => isSealed(u)) ?? ops[0] ?? null;
    const amount = p.allSealedDmg + p.allSealedDmgPerLayer * layersOf(pid);
    for (const e of battle.enemies.slice()) {
      if (!e || !e.alive) continue;
      if (amount > 0) trueDamageWithReward(pid, src, e, amount, p.allSealedKillLayers);
      if (e.alive) battle.applyStatus(e, 'cold', { duration: p.allSealedColdSec, source: src });
    }
  };

  /**
   * 开一个 allSealedSec 秒的窗口（幂等：已经在跑就什么都不做）。
   * 持续时间是**绝对截止时刻**，与冰封是否还在、人数是否还够、来源是否还活着都无关。
   * @param {string} pid @param {any} p
   * @returns {boolean} 这次是否真的开了新窗口
   */
  const startPulse = (pid, p) => {
    if (pulseUntil.has(pid)) return false;                 // 闩：窗口期间不重启
    const until = battle.time + p.allSealedSec;
    pulseUntil.set(pid, until);
    let closed = false;
    const close = () => { if (!closed) { closed = true; pulseUntil.delete(pid); } };
    const s = battle.every(1, () => {
      if (closed) { s.cancel(); return; }
      pulseBeat(pid, p);
      if (battle.time + 1e-9 >= until) { close(); s.cancel(); }   // 窗口的最后一拍
    });
    // 兜底收尾：最后一拍万一没落地（拍被吞 / 调度被清），到点也补一拍并关窗 ——「固定跑满」不靠运气
    battle.after(p.allSealedSec, () => {
      if (closed) return;
      pulseBeat(pid, p);
      close();
      s.cancel();
    });
    return true;
  };

  /** 「场上所有己方【谢拉格】干员同时处于冰封状态」且 N ≥ highCount。 */
  const allSealedNow = (pid) => {
    const p = plan.get(pid);
    if (!p) return false;
    const ops = opsOnField(pid);
    if (!ops.length) return false;                          // 至少 1 名己方【谢拉格】干员
    if (distinctCount(pid) < p.highCount) return false;     // 6 名档
    return ops.every((u) => isSealed(u));                   // 且**全部**处于冰封
  };

  /**
   * 判定一次。主路径是 `seal()` 里的事件驱动调用（进入冰封的那一刻），所以全冰封的窗口再短也不会漏。
   * @param {string} pid
   * @returns {boolean} 这次是否开了新窗口
   */
  const maybeStartPulse = (pid) => {
    const p = plan.get(pid);
    if (!p || pulseUntil.has(pid)) return false;
    if (!allSealedNow(pid)) return false;
    return startPulse(pid, p);
  };

  // 0.25 秒轮询只是**兜底**（「有人刚进入冰封」那条主路径已经在 `seal()` 里事件驱动覆盖了）：例如装机时
  // 场上已经有人带着 seal，或者 seal 是被别的来源挂上的。
  for (const pid of owners) {
    battle.every(0.25, () => { maybeStartPulse(pid); });
  }

  // 安装时的覆盖面（名册里的己方【谢拉格】干员数）：0 只在「没有这张卡」或「一个谢拉格干员都没有」时出现。
  let covered = 0;
  for (const u of battle.allyUnits) if (isKjeragOp(u)) covered++;
  return covered;
}
