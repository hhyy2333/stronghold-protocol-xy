// server/sim/content/hexcards/stone_egir_siracusa.js — 第 7 回合「盟约专属协议」的两张卡的**作战中**半边：
// 阿戈尔【协同进化】(hex_egir_symbiosis) 与 叙拉古【教父】(hex_siracusa_godfather)。
//
// 业主原文（04-文档/协议源石-盟约专属协议-第7回合-设计稿-20261026.md §3.5 / §3.6，逐字）：
//   协同进化（3阶）：仅【阿戈尔】盟约激活时才会出现。【阿戈尔】的吞噬不再造成伤害；吞噬结束后，【阿戈尔】干员的攻击力、
//                    最大生命提升至（高了不降低）阿戈尔干员最大值的 80%。
//   教父（3阶）：仅【叙拉古】盟约激活时才会出现。获得时立即获得干员【安洁莉娜】。作战中，己方干员造成伤害时使敌人 +10% 易伤，
//                最高 +200%。
//
// 本文件只负责**作战中**的两半：
//   * 「仅【X】盟约激活时才会出现」是抽取池的收窄（data/hextech.json 的 requiresBond，server/match/hextech.js
//     hexAvailableTo / hexPoolFor），不是战斗内的判断 —— 战斗里只看「这名玩家有没有这张卡」，与其它协议源石一致；
//   * 「获得时立即获得干员【安洁莉娜】」是备战侧的 onPick（applySpec 的 chess.ids），在 server/sim/content/hextech.js。
// 因此这里没有任何 requiresBond / onPick 的读取，也就不可能因为盟约在战斗中途掉档而半途失效。
//
// 契约（与 hexcards/ 里其它模块同一个，见 hooks.js）：installX(hooks)，hooks = hexHooks(battle) 的返回对象 ——
//   battle · ownersOf(hexId) → pid[] · opsOf(pid) → unit[] · specOf(pid, hexId, key) → object · onField(u) → bool ·
//   passiveBuff(battle, u, key, mods, extra)
// 两个安装函数在「没有这张卡」或「卡上没有这个脚本键」时都是纯 no-op（一个 hook 都不挂），安装时也不改战斗状态。
//
// 接线（Lead 负责，本文件不动共享文件）：
//   1. server/sim/content/hextech.js HEX_SCRIPT_KEYS 加 hex_egir_symbiosis: 'egirSymbiosis' 与
//      hex_siracusa_godfather: 'siracusaGodfather'，并在 installHexCards() 里 installEgirSymbiosis(gated) /
//      installSiracusaGodfather(gated)（BATTLE_SPEC_KEYS 里的两个键已经在了）；
//   2. bonds/core.js devour() 已经在吞噬结束时 emit('egirDevourEnd', { playerId })（有卡时不结算 5000 物理流失），
//      本模块只**监听**那个事件，不自己判吞噬。
//
// 确定性：没有随机、没有时钟、没有 Node API；一切数值都从卡的 effect 参数读（statPct / vulnPct / maxPct）。

import { isMember, passiveBuff as supportPassiveBuff, directMods } from '../support/index.js';
import { isRetaliation, isChained, isHpLoss } from '../../damage.js';

/** 协同进化：卡 id / 脚本键 / 盟约 id / buff 键 / 事件名（一处定义，测试与接线都从这里读）。 */
export const EGIR_SYMBIOSIS = Object.freeze({
  hex: 'hex_egir_symbiosis',
  key: 'egirSymbiosis',
  bond: 'egirShip',
  buff: 'hex:egir:symbiosis',
  event: 'egirDevourEnd',
});

/** 教父：卡 id / 脚本键 / buff 键（同名取最高的那一份易伤就挂在这个键上）。 */
export const SIRACUSA_GODFATHER = Object.freeze({
  hex: 'hex_siracusa_godfather',
  key: 'siracusaGodfather',
  buff: 'hex:siracusa:godfather',
});

/**
 * 「永久本场」的时长（秒）。`applyStrongest` 要求 duration > 0 且是个有限数，这里取一个长过任何一场战斗的值；
 * 没有用 Infinity —— 引擎的 buff 时长会进 snapshot / golden，Infinity 不是一个可序列化的数字。
 */
const PERMANENT = 1e9;

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const pos = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
/** 卡上真的带了这一段脚本参数吗（`specOf` 缺键时给 `{}`，所以「有值」= 非空对象）。 */
const hasSpec = (spec) => !!spec && typeof spec === 'object' && Object.keys(spec).length > 0;

// =====================================================================================================================
// 协同进化

/**
 * 协同进化: 【阿戈尔】的吞噬结束后，把每一名【阿戈尔】干员的攻击力与最大生命抬到「阿戈尔干员最大值的 statPct%」
 * （默认 80%），**已经更高的不降低**。
 *
 * 业主原文（逐字）：「【阿戈尔】的吞噬不再造成伤害；吞噬结束后，【阿戈尔】干员的攻击力、最大生命提升至（高了不降低）
 * 阿戈尔干员最大值的 80%。」前半句（不结算 5000 物理流失）在 bonds/core.js 的 devour() 里（它读同一张卡），
 * 本函数只做后半句：**监听** devour() 结束时 emit 的 `egirDevourEnd`。
 *
 * 口径：
 *   * 「吞噬结束」= bonds/core.js devour() 末尾的 `battle.emit('egirDevourEnd', { playerId })`。每人每次吞噬一次，
 *     一件都没吞到时也发（卡面是「吞噬结束后」，不是「吞到东西后」）。
 *   * 「【阿戈尔】干员」= `isMember(battle, u, 'egirShip')` —— 与 devour() 判「链能不能穿过它」用的是同一条判据
 *     （自己的盟约 + 变形同构体 / 特质授予 + 调和借来的核心盟约），所以本卡认的阿戈尔就是吞噬认的那些。
 *   * 「最大值」只数**当时站在场上**的阿戈尔（`onField`：活着 + 已部署 + 未隐匿）—— 被这次吞噬击倒的鱼不在场上，
 *     它们不参与「最大值」，否则一条被吃掉的低血鱼会把基准拉低。场上一个都没有时（全被吃了）退回数全部阿戈尔，
 *     免得整张卡空转。
 *   * 「提升至 X%」按**直接乘算的百分比**实现（support directMods 的 atkPct / hpPct，与其它 +X% 同栈）：
 *     `pct = (目标值 − 当前值) / 基础值`。基础值取 `u.base.atk` / `u.base.maxHp`（引擎的百分比桶乘的就是它），
 *     所以没有其它平加成 / 练度乘区的干员一次换算就精确到位；带这些的干员一次会差一点点，于是按残差再补一轮
 *     （`raise()` 里的两轮循环）。**只补不减**：已经高于目标的干员既不加 buff 也不降属性（「高了不降低」）。
 *   * 加成用 `passiveBuff`（persist + allowDead + 同名替换）：战斗中途被击倒 / 重部署不丢；同一名干员反复结算时
 *     因为「按当前值重算 + 只补不减」是幂等的，不会叠加两层。策略「管理员」复制出来的第二张同名卡**不**翻倍：
 *     这是「提升到某个比例」而不是「+X%」，两份卡的目标值相同（[ASSUMED]）。
 *
 * [ASSUMED: 1) 「最大值的 80%」里的最大值只数场上活着的阿戈尔（见上）；2) 攻击力与最大生命各自独立算各自的 80%，
 *   不是「两项都取同一名干员」；3) 最大生命抬升后当前生命按比例跟涨（引擎 units.js _recalc 的既有行为，不是本卡另算）；
 *   4) 同名卡不叠加。]
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {{ raised: number, settles: number }} 抬升过的干员次数 / 处理过的事件次数（安装时都是 0）
 */
export function installEgirSymbiosis(hooks) {
  const h = hooks && typeof hooks === 'object' ? hooks : {};
  const battle = h.battle;
  const specOf = typeof h.specOf === 'function' ? h.specOf : () => ({});
  const ownersOf = typeof h.ownersOf === 'function' ? h.ownersOf : () => [];
  const opsOf = typeof h.opsOf === 'function'
    ? h.opsOf
    : (pid) => ((battle && Array.isArray(battle.allyUnits) ? battle.allyUnits : [])
      .filter((u) => u && u.kind === 'op' && u.side === 'ally' && u.ownerId === pid));
  const onField = typeof h.onField === 'function'
    ? h.onField
    : (u) => !!u && !!u.alive && !!u.deployed && !u.hidden;
  const addPassive = typeof h.passiveBuff === 'function' ? h.passiveBuff : supportPassiveBuff;

  let raised = 0;
  let settles = 0;
  /** unit → 本卡已经加到它身上的百分比（`{ atk, hp }`）。只增不减，所以重复结算不会把上一次的加成覆盖掉。 */
  const applied = new Map();

  /** 把本卡的加成写给一名干员（同名替换，两个百分比一起写，免得第二次只写一半）。 */
  const write = (u, rec) => addPassive(battle, u, EGIR_SYMBIOSIS.buff, directMods({ atk: rec.atk, hp: rec.hp }), { tags: ['hex'] });

  /**
   * 把 `u.s[stat]` 抬到 `target`（只抬不降）。返回是否真的动过。
   * @param {any} u 干员
   * @param {'atk'|'maxHp'} stat 引擎聚合属性名
   * @param {number} target 目标值
   */
  const raise = (u, stat, target) => {
    const base = num(u.base && u.base[stat], 0);
    if (!(base > 0) || !(target > 0)) return false;
    const rec = applied.get(u) || { atk: 0, hp: 0 };
    let did = false;
    // 两轮：百分比桶乘的是 (base + 平加成)，带平加成 / 练度乘区的干员一次换算会差一点点；第二轮按残差补齐。
    // 「只补不减」—— delta <= 0 时直接停手，所以已经更高的干员永远不会被第二轮拉低。
    for (let round = 0; round < 2; round++) {
      const delta = target - u.s[stat];
      if (!(delta > 1e-6)) break;
      if (stat === 'atk') rec.atk += delta / base;
      else rec.hp += delta / base;
      applied.set(u, rec);
      write(u, rec);
      did = true;
    }
    return did;
  };

  /** 一名玩家的一次结算（一名干员都没有时什么都不做）。 */
  const settle = (pid, spec) => {
    settles++;
    const pct = pos(spec.statPct, 80) / 100;
    const members = opsOf(pid).filter((u) => u && !u.removed && isMember(battle, u, EGIR_SYMBIOSIS.bond));
    if (!members.length) return;
    const standing = members.filter(onField);
    const basis = standing.length ? standing : members;
    let maxAtk = 0;
    let maxHp = 0;
    for (const u of basis) {
      const s = u.s;
      if (s.atk > maxAtk) maxAtk = s.atk;
      if (s.maxHp > maxHp) maxHp = s.maxHp;
    }
    const atkTarget = maxAtk * pct;
    const hpTarget = maxHp * pct;
    // 被这次吞噬击倒、正在等复活的阿戈尔也写 buff（passiveBuff 是 allowDead 的）：它们站起来时就已经抬过了。
    for (const u of members) {
      const didAtk = raise(u, 'atk', atkTarget);
      const didHp = raise(u, 'maxHp', hpTarget);
      if (didAtk || didHp) raised++;
    }
  };

  const handle = {
    /** 被抬过至少一项属性的干员次数（同一名干员两次结算会算两次）。 */
    get raised() { return raised; },
    /** 处理过的 `egirDevourEnd` 次数。 */
    get settles() { return settles; },
  };
  if (!battle || typeof battle.on !== 'function' || typeof h.ownersOf !== 'function') return handle;

  const owners = new Set((ownersOf(EGIR_SYMBIOSIS.hex) || [])
    .filter((pid) => typeof pid === 'string' && hasSpec(specOf(pid, EGIR_SYMBIOSIS.hex, EGIR_SYMBIOSIS.key))));
  // 没有这张卡（或卡上没有 egirSymbiosis）：一个 hook 都不挂。
  if (!owners.size) return handle;

  battle.on(EGIR_SYMBIOSIS.event, (c) => {
    // devour() 一定带 playerId；万一有别的调用方不带，就按「所有持卡玩家」结算（幂等，不会重复叠加）。
    const pid = c && typeof c.playerId === 'string' ? c.playerId : null;
    const list = pid ? [pid] : [...owners];
    for (const id of list) {
      if (!owners.has(id)) continue;
      // 事件那一刻再读一次参数：卡片可能已经过期（ownersOf 认 params.expireRound），参数也可能被改过。
      const spec = specOf(id, EGIR_SYMBIOSIS.hex, EGIR_SYMBIOSIS.key);
      if (!hasSpec(spec)) continue;
      settle(id, spec);
    }
  });
  return handle;
}

// =====================================================================================================================
// 教父

/**
 * 教父: 己方干员造成伤害时，给被命中的敌人 +vulnPct% 易伤（默认 10%），每名敌人各自累计，最高 +maxPct%（默认 200%），
 * 本场永久。
 *
 * 业主原文（逐字）：「获得时立即获得干员【安洁莉娜】。作战中，己方干员造成伤害时使敌人 +10% 易伤，最高 +200%。」
 * （「获得时」那半是备战侧的 onPick，不在这里。）
 *
 * 口径：
 *   * 易伤 = 引擎的 `dmgTakenMul`（damage.js：mitigate 之后 × 目标 dmgTakenMul，元素伤害不吃）。它在引擎里是**乘区**
 *     （buffs.js 的 MUL 键），所以绝不能每个来源各挂一个 buff —— 那会变成 (1.1)^n。这里用 `applyStrongest` 的
 *     「同名取最高」：同一个键只留一个实例，value = 累计百分比 / 100，mods(v) = { dmgTakenMul: 1 + v }。
 *     于是 n 次命中是 1 + 0.1n（封顶 1 + 2.0 = 3.0 = 「+200%」），而不是 1.1^n。
 *   * 累计在模块自己的表里（敌人 → 已累计百分比），每名敌人独立；封顶后 value 不再变大，applyStrongest 只会把它
 *     续到更长的时长（同一份 buff，不会多一层）。
 *   * 「永久本场」= duration 一个长过任何一场战斗的数（PERMANENT），没有用 Infinity（要进 snapshot）。
 *   * 「己方干员造成伤害」按引擎里「造成伤害」的既有判据（身负重担 / 战地医院 同一条）：流失（isHpLoss）、元素损伤
 *     （type element / elemental）、反伤 / 反击 / 坚守荆棘（isRetaliation）、连锁出来的 rider（isChained）都不算一次
 *     「造成伤害」[ASSUMED: 卡面只写了「造成伤害」，这里沿用仓库里同一条口径；要改只改这一处判据]。
 *   * 只认持卡玩家**自己的干员**（kind 'op' + ownerId），召唤物 / 器物 / 队友的干员都不算（「己方干员」）。
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {{ applied: number, stacksOf: (enemy: any) => number }} 施加次数 / 某名敌人当前的累计百分比
 */
export function installSiracusaGodfather(hooks) {
  const h = hooks && typeof hooks === 'object' ? hooks : {};
  const battle = h.battle;
  const specOf = typeof h.specOf === 'function' ? h.specOf : () => ({});
  const ownersOf = typeof h.ownersOf === 'function' ? h.ownersOf : () => [];

  /** 敌人 → 已累计的易伤百分比（本场不清空；每名敌人各自一份）。 */
  const stacks = new Map();
  let applied = 0;

  const handle = {
    /** 施加（或续期）易伤的次数。 */
    get applied() { return applied; },
    /** 某名敌人当前的累计易伤百分比（没有就是 0）。 */
    stacksOf(enemy) { return stacks.get(enemy) || 0; },
  };
  if (!battle || typeof battle.on !== 'function' || typeof battle.applyStrongest !== 'function') return handle;

  /** 持卡玩家 → 这张卡的参数。 */
  const cfg = new Map();
  for (const pid of ownersOf(SIRACUSA_GODFATHER.hex) || []) {
    if (typeof pid !== 'string') continue;
    const spec = specOf(pid, SIRACUSA_GODFATHER.hex, SIRACUSA_GODFATHER.key);
    if (!hasSpec(spec)) continue;
    cfg.set(pid, { vuln: pos(spec.vulnPct, 10), max: pos(spec.maxPct, 200) });
  }
  // 没有这张卡（或卡上没有 siracusaGodfather）：一个 hook 都不挂。
  if (!cfg.size) return handle;

  battle.on('damaged', (c) => {
    if (!c) return;
    const dmg = c.dmg || null;
    if (dmg) {
      if (dmg.cancel) return;
      if (isHpLoss(dmg) || isRetaliation(dmg) || isChained(dmg)) return;
      if (dmg.type === 'element' || dmg.type === 'elemental') return;
    }
    // 打人的必须是持卡玩家自己的、场上的干员（召唤物 / 器物 / 队友的干员都不算「己方干员」）。
    const src = c.source;
    if (!src || src.kind !== 'op' || src.side !== 'ally') return;
    const cfgOf = cfg.get(src.ownerId);
    if (!cfgOf) return;
    if (!src.alive || !src.deployed || src.hidden) return;
    // 挨打的必须是活着的敌人（friendly fire / 器物 / 自己人不算）。
    const tgt = c.target;
    if (!tgt || tgt.side !== 'enemy' || !tgt.alive || tgt.removed) return;
    const prev = stacks.get(tgt) || 0;
    const next = Math.min(cfgOf.max, prev + cfgOf.vuln);
    if (!(next > 0)) return;
    stacks.set(tgt, next);
    applied++;
    battle.applyStrongest(tgt, SIRACUSA_GODFATHER.buff, {
      duration: PERMANENT,
      value: next / 100,
      mods: (v) => ({ dmgTakenMul: 1 + v }),
      source: src,
    });
  });
  return handle;
}
