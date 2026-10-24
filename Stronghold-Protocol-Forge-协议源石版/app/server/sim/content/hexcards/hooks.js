// server/sim/content/hexcards/hooks.js — THE shared hook bundle for the 协议源石 battle scripts of the 2026-10-11 batch.
//
// One place builds every helper a card module needs, so the four modules (`drill` / `armor` / `shieldwall` / `warmachine`)
// and their tests cannot drift apart: `../hextech.js install()` calls `hexHooks(battle)` and hands the SAME object to
// each `installX(hooks)`, and a test calls `hexHooks(h)` on its harness battle to exercise a module in isolation.
//
// It is deliberately a plain object (no class, no state of its own) — every helper reads the live battle, so a module can
// never cache a stale stat.
//
// `ownersOf` honours `params.expireRound` (孤注一掷 lapses after N rounds) exactly like install() does, so an expired
// card is invisible here too.

import { passiveBuff } from '../support/index.js';
import { isRetaliation, isHpLoss } from '../../damage.js';

/** Player effect-ref key prefix (parallel to `choice:`). Kept identical to ../hextech.js HEX_KEY on purpose. */
export const HEX_KEY = 'hex:';

/**
 * Every helper a 协议源石 battle script may use. `battle` is the sim Battle; nothing here mutates the battle.
 * @param {any} battle
 * @returns {{
 *   battle: any,
 *   ownersOf: (hexId: string) => string[],
 *   opsOf: (pid: string) => any[],
 *   fieldOps: () => any[],
 *   specOf: (pid: string, hexId: string, key: string) => any,
 *   optNumber: (spec: any, key: string, fallback: number) => number,
 *   onField: (u: any) => boolean,
 *   passiveBuff: typeof passiveBuff,
 *   isRetaliation: typeof isRetaliation,
 *   isHpLoss: typeof isHpLoss,
 * }}
 */
export function hexHooks(battle) {
  /** playerId → the hex ids it owns (an expired card is dropped, like install() does). */
  const owners = new Map();
  for (const ps of battle.players || []) {
    if (!ps || typeof ps.playerId !== 'string') continue;
    const set = new Set();
    for (const ref of ps.playerEffects || []) {
      if (!ref || typeof ref.key !== 'string' || !ref.key.startsWith(HEX_KEY)) continue;
      const hexId = ref.data && typeof ref.data.hexId === 'string' ? ref.data.hexId : ref.key.slice(HEX_KEY.length);
      const expire = ref.params && ref.params.expireRound;
      if (Number.isFinite(expire) && Number.isFinite(battle.round) && battle.round > expire) continue;
      set.add(hexId);
    }
    if (set.size) owners.set(ps.playerId, set);
  }

  /** The players on this field owning `hexId`, in seat order. */
  const ownersOf = (hexId) => [...owners.entries()].filter(([, s]) => s.has(hexId)).map(([pid]) => pid);
  /**
   * How many refs of `hexId` one player brought into this battle: 1 normally, 2 when 策略「管理员」copied it
   * (server/match/hextech.js addHexRef `copySeq` writes a second ref with the same key). A card whose battle half is a
   * plain `passiveBuff` has to install ONCE PER COPY under a distinct buff key, or the second copy overwrites the first
   * and the pair is worth a single card (业主 2026-10-24「两个自适应成长好像也只加了一个」).
   */
  const copiesOf = (pid, hexId) => {
    const ps = battle.getPlayer ? battle.getPlayer(pid) : null;
    let n = 0;
    for (const ref of (ps && ps.playerEffects) || []) {
      if (!ref || typeof ref.key !== 'string') continue;
      const id = ref.data && typeof ref.data.hexId === 'string' ? ref.data.hexId : ref.key.slice(HEX_KEY.length);
      if (id === hexId) n++;
    }
    return n;
  };
  /**
   * Install a card's match-long passive ONCE PER COPY it was brought in (策略「管理员」: a copied card is a second ref of
   * the same card). `passiveBuff` replaces by key, so a fixed key makes two copies worth one card —
   * 业主 2026-10-24「两个自适应成长好像也只加了一个」. The 2nd..nth copies get a `:2` / `:3` suffix on the key, which is
   * what lets the additive mods of `passiveBuff` actually add up.
   * @param {any} u the operator
   * @param {string} pid its owner
   * @param {string} hexId e.g. 'hex_adaptivegrowth'
   * @param {string} key the card's base buff key, e.g. 'hex:adaptivegrowth'
   * @returns {number} how many copies were installed
   */
  const passivePerCopy = (u, pid, hexId, key, mods, extra = {}) => {
    if (!u || !key) return 0;
    const n = Math.max(1, copiesOf(pid, hexId));
    for (let i = 0; i < n; i++) passiveBuff(battle, u, i ? `${key}:${i + 1}` : key, mods, extra);
    return n;
  };
  /** The operators of ONE player currently in the battle (the card's own carriers). */
  const opsOf = (pid) => battle.allyUnits.filter((u) => u && u.kind === 'op' && u.side === 'ally' && u.ownerId === pid);
  /** EVERY operator on this field, any owner — the 联防 field holds several players' boards. */
  const fieldOps = () => battle.allyUnits.filter((u) => u && u.kind === 'op' && u.side === 'ally');
  /** Alive + deployed + not hidden: a knocked-out operator is off the board (it waits on its tile to redeploy). */
  const onField = (u) => !!u && !!u.alive && !!u.deployed && !u.hidden;
  /** The card's own spec: specOf(pid, 'hex_drill', 'drill') — `{}` when the card or the key is absent. */
  const specOf = (pid, hexId, key) => {
    const ps = battle.getPlayer ? battle.getPlayer(pid) : null;
    const ref = ((ps && ps.playerEffects) || []).find((e) => e && (e.data?.hexId === hexId || e.key === `${HEX_KEY}${hexId}`));
    const spec = ref && ref.params ? ref.params[key] : null;
    return spec && typeof spec === 'object' ? spec : {};
  };
  /** A finite positive number read of `spec[key]`, else `fallback` (0 is not a value here). */
  const optNumber = (spec, key, fallback) => {
    const v = spec ? Number(spec[key]) : NaN;
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };

  return { battle, ownersOf, copiesOf, passivePerCopy, opsOf, fieldOps, specOf, optNumber, onField, passiveBuff, isRetaliation, isHpLoss };
}
