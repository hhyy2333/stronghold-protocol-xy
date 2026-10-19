// server/sim/content/hexcards/batch14b.js — the battle halves of the fourteenth-b batch of player hexes
// (the owner's list of 2026-10-11, second half; five cards).
//
// CONTRACT (identical to the sibling modules): every `installX(hooks)` takes the shared bundle built by
// `hexHooks(battle)` (see hooks.js) and returns a small handle. Nothing here mutates the battle at install time except
// through the hooks it registers. The module is a no-op when its card is absent, and every effect is scoped to the
// OPERATORS OF THE PLAYER WHO OWNS THE CARD (hooks.ownersOf + hooks.opsOf) — in a 联防 field another player's
// operators never carry it.
//
// Determinism: no Math.random / Date / Node API here; the scripts never roll at all.

import { isHpLoss } from '../../damage.js';

/** True when the shared hook bundle can drive a battle. */
const canHook = (battle) => !!battle && typeof battle.on === 'function';

/**
 * 踢踏舞 (hex_tapdance, 3 阶): 干员每次攻击提升 7 攻击速度（2s 不攻击后失效）。
 *
 * Reading: every attack an own operator makes adds ONE independent +ASPD stack with its own 2 s clock; the stacks are
 * additive in the engine, so the live reading is "attacks in the last `idleSec` s × `aspdPerHit`". Two seconds after
 * the operator's last attack every stack has expired (nothing refreshes them), which is exactly the owner's
 * 「2s 不攻击后失效」.
 *
 * [ASSUMED] 「每次攻击」 covers a skill attack and a healer's heal action too — the engine's `attack` hook fires for
 *   both, and an attack-speed buff is useful to both.
 * [ASSUMED] One independent 2 s instance per attack (rather than one unbounded stack whose timer is reset): the owner's
 *   "final reading = attacks within 2 s × 7" is only true of the former.
 * [ASSUMED] `maxStacks` 100: the engine's 'independent' refresh needs a cap; at any real attack rate fewer than 100
 *   land inside 2 s, so the cap is never reached.
 */
const TAPDANCE_KEY = 'hex:tapdance';
const TAPDANCE_MAX = 100;

export function installTapdance(hooks) {
  const battle = hooks && hooks.battle;
  const owners = new Set((hooks && hooks.ownersOf ? hooks.ownersOf('hex_tapdance') : []) || []);
  if (!canHook(battle) || !owners.size) return 0;
  const specOf = hooks.specOf || (() => ({}));
  const optNumber = hooks.optNumber || ((spec, key, fallback) => {
    const v = spec ? Number(spec[key]) : NaN;
    return Number.isFinite(v) && v > 0 ? v : fallback;
  });
  let added = 0;
  battle.on('attack', (ctx) => {
    const u = ctx && ctx.attacker;
    if (!u || u.kind !== 'op' || u.side !== 'ally') return;
    if (!owners.has(u.ownerId)) return;
    if (!u.alive || !u.deployed || u.hidden) return;
    const spec = specOf(u.ownerId, 'hex_tapdance', 'tapdance');
    const per = optNumber(spec, 'aspdPerHit', 7);
    const idle = optNumber(spec, 'idleSec', 2);
    battle.addBuff(u, {
      key: TAPDANCE_KEY,
      duration: idle,
      refresh: 'independent',
      maxStacks: TAPDANCE_MAX,
      mods: { aspd: per },
      tags: ['hex', 'hexTapdance'],
    });
    added++;
  });
  return { get added() { return added; } };
}

/**
 * 终极刷新 (hex_ultrefresh, 3 阶): 在施放技能后再次释放一次（cd 30s）。
 *
 * Reading: when an own operator's skill ENDS, the same skill is cast once more for free (no SP / charge spent — otherwise
 * a duration/ammo skill, whose charge was already spent at its first cast, could never be replayed). Each operator has its
 * own 30 s cooldown, counted from the refresh it received, so one operator can refresh again 30 s later while another
 * operator's cooldown is untouched.
 *
 * The replay is scheduled with `battle.after(0, …)`, i.e. at the START of the next tick, not inside the `skillEnd`
 * handler: `SkillRuntime.end()` emits `skillEnd` and THEN the `['skill', id, 0]` event, so casting synchronously there
 * would put 'off' after 'on' and the client would draw the replayed skill as switched off.
 *
 * [ASSUMED] 「再次释放」 = a free replay (`activate(reason, { free: true })`), not a charge-consuming recast; the owner
 *   wrote 「再次释放一次」, and a recast that needs a charge would be a no-op in the exact case it is meant for.
 * [ASSUMED] The cooldown starts when the refresh fires; a 'withdrawn' (a cast whose charge was returned before it
 *   happened) or a 'death' end never triggers a refresh.
 * [ASSUMED] The replay keeps the skill's own ammo / charge bookkeeping inside the engine (a free cast re-fills an ammo
 *   skill as its second activation would, and never grants extra charges).
 */
export function installUltrefresh(hooks) {
  const battle = hooks && hooks.battle;
  const owners = new Set((hooks && hooks.ownersOf ? hooks.ownersOf('hex_ultrefresh') : []) || []);
  if (!canHook(battle) || !owners.size) return 0;
  const specOf = hooks.specOf || (() => ({}));
  const optNumber = hooks.optNumber || ((spec, key, fallback) => {
    const v = spec ? Number(spec[key]) : NaN;
    return Number.isFinite(v) && v > 0 ? v : fallback;
  });
  /** unit → battle time of its last granted refresh. */
  const lastRefresh = new Map();
  /** Units whose replay is queued: never a second replay from the replay's own skillEnd. */
  const queued = new Set();
  let refreshed = 0;
  battle.on('skillEnd', (ctx) => {
    const u = ctx && ctx.unit;
    const skill = ctx && ctx.skill;
    const reason = ctx && ctx.reason;
    if (!u || !skill || skill.noSkill || skill.kind === 'passive') return;
    if (u.kind !== 'op' || u.side !== 'ally' || !owners.has(u.ownerId)) return;
    if (reason === 'death' || reason === 'withdrawn') return;
    if (queued.has(u)) return;
    const spec = specOf(u.ownerId, 'hex_ultrefresh', 'ultrefresh');
    const cd = optNumber(spec, 'cd', 30);
    const last = lastRefresh.get(u);
    if (last != null && battle.time - last < cd - 1e-9) return; // per-operator 30 s cooldown
    lastRefresh.set(u, battle.time);
    queued.add(u);
    battle.after(0, () => {
      queued.delete(u);
      if (!u.alive || !u.deployed || u.hidden) return;
      if (skill.active) return;
      if (skill.activate('hex:ultrefresh', { free: true })) refreshed++;
    }, { owner: u });
  });
  return { get refreshed() { return refreshed; } };
}

/**
 * 不祥契约 (hex_omenpact, 3 阶): 基于已损失生命值，获得攻击力（最高 +150%）和吸血（40%）。攻击会消耗你的 5% 当前生命值。
 *
 * Reading: the ATK bonus is re-read every tick from the LIVE HP ratio — `missing = 1 − hp / maxHp`, `atkPct =
 * atkMaxPct × missing` — so it grows while the operator is hurt and shrinks again when it is healed. The lifesteal heals
 * the operator for `lifestealPct` of the damage it actually deals to enemies. Every attack it makes costs
 * `hpCostPct` of its CURRENT HP (a 流失, `battle.loseHp`, which cannot be lethal for any positive HP at 5 %).
 *
 * [ASSUMED] Linear ATK mapping: missing-HP ratio × 150 % (the owner gives the cap, not the curve; 0 HP would be the cap).
 * [ASSUMED] 吸血 counts every damage instance the operator deals to an enemy with HP damage (its normal/skill attacks and
 *   any bonus damage), not just normal attacks; element-gauge fills and 流失 are not damage dealt.
 * [ASSUMED] 「攻击」 that pays the 5 % cost includes a skill attack (an attack the operator actually performs) — the
 *   engine's `attack` hook is that event.
 */
const OMEN_ATK = 'hex:omenpact:atk';
const OMEN_TAG = 'hex:omenpact';

export function installOmenpact(hooks) {
  const battle = hooks && hooks.battle;
  const owners = new Set((hooks && hooks.ownersOf ? hooks.ownersOf('hex_omenpact') : []) || []);
  if (!canHook(battle) || !owners.size) return 0;
  const { specOf = () => ({}), optNumber = (spec, key, fallback) => {
    const v = spec ? Number(spec[key]) : NaN;
    return Number.isFinite(v) && v > 0 ? v : fallback;
  }, opsOf = () => [] } = hooks;
  let healed = 0;
  let paid = 0;
  // the ATK half: live, never cached (§29.15 — a stat read at install is stale the moment it is hurt)
  battle.on('tick', () => {
    for (const pid of owners) {
      const spec = specOf(pid, 'hex_omenpact', 'omenpact');
      const maxPct = optNumber(spec, 'atkMaxPct', 150) / 100;
      for (const u of opsOf(pid) || []) {
        if (!u || !u.alive || !u.deployed) continue;
        const maxHp = u.s && u.s.maxHp;
        if (!(maxHp > 0)) continue;
        const missing = Math.max(0, Math.min(1, 1 - u.hp / maxHp));
        const pct = maxPct * missing;
        if (pct > 1e-9) {
          battle.addBuff(u, { key: OMEN_ATK, mods: { atkPct: pct }, persist: true, allowDead: true, refresh: 'replace' });
        } else battle.removeBuff(u, OMEN_ATK);
      }
    }
  });
  // the lifesteal half: 40 % of what this operator's damage actually took off an enemy's HP
  battle.on('damaged', (ctx) => {
    if (!ctx || !ctx.dmg) return;
    const dmg = ctx.dmg;
    if (isHpLoss(dmg) || dmg.type === 'element') return;
    const src = ctx.source;
    const tgt = ctx.target;
    if (!src || src.kind !== 'op' || src.side !== 'ally' || !owners.has(src.ownerId)) return;
    if (!src.alive || !src.deployed || src.hidden) return;
    if (!tgt || tgt.side !== 'enemy') return;
    if (!(ctx.amount > 0)) return;
    const spec = specOf(src.ownerId, 'hex_omenpact', 'omenpact');
    const pct = optNumber(spec, 'lifestealPct', 40) / 100;
    const amount = ctx.amount * pct;
    if (!(amount > 0)) return;
    healed += battle.heal(src, src, amount, { self: true });
  });
  // the cost: 5 % of CURRENT HP per attack (a 流失 — never a hit, so no counter / lifesteal of its own)
  battle.on('attack', (ctx) => {
    const u = ctx && ctx.attacker;
    if (!u || u.kind !== 'op' || u.side !== 'ally' || !owners.has(u.ownerId)) return;
    if (!u.alive || !u.deployed || u.hidden) return;
    const spec = specOf(u.ownerId, 'hex_omenpact', 'omenpact');
    const pct = optNumber(spec, 'hpCostPct', 5) / 100;
    const cost = u.hp * pct;
    if (!(cost > 0)) return;
    paid += battle.loseHp(u, cost, { source: u, tags: [OMEN_TAG] });
  });
  return { get healed() { return healed; }, get paid() { return paid; } };
}

/**
 * 蛋白粉奶昔 (hex_proteinshake, 3 阶): 每有 100 生命值增加 10 点防御力、0.1 点法抗。
 *
 * Reading: `steps = floor(maxHp / perHp)`; the operator gains `steps × def` flat DEF and `steps × res` flat RES
 * (0.1 per step — a RES point here is 1, not 10). The max HP read is the LIVE stat (`u.s.maxHp`, every hpPct/hpFlat buff
 * already folded in) and it is re-read every tick, so a max-HP change re-scales the bonus at once.
 *
 * [ASSUMED] 「每有 100 生命值」 rounds DOWN: 199 max HP grants one step, 99 grants none.
 * [ASSUMED] The max HP is the operator's effective max HP for this battle (a +HP buff counts).
 */
const PROTEIN_KEY = 'hex:proteinshake';

export function installProteinShake(hooks) {
  const battle = hooks && hooks.battle;
  const owners = new Set((hooks && hooks.ownersOf ? hooks.ownersOf('hex_proteinshake') : []) || []);
  if (!canHook(battle) || !owners.size) return 0;
  const { specOf = () => ({}), optNumber = (spec, key, fallback) => {
    const v = spec ? Number(spec[key]) : NaN;
    return Number.isFinite(v) && v > 0 ? v : fallback;
  }, opsOf = () => [] } = hooks;
  let applied = 0;
  battle.on('tick', () => {
    for (const pid of owners) {
      const spec = specOf(pid, 'hex_proteinshake', 'proteinshake');
      const perHp = optNumber(spec, 'perHp', 100);
      const def = optNumber(spec, 'def', 10);
      const res = optNumber(spec, 'res', 0.1);
      for (const u of opsOf(pid) || []) {
        if (!u || !u.alive || !u.deployed) continue;
        const maxHp = u.s && u.s.maxHp;
        if (!(maxHp > 0)) continue;
        const steps = Math.floor(maxHp / perHp + 1e-9);
        if (steps <= 0) { battle.removeBuff(u, PROTEIN_KEY); continue; }
        battle.addBuff(u, {
          key: PROTEIN_KEY, mods: { defFlat: steps * def, resFlat: steps * res }, persist: true, allowDead: true,
          refresh: 'replace',
        });
        applied = steps;
      }
    }
  });
  return { get applied() { return applied; } };
}

/**
 * 重量级打击手 (hex_heavyhitter, 1 阶): 你的攻击造成相当于 10% 最大生命值的额外**法术**伤害。
 *
 * Reading: after one of the own operator's NORMAL attacks lands, every enemy that attack struck takes one separate ARTS
 * instance of `maxHpPct` of the operator's max HP. It is a plain 'arts' hit — mitigated by the target's RES like any
 * arts damage — and its amount is read from max HP, never from the attack's own multiplier.
 *
 * 业主修正 (2026-10-19): 「把「重量级打手」改成法术伤害」 — 原来是 'phys'（按 DEF 减伤），现在按法抗减伤。
 *
 * Recursion: the bonus is dealt from the `attack` hook (not from `damaged`), so the extra instance cannot trigger
 * another bonus; it is tagged `hex:heavyhitter` and flagged for any other content that might answer it.
 *
 * [ASSUMED] 「你的攻击」 = normal attacks only (`isSkill` false) — the owner's own clarification of this card says
 *   「每次普通攻击」.
 * [ASSUMED] Each enemy hit by a multi-target normal attack takes its own bonus instance.
 */
const HEAVY_TAG = 'hex:heavyhitter';

export function installHeavyHitter(hooks) {
  const battle = hooks && hooks.battle;
  const owners = new Set((hooks && hooks.ownersOf ? hooks.ownersOf('hex_heavyhitter') : []) || []);
  if (!canHook(battle) || !owners.size) return 0;
  const { specOf = () => ({}), optNumber = (spec, key, fallback) => {
    const v = spec ? Number(spec[key]) : NaN;
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } } = hooks;
  let fired = 0;
  battle.on('attack', (ctx) => {
    if (!ctx || ctx.isSkill) return; // normal attacks only
    const u = ctx.attacker;
    if (!u || u.kind !== 'op' || u.side !== 'ally' || !owners.has(u.ownerId)) return;
    if (!u.alive || !u.deployed || u.hidden) return;
    const maxHp = u.s && u.s.maxHp;
    if (!(maxHp > 0)) return;
    const spec = specOf(u.ownerId, 'hex_heavyhitter', 'heavyhitter');
    const amount = maxHp * (optNumber(spec, 'maxHpPct', 10) / 100);
    if (!(amount > 0)) return;
    for (const t of (ctx.targets || [])) {
      if (!t || t.side !== 'enemy' || !t.alive || t.removed) continue;
      const info = battle.makeDamage({ amount, type: 'arts', isAttack: false, canDodge: false, tags: [HEAVY_TAG] });
      info.hexHeavyHitter = true;
      fired++;
      battle.dealDamage(u, t, info);
    }
  });
  return { get fired() { return fired; } };
}
