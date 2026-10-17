// server/sim/content/hexcards/armor.js — 反击装甲 (hex_armor) battle script.
//
// CARD (owner's spec, 2026-10-11): 「作战中，己方所有干员防御力 +18%、法术抗性 +10，受到伤害后对伤害来源造成 100% 防御力的真实伤害。」
//   The static half (+18% DEF / +10 RES) is the plain `battle: { defPct: 18, resFlat: 10 }` passive. THIS module adds the
//   riposte: whenever an OWN operator takes damage, the damage's SOURCE takes true damage equal to 100 % of that
//   operator's CURRENT DEF (`u.s.def`, the deployed stat — every buff already folded in).
//
// CONTRACT (fixed by the Lead; do NOT change the signature — the integration point in ../hextech.js calls it):
//   export function installArmor(hooks)
//   hooks = {
//     battle, ownersOf(hexId) -> pid[], opsOf(pid) -> unit[],
//     specOf(pid, hexId, key) -> object, optNumber(spec, key, fallback) -> number,
//     isRetaliation(dmg) -> bool,   // server/sim/damage.js — true for a counter / reflect / 坚守 thorn instance
//     isHpLoss(dmg) -> bool,        // server/sim/damage.js — 流失, never a 受到伤害
//   }
//
// RULES the implementation must keep (all of them are real traps a naive version walks into):
//   1. Hook `damaged` (the target has already lost the HP) — its payload is `{ source, target, amount, type, dmg }`.
//      `source` is null for 无来源 damage (terrain, a zone tick, an enemy's own drain): SKIP those, there is nobody to
//      strike back at. `dmg.credit` is NOT the attacker; do not use it.
//   2. Skip `target` that is not an owned ALLY OPERATOR (`kind === 'op' && side === 'ally' && ownerId === pid`):
//      summons, devices and the 器物 are not carriers of the card.
//   3. Skip `dmg.type === 'element'` (元素损伤 fills a gauge, it is not a 受到伤害) and `isHpLoss(dmg)` (流失).
//   4. RECURSION: the riposte is itself damage; if it were allowed to answer again the pair would ping-pong until the
//      32-deep hook cap silently eats the tick (the 弹簧盾护 ↔ 泡泡 bug of §29.10). Tag your own instance and skip it —
//      `tags: ['hex:armor']` plus a `dmg.hexRiposte = true` flag, and bail on `isRetaliation(dmg)` so a 坚守 thorn or an
//      operator counter never starts a chain (the same predicate 铁壁 uses).
//   5. The riposte must NOT be mitigated a second time: build it with `type: 'true'` (真伤). A `phys` instance would be
//      reduced by the attacker's DEF again and collapse onto the 5 % floor — measured on 铁壁 (§29.15): a 15 % reflect
//      delivered 0.75 % on a DEF-200 operator. `battle.makeDamage({ amount, type: 'true', isSkill: true, tags: [...] })`
//      then `battle.dealDamage(sourceUnit, attacker, info)` — pass the OPERATOR as the source so the damage is credited
//      to it, and keep the tag so `isRetaliation` recognises it.
//   6. `u.s.def` refreshes on every markDirty; read it at fire time, never cache it. A knocked-out / undeployed
//      operator fires nothing (the `damaged` hook only reaches a live unit, but guard anyway).
//
// Keep the file self-contained (no import of hextech.js — that would be a cycle; the two predicates come from
// '../../damage.js'). The returned object exposes the live riposte tally: the handlers fire long after `installArmor`
// returns, so the contract's "number of ripostes fired" can only be read through it (`fired` / `count`).

import { isRetaliation, isHpLoss } from '../../damage.js';

/** The card's hex id (the key of the data/hextech.json record). */
const HEX_ID = 'hex_armor';
/**
 * Tag of our own instance. `isRetaliation` knows only counter / reflect / springCounter / steadThorn / steadShare, so the
 * tag alone is NOT what breaks the chain — it is there for other content (and for a test to recognise the blow), while
 * `dmg.hexRiposte` is the flag rule 4 turns on.
 */
const TAG = 'hex:armor';

export function installArmor(hooks) {
  const battle = hooks && hooks.battle;
  const owners = new Set((hooks && hooks.ownersOf ? hooks.ownersOf(HEX_ID) : []) || []);
  const specOf = (hooks && hooks.specOf) || (() => ({}));
  const optNumber = (hooks && hooks.optNumber) || ((spec, key, fallback) => {
    const v = spec ? Number(spec[key]) : NaN;
    return Number.isFinite(v) && v > 0 ? v : fallback;
  });
  const isRet = hooks && typeof hooks.isRetaliation === 'function' ? hooks.isRetaliation : isRetaliation;
  const hpLoss = hooks && typeof hooks.isHpLoss === 'function' ? hooks.isHpLoss : isHpLoss;

  let fired = 0;
  const carrierCount = hooks && typeof hooks.opsOf === 'function'
    ? [...owners].reduce((n, pid) => n + ((hooks.opsOf(pid) || []).length), 0)
    : 0;

  if (battle && typeof battle.on === 'function' && owners.size) {
    battle.on('damaged', (c) => {
      if (!c) return;
      const dmg = c.dmg || null;
      // (4) the instance must not answer itself, and nothing that IS an answer (a counter / reflect / 坚守 thorn) may
      // start a chain. The flag catches our own ping-pong across two owners, the tag catches a re-created copy.
      if (dmg) {
        if (dmg.hexRiposte) return;
        if (Array.isArray(dmg.tags) && dmg.tags.includes(TAG)) return;
        if (isRet(dmg)) return;
        // (3) 流失 is not a 受到伤害 ("生命流失…不会触发反伤、受击回复")
        if (hpLoss(dmg)) return;
      }
      // (3) 元素损伤 fills a gauge, it is not a 受到伤害. A bare ctx without a DamageInfo (harness-synthesised events)
      // still carries `type`, so read both shapes.
      if ((dmg ? dmg.type : c.type) === 'element') return;
      // (2) the carrier is an OWN operator of a player holding the card: a summon, a device or another player's operator
      // is not shielded by it
      const target = c.target;
      if (!target || target.kind !== 'op' || target.side !== 'ally') return;
      if (!owners.has(target.ownerId)) return;
      // (6) a knocked-out / undeployed / hidden carrier fires nothing (the always-live carrier is guarded anyway)
      if (!target.alive || !target.deployed || target.hidden) return;
      // (1) 无来源 damage has nobody to strike back at; `dmg.credit` is NOT the attacker (the hook passes it separately)
      const src = c.source;
      if (!src || !src.alive || src.removed) return;
      // (5) the amount is 100 % of the operator's CURRENT DEF — the deployed stat with every buff already folded in,
      // re-read at fire time, never cached (rule 6). `defRatio` is the record's PERCENTAGE (100 = 100 %).
      const ratio = optNumber(specOf(target.ownerId, HEX_ID, 'armor'), 'defRatio', 100) / 100;
      const amount = target.s.def * ratio;
      if (!(amount > 0)) return;
      const info = battle.makeDamage({ amount, type: 'true', isSkill: true, tags: [TAG] });
      info.hexRiposte = true;
      fired++;
      // `type: 'true'` = no second mitigation (a `phys` instance would be cut by the attacker's DEF again and collapse
      // onto the 5 % floor); the OPERATOR is the source, so the knock-out credit and the damage-dealt stats land on it
      battle.dealDamage(target, src, info);
    });

    // ---- the DEALT half (owner's rebalance of 2026-10-15) ------------------------------------------------------
    // 「受到或造成伤害时对敌人造成 200% 防御力真伤」: an own operator that LANDS a hit also answers, striking the enemy
    // it just hit. `onDealt` is what turns this on; a record without it behaves exactly as before (the taken-only
    // card of the fifth batch).
    //
    // The same guards as the taken half, mirrored: our own instance never re-answers (`hexRiposte` / the tag), an
    // answer never starts a chain (isRetaliation), 流失 and 元素损伤 are not 造成伤害, and the striker must be a live
    // own operator. The blow is `defRatio` of the STRIKER's own DEF (its own armour is what the card's text names),
    // and the enemy it hit is the target — never the striker, which would be self-damage.
    const onDealt = [...owners].some((pid) => {
      const spec = specOf(pid, HEX_ID, 'armor');
      return !!(spec && spec.onDealt);
    });
    if (onDealt) {
      battle.on('damaged', (c) => {
        if (!c) return;
        const dmg = c.dmg || null;
        if (dmg) {
          if (dmg.hexRiposte) return;
          if (Array.isArray(dmg.tags) && dmg.tags.includes(TAG)) return;
          if (isRet(dmg)) return;
          if (hpLoss(dmg)) return;
        }
        if ((dmg ? dmg.type : c.type) === 'element') return;
        // The STRIKER is this card's carrier; the struck unit must be an enemy (friendly fire is not 「对敌人」).
        const src = c.source;
        const tgt = c.target;
        if (!src || src.kind !== 'op' || src.side !== 'ally') return;
        if (!owners.has(src.ownerId)) return;
        if (!src.alive || !src.deployed || src.hidden) return;
        if (!tgt || tgt.side !== 'enemy' || !tgt.alive || tgt.removed) return;
        const ratio = optNumber(specOf(src.ownerId, HEX_ID, 'armor'), 'defRatio', 200) / 100;
        const amount = src.s.def * ratio;
        if (!(amount > 0)) return;
        const info = battle.makeDamage({ amount, type: 'true', isSkill: true, tags: [TAG] });
        info.hexRiposte = true;
        fired++;
        battle.dealDamage(src, tgt, info);
      });
    }
  }

  return {
    /** The carriers present at install time (own ally operators of a card owner) — the shape sibling modules return. */
    onUnits: carrierCount,
    /** Live count of ripostes fired (0 at install time — the handlers run later). */
    get fired() { return fired; },
    /** Alias of `fired`, for a reader that expects a `count`. */
    get count() { return fired; },
    /**
     * Numeric coercion, so the handle READS as the tally the header asks for: `Number(inst)`, `inst + 0`, `` `${inst}` ``,
     * `inst == n`. A strict `assert.equal(inst, n)` still fails (it compares the handle's identity) — read `.fired`.
     */
    valueOf() { return fired; },
    toString() { return String(fired); },
    [Symbol.toPrimitive]() { return fired; },
  };
}
