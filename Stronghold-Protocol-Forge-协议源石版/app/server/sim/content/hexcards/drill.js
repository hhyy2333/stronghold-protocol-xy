// server/sim/content/hexcards/drill.js — 精锐训练 (hex_drill) battle script.
//
// CARD (owner's spec, 2026-10-11): 「作战中，己方所有干员攻击力 +20%、攻击速度 +10；根据当前回合 x 额外获得 5x% 攻击、4x 攻速。」
//   The static half (+20% ATK / +10 ASPD) travels as the card's plain `battle` passive (data/hextech.json
//   `battle: { atkPct: 20, aspd: 10 }`). THIS module adds the per-round half, and nothing else:
//     bonusAtkPct = 5 * x   (percentage points)
//     bonusAspd   = 4 * x   (ASPD is the flat stat POINT, interval = bat * 100 / aspd — see roster.mjs header)
//   x = the round being fought (`battle.round`, set by the match; 0 in a bare harness battle = no bonus), uncapped
//   (owner's decision: R11 = +20+55% ATK / +10+44 ASPD, R14 = +90% / +66).
//
// CONTRACT (fixed by the Lead; do NOT change the signature — the integration point in ../hextech.js calls it):
//   export function installDrill(hooks)
//   hooks = {
//     battle,                    // the sim Battle (this module never touches another global)
//     ownersOf(hexId) -> pid[],  // every player on the field owning that hex id
//     opsOf(pid) -> unit[],      // that player's OWN ally operators currently in the battle
//     specOf(pid, hexId, key) -> object,   // the card's own spec: specOf(pid, 'hex_drill', 'drill') — may be {}
//     passiveBuff(battle, u, key, mods) -> buff,  // match-long passive (survives death / redeploy, idempotent by key)
//     optNumber(spec, key, fallback) -> number,   // finite positive read with a fallback
//   }
//
// RULES the implementation must keep:
//   * Use a DIFFERENT buff key from the static passive (`hex:drill:round`, the static one is `hex:hex_drill`), or the
//     `replace` refresh rule would silently drop one of the two halves.
//   * Apply at `battleStart` with priority -10 (after every bond / garrison passive — the same slot the other
//     battleStart grants use in ../hextech.js), so a redeploy and a mid-battle spawn both keep it.
//   * `battle.round` may be missing / 0 (harness battles): then the bonus is absent, never a throw.
//
// IMPLEMENTATION NOTES:
//   * The two halves must live under DIFFERENT keys. `install()` in ../hextech.js applies the static `battle` passive
//     under the ref's own id (`hex:hex_drill`), and `passiveBuff` refreshes with `replace` — sharing a key would let the
//     per-round half silently overwrite the static one. Hence `hex:drill:round`.
//   * The round is fixed for the whole battle (a battle is simulated for one round), so `x` is read once at install time
//     and the grant is registered on `battleStart` priority -10. Reading it lazily inside the handler would be equally
//     deterministic, but the install-time read is what lets the return value report the units that will be buffed.
//   * `x <= 0` / missing (bare harness battles, a hand-built sim) → no handler at all, return 0: no bonus, never a throw.
//   * `passiveBuff` is `persist: true, allowDead: true, refresh: 'replace'`, so the grant survives a knock-out and a
//     redeploy, and re-running battleStart cannot double it.

/** The per-round half's own key (the static `battle` passive keeps `hex:hex_drill`). */
const ROUND_KEY = 'hex:drill:round';

/**
 * 精锐训练's per-round half: `+5x%` ATK and `+4x` ASPD points (`x = battle.round`, uncapped).
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle — only `battle` / `ownersOf` / `opsOf` / `specOf` /
 *   `optNumber` / `passiveBuff` are read here.
 * @returns {number} the operators this script registered the grant for (0 when the card is absent or `x <= 0`).
 */
export function installDrill(hooks) {
  if (!hooks || typeof hooks !== 'object') return 0;
  const { battle, ownersOf, opsOf, specOf, optNumber, passiveBuff } = hooks;
  if (!battle || typeof battle.on !== 'function') return 0;
  if (typeof ownersOf !== 'function' || typeof opsOf !== 'function' || typeof passiveBuff !== 'function') return 0;

  const owners = ownersOf('hex_drill');
  if (!owners.length) return 0;

  // x = the round being fought; missing / NaN / 0 / negative → no bonus (a bare harness battle is the normal case)
  const round = Number(battle.round);
  const x = Number.isFinite(round) && round > 0 ? round : 0;
  if (!(x > 0)) return 0;

  // Per owner: the card's own tuning (`drill: { atkPerRound: 5, aspdPerRound: 4 }`), with the documented fallbacks.
  // No `directMods` needed: `atkPct` is the additive ratio bucket and `aspd` is the flat point stat, exactly the shape
  // `battleModsOf` builds for the static half.
  const plan = [];
  let onUnits = 0;
  for (const pid of owners) {
    const spec = typeof specOf === 'function' ? specOf(pid, 'hex_drill', 'drill') : null;
    const per = typeof optNumber === 'function' ? optNumber : (s, k, d) => (Number.isFinite(Number(s && s[k])) && Number(s[k]) > 0 ? Number(s[k]) : d);
    const atkPerRound = per(spec, 'atkPerRound', 5);
    const aspdPerRound = per(spec, 'aspdPerRound', 4);
    const mods = { atkPct: (atkPerRound * x) / 100, aspd: aspdPerRound * x };
    const units = opsOf(pid);
    plan.push({ units, mods });
    onUnits += units.length;
  }

  // priority -10: after every bond / garrison passive, the house slot for battleStart grants (see ../hextech.js)
  battle.on('battleStart', () => {
    for (const { units, mods } of plan) for (const u of units) passiveBuff(battle, u, ROUND_KEY, { ...mods });
  }, { priority: -10 });

  return onUnits;
}
