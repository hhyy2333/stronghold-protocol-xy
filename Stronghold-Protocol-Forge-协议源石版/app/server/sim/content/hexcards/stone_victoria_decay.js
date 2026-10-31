// server/sim/content/hexcards/stone_victoria_decay.js — 第二十批（业主 2026-10-31）：维多利亚 ·【衰朽的骄矜】
// (hex_victoria_decay, 2 阶 / gold / requiresBond: victoriaShip) 的战斗半边。
//
// 设计稿：04-文档/协议源石-专属协议-衰朽的骄矜与炎百兽-设计稿-20261031.md §1。
// 业主原文（逐字）：
//   <在场3名不同〖维多利亚〗干员>
//   携带装备的〖维多利亚〗干员攻击时，无视目标防御法抗。
//   每秒流失0.5%最大生命值。
//   <在场5名不同〖维多利亚〗干员>
//   生命值高于80％时，生命＋50防御力＋50攻击力＋100（随层数增长）
//   每秒额外流失0.5%最大生命值，若装备锤子则为0％
//   <在场7名不同〖维多利亚〗干员>
//   每秒额外流失1%最大生命值。
//   〖维多利亚〗干员生命值首次降至0时不会撤退，锁血进入「衰朽」，持续8秒：
//   · 阻挡数归零， 攻击力＋100％，攻速＋7（随层数增长）；
//   · 8秒后若在衰朽期间累计击杀3名敌人，则回复50%生命值并脱离衰朽否则强制撤退。
//
// 数值全部读卡面 `params.victoriaDecay`（tools/hextech/roster.mjs），这里只写行为。
//
// CONTRACT: export function installVictoriaDecay(hooks) — hooks is the shared `hexHooks(battle)` bundle
// (server/sim/content/hexcards/hooks.js). Returns 0 when the card is absent, else the live handle
// (`owners` / `drains` / `ignores` / `decays` / `prevented` / `retreats` / `heals` getters) — the same shape as the
// other 盟约专属 cards (stone_kjerag_laterano.js / stone_yan_sargon.js). Install only REGISTERS hooks: no battle
// state changes at install time.
//
// 口径（设计稿 §1.3；官方文本没写死的地方逐条标 [ASSUMED]）：
//   * **作用域**：拥有该卡的玩家自己的【维多利亚】干员 —— `u.kind === 'op' && u.side === 'ally'`、
//     `u.ownerId` ∈ 拥有者、`isMember(battle, u, 'victoriaShip')`（support/index.js：数据 bonds ∪ 装备 / 特质授予 ∪
//     盟约共鸣借来的，与盟约内容同一处判据）。多玩家场上别人的干员一律不算（每个 handler 都先查拥有者）。
//   * **「在场」**：沿用 `hexHooks.onField` = `alive && deployed && !hidden`（设计稿 §1.3 点名这一口径）。被击倒的
//     干员等重部署时按满血回来，不该被流失 / 面板 buff「预存」。
//   * **N（不同干员数）**：场上己方【维多利亚】干员按 `baseChessId` 去重（support/index.js：`_b` 归一到 `_a`）。
//     [ASSUMED] 「不同」= 同名干员的普通 / 精锐只算一个；不用 `bondState.count`（那是盟约激活口径，会把【调和】的 +1、
//     变形同构体算进来，卡面写的是「在场 N 名不同干员」）。
//   * **3 名档 · 无视防御法抗**：`hit` 钩子里，来源是「携带 ≥1 件装备的己方【维多利亚】干员」、目标是**敌方**、
//     且这一击不是 元素损伤（`type === 'element'`）/ 流失（`isHpLoss`）/ 反伤（`isRetaliation`）/ 链式附加（`isChained`）
//     时，把 `dmg.defIgnorePct = 1`、`dmg.resIgnorePct = 1`（已经更高的不降）。`hit` 发生在减伤之前（damage.js
//     dealDamage：emit('hit') → mitigate），所以这一发自己就吃满穿透。
//     [ASSUMED] 不额外要求 `dmg.isAttack`：卡面写「攻击时」，但设计稿 §1.3 只排除了上面四类，技能覆盖的那一次攻击
//     （引擎同样打 `isAttack`）与技能附带的伤害实例都算「攻击造成的伤害」。
//   * **3 名档 · 每秒流失**：`battle.every(1)`（第一个脉冲在 t = 1s），对每名在场己方【维多利亚】干员
//     `battle.loseHp(u, u.s.maxHp × drainPct/100, { tags: ['hpLoss', 'hex:victoriadecay'] })`。N < 3 时不流失（这三档
//     是「在场 N 名」的阶梯，3 名档以下的干员一点血都不掉）。流失可以致死 —— 会走 `fatal`，于是能触发衰朽。
//   * **5 名档 · 生命 > 80% 面板**：对每名在场己方【维多利亚】干员，若「生命值高于 80%」就挂常驻 buff
//     `hex:victoriadecay:stat`：`{ hpFlat: 50+10L, defFlat: 50+3L, atkFlat: 100+5L, aspd: 7+0.5L }`（L = 该玩家实时
//     【维多利亚】层数 `bondLayers`）；条件不满足就摘掉。复核时机：`battleStart` / `deploy`（后部署的补上）/
//     `battle.every(0.5)`（受伤掉到门槛下、层数变化都跟着刷新）。
//     [ASSUMED] 生命上限提高后按**新的** maxHp 判 80%（设计稿 §1.3 的原文）。引擎在 maxHp 变化时按比例缩放当前 HP
//     （units.js `_recalc`：`hp = hp × 新上限 / 旧上限`），所以本卡自己加的 `hpFlat` 不会把干员推到门槛下面再推回来
//     —— 这条判据不会每 0.5s 抖一次。
//   * **5 名档 · 额外流失**：`extraDrainPct`；但该干员装备任意【维式重锤】（`hammerKeys`，用 `itemKeyOf` 比较，所以
//     `_a` / `_b` 两种形态与具体数据记录无关）时为 0。
//   * **7 名档 · 再额外流失**：`highDrainPct`（1%），对每名干员都算（锤子只豁免 5 名档那一份）。
//   * **衰朽（每名干员每场一次）**：`fatal` 钩子（applyHpLoss 在 HP 归零之后、`battle.kill` 之前发出，带
//     `{ unit, source, dmg, amount, prevented }`）里，若目标是拥有者的己方【维多利亚】干员：
//     - 窗口内（`battle.time < until`）再受致命伤：只 `c.prevented = true`，不重复进入、不延长窗口；
//     - 本场已经用过衰朽（`used` 且窗口已过）：什么都不做 ⇒ 正常阵亡；
//     - 首次：`c.prevented = true`（引擎把 HP 抬到 1）、记 `u.mem.victoriaDecay = { used: true, until, kills: 0 }`、
//       挂 buff `hex:victoriadecay:decay`：`{ blockCnt: -进入前阻挡数, atkPct: 1, aspd: 7+0.5L }`，并
//       `battle.releaseBlocked(u)`（阻挡数归零要把已经挡着的敌人放掉，与 professions.js 的 0 阻挡写法一致）；
//     - `kill` 钩子（`{ killer, victim }`）里 `killer === u && victim.side === 'enemy'` 且仍在窗口内时 `kills++`
//       （「衰朽期间」累计，窗口外的击杀不算）；
//     - `battle.after(decaySec)` 结算：干员仍活着则先摘掉衰朽 buff，`kills >= decayKills` ⇒
//       `battle.heal(u, u, u.s.maxHp × decayHealPct/100)`（回复 50% 最大生命，脱离衰朽），否则
//       `battle.retreat(u, { reason: 'retreat', permanent: true, dying: true })`（强制撤退：本场不再回来）。
//       [ASSUMED] 回复量按**结算时**的最大生命上限算（5 名档的面板 buff 会抬上限），且走正常治疗（吃禁疗 / 治疗加成）。
//     - 窗口结束后 `used` 保持 true ⇒ 本场不再进衰朽。
//   * **确定性**：没有 Math.random / Date / Node API；计时只用 `battle.every` / `battle.after`，随机一个都不用。
//
// 与 drill / armor / batch16 等模块同一个 `hexHooks(battle)` 契约：installX(hooks) 只注册 hook，安装时**不改**战斗状态。

import { isMember, baseChessId, bondLayers, itemsOf, itemKeyOf, passiveBuff } from '../support/index.js';
import { isChained, isHpLoss, isRetaliation } from '../../damage.js';

/** 卡 id（模块自己的查表键）。 */
const CARD = 'hex_victoria_decay';
/** 卡面 effect 里那段参数的名字。 */
const SPEC = 'victoriaDecay';
/** 【维多利亚】核心盟约 id（成员资格 / 层数都读它）。 */
const BOND = 'victoriaShip';
/** 5 名档面板加成的 buff 键（条件不满足时按同一个键撤销）。 */
const STAT_KEY = 'hex:victoriadecay:stat';
/** 衰朽期间的 buff 键（窗口结束时摘掉）。 */
const DECAY_KEY = 'hex:victoriadecay:decay';
/** 流失的标记（`loseHp` 自己还会补一个 'hpLoss'）。 */
const DRAIN_TAG = 'hex:victoriadecay';

/** 设计稿 §1.2 的【维式重锤】五个键（卡面 `hammerKeys` 缺席时的兜底）。 */
const HAMMER_KEYS = Object.freeze(['chess_item_1_01_e', 'chess_item_2_03_e', 'chess_item_3_09_e', 'chess_item_3_10_e', 'chess_item_4_09_e']);

/**
 * 读一个卡面数字。**不能**用 `hooks.optNumber`：它只接受 `> 0`（0 当未配置），而这张卡的 `drainPct: 0.5` /
 * `aspdPerLayer: 0.5` 是合法小数、`extraDrainPct: 0`（锤子豁免的等价写法）也是合法值。
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

/** 正整数（次数 / 人数阈值），非法值退回兜底。 */
const countOf = (spec, key, fallback) => Math.max(0, Math.round(numOf(spec, key, fallback)));

/** 卡面里的锤子键列表（只收字符串；缺席 / 空表 ⇒ 设计稿那五个）。 */
function hammersOf(spec) {
  const list = spec && Array.isArray(spec.hammerKeys) ? spec.hammerKeys.filter((k) => typeof k === 'string' && k) : null;
  return list && list.length ? list : HAMMER_KEYS;
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
 * 【衰朽的骄矜】hex_victoria_decay（2 阶，requiresBond: victoriaShip）的战斗半边。
 * 口径与逐条 [ASSUMED] 见文件头；卡面参数见设计稿 §1.2。
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number|{owners:number,drains:number,ignores:number,decays:number,prevented:number,retreats:number,heals:number}}
 *          0 when the card is absent, else the live handle
 */
export function installVictoriaDecay(hooks) {
  const owners = ownersOfCard(hooks, CARD);
  if (!owners) return 0;
  const { battle, specOf, onField } = hooks;
  const owned = new Set(owners);

  /** 每个拥有者的卡面参数（只读一次；数值都是设计稿 §1.2 的兜底，调数只改卡面）。 */
  const plan = new Map();
  for (const pid of owners) {
    const spec = typeof specOf === 'function' ? specOf(pid, CARD, SPEC) : {};
    plan.set(pid, {
      // 3 名档
      equipCount: countOf(spec, 'equipCount', 3),
      drainPct: numOf(spec, 'drainPct', 0.5) / 100,
      // 5 名档
      buffCount: countOf(spec, 'buffCount', 5),
      buffHpPct: numOf(spec, 'buffHpPct', 80) / 100,
      hpFlat: numOf(spec, 'hpFlat', 50),
      hpPerLayer: numOf(spec, 'hpPerLayer', 10),
      defFlat: numOf(spec, 'defFlat', 50),
      defPerLayer: numOf(spec, 'defPerLayer', 3),
      atkFlat: numOf(spec, 'atkFlat', 100),
      atkPerLayer: numOf(spec, 'atkPerLayer', 5),
      aspd: numOf(spec, 'aspd', 7),
      aspdPerLayer: numOf(spec, 'aspdPerLayer', 0.5),
      extraDrainPct: numOf(spec, 'extraDrainPct', 0.5) / 100,
      hammerKeys: hammersOf(spec),
      // 7 名档
      highCount: countOf(spec, 'highCount', 7),
      highDrainPct: numOf(spec, 'highDrainPct', 1) / 100,
      // 衰朽
      decaySec: Math.max(0, numOf(spec, 'decaySec', 8)),
      decayKills: Math.max(1, countOf(spec, 'decayKills', 3)),
      decayAtkPct: numOf(spec, 'decayAtkPct', 100) / 100,
      decayAspd: numOf(spec, 'decayAspd', 7),
      decayAspdPerLayer: numOf(spec, 'decayAspdPerLayer', 0.5),
      decayHealPct: numOf(spec, 'decayHealPct', 50) / 100,
    });
  }

  /** 「在场」（与 hexHooks.onField 同一口径；手搓 hooks 时退回同一条判据）。 */
  const isOnField = typeof onField === 'function' ? onField : (u) => !!u && !!u.alive && !!u.deployed && !u.hidden;
  /** 拥有者的己方【维多利亚】干员（召唤物 / 队友的干员都不算）。 */
  const isVictorian = (u) => !!u && u.kind === 'op' && u.side === 'ally' && owned.has(u.ownerId) && isMember(battle, u, BOND);
  /** 拥有者 pid 的在场【维多利亚】干员。 */
  const onFieldVictorians = (pid) => battle.allyUnits.filter((u) => u && u.ownerId === pid && isVictorian(u) && isOnField(u));
  /** N：按 `baseChessId` 去重的「不同干员数」。 */
  const distinctCount = (pid) => {
    const seen = new Set();
    for (const u of onFieldVictorians(pid)) seen.add(baseChessId(u));
    return seen.size;
  };
  /** 该干员身上有没有【维式重锤】（`itemKeyOf` 去掉 `_a` / `_b`，与卡面 hammerKeys 同一形状）。 */
  const wearsHammer = (u, p) => itemsOf(u).some((id) => p.hammerKeys.includes(itemKeyOf(id)));
  /** 实时【维多利亚】层数（L）。 */
  const layersOf = (pid) => bondLayers(battle, pid, BOND);

  let drains = 0, ignores = 0, decays = 0, prevented = 0, retreats = 0, heals = 0;

  // ===================================================================================================================
  // 3 名档 · 携带装备的【维多利亚】干员攻击时，无视目标防御法抗

  battle.on('hit', (c) => {
    const dmg = c && c.dmg;
    const tgt = c && c.target;
    if (!dmg || dmg.cancel || !tgt) return;
    const src = c.source;
    if (!isVictorian(src) || !src.alive) return;
    const p = plan.get(src.ownerId);
    if (!p) return;
    if (tgt.side !== 'enemy') return;
    if (dmg.type === 'element' || isHpLoss(dmg) || isRetaliation(dmg) || isChained(dmg)) return;
    if (!itemsOf(src).length) return;                       // 「携带装备的」：至少一件装备
    if (distinctCount(src.ownerId) < p.equipCount) return;   // 「在场 3 名不同干员」
    if (!(Number(dmg.defIgnorePct) >= 1)) dmg.defIgnorePct = 1;   // 已经更高的不降
    if (!(Number(dmg.resIgnorePct) >= 1)) dmg.resIgnorePct = 1;
    ignores++;
  });

  // ===================================================================================================================
  // 每秒流失（3 名档 0.5% + 5 名档额外 0.5% + 7 名档额外 1%）

  for (const pid of owners) {
    battle.every(1, () => {
      const p = plan.get(pid);
      if (!p) return;
      const n = distinctCount(pid);
      if (n < p.equipCount) return;                          // 3 名档以下：一点血都不掉
      const high = n >= p.highCount;
      for (const u of onFieldVictorians(pid)) {
        if (!u.alive) continue;
        const maxHp = u.s.maxHp;
        if (!(maxHp > 0)) continue;
        let pct = p.drainPct;
        // 5 名档的额外那一份：装备维式重锤时为 0
        if (n >= p.buffCount && !wearsHammer(u, p)) pct += p.extraDrainPct;
        // 7 名档再额外一份（锤子不豁免这一份）
        if (high) pct += p.highDrainPct;
        const amount = maxHp * pct;
        if (!(amount > 0)) continue;
        drains++;
        battle.loseHp(u, amount, { tags: ['hpLoss', DRAIN_TAG] });
      }
    });
  }

  // ===================================================================================================================
  // 5 名档 · 生命值高于 80% 时的面板加成

  /**
   * 给一名干员复核面板 buff（幂等：`passiveBuff` 同名替换）。
   * 层数签名记在 buff 自己身上，层数没变就不重建实例（省掉每 0.5s 一次的无意义替换）。
   * @returns {boolean} 当前是否挂着
   */
  const applyStat = (u, p, pid) => {
    const buff = typeof u.findBuff === 'function' ? u.findBuff(STAT_KEY) : null;
    // 「生命值高于 80%」按**当前** maxHp 判（含本卡自己抬起来的上限）。引擎在 maxHp 变化时按比例缩放当前 HP
    // （units.js `_recalc`：`hp = hp × 新上限 / 旧上限`），所以这条判据不会因为本卡自己加血而在门槛上抖。
    if (!(u.hp > p.buffHpPct * u.s.maxHp)) {
      if (buff) battle.removeBuff(u, STAT_KEY);
      return false;
    }
    const L = layersOf(pid);
    const sig = String(L);
    if (buff && buff.victoriaDecaySig === sig) return true;
    const b = passiveBuff(battle, u, STAT_KEY, {
      hpFlat: p.hpFlat + p.hpPerLayer * L,
      defFlat: p.defFlat + p.defPerLayer * L,
      atkFlat: p.atkFlat + p.atkPerLayer * L,
      aspd: p.aspd + p.aspdPerLayer * L,
    }, { tags: ['hex'] });
    if (b) b.victoriaDecaySig = sig;
    return true;
  };

  /** 按当前 N / 层数 / 血量复核一名拥有者的全部干员。 */
  const refreshStat = (pid) => {
    const p = plan.get(pid);
    if (!p) return;
    const on = distinctCount(pid) >= p.buffCount;
    for (const u of battle.allyUnits) {
      if (!u || u.ownerId !== pid || !isVictorian(u)) continue;
      if (!on || !isOnField(u)) {                       // 不到 5 名 / 不在场 ⇒ 撤销
        if (typeof u.findBuff === 'function' && u.findBuff(STAT_KEY)) battle.removeBuff(u, STAT_KEY);
        continue;
      }
      applyStat(u, p, pid);
    }
  };

  battle.on('battleStart', () => { for (const pid of owners) refreshStat(pid); }, { priority: -10 });
  battle.on('deploy', (c) => {
    const u = c && c.unit;
    if (u && u.kind === 'op' && owned.has(u.ownerId)) refreshStat(u.ownerId);
  });
  for (const pid of owners) battle.every(0.5, () => refreshStat(pid));

  // ===================================================================================================================
  // 衰朽：生命值首次降至 0 时锁血 8 秒，期间 3 杀 ⇒ 回复 50% 最大生命，否则强制撤退

  /** 窗口结算（`battle.after(decaySec)` 到点）。 */
  const settle = (u, p, st) => {
    if (!u || !u.alive) return;                          // 已经不在场（理论上窗口内每一发致命都被 prevented）
    battle.removeBuff(u, DECAY_KEY);
    if (st.kills >= p.decayKills) {
      heals++;
      battle.heal(u, u, u.s.maxHp * p.decayHealPct);
      return;
    }
    retreats++;
    battle.retreat(u, { reason: 'retreat', permanent: true, dying: true });
  };

  battle.on('fatal', (c) => {
    const u = c && c.unit;
    if (!u || c.prevented) return;                       // 别人已经免死过这一发：不消耗衰朽
    if (!isVictorian(u) || !u.alive) return;
    const p = plan.get(u.ownerId);
    if (!p) return;
    const mem = u.mem;
    const st = mem.victoriaDecay || null;
    if (st && battle.time < st.until) {                  // 窗口内再受致命伤：只免死，不重复进入、不延长
      prevented++;
      c.prevented = true;
      return;
    }
    if (st && st.used) return;                           // 本场已经用过衰朽 ⇒ 正常阵亡
    // 首次进入衰朽
    const L = layersOf(u.ownerId);
    const block = u.s.blockCnt;                          // 进入前的阻挡数（负这么多 ⇒ 归零）
    const state = { used: true, until: battle.time + p.decaySec, kills: 0 };
    mem.victoriaDecay = state;
    decays++;
    prevented++;
    c.prevented = true;
    battle.addBuff(u, {
      key: DECAY_KEY, refresh: 'replace', tags: ['hex', DECAY_KEY],
      mods: { blockCnt: -block, atkPct: p.decayAtkPct, aspd: p.decayAspd + p.decayAspdPerLayer * L },
    });
    if (typeof battle.releaseBlocked === 'function') battle.releaseBlocked(u);   // 阻挡数归零 ⇒ 放掉已经挡着的敌人
    if (typeof battle.after === 'function') battle.after(p.decaySec, () => settle(u, p, state));
  });

  // 衰朽期间的击杀计数（只算该干员自己的、敌方单位、且在窗口内）
  battle.on('kill', (c) => {
    const killer = c && c.killer;
    const victim = c && c.victim;
    if (!killer || !victim || victim.side !== 'enemy') return;
    if (!isVictorian(killer)) return;
    const st = killer.mem && killer.mem.victoriaDecay;
    if (!st || !st.used) return;
    if (battle.time > st.until + 1e-9) return;
    st.kills++;
  });

  return {
    get owners() { return owners.length; },
    get drains() { return drains; },
    get ignores() { return ignores; },
    get decays() { return decays; },
    get prevented() { return prevented; },
    get retreats() { return retreats; },
    get heals() { return heals; },
  };
}
