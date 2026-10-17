// server/sim/content/hexcards/humanrite.js — 人祭 (hex_humanrite) battle script.
//
// CARD (owner's list, 2026-10-11, copied verbatim): 「作战中，己方干员阵亡时，根据自身攻击力（0.5）和生命上限（0.8）
// 召唤一只炎佑。」
//
// READING (the owner settled it on 2026-10-11, asked because "自身" is ambiguous):
//   * "自身" = the operator that just died — its ATK × 0.5 and its max HP × 0.8.
//   * "己方干员" = the card owner's OWN operators (kind 'op'), never a token, a device or a teammate's board.
//   * "炎佑" = the 炎 bond's summon, `enemy_9012_acloon` — exactly what the 炎 6/9 threshold summons.
//   * "一只" = one per knock-out, every knock-out (no per-battle cap in the text).
//   * "场上最多同时存在 9 只" (owner's cap, 2026-10-12) = at most `cap` (9) 炎佑 may STAND on that player's field at
//     once. The count is every 炎佑 the player has out — the 炎 bond's own summons included, since both channels write
//     the same `enemy_9012_acloon` — so a knock-out at the cap summons nothing. The cap is a field-wide constant, not a
//     per-card budget: a 炎佑 that leaves (dies, expires, is retreated) frees its slot again.
//
// It reuses `spawnYanyou` (content/tokens.js), the implementation the 炎 bond itself uses. That function ADDS the two
// values to the template's own stats (600 ATK / 12000 HP) — PRTS's 最终加算 rule for 炎佑 ("登场时使自身攻击力、生命值
// 增加…"), which is what "根据…召唤一只炎佑" means here [ASSUMED: the template is not replaced by the dead operator's
// stats; the card names a share, not a copy]. The summon picks its own free air tile, hovers beside the previous one and
// counts as an 敌人类我方单位 exactly like the bond's.
//
// The `reason === 'killed'` gate is the one every built-in death kit uses (content/enemies/archetypes.js, times.js, and
// the 亡语 / 回响 enemy verbs in ../hextech.js): `Battle._remove` fires `death` for a leak, an expiry and a retreat too,
// and a 撤退 is not 阵亡. Without the gate, 史尔特尔's 余烬 exit and every withdrawn summon would hand out a 炎佑.
//
// CONTRACT: export function installHumanRite(hooks) — hooks is the shared `hexHooks(battle)` bundle (see hooks.js).
// Returns the number of 炎佑 spawned at install time (always 0 — the card only acts on a later knock-out).

import { spawnYanyou, TOKEN_IDS } from '../tokens.js';

/**
 * 人祭: a knocked-out own operator summons a 炎佑 carrying a share of its ATK and max HP.
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle — `battle` / `ownersOf` / `specOf` / `optNumber` / `onField`
 *   are read.
 * @returns {number} 0 (nothing happens at install time; the handler owns every later knock-out).
 */
export function installHumanRite(hooks) {
  if (!hooks || typeof hooks !== 'object') return 0;
  const { battle, ownersOf, specOf, optNumber, onField } = hooks;
  if (!battle || typeof battle.on !== 'function') return 0;
  if (typeof ownersOf !== 'function') return 0;

  const owners = ownersOf('hex_humanrite');
  if (!owners.length) return 0;

  // the shared `onField` (alive + deployed + not hidden) with the documented fallback, so this module stays usable
  // without hexcards/hooks.js (`u.deployed` is what makes a waiting-to-redeploy operator off the board)
  const standing = typeof onField === 'function' ? onField : (u) => !!u && !!u.alive && !!u.deployed && !u.hidden;
  /** The 炎佑 of ONE player currently on the field — both channels write the same token id (the 炎 bond's own summons
   *  included), so the cap counts every one of them. */
  const yanyouOf = (pid) => (battle.allyUnits || []).filter((u) => u && u.defId === TOKEN_IDS.yanyou && u.ownerId === pid && standing(u)).length;

  // per owner: the shares from the card's own spec, with the owner's numbers as the documented fallbacks
  const plan = new Map();
  for (const pid of owners) {
    const spec = typeof specOf === 'function' ? specOf(pid, 'hex_humanrite', 'humanRite') : null;
    const num = (k, d) => (typeof optNumber === 'function' ? optNumber(spec, k, d) : d);
    plan.set(pid, { atkPct: num('atkPct', 50) / 100, hpPct: num('hpPct', 80) / 100, cap: num('cap', 9) });
  }

  battle.on('death', ({ unit, reason }) => {
    if (reason !== 'killed') return;
    if (!unit || unit.side !== 'ally' || unit.kind !== 'op') return;
    const share = plan.get(unit.ownerId);
    if (!share) return;
    // 场上最多同时存在 `cap` 只炎佑: at the ceiling this knock-out summons nothing (a slot is freed again when one leaves)
    if (yanyouOf(unit.ownerId) >= share.cap) return;
    const stats = unit.s || {};
    const atk = (stats.atk > 0 ? stats.atk : 0) * share.atkPct;
    const hp = (stats.maxHp > 0 ? stats.maxHp : 0) * share.hpPct;
    // `atk` may be 0 (an operator with no attack): spawnYanyou then keeps the template's own ATK
    spawnYanyou(battle, unit.ownerId, { atk, hp, count: 1 });
  });

  return 0;
}
