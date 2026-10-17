// server/bans.js — 封禁名单：规则解析、匹配与内存状态（server/banStore.js 负责落盘）。
//
// WHY. The server had no way to refuse one source: `room.kick` only removes a guest from one room before its match,
// and every other lever (`maxConnectionsPerAddr`, `maxRoomsPerAddr`) is a COUNT, not a judgement. An operator facing
// a spammer on the live box could only turn the whole machine off. This module is that missing lever, deliberately
// narrow:
//
//   * MANUAL ONLY. Nothing here is automatic, and the module never bans on its own: a shared NAT / CGNAT / campus
//     egress can carry a whole crowd, so a heuristic that bans one address can ban dozens of innocent players. The
//     owner's decision (2026-10-13) is that a human presses the button.
//   * The address is the one `server/net.js clientAddress` resolved — behind the nginx / cloudflared reverse proxy
//     that means the forwarded client address, not the proxy's own. The trust rule is unchanged (forwarding headers
//     are honoured only from loopback/private peers unless TRUST_PROXY says otherwise), because a ban list that
//     believed a client-supplied `X-Forwarded-For` would let anyone get anyone else banned.
//   * A rule is an address or a CIDR. IPv6 is a /64 per subscriber, so a single IPv6 address is a weak ban; the
//     parser accepts `/64` (and refuses anything broader than the guards below so `0.0.0.0/0` cannot take the whole
//     server down by typo).
//
// STATE, NOT EVENTS. The list is a state (like the 全体公告): it is persisted outside the install tree
// (server/banStore.js), restored at boot, and shared between the two blue-green slots by polling that file. A ban
// added through slot A must take effect on slot B within seconds — a security control that only covers half the
// deployment is not a control — so every mutation merges with what is already on disk (see `_merged`) instead of
// writing this process's own view over the other slot's entry.
//
// The disk is a trust boundary: everything read back is re-normalized here and a bad entry is dropped, never guessed.

import { isIP } from 'node:net';
import { normalizeIp, ipBytes } from './net.js';

/** Longest operator note kept on a ban (characters). */
export const BAN_REASON_MAX = 200;
/** Longest operator/author label kept on a ban (characters). */
export const BAN_BY_MAX = 64;
/** Cap of the list: a bound on memory (and on a leaked token filling the disk), far above any real use. */
export const BAN_LIST_MAX = 5000;
/**
 * Refuse a CIDR broader than this unless the caller passes `force: true`.
 *
 * Not a technical limit — a policy one. `0.0.0.0/0` bans the internet, and a tired operator typing a prefix one digit
 * short (`/8` instead of `/18`) would silently lock out a continent. /8 and /16 are already enormous; anything wider
 * has to be asked for explicitly.
 */
export const BAN_MIN_PREFIX_V4 = 8;
export const BAN_MIN_PREFIX_V6 = 16;

const CONTROL_RE = /[\u0000-\u001f\u007f]/g;

/** One operator-visible line of text: control characters stripped, whitespace collapsed, trimmed, length-capped. */
function sanitizeText(raw, max) {
  if (typeof raw !== 'string') return '';
  return raw.replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Zero every bit of an address past `prefix` (a CIDR's host bits carry no meaning). */
function maskBytes(bytes, prefix) {
  const out = Uint8Array.from(bytes);
  for (let i = 0; i < out.length; i++) {
    const bitStart = i * 8;
    if (bitStart >= prefix) { out[i] = 0; continue; }
    const keep = Math.min(8, prefix - bitStart);
    if (keep < 8) out[i] &= (0xff << (8 - keep)) & 0xff;
  }
  return out;
}

/**
 * Canonical text of 4 or 16 bytes. IPv6 gets RFC 5952 zero compression, so a masked network reads the way an operator
 * writes one (`2001:db8::/64`, not `2001:db8:0:0:0:0:0:0/64`).
 * @param {Uint8Array} bytes
 */
function formatIpBytes(bytes) {
  if (bytes.length === 4) return `${bytes[0]}.${bytes[1]}.${bytes[2]}.${bytes[3]}`;
  const groups = [];
  for (let i = 0; i < 16; i += 2) groups.push((bytes[i] << 8) | bytes[i + 1]);
  let bestStart = -1;
  let bestLen = 0;
  let start = -1;
  for (let i = 0; i <= 8; i++) {
    if (i < 8 && groups[i] === 0) { if (start < 0) start = i; continue; }
    if (start >= 0) {
      if (i - start > bestLen) { bestLen = i - start; bestStart = start; }
      start = -1;
    }
  }
  const hex = (g) => g.toString(16);
  if (bestLen < 2) return groups.map(hex).join(':');
  const head = groups.slice(0, bestStart).map(hex).join(':');
  const tail = groups.slice(bestStart + bestLen).map(hex).join(':');
  return `${head}::${tail}`;
}

/**
 * @typedef {{ rule: string, ip: string, family: 4 | 6, prefix: number, exact: boolean, bytes: Uint8Array }} BanRule
 *   `rule` is the canonical text (an exact address has no `/prefix`); `bytes` is kept so matching does not re-parse.
 */

/**
 * Parse one ban rule: `203.0.113.7`, `203.0.113.0/24`, `2001:db8::1` or `2001:db8::/64`.
 *
 * Canonicalizes through `normalizeIp`, so `[::1]:3000`, `::ffff:1.2.3.4` and `2001:DB8::1` all name what an operator
 * means, and an exact address never carries a redundant `/32` or `/128` (otherwise the same rule could be stored twice
 * under two spellings).
 *
 * A CIDR's host bits are MASKED: `203.0.113.7/24` IS `203.0.113.0/24`, one rule and one entry, so an operator cannot
 * end up with two spellings of the same ban where removing the one they can see leaves the other matching.
 *
 * @param {unknown} raw
 * @returns {{ ok: true, rule: BanRule } | { ok: false, reason: 'empty' | 'not-an-ip' | 'bad-prefix' }}
 */
export function parseBanRule(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: 'empty' };
  const s = raw.trim();
  if (!s) return { ok: false, reason: 'empty' };
  const slash = s.lastIndexOf('/');
  const ip = normalizeIp(slash >= 0 ? s.slice(0, slash) : s);
  if (!ip) return { ok: false, reason: 'not-an-ip' };
  const family = /** @type {4 | 6} */ (isIP(ip));
  const maxBits = family === 4 ? 32 : 128;
  let prefix = maxBits;
  if (slash >= 0) {
    const p = s.slice(slash + 1).trim();
    if (!/^\d{1,3}$/.test(p)) return { ok: false, reason: 'bad-prefix' };
    prefix = Number(p);
    if (prefix > maxBits) return { ok: false, reason: 'bad-prefix' };
  }
  let bytes = ipBytes(ip);
  if (!bytes) return { ok: false, reason: 'not-an-ip' };
  let text = ip;
  if (prefix < maxBits) {
    bytes = maskBytes(bytes, prefix);
    text = formatIpBytes(bytes);
  }
  return { ok: true, rule: { rule: prefix === maxBits ? ip : `${text}/${prefix}`, ip: text, family, prefix, exact: prefix === maxBits, bytes } };
}

/** Whether a parsed rule is wider than the guard (BAN_MIN_PREFIX_V4 / V6): refused unless the caller forces it. */
export function isBroadRule(rule) {
  return rule.family === 4 ? rule.prefix < BAN_MIN_PREFIX_V4 : rule.prefix < BAN_MIN_PREFIX_V6;
}

/**
 * Whether one parsed rule covers an address. Families never cross: an IPv4 rule does not cover an IPv6 address and
 * vice versa (`normalizeIp` already folds `::ffff:a.b.c.d` into IPv4, so a mapped peer matches its IPv4 rule).
 * @param {BanRule} rule
 * @param {unknown} candidate
 */
export function banRuleMatches(rule, candidate) {
  const bytes = ipBytes(candidate);
  if (!bytes || bytes.length !== rule.bytes.length) return false;
  let remaining = rule.prefix;
  for (let i = 0; i < bytes.length && remaining > 0; i++) {
    const take = Math.min(8, remaining);
    const mask = take === 8 ? 0xff : (0xff << (8 - take)) & 0xff;
    if ((bytes[i] & mask) !== (rule.bytes[i] & mask)) return false;
    remaining -= take;
  }
  return true;
}

/**
 * Normalize one stored/requested entry. Returns null for an unusable rule — the caller drops it rather than guess.
 *
 * `until` is kept exactly as given: it is NEVER turned into `null` (permanent) when it is in the past, because that
 * would upgrade "this ban expired" into "this ban is forever".
 *
 * @param {any} input
 * @param {number} now
 * @returns {{ rule: string, reason: string, by: string, at: number, until: number | null } | null}
 */
export function normalizeBanEntry(input, now = Date.now()) {
  if (!input || typeof input !== 'object') return null;
  const parsed = parseBanRule(input.rule);
  if (!parsed.ok) return null;
  const at = Number.isFinite(Number(input.at)) && Number(input.at) > 0 ? Math.trunc(Number(input.at)) : now;
  const rawUntil = input.until == null || input.until === '' ? null : Number(input.until);
  const until = Number.isFinite(rawUntil) && rawUntil > 0 ? Math.trunc(rawUntil) : null;
  return { rule: parsed.rule.rule, reason: sanitizeText(input.reason, BAN_REASON_MAX), by: sanitizeText(input.by, BAN_BY_MAX), at, until };
}

/** The JSON shape of an entry (no `bytes`: the parsed form is rebuilt on read, never trusted from disk). */
function publicEntry(entry) {
  return { rule: entry.rule, reason: entry.reason, by: entry.by, at: entry.at, until: entry.until };
}

/**
 * A canonical signature of a rule map, independent of insertion order — so the blue-green poll can tell "the file
 * changed" from "I read the same list again" without re-notifying (and re-dropping sockets) every interval.
 * @param {Map<string, any>} entries
 */
function signatureOf(entries) {
  return JSON.stringify([...entries.values()].map(publicEntry).sort((a, b) => (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0)));
}

/**
 * The in-memory ban list of one server.
 *
 * @example
 *   const bans = new BanList({ store: createBanStore({ log }) });
 *   bans.onChange = () => network.dropBanned();      // a ban takes effect on the sockets already open
 *   bans.add({ rule: '203.0.113.0/24', reason: '刷屏', by: 'admin' });
 */
export class BanList {
  /**
   * @param {{
   *   entries?: any[], store?: { readState?: Function, write?: Function } | null,
   *   now?: () => number, log?: object | null, max?: number,
   * }} [opts]
   *   store: where the list is persisted (server/banStore.js). Null = memory only (tests, and a `startServer()`
   *   that is not the process entry), which still enforces, it just does not survive a restart.
   */
  constructor({ entries = [], store = null, now = Date.now, log = null, max = BAN_LIST_MAX } = {}) {
    this.store = store;
    this.now = now;
    this.log = log;
    this.max = max;
    /** @type {(() => void) | null} called after every accepted change (server/index.js: drop the sockets it covers) */
    this.onChange = null;
    /** @type {Map<string, { rule: string, reason: string, by: string, at: number, until: number | null, parsed: BanRule }>} */
    this._entries = new Map();
    this._signature = '';
    /** Whether the last write reached the disk (reported by add/remove; a failure does not undo the in-memory ban). */
    this._lastPersisted = true;
    this.adopt(entries, { silent: true });
  }

  /** Number of live (non-expired) rules. */
  get size() { return this.list().length; }

  /**
   * How many rules are stored, expired ones included. Only useful as a FAST PATH for a caller that would otherwise do
   * per-request work to ask "is this address banned?" (server/http/routes.js): `0` proves nothing can match, while a
   * non-zero answer may still be all-expired and just means the full lookup has to run. Never a policy count.
   */
  get stored() { return this._entries.size; }

  /** The live rules, newest first, as plain JSON-safe objects. Expired ones are pruned. */
  list() {
    const now = this.now();
    const out = [];
    for (const [key, entry] of this._entries) {
      if (entry.until != null && entry.until <= now) { this._entries.delete(key); continue; }
      out.push(publicEntry(entry));
    }
    out.sort((a, b) => b.at - a.at || (a.rule < b.rule ? -1 : 1));
    return out;
  }

  /** One rule by its canonical text (or any spelling that parses to it), or null. */
  get(rule) {
    const parsed = parseBanRule(rule);
    const key = parsed.ok ? parsed.rule.rule : String(rule ?? '').trim();
    const entry = this._entries.get(key);
    if (!entry) return null;
    if (entry.until != null && entry.until <= this.now()) { this._entries.delete(key); return null; }
    return publicEntry(entry);
  }

  /**
   * The rule covering an address, or null.
   * @param {unknown} ip
   * @returns {{ rule: string, reason: string, by: string, at: number, until: number | null } | null}
   */
  isBanned(ip) {
    if (!ip) return null;
    const now = this.now();
    for (const [key, entry] of this._entries) {
      if (entry.until != null && entry.until <= now) { this._entries.delete(key); continue; }
      if (banRuleMatches(entry.parsed, ip)) return publicEntry(entry);
    }
    return null;
  }

  /**
   * Add (or replace) one rule.
   * @param {{ rule: unknown, reason?: unknown, by?: unknown, minutes?: unknown, until?: unknown, force?: boolean, at?: number }} input
   *   minutes: a relative duration; `until` wins when both are given. Neither = permanent.
   * @returns {{ ok: true, entry: object, added: boolean, size: number, persisted: boolean, evicted: number | null }
   *   | { ok: false, error: 'BAD_RULE' | 'TOO_BROAD' | 'FULL', rule?: string, minPrefix?: number, reason?: string }}
   *   `evicted`: what the change notification reported (server/index.js wires it to `network.dropBanned`, so it is the
   *   number of sockets this ban closed). null when no notification is wired — the caller then has to ask itself.
   */
  add(input) {
    const parsed = parseBanRule(input?.rule);
    if (!parsed.ok) return { ok: false, error: 'BAD_RULE', reason: parsed.reason };
    if (isBroadRule(parsed.rule) && input.force !== true) {
      return { ok: false, error: 'TOO_BROAD', rule: parsed.rule.rule, minPrefix: parsed.rule.family === 4 ? BAN_MIN_PREFIX_V4 : BAN_MIN_PREFIX_V6 };
    }
    const now = this.now();
    const minutes = Number(input.minutes);
    const until = input.until != null && input.until !== ''
      ? input.until
      : (Number.isFinite(minutes) && minutes > 0 ? now + Math.trunc(minutes) * 60_000 : null);
    const clean = normalizeBanEntry({ ...input, rule: parsed.rule.rule, at: input.at ?? now, until }, now);
    if (!clean) return { ok: false, error: 'BAD_RULE', reason: 'not-an-ip' };

    const next = this._merged();
    const existed = next.has(clean.rule);
    if (!existed && next.size >= this.max) return { ok: false, error: 'FULL' };
    next.set(clean.rule, { ...clean, parsed: parsed.rule });
    this._entries = next;
    const persisted = this._persist();
    return { ok: true, entry: publicEntry(clean), added: !existed, size: this.size, persisted, evicted: this._notify() };
  }

  /**
   * Remove one rule. The text may be any spelling that parses to a stored rule; an unparseable string is still tried
   * verbatim as a key, so an operator can clear a hand-edited entry that normalization would reject.
   * @param {unknown} rule
   * @returns {{ ok: true, removed: boolean, size: number, persisted: boolean } | { ok: false, error: 'BAD_RULE' }}
   */
  remove(rule) {
    const raw = typeof rule === 'string' ? rule.trim() : '';
    if (!raw) return { ok: false, error: 'BAD_RULE' };
    const parsed = parseBanRule(raw);
    const key = parsed.ok ? parsed.rule.rule : raw;
    const next = this._merged();
    const removed = next.delete(key);
    if (removed) {
      this._entries = next;
      this._persist();
      this._notify();
    }
    return { ok: true, removed, size: this.size, persisted: removed ? this._lastPersisted : true };
  }

  /**
   * Replace the whole list with one read from outside this process (boot, and the blue-green poll in server/index.js).
   * `silent` skips the change notification — the constructor uses it, since there is no one to notify yet.
   * @param {any[]} entries
   * @returns {{ changed: boolean, added: string[], removed: string[], size: number }}
   */
  adopt(entries, { silent = false } = {}) {
    const now = this.now();
    const next = new Map();
    for (const raw of Array.isArray(entries) ? entries : []) {
      const clean = normalizeBanEntry(raw, now);
      if (!clean) continue;
      if (clean.until != null && clean.until <= now) continue;
      const parsed = parseBanRule(clean.rule);
      if (!parsed.ok) continue;
      next.set(clean.rule, { ...clean, parsed: parsed.rule });
    }
    const signature = signatureOf(next);
    if (signature === this._signature) return { changed: false, added: [], removed: [], size: next.size };
    const added = [...next.keys()].filter((k) => !this._entries.has(k));
    const removed = [...this._entries.keys()].filter((k) => !next.has(k));
    this._entries = next;
    this._signature = signature;
    if (!silent) this._notify();
    return { changed: true, added, removed, size: next.size };
  }

  /**
   * This process's view merged with what is currently on disk.
   *
   * WHY merge instead of write-this-process's-map: the two blue-green slots share one file and each only re-reads it
   * on the poll interval, so slot B can hold a stale view when it accepts a ban. Writing that view verbatim would
   * silently DELETE the ban slot A just persisted. Reading first makes the two writers converge on a union; a
   * removal still removes, because the operator's removal is applied to the merged set before it is written back.
   */
  _merged() {
    const merged = new Map();
    const state = this._readStore();
    const base = state && state.ok ? state.entries : this.list();
    const now = this.now();
    for (const raw of base) {
      const clean = normalizeBanEntry(raw, now);
      if (!clean || (clean.until != null && clean.until <= now)) continue;
      const parsed = parseBanRule(clean.rule);
      if (parsed.ok) merged.set(clean.rule, { ...clean, parsed: parsed.rule });
    }
    return merged;
  }

  /** One tolerant read of the store (a broken/unreadable file falls back to the in-memory view). */
  _readStore() {
    if (!this.store || typeof this.store.readState !== 'function') return null;
    try { return this.store.readState(); } catch (e) {
      this.log?.warn?.(`[bans] 读取名单失败：${e?.code || e?.message}`);
      return null;
    }
  }

  /** Persist the current view; a write failure is reported, never thrown (the ban still holds in this process). */
  _persist() {
    if (!this.store || typeof this.store.write !== 'function') { this._lastPersisted = true; this._signature = this._signatureOf(); return true; }
    let ok = false;
    try { ok = this.store.write(this.list()) !== false; } catch (e) {
      this.log?.warn?.(`[bans] 写入名单失败：${e?.code || e?.message}`);
    }
    this._lastPersisted = ok;
    this._signature = this._signatureOf();
    return ok;
  }

  _signatureOf() { return signatureOf(this._entries); }

  /**
   * Tell the owner the list changed. The notification's return value is passed back to the caller (see `add`): that is
   * how `evicted` reaches the operator without a second sweep over the sockets. A throwing notification is logged and
   * reported as "unknown" — a broken hook must never undo a ban that is already in effect.
   * @returns {number | null}
   */
  _notify() {
    if (!this.onChange) return null;
    try {
      const r = this.onChange();
      return typeof r === 'number' ? r : null;
    } catch (e) {
      this.log?.error?.('[bans] onChange crashed', e);
      return null;
    }
  }
}
