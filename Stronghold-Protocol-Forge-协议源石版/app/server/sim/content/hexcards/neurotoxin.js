// server/sim/content/hexcards/neurotoxin.js — 神经毒素 (hex_neurotoxin) battle script.
//
// CARD (owner's list, 2026-10-11, copied verbatim): 「干员攻击使目标中毒，在3秒内每秒受到115+2％目标最大生命（不可叠加，
// 伤害最高为1万）点法术伤害。」
//
// The three terms, read literally:
//   * 「干员攻击」 — the card owner's own OPERATORS' attacks (`dmg.isAttack`, source kind 'op', same ownerId). A skill's
//     periodic tick, an item's damage, a summon's hit or a teammate's operator never applies it.
//   * 「3秒内每秒受到 115+2%目标最大生命 … 点法术伤害」 — one tick a second for 3 s; every tick deals
//     `min(10000, 115 + 0.02 × the poisoned unit's max HP)` ARTS damage. The 2 % is of the target's max HP, evaluated on
//     every tick against its then-current `s.maxHp` (a debuff that lowers max HP lowers the tick too — the engine's other
//     "N% 最大生命" effects read it that way), and 1万 (10000) is a hard per-tick cap. `类型 = 法术` ⇒ `arts`, NOT the
//     `periodicDamage` helper (that one is 无来源 TRUE damage, 源石溶剂's template) — RES applies as for any arts hit.
//   * 「不可叠加」 — one poison per unit at a time. A second hit while one is running applies nothing: it neither stacks a
//     second tick nor refreshes the running one [ASSUMED: "不可叠加" is read as "no new instance", not as "refresh the
//     duration"; the owner's text says nothing about extending it].
//
// The DoT is a normal buff (`interval: 1`), so the engine's own buff pipeline owns it: it ticks on the battle clock, it
// is dropped with the unit, and the client sees it like any other debuff (`visible`).
//
// CONTRACT: export function installNeurotoxin(hooks) — hooks is the shared `hexHooks(battle)` bundle (see hooks.js).
// Returns 0 (nothing happens at install time — the card only acts when an attack lands).

import { makeDamageInfo } from '../../damage.js';

/** The poison buff's key (one instance per unit — see 不可叠加 above). */
const KEY = 'hex:neurotoxin';

/**
 * 神经毒素: an own operator's attack poisons the enemy; once a second for `seconds` s the enemy takes
 * `min(cap, flat + pct% of its max HP)` arts damage.
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle — `battle` / `ownersOf` / `specOf` / `optNumber` are read.
 * @returns {number} 0.
 */
export function installNeurotoxin(hooks) {
  if (!hooks || typeof hooks !== 'object') return 0;
  const { battle, ownersOf, specOf, optNumber } = hooks;
  if (!battle || typeof battle.on !== 'function') return 0;
  if (typeof ownersOf !== 'function') return 0;

  const owners = ownersOf('hex_neurotoxin');
  if (!owners.length) return 0;

  /** ownerId → { flat, pct, seconds, cap } (the card's own numbers, with the owner's as the fallbacks). */
  const plan = new Map();
  for (const pid of owners) {
    const spec = typeof specOf === 'function' ? specOf(pid, 'hex_neurotoxin', 'neurotoxin') : null;
    const num = (k, d) => (typeof optNumber === 'function' ? optNumber(spec, k, d) : d);
    plan.set(pid, {
      flat: num('flat', 115),
      pct: num('pct', 2) / 100,
      seconds: num('seconds', 3),
      cap: num('cap', 10000),
    });
  }

  battle.on('hit', ({ source, target, dmg }) => {
    if (!source || source.side !== 'ally' || source.kind !== 'op') return;
    const spec = plan.get(source.ownerId);
    if (!spec) return;
    if (!target || target.side !== 'enemy' || !target.alive) return;
    if (!dmg || dmg.cancel || !dmg.isAttack) return;
    if (Array.isArray(dmg.tags) && dmg.tags.includes('hexNeurotoxin')) return; // never chain off our own ticks
    if (typeof target.findBuff === 'function' && target.findBuff(KEY)) return; // 不可叠加
    const source0 = source;
    battle.addBuff(target, {
      key: KEY,
      duration: spec.seconds,
      interval: 1,
      visible: true,
      allowDead: true,
      tags: ['hex', 'poison'],
      data: { flat: spec.flat, pct: spec.pct, cap: spec.cap },
      onTick({ battle: b, unit: t }) {
        if (!t || !t.alive || !(t.s && t.s.maxHp > 0)) return;
        const amount = Math.min(spec.cap, spec.flat + spec.pct * t.s.maxHp);
        if (!(amount > 0)) return;
        const src = source0 && source0.alive ? source0 : null;
        b.dealDamage(src, t, makeDamageInfo({ amount, type: 'arts', canDodge: false, tags: ['hex', 'poison', 'hexNeurotoxin'] }));
      },
    });
    battle.fx('mark', { x: target.x, y: target.y, id: target.id, kind: 'hex:neurotoxin' });
  });

  return 0;
}
