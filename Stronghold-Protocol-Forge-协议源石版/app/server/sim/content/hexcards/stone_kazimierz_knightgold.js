// server/sim/content/hexcards/stone_kazimierz_knightgold.js — 第二十二批（业主 2026-10-31）：卡西米尔 ·【骑士金神】
// (hex_kazimierz_knightgold, 2 阶 / gold / requiresBond: kazimierzShip) 的战斗半边。
//
// 设计稿：04-文档/协议源石-专属协议-骑士金神-设计稿-20261031.md §1。
// 业主原文（逐字）：
//   卡西米尔盟约效果：「骑士金神」
//   〖卡西米尔〗干员击杀4个敌人时获得1金（每场战斗最大1，每50层＋1，最多＋到9）。
//   <在场5名不同〖卡西米尔〗干员>
//   敌人增加。
//   等阶最高的干员攻击力+30（每层＋1），攻击范围扩大；
//   <在场7名不同〖卡西米尔〗干员>
//   敌人增加。
//   本回合每消耗3金，所有干员伤害提升20％
//
// 数值全部读卡面 `params.kazimierzKnightGold`（tools/hextech/roster.mjs）；金币伤害的备战半段写进
// `params.battle.dmgPct`（applySpec 的 goldDamage / goldDamageReset），战斗侧只读它。
//
// 口径（设计稿 §0 已确认口径 + §3.2 实现口径，逐条对应下面的实现注释）：
//   * **作用域**：拥有该卡的玩家自己的【卡西米尔】干员 —— `u.kind === 'op' && u.side === 'ally'`、
//     `u.ownerId` ∈ 拥有者、`isMember(battle, u, 'kazimierzShip')`（support/index.js：数据 bonds ∪ 装备 / 特质授予 ∪
//     盟约共鸣借来的，与盟约内容同一处判据）。多玩家场上别人的干员一律不算（每个 handler 都先查拥有者）。
//   * **「在场」**：沿用 `hexHooks.onField` = `alive && deployed && !hidden`（设计稿 §3.2 点名这一口径）。被击倒的
//     干员等重部署时按满血回来，不该被面板 buff「预存」。
//   * **N（不同干员数）**：场上己方【卡西米尔】干员按 `baseChessId` 去重（`_b` 归一到 `_a`）——「在场 N 名**不同**
//     干员」，同名干员的普通 / 精锐只算一个。N 每次都现算（部署 / 阵亡都会改它），不缓存。
//   * **击杀金币（无门槛）**：`kill` 钩子（`{ killer, victim }`，deploy.js `kill()` 发出），`victim.side === 'enemy'`
//     且 `killer` 是己方【卡西米尔】干员 ⇒ 该玩家的击杀计数 +1（**全队共享**：所有己方卡西米尔干员的击杀加在一起；
//     计数挂在 `battleStore` 上，跨干员共享、**跨死亡保留**）。每满 `killStep`（4）次 ⇒ `battle.addCoins(pid, 1)`，
//     直到本场已发放数达到 `min(goldCap, goldBase + floor(L / goldPerLayer))`（L = 该玩家**实时**的【卡西米尔】层数）。
//     层数掉回去时不再多发（已发的金币不收回）。
//   * **5 名档 · 敌人增加**：`battleStart`（优先级 -10）里，`N >= highCount` 时按卡面 `enemyTiers` 里**所有**
//     `min <= L` 的档，每档 `battle.spawnEnemy(key, { routeIndex: 0, tag: 'hex:knightgold' })` 刷 `count` 只（累计）。
//     L = 0 / 50 / 100 / 200 / 300 各解锁一档 ⇒ 共 1 / 2 / 3 / 4 / 5 只，≥ 400 层不再增加。
//     刷怪只在战斗开始时发生一次（本场不再刷）。
//   * **5 名档 · 等阶最高**：场上己方【卡西米尔】干员里 `tierOf(u)` 最高的那些（**并列都加**）挂常驻 buff
//     `hex:knightgold:high`：`{ atkFlat: atkFlat + atkPerLayer × L, rangeExtend: rangeExtend }`；
//     `battleStart` / `deploy` / `layerGain` 后刷新（L 变了要重算；阶位不会变）。条件不满足（不到 5 名 / 离场 /
//     不再是最高阶）就按同一个键撤销。
//   * **7 名档 · 金币伤害**：`N >= sevenCount` 时读本卡 EffectRef 的 `params.battle.dmgPct`（备战侧 `onSpend.goldDamage`
//     写入、`onRoundStart.goldDamageReset` 清零），给**所有己方干员**（不只卡西米尔）挂常驻
//     `hex:knightgold:dmg`：`{ dmgDealtMul: 1 + dmgPct / 100 }`（`battleStart` / `deploy` 补装）；`dmgPct <= 0` 不挂。
//   * **确定性**：没有 Math.random / Date / Node API；计时只用 `battle.every` / `battle.after`，本卡一个随机都不用。
//
// [ASSUMED]（设计稿点了名的两条，加上实现时定下的几条）：
//   1. 运行时刷出来的这批敌人**不进** HUD 分母 / 备战预览 —— `spawnEnemy` 默认 `inTotal: false`（spawns.js：只有
//      stage 自己排队的刷怪才进 capsule），本卡不再额外传 `inTotal`；也不给敌方加缩放（卡面只写「敌人增加」）。
//   2. 击杀只认**干员**（`kind === 'op'`）亲手打死的敌人：召唤物 / 器械 / 无来源伤害（地形、流失、另一名敌人）都不算
//      「〖卡西米尔〗干员击杀」。
//   3. 「等阶最高的干员」按 `tierOf`（干员记录的 tier；召唤物 / 无 tier 的按 1）比较；并列最高**都加**，低阶一个都不加。
//   4. 「所有干员」按拥有者自己的己方**干员**（`kind === 'op'`）读，不含召唤物 / 器械 / 队友的干员 —— 卡面这句写在
//      卡西米尔盟约里，但业主 §0 明确「不只卡西米尔」，所以不再过 `isMember`。
//   5. 同一张卡被策略「管理员」复制成两份时，两个常驻 buff 用**同一个键**（`passiveBuff` 同名替换），即两份副本不叠加
//      —— 卡面没有「每份叠加」的写法，与【圣佑】的攻速 / 攻击力被动同一条口径。
//   6. 金币上限判的是**实时**层数：层数掉下来之后不再补发（已发的留在手里）；层数涨上去之后，后续击杀可以继续发到新上限。
//
// 与 drill / armor / batch16 等模块同一个 `hexHooks(battle)` 契约（见 hooks.js）：installX(hooks) 只注册 hook，
// 安装时**不改**战斗状态。
//
// CONTRACT: export function installKazimierzKnightGold(hooks) — hooks is the shared `hexHooks(battle)` bundle
// (server/sim/content/hexcards/hooks.js). Returns 0 when the card is absent, else the live handle
// (`owners` / `kills` / `coins` / `spawned` getters) — the same shape as the other 盟约专属 cards.

import { isMember, baseChessId, bondLayers, tierOf, passiveBuff, battleStore } from '../support/index.js';

/** 卡 id（模块自己的查表键）。 */
const CARD = 'hex_kazimierz_knightgold';
/** 卡面 effect 里那段参数的名字。 */
const SPEC = 'kazimierzKnightGold';
/** 【卡西米尔】核心盟约 id（成员资格 / 层数都读它）。 */
const BOND = 'kazimierzShip';
/** 5 名档面板加成的 buff 键（条件不满足时按同一个键撤销）。 */
const HIGH_KEY = 'hex:knightgold:high';
/** 7 名档金币伤害的 buff 键。 */
const DMG_KEY = 'hex:knightgold:dmg';
/** 运行时刷怪的 tag（spawns.js：tag 不是 'boss' / 'part' ⇒ counted，但 inTotal 仍为 false）。 */
const SPAWN_TAG = 'hex:knightgold';
/** 击杀计数 / 已发放金币的 per-battle store 命名空间（按玩家分开：联防场上两名玩家各有各的卡）。 */
const STORE = 'hexcards:knightgold';

/**
 * 设计稿 §2 的兜底值：只在卡面缺这一格时用。数值一律以卡面为准，这里只为「记录比模块旧」的战斗兜底。
 */
const FALLBACK = Object.freeze({
  killStep: 4, goldBase: 1, goldPerLayer: 50, goldCap: 9,
  highCount: 5, atkFlat: 30, atkPerLayer: 1, rangeExtend: 1, sevenCount: 7,
});

/** 卡面 `enemyTiers` 缺席时的兜底刷怪表（设计稿 §2 的同一份：累计，`min <= L` 的每一档各刷 count 只）。 */
const TIER_FALLBACK = Object.freeze([
  Object.freeze({ min: 0, key: 'enemy_1183_mlasrt', count: 1 }),
  Object.freeze({ min: 50, key: 'enemy_1183_mlasrt', count: 1 }),
  Object.freeze({ min: 100, key: 'enemy_1184_cadkgt_3', count: 1 }),
  Object.freeze({ min: 200, key: 'enemy_1513_dekght', count: 1 }),
  Object.freeze({ min: 300, key: 'enemy_1513_dekght_2', count: 1 }),
]);

/**
 * 读卡面一个数：`Number()` 之后必须是有限的、≥ 0 的数，否则用兜底。
 *
 * 刻意**不用** `hooks.optNumber` —— 它只接受 `> 0`，而这张卡的 `atkPerLayer` / `goldBase` 这类格子写成 0 是合法口径
 * （「不随层数增长」「每场不给金币」）。
 * @param {any} spec 卡面 `params.kazimierzKnightGold`
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 */
function numOf(spec, key, fallback) {
  if (!spec || typeof spec !== 'object') return fallback;
  const raw = spec[key];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

/**
 * 卡面里的刷怪表：只收「min 是有限 ≥ 0 的数、key 是非空字符串」的档（count 缺省 1）。
 * 卡面**给了**数组就用它（哪怕是空表 ⇒ 不刷怪）；完全没有这一格才退回设计稿的兜底表。
 * @param {any} spec 卡面 `params.kazimierzKnightGold`
 * @returns {{min:number, key:string, count:number}[]}
 */
function tiersOf(spec) {
  const raw = spec && spec.enemyTiers;
  if (!Array.isArray(raw)) return TIER_FALLBACK.map((t) => ({ ...t }));
  const out = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const key = typeof t.key === 'string' ? t.key : '';
    if (!key) continue;
    const min = Number(t.min);
    if (!Number.isFinite(min) || min < 0) continue;
    const count = Number(t.count);
    out.push({ min, key, count: Number.isFinite(count) && count >= 0 ? Math.round(count) : 1 });
  }
  return out;
}

/**
 * 卡西米尔 ·【骑士金神】hex_kazimierz_knightgold（2 阶 / gold，requiresBond: kazimierzShip）的战斗半边。
 * 口径与逐条 [ASSUMED] 见文件头；卡面参数见设计稿 §2。
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number|{owners:number,kills:number,coins:number,spawned:number}} 0 when the card is absent, else the live handle
 */
export function installKazimierzKnightGold(hooks) {
  if (!hooks || typeof hooks !== 'object') return 0;
  const { battle, ownersOf, specOf } = hooks;
  if (!battle || typeof battle.on !== 'function') return 0;
  if (typeof ownersOf !== 'function') return 0;
  const owners = ownersOf(CARD);
  if (!owners || !owners.length) return 0;
  const owned = new Set(owners);

  /** 「在场」：沿用 hexHooks.onField 的口径（alive && deployed && !hidden）。 */
  const isField = typeof hooks.onField === 'function'
    ? hooks.onField
    : (u) => !!u && !!u.alive && !!u.deployed && !u.hidden;

  /** 每个拥有者的卡面参数（只读一次；数值都是设计稿 §2 的兜底，调数只改卡面）。 */
  const plan = new Map();
  for (const pid of owners) {
    const spec = typeof specOf === 'function' ? specOf(pid, CARD, SPEC) : null;
    plan.set(pid, {
      // 击杀金币
      killStep: Math.max(1, Math.round(numOf(spec, 'killStep', FALLBACK.killStep))),
      goldBase: Math.max(0, Math.round(numOf(spec, 'goldBase', FALLBACK.goldBase))),
      goldPerLayer: Math.max(1, Math.round(numOf(spec, 'goldPerLayer', FALLBACK.goldPerLayer))),
      goldCap: Math.max(0, Math.round(numOf(spec, 'goldCap', FALLBACK.goldCap))),
      // 5 名档
      highCount: Math.max(1, Math.round(numOf(spec, 'highCount', FALLBACK.highCount))),
      atkFlat: numOf(spec, 'atkFlat', FALLBACK.atkFlat),
      atkPerLayer: numOf(spec, 'atkPerLayer', FALLBACK.atkPerLayer),
      rangeExtend: Math.max(0, Math.round(numOf(spec, 'rangeExtend', FALLBACK.rangeExtend))),
      tiers: tiersOf(spec),
      // 7 名档
      sevenCount: Math.max(1, Math.round(numOf(spec, 'sevenCount', FALLBACK.sevenCount))),
    });
  }

  /** 拥有者的己方【卡西米尔】干员（召唤物 / 器械 / 队友的干员都不算）。 */
  const isCarrier = (u) => !!u && u.kind === 'op' && u.side === 'ally' && owned.has(u.ownerId) && isMember(battle, u, BOND);
  /** 拥有者 pid 的**在场**【卡西米尔】干员。 */
  const onFieldCarriers = (pid) => battle.allyUnits.filter((u) => u && u.ownerId === pid && isCarrier(u) && isField(u));
  /** N：场上己方【卡西米尔】干员按 `baseChessId` 去重的「不同干员数」。 */
  const distinctCount = (pid) => {
    const seen = new Set();
    for (const u of onFieldCarriers(pid)) seen.add(baseChessId(u));
    return seen.size;
  };
  /** 实时【卡西米尔】层数（L）。 */
  const layersOf = (pid) => bondLayers(battle, pid, BOND);

  let kills = 0, coins = 0, spawned = 0;

  // ===================================================================================================================
  // 击杀金币（无门槛）：全队共享计数，每 killStep 杀 +1 金，每场上限 min(goldCap, goldBase + floor(L/goldPerLayer))

  /** pid → `{ kills, paid }`。挂在 per-battle store 上 ⇒ 跨干员共享、跨死亡保留。 */
  const storeOf = (pid) => battleStore(battle, `${STORE}:${pid}`, () => ({ kills: 0, paid: 0 }));
  /** 本场这名玩家最多能发多少金（L 取实时层数）。 */
  const goldCapNow = (pid) => {
    const p = plan.get(pid);
    if (!p) return 0;
    return Math.min(p.goldCap, p.goldBase + Math.floor(layersOf(pid) / p.goldPerLayer));
  };

  battle.on('kill', (c) => {
    const killer = c && c.killer;
    const victim = c && c.victim;
    if (!killer || !victim || victim.side !== 'enemy') return;
    if (!isCarrier(killer)) return;                  // 「〖卡西米尔〗干员击杀」：干员亲手打死，召唤物 / 无来源不算
    const pid = killer.ownerId;
    const p = plan.get(pid);
    if (!p) return;
    const st = storeOf(pid);
    st.kills++;
    kills++;
    const cap = goldCapNow(pid);
    // 一次多杀（技能一波清场）也要把该补的金补齐；`paid` 记的是本场**已经发出去**的枚数，所以到上限后自然停手。
    while (st.paid < cap && st.kills >= (st.paid + 1) * p.killStep) {
      if (!(battle.addCoins(pid, 1) > 0)) break;     // addCoins 在玩家不在场时返回 0（不记已发）
      st.paid++;
      coins++;
    }
  });

  // ===================================================================================================================
  // 5 名档 · 敌人增加：battleStart 按 enemyTiers 累计刷怪（运行时刷怪，不进 HUD 分母 / 预览）

  const spawnWave = (pid) => {
    const p = plan.get(pid);
    if (!p) return;
    if (distinctCount(pid) < p.highCount) return;    // 「在场 5 名不同〖卡西米尔〗干员」
    const L = layersOf(pid);
    for (const t of p.tiers) {
      if (L < t.min) continue;                       // 累计：min ≤ L 的每一档各刷 count 只
      for (let i = 0; i < t.count; i++) {
        // routeIndex: 0 = 本关第一条路线（与设计稿 §3.2 一致）；tag 只做标记，inTotal 保持 false。
        const e = battle.spawnEnemy(t.key, { routeIndex: 0, tag: SPAWN_TAG });
        if (e) spawned++;
      }
    }
  };

  // ===================================================================================================================
  // 5 名档 · 等阶最高：并列最高的己方【卡西米尔】干员挂 atkFlat / rangeExtend 常驻 buff

  /** 场上己方【卡西米尔】里 `tierOf` 最高的那些（并列都算）。 */
  const topOf = (pid) => {
    const list = onFieldCarriers(pid);
    let best = 0;
    for (const u of list) best = Math.max(best, tierOf(u));
    const tops = new Set();
    for (const u of list) if (tierOf(u) === best) tops.add(u);
    return tops;
  };

  /** 按**给定层数**复核面板 buff（幂等：`passiveBuff` 同名替换；条件不满足就撤销）。 */
  const applyHigh = (pid, L) => {
    const p = plan.get(pid);
    if (!p) return;
    const on = distinctCount(pid) >= p.highCount;
    const tops = on ? topOf(pid) : null;
    const atkFlat = p.atkFlat + p.atkPerLayer * L;
    for (const u of battle.allyUnits) {
      if (!u || u.ownerId !== pid || !isCarrier(u)) continue;
      if (tops && tops.has(u)) {
        passiveBuff(battle, u, HIGH_KEY, { atkFlat, rangeExtend: p.rangeExtend }, { tags: ['hex'] });
      } else if (typeof u.findBuff === 'function' && u.findBuff(HIGH_KEY)) {
        battle.removeBuff(u, HIGH_KEY);
      }
    }
  };
  /** 按**当前**层数复核。 */
  const refreshHigh = (pid) => applyHigh(pid, layersOf(pid));

  // ===================================================================================================================
  // 7 名档 · 金币伤害：读本卡 params.battle.dmgPct，给所有己方干员挂 dmgDealtMul

  /** 本卡 EffectRef 的 `params.battle.dmgPct`（备战侧 goldDamage 写入、goldDamageReset 清零）；非正数 ⇒ 0。 */
  const dmgPctOf = (pid) => {
    const spec = typeof specOf === 'function' ? specOf(pid, CARD, 'battle') : null;
    const v = spec ? Number(spec.dmgPct) : NaN;
    return Number.isFinite(v) && v > 0 ? v : 0;
  };

  /** 复核金币伤害 buff：N ≥ 7 且 dmgPct > 0 才挂，否则撤销。目标 = **所有**己方干员（不只卡西米尔）。 */
  const refreshDmg = (pid) => {
    const p = plan.get(pid);
    if (!p) return;
    const pct = distinctCount(pid) >= p.sevenCount ? dmgPctOf(pid) : 0;
    const mul = 1 + pct / 100;
    for (const u of battle.allyUnits) {
      if (!u || u.kind !== 'op' || u.side !== 'ally' || u.ownerId !== pid) continue;
      if (pct > 0) passiveBuff(battle, u, DMG_KEY, { dmgDealtMul: mul }, { tags: ['hex'] });
      else if (typeof u.findBuff === 'function' && u.findBuff(DMG_KEY)) battle.removeBuff(u, DMG_KEY);
    }
  };

  // ===================================================================================================================
  // 刷新时机

  // battleStart（优先级 -10：排在盟约自己的开场效果之后，这样层数与初始部署都已经就位）
  battle.on('battleStart', () => {
    for (const pid of owners) {
      spawnWave(pid);
      refreshHigh(pid);
      refreshDmg(pid);
    }
  }, { priority: -10 });

  // 战斗中途部署的干员：N 可能刚跨过 5 名 / 7 名档，新干员也可能是新的最高阶 / 需要补装金币伤害。
  // （初始部署发生在 battleStart 之前，那时由上面那一段统一装。）
  battle.on('deploy', (c) => {
    const u = c && c.unit;
    if (!u || u.kind !== 'op' || u.side !== 'ally' || !owned.has(u.ownerId)) return;
    refreshHigh(u.ownerId);
    refreshDmg(u.ownerId);
  });

  // 层数变化（本卡自己不叠层，但别的来源会给【卡西米尔】加层）：面板按新 L 重算。
  // 加层在钩子**之后**才写进 ps.bonds，所以先按「当前 + 这一笔」的投影刷一次（同一 tick 就能吃到新层数），
  // 再在结算后按真实层数对一次账（被 999 上限削掉的层数不会留下一个错的数值）。
  battle.on('layerGain', (c) => {
    if (!c || c.bondId !== BOND || !owned.has(c.playerId)) return;
    const pid = c.playerId;
    const n = Math.max(0, Number(c.n) || 0);
    applyHigh(pid, layersOf(pid) + n);
    if (typeof battle.after === 'function') battle.after(0, () => applyHigh(pid, layersOf(pid)));
  }, { priority: -100 });

  return {
    get owners() { return owners.length; },
    get kills() { return kills; },
    get coins() { return coins; },
    get spawned() { return spawned; },
  };
}
