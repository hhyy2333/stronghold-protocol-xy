// server/sim/content/hexcards/stone_kjerag_frostdeath.js — 第二十一批（业主 2026-10-31）：谢拉格 ·【困毙之雪】
// (hex_kjerag_frostdeath, 2 阶 / gold / requiresBond: kjeragShip) 的战斗半边。
//
// 设计稿：04-文档/协议源石-专属协议-困毙之雪-设计稿-20261031.md §1。
// 业主原文（逐字）：
//   谢拉格盟约效果：「困毙之雪」
//   〖谢拉格〗干员冻结敌人时，获得1层霜寒。每层霜寒：防御力+5%，但攻击速度-5。
//   霜寒达到5层时，干员进入 「冰封」：无法攻击、无法使用技能、无法被治疗，但阻挡数+1且免疫所有伤害。持续5s
//   <在场3名不同〖谢拉格〗干员>——变革的残响
//   解锁霜寒机制。
//   每有1层霜寒，攻击时有30%概率施加寒冷。
//   敌人冻结结束时未被击杀，则该敌人周围所有〖谢拉格〗干员获得1层霜寒。
//   若场上没有任何敌人处于冻结状态，所有〖谢拉格〗干员每5秒累积1层霜寒。
//   冰封干员阻挡的敌人每秒受到100点真实伤害（每层+40）
//   <在场6名不同〖谢拉格〗干员>——困毙之雪
//   〖谢拉格〗干员死亡时，冻结全场敌人5秒，并为全体〖谢拉格〗干员移除2层霜寒。
//   若场上所有〖谢拉格〗干员同时处于冰封状态，则对所有敌人每秒造成100（随层数+50）的真实伤害并施加寒冷，持续15秒
//
// 数值全部读卡面 `params.kjeragFrostDeath`（tools/hextech/roster.mjs），这里只写行为 —— 调数不改代码。
//
// 口径（设计稿 §3，逐条对应下面的实现注释）：
//   * **作用域**：拥有该卡的玩家自己的【谢拉格】干员 —— `u.kind === 'op' && u.side === 'ally'`、
//     `u.ownerId` ∈ 拥有者、`isMember(battle, u, 'kjeragShip')`（support/index.js：数据 bonds ∪ 装备 / 特质授予 ∪
//     盟约共鸣借来的，与盟约内容同一处判据）。多玩家场上别人的干员一律不算。
//   * **「在场」**：`hexHooks.onField` = `alive && deployed && !hidden`（设计稿 §3 点名这一口径）。
//   * **N（不同干员数）**：场上己方【谢拉格】干员按 `baseChessId` 去重（`_b` 归一到 `_a`）——「在场 3 名 / 6 名
//     不同干员」里同名干员的普通 / 精锐只算一个。N 每处触发时现算（后部署的干员立刻计入）。
//     N < `unlockCount` 时**完全不解锁**：不叠霜寒、不触发冰封、攻击不施寒冷。
//   * **霜寒**：一个 `refresh: 'stack'` 的 buff（键 `hex:kjeragfrost:frost`，`maxStacks = frostMax`），
//     `mods: { defPct: defPctPerStack/100, aspd: -aspdPerStack }`。引擎的加算 mod 按 `stacks` 乘值
//     （buffs.js aggregateMods：`add[k] += v * stacks`）⇒ 5 层 = 防御 +25%、攻速 −25。`stacks` 就是霜寒层数。
//   * **获得霜寒**（该干员不在冰封中）的来源：
//     ① **基础效果**（业主 2026-11-01 拍板，**完全无条件**）：`battle.every(idleFrostSec)` 每 5 秒让所有己方在场
//        【谢拉格】干员 +1 层 —— **不看在场人数**（N < 3 也照样叠，0 名时只是场上没人可叠）、**也不看有没有敌人被
//        冻结**。它接管了原来写在 3 名档分支里的那一句（不再双发）。卡面开关 `idleFrostUnconditional` 置 false 时
//        退回旧口径（N ≥ unlockCount **且**场上没有任何敌人带 freeze）。为了在 N < 3 时也能叠层，这条走
//        `gainFrost(u, 1, { ignoreUnlock: true })` 旁路掉「3 名档解锁」的总闸；`frostMax`（5 层 ⇒ 冰封）不变。
//     ② `statusApplied` 钩子（N ≥ unlockCount）：`status === 'freeze' && entered === true && target.side === 'enemy'`
//        且 `source` 是己方【谢拉格】干员 ⇒ **该干员** +1 层（引擎的「寒冷成对转冻结」也走这条：applyStatus 内部
//        递归发出的 freeze 保留同一个 source，所以本卡自己施加的寒冷凑成冻结时同样算「冻结敌人」）。
//     ③ `battle.every(0.25)` 轮询敌人的 `freeze` buff（N ≥ unlockCount）：上一拍冻结、这一拍不冻结且**还活着** ⇒
//        该敌人半径 `freezeEndRadius`（1.5）内所有己方在场【谢拉格】干员各 +1 层。判定用单位的场上坐标（欧氏距离）。
//   * **冰封**：霜寒叠到 `frostMax` 层 ⇒ 移除霜寒 buff（消耗清零）、挂 `hex:kjeragfrost:seal`，
//     持续 `sealSec`：`flags: { disarm, silence, noHeal, healFree, invulnerable }`、`mods: { blockCnt: 1 }`。
//     冰封期间不再获得霜寒（`gainFrost` 见到 seal 直接返回）；seal 靠 buff 自己的时长自然结束，结束后从 0 重新叠。
//   * **攻击施寒**（N ≥ unlockCount）：`hit` 钩子里，来源是己方【谢拉格】干员、目标是活着的敌方、这一击不是
//     元素损伤 / 流失 / 反伤 / 链式附加，概率 = `min(1, coldChancePerStack/100 × 层数)`（`battle.rng()`），
//     命中则 `applyStatus(target, 'cold', { duration: coldSec, source: unit })`。层数为 0 时不掷骰（不消耗随机数）。
//   * **冰封干员阻挡的敌人**（N ≥ unlockCount，3 名档效果）：`battle.every(1)`，对每个带 seal 的己方【谢拉格】干员，遍历 `u.blocking` 里
//     `e.blockedBy === u` 的敌人，造成 `sealedBlockDmg + sealedBlockDmgPerLayer × L` 真实伤害
//     （L = `bondLayers(battle, pid, 'kjeragShip')`，来源 = 该干员，tags 标 `hex`）。
//   * **6 名档 · 死亡**：`death` 钩子，`c.unit` 是己方【谢拉格】干员且 `c.reason === 'killed'` ⇒
//     对全场活着的敌人 `applyStatus('freeze', { duration: deathFreezeSec, source: 该干员 })`；
//     对全体己方在场【谢拉格】干员移除 `deathRemoveStacks` 层霜寒（`stacks -= n`，≤ 0 就移除 buff）。
//     档位判定把**刚阵亡的那名干员**算进去（它倒下前确实在场，否则「第 6 名倒下」永远不会触发这一档）。
//   * **6 名档 · 全冰封（真伤窗口）**：一旦「场上所有己方【谢拉格】干员同时处于冰封状态」成立（且 N ≥ highCount），
//     就开一个**固定 `allSealedSec` 秒**的窗口：窗口内每秒对全场敌人造成
//     `allSealedDmg + allSealedDmgPerLayer × L` 真实伤害并 `applyStatus('cold', { duration: coldSec })`。
//     窗口是**闩**：期间不重启、不叠加；到点释放，之后可再触发。
//
// 业主 2026-11-01「六人口的真伤效果没持续到15s」的诊断（复现脚本 .scratch/probe-frostdeath-trigger.mjs）：
//   ① **根因：触发只在 0.25 秒轮询里采样**（旧代码 `battle.every(0.25)`）。每名干员的冰封只有 `sealSec`（5 秒），
//      而 6 名干员的冰封是**各自**开始的 —— 全员重叠的窗口完全可能短于 0.25 秒。实测：第 6 名在 t=5.90 进入冰封、
//      其余 5 名 t=6.0 解封（重叠 0.1 秒）⇒ 一次都没被采到 ⇒ **15 秒效果根本没触发**。玩家当时看到的「几秒真伤」
//      其实是 3 名档的「冰封干员阻挡的敌人每秒真伤」（它只在冰封期间生效，所以正好 ~5 秒）。
//   ② 持续时间按「脉冲拍数」数（旧 `left--`），任何一拍被吞（战斗节奏变化 / 回调被深度守卫跳过）就少一秒。
//   ③ 真伤来源固定取触发那一刻的 `ops[0]`，那名干员一旦离场整段就哑。
//   现在的口径（业主 2026-11-01）：**一旦触发就固定跑满 `allSealedSec` 秒**，与冰封是否还在、人数是否还够、
//   来源是否还活着都无关 —— 触发改成事件驱动（`seal()` 末尾判定），持续时间用绝对截止时刻，来源每一拍现取。
//
// [ASSUMED]（设计稿没写死、实现时定下的口径）：
//   1. 「无法被治疗」= `noHeal + healFree`（禁疗也挡住自己的回复）；「冰封」不是晕眩，仍然阻挡（不加 `stun`）。
//   2. 本卡自己打出的真伤（冰封阻挡真伤 / 全冰封脉冲）带 tag `hex:kjeragfrost`，`hit` 钩子见到它**不再掷寒**
//      —— 否则这张卡会用自己的真伤给自己喂寒冷 / 冻结，既偏离卡面也会自我加速。
//   3. 全冰封脉冲的真伤来源记为该玩家**第一名冰封干员**（触发那一刻），寒冷同样由它施加。
//   4. 冻结结束的半径判定用「场上坐标的欧氏距离 ≤ freezeEndRadius」，不取整到格子。
//   5. 死亡档的「全体〖谢拉格〗干员」= 场上（活着 / 已部署 / 未隐匿）的己方【谢拉格】干员。
//   6. 6 名档的真伤窗口**不延长、不刷新**：窗口期间再有干员进入冰封不会重启计时（闩），窗口结束后才能再次触发。
//   7. 窗口的 15 秒与「全员冰封」状态**解耦**：冰封（`sealSec` 5 秒）结束后真伤照打 —— 卡面写的是「持续15秒」。
//   8. 基础效果（每 5 秒 +1 层）与「3 名档解锁霜寒」**解耦**（业主 2026-11-01「完全无条件」）：1–2 名谢拉格干员时
//      霜寒照样叠、也照样会到 5 层进冰封。其余 3 名档效果（攻击施寒 / 解冻回层 / 冰封阻挡真伤）**仍然**要 N ≥ 3。
//   9. `idleFrostUnconditional` 缺席时按 **true**（业主 2026-11-01 的口径）处理；置 false 则退回旧口径
//      （N ≥ 3 且场上没有敌人被冻结才 +1）。两条互斥，不会双发。
//
// 确定性：没有 Math.random / Date / Node API；随机一律走 `battle.rng()`；计时只用 `battle.every` / `battle.after`。
//
// CONTRACT: export function installKjeragFrostDeath(hooks) — hooks is the shared `hexHooks(battle)` bundle
// (server/sim/content/hexcards/hooks.js). Returns 0 when the card is absent, else a count of covered operators.
// Install only REGISTERS hooks: no battle state changes at install time.

import { isMember, baseChessId, bondLayers } from '../support/index.js';
import { isChained, isHpLoss, isRetaliation, makeDamageInfo } from '../../damage.js';

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
/** 本卡自己打出的真伤带的 tag（`hit` 钩子见到它就不再掷寒，见 [ASSUMED] 2）。 */
const SELF_TAG = 'hex:kjeragfrost';
/** 卡面 `idleFrostUnconditional` 缺席时的默认：业主 2026-11-01 的口径 —— 基础效果无条件生效（见 [ASSUMED] 9）。 */
const IDLE_UNCONDITIONAL_DEFAULT = true;

/**
 * 设计稿 §2 的兜底值：只在卡面缺这一格时用。数值一律以卡面为准，这里只为「记录比模块旧」的战斗兜底。
 */
const FALLBACK = Object.freeze({
  unlockCount: 3, frostMax: 5, defPctPerStack: 5, aspdPerStack: 5, sealSec: 5,
  coldChancePerStack: 30, coldSec: 5, freezeEndRadius: 1.5, idleFrostSec: 5,
  sealedBlockDmg: 100, sealedBlockDmgPerLayer: 40,
  highCount: 6, deathFreezeSec: 5, deathRemoveStacks: 2,
  allSealedDmg: 100, allSealedDmgPerLayer: 50, allSealedSec: 15,
});

/**
 * 读一个卡面数字。**不能**用 `hooks.optNumber`：它只接受 `> 0`（0 当未配置），而这张卡的参数里有 0 是合法口径的
 * 格子（「移除 0 层」），`aspdPerStack` 的符号还要自己决定（卡面写正数 5 = 攻速 −5）。
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

/**
 * 读一个卡面**布尔开关**：缺省 / 空值退回 `fallback`；boolean 原样；数字按 0 = false；字符串 'false' / '0' 算 false。
 * @param {any} spec 卡面参数对象 @param {string} key @param {boolean} fallback 缺省（设计稿口径）
 * @returns {boolean}
 */
function boolOf(spec, key, fallback) {
  if (!spec || typeof spec !== 'object') return fallback;
  const raw = spec[key];
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'boolean') return raw;
  const n = Number(raw);
  if (Number.isFinite(n)) return n !== 0;
  return String(raw).toLowerCase() !== 'false';
}

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
 * 口径与逐条 [ASSUMED] 见文件头；卡面参数见设计稿 §2。
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

  /** ownerId → 这张卡的参数（只读一次；数值都是设计稿 §2 的兜底，调数只改卡面）。 */
  const plan = new Map();
  for (const pid of owners) {
    const spec = typeof specOf === 'function' ? specOf(pid, CARD, SPEC) : {};
    plan.set(pid, {
      // 3 名档
      unlockCount: countOf(spec, 'unlockCount', FALLBACK.unlockCount),
      // 霜寒
      frostMax: countOf(spec, 'frostMax', FALLBACK.frostMax),
      defPct: numOf(spec, 'defPctPerStack', FALLBACK.defPctPerStack) / 100,
      aspd: -numOf(spec, 'aspdPerStack', FALLBACK.aspdPerStack),
      // 冰封
      sealSec: Math.max(0, numOf(spec, 'sealSec', FALLBACK.sealSec)),
      // 攻击施寒
      coldChance: numOf(spec, 'coldChancePerStack', FALLBACK.coldChancePerStack) / 100,
      coldSec: Math.max(0, numOf(spec, 'coldSec', FALLBACK.coldSec)),
      // 解冻 / 无冻结
      freezeEndRadius: Math.max(0, numOf(spec, 'freezeEndRadius', FALLBACK.freezeEndRadius)),
      idleFrostSec: Math.max(0.05, numOf(spec, 'idleFrostSec', FALLBACK.idleFrostSec)),
      // 业主 2026-11-01：true = 基础效果（每 5 秒 +1 层，完全无条件）；false = 退回旧口径（3 名档 + 场上无冻结）
      idleUnconditional: boolOf(spec, 'idleFrostUnconditional', IDLE_UNCONDITIONAL_DEFAULT),
      // 冰封阻挡真伤
      sealedBlockDmg: numOf(spec, 'sealedBlockDmg', FALLBACK.sealedBlockDmg),
      sealedBlockDmgPerLayer: numOf(spec, 'sealedBlockDmgPerLayer', FALLBACK.sealedBlockDmgPerLayer),
      // 6 名档
      highCount: countOf(spec, 'highCount', FALLBACK.highCount),
      deathFreezeSec: Math.max(0, numOf(spec, 'deathFreezeSec', FALLBACK.deathFreezeSec)),
      deathRemoveStacks: countOf(spec, 'deathRemoveStacks', FALLBACK.deathRemoveStacks, 0),
      allSealedDmg: numOf(spec, 'allSealedDmg', FALLBACK.allSealedDmg),
      allSealedDmgPerLayer: numOf(spec, 'allSealedDmgPerLayer', FALLBACK.allSealedDmgPerLayer),
      allSealedSec: countOf(spec, 'allSealedSec', FALLBACK.allSealedSec),
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
    // —— 全员重叠的窗口可能短于轮询间隔（实测 0.1 秒的窗口会整段漏掉，15 秒真伤根本不触发）。
    maybeStartPulse(u.ownerId);
  };

  /**
   * 给一名干员加 `n` 层霜寒（叠满即进入冰封）。
   * @param {any} u 干员 @param {number} n 层数
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

  /** 本卡自己打出的一段真实伤害（tags 标 hex；`hit` 钩子认得它，见 [ASSUMED] 2）。 */
  const trueDamage = (src, tgt, amount) => {
    if (!src || !tgt || !tgt.alive || !(amount > 0)) return 0;
    return battle.dealDamage(src, tgt, makeDamageInfo({ amount, type: 'true', canDodge: false, tags: ['hex', SELF_TAG] }));
  };

  // ===================================================================================================================
  // 3 名档 · ① 冻结敌人 ⇒ 该干员 +1 层霜寒

  battle.on('statusApplied', (c) => {
    if (!c || c.status !== 'freeze' || c.entered !== true) return;   // 「冻结敌人时」= 这一次真的挂上了冻结
    const tgt = c.target;
    if (!tgt || tgt.side !== 'enemy') return;
    const src = c.source;
    if (!isKjeragOp(src)) return;
    gainFrost(src, 1);
  });

  // ===================================================================================================================
  // 3 名档 · ② 冻结结束未被击杀 ⇒ 该敌人半径 freezeEndRadius 内所有己方【谢拉格】干员 +1 层

  /** enemy → 上一拍是否带 freeze（敌人一旦离场就不会再以「不冻结」出现，条目自然失效）。 */
  const wasFrozen = new Map();
  battle.every(0.25, () => {
    // 长战斗里离场的敌人不会自己从表里消失（`battle.enemies` 只剩活着的）：攒够一批就清一次
    if (wasFrozen.size > 256) for (const [e] of wasFrozen) if (!e.alive) wasFrozen.delete(e);
    for (const e of battle.enemies) {
      if (!e) continue;
      const frozen = e.alive && typeof e.findBuff === 'function' && !!e.findBuff('freeze');
      const prev = wasFrozen.get(e) === true;
      wasFrozen.set(e, frozen);
      if (!prev || frozen) continue;
      if (!e.alive) continue;                            // 「冻结结束时未被击杀」：死了不算
      for (const pid of owners) {
        const p = plan.get(pid);
        if (!p || !unlocked(pid)) continue;
        const r2 = p.freezeEndRadius * p.freezeEndRadius + 1e-9;
        for (const u of opsOnField(pid)) {
          const dx = u.x - e.x, dy = u.y - e.y;
          if (dx * dx + dy * dy <= r2) gainFrost(u, 1);
        }
      }
    }
  });

  // ===================================================================================================================
  // **基础效果** · 每 idleFrostSec 秒所有己方【谢拉格】干员 +1 层霜寒
  //
  // 业主 2026-11-01 拍板：**完全无条件** —— 不看在场人数（N < 3 也叠）、也不看有没有敌人被冻结。它接管了原来写在
  // 「<在场3名>」分支里的那一句（二选一，不双发）。卡面开关 `idleFrostUnconditional`（缺席按 true）：
  //   * true  —— 基础效果：每拍对场上所有己方【谢拉格】干员 `gainFrost(u, 1, { ignoreUnlock: true })`；
  //   * false —— 退回旧口径：只有 N ≥ unlockCount **且**场上没有任何敌人带 freeze 时才 +1。

  for (const pid of owners) {
    const p = plan.get(pid);
    if (!p) continue;
    battle.every(p.idleFrostSec, () => {
      if (p.idleUnconditional) {                        // 基础效果：无条件（0 名时场上没人可叠，自然什么都不发生）
        for (const u of opsOnField(pid)) gainFrost(u, 1, { ignoreUnlock: true });
        return;
      }
      if (!unlocked(pid)) return;                       // 旧口径：3 名档才生效
      for (const e of battle.enemies) {
        if (e && e.alive && typeof e.findBuff === 'function' && e.findBuff('freeze')) return;   // 有人被冻结 ⇒ 这一拍不叠
      }
      for (const u of opsOnField(pid)) gainFrost(u, 1);
    });
  }

  // ===================================================================================================================
  // 3 名档 · 攻击施寒（概率 = min(1, coldChancePerStack/100 × 层数)，层数 0 不掷骰）

  battle.on('hit', (c) => {
    const dmg = c && c.dmg;
    const tgt = c && c.target;
    if (!dmg || dmg.cancel || !tgt) return;
    const src = c.source;
    if (!isKjeragOp(src) || !src.alive) return;
    if (tgt.side !== 'enemy' || !tgt.alive) return;
    if (dmg.type === 'element') return;                  // 元素损伤不是伤害
    if (isHpLoss(dmg) || isRetaliation(dmg) || isChained(dmg)) return;
    if (Array.isArray(dmg.tags) && dmg.tags.includes(SELF_TAG)) return;   // 本卡自己的真伤不再施寒
    const pid = src.ownerId;
    const p = plan.get(pid);
    if (!p || !unlocked(pid)) return;
    const frost = typeof src.findBuff === 'function' ? src.findBuff(FROST_KEY) : null;
    const stacks = frost ? frost.stacks : 0;
    if (!(stacks > 0)) return;                           // 0 层不掷骰
    const chance = Math.min(1, p.coldChance * stacks);
    if (!(chance > 0)) return;
    if (!(battle.rng() < chance)) return;
    battle.applyStatus(tgt, 'cold', { duration: p.coldSec, source: src });
  });

  // ===================================================================================================================
  // 3 名档 · 冰封干员阻挡的敌人每秒受到 sealedBlockDmg + sealedBlockDmgPerLayer × L 真实伤害

  for (const pid of owners) {
    battle.every(1, () => {
      const p = plan.get(pid);
      if (!p) return;
      // 3 名档效果：A 条之后「冰封」在 N < 3 也能发生，所以这道闸必须显式写出来（卡面把它列在 <在场3名> 里）
      if (!unlocked(pid)) return;
      const amount = p.sealedBlockDmg + p.sealedBlockDmgPerLayer * layersOf(pid);
      if (!(amount > 0)) return;
      for (const u of opsOnField(pid)) {
        if (!isSealed(u)) continue;
        for (const e of u.blocking.slice()) {
          if (!e || e.blockedBy !== u || !e.alive) continue;
          trueDamage(u, e, amount);
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
    for (const e of battle.enemies) {
      if (e && e.alive) battle.applyStatus(e, 'freeze', { duration: p.deathFreezeSec, source: u });
    }
    for (const a of opsOnField(pid)) loseFrost(a, p.deathRemoveStacks);
  });

  // ===================================================================================================================
  // 6 名档 · 全冰封 ⇒ allSealedSec 秒的真伤窗口（真实伤害 + 寒冷）
  //
  // 诊断与口径见文件头：① 触发改成**事件驱动**（`seal()` 末尾调用 `maybeStartPulse`，不再只靠 0.25 秒轮询采样）；
  // ② 持续时间改成**绝对截止时刻**（触发时刻 + allSealedSec），不再数拍数；③ 来源每一拍现取。

  /** pid → 本次窗口的绝对截止时刻（battle time）。有键 = 窗口正在跑（闩：期间不重启、不叠加）。 */
  const pulseUntil = new Map();

  /** 全场敌人吃一拍：allSealedDmg + allSealedDmgPerLayer × L 真实伤害 + 寒冷。 */
  const pulseBeat = (pid, p) => {
    const ops = opsOnField(pid);
    // 来源每一拍现取（优先冰封中的那名）：触发那一刻的干员之后死了 / 撤退了，真伤也不会哑
    const src = ops.find((u) => isSealed(u)) ?? ops[0] ?? null;
    const amount = p.allSealedDmg + p.allSealedDmgPerLayer * layersOf(pid);
    for (const e of battle.enemies.slice()) {
      if (!e || !e.alive) continue;
      if (amount > 0) trueDamage(src, e, amount);
      if (e.alive) battle.applyStatus(e, 'cold', { duration: p.coldSec, source: src });
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
    // 兜底收尾：最后一拍万一没落地（拍被吞 / 调度被清），到点也补一拍并关窗 —— 「固定跑满」不靠运气
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
