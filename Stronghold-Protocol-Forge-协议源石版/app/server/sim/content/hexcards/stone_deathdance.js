// server/sim/content/hexcards/stone_deathdance.js — 第二十四批（业主 2026-10-31）：3 阶普通卡【死亡之舞】
// (hex_deathdance, 3 阶 / prismatic / 普通卡) 的战斗半边。
//
// 设计稿：04-文档/协议源石-死亡之舞与四张卡调整-设计稿-20261031.md §3.1。
// 业主原文（逐字）：「增加三阶死亡之舞，干员受到的伤害变为在3s秒扣血，干员周围八格若有敌人死亡则回复生命上限的5%」
// 数值全部读卡面 `params.deathDance`（tools/hextech/roster.mjs），这里只写行为 —— 调数不改代码。
//
// 口径（设计稿 §3.1，逐条对应下面的实现注释）：
//   * **作用域**：拥有该卡的玩家自己的己方**干员**（`u.kind === 'op' && u.side === 'ally' && u.ownerId ∈ owners`）。
//     召唤物 / 装置 / 队友的干员一律不算（卡面写的是「干员受到的伤害」）。
//   * **延迟**：`hpDamage` 钩子（护盾之后、`applyHpLoss` 之前，damage.js dealDamage 的最后一步）里，目标是自己人
//     且 `c.amount > 0` ⇒ 把 `c.amount` 置 0（这一份**现在**一点血都不掉），并按 `delaySec / tickSec`
//     （默认 3 / 0.5 = 6 跳）压进该干员的待扣队列。护盾在这个钩子**之前**就已经挡完了，所以「护盾仍先抵挡、
//     只延迟超出部分」是引擎自然给出的口径，不需要模块自己再算一遍。
//   * **扣血**：每个拥有者一个 `battle.every(tickSec)` 的脉冲，每跳对队列里的每一份伤害扣
//     `剩余 / 剩余跳数`（最后一跳直接取整笔剩余），走 `battle.loseHp(u, tick, { source, from, tags })` ——
//     流失通道，**可致死**，来源 / `from` 沿用原伤害（击杀归属与统计照原 source 记）。
//   * **回血**：`death` 钩子里，敌人 `reason === 'killed'` 时，对拥有者的每个在场己方干员
//     （`alive && deployed && !hidden`）判定「周围八格」：敌人格 `(Math.round(u.y), Math.round(u.x))` 与干员格
//     `(u.tileR, u.tileC)` 的**切比雪夫距离 ≤ 1** ⇒ `battle.heal(u, u, u.s.maxHp × healPct/100)`。
//
// [ASSUMED]（设计稿没写死、实现时定下的口径）：
//   1. **一份伤害一条队列条目**：同一 tick 里的多份伤害各占一条（各自的 3 秒、各自的 source / `from`），
//      不是把几份混成一笔再摊 —— 这样「来源沿用原伤害的 source / from 继承 tag」（设计稿 §3.1 的 [ASSUMED]）
//      才能逐份成立。单份伤害的表现仍是「每跳 剩余/剩余跳数」。
//   2. **最后一跳取整笔剩余**：6 跳之和严格等于原始伤害（不留浮点尾数）。
//   3. **延迟伤害走 `loseHp`（流失）**：它不重入 `hpDamage`（否则会把自己再延迟一遍），但仍然会走
//      `damaged` / `fatal` / `kill`，所以可致死、击杀归属照原 source。
//   4. **干员阵亡时丢掉未扣完的队列**：不再对已经倒下的干员扣血（重部署回来也不补扣）。
//   5. **「周围八格」** = 敌人格与干员格的切比雪夫距离 ≤ 1；敌人格用 `Math.round(y/x)` 取整到格。
//   6. **回血是自我治疗**（`battle.heal(u, u, …)`）：吃治疗加成与上限截断；`noHeal` 不影响自我治疗，
//      但 `healFree`（例如【困毙之雪】的冰封）仍然挡得住它。
//   7. **跳数** = `Math.round(delaySec / tickSec)`，至少 1 跳；`tickSec` 低于引擎 TICK 时按 TICK 计
//      （引擎的 `battle.every` 有同样的下限，否则实际延迟会比卡面长）。
//   8. **第一跳在收到伤害 `tickSec` 之后**：脉冲只在 `battle.time ≥ due` 时扣某一条，所以 6 跳正好铺满 3 秒。
//      若按「下个脉冲就扣」，全局脉冲的相位会让第一跳立刻发生，实际窗口缩到 2.5 秒。
//   9. **只有「HP 伤害」被延迟**：元素损伤走的是元素槽（`dealDamage` 在 `hpDamage` 之前就分流了），生命流失
//      （`battle.loseHp`，PRTS「生命流失…不是受到伤害」）根本不经过这个钩子 —— 两者都不延迟，与卡面「受到的伤害」
//      的通常读法一致。
//
// 确定性：没有 Math.random / Date / Node API；计时只用 `battle.every` / `battle.after`；这张卡不需要随机。
//
// CONTRACT: export function installDeathDance(hooks) — hooks is the shared `hexHooks(battle)` bundle
// (server/sim/content/hexcards/hooks.js). Returns 0 when the card is absent, else a count of covered operators.
// Install only REGISTERS hooks: no battle state changes at install time.

import { TICK } from '../../constants.js';

/** 卡 id（模块自己的查表键）。 */
const CARD = 'hex_deathdance';
/** 卡面 effect 里那段参数的名字。 */
const SPEC = 'deathDance';
/** 延迟扣血那几笔流失的 tag（`loseHp` 自己还会补一个 'hpLoss'）。 */
const TAG = 'hex:deathdance';

/** 设计稿 §2 的兜底值：只在卡面缺这一格时用。 */
const FALLBACK = Object.freeze({ delaySec: 3, tickSec: 0.5, healPct: 5 });

/**
 * 读一个卡面数字。**不能**用 `hooks.optNumber`：它只接受 `> 0`，而这张卡的 `healPct: 0`（关掉回血）是合法口径。
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

/** 「卡片存在 + 包形状对」守卫：没有卡（或 hooks 不是 hexHooks 的返回对象）时是个 no-op。 */
function ownersOfCard(hooks, hexId) {
  if (!hooks || typeof hooks !== 'object') return null;
  const { battle, ownersOf } = hooks;
  if (!battle || typeof battle.on !== 'function' || typeof ownersOf !== 'function') return null;
  const owners = ownersOf(hexId);
  return owners && owners.length ? owners : null;
}

/**
 * 【死亡之舞】hex_deathdance（3 阶 / prismatic / 普通卡）的战斗半边。
 * 口径与逐条 [ASSUMED] 见文件头；卡面参数见设计稿 §2。
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number} 没有这张卡 ⇒ 0；有卡 ⇒ 被这张卡覆盖的己方干员数（安装时的名册，含未部署的）
 */
export function installDeathDance(hooks) {
  const owners = ownersOfCard(hooks, CARD);
  if (!owners) return 0;
  const { battle, specOf } = hooks;
  const owned = new Set(owners);
  /** 在场：与 `hexHooks.onField` 同一口径（alive && deployed && !hidden）。 */
  const onField = (u) => !!u && !!u.alive && !!u.deployed && !u.hidden;

  /** ownerId → 这张卡的参数（只读一次；跳数按卡面的 delaySec / tickSec 折算）。 */
  const plan = new Map();
  for (const pid of owners) {
    const spec = typeof specOf === 'function' ? specOf(pid, CARD, SPEC) : {};
    const delaySec = Math.max(0, numOf(spec, 'delaySec', FALLBACK.delaySec));
    // 引擎的 `battle.every` 把间隔夹到 TICK 以上（battle/hooks.js），跳数按同一个下限算，免得实际延迟比卡面长
    const tickSec = Math.max(TICK, numOf(spec, 'tickSec', FALLBACK.tickSec));
    plan.set(pid, {
      tickSec,
      ticks: Math.max(1, Math.round(delaySec / tickSec)),
      healPct: Math.max(0, numOf(spec, 'healPct', FALLBACK.healPct)) / 100,
    });
  }

  /** 拥有者的己方干员（召唤物 / 装置 / 队友的干员都不算）。 */
  const isOwnOp = (u) => !!u && u.kind === 'op' && u.side === 'ally' && owned.has(u.ownerId);

  /**
   * 干员 → 待扣队列（`{ remaining, ticksLeft, due, source, from }` 的数组）。
   * 一份伤害一条条目：各自按自己的跳数摊完，来源 / tag 也各自保留（[ASSUMED] 1）。
   */
  const queues = new Map();

  // ===================================================================================================================
  // 延迟：护盾之后、真正掉血之前，把这一份 HP 伤害压进队列

  battle.on('hpDamage', (c) => {
    if (!c || !(c.amount > 0)) return;
    const u = c.target;
    if (!isOwnOp(u)) return;
    const p = plan.get(u.ownerId);
    if (!p) return;
    const amount = c.amount;
    c.amount = 0;                                    // 这一份现在一点血都不掉（之后由脉冲逐跳扣）
    let list = queues.get(u);
    if (!list) { list = []; queues.set(u, list); }
    // `due` = 这一份的第一跳时点：收到伤害之后再过 tickSec 才扣第一下，于是「6 跳」正好铺满 delaySec 秒
    // （否则全局脉冲的相位会让某些伤害第一跳就立刻扣，实际窗口缩到 delaySec − tickSec）。
    list.push({ remaining: amount, ticksLeft: p.ticks, due: battle.time + p.tickSec, source: c.source ?? null, from: c.dmg ?? null });
  });

  // ===================================================================================================================
  // 扣血：每个拥有者一个 tickSec 的脉冲，每跳扣「剩余 / 剩余跳数」

  /**
   * 扣一跳（只处理 `pid` 自己的干员）。
   * @param {string} pid @param {{tickSec:number,ticks:number,healPct:number}} p
   */
  const drain = (pid, p) => {
    for (const [u, list] of queues) {
      if (!u || u.ownerId !== pid) continue;
      if (!u.alive) { queues.delete(u); continue; }   // 倒下了就不再扣（[ASSUMED] 4）
      for (const e of list) {
        if (!u.alive) break;                          // 这一跳把他扣死了：同 tick 的其余条目留到下一跳
        if (!(e.ticksLeft > 0) || !(e.remaining > 0)) continue;
        if (battle.time + 1e-9 < e.due) continue;     // 这一份还没到自己的下一跳
        const tick = e.ticksLeft <= 1 ? e.remaining : e.remaining / e.ticksLeft;   // 最后一跳取整笔剩余
        e.remaining -= tick;
        e.ticksLeft--;
        e.due += p.tickSec;
        if (tick > 0) {
          // 流失通道：不重入 hpDamage（[ASSUMED] 3），但会走 damaged / fatal / kill ⇒ 可致死
          battle.loseHp(u, tick, { source: e.source, from: e.from, tags: ['hpLoss', TAG] });
        }
      }
      const left = list.filter((e) => e.ticksLeft > 0 && e.remaining > 1e-9);
      if (left.length) queues.set(u, left); else queues.delete(u);
      if (!u.alive) queues.delete(u);
    }
  };
  for (const pid of owners) {
    const p = plan.get(pid);
    if (p) battle.every(p.tickSec, () => drain(pid, p));
  }

  // ===================================================================================================================
  // 回血：周围八格有敌人死亡 ⇒ 该干员回复 healPct% 最大生命

  battle.on('death', (c) => {
    const u = c && c.unit;
    if (!u) return;
    if (u.side !== 'enemy') {
      if (owned.has(u.ownerId)) queues.delete(u);     // 自己人倒了：丢掉没扣完的队列（[ASSUMED] 4）
      return;
    }
    if (c.reason !== 'killed') return;                // 漏怪 / 撤离不算「死亡」
    const er = Math.round(u.y), ec = Math.round(u.x); // 敌人格（场上坐标取整到格）
    for (const pid of owners) {
      const p = plan.get(pid);
      if (!p || !(p.healPct > 0)) continue;
      for (const a of battle.allyUnits) {
        if (!a || a.ownerId !== pid || !isOwnOp(a) || !onField(a)) continue;
        const dr = Math.abs(a.tileR - er), dc = Math.abs(a.tileC - ec);
        if (dr > 1 || dc > 1) continue;               // 「周围八格」= 切比雪夫距离 ≤ 1
        battle.heal(a, a, a.s.maxHp * p.healPct);     // 自我治疗：吃治疗加成 / 上限截断（[ASSUMED] 6）
      }
    }
  });

  // 安装时的覆盖面（名册里的己方干员数）：0 只在「没有这张卡」或「一个干员都没有」时出现。
  let covered = 0;
  for (const u of battle.allyUnits) if (isOwnOp(u)) covered++;
  return covered;
}
