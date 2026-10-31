// server/sim/content/hexcards/stone_mode_modules_ra.js — 第二十三批（业主 2026-10-31）：协议源石【特限恢复】
// (hex_mode_modules, 2 阶 / gold / 普通卡) 的 **RA（生息演算）** 特限模组战斗效果。
//
// 设计稿：04-文档/协议源石-突破极限与特限恢复-设计稿-20261031.md §4.3（本文件只做 RA 那一档；ISW / SO 在
// stone_mode_modules_isw.js / 后续模块里，互不 import）。
// 卡面原文（tools/hextech/roster.mjs / data/hextech.json）：
//   「获得时，你的干员解锁 3 级模组（有模组的干员；普通形态也算）；特限模组（ISW / SO / RA）的专属效果在卫戍协议中生效。」
// 设计稿 §4.3 的逐干员表（RA 三行，原文见下面各段的注释）：
//   百炼嘉维尔 RA-A「首次开启技能后，生命上限 / 攻击力 / 防御力提升至 150%」→ hpMul / atkMul / defMul = 1.5（本场永久）
//   异客       RA-A「友方受到自然环境伤害 -100%，自身攻击力 +60%，每秒获得 1 点技力」→ 环境伤害免疫；atkPct +0.6；spRecoveryFlat +1
//   佩佩       RA-A「若携带资源，再部署时间大幅度减少」→ 卫戍协议没有「资源」⇒ 恒定为再部署时间 -50% [ASSUMED]
//
// CONTRACT: export function installModeModulesRa(hooks) — hooks is the shared `hexHooks(battle)` bundle
// (server/sim/content/hexcards/hooks.js)。没有这张卡时返回 0，否则返回活句柄（owners / carriers / boosted / immunized /
// refresh），与其它 stone_* 模块同一个形状。安装只注册 hook：安装时**不改**战斗状态。
//
// 口径：
//   * **作用域**：拥有该卡的玩家自己的**干员** —— `u.kind === 'op' && u.side === 'ally' && u.ownerId` ∈ 拥有者
//     （`hooks.ownersOf('hex_mode_modules')`；生产接线里那个 ownersOf 已经按卡面 `params.modeModules` 的
//     `types` 门控过，模块不再自己读 `types`）。多玩家场上别人的干员一律不算：每个 handler 都先查拥有者。
//   * **哪名干员吃哪条**：按棋子 id 分组（`def.id` 去掉 `_a` / `_b` 后缀后的基名）——
//       嘉维尔 `chess_char_4_23` / `chess_char_5_18`（设计稿给的是 `_b` 精锐记录，普通形态同 id 归一到同一组）
//       异客 `chess_char_6_05`，佩佩 `chess_char_6_06`。
//     [ASSUMED] 设计稿只列了 `_b` 记录；模组只有精锐棋子可选（shared/loadoutRecord.js「golden chess only」），
//     所以 `_a` 形态实际拿不到 RA- 模组，按基名归一只是一层保险，不改变任何可观测行为。
//   * **模组判据**：`u.def.module` 的 `type` 以 `RA-` 开头且 `active === true`。`def.module` 来自
//     shared/loadoutRecord.js（选中模组时 `{ id, name, type: typeName, level, active: true }`；选「不装备」时
//     `{ id: null, type: null, active: false }`）；`simdata.normalizeChess` 只把原始记录留在 `def.raw` 下，所以这里
//     `def.module ?? def.raw.module` 两个位置都读（生产链路上两条都指同一份选中模组）。类型前缀不是 RA-（ISW- / SO- /
//     CEN-X …）或模组未启用 ⇒ 这张卡的 RA 半边对那名干员完全不生效。
//   * **确定性**：没有 Math.random / Date / Node API；不需要计时（全部是被动 + 两个事件钩子）。
//
// [ASSUMED]（逐条；设计稿没写死 / 官方文本在卫戍协议里落不了地的地方）：
//   1. 百炼嘉维尔「首次开启技能后」= 每名干员**每场一次**：`skillStart` 第一次触发时挂常驻 buff，之后同一干员的
//      再开技能不再叠（同一 buff 键 `passiveBuff` 是幂等替换，另用 `u.mem` 的每单位 flag 挡住重复计数）。
//      「提升至 150%」读作**乘算** `hpMul / atkMul / defMul = 1.5`（units.js `_recalc` 的 Πmul 区），所以与其它
//      加算百分比（atkPct 等）相乘而不是相加；生命上限变化时引擎按比例缩放当前 HP。
//   2. 异客「友方受到自然环境伤害 -100%」：
//      * **什么算自然环境伤害**：DamageInfo 的 `tags` 含 `'terrain'`。全仓只有 devices.js 的 `infectionDamage`
//        （活性源石的 tick：无来源真实伤害，注释原文「tagged 'terrain' = 环境伤害」）打这个标签，enemies/leaders.js
//        的「受到来自自然环境的伤害」也读同一个标签；深水区的【水蚀】是 `dot / periodic / deepsea`（devices.js 明确
//        注释「不属于环境伤害」），因此**不**免疫。将来新增的环境伤害来源只要打同一个 `'terrain'` 标签就会自动吃到这条。
//      * **-100%** 按**完全免疫**实现：在 `hit` 钩子（减伤 / 护盾 / 受伤结算之前）里 `dmg.cancel = true`，这次伤害
//        一点血都不掉、也不触发「受到伤害」的后续（受击回复、反伤…）。若将来要改成「减伤 100% 但仍是受到伤害」，
//        改这里一处即可。
//      * **谁保护谁**：拥有者自己的干员（`u.kind === 'op' && u.side === 'ally' && u.ownerId` ∈ 拥有者），不保护召唤物
//        / 装置，也不保护别人的干员。
//      * **光环在不在**：需要该玩家有一名**在场**的异客（`hexHooks.onField` = alive && deployed && !hidden）且其
//        RA- 模组启用；被击倒、等重部署期间光环关闭。
//   3. 异客「自身攻击力 +60%，每秒获得 1 点技力」= 常驻 `passiveBuff`：`atkPct +0.6`（加算百分比，与其它加算 mod
//      同栈）、`spRecoveryFlat +1`（units.js `spRecovery = (b.spRecovery + spRecoveryFlat) × spRecoveryMul`，即每秒
//      多回 1 点技力）。死亡 / 重部署不丢（persist）。
//   4. 佩佩「若携带资源，再部署时间大幅度减少」：卫戍协议没有「资源」概念，按设计稿 §4.3 的第二种落地**恒定**为
//      再部署时间 -50%：`passiveBuff { redeployMul: 0.5 }`（`u.s.redeployMul`，lifecycle.js 用
//      `respawnTime × persist.redeployMul × s.redeployMul` 算复活时间）。「资源」判据整条跳过。
//   5. 数值兜底：卡面 `params.modeModules` 目前只有 `{ level: 3, types: [...] }`，所以这三个干员的数字读卡面里**可选**
//      的覆盖键（`jiaweilMul` / `yikeAtkPct` / `yikeSpRecovery` / `pepeRedeployCutPct`），缺席时用设计稿口径的兜底值
//      ——将来调数只改卡面，不改本文件。

import { passiveBuff } from '../support/index.js';

/** 卡 id（模块自己的查表键）。 */
const CARD = 'hex_mode_modules';
/** 卡面 effect 里那段参数的名字。 */
const SPEC = 'modeModules';
/** 特限模组的类型前缀（RA = 生息演算）。 */
const RA_PREFIX = 'RA-';

/** 百炼嘉维尔那 1.5 倍面板的 buff 键（每名干员一个，本场一次）。 */
const KEY_JIAWEIL = 'hex:modemodules:ra:jiaweil';
/** 异客自身的攻击力 / 技力回复 buff 键。 */
const KEY_YIKE = 'hex:modemodules:ra:yike';
/** 佩佩的再部署时间 buff 键。 */
const KEY_PEPE = 'hex:modemodules:ra:pepe';

/** 设计稿 §4.3 的三组干员（棋子 id 去 `_a` / `_b` 后缀的基名）。 */
const GROUP_JIAWEIL = new Set(['chess_char_4_23', 'chess_char_5_18']);
const GROUP_YIKE = new Set(['chess_char_6_05']);
const GROUP_PEPE = new Set(['chess_char_6_06']);

/**
 * 自然环境伤害的标签（见文件头 [ASSUMED] 2）：devices.js `infectionDamage` 是唯一打它的地方，
 * enemies/leaders.js「受到来自自然环境的伤害」读同一个标签。
 */
const ENV_TAG = 'terrain';

/** 每单位「本场已经吃过嘉维尔那一次」的 flag 名（挂在 `u.mem` 上）。 */
const MEM_ONCE = 'modeModulesRaJiaweil';

/** 读一个卡面数字（0 与小数都算合法值，所以不能用只接受 > 0 的 `hooks.optNumber`）。 */
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

/** 棋子基名（`chess_char_4_23_b` → `chess_char_4_23`），用来对设计稿的分组表。 */
function opKeyOf(u) {
  const id = String(u?.def?.id ?? u?.defId ?? '');
  const base = id || String(u?.def?.baseId ?? '');
  return base.replace(/_[ab]$/, '');
}

/**
 * 这名干员当前装备的**启用的 RA- 特限模组**，否则 null。
 * 生产链路 `def.module`（shared/loadoutRecord.js）；`def.raw.module` 是同一个对象在原始记录里的位置（simdata
 * normalizeChess 只把记录留在 raw 下），两条都读。
 * @param {any} u an ally unit
 * @returns {any|null}
 */
function raModuleOf(u) {
  const m = u && u.def ? (u.def.module ?? u.def.raw?.module) : null;
  if (!m || typeof m !== 'object') return null;
  if (m.active !== true) return null;                       // 未启用 / 选了「不装备」
  if (typeof m.type !== 'string' || !m.type.startsWith(RA_PREFIX)) return null;
  return m;
}

/**
 * 【特限恢复】hex_mode_modules 的 RA（生息演算）特限模组战斗半边。
 * 口径与逐条 [ASSUMED] 见文件头。
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number|{owners:number,carriers:number,boosted:number,immunized:number,refresh:Function}}
 *          0 when the card is absent, else the live handle
 */
export function installModeModulesRa(hooks) {
  const owners = ownersOfCard(hooks, CARD);
  if (!owners) return 0;
  const { battle, specOf, onField } = hooks;
  const owned = new Set(owners);

  /** 每个拥有者的卡面参数（只读一次；缺席的键用设计稿口径的兜底）。 */
  const plan = new Map();
  for (const pid of owners) {
    const spec = typeof specOf === 'function' ? specOf(pid, CARD, SPEC) : {};
    const cut = Math.max(0, numOf(spec, 'pepeRedeployCutPct', 50));   // 再部署时间 -50% ⇒ redeployMul 0.5
    plan.set(pid, {
      jiaweilMul: Math.max(0, numOf(spec, 'jiaweilMul', 150)) / 100,   // 「提升至 150%」⇒ ×1.5
      yikeAtkPct: numOf(spec, 'yikeAtkPct', 60) / 100,                 // +60% ⇒ 0.6（加算百分比）
      yikeSp: numOf(spec, 'yikeSpRecovery', 1),                        // 每秒 +1 技力
      pepeRedeployMul: Math.max(0, 1 - cut / 100),                     // -50% ⇒ ×0.5
    });
  }

  /** 拥有者的己方**干员**（召唤物 / 队友的干员都不算）。 */
  const isOwnOp = (u, pid = null) => !!u && u.kind === 'op' && u.side === 'ally' && owned.has(u.ownerId) && (pid == null || u.ownerId === pid);
  /** 「在场」：与 hexHooks.onField 同一口径（手搓 hooks 时退回同一条判据）。 */
  const isOnField = typeof onField === 'function' ? onField : (u) => !!u && !!u.alive && !!u.deployed && !u.hidden;
  /** 这名干员是不是设计稿某一组的成员（并且当前带着启用的 RA- 模组）。 */
  const isRaCarrier = (u) => isOwnOp(u) && !!raModuleOf(u);
  const inGroup = (u, set) => set.has(opKeyOf(u));

  let boosted = 0;      // 嘉维尔那 1.5 倍触发了几次（应当 ≤ 每名干员 1 次）
  let immunized = 0;    // 被 -100% 吃掉的环境伤害实例数

  /**
   * 常驻面板（异客的攻击力 / 技力回复、佩佩的再部署时间）：对一名干员按它的组挂上。
   * `passiveBuff` 同名替换 ⇒ 反复调用幂等（battleStart / deploy / refresh 都安全）。
   */
  const applySelfPassive = (u) => {
    if (!isOwnOp(u)) return;
    if (!raModuleOf(u)) return;
    const p = plan.get(u.ownerId);
    if (!p) return;
    if (inGroup(u, GROUP_YIKE)) {
      // 异客：自身攻击力 +60%，每秒获得 1 点技力（persist：死亡 / 重部署不丢）
      passiveBuff(battle, u, KEY_YIKE, { atkPct: p.yikeAtkPct, spRecoveryFlat: p.yikeSp }, { tags: ['hex'] });
    } else if (inGroup(u, GROUP_PEPE)) {
      // 佩佩：再部署时间 -50% [ASSUMED]（卫戍协议没有「资源」）
      passiveBuff(battle, u, KEY_PEPE, { redeployMul: p.pepeRedeployMul }, { tags: ['hex'] });
    }
  };

  /** 全场扫一遍（battleStart / refresh 的入口）。 */
  const refresh = () => {
    for (const u of battle.allyUnits) applySelfPassive(u);
  };

  // ---- 常驻面板：battleStart / deploy ----------------------------------------------------------------
  battle.on('battleStart', () => refresh(), { priority: -10 });
  battle.on('deploy', (c) => {
    const u = c && c.unit;
    if (u) applySelfPassive(u);
  });

  // ---- 百炼嘉维尔：首次开启技能后，生命上限 / 攻击力 / 防御力提升至 150%（本场一次）----------------------
  battle.on('skillStart', (c) => {
    const u = c && c.unit;
    if (!isRaCarrier(u) || !inGroup(u, GROUP_JIAWEIL)) return;
    const p = plan.get(u.ownerId);
    if (!p) return;
    if (u.mem && u.mem[MEM_ONCE]) return;                    // 本场已经吃过：再开技能不再叠
    if (u.mem) u.mem[MEM_ONCE] = true;
    boosted++;
    passiveBuff(battle, u, KEY_JIAWEIL, { hpMul: p.jiaweilMul, atkMul: p.jiaweilMul, defMul: p.jiaweilMul }, { tags: ['hex'] });
  });

  // ---- 异客：友方受到自然环境伤害 -100% --------------------------------------------------------------
  /**
   * 这名玩家是否有一名**在场**的异客带着启用的 RA- 模组（光环的来源，见 [ASSUMED] 2）。
   * @param {string} pid the owner
   * @returns {boolean}
   */
  const envGuardOn = (pid) => battle.allyUnits.some((u) => isOwnOp(u, pid) && inGroup(u, GROUP_YIKE) && !!raModuleOf(u) && isOnField(u));

  battle.on('hit', (c) => {
    if (!c || !c.dmg) return;
    const dmg = c.dmg;
    if (dmg.cancel) return;
    if (!Array.isArray(dmg.tags) || !dmg.tags.includes(ENV_TAG)) return;   // 只认自然环境伤害（'terrain' 标签）
    const tgt = c.target;
    if (!isOwnOp(tgt)) return;                                           // 只保护拥有者自己的干员
    if (!envGuardOn(tgt.ownerId)) return;
    // -100%：在减伤 / 护盾 / 受伤结算之前整段取消，这次伤害一点血都不掉
    dmg.cancel = true;
    immunized++;
  });

  return {
    get owners() { return owners.length; },
    /** 当前带着启用的 RA- 模组的、拥有者自己的干员数。 */
    get carriers() { return battle.allyUnits.filter((u) => isRaCarrier(u)).length; },
    get boosted() { return boosted; },
    get immunized() { return immunized; },
    refresh,
  };
}
