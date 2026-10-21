// server/sim/content/hexcards/batch15b.js — 第十四批（业主 2026-10-19）后四张卡的战斗脚本。
//
// 业主原文（逐字照抄；每张卡都在各自函数的注释里再抄一遍）：
//   5. 加护（1阶）：获得装备「加护」：该干员受到自身伤害类型的伤害减少 60%。
//   6. 万物归虚（3阶）：获得装备「万物归虚」：装备时将移除备战区所有干员，战斗开始时获得「移出干员数」层
//      （20x% 攻击力，减少 30x 点受到的伤害）。
//   7. 尸山（3阶）：获得装备「尸山」：战斗开始时直接击杀其他所有干员（不可重部署）。每击杀 1 名干员，该干员便
//      获得 20% 攻击力、防御力、最大生命值、1 阻挡数、0.3 技力回复速度、5 法抗，且每秒恢复自身 3% 最大生命。
//      ——业主改版 2026-10-20：「三阶『尸山』，加成改成：获得其他干员属性（生命值，攻击力，阻挡数，防御力，法抗）和
//      技力回复+1，每秒回复1%最大生命」
//   8. 旧日之力（2阶）：干员技力消耗 +20%，伤害提升 140%。
//
// 同一个 `hexHooks(battle)` 契约；随机只用 battle.rng()，计时器只用 battle.every()。

import { mitigate } from '../../damage.js';
import { num, passiveBuff } from '../support/index.js';
import { carries } from '../items/battle.js';

/** 加护 / 万物归虚 / 尸山 的装备 key（items.json 里 strip 掉 `_a`）。 */
export const WARDING_ITEM_KEY = 'chess_item_9_93_e';
export const VOIDRETURN_ITEM_KEY = 'chess_item_9_94_e';
export const CORPSEHILL_ITEM_KEY = 'chess_item_9_95_e';

function ownersOfCard(hooks, hexId) {
  if (!hooks || typeof hooks !== 'object') return null;
  const { battle, ownersOf } = hooks;
  if (!battle || typeof battle.on !== 'function') return null;
  if (typeof ownersOf !== 'function') return null;
  const owners = ownersOf(hexId);
  return owners && owners.length ? owners : null;
}

function isOwnOp(u, owned) {
  return !!u && u.kind === 'op' && u.side === 'ally' && owned.has(u.ownerId);
}

function pos(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * 加护: 获得装备「加护」：该干员受到自身伤害类型的伤害减少 60%。
 *
 * 业主原文（逐字）：「获得装备「加护」：该干员收到自身伤害类型的伤害减少60%」
 *
 * 口径：装备者的 `dmgType`（物理 / 法术）就是「自身伤害类型」；在 `hit` 钩子上，如果这一下的 `dmg.type` 与它
 * 相同，给这次伤害 ×(1 − cutPct/100)。用 `hit` 而不是 `passiveBuff` 的 `physTakenMul` / `artsTakenMul`，
 * 是因为后两者会连同其它来源一起乘，而原文是「这一次伤害减少 60%」；`hit` 上改 `dmg.mul` 只影响本实例。
 *
 * [ASSUMED: 1)「自身伤害类型」= 该干员的普攻类型（units.js `dmgType`），物理干员吃物理减伤、法术干员吃法术减伤；
 *   2) 真实伤害 / 元素伤害 / 流失不算「与自身伤害类型相同」（干员面板类型只有物理/法术/真实/治疗/无，前两者才有
 *   「受到同类伤害」的意义）；3) 减伤是乘算 ×0.4（不是减法），且与其它减伤乘区叠加；4) 只对装着【加护】的干员生效。]
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number} 0 when the card is absent
 */
export function installWarding(hooks) {
  const owners = ownersOfCard(hooks, 'hex_warding');
  if (!owners) return 0;
  const { battle, specOf } = hooks;
  const owned = new Set(owners);
  const cut = Math.max(0, Math.min(100, pos(specOf(owners[0], 'hex_warding', 'warding').cutPct, 60))) / 100;
  battle.on('hit', (c) => {
    if (!c || !c.dmg || c.dmg.cancel) return;
    const target = c.target;
    if (!isOwnOp(target, owned)) return;
    if (!carries(battle, target, WARDING_ITEM_KEY)) return;
    const own = target.dmgType;
    if (own !== 'phys' && own !== 'arts') return;
    if (c.dmg.type !== own) return;
    c.dmg.mul *= 1 - cut;
  });
  return [...new Set(owners)].reduce((n, pid) => n + ((hooks.opsOf ? hooks.opsOf(pid) : []) || []).length, 0);
}

/**
 * 万物归虚: 获得装备「万物归虚」：装备时将移除备战区所有干员，战斗开始时获得「移出干员数」层
 * （20x% 攻击力，减少 30x 点受到的伤害）。
 *
 * 业主原文（逐字）：「获得装备「万物归虚」效果为装备时 将移除备战区所有干员，战斗开始时获得「移出干员数」层
 * （20x%攻击力，减少30x点收到的伤害）」
 *
 * 两个半边：
 *   * **装备时**（备战期，准备阶段）：「移除备战区所有干员」—— 这是**备战期**的动作，不在这份战斗脚本里，
 *     见 server/match/hextech.js 的 VOIDRETURN 处理器（它把移除的人数写进 ref 的 params.layers）；
 *   * **战斗开始时**：装备者按层数拿到 `+20% × layers` 攻击力，以及 `−30 × layers` 的**固定**受伤减免
 *     （每层减少 30 点「受到的伤害」，是固定值不是百分比）。
 *
 * 固定减免的实现：`hit` 钩子上算这一下「本该造成多少」（mitigate 之后的最终值），再把它压到
 * `max(0, 本该造成 − 减免)`；用 `dmg.mul` 乘一个比例来表达（`mul × (after/before)`），这样不会破坏
 * 其它乘区，也不会把一次伤害变成负数。
 *
 * [ASSUMED: 1) 层数来自「装备时移除的备战区干员数」，由备战期那半边写进 ref，战斗脚本只读；2) 减免是每一击的
 *   固定值（不是每层百分比减伤），且不会让伤害低于 0；3) 只对装备【万物归虚】的干员生效；4) 元素损伤不是
 *   「受到的伤害」，不减免。]
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number} 0 when the card is absent
 */
export function installVoidReturn(hooks) {
  const owners = ownersOfCard(hooks, 'hex_voidreturn');
  if (!owners) return 0;
  const { battle, specOf } = hooks;
  const owned = new Set(owners);
  // 每层 +atk% / −固定伤害（卡面参数；层数在 ref 的 params 里，由备战期那半边写入）
  const atkPer = pos(specOf(owners[0], 'hex_voidreturn', 'voidreturn').atkPctPerLayer, 20);
  const cutPer = pos(specOf(owners[0], 'hex_voidreturn', 'voidreturn').dmgCutPerLayer, 30);
  /** 这份 ref 上记的层数（备战期移除的干员数）。 */
  const layersOf = (pid) => {
    const ps = battle.getPlayer ? battle.getPlayer(pid) : null;
    const ref = ((ps && ps.playerEffects) || []).find((e) => e && (e.data?.hexId === 'hex_voidreturn' || e.key === 'hex:hex_voidreturn'));
    const n = ref && ref.params ? Number(ref.params.voidLayers) : 0;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  const layers = new Map();   // unit → layers (resolved at install; the ref does not change mid-battle)
  const apply = (u) => {
    if (!u || u.kind !== 'op' || u.side !== 'ally' || !owned.has(u.ownerId)) return;
    if (!carries(battle, u, VOIDRETURN_ITEM_KEY)) return;
    const n = layersOf(u.ownerId);
    layers.set(u, n);
    if (n > 0) passiveBuff(battle, u, 'hex:voidreturn', { atkPct: (atkPer / 100) * n }, { tags: ['hex'] });
  };
  for (const u of battle.allyUnits) apply(u);
  battle.on('deploy', (c) => { if (c && c.unit) apply(c.unit); });
  battle.on('hit', (c) => {
    if (!c || !c.dmg || c.dmg.cancel) return;
    const target = c.target;
    if (!target || target.side !== 'ally') return;
    const n = layers.get(target) || 0;
    if (!(n > 0)) return;
    const cut = cutPer * n;
    const dmg = c.dmg;
    if (dmg.type === 'element') return;
    // 「本该造成的伤害」：按当前 mul 与实际减伤后的值估算，再把固定减免折成 mul 的比例
    const before = mitigate(dmg.amount, dmg.type === 'true' ? 'true' : dmg.type, target.s, {
      defIgnorePct: dmg.defIgnorePct, defIgnoreFlat: dmg.defIgnoreFlat,
      resIgnorePct: dmg.resIgnorePct, resIgnoreFlat: dmg.resIgnoreFlat,
    });
    if (!(before > 0)) return;
    const after = Math.max(0, before - cut);
    dmg.mul *= after / before;
  });
  return [...new Set(owners)].reduce((n, pid) => n + ((hooks.opsOf ? hooks.opsOf(pid) : []) || []).length, 0);
}

/**
 * 尸山: 获得装备「尸山」：战斗开始时直接击杀其他所有干员（不可重部署），装备者获得他们的属性。
 *
 * 业主原文（逐字）：初版「获得装备「尸山」：战斗开始时直接击杀其他所有干员（不可重部署）。每击杀1名干员，该干员便
 * 获得20%攻击力，防御力，最大生命值，1阻挡数，0.3技力回复速度，5法抗。且每秒恢复自身3%最大生命」；
 * 改版（2026-10-20）「三阶『尸山』，加成改成：获得其他干员属性（生命值，攻击力，阻挡数，防御力，法抗）和技力回复+1，
 * 每秒回复1%最大生命」。
 *
 * 口径：`battleStart` 时，装备者的**其他己方干员**全部被击杀（`retreat(permanent: true)` —— 击杀而不是「倒下」，
 * 「不可重部署」）；然后装备者把他们的属性**逐项累加**到自己身上：
 *   * 生命值 → `hpFlat`（加在基础值上，随百分比一起放大 —— 引擎 units.js `_recalc` 的同一个桶）；
 *   * 攻击力 → `atkFinal`（**最终加算**，加在所有百分比之后；与阿戈尔盟约的「吞噬」同一条口径 —— 被吃掉的干员给的
 *     是 base 攻击力，不该再被装备者自己的 +ATK% 乘一遍）；
 *   * 防御力 → `defFlat`；阻挡数 → `blockCnt`；法抗 → `resFlat`。
 *   * 技力回复 +1 → `spRecoveryFlat`；每秒恢复 1% 最大生命 → `hpRegenRatio`。
 * 后两项是**固定值，全场只算一次**（业主 2026-10-20 选定：不随击杀数放大）。
 *
 * [ASSUMED: 1)「其他所有干员」= **装备者同一玩家**（`ownerId` 相同）的其他己方干员；联防 / boss 双人场上队友的干员不算
 *   （业主「尸山在联防和打 boss 时会吞掉队友的干员」）；召唤物不算；
 *   2)「直接击杀」用永久退场（`permanent: true`），因此不能再部署 —— 这就是「不可重部署」；3)「获得其他干员属性」
 *   读的是**基础面板**（`unit.base`，不含装备与增益），与「吞噬」同一条口径；4) 生命值是 `hpFlat`（吃百分比），
 *   攻击力是 `atkFinal`（不吃百分比，与「吞噬」一致）；5)「技力回复+1」「每秒1%」是定值、不叠加；
 *   6) 没有装备者 / 没有其他干员时什么都不做。]
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number} 0 when the card is absent, else the number of kills at battle start
 */
export function installCorpseHill(hooks) {
  const owners = ownersOfCard(hooks, 'hex_corpsehill');
  if (!owners) return 0;
  const { battle, specOf } = hooks;
  const owned = new Set(owners);
  const spec = specOf(owners[0], 'hex_corpsehill', 'corpsehill');
  // 两项固定加成（不随击杀数放大）
  const spRec = pos(spec.spRecovery, 1);
  const regenPct = pos(spec.regenPct, 1) / 100;
  let kills = 0;
  /** carriers that already ate (an explicit guard: the pool below now includes already-dead units, so "nobody to eat"
   *  is no longer a reliable idempotency signal when a repeat battleStart is emitted). */
  const eaten = new Set();
  battle.on('battleStart', () => {
    for (const carrier of battle.allyUnits) {
      if (!isOwnOp(carrier, owned) || !carrier.alive) continue;
      if (!carries(battle, carrier, CORPSEHILL_ITEM_KEY)) continue;
      const marker = carrier.uid != null ? `u${carrier.uid}` : `i${carrier.id}`;
      if (eaten.has(marker)) continue;
      // 业主 2026-10-22「协议『尸山』的装备『尸山』联防不生效」：联防把**自己那场已经倒下的干员**按
      // `carryState.down` 送进来 —— 入场后立刻被强制退场，所以到 `battleStart` 时它们 `alive === false`，但对象还在
      // `allyUnits` 里。原来这里用 `u.alive` 过滤，于是「己方其他干员」一个都不剩 ⇒ 装备者拿不到任何基础属性，
      // 看起来就是「联防不生效」。现在：属性从**所有还在场的己方干员**（含已经倒下的）累加，只对还活着的执行击杀 ——
      // 已经倒下的人本来就已经被击杀过了。普通战斗里 battleStart 之前没有伤亡，所以口径不变。
      // 业主「尸山在联防和打 boss 时会吞掉队友的干员」：联防 / boss 双人场的 `allyUnits` 装的是**两个
      // 玩家**的棋盘（hooks.js `fieldOps` 的注释），只认 `ownerId === carrier.ownerId` 才是「己方干员」—— 队友的
      // 干员不执行击杀，属性也不吃。
      const others = battle.allyUnits.filter((u) => u !== carrier && u.kind === 'op' && u.side === 'ally'
        && u.ownerId === carrier.ownerId && !u.removed);
      if (!others.length) continue;
      eaten.add(marker);
      // 先把属性读下来 —— retreat 之后单位还活着，但读 base 更稳，也避免任何收尾逻辑改字段
      let hp = 0, atk = 0, def = 0, block = 0, res = 0;
      for (const u of others) {
        hp += num(u.base?.maxHp, 0);
        atk += num(u.base?.atk, 0);
        def += num(u.base?.def, 0);
        block += num(u.base?.blockCnt, 0);
        res += num(u.base?.res, 0);
      }
      for (const u of others) {
        if (!u.alive) continue;   // 已经倒下的（联防的 down）：不再执行一次，但它的基础属性照样被吞掉
        battle.retreat(u, { reason: 'corpsehill', permanent: true });
        kills++;
      }
      const mods = {};
      if (hp > 0) mods.hpFlat = hp;
      if (atk > 0) mods.atkFinal = atk;   // 最终加算，与「吞噬」一致
      if (def > 0) mods.defFlat = def;
      if (block > 0) mods.blockCnt = block;
      if (res > 0) mods.resFlat = res;
      if (Object.keys(mods).length) passiveBuff(battle, carrier, 'hex:corpsehill', mods, { tags: ['hex'] });
      // 技力回复 +1 与每秒恢复 1% 最大生命：定值，不随击杀数叠加
      const extra = {};
      if (spRec > 0) extra.spRecoveryFlat = spRec;
      if (regenPct > 0) extra.hpRegenRatio = regenPct;
      if (Object.keys(extra).length) passiveBuff(battle, carrier, 'hex:corpsehill:regen', extra, { tags: ['hex'] });
    }
  });
  return { get kills() { return kills; }, get owners() { return owners.length; } };
}

/**
 * 旧日之力: 干员技力消耗 +20%，伤害提升 140%。
 *
 * 业主原文（逐字）：「干员技力消耗+20%，伤害提升140%」
 *
 * 口径：拥有者的己方干员：
 *   * 技能消耗 ×(1 + spCostPct%) —— 引擎的 `sk.spCostMul`（skills.js 的 accessor，绝技就是用它做 ×0.7）；
 *   * 造成伤害 ×dmgPct%（140% = ×1.4），用 `passiveBuff` 的 `dmgDealtMul`。
 * 两者都只对拥有者的干员生效；`deploy` 时补装（新上场的干员也要）。
 *
 * [ASSUMED: 1)「伤害提升140%」= 造成伤害 ×1.4（与玻璃大炮同一条读法）；2)「技力消耗+20%」= 技能 SP 消耗 ×1.2，
 *   对没有技能 / 不耗技力的干员无影响；3) 只作用于拥有者的己方干员，召唤物不算；4) 两个效果都是战斗内常驻，
 *   死亡 / 重部署后仍在。]
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number} 0 when the card is absent, else the number of operators it covered
 */
export function installOldPower(hooks) {
  const owners = ownersOfCard(hooks, 'hex_oldpower');
  if (!owners) return 0;
  const { battle, specOf } = hooks;
  const owned = new Set(owners);
  const spec = specOf(owners[0], 'hex_oldpower', 'oldpower');
  const spMul = 1 + pos(spec.spCostPct, 20) / 100;
  const dmgMul = pos(spec.dmgPct, 140) / 100;
  let n = 0;
  const apply = (u) => {
    if (!u || u.kind !== 'op' || u.side !== 'ally' || !owned.has(u.ownerId)) return;
    passiveBuff(battle, u, 'hex:oldpower', { dmgDealtMul: dmgMul }, { tags: ['hex'] });
    // 技力消耗是 SkillSpec 上的可变字段（skills.js spCostMul）：只写一次，重复安装不会叠乘
    if (u.skill && !u.skill.hexOldPower) {
      u.skill.hexOldPower = true;
      u.skill.spCostMul = u.skill.spCostMul * spMul;
    }
    n++;
  };
  for (const u of battle.allyUnits) apply(u);
  battle.on('deploy', (c) => { if (c && c.unit) apply(c.unit); });
  return n;
}

