// shared/announce.js — the server announcement (全体公告) channel: ONE text, pushed to every connected session.
//
// WHAT IT IS. An operator writes a line in /admin/ and it appears as a banner at the top of every open page — the lobby
// and a running match alike. That "everyone" is exact and is the whole feature: the push goes to the session registry,
// not to a room, so a player who is mid-battle receives it through the very same path as one sitting in the lobby
// (server/lobby.js `announce`). It is deliberately NOT the match ticker (`m.ticker`: in-match, automatic, per-room) and
// NOT room.chat (one room, player-authored): this is the one channel that reaches the whole server.
//
// THE WIRE FRAME (S2C `announce`, shared/protocol.js):
//   { t: 'announce', id: string, text: string, at: number, seq: number }
// `id` is unique per announcement, so a client can tell a re-delivery from a new one; `seq` is a monotonic counter that
// orders two announcements sharing a millisecond. The text is plain: the banner renders it as text content, never HTML.
//
// PERSISTENCE (the owner's request of 2026-10-11, superseding the no-persistence decision of the same day). The standing
// announcement is written to disk by server/announceStore.js and REPLAYED:
//   * to a session that connects AFTER the publish — a player who opens the page later still sees the line, which is the
//     whole point of an announcement;
//   * across a restart — the operator's line survives a deploy or a crash instead of vanishing;
//   * and it stays up until it is REPLACED (a newer announcement) or WITHDRAWN (the panel's 撤回), not until a timer
//     runs out. A standing notice ("今晚 22:00 停服维护") is exactly what an operator wants on screen for hours, so the
//     banner has no self-destruct: the client shows the current line for as long as the server keeps it current.
// ANNOUNCE_HISTORY_MAX is the panel's own ring for its history list — the replay is the ONE current announcement above,
// so the history is not sent to clients and is not a replay buffer.

/** Longest announcement text, in characters. Longer input is TRUNCATED, never rejected: an operator who pasted a
 *  paragraph gets its first ANNOUNCE_MAX_LEN characters on screen instead of an error and no announcement at all. */
export const ANNOUNCE_MAX_LEN = 200;

/** Announcements the panel remembers for its history list (newest first). See the persistence note above. */
export const ANNOUNCE_HISTORY_MAX = 50;

/**
 * Sanitize operator input into something safe to put on every screen at once:
 *   * control characters are stripped — a stray \u0000 or a terminal escape must not reach a browser (room.chat strips
 *     the same class before it truncates, server/lobby.js);
 *   * line breaks and runs of whitespace collapse to single spaces (the banner is one line; a multi-line paste must not
 *     push the layout around);
 *   * the ends are trimmed and the result truncated to ANNOUNCE_MAX_LEN.
 * Returns '' when nothing survives; the caller refuses an empty announcement rather than broadcasting a blank banner.
 * @param {unknown} raw
 * @returns {string}
 */
export function sanitizeAnnounce(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ANNOUNCE_MAX_LEN);
}

/**
 * Whether a stored / replayed announcement record is usable, normalized to `{ id, text, at, seq }` — or null.
 *
 * Persistence makes this a trust boundary: the record comes back from DISK on the next boot, so a hand-edited or
 * half-written file must not be able to put a non-string (an object, a number, an array) into `text`. The client renders
 * `text` as text content on every screen at once, so a corrupt record is dropped rather than guessed at.
 * @param {unknown} raw
 * @returns {{ id: string, text: string, at: number, seq: number } | null}
 */
export function normalizeAnnouncement(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = /** @type {any} */ (raw);
  const text = typeof o.text === 'string' ? sanitizeAnnounce(o.text) : '';
  if (!text) return null;
  const at = Number.isFinite(o.at) ? Number(o.at) : 0;
  const seq = Number.isFinite(o.seq) ? Math.max(0, Math.floor(Number(o.seq))) : 0;
  const id = typeof o.id === 'string' && o.id ? o.id : `a${seq}-${at.toString(36)}`;
  return { id, text, at, seq };
}
