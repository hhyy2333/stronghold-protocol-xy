// server/sim/content/hexcards/warmachine.js — 战争机器 (hex_warmachine) 联防 team aura.
//
// CARD (owner's spec, 2026-10-11): 「获得时：你和所有队友的目标生命值 +5；作战中，你和所有队友的干员攻击力 +16%。
//   联防时，团队所有干员 +30% 攻击力、+30% 防御力、+30% 生命上限。」
//   The pick half (`onPick.lp: 5`, team) and the +16 % ATK half (a plain `battle` passive on every teammate's own ref)
//   are already live. THIS module adds the 联防 clause.
//
// CONTRACT (fixed by the Lead; do NOT change the signature — the integration point in ../hextech.js calls it):
//   export function installWarmachine(hooks)
//   hooks = {
//     battle, ownersOf(hexId) -> pid[], specOf(pid, hexId, key) -> object, optNumber(spec, key, fallback) -> number,
//     passiveBuff(battle, u, key, mods) -> buff,
//     fieldOps() -> unit[],   // EVERY operator on this field, any owner (the 联防 field holds several players' boards)
//   }
//
// RULES the implementation must keep:
//   1. Only in a 联防 field: `battle.kind === 'unite'`. A normal / boss / hidden battle must not see the aura at all —
//      the card says 联防, and the 30 % would otherwise stack on top of the always-on +16 % in every round.
//   2. The aura reaches **every operator on the field, not only the caster's own** (owner's answer A): a teammate whose
//      board is standing there without owning the card is buffed too. Use `fieldOps()`, never `opsOf(pid)`.
//   3. One buff per unit is enough even with several owners of the card on the field: use the SAME key
//      (`hex:warmachine:unite`) so `passiveBuff` (refresh 'replace') keeps a single instance, and do not multiply the
//      effect by the number of owners. Guard the loop so a second owner cannot re-add it with a different value.
//   4. The three values are read from the card's own spec (`specOf(pid, 'hex_warmachine', 'warmachine')`) with the
//      fallbacks 30 / 30 / 30 — the data set carries the numbers, the module carries the rule.
//   5. Apply at `battleStart` with priority -10 (after every bond / garrison passive, the house slot for battleStart
//      grants), and never inside a hook that can fire more than once per unit.
//   6. Percentage semantics as everywhere else in the sim: `directMods({ atk: 0.30, def: 0.30, hp: 0.30 })` →
//      `{ atkPct: 0.30, defPct: 0.30, hpPct: 0.30 }`; +30 % 生命上限 is a PERCENTAGE, not a flat 30 (owner's answer A).
//   7. Nothing happens when the field has no 联防 or the card is absent: return 0.
//
// IMPLEMENTED (siege-engine, task-4). The aura is read ONCE, from the first owner in seat order, and applied once per
// operator of `fieldOps()` — so two owners of the card on one field still produce one buff per unit (rule 3), and a
// teammate that does not own the card is buffed exactly like the carrier (rule 2). The returned number is the count of
// operators the aura covers (0 on a non-联防 field or without the card); the buffs themselves land at `battleStart`.

import { directMods, passiveBuff } from '../support/index.js';

/** The card id in data/hextech.json / on the EffectRef (`hex:hex_warmachine`). */
const CARD_ID = 'hex_warmachine';
/** The script spec under `effect` (data side): the three PERCENTAGE POINTS. */
const SPEC_KEY = 'warmachine';
/** The single buff key of the aura — deliberately NOT the card's own passive key `hex:hex_warmachine` (rule 3). */
const KEY = 'hex:warmachine:unite';
/** Fallback of each spec value, in percentage points (30 = +30%; rule 4). */
const FALLBACK = Object.freeze({ atkPct: 30, defPct: 30, hpPct: 30 });

/**
 * @param {any} hooks the shared bundle from ./hooks.js (see the file header for the contract)
 * @returns {number} the number of operators the aura covers; 0 when the field is not a 联防 or nobody owns the card
 */
export function installWarmachine(hooks) {
  const h = hooks || {};
  const battle = h.battle;
  if (!battle || typeof battle.on !== 'function') return 0;
  // Rules 1 + 7: the aura exists in 联防 only — a normal / boss / hidden field must not see it.
  if (battle.kind !== 'unite') return 0;
  const owners = typeof h.ownersOf === 'function' ? h.ownersOf(CARD_ID) : [];
  if (!Array.isArray(owners) || !owners.length) return 0;

  // Rules 3 + 4: the numbers come from ONE owner (the first in seat order) — a second owner can neither add a second
  // instance (same key, refresh 'replace') nor change the value.
  const spec = (typeof h.specOf === 'function' ? h.specOf(owners[0], CARD_ID, SPEC_KEY) : null) || {};
  const read = typeof h.optNumber === 'function'
    ? h.optNumber
    : (s, k, d) => { const v = Number(s ? s[k] : NaN); return Number.isFinite(v) && v > 0 ? v : d; };
  // optNumber hands back percentage POINTS (30); directMods wants the additive ratio buckets (0.30) — rule 6.
  const ratio = (k) => read(spec, k, FALLBACK[k]) / 100;
  const dm = typeof h.directMods === 'function' ? h.directMods : directMods;
  const mods = dm({ atk: ratio('atkPct'), def: ratio('defPct'), hp: ratio('hpPct') });
  const buff = typeof h.passiveBuff === 'function' ? h.passiveBuff : passiveBuff;

  const covered = (typeof h.fieldOps === 'function' ? h.fieldOps() : null) || [];
  // Rule 5: the house battleStart slot (priority -10), after every bond / garrison passive.
  battle.on('battleStart', () => {
    // Rule 2: live `fieldOps()` — every operator of the field, whatever its owner; rule 3: one application per unit.
    for (const u of (typeof h.fieldOps === 'function' ? h.fieldOps() : covered) || []) buff(battle, u, KEY, { ...mods });
  }, { priority: -10 });
  return covered.length;
}
