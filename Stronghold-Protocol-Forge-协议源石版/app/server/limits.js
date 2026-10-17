// server/limits.js — the live capacity limit an operator changes from the panel.
//
// WHY THIS EXISTS. Every capacity cap on this server is either a module default or an `SP_*` environment variable
// (server/http/config.js), and both are read ONCE at boot by a process the operator can only restart. So the one knob
// an operator reaches for during a busy evening — 「how many players will this box take」 — was unreachable without a
// blue-green deploy. The owner asked for it to be editable from the panel (2026-10-14
// 「增加可以修改（服务器后端修改）的服务器最大人数限制」).
//
// WHAT IT COUNTS — the owner chose this when asked, before the code was written: EVERY OPEN WEBSOCKET
// (`Network.conns.size`). A socket that has not said hello yet counts; so does a spectator seat. The alternative was
// 「seated humans only」, which is friendlier but lets an unbounded number of sockets reach the process — and the limit
// exists to protect THIS box, which pays for a socket the moment it is accepted, not when it sits down.
//
// LOWERING NEVER KICKS — also the owner's decision. Setting the cap below the current count refuses NEW sockets and
// lets the ones already here finish. Ending live matches to fit a number is the one outcome an operator lowering a
// limit must never get by accident.
//
// 0 IS NOT "UNLIMITED" HERE, and that is deliberate. `maxConnections` is compared as `conns.size >= cap`, so a 0 would
// refuse everybody (every count is >= 0). That is the existing meaning of the option and this file does not change it.
// The panel's way to say 「不限制」 is `null`, which drops the override and falls back to the boot-time option — and the
// per-address cap (`maxConnectionsPerAddr`, 64 per network) still applies in every case, so "unlimited" is never
// really unbounded.
//
// PER PROCESS, AND THAT IS NOT A BUG. A deployment runs two slots (blue-green, DEPLOY.md §2) sharing ONE limits file,
// so during the overlap both slots enforce the same number against their OWN socket count. In practice only one slot
// serves `:80` at a time (the other is draining), so the ceiling the operator sees is the one they set; the panel
// reports both slots' counts so an overlap is visible rather than hidden.

/** The stored document's schema version. A future shape bumps it and the reader ignores what it does not know. */
export const LIMITS_VERSION = 1;

/**
 * Bounds of the cap. The floor is 1 because 0 has the "refuse everybody" meaning above; the ceiling is a sanity guard
 * against a slipped keystroke (`100000` sockets on a 2-core box is already far past what it can carry, but the point
 * of a ceiling here is to catch `10000000`, not to be the real capacity answer).
 */
export const MAX_CONNECTIONS_FLOOR = 1;
export const MAX_CONNECTIONS_CEILING = 100_000;

/**
 * 人机（AI 队友）两个上限的界。**0 在这里是「不限制」** —— 与上游 LOBBY_DEFAULTS.maxBots 同一套语义
 * （业主 2026-10-16 要求把这条限制搬过来）：人机数是「最多几个」，而运维想表达的「不设限」需要一个写法。
 * 注意这与上面 maxConnections 的 0 不是一回事（那边 0 是「谁都不许连」，所以地板是 1）—— 两者各自写清楚。
 */
export const MAX_BOTS_FLOOR = 0;
export const MAX_BOTS_CEILING = 1000;

/**
 * A cap coming off the wire or off the disk: an integer inside the bounds, or `null` for 「no override · 不限制」.
 * Strict on purpose — a typo must leave the previous limit in force, never become `NaN` (which every `>=` accepts) or
 * a string that compares oddly.
 * @param {unknown} raw
 * @returns {{ ok: true, value: number | null } | { ok: false, error: 'BAD_VALUE' | 'OUT_OF_RANGE' }}
 */
export function normalizeMaxConnections(raw) {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw)) return { ok: false, error: 'BAD_VALUE' };
  if (raw < MAX_CONNECTIONS_FLOOR || raw > MAX_CONNECTIONS_CEILING) return { ok: false, error: 'OUT_OF_RANGE' };
  return { ok: true, value: raw };
}

/**
 * Validate a whole stored document (the file is outside the trust boundary: hand-edited, truncated by a full disk,
 * written by a future version). An unknown extra key is not an error — this reader only claims the keys it knows.
 *
 * A MISSING `maxConnections` KEY IS AN ERROR, not 「不限制」. That distinction is the whole reason this function is not
 * just `normalizeMaxConnections(doc.maxConnections)`: `undefined` and an explicit `null` both mean 「no override」 to the
 * value parser, so a truncated or hand-mangled `{}` would otherwise be read as the operator asking for no ceiling —
 * silently widening the server's admission the moment a file gets clobbered. A real 「不限制」 is written as
 * `{"maxConnections":null}`, which this accepts.
 * @param {unknown} doc
 * @returns {{ ok: true, maxConnections: number | null } | { ok: false, error: string }}
 */
/**
 * 同上的解析，但**0 合法**（= 不限制）。`null` / `undefined` = 没设过（跟随启动参数）。
 * @param {unknown} raw
 * @returns {{ ok: true, value: number | null } | { ok: false, error: 'BAD_VALUE' | 'OUT_OF_RANGE' }}
 */
export function normalizeMaxBots(raw) {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw)) return { ok: false, error: 'BAD_VALUE' };
  if (raw < MAX_BOTS_FLOOR || raw > MAX_BOTS_CEILING) return { ok: false, error: 'OUT_OF_RANGE' };
  return { ok: true, value: raw };
}

export function normalizeLimits(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, error: 'BAD_DOC' };
  if (!('maxConnections' in doc)) return { ok: false, error: 'MISSING_VALUE' };
  const r = normalizeMaxConnections(doc.maxConnections);
  if (!r.ok) return { ok: false, error: r.error };
  // 人机那两格**可以缺**：缺 = 没设过（跟随启动参数），不是错误 —— 与 maxConnections 必须显式写出不同，
  // 因为后者的「缺」会让一个被写坏的文件悄悄放开人数门，而人机的「缺」只是回到启动参数，不会放宽任何东西。
  const b = normalizeMaxBots(doc.maxBots);
  if (!b.ok) return { ok: false, error: b.error };
  const p = normalizeMaxBots(doc.maxBotsPerRoom);
  if (!p.ok) return { ok: false, error: p.error };
  return { ok: true, maxConnections: r.value, maxBots: b.value, maxBotsPerRoom: p.value };
}

/**
 * The limit in force IN THIS PROCESS, and where it came from.
 *
 * TWO STATES, AND ONLY TWO. `overridden: false` means no panel value is in effect, so the boot-time option
 * (`SP_MAX_CONNECTIONS`, or net.js's own default) is what is enforced. `overridden: true` means the panel set a number
 * and that number is what is enforced.
 *
 * 「不限制」 IS EXPRESSED AS CLEARING, NOT AS A THIRD STATE. An operator who wants the server back the way the deploy
 * configured it sets the panel back to 「跟随启动参数」; `cap()` then returns the boot value. There is deliberately no
 * 「unlimited」 mode: `maxConnections` is compared as `conns.size >= cap`, so an "unlimited" that were spelled 0 would
 * refuse everybody, and spelling it `null` would be a genuine widening past what the deployment's own environment asked
 * for. The boot default (2000) is already far beyond what a 2-core box can carry, and the per-address cap (64 per
 * network) still applies — so nothing is gained by a third state and an incident is risked.
 */
export class LiveLimits {
  constructor() {
    /** @type {number | null} the panel's cap; null = no panel value in effect */
    this.maxConnections = null;
    /** @type {number | null} 全服人机上限（0 = 不限制）；null = 没有面板值在生效 */
    this.maxBots = null;
    /** @type {number | null} 每个房间的人机上限（0 = 不限制）；null = 没有面板值在生效 */
    this.maxBotsPerRoom = null;
    /** @type {boolean} whether a panel value is currently in force */
    this.overridden = false;
    /** @type {boolean} 人机那两格各自有没有面板值在生效 */
    this.overriddenBots = false;
    this.overriddenBotsPerRoom = false;
    /** @type {boolean} whether the panel has ever written this process's value (set-or-cleared) */
    this.touched = false;
    /** @type {number | null} when the panel last wrote (ms epoch), for 「什么时候改的」 */
    this.at = null;
    /** @type {string | null} who wrote it (the panel's client address) */
    this.by = null;
  }

  /**
   * Adopt a stored document. `null` (no file yet / unreadable) leaves the live values ALONE — the same rule as the ban
   * list and the announcement: a disk that cannot be read is not an instruction to change the limit.
   * @param {{ maxConnections: number | null, at?: number | null, by?: string | null } | null} limits
   * @returns {boolean} whether anything was adopted
   */
  adopt(limits) {
    if (!limits) return false;
    const r = normalizeMaxConnections(limits.maxConnections);
    if (!r.ok) return false;
    this.maxConnections = r.value;
    // A stored `null` means「已经清掉了覆盖」, so nothing is overridden — the boot value applies again.
    this.overridden = r.value != null;
    // 人机那两格：**键在就采纳**（哪怕值是 null = 已清除），键不在就一个字节都不动。
    if ('maxBots' in limits) {
      const rb = normalizeMaxBots(limits.maxBots);
      if (rb.ok) { this.maxBots = rb.value; this.overriddenBots = rb.value != null; }
    }
    if ('maxBotsPerRoom' in limits) {
      const rp = normalizeMaxBots(limits.maxBotsPerRoom);
      if (rp.ok) { this.maxBotsPerRoom = rp.value; this.overriddenBotsPerRoom = rp.value != null; }
    }
    this.touched = true;
    this.at = Number.isFinite(limits.at) ? Number(limits.at) : null;
    this.by = typeof limits.by === 'string' && limits.by ? limits.by : null;
    return true;
  }

  /**
   * The cap to enforce right now, given the boot-time option: the panel's number when one is in force, otherwise the
   * boot-time option. `null` means 「no ceiling」 and only the caller's own option can produce it.
   * @param {number} bootValue
   * @returns {number | null}
   */
  cap(bootValue) {
    return this.overridden ? this.maxConnections : bootValue;
  }

  /**
   * Set the limit in THIS process immediately (the panel's own slot must not wait for the next poll of its own file).
   * @param {number | null} value already normalized; null clears the override
   * @param {{ at?: number, by?: string | null }} [meta]
   */
  set(value, { at = null, by = null } = {}) {
    this.maxConnections = value;
    this.overridden = value != null;
    this.touched = true;
    this.at = Number.isFinite(at) ? at : null;
    this.by = by ?? null;
  }

  /**
   * 人机的两个上限，与 `cap()` 同一套「面板值优先、否则启动参数」的规矩。
   * `0` 是**不限制**（不是「谁都不许」—— 见 MAX_BOTS_FLOOR 的注释）。
   * @param {number|null} bootValue @returns {number|null}
   */
  botsCap(bootValue) { return this.overriddenBots ? this.maxBots : bootValue; }
  /** 每个房间的人机上限，同上。 */
  botsPerRoomCap(bootValue) { return this.overriddenBotsPerRoom ? this.maxBotsPerRoom : bootValue; }

  /**
   * 面板设全服人机上限（本进程立即生效，另一个槽一次轮询内跟上）。`null` = 清除覆盖（跟随启动参数）。
   * @param {number | null} value 已归一化 @param {{ at?: number, by?: string | null }} [meta]
   */
  setBots(value, { at = null, by = null } = {}) {
    this.maxBots = value;
    this.overriddenBots = value != null;
    this.touched = true;
    if (Number.isFinite(at)) this.at = at;
    if (by != null) this.by = by;
  }

  /** 面板设每房间人机上限，同上。 */
  setBotsPerRoom(value, { at = null, by = null } = {}) {
    this.maxBotsPerRoom = value;
    this.overriddenBotsPerRoom = value != null;
    this.touched = true;
    if (Number.isFinite(at)) this.at = at;
    if (by != null) this.by = by;
  }

  /** What the panel shows for this process. */
  status(bootValue, { botBoot = null, perRoomBoot = null } = {}) {
    return {
      maxConnections: this.cap(bootValue),
      overridden: this.overridden,
      touched: this.touched,
      bootMaxConnections: bootValue,
      // 人机那两格（业主 2026-10-16）
      maxBots: this.botsCap(botBoot),
      maxBotsPerRoom: this.botsPerRoomCap(perRoomBoot),
      overriddenBots: this.overriddenBots,
      overriddenBotsPerRoom: this.overriddenBotsPerRoom,
      bootMaxBots: botBoot,
      bootMaxBotsPerRoom: perRoomBoot,
      at: this.at,
      by: this.by,
    };
  }
}
