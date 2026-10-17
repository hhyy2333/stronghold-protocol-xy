// server/sim/content/hexcards/breaker.js — 破隐 (hex_breaker) battle script.
//
// CARD (owner's list, 2026-10-11, copied verbatim): 「敌人隐匿效果失效」
//
// The owner's text names no number, no duration and no range: the effect is simply ON for the whole battle. The engine
// already has exactly this switch: the `reveal` flag (server/sim/buffs.js FLAG_KEYS, the 反隐 status of 极境 / 银灰 /
// 迷迭香's modules). targeting.js `enemyStealthed`:
//
//     const f = e.s.flags;
//     if (!f.stealth || f.reveal || e.blockedBy) return false;
//
// so a revealed enemy is never 隐匿 — it is targetable by ordinary attacks, splash and area effects alike, and the
// client draws it solid (snapshot.js). That is "隐匿效果失效" with no invented numbers.
//
// IMPLEMENTATION:
//   * The flag is applied as a persistent, visible buff `hex:breaker` on every enemy — spawn-time ones and every
//     `enemySpawn` afterwards — so an enemy that carries its own 隐匿 buff (`ab:stealth`, the 隐匿 enemy verb, 鸭爵's
//     swap, 节日爵士乐手) still holds it; only its EFFECT is off, which is what the card says. It is never removed:
//     the card is a battle-long rule, and `persist` keeps it across a phase change.
//   * A card owned by ANY player on the field covers the whole field (the card's text has no "你的" qualifier and an
//     enemy is shared), so `ownersOf` is read once and the flag applied once — the `findBuff` guard makes a second
//     owner idempotent.
//   * The install-time scan catches the enemies already on the field; `enemySpawn` catches every later one (a wave, a
//     split, a boss part, a 回响 child). Both are needed: install() runs once per battle and the spawn order differs
//     between the match server and a bare test harness.
//
// CONTRACT: export function installBreaker(hooks) — hooks is the shared `hexHooks(battle)` bundle (see hooks.js).
// Returns the number of enemies newly flagged (0 when the card is absent).

/** The flag buff's key: never `ab:stealth` (that is the enemy's own buff) and never `hex:hex_breaker`. */
const KEY = 'hex:breaker';

/**
 * 破隐: every enemy's 隐匿 stops working.
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle — only `battle` / `ownersOf` are read here.
 * @returns {number} the enemies newly flagged (0 when the card is absent or the field has none yet).
 */
export function installBreaker(hooks) {
  if (!hooks || typeof hooks !== 'object') return 0;
  const { battle, ownersOf } = hooks;
  if (!battle || typeof battle.on !== 'function') return 0;
  if (typeof ownersOf !== 'function') return 0;
  if (!ownersOf('hex_breaker').length) return 0;

  let flagged = 0;
  /** Reveal one enemy (idempotent: the flag is one persistent buff per enemy). */
  const cover = (e) => {
    if (!e || e.side !== 'enemy' || !e.alive) return;
    if (typeof e.findBuff === 'function' && e.findBuff(KEY)) return;
    battle.addBuff(e, { key: KEY, flags: { reveal: true }, persist: true, allowDead: true, visible: true, tags: ['hex'] });
    flagged++;
  };

  for (const e of battle.enemies || []) cover(e);
  battle.on('enemySpawn', ({ enemy }) => cover(enemy));
  return flagged;
}
