// server/admin.js — the operational API behind GET/HEAD /api/admin/* (server/http/routes.js). Read-mostly: the only
// writes are the six the owner asked for by name (全体公告 / 更新公告 / 封禁 / 服务器人数上限 / 删除一条反馈 / 踢出房间),
// each drawn as narrowly as its feature allows — see the SECURITY note below.
//
// SECURITY (the reason this module looks like this):
//
//   * The token comes from the ADMIN_SECRET environment variable and nowhere else. There is deliberately NO code
//     default: a fork of this project shipped a hard-coded fallback (`'stronghold-admin-2026'`), which means every
//     deployment that forgot to configure one had the same public password. Without ADMIN_SECRET the whole surface
//     is DISABLED — routes.js answers 404, not 401, so a stock deployment has no admin console to find and an
//     unauthenticated visitor learns nothing about whether one could be enabled.
//   * Comparison is timing-safe (crypto.timingSafeEqual), so the reply time never tells a guesser how much of the
//     token it got right.
//   * Repeated wrong tokens from one client address lock that address out for a while. The lockout answers the same
//     401 as a wrong token: it never confirms to the attacker that it is being throttled. The clock is injectable
//     (`now`) so tests can drive the window instead of sleeping through it.
//   * The six writes, and why each is allowed: the 全体公告 (shared/announce.js) — publishing or withdrawing is one
//     sanitized text frame to connected sessions plus one small file (server/announceStore.js), touching no room, no
//     match and no seat; 更新公告 (server/notesStore.js), a file that the next page load reads; 封禁 IP (server/bans.js,
//     server/banStore.js), which additionally closes the sockets that address already holds; 服务器人数上限
//     (server/limits.js), which never disconnects anybody; 删除一条反馈 (server/feedback.js), one line of one file; and
//     踢出房间 (`POST /api/admin/rooms/kick` → Lobby.operatorKick), which removes ONE human from ONE room with exactly
//     the mechanics a normal departure uses. All six are drawn as narrowly as the feature allows; there is still no
//     graceful drain, no shutdown control and no way to alter a running match: those need lobby hooks that do not
//     exist yet and a separate design decision. A token that ends up in a browser tab, a screenshot or a proxy log
//     must not be able to change the running server beyond putting a line on every screen (and taking it down again),
//     refusing a source, lowering a ceiling, pruning one report, and removing a player from a room they are in.
//   * The token travels in the `Authorization: Bearer …` header only — never in a query string (access logs and
//     `Referer` leak those) and never in a cookie (the browser would attach it to any page the operator visits).
//
// The panel under public/admin/ is a static, secret-free shell over this API; it is served by the ordinary
// public/ mount, not by a special /admin route.

import os from 'node:os';
import { timingSafeEqual } from 'node:crypto';
import { PROTOCOL_VERSION, APP_VERSION } from '../shared/constants.js';
import { ANNOUNCE_HISTORY_MAX, ANNOUNCE_MAX_LEN, sanitizeAnnounce } from '../shared/announce.js';
import { notesDigest, notesErrorText } from '../shared/updateNotes.js';
import { PERF_BUCKETS } from './match/perf.js';
import { clientAddress } from './net.js';
import { parseBanRule, banRuleMatches, isBroadRule, BAN_MIN_PREFIX_V4, BAN_MIN_PREFIX_V6 } from './bans.js';
import { normalizeMaxConnections, normalizeMaxBots, MAX_CONNECTIONS_FLOOR, MAX_CONNECTIONS_CEILING, MAX_BOTS_FLOOR, MAX_BOTS_CEILING } from './limits.js';

/** Cap of the in-memory log ring: the newest entries win. */
export const ADMIN_LOG_LIMIT = 300;
/** Consecutive wrong tokens from one client address before that address is locked out. */
export const ADMIN_MAX_FAILURES = 10;
/** How long a locked-out client address stays locked out (ms). */
export const ADMIN_LOCKOUT_MS = 60_000;
/** Shortest gap between two published 全体公告 (ms). One publish reaches every connected session at once. */
export const ADMIN_ANNOUNCE_MIN_GAP_MS = 3000;
/** Shortest poll window a per-room cost RATE is computed over (ms): below it, the panel shows totals without a rate. */
export const MIN_PERF_WINDOW_MS = 50;

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * 封禁 API 的应答文案（**管理面文案，不进 i18n 管道**）：`public/admin/` 自己维护一张 STRINGS 表，是刻意留在 i18n
 * 之外的（见 public/admin/admin.js 的文件头），运维面的文字既不面向玩家、也不该被抽成 msgid。每行按 docs/I18N.md
 * 的规矩标 `// i18n-ignore`，否则 test/i18n.test.js 会把它们记成"没包 t() 的中文界面文字"。
 */
const BAN_TEXT = {
  disabled: '封禁功能不可用 · Bans unavailable', // i18n-ignore: 管理面文案
  full: '名单已满 · The ban list is full', // i18n-ignore: 管理面文案
  bad: '不是合法的 IP 或 CIDR · Not a valid IP or CIDR', // i18n-ignore: 管理面文案
  required: '需要一个 IP 或 CIDR · A rule is required', // i18n-ignore: 管理面文案
  broad: (minPrefix, force) => `规则过宽（前缀小于 /${minPrefix}）· Rule too broad (prefix shorter than /${minPrefix})${force ? '; pass force to do it anyway' : ''}`, // i18n-ignore: 管理面文案
  self: (by) => `这条规则会封掉你自己（${by}）· This rule covers your own address (${by}); pass force to do it anyway`, // i18n-ignore: 管理面文案
};

/**
 * 玩家反馈删除（`POST /api/admin/feedback/remove`）的应答文案。与 BAN_TEXT 同一条理由：管理面文案不进 i18n 管道
 * （public/admin/ 自带 STRINGS 表），每行按 docs/I18N.md 的规矩标 `// i18n-ignore`。
 */
const FEEDBACK_TEXT = {
  disabled: '反馈功能不可用 · Feedback is not configured', // i18n-ignore: 管理面文案
  badId: '缺少有效的反馈编号 · A valid report id is required', // i18n-ignore: 管理面文案
  notFound: '找不到这条反馈（可能已被删除）· No such report (it may already be deleted)', // i18n-ignore: 管理面文案
  tooLarge: '这个月的反馈文件过大，请手动处理 · That month\'s file is too large to rewrite; handle it by hand', // i18n-ignore: 管理面文案
  unwritable: '写入失败，反馈未删除 · Could not write; the report was not removed', // i18n-ignore: 管理面文案
};

/**
 * 服务器人数上限（`/api/admin/limits`）的应答文案。与 BAN_TEXT 同一条理由：管理面文案不进 i18n 管道
 * （public/admin/ 自带 STRINGS 表），每行按 docs/I18N.md 的规矩标 `// i18n-ignore`。
 */
const LIMITS_TEXT = {
  disabled: '上限功能不可用 · Limits unavailable', // i18n-ignore: 管理面文案
  bad: '需要一个整数，或用 null 清除 · Expects an integer, or null to clear', // i18n-ignore: 管理面文案
  range: (lo, hi) => `超出允许范围（${lo}–${hi}）· Out of range (${lo}–${hi})`, // i18n-ignore: 管理面文案
  // 人机那两格的越界文案（0 合法 = 不限制，所以下限是 0，措辞要说清这一点）
  botsRange: (lo, hi) => `人机上限要在 ${lo}–${hi} 之间（0 = 不限制）· AI cap must be ${lo}–${hi} (0 = unlimited)`, // i18n-ignore: 管理面文案
};

/**
 * 后台踢人（`POST /api/admin/rooms/kick`）的应答文案。与 BAN_TEXT 同一条理由：管理面文案不进 i18n 管道
 * （public/admin/ 自带 STRINGS 表），每行按 docs/I18N.md 的规矩标 `// i18n-ignore`。
 */
const KICK_TEXT = {
  disabled: '踢人功能不可用 · Room kicks unavailable', // i18n-ignore: 管理面文案
  bad: '需要房间号与被踢的玩家 · A room code and a player are required', // i18n-ignore: 管理面文案
  notFound: '找不到这个房间（可能已经解散）· No such room (it may already be gone)', // i18n-ignore: 管理面文案
  notInRoom: '这个玩家不在这间房里 · That player is not in that room', // i18n-ignore: 管理面文案
  badTarget: '只能踢真人：AI 座位不会经过这里，已离开的人也已经不在房里 · Only a human still in the room can be kicked', // i18n-ignore: 管理面文案
  failed: '服务器没能完成这次操作 · The server could not complete the kick', // i18n-ignore: 管理面文案
};

/**
 * The process-wide log ring. It is module level rather than per-instance on purpose: this is the log of the PROCESS
 * (server/index.js feeds the server's own console logger into it too), so every AdminService of this process — the
 * server's and one a test constructs — reads the same history.
 * @type {{ seq: number, at: number, level: 'info'|'warn'|'error', message: string, meta: object|null }[]}
 */
const logRing = [];
let logSeq = 0;

/**
 * Append one entry to the admin log ring (the panel's live console).
 * Exported so server modules can log into it without depending on AdminService.
 * @param {'info'|'warn'|'error'|string} level
 * @param {unknown} message
 * @param {unknown} [meta] a plain object is kept as-is, anything else is stringified under `{ data }`
 */
export function recordAdminLog(level, message, meta = null) {
  logRing.push({
    seq: ++logSeq,
    at: Date.now(),
    level: level === 'warn' || level === 'error' ? level : 'info',
    message: typeof message === 'string' ? message : String(message),
    meta: meta && typeof meta === 'object' ? meta : (meta == null ? null : { data: String(meta) }),
  });
  // One splice at most: the ring only ever grows by one entry per call.
  if (logRing.length > ADMIN_LOG_LIMIT) logRing.splice(0, logRing.length - ADMIN_LOG_LIMIT);
}

/** The `Authorization: Bearer <token>` value of a request, or null. @param {import('node:http').IncomingMessage} req */
function bearerToken(req) {
  const raw = req?.headers?.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const m = /^Bearer[ \t]+(.+)$/i.exec(value.trim());
  return m ? m[1].trim() : null;
}

/** Bytes → MB with one decimal (the panel shows these directly). */
const mb = (bytes) => Math.round((bytes / 1048576) * 10) / 10;

/**
 * The read-only metrics service of one server.
 *
 * @example
 *   const admin = new AdminService({ lobby, network, registry, startedAt, buildTag, secret: process.env.ADMIN_SECRET, log });
 *   if (admin.enabled) ... // false when ADMIN_SECRET is unset: routes.js then answers 404 for /api/admin/*
 */
export class AdminService {
  /**
   * @param {{
   *   lobby?: import('./lobby.js').Lobby|null, network?: import('./net.js').Network|null,
   *   registry?: import('./net.js').SessionRegistry|null,
   *   startedAt?: number, buildTag?: string|(() => string|null)|null,
   *   secret?: string|undefined, now?: () => number, log?: object,
   *   trustProxy?: 'auto'|boolean, maxFailures?: number, lockoutMs?: number,
   *   feedback?: import('./feedback.js').FeedbackStore|null,
   *   announceStore?: import('./announceStore.js').AnnounceStore|null,
   *   notesStore?: import('./notesStore.js').NotesStore|null,
   * }} [opts]
   *   secret: the ADMIN_SECRET value itself (server/index.js reads the environment — this module never invents one).
   *   feedback: the player-feedback store (server/feedback.js); the read is delegated to it, this service never writes.
   *   announceStore: where the 全体公告 is persisted (server/announceStore.js). Null = the announcement is broadcast but
   *   not stored (a test that does not care about the disk); production always passes one (server/index.js).
   *   notesStore: where the 更新公告 is persisted (server/notesStore.js). Null = the panel cannot edit them and
   *   `GET /api/notes` answers `notes: null` (the client shows the revision built into its own bundle).
   *   bans: the operator's ban list (server/bans.js) behind the 封禁 API. Null = no ban view and no ban write.
   *   slots: the blue-green peer probe (server/peer.js) behind `GET /api/admin/slots` (DEPLOY.md §8.4). Null = the
   *   panel's "other slot" section reports this process only.
   */
  constructor({
    lobby = null, network = null, registry = null, startedAt = Date.now(), buildTag = null,
    secret, now = Date.now, log = noopLog, trustProxy = 'auto',
    maxFailures = ADMIN_MAX_FAILURES, lockoutMs = ADMIN_LOCKOUT_MS, feedback = null,
    announceMinGapMs = ADMIN_ANNOUNCE_MIN_GAP_MS, announceStore = null, notesStore = null, bans = null, slots = null,
    limits = null, limitsStore = null, traffic = null,
  } = {}) {
    this.lobby = lobby;
    this.network = network;
    this.registry = registry;
    /** 网络流量计数 (server/http/traffic.js)：/healthz?traffic=1 与后台面板的「网络」卡读同一份。null = 没接线。 */
    this.traffic = traffic;
    /** 上一次的网络读数，用来算「距上次 /overview」的速率（面板每 2 秒拉一次）。 */
    this._netPrev = null;
    this.startedAt = startedAt;
    this.buildTag = buildTag;
    this.now = now;
    this.log = log;
    this.trustProxy = trustProxy;
    this.maxFailures = maxFailures;
    this.lockoutMs = lockoutMs;
    /** @type {import('./feedback.js').FeedbackStore|null} 玩家反馈（只读：本服务不写） */
    this.feedback = feedback;
    /** @type {import('./announceStore.js').AnnounceStore|null} 全体公告的落盘（server/announceStore.js） */
    this.announceStore = announceStore;
    /** @type {import('./notesStore.js').NotesStore|null} 更新公告的落盘（server/notesStore.js） */
    this.notesStore = notesStore;
    /** @type {string|null} null = not configured (never a fallback value) */
    this.secret = typeof secret === 'string' && secret.length > 0 ? secret : null;
    /** false → /api/admin/* does not exist (routes.js answers 404) */
    this.enabled = this.secret !== null;
    /** @type {Map<string, { count: number, until: number }>} consecutive failures per client address */
    this.failures = new Map();
    /** @type {import('node:os').CpuInfo[]|null} previous os.cpus() sample for the delta CPU% */
    this.cpuSample = null;
    /**
     * 全体公告 (shared/announce.js): the announcements published from this panel, newest first, capped at
     * ANNOUNCE_HISTORY_MAX. This is the PANEL's history list — it is NOT the replay (the replay is the ONE current
     * announcement, held by the lobby and persisted in server/announceStore.js) and it is never sent to game clients.
     * @type {{ id: string, text: string, at: number, seq: number, delivered: number }[]}
     */
    this.announcements = [];
    /**
     * Rate limit for publishing: one announcement per `announceMinGapMs`. Publishing pushes a frame to EVERY connected
     * session, so an operator (or a leaked token) hammering the button must not turn into a broadcast storm. The limit
     * is checked BEFORE the text is accepted, and the answer names the remaining wait.
     */
    this.announceMinGapMs = announceMinGapMs;
    this._lastAnnounceAt = -Infinity;
    /**
     * Last per-room cost reading, keyed by room code (server/admin.js `_matchPerf`): the previous cumulative counter
     * and the instant it was read, so a poll can publish a RATE. Bounded by the number of live rooms — an entry is
     * dropped when its room is gone (roomsEnded / _prunePerfPrev), so it cannot grow with a long-lived process.
     * @type {Map<string, { id: number, at: number, totalMs: number, buckets: Record<string, number> }>}
     */
    this._perfPrev = new Map();
    /** Last /overview aggregate reading, for its own rate window (`_perfAggregate`). */
    this._perfAggPrev = null;
    /**
     * 封禁名单 (server/bans.js). Null = this surface answers no ban reads and refuses every ban write, exactly like
     * the rest of a disabled service. Production always passes the server's own list (server/index.js).
     * @type {import('./bans.js').BanList|null}
     */
    this.bans = bans;
    /**
     * The 蓝绿 slot probe (server/peer.js). Null = `getSlots()` reports this process alone, which is the honest answer
     * for a single-slot deployment (and for every test). Production passes one built from PORT / SP_SLOT.
     * @type {ReturnType<import('./peer.js').createSlotProbe>|null}
     */
    this.slots = slots;
    /** @type {import('./limits.js').LiveLimits|null} 服务器人数上限的实时值（server/limits.js） */
    this.limits = limits;
    /** @type {import('./limitsStore.js').LimitsStore|null} 上限的落盘（server/limitsStore.js） */
    this.limitsStore = limitsStore;

    if (!this.enabled) {
      this.log.warn(
        '[admin] ADMIN_SECRET is not set — the admin API is disabled and every /api/admin/* request answers 404. '
        + 'To enable it, generate a long random value and restart with it in the environment, e.g. '
        + 'node -e "console.log(require(\'crypto\').randomBytes(24).toString(\'hex\'))" then ADMIN_SECRET=<that value> npm start. '
        + '未设置 ADMIN_SECRET：管理接口未启用。',
      );
    }
  }

  // -------------------------------------------------------------------------------------------------
  // authentication
  // -------------------------------------------------------------------------------------------------

  /** The client address the brute-force counter keys on (the same resolution as the WebSocket limits, net.js). */
  clientIp(req) {
    try { return clientAddress(req, this.trustProxy).ip || '?'; } catch { return '?'; }
  }

  /**
   * A session's client address, or null.
   *
   * WHY it is here (owner's question 2026-10-14: 「我怎么知道别人ip是什么」). The ban API could already refuse an
   * address, but nothing in the panel ever SHOWED one, so an operator had no way to learn what to ban: the room view
   * carries a playerId and a name only, and the addresses were reachable only by grepping the log or nginx's
   * access_log. The registry is the one owner of a live session's address (net.js sets `session.addr` on every
   * hello) and it is the SAME value the ban list matches against — so what the panel shows is what a ban would hit.
   *
   * Read defensively: a seat whose session was reaped between two polls has no session, and a half-built one must
   * not turn the operator's dashboard into a 500. `'?'` is net.js's "unknown" placeholder, never a real address.
   * @param {string|null|undefined} playerId
   * @returns {string|null}
   */
  _addrOf(playerId) {
    if (!playerId) return null;
    try {
      const addr = this.registry?.byId?.(playerId)?.addr;
      return typeof addr === 'string' && addr && addr !== '?' ? addr : null;
    } catch { return null; }
  }

  /** True while this request's client address is locked out. */
  isLockedOut(req) {
    const entry = this.failures.get(this.clientIp(req));
    return !!entry && entry.until > this.now();
  }

  /**
   * Validate a request's token. A wrong one counts against the client address; `maxFailures` in a row lock that
   * address out for `lockoutMs`.
   * @param {import('node:http').IncomingMessage} req
   * @returns {boolean}
   */
  authenticate(req) {
    if (!this.enabled) return false;
    const ip = this.clientIp(req);
    const entry = this.failures.get(ip);
    if (entry && entry.until > this.now()) return false; // locked out: not even compared, and it does not extend the window
    const token = bearerToken(req);
    if (token !== null && this.tokenMatches(token)) {
      this.failures.delete(ip); // a good token clears the run of failures
      return true;
    }
    this.recordFailure(ip);
    return false;
  }

  /** Constant-time token comparison. @param {string} candidate */
  tokenMatches(candidate) {
    const a = Buffer.from(candidate, 'utf8');
    const b = Buffer.from(this.secret ?? '', 'utf8');
    // crypto.timingSafeEqual throws on a length mismatch, so the lengths are checked first (a mismatch is a failure,
    // never an exception that would turn into a 500 the attacker can use as an oracle).
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /** @param {string} ip */
  recordFailure(ip) {
    const now = this.now();
    let entry = this.failures.get(ip);
    // Start a fresh run only when there is none, or when a previous lockout has already been served out. (`until: 0`
    // is the "not locked" marker — treating `until <= now` as spent on every call would reset the counter each time.)
    if (!entry || (entry.until !== 0 && entry.until <= now)) { entry = { count: 0, until: 0 }; this.failures.set(ip, entry); }
    entry.count++;
    if (entry.count >= this.maxFailures) {
      entry.count = 0;
      entry.until = now + this.lockoutMs;
      this.log.warn(`[admin] ${ip} locked out for ${Math.round(this.lockoutMs / 1000)} s after ${this.maxFailures} wrong tokens`);
    }
    this.pruneFailures(now);
  }

  /**
   * Drop counters that have done their job (spent lockout, no failures since). Only walks the map once it is
   * unusually large, so an attacker rotating addresses cannot turn it into a per-request cost.
   * @param {number} now
   */
  pruneFailures(now) {
    if (this.failures.size <= 1024) return;
    for (const [ip, entry] of this.failures) if (entry.until <= now && entry.count === 0) this.failures.delete(ip);
  }

  // -------------------------------------------------------------------------------------------------
  // read-only views
  // -------------------------------------------------------------------------------------------------

  /** @returns {string|null} the served build tag (null when it cannot be read) */
  _buildTag() {
    try { return typeof this.buildTag === 'function' ? this.buildTag() : (this.buildTag ?? null); } catch { return null; }
  }

  /**
   * CPU busy percentage since the PREVIOUS call, from the per-core tick deltas of os.cpus() (the cumulative counters
   * are useless on their own — only their difference means anything). The first call has no previous sample: 0.
   * @returns {number} 0…100, one decimal
   */
  cpuPercent() {
    const cpus = os.cpus();
    const prev = this.cpuSample;
    this.cpuSample = cpus;
    if (!prev || prev.length !== cpus.length) return 0;
    let total = 0;
    let idle = 0;
    for (let i = 0; i < cpus.length; i++) {
      const a = cpus[i].times;
      const b = prev[i].times;
      total += (a.user + a.nice + a.sys + a.idle + a.irq) - (b.user + b.nice + b.sys + b.idle + b.irq);
      idle += a.idle - b.idle;
    }
    if (total <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((100 - (idle / total) * 100) * 10) / 10));
  }

  /**
   * GET /api/admin/overview — one flat object (the /healthz shape) plus the process's own numbers.
   * The room/match/human/bot/spectator counts are lobby.stats(), the same numbers /healthz publishes.
   */
  getOverview() {
    const mem = process.memoryUsage();
    const stats = typeof this.lobby?.stats === 'function'
      ? this.lobby.stats()
      : { rooms: 0, matches: 0, humans: 0, bots: 0, spectators: 0 };
    return {
      version: {
        app: APP_VERSION,
        protocol: PROTOCOL_VERSION,
        build: this._buildTag(),
        node: process.version,
      },
      uptimeSec: Math.max(0, Math.round((this.now() - this.startedAt) / 1000)),
      system: {
        cpuPercent: this.cpuPercent(),
        cpuCount: os.cpus().length,
        loadAvg: os.loadavg().map((v) => Math.round(v * 100) / 100),
        processRssMb: mb(mem.rss),
        heapUsedMb: mb(mem.heapUsed),
        heapTotalMb: mb(mem.heapTotal),
        systemFreeMb: mb(os.freemem()),
        systemTotalMb: mb(os.totalmem()),
      },
      sockets: this.network?.connectionCount ?? 0,
      sessions: this.registry?.size ?? 0,
      rooms: stats.rooms ?? 0,
      matches: stats.matches ?? 0,
      humans: stats.humans ?? 0,
      bots: stats.bots ?? 0,
      spectators: stats.spectators ?? 0,
      perf: this._perfAggregate(),
      // 网络（owner 2026-10-18）：累计量 + 距上一次 /overview 的速率（面板 2 秒一刷）。
      network: this.networkOverview(),
    };
  }

  /**
   * 网络流量：WebSocket / HTTP 的累计字节与消息数，外加「距上一次 /overview」的速率。
   *
   * 为什么速率在这里算：面板每 2 秒拉一次 /overview，把上一次读数留在 AdminService 上最省事，也不打扰别的读数
   * 窗口（与 _perfAggregate 同一思路）。第一次调用没有速率（null），面板显示「—/s」。
   * @returns {null | Record<string, any>}
   */
  networkOverview() {
    const count = this.traffic;
    if (!count || typeof count.snapshot !== 'function') return null;
    let snap;
    try { snap = count.snapshot(); } catch { return null; }
    const ws = snap.ws || {};
    const http = snap.http || {};
    const total = http.total || { requests: 0, bytes: 0 };
    const at = this.now();
    const prev = this._netPrev;
    this._netPrev = {
      at,
      ws: { wireOut: ws.wireOut || 0, wireIn: ws.wireIn || 0, messagesOut: ws.messagesOut || 0, messagesIn: ws.messagesIn || 0 },
      http: { requests: total.requests || 0, bytes: total.bytes || 0 },
    };
    const dt = prev ? Math.max(0.001, (at - prev.at) / 1000) : null;
    const per = (cur, was) => (dt == null ? null : Math.max(0, (cur - was) / dt));
    const wireOut = ws.wireOut || 0;
    const payloadOut = ws.payloadOut || 0;
    const categories = {};
    for (const [k, v] of Object.entries(http)) {
      if (k === 'total' || !v || typeof v !== 'object') continue;
      categories[k] = { requests: v.requests || 0, bytes: v.bytes || 0 };
    }
    return {
      seconds: snap.seconds || 0,
      open: ws.open || 0,
      connections: ws.connections || 0,
      wireOut, wireIn: ws.wireIn || 0,
      payloadOut, payloadIn: ws.payloadIn || 0,
      messagesOut: ws.messagesOut || 0, messagesIn: ws.messagesIn || 0,
      httpRequests: total.requests || 0, httpBytes: total.bytes || 0,
      httpByCategory: categories,
      // WebSocket 的消息负载（压缩前）→ 线上字节（含帧头，近似）：越大说明压缩省得越多；没有负载时 null。
      compressionSavedPct: payloadOut > 0 ? Math.max(0, Math.round((1 - wireOut / payloadOut) * 1000) / 10) : null,
      rates: dt == null ? null : {
        wireOutBps: per(wireOut, prev.ws.wireOut),
        wireInBps: per(ws.wireIn || 0, prev.ws.wireIn),
        messagesOutPerSec: per(ws.messagesOut || 0, prev.ws.messagesOut),
        messagesInPerSec: per(ws.messagesIn || 0, prev.ws.messagesIn),
        httpRequestsPerSec: per(total.requests || 0, prev.http.requests),
        httpBytesPerSec: per(total.bytes || 0, prev.http.bytes),
      },
    };
  }

  /**
   * The sum of every live room's cost, over its OWN poll window (kept separate from the per-room windows so that
   * polling /overview and /rooms together — which the panel does — lets neither endpoint disturb the other's rate).
   *
   * `sharePercent` is the share of wall clock all rooms together spent inside the match engine. It is the honest
   * companion to the process CPU% card: the gap between the two is time spent outside the match engine (network,
   * static files, the JSON views' own socket writes, GC on another thread), which is exactly what an operator
   * investigating a busy host wants to see.
   *
   * [ASSUMED] A match that ENDS and a fresh one that STARTS inside one window makes the summed total fall, and the
   * difference is clamped at 0 — that window under-reports the rooms involved rather than inventing a negative cost.
   * A room changing identity inside a 2 s window is rare enough that the simpler sum is the right trade; the
   * PER-ROOM reading (getRooms → perf, which does track identity) stays exact.
   */
  _perfAggregate() {
    let totalMs = 0;
    /** @type {Record<string, number>} */
    const buckets = {};
    for (const k of PERF_BUCKETS) buckets[k] = 0;
    let rooms = 0;
    for (const room of this._rooms()) {
      const match = this._matchOf(room);
      const perf = match?.perf;
      if (!perf || typeof perf.snapshot !== 'function') continue;
      let snap;
      try { snap = perf.snapshot(); } catch { continue; }
      if (!snap || typeof snap !== 'object') continue;
      rooms++;
      totalMs += Number(snap.totalMs) || 0;
      for (const k of PERF_BUCKETS) buckets[k] += Number(snap.buckets?.[k]) || 0;
    }
    const now = this.now();
    const prev = this._perfAggPrev;
    const windowMs = prev ? Math.max(0, now - prev.at) : 0;
    this._perfAggPrev = { at: now, totalMs };
    const measured = !!prev && windowMs >= MIN_PERF_WINDOW_MS;
    const deltaMs = measured ? Math.max(0, totalMs - prev.totalMs) : 0;
    const out = {};
    for (const k of PERF_BUCKETS) out[k] = Math.round(buckets[k] * 100) / 100;
    return {
      rooms,
      measured: prev ? measured : false,
      windowSec: Math.round(windowMs / 100) / 10,
      totalMs: Math.round(totalMs * 100) / 100,
      deltaMs: Math.round(deltaMs * 100) / 100,
      sharePercent: measured ? Math.round((deltaMs / windowMs) * 1000) / 10 : null,
      buckets: out,
    };
  }

  /** @returns {any[]} the live rooms (empty when there is no lobby yet) */
  _rooms() {
    const rooms = this.lobby?.rooms;
    if (!rooms || typeof rooms.values !== 'function') return [];
    return [...rooms.values()];
  }

  /**
   * A room's running match, or null. The property is read defensively: a room that is being disposed mid-request must
   * not turn an operator's dashboard poll into a 500.
   * @param {any} room
   */
  _matchOf(room) {
    try { return room?.match ?? null; } catch { return null; }
  }

  /**
   * The match summary of a room's running match. Only the three scalars are read (never `publicView()`, which builds
   * a whole m.public and may be expensive or throw on a half-built match); a match that cannot be read shows nulls.
   * @param {any} match
   */
  _matchSummary(match) {
    try {
      return {
        phase: typeof match.phase === 'string' ? match.phase : null,
        round: Number.isInteger(match.round) ? match.round : 0,
        paused: !!match.paused,
      };
    } catch {
      return { phase: null, round: 0, paused: false };
    }
  }

  /**
   * GET /api/admin/rooms — one entry per room: identity, seats, spectators, the running match's phase and that match's
   * per-room cost (see `_matchPerf`).
   * `connected` is what the player can act with (the seat's `connected` minus a departed seat), like Room.toState().
   */
  getRooms() {
    const rooms = this._rooms();
    // Keep the rate window bounded by the rooms that exist: a code that is gone (or that just restarted) is dropped,
    // so this map can never grow with uptime. Done here because this is the method that fills it.
    this._prunePerfPrev(new Set(rooms.map((r) => String(r?.code ?? '?'))));
    return rooms.map((room) => {
      const seats = [];
      (Array.isArray(room.seats) ? room.seats : []).forEach((s, i) => {
        if (!s) return;
        seats.push({
          seat: Number.isInteger(s.seat) ? s.seat : i,
          playerId: s.playerId ?? null,
          name: s.name ?? null,
          isBot: !!s.isBot,
          ready: !!s.ready,
          connected: !!s.connected && !s.left,
          // 已经永久离开这一局的人（对局中的中途退出：座位保留到本局结束，见 lobby.js removeMember）。与「掉线」是
          // 两件事：掉线的座位还能被移出（宽限期一到也会自己释放），已经离开的座位再移出只会得到 BAD_TARGET ——
          // 面板据此决定要不要画那颗按钮。对局外这个值永远是 false（lobby 直接释放座位）。
          left: !!s.left,
          // 座位上的客户端地址（业主 2026-10-14：封禁要知道封谁）。面板平时不显示它，悬停才露出来（§8.6）——
          // 这不是新增采集，只是把服务器**已经持有**的地址交给持口令的运维；值与封禁匹配的完全相同。
          // A bot has none; a seat whose session was reaped keeps none either (null, never '?').
          addr: this._addrOf(s.playerId),
        });
      });
      const spectators = (Array.isArray(room.spectators) ? room.spectators : []).map((s) => ({
        playerId: s?.playerId ?? null,
        name: s?.name ?? null,
        connected: !!s?.connected,
      }));
      const host = seats.find((s) => s.playerId != null && s.playerId === room.hostId) || null;
      const match = this._matchOf(room);
      return {
        code: room.code ?? null,
        host: room.hostId ?? null,
        hostName: host ? host.name : null,
        mode: room.mode ?? null,
        difficulty: room.difficulty ?? null,
        inMatch: !!match,
        seats,
        spectators,
        match: match ? this._matchSummary(match) : null,
        perf: match ? this._matchPerf(room.code, match) : null,
        createdAt: Number.isFinite(room.createdAt) ? room.createdAt : null,
      };
    });
  }

  /**
   * Drop rate windows for rooms that no longer exist. A code that is still live keeps its window (that is the point);
   * everything else is released, which bounds the map by the live room count rather than by uptime.
   * @param {Set<string>} liveCodes
   */
  _prunePerfPrev(liveCodes) {
    if (this._perfPrev.size <= liveCodes.size) return;
    for (const key of this._perfPrev.keys()) if (!liveCodes.has(key)) this._perfPrev.delete(key);
  }

  /**
   * A room's match cost over the window SINCE THE PREVIOUS POLL, as a share of the process's wall clock.
   *
   * The counter on the match is cumulative (server/match/perf.js); this keeps the previous reading per room code and
   * differences it, which is what turns "ms spent so far" into "ms/s right now" — the number an operator acts on.
   * Two things are guarded here, both of which have bitten this kind of meter before:
   *
   *   * A room code is REUSED. A different match id means the totals restarted, so there is no window to difference —
   *     the reading is published with `windowSec: 0` and no rate, rather than a bogus spike.
   *   * The window is floored at 50 ms. Two polls that land almost together (a second panel tab, a retry) would
   *     otherwise divide a few ms by almost no time and report a wild percentage.
   *
   * `sharePercent` is cost relative to WALL-CLOCK time, so it is directly comparable with the process CPU% card: with
   * one room on a 4-core host, 100 % means the room kept one core busy for the whole window. It is deliberately not
   * divided by the core count — "how much of one core is this room using" is the useful reading for a game server.
   *
   * @param {string|null} code
   * @param {any} match
   */
  _matchPerf(code, match) {
    let snap;
    try {
      const perf = match?.perf;
      if (!perf || typeof perf.snapshot !== 'function') return null;
      snap = perf.snapshot();
    } catch { return null; }
    if (!snap || typeof snap !== 'object') return null;

    const now = this.now();
    const key = String(code ?? '?');
    // A rate needs a window: without a previous reading of the SAME counter the first poll publishes totals only.
    const prev = this._perfPrev.get(key);
    const fresh = !prev || prev.id !== snap.id;
    const windowMs = fresh ? 0 : Math.max(0, now - prev.at);
    const deltaMs = fresh ? 0 : Math.max(0, (Number(snap.totalMs) || 0) - prev.totalMs);
    const measured = windowMs >= MIN_PERF_WINDOW_MS;
    const share = measured ? Math.round((deltaMs / windowMs) * 1000) / 10 : null;
    /** @type {Record<string, { ms: number, sharePercent: number|null }>} */
    const buckets = {};
    for (const k of PERF_BUCKETS) {
      const total = Number(snap.buckets?.[k]) || 0;
      const d = fresh ? 0 : Math.max(0, total - (prev.buckets?.[k] || 0));
      buckets[k] = { ms: Math.round(total * 100) / 100, sharePercent: measured ? Math.round((d / windowMs) * 1000) / 10 : null };
    }
    this._perfPrev.set(key, { id: snap.id, at: now, totalMs: Number(snap.totalMs) || 0, buckets: Object.fromEntries(PERF_BUCKETS.map((k) => [k, Number(snap.buckets?.[k]) || 0])) });
    return {
      windowSec: Math.round(windowMs / 100) / 10,
      totalMs: Math.round((Number(snap.totalMs) || 0) * 100) / 100,
      deltaMs: Math.round(deltaMs * 100) / 100,
      sharePercent: share,
      matchUptimeSec: Number(snap.uptimeSec) || 0,
      frames: Number(snap.frames) || 0,
      maxDepth: Number(snap.maxDepth) || 0,
      buckets,
    };
  }

  /**
   * GET /api/admin/logs?since=<ms epoch> — the log entries newer than `since` (all of them for 0/absent).
   * Copies are returned so a caller cannot mutate the ring through the response object.
   * @param {number|string} [since]
   */
  getLogs(since = 0) {
    const n = Number(since);
    const from = Number.isFinite(n) && n > 0 ? n : 0;
    const out = [];
    for (const entry of logRing) if (entry.at > from) out.push({ ...entry });
    return out;
  }

  /**
   * GET /api/admin/feedback?limit=n — the player reports, newest first (server/feedback.js). The store does the
   * reading; this method only guards against a malformed store. An absent store answers an empty list rather than
   * throwing (a test, or a deployment that did not wire one up).
   * @param {number} [limit]
   */
  getFeedback(limit = 50) {
    if (!this.feedback) return { items: [], total: 0, dir: null };
    let items = [];
    let total = 0;
    try { items = this.feedback.list({ limit }); } catch (e) { this.log.error('[admin] feedback list failed', e); }
    try { total = this.feedback.count(); } catch { /* ignore */ }
    return { items, total, dir: this.feedback.dir ?? null };
  }

  /**
   * POST /api/admin/feedback/remove { id } — 永久删除一条玩家反馈 (server/feedback.js `remove`).
   *
   * WHY a delete is on a read-mostly surface at all: a report can carry a player's own words plus a diagnostics dump,
   * and the owner asked (2026-10-13) to be able to prune one — a duplicate, a test submission, something that should
   * not stay on disk. It is drawn as narrowly as the ban writes: one line of one file, no session, no room, no match.
   * The store rewrites that month through a temp file, so nothing else in the file moves.
   *
   * @param {unknown} id the report's own id, as `GET /api/admin/feedback` reported it
   * @returns {{ ok: true, id: string, at: number, total: number }
   *   | { ok: false, error: 'DISABLED'|'BAD_ID'|'NOT_FOUND'|'TOO_LARGE'|'UNWRITABLE', message: string }}
   */
  removeFeedback(id) {
    if (!this.enabled || !this.feedback) return { ok: false, error: 'DISABLED', message: FEEDBACK_TEXT.disabled };
    const key = typeof id === 'string' ? id.trim() : '';
    if (!key || key.length > 128) return { ok: false, error: 'BAD_ID', message: FEEDBACK_TEXT.badId };
    let r;
    try { r = this.feedback.remove(key); } catch (e) {
      this.log.error('[admin] feedback remove failed', e);
      return { ok: false, error: 'UNWRITABLE', message: FEEDBACK_TEXT.unwritable };
    }
    if (!r || !r.ok) {
      const reason = r?.reason;
      if (reason === 'not-found') return { ok: false, error: 'NOT_FOUND', message: FEEDBACK_TEXT.notFound };
      if (reason === 'too-large') return { ok: false, error: 'TOO_LARGE', message: FEEDBACK_TEXT.tooLarge };
      if (reason === 'unwritable') return { ok: false, error: 'UNWRITABLE', message: FEEDBACK_TEXT.unwritable };
      return { ok: false, error: 'BAD_ID', message: FEEDBACK_TEXT.badId };
    }
    recordAdminLog('info', `删除了一条玩家反馈（${key}）`);
    this.log.info?.(`[admin] feedback removed ${key}`);
    let total = 0;
    try { total = this.feedback.count(); } catch { /* ignore */ }
    return { ok: true, id: key, at: r.at, total };
  }

  // -------------------------------------------------------------------------------------------------
  // 蓝绿槽位 — the peer view (server/peer.js)
  // -------------------------------------------------------------------------------------------------
  //
  // WHY this is worth its own endpoint: the panel is served BY one slot, so it can only ever see that one. The
  // operator's real question during a release is about the OTHER process — is it still up, does it still hold players,
  // may I stop it (DEPLOY.md §8.4, and 2026-10-13 when a retired slot held 227 MB and 9 sessions nobody could see).
  // The probe is loopback-only, cached and bounded (server/peer.js); when no peer is configured this reports one slot
  // and the caller can hide the section entirely.

  /**
   * GET /api/admin/slots — this process and its blue-green peer, read the same way.
   * @returns {Promise<{ ok: true, self: object, peer: object|null, slots: object[], peerConfigured: boolean, source: string }>}
   */
  async getSlots() {
    // This process's own counters, in the same shape the peer's are read into, so the panel renders one table.
    const overview = this.getOverview();
    const version = overview.version || {};
    const system = overview.system || {};
    const self = {
      build: version.build ?? null,
      app: version.app ?? null,
      node: version.node ?? null,
      uptimeSec: overview.uptimeSec ?? null,
      sockets: overview.sockets ?? null,
      sessions: overview.sessions ?? null,
      rooms: overview.rooms ?? null,
      matches: overview.matches ?? null,
      humans: overview.humans ?? null,
      bots: overview.bots ?? null,
      spectators: overview.spectators ?? null,
      processRssMb: system.processRssMb ?? null,
    };
    if (!this.slots || typeof this.slots.getSlots !== 'function') {
      return {
        ok: true, self: { name: 'this', active: true, reachable: true, via: 'self', port: null, counters: self, hostname: null },
        peer: null, slots: [], peerConfigured: false, source: 'none',
      };
    }
    try {
      const r = await this.slots.getSlots();
      // The probe was built without this process's live counters (it cannot know them), so fill them in here.
      if (r?.self) r.self.counters = self;
      return { ok: true, ...r };
    } catch (e) {
      this.log.error('[admin] slot probe failed', e);
      return {
        ok: true, self: { name: this.slots.config?.name || 'this', active: true, reachable: true, via: 'self', port: this.slots.config?.port ?? null, counters: self, hostname: null },
        peer: null, slots: [], peerConfigured: false, source: 'error',
      };
    }
  }

  // -------------------------------------------------------------------------------------------------
  // 全体公告 — the mutating operations of this surface (shared/announce.js)
  // -------------------------------------------------------------------------------------------------
  //
  // Everything else here is a read (see the SECURITY note at the top of this file: a token that ends up in a browser
  // tab, a screenshot or a proxy log must not be able to change the running server). Publishing an announcement is the
  // deliberate exception the owner asked for on 2026-10-11, and it is drawn as narrowly as the feature allows:
  //
  //   * it cannot touch a room, a match, a seat or any game state — its whole effect is one text frame to connected
  //     sessions (Lobby.announce walks the session registry, never a room), plus one small file (server/announceStore.js);
  //   * it cannot remove or alter anything else, so the worst a leaked token can do is put a line on every screen and
  //     keep it there — which is exactly what the panel is for, and why 撤回 exists;
  //   * it is rate limited, so it cannot become a broadcast storm;
  //   * the text is sanitized and truncated, so it cannot inject control characters into a browser.
  //
  // PERSISTENCE (the owner's request of 2026-10-11): the standing announcement is written through `announceStore`, so a
  // late-joining player still sees it and a restart does not forget it. The store is optional — without one the feature
  // still broadcasts, it just does not survive a restart (tests that do not care about the disk omit it).

  /**
   * Publish one 全体公告 to every connected session. The text is sanitized (control characters stripped, whitespace
   * collapsed, trimmed, truncated to ANNOUNCE_MAX_LEN) before anything is sent.
   * @param {unknown} raw the operator's text
   * @returns {{ ok: true, announcement: object } | { ok: false, error: 'EMPTY'|'RATE'|'DISABLED', retryAfterMs?: number }}
   */
  publishAnnouncement(raw) {
    if (!this.enabled) return { ok: false, error: 'DISABLED' };
    const text = sanitizeAnnounce(raw);
    // An empty announcement is refused rather than broadcast: a blank banner on every screen is a bug, not a message.
    // (Withdrawing the standing one is `withdrawAnnouncement`, a separate action.)
    if (!text) return { ok: false, error: 'EMPTY' };
    const now = this.now();
    const wait = this.announceMinGapMs - (now - this._lastAnnounceAt);
    if (wait > 0) return { ok: false, error: 'RATE', retryAfterMs: Math.ceil(wait) };
    this._lastAnnounceAt = now;

    const sent = typeof this.lobby?.announce === 'function'
      ? this.lobby.announce(text)
      : { id: `a${now.toString(36)}`, text, at: now, seq: 0, delivered: 0 };
    const announcement = { id: sent.id, text: sent.text, at: sent.at, seq: sent.seq, delivered: sent.delivered };
    // Persist BEFORE answering, so "已发布" always means "it will still be there after a restart".
    this.announceStore?.save({ id: announcement.id, text: announcement.text, at: announcement.at, seq: announcement.seq });
    this.announcements.unshift(announcement);
    if (this.announcements.length > ANNOUNCE_HISTORY_MAX) this.announcements.length = ANNOUNCE_HISTORY_MAX;
    return { ok: true, announcement };
  }

  /**
   * 撤回 the standing announcement: every client takes the line down and the stored copy is cleared, so a restart does
   * not bring it back. Not rate limited — taking a notice DOWN is always safe, and an operator must never be told to
   * wait to remove something wrong from every screen.
   * @returns {{ ok: true, withdrawn: true, delivered: number } | { ok: false, error: 'DISABLED' }}
   */
  withdrawAnnouncement() {
    if (!this.enabled) return { ok: false, error: 'DISABLED' };
    const delivered = typeof this.lobby?.withdrawAnnouncement === 'function'
      ? this.lobby.withdrawAnnouncement().delivered
      : 0;
    this.announceStore?.clear();
    this._lastAnnounceAt = -Infinity;   // a fresh announcement right after a withdrawal is not a "storm"
    return { ok: true, withdrawn: true, delivered };
  }

  /**
   * The panel's own announcement history, newest first (a copy: a caller cannot mutate the stored list).
   * @param {number} [limit]
   */
  getAnnouncements(limit = ANNOUNCE_HISTORY_MAX) {
    const n = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : ANNOUNCE_HISTORY_MAX;
    return this.announcements.slice(0, Math.min(n, ANNOUNCE_HISTORY_MAX)).map((a) => ({ ...a }));
  }

  // -------------------------------------------------------------------------------------------------
  // 封禁 IP — the second mutating group (server/bans.js, server/banStore.js)
  // -------------------------------------------------------------------------------------------------
  //
  // WHY it is allowed on this surface at all: it is the one lever an operator is missing when someone is flooding
  // the box, and the alternative (edit a file on the server and restart) ends every running match. It is bounded the
  // same way the announcement is — no room, no match, no seat, no game state — and it is the ONLY operation here that
  // changes who may connect, so its write path carries two extra guards:
  //
  //   * a leaked token cannot lock the operator out of the machine: a rule covering the CALLER's own address is
  //     refused unless the request says `force: true` (the caller address comes from the same net.js resolution the
  //     ban list itself uses, so it cannot be spoofed through a header the server does not trust);
  //   * a wider-than-guard CIDR (`0.0.0.0/0`, `::/0`, …) is refused unless forced, because one mistyped prefix would
  //     otherwise take the whole server off the internet.
  //
  // The read is `getBans`; the disk format is server/banStore.js; the matching rules are server/bans.js. Every
  // accepted change is logged into the ring the panel already shows (recordAdminLog), so "who banned whom" survives
  // in the console even though the panel itself has no ban UI yet.

  /**
   * GET /api/admin/limits — the socket ceiling this process is enforcing, and where it came from.
   *
   * `maxConnections` is the number actually in force (the panel's value when one was set, else the boot-time option);
   * `bootMaxConnections` is what a restart would fall back to, shown so the operator can tell 「I set 400」 from
   * 「this box was born with 400」. `sockets` is the live count the cap is compared against — a limit with no
   * denominator tells the operator nothing.
   */
  getLimits() {
    const boot = this.network?.opts?.maxConnections ?? null;
    // 人机上限的启动值来自 lobby 的 opts（LOBBY_DEFAULTS.maxBots / maxBotsPerRoom，SP_MAX_BOTS / SP_MAX_BOTS_PER_ROOM）。
    // 面板改的是 LiveLimits 里那两格，改完 addBot 下一次判定就用新数。
    const botBoot = this.lobby?.opts?.maxBots ?? null;
    const perRoomBoot = this.lobby?.opts?.maxBotsPerRoom ?? null;
    const live = this.limits && typeof this.limits.status === 'function'
      ? this.limits.status(boot, { botBoot, perRoomBoot })
      : { maxConnections: boot, overridden: false, bootMaxConnections: boot, maxBots: botBoot, maxBotsPerRoom: perRoomBoot, overriddenBots: false, overriddenBotsPerRoom: false, bootMaxBots: botBoot, bootMaxBotsPerRoom: perRoomBoot, at: null, by: null };
    return {
      ok: true,
      enabled: true,
      ...live,
      sockets: this.network?.connectionCount ?? 0,
      sessions: this.registry?.size ?? 0,
      dir: this.limitsStore?.dir ?? null,
      floor: MAX_CONNECTIONS_FLOOR,
      ceiling: MAX_CONNECTIONS_CEILING,
      botsFloor: MAX_BOTS_FLOOR,
      botsCeiling: MAX_BOTS_CEILING,
    };
  }

  /**
   * POST /api/admin/limits { maxConnections } — set the socket ceiling, or clear it with `null` (「跟随启动参数」).
   *
   * APPLIES TO THIS PROCESS IMMEDIATELY, and to the other blue-green slot within one poll (server/limitsStore.js).
   * Setting it here rather than only writing the file is what makes the panel's own slot honest: the operator presses
   * save and the very next connection is judged by the new number.
   *
   * IT NEVER DISCONNECTS ANYBODY (see net.js `maxConnectionCap`): lowering the cap below the current socket count is
   * accepted, and the count drifts down as people leave. `sockets` in the answer is returned precisely so the panel can
   * say 「现在 380 人在线，上限降到 200 之后新人进不来，但没人会被踢」 instead of leaving the operator guessing.
   * @param {{ maxConnections?: unknown }} input
   * @param {{ by?: string | null }} [meta] the caller's client address (the panel has no accounts)
   */
  setLimits(input, { by = null } = {}) {
    if (!this.enabled || !this.limits) return { ok: false, error: 'DISABLED', message: LIMITS_TEXT.disabled };
    // 人机那两格（业主 2026-10-16）：给了才改，一次可以只改一格。**0 在这里合法 = 不限制**
    // （与 maxConnections 的 0 不是一回事：那个 0 是「谁都进不来」，所以下限是 1）。
    const hasBots = Object.prototype.hasOwnProperty.call(input ?? {}, 'maxBots');
    const hasPerRoom = Object.prototype.hasOwnProperty.call(input ?? {}, 'maxBotsPerRoom');
    const hasConn = Object.prototype.hasOwnProperty.call(input ?? {}, 'maxConnections');
    if (!hasConn && !hasBots && !hasPerRoom) {
      return { ok: false, error: 'BAD_VALUE', message: LIMITS_TEXT.bad };
    }
    // undefined = 这一格不动（保留原值）
    const r = hasConn ? normalizeMaxConnections(input.maxConnections) : { ok: true, value: undefined };
    if (!r.ok) {
      return {
        ok: false,
        error: r.error,
        message: r.error === 'OUT_OF_RANGE' ? LIMITS_TEXT.range(MAX_CONNECTIONS_FLOOR, MAX_CONNECTIONS_CEILING) : LIMITS_TEXT.bad,
      };
    }
    const rb = hasBots ? normalizeMaxBots(input.maxBots) : { ok: true, value: undefined };
    if (!rb.ok) {
      return {
        ok: false,
        error: rb.error,
        message: rb.error === 'OUT_OF_RANGE' ? LIMITS_TEXT.botsRange(MAX_BOTS_FLOOR, MAX_BOTS_CEILING) : LIMITS_TEXT.bad,
      };
    }
    const rp = hasPerRoom ? normalizeMaxBots(input.maxBotsPerRoom) : { ok: true, value: undefined };
    if (!rp.ok) {
      return {
        ok: false,
        error: rp.error,
        message: rp.error === 'OUT_OF_RANGE' ? LIMITS_TEXT.botsRange(MAX_BOTS_FLOOR, MAX_BOTS_CEILING) : LIMITS_TEXT.bad,
      };
    }
    const at = this.now();
    if (r.value !== undefined) this.limits.set(r.value, { at, by });
    if (rb.value !== undefined) this.limits.setBots(rb.value, { at, by });
    if (rp.value !== undefined) this.limits.setBotsPerRoom(rp.value, { at, by });
    // 落盘：三格合并写（undefined = 盘上原值不动），面板只改一格时另一格不能被抹掉。
    const persisted = this.limitsStore
      ? this.limitsStore.save(r.value === undefined ? this.limits.maxConnections : r.value, { by, maxBots: rb.value, maxBotsPerRoom: rp.value })
      : false;
    const bits = [];
    if (r.value !== undefined) bits.push(r.value == null ? '服务器人数上限跟随启动参数（清除面板设置）' : `服务器人数上限 = ${r.value}`);
    if (rb.value !== undefined) bits.push(rb.value == null ? '全服人机上限跟随启动参数' : `全服人机上限 = ${rb.value}`);
    if (rp.value !== undefined) bits.push(rp.value == null ? '每房间人机上限跟随启动参数' : `每房间人机上限 = ${rp.value}`);
    recordAdminLog('info', bits.join('；'), { by, persisted });
    this.log.info?.(`[admin] limits: ${bits.join('；')} by ${by || '?'}${persisted ? '' : '（未落盘）'}`);
    return { ...this.getLimits(), ok: true, persisted };
  }

  /** GET /api/admin/bans — the standing list, newest first. `enabled: false` when no list is wired up. */
  getBans() {
    if (!this.bans) return { ok: true, enabled: false, bans: [], size: 0, dir: null };
    let bans = [];
    try { bans = this.bans.list(); } catch (e) { this.log.error('[admin] ban list failed', e); }
    return { ok: true, enabled: true, bans, size: bans.length, dir: this.bans.store?.dir ?? null };
  }

  /**
   * POST /api/admin/bans — add (or replace) one rule and drop the sockets it covers.
   * @param {{ rule?: unknown, ip?: unknown, reason?: unknown, minutes?: unknown, until?: unknown, force?: boolean }} input
   * @param {{ by?: string|null }} [opts] `by` is the CALLER's client address (the panel has no accounts) — it labels
   *   the entry and is what the self-ban guard compares against.
   * @returns {{ ok: true, entry: object, added: boolean, evicted: number, size: number, persisted: boolean, bans: object[] }
   *   | { ok: false, error: string, message: string, rule?: string }}
   *   `evicted`: how many of that address's open sockets this ban closed.
   */
  addBan(input, { by = null } = {}) {
    if (!this.enabled || !this.bans) return { ok: false, error: 'DISABLED', message: BAN_TEXT.disabled };
    const rule = input?.rule ?? input?.ip;
    const parsed = parseBanRule(rule);
    // Broad first: `0.0.0.0/0` also covers the caller, and "this rule is too wide" is the more useful answer than
    // "this rule covers you" (which would send an operator chasing the wrong problem). BanList.add checks it again.
    if (parsed.ok && input?.force !== true && isBroadRule(parsed.rule)) {
      const minPrefix = parsed.rule.family === 4 ? BAN_MIN_PREFIX_V4 : BAN_MIN_PREFIX_V6;
      return { ok: false, error: 'TOO_BROAD', rule: parsed.rule.rule, message: BAN_TEXT.broad(minPrefix, true) };
    }
    if (parsed.ok && by && input?.force !== true && banRuleMatches(parsed.rule, by)) {
      return { ok: false, error: 'SELF', rule: parsed.rule.rule, message: BAN_TEXT.self(by) };
    }
    const r = this.bans.add({ ...input, rule, by });
    if (!r.ok) {
      const message = r.error === 'TOO_BROAD' ? BAN_TEXT.broad(r.minPrefix, false)
        : r.error === 'FULL' ? BAN_TEXT.full : BAN_TEXT.bad;
      return { ok: false, error: r.error, message, rule: r.rule };
    }
    // The sockets the address already holds were closed by the list's own change notification (server/index.js wires
    // `BanList.onChange` to `network.dropBanned`), and BanList.add hands its count back — so there is exactly ONE
    // sweep, and `evicted` is that sweep's number rather than a second pass over the same sockets. A list with no
    // notification wired (a unit test) reports 0 and asks directly instead.
    let evicted = r.evicted;
    if (evicted == null) {
      try { evicted = this.network?.dropBanned?.() ?? 0; } catch (e) { this.log.error('[admin] dropBanned failed', e); evicted = 0; }
    }
    recordAdminLog('warn', `封禁 ${r.entry.rule}${r.entry.until ? `（至 ${new Date(r.entry.until).toISOString()}）` : '（永久）'}${r.entry.reason ? `：${r.entry.reason}` : ''}`, { by, evicted });
    this.log.warn?.(`[admin] ban ${r.entry.rule} by ${by || '?'} (${evicted} socket(s) dropped)`);
    return { ok: true, entry: r.entry, added: r.added, evicted, size: r.size, persisted: r.persisted, bans: this.bans.list() };
  }

  // -------------------------------------------------------------------------------------------------
  // 踢出房间 — the third mutating group (Lobby.operatorKick)
  // -------------------------------------------------------------------------------------------------
  //
  // WHY this is allowed on this surface: the host already has room.kick for their own guests before the match, but an
  // operator looking at a running room has no lever — the only other two are banning the address (a much broader,
  // persistent decision that takes the player off the whole server) and restarting the process (which ends every
  // match). Removing one human from one room is the narrow action that actually matches the problem.
  //
  // It is bounded the way the rest of this file is:
  //   * it cannot create, move or alter a room, a seat or a match — it calls the SAME `removeMember` every normal
  //     departure uses (leave, grace timeout, expiry), so a kicked player is indistinguishable from one who left;
  //   * it cannot ban: the player may join the same room again (the operator has 封禁 for the persistent version);
  //   * it names its target by room code AND playerId, so a stale panel row cannot remove whoever took that seat since;
  //   * it can never touch a bot or an already-departed seat (refused by name), and there is no "kick everyone".

  /**
   * POST /api/admin/rooms/kick { code, playerId } — 把一名真人踢出一间房 (Lobby.operatorKick).
   *
   * Works at any point of the room's life, a running match included (that player is then a 中途退出: the seat is kept
   * as departed, everyone else plays on, and a kicked host hands the role on). The player gets `room.closed
   * {reason:'kicked'}` — now, or on their next resume when they are offline — which is the existing client notice
   * 「你已被移出同盟」, so nothing on the player side is new.
   *
   * @param {{ code?: unknown, playerId?: unknown }} input
   * @param {{ by?: string|null }} [opts] the CALLER's client address (the panel has no accounts); it only labels the
   *   log line, exactly like the ban API's `by`
   * @returns {{ ok: true, kick: object } | { ok: false, error: 'DISABLED'|'BAD_REQUEST'|'ROOM_NOT_FOUND'|'NOT_IN_ROOM'|'BAD_TARGET'|'FAILED', message: string, detail?: string }}
   */
  kickFromRoom(input, { by = null } = {}) {
    if (!this.enabled) return { ok: false, error: 'DISABLED', message: KICK_TEXT.disabled };
    if (!this.lobby || typeof this.lobby.operatorKick !== 'function') {
      return { ok: false, error: 'DISABLED', message: KICK_TEXT.disabled };
    }
    const code = typeof input?.code === 'string' ? input.code.trim().toUpperCase() : '';
    const playerId = typeof input?.playerId === 'string' ? input.playerId.trim() : '';
    if (!code || !playerId) return { ok: false, error: 'BAD_REQUEST', message: KICK_TEXT.bad };
    let r;
    try {
      r = this.lobby.operatorKick({ code, playerId });
    } catch (e) {
      this.log.error('[admin] operator kick failed', e);
      return { ok: false, error: 'FAILED', message: KICK_TEXT.failed };
    }
    if (!r || !r.ok) {
      const error = r?.error;
      if (error === 'ROOM_NOT_FOUND') return { ok: false, error, message: KICK_TEXT.notFound };
      if (error === 'NOT_IN_ROOM') return { ok: false, error, message: KICK_TEXT.notInRoom };
      // WHY the specific reason goes into `message` and not only `detail`: the panel shows `message` (that is what
      // every other admin write returns), so a bare "only a human can be kicked" would hide the two different causes
      // this refusal exists to tell apart (an AI seat vs a seat the player has already left).
      if (error === 'BAD_TARGET') {
        return { ok: false, error, message: r.detail ? `${KICK_TEXT.badTarget} · ${r.detail}` : KICK_TEXT.badTarget, detail: r.detail };
      }
      return { ok: false, error: 'BAD_REQUEST', message: KICK_TEXT.bad, detail: r?.detail };
    }
    const who = r.name || r.playerId;
    recordAdminLog('warn', `把 ${who} 踢出房间 ${r.room}${r.inMatch ? '（对局进行中）' : ''}`, { by });
    this.log.warn?.(`[admin] kick ${r.room} ${who} by ${by || '?'}${r.inMatch ? ' (in match)' : ''}`);
    return { ok: true, kick: r };
  }

  /**
   * POST /api/admin/bans/remove — lift one rule. Not rate limited: lifting a ban is always safe.
   * @param {unknown} rule
   * @returns {{ ok: true, removed: boolean, size: number, persisted: boolean, bans: object[] } | { ok: false, error: string, message: string }}
   */
  removeBan(rule) {
    if (!this.enabled || !this.bans) return { ok: false, error: 'DISABLED', message: BAN_TEXT.disabled };
    const r = this.bans.remove(rule);
    if (!r.ok) return { ok: false, error: r.error, message: BAN_TEXT.required };
    if (r.removed) {
      recordAdminLog('info', `解封 ${String(rule).trim()}`);
      this.log.info?.(`[admin] unban ${String(rule).trim()}`);
    }
    return { ok: true, removed: r.removed, size: r.size, persisted: r.persisted, bans: this.bans.list() };
  }

  /**
   * The live 更新公告, as the panel displays it. `notes: null` means no live revision — either nothing was ever saved
   * or the store is not configured — and every client then shows the revision built into its own bundle.
   *
   * `builtinDigest` is the digest of that built-in revision (public/js/ui/updateNotesData.js). The panel uses the two
   * digests to say, truthfully, whether the live copy differs from the shipped one; it does not need the built-in
   * document itself, only its identity.
   *
   * @param {object|null} [builtin] the built-in notes, when the caller has them (server/index.js had none: the file is
   *   a browser module). Absent → `builtinDigest` is null and the panel simply omits that comparison.
   * @returns {{ notes: object|null, at: number|null, by: string|null, digest: string|null, builtinDigest: string|null,
   *   writable: boolean }}
   */
  getNotes(builtin = null) {
    const doc = this.notesStore?.read?.() ?? null;
    return {
      notes: doc ? doc.notes : null,
      at: doc ? doc.at : null,
      by: doc ? doc.by : null,
      digest: doc ? notesDigest(doc.notes) : null,
      builtinDigest: builtin ? notesDigest(builtin) : null,
      writable: !!this.notesStore,
    };
  }

  /**
   * Save the live 更新公告 (the one write this panel performs besides 全体公告). The document is validated and
   * normalized inside the store before anything is written, so a malformed save is answered with the reason and the
   * revision already in place stays untouched.
   *
   * There is deliberately no rate limit and no broadcast: this changes what the NEXT page load fetches
   * (`GET /api/notes`). A release note is read on arrival, it does not interrupt whoever is mid-match.
   *
   * @param {unknown} raw
   * @param {{ by?: string|null }} [meta]
   * @returns {{ ok: true, notes: object, digest: string, at: number, by: string|null, warnings: string[], unwritable: boolean }
   *   | { ok: false, error: string, message: string }}
   */
  saveNotes(raw, meta = {}) {
    if (!this.enabled) return { ok: false, error: 'DISABLED', message: 'admin API is disabled' };
    if (!this.notesStore) return { ok: false, error: 'DISABLED', message: 'notes store is not configured' };
    const r = this.notesStore.save(raw, meta);
    if (!r.ok) return { ok: false, error: r.error, message: notesErrorText(r.error) };
    this.log.info?.(`[admin] 更新公告已更新（${r.notes.text.length} 字, 指纹 ${r.digest.slice(0, 12)}）`);
    return {
      ok: true, notes: r.notes, digest: r.digest, at: r.at, by: r.by,
      warnings: r.warnings ?? [], unwritable: r.unwritable === true,
    };
  }

  /**
   * Drop the live 更新公告: every client falls back to the revision built into its bundle. Not rate limited — putting
   * the shipped notes back is always safe.
   * @returns {{ ok: true, cleared: true, unwritable: boolean } | { ok: false, error: string, message: string }}
   */
  clearNotes() {
    if (!this.enabled) return { ok: false, error: 'DISABLED', message: 'admin API is disabled' };
    if (!this.notesStore) return { ok: false, error: 'DISABLED', message: 'notes store is not configured' };
    const stored = this.notesStore.clear();
    this.log.info?.('[admin] 更新公告已清空（回落到内置公告）');
    return { ok: true, cleared: true, unwritable: stored !== true };
  }
}
