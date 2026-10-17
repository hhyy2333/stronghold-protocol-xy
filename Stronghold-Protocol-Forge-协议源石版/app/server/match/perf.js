// server/match/perf.js — per-match wall-clock accounting, for the admin panel's per-room cost view.
//
// WHY HERE. The server is one process on one thread: every room's battles, bots and message handling share the same
// event loop, so "which room is eating the CPU" is the only question an operator can act on, and a process-wide CPU
// gauge cannot answer it. This module attributes wall-clock time to the room that spent it.
//
// WHY THIS SHAPE. The match already funnels its synchronous work through a handful of entry points — MatchInfra.guard
// (every scheduler callback: the 30 Hz field pump, bot prep slices, phase timers), MatchPlatform.handle (player
// messages), and the places a battle is actually stepped (FieldRunner._tick, a bot's layout rehearsal, SP_VERIFY, a
// server run / takeover). Tagging those is enough to partition the time: no profiler, no sampling, no new thread, and
// nothing that can change what the simulation computes — this module reads a clock and nothing else.
//
// THE STACK. begin(bucket)/end() nest; a frame's own time is its elapsed wall time minus the time its children already
// claimed, so the buckets PARTITION the measured total exactly (Σ buckets == totalMs, never double counted). A bucket
// that is never entered costs nothing, and a nest that is never tagged still lands in its parent.
//
// [ASSUMED] `performance.now()` when the host has it, `Date.now()` otherwise — the same choice MatchPrep.scheduleBotPrep
// already makes. The numbers are wall-clock time spent on this thread inside a tagged frame. For a synchronous frame
// that is also CPU time, which is what an operator wants; it is not OS-level CPU accounting (no GC on other threads,
// no time the room spent waiting on the network).
//
// This module is deliberately free of Node APIs and imports nothing: measurement must never be able to fail a match.

/** Monotonic-ish clock. `performance.now` is monotonic; `Date.now` is not, which is why elapsed is clamped at 0. */
const defaultNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

const round2 = (v) => Math.round(v * 100) / 100;

let seq = 0;

/**
 * The bucket keys, and what each one means. The panel maps them to labels (public/admin/admin.js); the wire keeps ids.
 *
 *   battle     stepping a server-run field's battles (FieldRunner._tick)
 *   bots       a bot seat's prep and its layout rehearsal (whole simulated battles — the known CPU sink)
 *   verify     SP_VERIFY re-simulating a client's report
 *   serverRun  a takeover / no-human field run on the server (clientCombat _runOnServer)
 *   intents    a player's g.* / b.* message (MatchPlatform.handle)
 *   views      building and flushing m.public / m.private
 *   core       everything else a match does inside a scheduler callback (phase machine, drafts, economy, prep)
 *
 * @type {readonly string[]}
 */
export const PERF_BUCKETS = Object.freeze(['battle', 'bots', 'verify', 'serverRun', 'intents', 'views', 'core']);

/** Bucket of a key that was never entered (so a snapshot always has every key, in a stable order). */
const zeroBuckets = () => {
  /** @type {Record<string, number>} */
  const out = {};
  for (const k of PERF_BUCKETS) out[k] = 0;
  return out;
};

/**
 * Measure `fn` as `bucket` on `owner`'s counter, doing nothing extra when `owner` has none. Call sites in the match
 * engine use this so a Match built by an older tool, a stripped-down fixture or a stub can never be broken by
 * instrumentation — measurement is always optional, the game never is.
 * @template T
 * @param {{ perf?: MatchPerf }} owner
 * @param {string} bucket
 * @param {() => T} fn
 * @returns {T}
 */
export function measureOn(owner, bucket, fn) {
  const perf = owner && owner.perf;
  return perf && typeof perf.measure === 'function' ? perf.measure(bucket, fn) : fn();
}

/**
 * Wall-clock accounting of one match. One instance per Match (`m.perf`); `snapshot()` is what the admin API reads.
 *
 * Everything is cumulative since the match was constructed. A RATE is the admin service's business: it keeps the
 * previous reading per room and divides by the wall-clock gap (server/admin.js `_matchPerf`), so this object stays a
 * pure, stateless-to-readers counter — a second reader never disturbs the first one's window.
 */
export class MatchPerf {
  /** @param {{ now?: () => number }} [opts] `now` is injectable so a test can drive elapsed time without sleeping. */
  constructor({ now = defaultNow } = {}) {
    /** Identity of this counter: a NEW match in a reused room code has a new id, which is how the caller knows the
     *  totals restarted and must not be differenced against the previous match's. */
    this.id = ++seq;
    this._now = typeof now === 'function' ? now : defaultNow;
    this.startedAt = this._now();
    /** Sum of every top-level frame's elapsed ms (== the sum of `byBucket`). */
    this.totalMs = 0;
    /** Frames entered (a cheap "is anything happening at all" signal). */
    this.frames = 0;
    /** Deepest nesting seen: 1 = untagged work, 2 = one tagged bucket inside another. */
    this.maxDepth = 0;
    /** @type {Record<string, number>} exclusive ms per bucket */
    this.byBucket = zeroBuckets();
    /** @type {{ bucket: string, t0: number, child: number }[]} */
    this._stack = [];
  }

  /** Nesting depth (0 = nothing being measured right now). */
  get depth() { return this._stack.length; }

  /**
   * Open a frame in `bucket`. Returns the frame; it must be handed back to `end` (use `measure` unless the region
   * cannot be expressed as a callback).
   * @param {string} bucket
   */
  begin(bucket) {
    const frame = { bucket, t0: this._now(), child: 0 };
    this._stack.push(frame);
    if (this._stack.length > this.maxDepth) this.maxDepth = this._stack.length;
    return frame;
  }

  /**
   * Close a frame opened by `begin`. Time already claimed by nested frames is subtracted, and the full elapsed is
   * charged to the parent so the parent can subtract it in turn — which is what keeps the buckets a partition.
   * @param {{ bucket: string, t0: number, child: number }|null} frame
   */
  end(frame) {
    if (!frame) return;
    // Only the top frame may close: a mismatched pair would corrupt the partition, so it is ignored (never thrown).
    const top = this._stack[this._stack.length - 1];
    if (top !== frame) return;
    this._stack.pop();
    const elapsed = Math.max(0, this._now() - frame.t0);
    const own = Math.max(0, elapsed - frame.child);
    if (this.byBucket[frame.bucket] === undefined) this.byBucket[frame.bucket] = 0;
    this.byBucket[frame.bucket] += own;
    this.frames++;
    const parent = this._stack[this._stack.length - 1];
    if (parent) parent.child += elapsed;
    else this.totalMs += elapsed; // a top-level frame: its full elapsed is the measured total
  }

  /**
   * Measure `fn` as `bucket` and return its result. `finally` guarantees the frame closes (and the time is still
   * charged) when the wrapped work throws — a crashing field must not silently vanish from the accounting.
   * @template T
   * @param {string} bucket
   * @param {() => T} fn
   * @returns {T}
   */
  measure(bucket, fn) {
    const frame = this.begin(bucket);
    try { return fn(); } finally { this.end(frame); }
  }

  /** Elapsed seconds since the match's perf counter was created (what the panel's rate divides by). */
  uptimeSec() { return Math.max(0, (this._now() - this.startedAt) / 1000); }

  /**
   * A plain, JSON-safe reading. Every bucket key is present (0 when unused) so the panel can render a stable column
   * set, and `totalMs` always equals the sum of `byBucket` — a reader may assert that.
   */
  snapshot() {
    /** @type {Record<string, number>} */
    const buckets = {};
    let accounted = 0;
    for (const k of PERF_BUCKETS) {
      const v = round2(this.byBucket[k] || 0);
      buckets[k] = v;
      accounted += v;
    }
    // Only reachable if a frame is still open when the snapshot is taken (a poll landing mid-callback): report the
    // in-flight time under its own bucket rather than losing it. The reading stays self-consistent.
    const open = this._stack.length;
    return {
      id: this.id,
      uptimeSec: Math.round(this.uptimeSec() * 10) / 10,
      totalMs: round2(this.totalMs),
      frames: this.frames,
      maxDepth: this.maxDepth,
      openFrames: open,
      buckets,
      accountedMs: round2(accounted),
    };
  }
}
