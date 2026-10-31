// server/sim/content/hexcards/stone_yan_beasts.js — 第二十批（业主 2026-10-31）：炎 ·【炎百兽】
// (hex_yan_beasts, 2 阶 / gold / requiresBond: yanShip) 的战斗半边。
//
// 设计稿：04-文档/协议源石-专属协议-衰朽的骄矜与炎百兽-设计稿-20261031.md §2。
// 业主原文（逐字）：
//   技力消耗＋5％。装备天师炉鼎时无视技力消耗增加。
//   战斗开始时召唤对应炎干员的炎佑两者生命共享，该炎佑属性为对应干员的80%（随层数增长）。
//   <在场5名不同炎干员>
//   技力消耗额外＋5％
//   炎干员每秒回复20生命（随层数增长）
//   在场7名不同炎干员
//   技力消耗额外＋5％
//   炎佑的祛恶之焰改成锁定2个目标持续施法，最多持续20秒，每秒对目标周围半径1范围内的所有敌方单位造成攻击力60%（随层数增长）的法术伤害。
//
// 数值全部读卡面 `params.yanBeasts`（tools/hextech/roster.mjs），这里只写行为 —— 调数不改代码。
//
// 口径（设计稿 §2.3，逐条对应下面的实现注释）：
//   * 作用域：拥有该卡的玩家自己的【炎】干员（`isMember(battle, u, 'yanShip')` + `u.ownerId === pid`）。
//     N = 场上（活着 / 已部署 / 未隐匿）己方【炎】干员按 `baseChessId` 去重后的数量 —— 同名干员的普通 / 精锐只算一个。
//     N 在 `battleStart` 时算一次（本场不变），5 名 / 7 名档的阈值读卡面的 `regenCount` / `flameCount`。
//   * 技力消耗：每名己方【炎】干员 `u.skill.spCostMul ×= 1 + (spCostPct + 5 名档 + 7 名档) / 100`；装备【天师古鼎】
//     （`itemKeyOf === censerKey`）的干员跳过。`spCostMul` 是 Skill 实例上的可变字段（`reset()` 不还原它），
//     写一次即可 —— 用 `skill.hexYanBeastsSp` 防重复乘（与 batch15b 的 installOldPower 同一条写法）。
//     `deploy` 钩子给战斗中途部署的干员补装（初始部署发生在 `battleStart` **之前**，所以那时不装、由 battleStart 统一装）。
//   * 战斗开始时召唤（`battleStart` 优先级 -10，排在【炎】盟约自己的召唤之后）：对每名在场己方【炎】干员
//     `spawnYanyou(battle, pid, { atk: u.s.atk × pct, hp: u.s.maxHp × pct, count: 1 })`，`pct = (summonPct +
//     summonPerLayerPct × L) / 100` —— spawnYanyou 把这两个数**加到模板属性上**（PRTS「最终加算」）。
//     防御 / 法抗另有口径（业主 2026-11-01「防御力/法抗 100% 继承」）：`def` / `res` **直接等于**对应干员的
//     def / res（比例读卡面 `inheritDefPct` / `inheritResPct`，缺省 100），**替换** token 模板的 200 / 0；
//     与 atk / hp 同一时点（召唤那一刻），之后干员面板变化不回溯。
//   * 生命共享（同血池口径，业主 §0）：配对的一人一兽，**两个方向、掉血回血都共享** ——
//     - 掉血：任一方受到 HP 伤害时对另一方 `battle.loseHp(other, amount, { tags: ['hpLoss', 'hex:yanbeasts:share'] })`
//       —— 同样数值，不是 50/50 分摊。带 `hex:yanbeasts:share` 的流失不再镜像（防递归），元素损伤
//       （`type === 'element'`）不是 HP 伤害、不参与。炎佑是友方召唤物，引擎不给它别的来源的治疗，`loseHp` 不受影响。
//     - 回血（业主 2026-11-01「干员被回血对应的炎佑不回血」）：任一方被治疗时，另一方按**实际落下的治疗量**同样回复
//       （比例读卡面 `shareHealPct`，默认 100 = 同血池的同样数值），见下面 `heal` 钩子那段注释。
//   * 5 名档：每名在场己方【炎】干员挂常驻 buff `hex:yanbeasts:regen`，`mods: { hpRegen: regen + regenPerLayer × L }`
//     （引擎的每秒生命回复属性 `s.hpRegen`）。层数变化（`layerGain`）后按新层数刷新（同名 buff `refresh: 'replace'`）。
//   * 7 名档：对**所有**己方炎佑（原【炎】盟约召唤的 + 本卡召唤的）设置运行时覆盖 `u.mem.flameTargets = flameTargets`
//     与 `u.mem.flameScaleFn = () => (flameScale + flameScalePerLayer × L) / 100` —— tokens.js 的 `yanyouKit` 已经
//     读这两个字段（onStart 锁 `flameTargets` 个目标、onTick 用 `flameScaleFn()` 当伤害倍率）。7 名档未达成时不设置，
//     炎佑就保持数据里的 1 目标 / 60%。
//
// [ASSUMED]（设计稿里点名的两处，加上实现时定下的四处）：
//   1. 干员阵亡时配对的那只炎佑一起撤退（`battle.retreat(y, { reason: 'retreat', permanent: true })`）；反方向不做 ——
//      炎佑先死不会带走干员（干员还有自己的血条与再部署）。
//   2. 「在场」沿用 `hexHooks.onField`（`alive && deployed && !hidden`）。
//   3. 生命共享对**任何** HP 伤害生效（普攻 / 技能 / 反伤 / 流失都算，只有元素损伤与共享自身的流失例外）——
//      卡面写的是「两者生命共享」，没有限定来源。
//   4. 技力消耗的 5 名 / 7 名档阈值直接读卡面的 `regenCount` / `flameCount`（卡面只有这两个档位数字，不另造参数）。
//   5. 防御 / 法抗继承（业主 2026-11-01 口头拍板，卡面原文只写了「属性为对应干员的 80%」的攻击力 / 生命值）：
//      炎佑的 def / res **直接等于**对应干员（100%，替换模板的 200 / 0），比例走卡面参数，缺省 100。
//   6. 「回血共享」的比例卡面没写：按同血池的「同样数值」（`shareHealPct` 缺省 100）实现，并连 5 名档的每秒回血
//      （引擎的 `hpRegen` 走 heal，`opts.regen`）一起镜像 —— 业主说的「回血」不限于医疗干员的治疗。
//
// 确定性：无 Math.random / Date / Node API；计时只用 battle.every / battle.after。
//
// CONTRACT: export function installYanBeasts(hooks) — hooks is the shared `hexHooks(battle)` bundle
// (server/sim/content/hexcards/hooks.js). Returns 0 when the card is absent, else a count of covered operators.

import { isMember, bondLayers, baseChessId, itemsOf, itemKeyOf, passiveBuff, TOKEN_IDS } from '../support/index.js';
import { spawnYanyou } from '../tokens.js';

/** 卡 id（模块自己的查表键）。 */
const CARD = 'hex_yan_beasts';
/** 卡面 effect 里那段参数的名字。 */
const SPEC = 'yanBeasts';
/** 【炎】核心盟约 id（成员资格 / 层数都读它）。 */
const BOND = 'yanShip';
/** 5 名档常驻回血的 buff 键。 */
const REGEN_KEY = 'hex:yanbeasts:regen';
/** 生命共享那条流失的 tag：带它的流失不再镜像（防递归）。 */
const SHARE_TAG = 'hex:yanbeasts:share';
/** 生命共享那条**回复**的标记（挂在 `battle.heal` 的 opts 上）：带它的回复不再镜像（防递归）。 */
const SHARE_HEAL = 'hexYanBeastsShare';
/** 技力消耗只乘一次的 flag（挂在 Skill 实例上；`reset()` 不会还原 `spCostMul`）。 */
const SP_FLAG = 'hexYanBeastsSp';

/**
 * 设计稿 §2.2 的兜底值：只在卡面缺这一格时用。数值一律以卡面为准，这里只为「记录比模块旧」的战斗兜底。
 */
const FALLBACK = Object.freeze({
  spCostPct: 5, spCostTierPct: 5, censerKey: 'chess_item_6_03_e',
  summonPct: 80, summonPerLayerPct: 0.4,
  // 防御 / 法抗继承比例（业主 2026-11-01「防御力/法抗 100% 继承」）：缺省 100 = 炎佑的 def / res 直接等于对应干员的。
  inheritDefPct: 100, inheritResPct: 100,
  // 生命共享的回复比例：卡面没写比例（只写了属性 80%），设计稿 §0 定的「同血池」是**同样数值**，所以 100。
  // 业主若要按 80% 走，roster 里给 `yanBeasts.shareHealPct` 一个数即可，模块不用改。
  shareHealPct: 100,
  regenCount: 5, regen: 20, regenPerLayer: 0.5,
  flameCount: 7, flameTargets: 2, flameScale: 60, flameScalePerLayer: 0.2,
});

/**
 * 读卡面一个数：`Number()` 之后必须是有限、≥ 0 的数，否则用兜底。
 *
 * 刻意**不用** `hooks.optNumber` —— 它只接受 `> 0`，而这张卡的参数里有 0.4 / 0.2 这类小数（用 optNumber 会被
 * 当成缺省），也有 0 是合法口径的格子（「不额外加技力消耗」）。
 * @param {any} spec 卡面 `params.yanBeasts`
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 */
function numOf(spec, key, fallback) {
  const v = Number(spec ? spec[key] : NaN);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

/**
 * 炎 ·【炎百兽】hex_yan_beasts（2 阶 / gold，requiresBond: yanShip）的战斗半边。
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number} 没有这张卡 ⇒ 0；有卡 ⇒ 被这张卡覆盖的己方【炎】干员数（安装时的名册，含未部署的）
 */
export function installYanBeasts(hooks) {
  if (!hooks || typeof hooks !== 'object') return 0;
  const { battle, ownersOf, specOf } = hooks;
  if (!battle || typeof battle.on !== 'function') return 0;
  if (typeof ownersOf !== 'function') return 0;
  const owners = ownersOf(CARD);
  if (!owners || !owners.length) return 0;
  const owned = new Set(owners);
  /** 在场：沿用 hexHooks.onField 的口径（alive && deployed && !hidden）。 */
  const isField = typeof hooks.onField === 'function'
    ? hooks.onField
    : (u) => !!u && !!u.alive && !!u.deployed && !u.hidden;

  /** ownerId → 这张卡的参数（只读一次）。 */
  const plan = new Map();
  for (const pid of owners) {
    const spec = typeof specOf === 'function' ? specOf(pid, CARD, SPEC) : null;
    plan.set(pid, {
      spCostPct: numOf(spec, 'spCostPct', FALLBACK.spCostPct),
      spCostTierPct: numOf(spec, 'spCostTierPct', FALLBACK.spCostTierPct),
      censerKey: spec && typeof spec.censerKey === 'string' && spec.censerKey ? spec.censerKey : FALLBACK.censerKey,
      summonPct: numOf(spec, 'summonPct', FALLBACK.summonPct),
      summonPerLayerPct: numOf(spec, 'summonPerLayerPct', FALLBACK.summonPerLayerPct),
      shareHealPct: numOf(spec, 'shareHealPct', FALLBACK.shareHealPct),
      inheritDefPct: numOf(spec, 'inheritDefPct', FALLBACK.inheritDefPct),
      inheritResPct: numOf(spec, 'inheritResPct', FALLBACK.inheritResPct),
      regenCount: Math.max(0, Math.round(numOf(spec, 'regenCount', FALLBACK.regenCount))),
      regen: numOf(spec, 'regen', FALLBACK.regen),
      regenPerLayer: numOf(spec, 'regenPerLayer', FALLBACK.regenPerLayer),
      flameCount: Math.max(0, Math.round(numOf(spec, 'flameCount', FALLBACK.flameCount))),
      flameTargets: Math.max(1, Math.round(numOf(spec, 'flameTargets', FALLBACK.flameTargets))),
      flameScale: numOf(spec, 'flameScale', FALLBACK.flameScale),
      flameScalePerLayer: numOf(spec, 'flameScalePerLayer', FALLBACK.flameScalePerLayer),
    });
  }

  /** 拥有者的己方【炎】干员（召唤物 / 队友的干员都不算）。 */
  const isYanOp = (u) => !!u && u.kind === 'op' && u.side === 'ally' && owned.has(u.ownerId) && isMember(battle, u, BOND);
  /** 拥有者的己方炎佑（原盟约召唤的与本卡召唤的是同一个 token id）。 */
  const isYanyou = (u) => !!u && u.kind === 'token' && u.side === 'ally' && owned.has(u.ownerId) && u.defId === TOKEN_IDS.yanyou;

  /** ownerId → `{ n }`：在场【炎】干员数（按 baseChessId 去重），battleStart 时算一次。 */
  const tiers = new Map();
  /** 同血池配对：干员 ↔ 炎佑（两个方向都写进同一张表，查一次就够）。 */
  const pairOf = new Map();
  /** battleStart 的档位算完之后才允许 deploy 补装（初始部署发生在 battleStart 之前）。 */
  let ready = false;

  /** 场上己方【炎】干员数（按 baseChessId 去重：「不同干员」= 同名干员的普通 / 精锐只算一个）。 */
  const countYan = (pid) => {
    const seen = new Set();
    for (const u of battle.allyUnits) {
      if (!u || u.ownerId !== pid || !isYanOp(u) || !isField(u)) continue;
      const base = baseChessId(u);
      if (base) seen.add(base);
    }
    return seen.size;
  };

  /** 技力消耗的倍率：常驻 +spCostPct%，5 名 / 7 名档各再 +spCostTierPct%。 */
  const spMulOf = (pid) => {
    const p = plan.get(pid);
    const t = tiers.get(pid);
    if (!p || !t) return 1;
    const pct = p.spCostPct
      + (t.n >= p.regenCount ? p.spCostTierPct : 0)
      + (t.n >= p.flameCount ? p.spCostTierPct : 0);
    return 1 + pct / 100;
  };

  /** 装备【天师古鼎】的【炎】干员豁免（`itemKeyOf` 把 `_a` / `_b` 收成同一个键）。 */
  const wearsCenser = (u) => {
    const p = plan.get(u.ownerId);
    return !!p && itemsOf(u).some((id) => itemKeyOf(id) === p.censerKey);
  };

  /**
   * 防御 / 法抗继承（业主 2026-11-01「防御力/法抗 100% 继承」）：炎佑的 def / res **直接等于**对应干员的 def / res，
   * 比例读卡面 `inheritDefPct` / `inheritResPct`（缺省 100 = 100%，不是攻击力/生命值那 80%）。
   *
   * 时点与 atk / hp 完全一致：只取**召唤那一刻**的干员面板（`u.s.def` / `u.s.res`，含当时已有的 buff），
   * 之后干员的面板变化不会回写到已经登场的炎佑 —— spawnYanyou 对 atk / hp 也是同一口径（只写一次 u.base），
   * 本模块也没有任何重算。
   *
   * 比例 0 ⇒ **不传**（炎佑沿用 token 模板的 200 防御 / 0 法抗，等于「不继承」）；比例 > 0 时即使干员 def 是 0
   * 也照传 —— 「直接等于」意味着 0 防御的干员，它的炎佑也是 0 防御。
   * [ASSUMED] 卡面文字没写这一条（业主 2026-11-01 口头拍板），比例做成参数是为了以后调数不改代码。
   */
  const inheritOf = (p, u) => {
    const out = {};
    const defPct = p.inheritDefPct / 100;
    const resPct = p.inheritResPct / 100;
    if (defPct > 0) out.def = Math.max(0, u.s.def) * defPct;
    if (resPct > 0) out.res = Math.max(0, u.s.res) * resPct;
    return out;
  };

  /** 技力消耗 ×倍率（写一次；`skill.hexYanBeastsSp` 防重复乘）。 */
  const applySpCost = (u) => {
    if (!isYanOp(u)) return;
    const sk = u.skill;
    if (!sk || sk.noSkill) return;
    if (sk[SP_FLAG]) return;
    sk[SP_FLAG] = true;
    if (wearsCenser(u)) return;                        // 「装备天师炉鼎时无视技力消耗增加」
    const mul = spMulOf(u.ownerId);
    if (!(mul > 1)) return;
    sk.spCostMul = sk.spCostMul * mul;
  };

  /** 5 名档：常驻回血 buff（层数变化时同名替换刷新）。 */
  const applyRegen = (u) => {
    if (!isYanOp(u)) return;
    const p = plan.get(u.ownerId);
    const t = tiers.get(u.ownerId);
    if (!p || !t) return;
    if (t.n < p.regenCount) {
      if (typeof u.findBuff === 'function' && u.findBuff(REGEN_KEY)) battle.removeBuff(u, REGEN_KEY);
      return;
    }
    const v = p.regen + p.regenPerLayer * bondLayers(battle, u.ownerId, BOND);
    passiveBuff(battle, u, REGEN_KEY, { hpRegen: v }, { tags: ['hex'] });
  };

  /** 7 名档：给一只己方炎佑装上「2 目标 + 随层数增长的伤害倍率」覆盖。 */
  const applyFlame = (u) => {
    if (!isYanyou(u)) return;
    const p = plan.get(u.ownerId);
    const t = tiers.get(u.ownerId);
    if (!p || !t) return;
    if (t.n < p.flameCount) return;                    // 7 名档未达成 ⇒ 不设置（保持数据里的 1 目标 / 60%）
    const pid = u.ownerId;
    u.mem.flameTargets = p.flameTargets;
    u.mem.flameScaleFn = () => (p.flameScale + p.flameScalePerLayer * bondLayers(battle, pid, BOND)) / 100;
  };

  /** 按**当前**层数刷新一个（或全部）拥有者的 5 名档回血与 7 名档覆盖。 */
  const refresh = (pid = null) => {
    for (const u of battle.allyUnits) {
      if (!u || (pid != null && u.ownerId !== pid)) continue;
      if (isYanOp(u)) applyRegen(u);
      else if (isYanyou(u)) applyFlame(u);
    }
  };

  // ---- 战斗开始时：算档位 → 技力消耗 → 召唤 + 同血池 → 7 名档 → 5 名档 -------------------------------------------
  // 优先级 -10：排在【炎】盟约自己的 battleStart 召唤（优先级 0）之后，于是「原盟约的炎佑 + 本卡召唤的炎佑」
  // 都能吃到 7 名档的覆盖。
  battle.on('battleStart', () => {
    for (const pid of owners) {
      const p = plan.get(pid);
      tiers.set(pid, { n: countYan(pid) });
      // 1) 技力消耗（之后部署的由 deploy 钩子补装）
      for (const u of battle.allyUnits.slice()) if (u.ownerId === pid) applySpCost(u);
      // 2) 每名在场己方【炎】干员各召唤一只炎佑，并与其同血池共享
      const L = bondLayers(battle, pid, BOND);
      const pct = Math.max(0, (p.summonPct + p.summonPerLayerPct * L) / 100);
      for (const u of battle.allyUnits.slice()) {
        if (u.ownerId !== pid || !isYanOp(u) || !isField(u)) continue;
        const out = spawnYanyou(battle, pid, { atk: u.s.atk * pct, hp: u.s.maxHp * pct, ...inheritOf(p, u), count: 1 });
        const y = out && out[0];
        if (!y) continue;
        pairOf.set(u, y);
        pairOf.set(y, u);
        applyFlame(y);                                   // 本卡召唤的：spawn 之后立刻设置（7 名档）
      }
    }
    // 3) 原【炎】盟约召唤的炎佑（以及任何在别处召唤出来的）统一补 7 名档覆盖
    for (const u of battle.allyUnits.slice()) applyFlame(u);
    // 4) 5 名档回血
    for (const u of battle.allyUnits.slice()) applyRegen(u);
    ready = true;
  }, { priority: -10 });

  // ---- 战斗中途部署的干员 / 召唤物补装 -------------------------------------------------------------------------
  battle.on('deploy', (c) => {
    const u = c && c.unit;
    if (!u || !ready) return;                            // 初始部署在 battleStart 之前：交给 battleStart 统一装
    if (isYanOp(u)) { applySpCost(u); applyRegen(u); return; }
    applyFlame(u);
  });

  // ---- 层数变化：刷新 5 名档回血与 7 名档倍率 ----------------------------------------------------------------
  battle.on('layerGain', (c) => {
    if (!c || c.bondId !== BOND || !owned.has(c.playerId)) return;
    // 加层在钩子**之后**才写进 ps.bonds：这一笔结算完再按真实层数对账（被 999 上限削掉的层数不会留下错的数值）
    if (typeof battle.after === 'function') battle.after(0, () => refresh(c.playerId));
  }, { priority: -100 });

  // ---- 生命共享（同血池口径） ---------------------------------------------------------------------------------
  battle.on('damaged', (c) => {
    if (!c || c.type === 'element') return;              // 元素损伤不是 HP 伤害
    const dmg = c.dmg;
    if (dmg && Array.isArray(dmg.tags) && dmg.tags.includes(SHARE_TAG)) return;   // 共享自己造成的流失不再镜像
    const t = c.target;
    const other = t ? pairOf.get(t) : null;
    if (!other || !other.alive) return;
    const amount = Number(c.amount);
    if (!(amount > 0)) return;
    battle.loseHp(other, amount, { tags: ['hpLoss', SHARE_TAG] });
  });

  // ---- 生命共享 · 回复方向（业主 2026-11-01：「干员被回血对应的炎佑不回血」） -----------------------------------
  // 「两者生命共享」是双向的：掉血双向镜像（上面那条 damaged），**回血也要双向镜像**。
  //
  // 引擎的 heal 钩子在**写 HP 之前**触发，`c.amount` 是即将落下的量（已经乘过治疗加成），所以这里先按引擎自己的
  // 口径算出「实际能落下的量」（`min(amount, 上限 − 当前)`）再镜像 —— 超量治疗不会给另一方凭空造血。
  //
  // 镜像走 `battle.heal(other, other, …)`（自己治自己）：
  //   * 炎佑是友方召唤物（`kind !== 'op'`），引擎的 heal 有一条规则「友方召唤物收不到别人的治疗」（damage.js
  //     heal: `target.side === 'ally' && target.kind !== 'op' && !through && !self` 直接返回 0）—— 这就是设计稿说的
  //     【禁疗】。**自我回复**不受这条规则限制，所以镜像用 source === target 才能真的把炎佑那条血条抬起来。
  //   * `regen: true`：这是「同一个血池里的血量移动」，不是一次新的治疗能力 —— 不再乘一遍受治疗者的
  //     `healingDealtMul`（引擎的自我治疗会吃自己那份治疗量加成）、也不受禁疗影响；治疗量与治疗加成已经在原来那一次
  //     heal 里算过了。
  //   * `SHARE_HEAL` 标记：镜像出来的这次 heal 也会触发本钩子，带标记就直接返回（防递归）。
  //
  // 比例读卡面 `shareHealPct`（默认 100 = 同血池的「同样数值」，与掉血那条一致；卡面没写治疗比例）。
  // [ASSUMED] 5 名档的每秒回血（`hpRegen`，引擎按 `opts.regen` 走 heal）也算「回血」，同样镜像。
  battle.on('heal', (c) => {
    if (!c || (c.opts && c.opts[SHARE_HEAL])) return;    // 共享自己发出的回复不再镜像
    const t = c.target;
    const other = t ? pairOf.get(t) : null;
    if (!other || !other.alive || !other.deployed) return;
    const amount = Number(c.amount);
    if (!(amount > 0)) return;
    const actual = Math.max(0, Math.min(amount, t.s.maxHp - t.hp));   // 与引擎同口径：超量治疗不计
    if (!(actual > 0)) return;
    const p = plan.get(other.ownerId);
    const share = (p ? p.shareHealPct : 100) / 100;
    const give = actual * share;
    if (!(give > 0)) return;
    battle.heal(other, other, give, { [SHARE_HEAL]: true, regen: true });
  });

  // ---- 干员阵亡：配对的炎佑一起撤退（[ASSUMED] 设计稿 §2.3 点名的那条） ---------------------------------------
  battle.on('death', (c) => {
    const u = c && c.unit;
    if (!u || u.kind !== 'op') return;                   // 只从干员出发：炎佑先死不会带走干员
    const y = pairOf.get(u);
    if (!y) return;
    pairOf.delete(u);
    pairOf.delete(y);
    if (y.alive) battle.retreat(y, { reason: 'retreat', permanent: true });
  });

  // 安装时的覆盖面（名册里的己方【炎】干员数）：0 只在「没有这张卡」或「一个【炎】干员都没有」时出现。
  let covered = 0;
  for (const u of battle.allyUnits) if (isYanOp(u)) covered++;
  return covered;
}
