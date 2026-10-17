// 名片干员: the portrait a doctor shows on the room's seat card (screens/room.js) and on the strategy draft's name-card rows
// (screens/bandDraft.js) — the operator the player picked (room.card; room.state seats[].card), else one of the 5★/6★
// operators chosen by the player id, the same on every client.
import { chessPortraitUrl } from './assetUrls.js';
// 自制美术（docs/CUSTOM-ART.md）：原创干员的 `portraitLocal` 覆盖层要有清单才解析得出来 —— 链那一份是
// 模块级的（`portraitChain.js localManifestOf`），这里与它共用同一个来源，避免名片漏掉自制立绘。
import { localManifestOf } from './portraitChain.js';

/** FNV-1a of a string (the portrait pick: the same operator for a player on every client). */
function hash32(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** 名片干员: the player's own pick (localStorage; sent as room.card where the server knows it). */
export const CARD_PREF = 'room.card';

/**
 * The operators a seat card can show: one record per charId (the elite form for its E2 art), 6★ first.
 * @param {any[]} chessList chess.json records
 * @returns {any[]}
 */
export function cardOperators(chessList) {
  const by = new Map();
  for (const c of Array.isArray(chessList) ? chessList : []) {
    if (!c || c.isDiy || c.visible === false || typeof c.charId !== 'string') continue;
    const prev = by.get(c.charId);
    if (!prev || (c.isGolden && !prev.isGolden)) by.set(c.charId, c);
  }
  return [...by.values()].sort((a, b) => ((b.rarity ?? 0) - (a.rarity ?? 0)) || String(a.name).localeCompare(String(b.name), 'zh'));
}

/**
 * The seat card's portrait: the operator the player picked (room.state seats[].card, or one's own pick), else one of
 * the 5★/6★ operators chosen by the player id — the same on every client (null before the data loads).
 * @param {any} seat room.state seat @param {{ pool: any[], byChar: Map<string, any>, m: any, myId: any, myCard: string }} ctx
 */
export function seatPortrait(seat, { pool, byChar, m, myId, myCard }) {
  if (!seat || seat.playerId == null) return null;
  const pick = (seat.playerId === myId && myCard) || seat.card;
  const rec = pick && byChar ? byChar.get(pick) : null;
  const local = localManifestOf();
  if (rec) return chessPortraitUrl(m, rec, local);
  if (!Array.isArray(pool) || !pool.length) return null;
  return chessPortraitUrl(m, pool[hash32(seat.playerId) % pool.length], local);
}
