// server/sim/content/hexcards/ricochet.js — 跳弹 (hex_ricochet) battle script.
//
// CARD (owner's list, 2026-10-11, copied verbatim): 「远程干员的远程攻击在命中敌人后，会弹射到最近的敌人，每次弹射伤害衰减
// 30%。弹射次数等于已激活精准盟约层数÷20+1（向下取整，上限6次）。」
//
// It maps one-to-one onto the engine's `chain` attack property (ai.js resolveHit, the 链术师 chain): after the main
// target is hit, the attack jumps to the nearest selectable enemy within `radius`, again and again, each jump's damage
// multiplied by `(1 − falloff)^k`. The card's falloff is exactly 30 %, so `chain.falloff = 0.3` and the k-th ricochet
// deals 70 %^k of the attack.
//
// 「弹射次数」 = the number of RICOCHETS (the extra victims), so `chain.count` (total victims, main target included) is
// `ricochets + 1`:
//      ricochets = min(maxBounces, floor(〖精准〗layers / layersPerBounce) + 1)
// [ASSUMED: the text's "+1" is read as one ricochet even with no 精准 layers at all — the alternative ("+1" is the main
// target, 0 layers ⇒ no ricochet) makes the card dead at 0 layers, which the wording "会弹射到最近的敌人" contradicts.
// The owner's own numbers (30 / 20 / 6) are the only values used; change the roster's `ricochet` spec to retune.]
//
// 「精准盟约」 is `preciShip` — the bond the 精准穿透 card reads too — and its layers move DURING a battle (bonds gain
// layers from kills / skills), so the chain is recomputed at battle start and again on every `layerGain` of that bond.
//
// SCOPE:
//   * Only the card owner's own operators whose data class is 远程 (`def.position === 'RANGED'`) — 「远程干员」 — and only
//     when their attack really is a ranged damage attack (not a healer's, not a `noAttack` unit). The engine already
//     flies the ricochets from the main target; a melee operator's attack is never chained.
//   * An operator that carries its OWN `chain` (链术师) keeps it untouched [ASSUMED: replacing a profession's 3-target
//     15 %-falloff chain with this card's values would silently nerf it at low 精准 layers; the card adds a chain to the
//     operators that have none].
//   * 「最近的敌人」 has no range in the text, so the jump radius is the whole field (`RICOCHET_RADIUS`); every jump still
//     uses the engine's own selection rule (`canTargetEnemy`: no unrevealed 隐匿, no untargetable, ground/fly per the
//     profile) and its nearest-first, earliest-spawn tie-break.
//
// CONTRACT: export function installRicochet(hooks) — hooks is the shared `hexHooks(battle)` bundle (see hooks.js).
// Returns the number of operators the chain was written on at install time.

import { bondLayers } from '../support/index.js';

/** 「最近的敌人」 carries no limit: the jump reaches any tile of the field. */
const RICOCHET_RADIUS = 99;
/** The bond the card's 弹射次数 reads (「精准盟约」 = preciShip, the same id 精准穿透 uses). */
const PRECISION_BOND = 'preciShip';

/**
 * 跳弹: a ranged operator's ranged attack ricochets to the nearest enemy, each jump 30 % weaker, as many jumps as the
 * active 〖精准〗 layers allow.
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle — `battle` / `ownersOf` / `opsOf` / `specOf` / `optNumber`
 *   are read here.
 * @returns {number} the operators carrying a card-made chain right after install (0 when the card is absent).
 */
export function installRicochet(hooks) {
  if (!hooks || typeof hooks !== 'object') return 0;
  const { battle, ownersOf, opsOf, specOf, optNumber } = hooks;
  if (!battle || typeof battle.on !== 'function') return 0;
  if (typeof ownersOf !== 'function' || typeof opsOf !== 'function') return 0;

  const owners = ownersOf('hex_ricochet');
  if (!owners.length) return 0;
  /** battleForRounds-style lapse is honoured by `ownersOf` itself (hooks.js); nothing else to check here. */
  const plan = new Map();
  for (const pid of owners) {
    const spec = typeof specOf === 'function' ? specOf(pid, 'hex_ricochet', 'ricochet') : null;
    const num = (k, d) => (typeof optNumber === 'function' ? optNumber(spec, k, d) : d);
    plan.set(pid, {
      falloff: num('falloffPct', 30) / 100,
      per: num('layersPerBounce', 20),
      max: num('maxBounces', 6),
    });
  }

  /** Write the card's chain on every eligible own operator of `pid`, one chain per owner. */
  const apply = (pid) => {
    const p = plan.get(pid);
    if (!p) return 0;
    const layers = bondLayers(battle, pid, PRECISION_BOND);
    const ricochets = Math.min(p.max, Math.floor(layers / p.per) + 1);
    let n = 0;
    for (const u of opsOf(pid)) {
      const prof = u && u.profile;
      if (!prof) continue;
      if (prof.noAttack || prof.heal) continue;                                  // a healer / a non-attacker never chains
      if (prof.attack !== 'ranged') continue;                                    // 「远程攻击」
      if (!u.def || u.def.position !== 'RANGED') continue;                       // 「远程干员」
      if (prof.chain && !prof._ricochet) continue;                               // its own chain stays (see the header)
      prof.chain = { count: ricochets + 1, falloff: p.falloff, radius: RICOCHET_RADIUS };
      prof._ricochet = true;
      n++;
    }
    return n;
  };

  let written = 0;
  battle.on('battleStart', () => { for (const pid of plan.keys()) written += apply(pid); }, { priority: -10 });
  for (const pid of plan.keys()) battle.on('layerGain', (ctx) => { if (ctx && ctx.playerId === pid && ctx.bondId === PRECISION_BOND) apply(pid); });

  return written; // decided when battleStart runs; the call itself only registers the handlers
}
