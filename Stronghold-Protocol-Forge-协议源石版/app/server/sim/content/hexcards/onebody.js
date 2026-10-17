// server/sim/content/hexcards/onebody.js — 你我一体 (hex_onebody) battle script.
//
// CARD (the owner's list of 2026-10-12, §29.27, copied verbatim): 「作战中，你场上相同的干员生命上限叠加、生命共享；这些
// 干员攻击同一名敌人时，伤害提高至 150%。」
//
// TWO HALVES, both scoped to a GROUP = the same operator fielded more than once (one base chess id of one player, a normal
// and its elite counting as the same operator — `baseChessId`, support/index.js). A group of one is not a group and gets
// neither half, which is what makes this a card about duplicates rather than a flat buff.
//
// (1) 生命上限叠加、生命共享 — the group's max HPs are SUMMED into one pool, and every member's HP IS that pool.
//     * 「叠加」: for each member the engine's own additive `hpFlat` bucket is raised by exactly the amount that makes its
//       aggregated `s.maxHp` equal the sum M of the group's natural max HPs. The amount is derived from the member's own
//       numbers rather than guessed: with `bHp` = its `base.maxHp` and `K` = the multiplier the engine already applies
//       (练度, hpPct, hpMul — `m = bHp × K` is its max HP before this card), `hpFlat = M / K − bHp` gives
//       `(bHp + hpFlat) × K = M` exactly. Two identical operators therefore reach the SAME max HP, which is what lets
//       one number be the pool.
//     * 「生命共享」: every living member's `hp` is kept equal to the pool. Damage is immediate — the `damaged` hook
//       (which fires for every HP loss, 流失 included) adopts the struck member's new HP as the pool and mirrors it — so
//       a lethal blow on one member is lethal for the whole group in the same tick, exactly as one pool implies. Healing
//       is mirrored in the `heal` hook (the engine writes the healed member's HP after the hook, so only the OTHERS are
//       written here, to the value the engine is about to reach), and a `tick` reconciler catches anything else that
//       writes a member's HP directly (a kit's HP floor, a 复活).
//     * The pool is capped by the group's smallest current `s.maxHp` every time it is written, so a later buff that
//       changes one member's max HP can never leave another member above its own cap (the Unit invariant hp ≤ s.maxHp).
//     * A member that is off the field is skipped; it re-enters at the pool's current value on its next `deploy`, so a
//       redeploy cannot hand the group a second full bar.
//
// (2) 攻击同一名敌人时伤害提高至 150% — while two or more members of the group have attacked the SAME enemy, each
//     member's ATTACKS on that enemy deal ×(dmgPct/100) damage. Applied by multiplying the DamageInfo's own `mul` in the
//     `hit` hook — the engine's per-instance multiplier, the same field 近大远小 uses — so it composes with every other
//     multiplier instead of replacing one, and it is read for splash / chain instances too (each of them is an attack that
//     landed on that enemy).
//     [ASSUMED] The card is silent on the FIRST blow. Read as: the boost turns on with the second member's attack on
//     that enemy (the attacker is counted before the test), so the enemy is then "being attacked by two of them" and every
//     later attack — the first member's included — is boosted. A group of one never qualifies.
//
// CONTRACT: export function installOneBody(hooks) — hooks is the shared `hexHooks(battle)` bundle (see hooks.js).
// Returns 0 (the groups are built at battle start).

import { baseChessId, passiveBuff } from '../support/index.js';

/** The card's own fallback, used only when its spec omits it (the owner's number). */
const DEFAULT_DMG_PCT = 150;

/**
 * 你我一体: identical operators share one summed HP pool and focus-firing them deals ×1.5.
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle — `battle` / `ownersOf` / `opsOf` / `specOf` / `optNumber`
 *   are read here.
 * @returns {number} 0 (nothing happens at install time).
 */
export function installOneBody(hooks) {
  if (!hooks || typeof hooks !== 'object') return 0;
  const { battle, ownersOf, opsOf, specOf, optNumber } = hooks;
  if (!battle || typeof battle.on !== 'function') return 0;
  if (typeof ownersOf !== 'function' || typeof opsOf !== 'function') return 0;

  const owners = ownersOf('hex_onebody');
  if (!owners.length) return 0;

  /** ownerId → the damage factor its groups' attacks reach (1.5 by default). */
  const factor = new Map();
  for (const pid of owners) {
    const spec = typeof specOf === 'function' ? specOf(pid, 'hex_onebody', 'oneBody') : null;
    const pct = typeof optNumber === 'function' ? optNumber(spec, 'dmgPct', DEFAULT_DMG_PCT) : DEFAULT_DMG_PCT;
    factor.set(pid, pct / 100);
  }

  /**
   * The groups of one battle. A group: `{ members, pool, cap, attackers }` —
   *   members   the operator units sharing the pool (in deployment order),
   *   pool      the shared HP value every living member holds,
   *   cap       the pool's current ceiling (the group's smallest `s.maxHp`),
   *   attackers enemy → Set of member unit ids that have attacked it (half 2).
   */
  const groups = [];
  /** @type {Map<any, any>} unit → its group (empty when the operator has no duplicate). */
  const groupOf = new Map();
  /** Re-entrancy guard: the mirror writes must not be read back as a change. */
  let syncing = false;

  /** The pool ceiling: the group's smallest current max HP (each member's own cap). */
  const capOf = (g) => {
    let cap = Infinity;
    for (const u of g.members) {
      const m = u.alive && !u.removed ? u.s.maxHp : Infinity;
      if (m < cap) cap = m;
    }
    return Number.isFinite(cap) ? cap : g.cap;
  };

  /** Adopt `value` as the pool and write it to every living member. `except` is left alone (a heal's own target). */
  const sync = (g, value, killer = null, except = null) => {
    if (!g || syncing) return;
    syncing = true;
    try {
      const cap = capOf(g);
      g.cap = cap;
      const pool = Math.max(0, Math.min(cap, Number.isFinite(value) ? value : g.pool));
      g.pool = pool;
      for (const u of g.members) {
        if (u === except || !u.alive || u.removed) continue;
        if (u.hp !== pool) { u.hp = pool; u.markDirty(); }
      }
      // one pool reaching 0 takes the whole group with it (the member that was struck is killed by the engine itself)
      if (pool <= 0) for (const u of g.members) if (u.alive) battle.kill(u, killer);
    } finally { syncing = false; }
  };

  battle.on('battleStart', () => {
    for (const pid of owners) {
      const byBase = new Map();
      for (const u of opsOf(pid)) {
        const base = baseChessId(u);
        if (!base) continue;
        let list = byBase.get(base);
        if (!list) { list = []; byBase.set(base, list); }
        list.push(u);
      }
      for (const [base, members] of byBase) {
        if (members.length < 2) continue; // 「相同干员」: a lone operator shares nothing
        // the group's natural max HPs, read BEFORE this card's own buff exists
        const natural = members.map((u) => Math.max(0, u.s.maxHp));
        const total = natural.reduce((s, v) => s + v, 0);
        if (!(total > 0)) continue;
        for (let i = 0; i < members.length; i++) {
          const u = members[i];
          const bHp = Math.max(1, Number(u.base.maxHp) || 1);
          const k = natural[i] / bHp;                 // the multiplier the engine already applies to this member
          const flat = k > 0 ? total / k - bHp : total - natural[i];
          // one key per (player, base): 直接乘算's additive hpFlat bucket, persistent and idempotent
          passiveBuff(battle, u, `hex:onebody:${pid}:${base}`, { hpFlat: flat });
        }
        const g = { members, pool: 0, cap: total, attackers: new Map() };
        groups.push(g);
        for (const u of members) groupOf.set(u, g);
        sync(g, total); // everyone opens at the summed bar
      }
    }
  }, { priority: -10 }); // the house slot: after every bond / garrison / other card passive

  // ---- (1) the shared pool -----------------------------------------------------------------------------------------
  // Damage: `damaged` fires for every HP loss (a 流失 included) once the struck member's HP has already moved, so its new
  // HP IS the pool. Immediate, which is what makes a lethal blow lethal for the whole group in the same tick.
  battle.on('damaged', (c) => {
    if (c && c.type === 'element') return; // a gauge fill is not HP
    const g = c && c.target ? groupOf.get(c.target) : null;
    if (!g) return;
    sync(g, c.target.hp, c.source || c.credit || null);
  });
  // Healing: this hook runs BEFORE the engine writes the healed member's HP, and with the final (already multiplied)
  // amount — so the pool is that member's HP plus the amount about to land, and only the OTHERS are written here.
  battle.on('heal', (c) => {
    const g = c && c.target ? groupOf.get(c.target) : null;
    if (!g || !(c.amount > 0)) return;
    const t = c.target;
    const actual = Math.max(0, Math.min(c.amount, t.s.maxHp - t.hp));
    if (!(actual > 0)) return;
    sync(g, t.hp + actual, c.source || null, t);
  }, { priority: -1000 }); // last: every other heal handler has had its say on `amount`
  // Anything else that writes a member's HP directly (a kit's HP floor, a 复活, a direct assignment): the reconciler
  // notices the divergence and adopts the changed member's HP as the pool.
  battle.on('tick', () => {
    if (syncing) return;
    for (const g of groups) {
      for (const u of g.members) {
        if (!u.alive || u.removed) continue;
        if (u.hp !== g.pool) { sync(g, u.hp, null); break; }
      }
    }
  });
  // A member that comes back (a redeploy, a 复活) re-enters at the pool's current value, never at a fresh full bar.
  battle.on('deploy', (c) => {
    const g = c && c.unit ? groupOf.get(c.unit) : null;
    if (!g || !c.unit.alive) return;
    sync(g, g.pool, null, c.unit);
  });

  // ---- (2) 攻击同一名敌人时伤害提高至 150% ---------------------------------------------------------------------------
  battle.on('hit', (c) => {
    const d = c && c.dmg;
    const src = c && c.source;
    if (!d || d.cancel || !d.isAttack || !src || !c.target || c.target.side !== 'enemy') return;
    const g = groupOf.get(src);
    if (!g) return;
    const f = factor.get(src.ownerId);
    if (!(f > 1)) return;
    let seen = g.attackers.get(c.target);
    if (!seen) { seen = new Set(); g.attackers.set(c.target, seen); }
    seen.add(src.id);
    // two or more of the group's operators have now attacked this enemy (the current attacker included) ⇒ ×f
    if (seen.size >= 2) d.mul *= f;
  });

  return 0;
}
