// server/sim/content/hexcards/shieldwall.js — 盾墙 (hex_shieldwall) adjacent-重装 damage / healing split.
//
// CARD (owner's spec + boundary answers of 2026-10-11): 「作战中，己方所有干员阻挡数 +1，生命值上限 +20%。
//   相邻【重装】干员时：伤害和治疗分摊到每个相邻重装干员。」
//   The static half (+1 block / +20 % max HP) is the plain `battle: { blockCnt: 1, maxHpPct: 20 }` passive.
//   The split is THIS module, and the owner was explicit: **ONLY adjacent 重装 count**. No 重装 next door → nothing is
//   split, no matter what else stands there. Two or three tiles away → not in the pool. Another profession → not in the
//   pool. One 重装 adjacent → that 重装 takes the whole share. Exhaustive edge behaviour is contractual below.
//
// CONTRACT (fixed by the Lead; do NOT change the signatures — the integration point in ../hextech.js calls them):
//   export function installShieldwall(hooks)
//   hooks = {
//     battle, ownersOf(hexId) -> pid[], opsOf(pid) -> unit[],
//     specOf(pid, hexId, key) -> object, optNumber(spec, key, fallback) -> number,
//     isRetaliation(dmg) -> bool, isHpLoss(dmg) -> bool,
//     onField(u) -> bool,              // alive && deployed && !hidden  (a knocked-out operator is off the board)
//   }
//   export function adjacentTanks(battle, unit, ownerId) -> unit[]   // exported for tests + for the sibling module
//     — the 4-neighbour (up / down / left / right, NO diagonals) OWN ally operators of `ownerId` whose
//       `def.profession === 'TANK'`, on the field, deduplicated, in a deterministic order (tileR then tileC).
//
// =====================================================================================================================
// DAMAGE SPLIT — rule table (implement exactly this; every row is a test in test/sim/hexcards.test.js)
// =====================================================================================================================
// 1. Hook `hit`, priority **-20** — the same slot 坚守 uses for its redirection, so the two composes: 坚守 cuts the
//    incoming amount first, then this split takes its 50 % of what is left.
// 2. Eligible target: an ally operator of a 盾墙 owner (`t.kind === 'op' && t.side === 'ally'` and `st.owned.has(t.ownerId)`).
//    NOTE the target does NOT have to be a 重装 itself — a squishy standing next to a 重装 is protected (owner's A).
// 3. Skip and let the hit resolve untouched when ANY of: `!c.dmg`, `c.dmg.cancel`, the damage is already a split
//    (`dmg.shellSplit`), `isRetaliation(dmg)`, `isHpLoss(dmg)`, `dmg.type === 'element'`.
// 4. Pool = adjacentTanks(battle, t, t.ownerId). Empty pool → **return, nothing changes** (the hit lands in full).
// 5. `ratio = 0.5` (`spec.ratio`, default 50). `dmg.mul *= 1 - ratio` on the hit itself (mitigated upstream exactly as
//    坚守 does) and mark `dmg.shellCut = ratio`, `dmg.shellTarget = t`.
// 6. In the matching `damaged` handler (the amount is final and already mitigated): if `dmg.shellCut`, take
//    `base = amount / (1 - ratio)` (the pre-split amount), `share = base * ratio / pool.length`, and hand ONE instance of
//    `share` to each pool member. Clear `dmg.shellCut = 0` first so the instance cannot re-enter this split.
// 7. Each handed instance: `battle.makeDamage({ amount: share, type: 'true', canDodge: false, tags: ['hex:shieldwall'] })`,
//    set `d.shellSplit = true`, and deal it **sourceless** (`battle.dealDamage(null, member, d)`) — it is the damage the
//    target already took, re-dealt, and it must not be scaled a second time by whoever swung. The member's own
//    damage-taken modifiers and shields still apply (this is exactly the 坚守 share convention).
// 8. The member may die from its share (it is real damage): that is allowed and intended; `dealDamage` handles the kill.
// 9. A member that is no longer on the field at that instant (`onField` false) is skipped, and its share is LOST — do
//    NOT re-divide it among the survivors (deterministic, and it cannot loop).
// 10. Off-field target: `hit` never reaches an undeployed unit, but guard with `onField(t)` anyway.
// 11. The split instances land after the original hit in the same tick (the `damaged` handler runs inside
//     `dealDamage`), so the result digest is deterministic — do not use timers, do not use `battle.rng`.
//
// =====================================================================================================================
// HEALING SPLIT — same pool, same 50 %, symmetric
// =====================================================================================================================
// 12. Hook `heal` (damage.js emits `{ source, target, amount, opts }`, and a handler MAY lower `ctx.amount` before the
//     HP is applied — that is the documented contract). Eligible target: an ally operator of a 盾墙 owner.
// 13. Skip `ctx.opts && ctx.opts.regen === true` (每秒回血 is not 治疗 — the same distinction CHANGE/design uses),
//     skip when `!ctx.opts.regen` is false, skip an amount that is not finite/positive, and skip when a pool is empty.
// 14. `ctx.amount *= 1 - ratio` (the target keeps 50 %), then hand each pool member `heal(target.amount_before) * ratio /
//     pool.length` through `battle.heal(null, member, share, { source: ctx.source, silent: true })`.
//     `battle.heal` applies the member's own healing-taken multipliers, so pass the PRE-multiplier amount and let it
//     resolve; `silent: true` keeps it out of the floating-number stream.
// 15. RECURSION GUARD (mandatory): the member's own heal passes through this same hook. Tag the channel with a
//     per-instance flag — `ctx.opts.hexShellHeal = true` — and bail immediately when it is set, or the split would
//     recurse until the hook cap. A member at full HP heals 0 but must still not recurse.
// 16. A dead / undeployed member is skipped and its share is lost (same as 9). `battle.heal` itself refuses a dead target.
// 17. 禁疗 (`noHeal` / `healFree`) is respected by `battle.heal`, not here: do not second-guess it.
//
// ---------------------------------------------------------------------------------------------------------------------
// IMPLEMENTATION (teammate bulwark-split, 2026-10-11)
// ---------------------------------------------------------------------------------------------------------------------
// One `hit` / `damaged` pair carries the damage split (the `hit` slot cuts `dmg.mul` by the ratio; the `damaged` slot —
// the amount is final there — restores the pre-split base and hands one sourceless instance to each pool member), and one
// `heal` handler mirrors it. Nothing here is per-unit: the handlers are global, so the split follows every operator of
// every owner of the card with no re-install.
//
// Two decisions the contract deliberately leaves to the implementation:
//
//   * the owner set is read ONCE, at install: `hooks.ownersOf` (hexcards/hooks.js) is itself a snapshot of the battle's
//     `players[].playerEffects`, so an operator cannot become a carrier later in the same battle. The RATIO, on the other
//     hand, is read per event from the VICTIM's owner — `specOf(pid, 'hex_shieldwall', 'shieldwall').ratio`, a
//     PERCENTAGE (50 → 0.5, contract rule 5). Two owners of the card may run different ratios; a hit is split by the
//     ratio of whoever owns the operator that was hit.
//   * the pool is measured in `hit`, when the amount is cut, and kept on the DamageInfo as `dmg.shellPool`. The
//     `damaged` handler divides by THAT array's length and skips a member that is no longer on the field, so the member's
//     part is LOST instead of being re-divided among the survivors (rule 9) — the one place this deliberately does NOT
//     follow 坚守盟约's convention (bonds/addon/battle.js recomputes its pool at share time and re-divides).
//
// `onUnits` = the operators the card covers at install (the own operators of every player owning it); the split keys off
// the VICTIM's owner, so those are exactly the units that can ever be protected.

import { isRetaliation as pipelineRetaliation, isHpLoss as pipelineHpLoss } from '../../damage.js';

const HEX_ID = 'hex_shieldwall';
const SPEC_KEY = 'shieldwall';
/** Tag of every instance this script hands out (rule 7). */
const TAG = 'hex:shieldwall';
/** `spec.ratio` is a percentage; the data set (and the owner) default it to 50. */
const DEFAULT_RATIO_PCT = 50;

/** hexcards/hooks.js `onField`: alive + deployed + not hidden (a knocked-out operator is off the board). */
const onFieldOf = (u) => !!u && !!u.alive && !!u.deployed && !u.hidden;

/**
 * The 4-neighbour (up / down / left / right, NO diagonals) OWN ally operators of `ownerId` that are 重装 and on the field,
 * deduplicated and ordered by `tileR` then `tileC` — the 盾墙 pool. `unit` is never in its own pool (Manhattan distance 1
 * excludes the tile it stands on). Pure: it reads the battle and never mutates it, so a caller may use it to preview.
 * @param {any} battle
 * @param {any} unit
 * @param {string|null} ownerId
 * @returns {any[]}
 */
export function adjacentTanks(battle, unit, ownerId) {
  if (!battle || !unit) return [];
  const r = Number(unit.tileR), c = Number(unit.tileC);
  if (!Number.isFinite(r) || !Number.isFinite(c)) return [];
  const list = Array.isArray(battle.allyUnits) ? battle.allyUnits : [];
  const out = [];
  const seen = new Set();
  for (const u of list) {
    if (!u || u === unit || seen.has(u)) continue;
    if (u.kind !== 'op' || u.side !== 'ally') continue;
    if (u.ownerId !== ownerId) continue;                       // only the SAME owner — nobody else's board
    if (!u.def || u.def.profession !== 'TANK') continue;       // only 【重装】 join the pool
    const ur = Number(u.tileR), uc = Number(u.tileC);
    if (!Number.isFinite(ur) || !Number.isFinite(uc)) continue;
    if (Math.abs(ur - r) + Math.abs(uc - c) !== 1) continue;   // a diagonal is Manhattan 2: never a member
    if (!onFieldOf(u)) continue;
    seen.add(u);
    out.push(u);
  }
  out.sort((a, b) => a.tileR - b.tileR || a.tileC - b.tileC || a.id - b.id);
  return out;
}

/**
 * Install the 盾墙 battle script. See the contract in the file header.
 * @param {any} hooks the shared bundle from hexcards/hooks.js (`hexHooks(battle)`)
 * @returns {{ onUnits: number }} the operators the card covers (its owners' own operators)
 */
export function installShieldwall(hooks) {
  const battle = hooks && hooks.battle;
  if (!battle || typeof battle.on !== 'function') return { onUnits: 0 };
  const { ownersOf, opsOf, specOf, optNumber } = hooks;
  // The predicates come from the bundle; the import is the fallback for a caller handing over a partial bundle (the
  // header asks this module to stay usable without ../hextech.js — importing that would be a cycle).
  const isRetaliation = typeof hooks.isRetaliation === 'function' ? hooks.isRetaliation : pipelineRetaliation;
  const isHpLoss = typeof hooks.isHpLoss === 'function' ? hooks.isHpLoss : pipelineHpLoss;
  const onField = typeof hooks.onField === 'function' ? hooks.onField : onFieldOf;

  const ownerSet = new Set(typeof ownersOf === 'function' ? ownersOf(HEX_ID) : []);
  if (!ownerSet.size) return { onUnits: 0 };
  let onUnits = 0;
  if (typeof opsOf === 'function') for (const pid of ownerSet) onUnits += opsOf(pid).length;

  /** The ratio of the card `pid` owns, percentage → [0, 1]. 0 (or a missing card) means "no split". */
  const ratioFor = (pid) => {
    const spec = typeof specOf === 'function' ? specOf(pid, HEX_ID, SPEC_KEY) : null;
    const pct = typeof optNumber === 'function'
      ? optNumber(spec, 'ratio', DEFAULT_RATIO_PCT)
      : (Number(spec && spec.ratio) > 0 ? Number(spec.ratio) : DEFAULT_RATIO_PCT);
    const ratio = pct / 100;
    return Number.isFinite(ratio) ? ratio : 0;
  };

  // ---- damage split ------------------------------------------------------------------------------------------------
  // The same -20 slot 坚守盟约's redirect uses: it cuts the incoming amount first (also by touching `dmg.mul`), and this
  // split then takes its share of what is left. Both are plain multipliers on the one DamageInfo, so the order cannot
  // matter; what does matter is that the share is computed from the amount LEFT after every other cut.
  battle.on('hit', (c) => {
    if (!c) return;
    const t = c.target, dmg = c.dmg;
    // rule 2: an ally operator of a 盾墙 owner — the target itself need not be a 重装
    if (!t || t.kind !== 'op' || t.side !== 'ally' || !dmg) return;
    if (!ownerSet.has(t.ownerId)) return;
    if (!onField(t)) return;                                             // rule 10
    // rule 3: a cancelled hit, our own handed-out instance, a retaliation (counter / reflect / 坚守 thorn), 流失, or an
    // element 损伤 fill (a gauge, not a 受到伤害 — `element`, never `elemental`) is left alone
    if (dmg.cancel || dmg.shellSplit || isRetaliation(dmg) || isHpLoss(dmg) || dmg.type === 'element') return;
    const ratio = ratioFor(t.ownerId);                                   // the VICTIM's owner's card, not the attacker's
    if (!(ratio > 0) || ratio >= 1) return;
    const pool = adjacentTanks(battle, t, t.ownerId);
    if (!pool.length) return;                                            // rule 4: nobody adjacent → the hit lands in full
    dmg.mul *= 1 - ratio;                                                // mitigated upstream exactly as 坚守 does
    dmg.shellCut = ratio;
    dmg.shellTarget = t;
    dmg.shellPool = pool;                                                // rule 9: the pool as measured at cut time
  }, { priority: -20 });

  battle.on('damaged', (c) => {
    if (!c) return;
    const t = c.target, dmg = c.dmg;
    if (!t || !dmg || !dmg.shellCut) return;
    if (dmg.shellTarget && dmg.shellTarget !== t) return;
    const ratio = Number(dmg.shellCut);
    dmg.shellCut = 0;                                                    // clear FIRST: this instance never re-enters
    if (!(ratio > 0) || ratio >= 1) return;
    const amount = Number(c.amount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const base = amount / (1 - ratio);                                   // rule 6: the pre-split amount
    if (!(base > 0) || !Number.isFinite(base)) return;
    const pool = Array.isArray(dmg.shellPool) && dmg.shellPool.length ? dmg.shellPool : adjacentTanks(battle, t, t.ownerId);
    if (!pool.length) return;
    const share = (base * ratio) / pool.length;                          // by the CUT-TIME length: never re-divided (rule 9)
    if (!(share > 0) || !Number.isFinite(share)) return;
    for (const m of pool) {
      if (!onField(m)) continue;                                         // rule 9: gone → its share is lost
      const d = battle.makeDamage({ amount: share, type: 'true', canDodge: false, tags: [TAG] });
      d.shellSplit = true;                                               // so it cannot split again (rule 7)
      battle.dealDamage(null, m, d);                                     // sourceless: the target already took this damage
    }
  });

  // ---- healing split -----------------------------------------------------------------------------------------------
  battle.on('heal', (ctx) => {
    if (!ctx) return;
    const t = ctx.target;
    // rule 12: an ally operator of a 盾墙 owner
    if (!t || t.kind !== 'op' || t.side !== 'ally') return;
    if (!ownerSet.has(t.ownerId)) return;
    if (!onField(t)) return;
    const opts = ctx.opts;
    // rule 15: the member's own heal passes through this same hook — bail on our own channel or the split would recurse
    // to the hook cap. The flag travels in `opts`, which is exactly the object a `heal` handler receives as `ctx.opts`.
    if (opts && opts.hexShellHeal === true) return;
    // rule 13: 每秒回血 is no 治疗 (and the engine ignores a regen handler's amount change anyway)
    if (opts && opts.regen === true) return;
    const amount = Number(ctx.amount);
    if (!Number.isFinite(amount) || !(amount > 0)) return;
    const ratio = ratioFor(t.ownerId);
    if (!(ratio > 0) || ratio >= 1) return;
    const pool = adjacentTanks(battle, t, t.ownerId);
    if (!pool.length) return;
    const share = (amount * ratio) / pool.length;                        // `amount` = the PRE-cut value (rule 14)
    if (!(share > 0) || !Number.isFinite(share)) return;
    ctx.amount = amount * (1 - ratio);                                   // the target keeps the rest
    const source = ctx.source ?? null;
    for (const m of pool) {
      if (!onField(m)) continue;                                         // rule 16: gone → its share is lost
      // `battle.heal` folds the member's own healing-taken multipliers in, so the share goes in pre-multiplier;
      // `silent` keeps it out of the floating-number stream and `hexShellHeal` breaks the recursion (rule 15).
      battle.heal(null, m, share, { source, silent: true, hexShellHeal: true });
    }
  });

  return { onUnits };
}
