// 协议源石禁用 (业主 2026-10-21) — pure logic of the 协议源石 tab of the 干员调配 overlay (screens/loadout.js),
// shared with the sync (ui/loadoutSync.js) and the tests.
//
// An OUT-OF-MATCH, PER-PLAYER setting like 干员持有 / 自选编队: at most 3 protocol-originium (海克斯) card ids the player
// does not want in their own drafts. The server stores the legal list per session / seat (`room.hexBans`), a match takes
// the list its seat had at its start, and only THAT player's draft offers / rerolls / random extra gains skip them.
//
// The per-browser value is `sp.pref.hexBans = { v: 1, ids }`; the wire value is `room.hexBans { ids }`. Both sides use
// `shared/protocol.js checkHexBans` for the semantic check (an id the current data set does not have is dropped, never
// the whole list refused).

import { HEX_BANS_LIMIT, checkHexBans } from '../../../shared/protocol.js';

/** localStorage key (store.js loadPref/savePref prefix `sp.pref.`) and format version. */
export const HEX_BANS_PREF = 'hexBans';
export const HEX_BANS_VERSION = 1;

const ID_RE = /^[A-Za-z0-9_\-.:]{1,64}$/;
const UNSAFE_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const isId = (v) => typeof v === 'string' && ID_RE.test(v) && !UNSAFE_IDS.has(v);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The structurally valid ids of a raw list: strings, de-duplicated, in order, at most `HEX_BANS_LIMIT`.
 * @param {any} raw
 * @returns {string[]}
 */
export function cleanHexBans(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const id of raw) {
    if (out.length >= HEX_BANS_LIMIT) break;
    if (!isId(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

/** Parse a stored setting (any junk → []). @param {any} raw */
export function parseStoredHexBans(raw) {
  return isObj(raw) ? cleanHexBans(raw.ids) : [];
}

/** Serialised form for localStorage. */
export const toStoredHexBans = (ids) => ({ v: HEX_BANS_VERSION, ids: cleanHexBans(ids) });

/**
 * The legal list against the loaded 协议源石 pool (what the server keeps): unknown / stale ids dropped, capped at 3.
 * @param {any} ids @param {Iterable<string>|null} poolIds the player-pool card ids of the loaded data
 * @returns {string[]}
 */
export function sanitizeHexBans(ids, poolIds) {
  const set = poolIds instanceof Set ? poolIds : new Set(poolIds || []);
  const res = checkHexBans(cleanHexBans(ids), (id) => (set.has(id) ? { id } : null));
  return res && 'ok' in res ? res.ids : [];
}

/** Whether `id` is in the list. */
export const isHexBanned = (ids, id) => Array.isArray(ids) && ids.includes(id);

/**
 * Toggle one card. Returns the new list and whether it changed; adding a 4th card is refused (`ok: false`, list kept).
 * @param {string[]} ids @param {string} id
 * @returns {{ ok: boolean, ids: string[] }}
 */
export function toggleHexBan(ids, id) {
  const list = cleanHexBans(ids);
  if (list.includes(id)) return { ok: true, ids: list.filter((x) => x !== id) };
  if (list.length >= HEX_BANS_LIMIT) return { ok: false, ids: list };
  return { ok: true, ids: [...list, id] };
}

/**
 * The player-pool card ids of a loaded data snapshot, in data order.
 * @param {any} hextech `data.get('hextech')`
 * @returns {string[]}
 */
export function hexBanPool(hextech) {
  const map = isObj(hextech?.playerHexes) ? hextech.playerHexes : {};
  return Object.values(map).filter((rec) => rec && typeof rec.id === 'string').map((rec) => rec.id);
}
