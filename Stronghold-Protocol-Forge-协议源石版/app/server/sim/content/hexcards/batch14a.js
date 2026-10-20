// server/sim/content/hexcards/batch14a.js — 第十三批（业主 2026-10-19）前五张卡的战斗脚本。
//
// 业主原文（逐字照抄；每张卡都在各自函数的注释里再抄一遍）：
//   1. 你摸不到（3阶）：释放技能时免疫伤害。
//   2. 珠光护手（3阶）：你的技能有 30% 暴击几率造成 200% 伤害。
//      ——业主改版 2026-10-20：「协议『珠光护手』改成50%概率伤害提升至300％」
//   3. 物法皆修（3阶）：干员每次攻击回复 1 技力，技能每造成一次伤害攻击力 +10%（最高 300%）。
//   4. 量子计算（3阶）：每 10 秒对全场敌人造成场上攻击力最高干员 300% 攻击力的物理伤害。施加 30 减速 3s，
//      并给干员回复 20% 生命值。
//   5. 冰霜幽灵（1阶）：每 12 秒，束缚全场敌人 3s。
//
// 一个模块装五张卡的战斗半：五段脚本都很短（一个旗标窗口、一次倍率掷骰、一个叠层、两个定时脉冲），共享同一个
// `hexHooks(battle)` 契约（见 hooks.js）——installX(hooks) 只注册 hook / 计时器，安装时不改战斗状态；每段都先
// 用 ownersOf(<hexId>) 判断“谁拥有这张卡”，再只对“拥有者自己的干员 / 全场敌人”生效，所以联防多玩家场上两个
// 玩家同时持卡时各算各的（互相不串）。
//
// 确定性：唯一的随机（珠光护手）走 battle.rng()，没有 Math.random / Date / Node API；计时器走 battle.every()，
// 不用 setInterval —— 两端跑的是同一段字节，战斗才能重放。

import { makeDamageInfo, isRetaliation, isHpLoss } from '../../damage.js';

/** 你摸不到：技能施放期间挂在干员身上的无敌旗标 buff 的 key。 */
const UNTOUCHABLE_KEY = 'hex:untouchable';
/** 珠光护手：这次伤害实例是否已经掷过暴击（一次实例只掷一次，不会被别的 handler 重掷）。 */
const PEARL_MARK = 'hexPearlGlove';
/** 物法皆修：攻击力叠层 buff 的 key（每层 atkPct = 卡片的每击百分比，上限由 maxStacks 卡住）。 */
const PHYSARTS_KEY = 'hex:physarts';
/** 量子计算：这一发脉冲伤害的 tag（测试与内容可以用它认出“这张卡打的伤害”）。 */
const QUANTUM_TAG = 'hexQuantum';
/** 冰霜幽灵：束缚的 buff key 就是引擎的目录状态 'bind'（见 buffs.js STATUS.bind），这里只做注释。 */

/** 场上活着的敌人（“全场敌人”）：引擎的敌人列表是 battle.enemies，不是 battle.enemyUnits。 */
function livingEnemies(battle) {
  return battle.enemies.filter((e) => e && e.alive && e.deployed && !e.hidden);
}

/** 一个干员是不是这张卡拥有者的己方干员（多玩家场上只认自己的 ownerId）。 */
const isOwnOp = (u, owned) => !!u && u.kind === 'op' && u.side === 'ally' && owned.has(u.ownerId);

/** 共用的“卡片存在 + 包形状对”守卫：没有卡（或 hooks 不是 hexHooks 的返回对象）时是个 no-op。 */
function ownersOfCard(hooks, hexId) {
  if (!hooks || typeof hooks !== 'object') return null;
  const { battle, ownersOf } = hooks;
  if (!battle || typeof battle.on !== 'function') return null;
  if (typeof ownersOf !== 'function') return null;
  const owners = ownersOf(hexId);
  return owners && owners.length ? owners : null;
}

/**
 * 你摸不到: 释放技能时免疫伤害。
 *
 * 业主原文（逐字）：「释放技能时免疫伤害。」
 *
 * 口径：引擎里“释放技能”的可观察窗口就是 skillStart → skillEnd（skills.js activate() 发 skillStart，end() 发
 * skillEnd）。所以 skillStart 给拥有者的干员挂一个 `flags.invulnerable` 的 buff，skillEnd 摘掉；期间 damage.js
 * dealDamage 在 `hit` 之前就直接返回 0（§4 顺序），连伤害事件都不发。
 *
 * [ASSUMED: 1) 「释放技能时」= 技能的持续窗口：duration / ammo / toggle 技能全程免疫（toggle 技能“直到死亡”都算
 *   窗口内，因此它近似于永久免疫 —— 原文没区分技能种类，这是引擎能给出的最接近的“施放期间”）。2) instant /
 *   charges 类技能在引擎里是瞬时的（activate() 同一次调用里就 end('instant')），窗口长度为 0，因此这类技能不会
 *   获得持续免疫；这是引擎对“无持续时间的技能”的定义，不是遗漏。3) 只保护拥有者的己方干员（kind 'op'），召唤物
 *   与队友的干员不享受。4) 旗标本身不阻挡 status 施加（只挡伤害），因为原文只说“免疫伤害”。]
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number|{owners:number, shielded:number, activations:number}} 0 when the card is absent, else a live tally handle
 */
export function installUntouchable(hooks) {
  const owners = ownersOfCard(hooks, 'hex_untouchable');
  if (!owners) return 0;
  const { battle } = hooks;
  const owned = new Set(owners);
  let activations = 0;
  battle.on('skillStart', ({ unit }) => {
    // 技能释放者必须是拥有者的己方干员；被击倒 / 未部署的干员没有“技能释放”可谈
    if (!isOwnOp(unit, owned) || !unit.alive || !unit.deployed) return;
    battle.addBuff(unit, {
      key: UNTOUCHABLE_KEY,
      duration: Infinity,
      flags: { invulnerable: true },
      tags: ['hex', 'untouchable'],
    });
    activations++;
  });
  battle.on('skillEnd', ({ unit }) => {
    // 技能结束（时长耗尽 / 手动关闭 / 被击倒）就摘旗标；unit 已经倒下时 buff 也会一并清掉，removeBuff 是 no-op
    if (!unit) return;
    battle.removeBuff(unit, UNTOUCHABLE_KEY);
  });
  return {
    get owners() { return owners.length; },
    /** 当前挂着免疫的干员数（0…owners 的干员数），供脚本 / 测试读活状态。 */
    get shielded() { return battle.allyUnits.filter((u) => isOwnOp(u, owned) && (u.buffs || []).some((b) => b.key === UNTOUCHABLE_KEY)).length; },
    /** 本场累计进入过“施放窗口”的次数。 */
    get activations() { return activations; },
  };
}

/**
 * 珠光护手: 你的技能有 50% 概率伤害提升至 300%（原 30% / 200%，业主 2026-10-20 改版）。
 *
 * 业主原文（逐字）：初版「你的技能有 30% 暴击几率造成 200% 伤害。」；
 *   改版（2026-10-20）「协议『珠光护手』改成50%概率伤害提升至300％」。
 *
 * 在 `hit`（伤害结算之前、会心/闪避/减伤之前）把 `dmg.mul` ×= mul/100 —— 这是引擎里唯一“在结算前改伤害”的
 * 钩子（damage.js：hit → dodge → mitigation → × source dmgDealtMul × target dmgTakenMul × dmg.mul）。乘的是最终
 * 伤害的倍率，等价于“这次伤害 ×3”；不是事后再补一段伤害，因此不引入第二段伤害、不吃两次减伤、也不会被反伤 /
 * 受击回复当成两次命中。
 *
 * [ASSUMED: 1) 「技能」= dmg.isSkill（引擎标记的、由技能造成的伤害实例；普通攻击、卡片伤害、流失、元素损伤不算）。
 *   2) 每个伤害实例独立掷一次 50%（多段技能每段各掷，不是每次施放只掷一次）；引擎没有“暴击”概念，[ASSUMED] 暴击
 *   即 300% 最终伤害。3) 只对拥有者的己方干员的技能伤害生效，且只打敌人（打友军 / 装置不掷）。4) 概率与倍率从
 *   卡片参数读（chance / mul），缺省 50 / 300。]
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number|{owners:number, crits:number}} 0 when the card is absent
 */
export function installPearlGlove(hooks) {
  const owners = ownersOfCard(hooks, 'hex_pearlglove');
  if (!owners) return 0;
  const { battle, specOf, optNumber } = hooks;
  const plan = new Map();
  for (const pid of owners) {
    const spec = typeof specOf === 'function' ? specOf(pid, 'hex_pearlglove', 'pearlglove') : {};
    const chance = Math.max(0, Math.min(100, optNumber(spec, 'chance', 50))) / 100;
    const mul = optNumber(spec, 'mul', 300) / 100;
    plan.set(pid, { chance, mul });
  }
  let crits = 0;
  battle.on('hit', ({ source, target, dmg }) => {
    if (!dmg || dmg.cancel || !dmg.isSkill) return;
    if (!source || source.kind !== 'op' || source.side !== 'ally') return;
    const p = plan.get(source.ownerId);
    if (!p || !(p.chance > 0) || !(p.mul > 1)) return;
    if (!target || target.side !== 'enemy') return;
    if (dmg[PEARL_MARK]) return;            // 一个实例只掷一次（别的 handler / 二次 emit 不再重掷）
    dmg[PEARL_MARK] = true;
    if (!(battle.rng() < p.chance)) return; // 确定性：battle.rng()，不是 Math.random
    crits++;
    dmg.mul *= p.mul;                       // 结算前的最终伤害倍率
  });
  return {
    get owners() { return owners.length; },
    get crits() { return crits; },
  };
}

/**
 * 物法皆修: 干员每次攻击回复 1 技力，技能每造成一次伤害攻击力 +10%（最高 300%）。
 *
 * 业主原文（逐字）：「干员每次攻击回复 1 技力，技能每造成一次伤害攻击力 +10%（最高 300%）。」
 *
 * 两半各用一个引擎原语：
 *   * 「每次攻击回复 1 技力」——`attack` 钩子（ai.js performAttack 在攻击/治疗执行之后发；普通攻击与技能覆盖的
 *     攻击都算，治疗动作也算——这正是引擎“攻击回复技力” spType 'attack' 的时点，§7.1）里调
 *     `unit.skill.gainSp(sp, 'attack')`。技力回复本身的规则（阻回 noSp、持续技能期间不回技力、spGain 钩子、
 *     充能）都交给 gainSp，不自己改 sp 字段。
 *   * 「技能每造成一次伤害攻击力 +10%」——`damaged` 里当 source 是拥有者的干员、`dmg.isSkill`、真的打掉了 HP
 *     （ctx.amount > 0）时，给该干员叠一层 `hex:physarts`（refresh: 'stack'，每层 mods.atkPct = 10%）。聚合规则是
 *     引擎的“加算 mod 按层数乘值”，30 层 = +300%，maxStacks = atkPctCap / atkPctPerHit。流失（isHpLoss）、反伤
 *     （isRetaliation）、元素损伤（type 'element'）不算“造成伤害”，跳过。
 *
 * [ASSUMED: 1) 「每次攻击」跟随引擎的攻击时点（含治疗的“攻击”动作），与 spType 'attack' 同一口径。2) 叠层没有
 *   持续时间（原文没写），整场战斗保留；不设 persist，干员被击倒 / 再部署后清空（引擎对非 persist buff 的规则）。
 *   3) 「技能每造成一次伤害」= 每个伤害实例（打中 3 个敌人叠 3 层），只算本人干员的技能伤害（召唤物 / 队友不算）。
 *   4) 层数封顶 = atkPctCap / atkPctPerHit 向下取整（10% / 300% ⇒ 30 层）。]
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number|{owners:number, spGained:number, stacks:number}} 0 when the card is absent
 */
export function installPhysArts(hooks) {
  const owners = ownersOfCard(hooks, 'hex_physarts');
  if (!owners) return 0;
  const { battle, specOf, optNumber } = hooks;
  const plan = new Map();
  for (const pid of owners) {
    const spec = typeof specOf === 'function' ? specOf(pid, 'hex_physarts', 'physarts') : {};
    const perHit = optNumber(spec, 'atkPctPerHit', 10) / 100;
    const cap = optNumber(spec, 'atkPctCap', 300) / 100;
    const sp = optNumber(spec, 'spOnAttack', 1);
    const maxStacks = Math.max(1, Math.floor(cap / perHit + 1e-9));
    plan.set(pid, { perHit, maxStacks, sp });
  }
  let spGained = 0;
  let stacks = 0;
  battle.on('attack', ({ attacker }) => {
    if (!attacker || attacker.kind !== 'op' || attacker.side !== 'ally') return;
    const p = plan.get(attacker.ownerId);
    if (!p || !(p.sp > 0)) return;
    const sk = attacker.skill;
    if (!sk || typeof sk.gainSp !== 'function') return;
    if (sk.gainSp(p.sp, 'attack') > 0) spGained++;
  });
  battle.on('damaged', (c) => {
    if (!c) return;
    const dmg = c.dmg || null;
    // 流失不是“造成伤害”；反伤 / 反射不算本人技能的输出；元素损伤只是灌条，不是伤害
    if (dmg && (isHpLoss(dmg) || isRetaliation(dmg))) return;
    if (dmg && dmg.type === 'element') return;
    const src = c.source;
    const tgt = c.target;
    if (!src || src.kind !== 'op' || src.side !== 'ally') return;
    const p = plan.get(src.ownerId);
    if (!p) return;
    if (!dmg || !dmg.isSkill) return;
    if (!tgt || tgt.side !== 'enemy') return;
    if (!(c.amount > 0)) return;                // 被盾完全吃掉的一击没有“造成伤害”
    const cur = typeof src.findBuff === 'function' ? src.findBuff(PHYSARTS_KEY) : null;
    if (cur && cur.stacks >= p.maxStacks) return;
    battle.addBuff(src, {
      key: PHYSARTS_KEY,
      duration: Infinity,
      refresh: 'stack',
      stacks: 1,
      maxStacks: p.maxStacks,
      mods: { atkPct: p.perHit },
      tags: ['hex', 'physarts'],
    });
    stacks++;
  });
  return {
    get owners() { return owners.length; },
    get spGained() { return spGained; },
    get stacks() { return stacks; },
  };
}

/**
 * 量子计算: 每 10 秒对全场敌人造成场上攻击力最高干员 300% 攻击力的物理伤害。施加 30 减速 3s，并给干员回复 20% 生命值。
 *
 * 业主原文（逐字）：「每 10 秒对全场敌人造成场上攻击力最高干员 300% 攻击力的物理伤害。施加 30 减速 3s，并给
 * 干员回复 20% 生命值。」
 *
 * 定时器用 `battle.every(every, fn)`（引擎的 tick 计时器，第一个脉冲在 t = every），每个拥有者各挂一个。
 * 脉冲：取拥有者自己“在场上”（alive + deployed + 未隐藏）干员里当前 `s.atk` 最高的那一个（同值取战场顺序第一个），
 * 对全场活着的敌人各造成一次 `atk × atkPct%` 物理伤害（source = 该干员，享受它的增伤统计与击杀归属），
 * 然后给还活着的敌人 applyStatus('slow', { value: slowPct/100, duration: slowSec })（buffs.js 的 valued 状态：
 * value 是被减速的比例，0.3 ⇒ moveMul 0.7，同名取最高），最后给拥有者自己的每个在场上干员 heal 最大生命 × healPct%。
 *
 * [ASSUMED: 1) 「场上攻击力最高干员」= 拥有者自己的干员（原文没写“己方”但这是“你的卡”；联防场上队友的高攻干员
 *   不算，否则一张卡会跨玩家生效）。2) 没有拥有者的干员在场上时这一发什么都不做（没有伤害来源）。3) 「给干员回复
 *   20% 生命值」= 拥有者自己的每个在场上干员回复其最大生命的 20%（不是当前生命的 20%），走 battle.heal（受治疗
 *   加成 / 禁疗 / 治疗上限的引擎规则）。4) 这一发是卡片伤害，不是攻击也不是技能：dmg.isSkill = false、不可闪避，
 *   所以不会触发珠光护手 / 物法皆修的“技能伤害”判定。5) 减速 / 束缚都对免疫与抵抗（battle.applyStatus）照常生效。]
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number|{owners:number, pulses:number}} 0 when the card is absent
 */
export function installQuantum(hooks) {
  const owners = ownersOfCard(hooks, 'hex_quantum');
  if (!owners) return 0;
  const { battle, opsOf, specOf, optNumber, onField } = hooks;
  if (typeof battle.every !== 'function' || typeof opsOf !== 'function') return 0;
  const plans = [];
  for (const pid of owners) {
    const spec = typeof specOf === 'function' ? specOf(pid, 'hex_quantum', 'quantum') : {};
    plans.push({
      pid,
      every: optNumber(spec, 'every', 10),
      atkPct: optNumber(spec, 'atkPct', 300) / 100,
      slowPct: Math.max(0, Math.min(100, optNumber(spec, 'slowPct', 30))) / 100,
      slowSec: optNumber(spec, 'slowSec', 3),
      healPct: optNumber(spec, 'healPct', 20) / 100,
    });
  }
  let pulses = 0;
  for (const p of plans) {
    battle.every(p.every, () => {
      const ops = opsOf(p.pid).filter(onField);
      if (!ops.length) return;
      // “攻击力最高”读的是当前聚合后的 ATK（buff 之后的值），因此会跟着战局变化
      let best = ops[0];
      for (const u of ops) if (u.s.atk > best.s.atk) best = u;
      const amount = best.s.atk * p.atkPct;
      if (!(amount > 0)) return;
      pulses++;
      for (const e of livingEnemies(battle)) {
        if (!e.alive) continue;
        battle.dealDamage(best, e, makeDamageInfo({
          amount, type: 'phys', canDodge: false, isSkill: false, tags: ['hex', QUANTUM_TAG],
        }));
        if (e.alive) battle.applyStatus(e, 'slow', { duration: p.slowSec, value: p.slowPct, source: best });
      }
      for (const u of ops) {
        if (!u.alive) continue;
        const amt = u.s.maxHp * p.healPct;
        if (amt > 0) battle.heal(u, u, amt, { self: true });
      }
    });
  }
  return {
    get owners() { return owners.length; },
    get pulses() { return pulses; },
  };
}

/**
 * 冰霜幽灵: 每 12 秒，束缚全场敌人 3s。
 *
 * 业主原文（逐字）：「每 12 秒，束缚全场敌人 3s。」
 *
 * 定时器同样用 `battle.every`（第一个在 t = every），每个拥有者各挂一个；到点给全场活着的敌人
 * applyStatus('bind', { duration: bindSec })——'bind' 是引擎目录状态（buffs.js STATUS.bind：flags bind + noMove，
 * moveMul 0，§3 表），因此束缚的免疫、抵抗（RESIST_STATUSES 缩短）与“被束缚不能移动”都由引擎负责，脚本不自己改
 * 速度字段。source = null（没有作为“施加者”的单位）。
 *
 * [ASSUMED: 1) 「全场敌人」= 当前活着的所有敌人（含飞行 / 隐匿敌人——束缚不要求可选性），不只拥有者半场；联防
 *   场上两个玩家同时持卡时各挂各的计时器，效果不叠加（同名状态取更长的剩余时间）。2) 对友军不生效（原文只说敌人）。]
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number|{owners:number, binds:number}} 0 when the card is absent
 */
export function installFrostGhost(hooks) {
  const owners = ownersOfCard(hooks, 'hex_frostghost');
  if (!owners) return 0;
  const { battle, specOf, optNumber } = hooks;
  if (typeof battle.every !== 'function') return 0;
  const plans = [];
  for (const pid of owners) {
    const spec = typeof specOf === 'function' ? specOf(pid, 'hex_frostghost', 'frostghost') : {};
    plans.push({ every: optNumber(spec, 'every', 12), bindSec: optNumber(spec, 'bindSec', 3) });
  }
  let binds = 0;
  for (const p of plans) {
    battle.every(p.every, () => {
      const targets = livingEnemies(battle);
      if (!targets.length) return;
      binds++;
      for (const e of targets) {
        if (!e.alive) continue;
        battle.applyStatus(e, 'bind', { duration: p.bindSec, source: null });
      }
    });
  }
  return {
    get owners() { return owners.length; },
    get binds() { return binds; },
  };
}
