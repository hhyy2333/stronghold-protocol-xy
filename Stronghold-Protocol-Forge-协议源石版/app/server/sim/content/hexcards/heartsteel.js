// server/sim/content/hexcards/heartsteel.js — 心之钢 (hex_heartsteel) battle script.
//
// CARD (业主 2026-10-21, copied verbatim): 「立刻获取一件装备『心之钢』，此后每两回获得一件心之钢装备，共获得三件。
// （心之钢:携带者视为坚守盟约，坚守盟约干员每隔三秒攻击附带自身最大生命值伤害，并增加最大生命值150点，增加坚守层数2层）」
//
// The equipment (`data/items.json` chess_item_9_96_e_a) is a MARKER: `grantsBonds: ['steadShip']` is what makes its
// carrier a 坚守 member (shared/morph.js `memberBonds` — prep count, the battle's `unitBonds` and the client's bond
// chips all read that one rule). The mechanic below is the CARD's, like 恶魔形态's: every own 坚守 operator gains:
//   * every `every` seconds (per-operator cooldown, on its next NORMAL attack) an extra ARTS hit equal to
//     `dmgMaxHpPct`% of its CURRENT max HP;
//   * +`maxHpGain` max HP, permanently for the battle (`hpFlat` stacks);
//   * +`layerGain` 坚守 layers (a real IN_BATTLE layer gain, so it settles into the match's persistent layers).
//
// The damage is a separate instance (not folded into `dmg.mul`): it can neither be cancelled by 闪避 nor re-trigger
// the "on attack" cards, and the `isChained` guard keeps another "when damage is dealt" card from feeding it back.
//
// Determinism: no Math.random / Date / Node API here; the script never rolls at all.

import { makeDamageInfo, isChained } from '../../damage.js';
import { isMember } from '../support/index.js';

/** The card's spec key (HEX_SCRIPT_KEYS) and the defaults when the record omits a number. */
const KEY = 'heartsteel';
const DEFAULT = Object.freeze({ every: 3, dmgMaxHpPct: 100, maxHpGain: 150, layerGain: 2 });
/** The buff carrying the battle-long max-HP growth (additive `hpFlat` per stack). */
const MAXHP_KEY = 'hex:heartsteel:maxhp';
/** The bond whose members the equipment marks and the card buffs. */
const BOND = 'steadShip';

const pos = (v, d) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);

/**
 * 心之钢: the card's battle half.
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle — `battle` / `ownersOf` / `specOf` / `optNumber` are read.
 * @returns {number|{ get procs(): number }} 0 when the card is absent, else a handle whose `procs` counts the triggers.
 */
export function installHeartsteel(hooks) {
  if (!hooks || typeof hooks !== 'object') return 0;
  const { battle, ownersOf, specOf } = hooks;
  if (!battle || typeof battle.on !== 'function' || typeof ownersOf !== 'function') return 0;
  const owners = ownersOf('hex_heartsteel');
  if (!owners.length) return 0;
  const owned = new Set(owners);
  const specOfPlayer = (pid) => (typeof specOf === 'function' ? specOf(pid, 'hex_heartsteel', KEY) : null);
  let procs = 0;
  battle.on('hit', (c) => {
    if (!c || !c.dmg || c.dmg.cancel) return;
    const u = c.source;
    const target = c.target;
    if (!u || u.kind !== 'op' || u.side !== 'ally' || !owned.has(u.ownerId)) return;
    if (!u.alive || !target || target.side !== 'enemy' || !target.alive) return;
    if (!c.dmg.isAttack) return;              // 「攻击」 = the normal attack
    if (isChained(c.dmg)) return;             // never answer our own or another content's extra instance
    if (!isMember(battle, u, BOND)) return;   // the equipment grants the membership; existing 坚守 operators count too
    const spec = specOfPlayer(u.ownerId) || {};
    const every = pos(spec.every, DEFAULT.every);
    const dmgPct = Number.isFinite(Number(spec.dmgMaxHpPct)) ? Math.max(0, Number(spec.dmgMaxHpPct)) : DEFAULT.dmgMaxHpPct;
    const maxHpGain = pos(spec.maxHpGain, DEFAULT.maxHpGain);
    const layerGain = pos(spec.layerGain, DEFAULT.layerGain);
    const last = u.mem && Number.isFinite(u.mem.heartsteelAt) ? u.mem.heartsteelAt : -Infinity;
    if (battle.time - last < every) return;
    if (!u.mem) u.mem = {};
    u.mem.heartsteelAt = battle.time;
    procs++;
    // 1) the extra hit, off the max HP the operator has RIGHT NOW (before this proc's own growth)
    const amount = u.s.maxHp * (dmgPct / 100);
    if (amount > 0) {
      const info = makeDamageInfo({ amount, type: 'arts', canDodge: false, tags: ['hex', 'heartsteel'] });
      info.heartsteel = true;
      battle.dealDamage(u, target, info);
    }
    // 2) +max HP for the rest of the battle (one stack per proc; ADD_KEYS scale with stacks)
    battle.addBuff(u, {
      key: MAXHP_KEY, refresh: 'stack', stacks: 1, maxStacks: 100000,
      mods: { hpFlat: maxHpGain }, persist: true, allowDead: true, visible: true, tags: ['hex'],
    });
    // 3) +坚守 layers (an IN_BATTLE gain: settle() makes them persistent, capped by the engine at 999)
    battle.addLayers(u.ownerId, BOND, layerGain, 'hex');
  });
  return { get procs() { return procs; } };
}
