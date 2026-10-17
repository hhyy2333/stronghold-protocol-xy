// server/sim/content/hexcards/rangedist.js — 近大远小 (hex_rangedist) battle script.
//
// CARD (owner's list, 2026-10-11, copied verbatim): 「干员造成伤害时根据和敌人距离，伤害提升至180%－80%（最近时伤害最高，
// 2格时伤害不变，3格时80%）。」
//
// The text anchors only two points (2格 = unchanged = 100%, 3格 = 80%) and states the nearest is the highest (180%). The
// owner settled the two gaps on 2026-10-11:
//   * 1格 (and 0 — an operator standing on / against its target, i.e. a melee hit) → 180%;
//   * 3格 AND EVERYTHING FARTHER → 80% (the curve does not keep falling).
// So the multiplier is `dist <= 1 → nearPct, dist == 2 → midPct, else farPct`, with every number read from the card's
// own spec (`rangedist: { nearPct, midPct, farPct }`) and the owner's values as the documented fallbacks.
//
// Distance is measured the way the rest of the engine measures a tile distance — the Chebyshev distance of the two
// units' tiles, `max(|Δrow|, |Δcol|)` (ai.js doHeal's `farMul`, chainHealNext, 攻击距离 vs 信仰搅拌机 S3). A ranged
// operator's projectile flies a straight line, but every "距离N格" rule in this codebase counts tiles, so the card does
// too.
//
// HOW IT IS APPLIED: by wrapping the unit's own `profile.dmgMul(battle, unit, target)` — the engine's per-target damage
// multiplier of an attack (ai.js resolveHit: `let mulT = skillMul; if (prof.dmgMul) mulT *= prof.dmgMul(...)`, the hook
// every "攻击…时攻击力提升至X%" kit uses: 斯卡蒂 DRE-X, 提丰 锐如兽牙, 迷迭香's modules …). The wrap is multiplicative
// and delegates to the operator's own function first, so a kit's rule and this card compose instead of overwriting each
// other. It survives a skill (effectiveProfile copies the profile and keeps the function) and a redeploy (the profile
// object belongs to the unit).
//
// SCOPE [ASSUMED, the engine's own convention]: `dmgMul` is read for the MAIN target of an attack only — splash and
// chain victims are scaled by `splashScale` / the chain falloff without it (ai.js resolveHit, and every kit's comment
// says "dmgMul: 主目标"). 近大远小 therefore reads each attack's distance to the enemy it locked, not to each victim.
// Only the card owner's own OPERATORS (§干员) are wrapped, never a token, a device or a teammate's board.
//
// CONTRACT: export function installRangeDist(hooks) — hooks is the shared `hexHooks(battle)` bundle (see hooks.js).
// Returns the number of operators wrapped at install time.

/**
 * 近大远小: an own operator's attack damage multiplier follows its tile distance to the target it locked.
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle — `battle` / `ownersOf` / `opsOf` / `specOf` / `optNumber`
 *   are read here.
 * @returns {number} the operators the wrap was installed on (0 when the card is absent).
 */
export function installRangeDist(hooks) {
  if (!hooks || typeof hooks !== 'object') return 0;
  const { battle, ownersOf, opsOf, specOf, optNumber } = hooks;
  if (!battle || typeof battle.on !== 'function') return 0;
  if (typeof ownersOf !== 'function' || typeof opsOf !== 'function') return 0;

  const owners = ownersOf('hex_rangedist');
  if (!owners.length) return 0;

  /** The tile of a unit, falling back to the rounded position (a mid-flight projectile has no tile). */
  const tileOf = (u) => {
    const r = Number.isFinite(u.tileR) ? u.tileR : Math.round(Number(u.y) || 0);
    const c = Number.isFinite(u.tileC) ? u.tileC : Math.round(Number(u.x) || 0);
    return [r, c];
  };

  let wrapped = 0;
  for (const pid of owners) {
    const spec = typeof specOf === 'function' ? specOf(pid, 'hex_rangedist', 'rangedist') : null;
    const num = (k, d) => (typeof optNumber === 'function' ? optNumber(spec, k, d) : d);
    const near = num('nearPct', 180) / 100;
    const mid = num('midPct', 100) / 100;
    const far = num('farPct', 80) / 100;

    battle.on('battleStart', () => {
      for (const u of opsOf(pid)) {
        const prof = u && u.profile;
        if (!prof) continue;
        if (prof._rangeDist) continue; // never wrap twice (a second battleStart on the same field)
        const base = prof.dmgMul;
        const own = typeof base === 'function' ? base : typeof base === 'number' ? () => base : null;
        prof.dmgMul = (b, unit, target) => {
          let mul = 1;
          if (own) {
            const v = own(b, unit, target);
            if (Number.isFinite(v)) mul = v;
          }
          if (!target || target.side !== 'enemy') return mul;
          const [ur, uc] = tileOf(unit);
          const [tr, tc] = tileOf(target);
          const dist = Math.max(Math.abs(tr - ur), Math.abs(tc - uc));
          const factor = dist <= 1 ? near : dist === 2 ? mid : far;
          return mul * factor;
        };
        prof._rangeDist = true;
        wrapped++;
      }
    }, { priority: -10 }); // the house slot for battleStart grants (after every bond / garrison passive)
  }

  return wrapped; // note: the count is decided when battleStart runs; the call itself only registers the handler
}
