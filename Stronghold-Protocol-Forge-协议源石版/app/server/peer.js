// server/peer.js — 「另一个槽」的回环探测（蓝绿部署的观测面，DEPLOY.md §8.4）。
//
// WHY THIS FILE EXISTS. The live deployment is two Node processes behind one nginx (`sp-release.sh`): slot A on
// 127.0.0.1:3000, slot B on 127.0.0.1:3001, and nginx points :80 at exactly ONE of them. Both bind loopback only, so
// a browser reaching :80 can see the ACTIVE slot and nothing else — which is precisely the moment an operator needs to
// know "is the other one still up? is it still draining? can I stop it?". (2026-10-13: the retired slot sat there
// holding 227 MB of memory and 9 unrecoverable sessions, and nobody could see it.) The panel can only answer that from
// the SERVER side, because only the server sits on the same loopback.
//
// WHY THE ADMIN API AND NOT /healthz. /healthz is public and answers the counters an operator wants here (sockets,
// sessions, rooms, matches, humans, bots, spectators, build) — but it does NOT say whether the responder is the active
// slot or the idle one, and it is exactly the endpoint a reverse proxy may cache. The peer's own admin API is the
// better probe when it can be reached: it reports `port`, `host`, the same counters, and its own view of which slot
// it is. The ADMIN_SECRET is NOT required for it and never leaves this process — see `probePeer` below for why the
// shared env file makes a token unnecessary AND why we still do not send one.
//
// NOTHING HERE IS ON A HOT PATH. One probe is one TCP connect + one small JSON response, bounded by a hard timeout,
// and the result is CACHED for PEER_CACHE_MS. A peer that is down costs one refused connection per cache window
// (sub-millisecond on loopback), never one per panel poll. The probe is also entirely optional: with no peer
// configured (the default) `getSlots()` reports a single slot and the panel's section hides itself.

import http from 'node:http';
import os from 'node:os';

/**
 * Default ports of the two blue-green slots (`05-部署/stronghold-{a,b}.service`, PORT_A / PORT_B in sp-release.sh).
 * Fixed rather than discovered: the deployment's own release script hard-codes them, and guessing a port range would
 * probe unrelated services on a shared box.
 */
export const SLOT_PORTS = Object.freeze({ a: 3000, b: 3001 });

/** How long a probe result is reused (ms). The panel polls every 2 s; the peer cannot change meaningfully faster. */
export const PEER_CACHE_MS = 5000;

/** Hard timeout of one probe (ms). Loopback answers in well under a millisecond when it is up at all. */
export const PEER_TIMEOUT_MS = 1500;

/** Cap of the peer's response body we are willing to read (bytes) — an overview is a few KB. */
const PEER_BODY_MAX = 256 * 1024;

/**
 * The slot this process is (`a` / `b`) and the peer to look for, out of the environment.
 *
 * Two ways to set it, in order:
 *   * `SP_SLOT` = `a` or `b` — the honest one, set in the systemd unit beside PORT (【推荐】);
 *   * otherwise the PORT is matched against SLOT_PORTS (3000 → a, 3001 → b), which needs no new configuration on the
 *     live box at all.
 *
 * `SP_PEER_PORT` / `SP_PEER_HOST` override the peer's address outright (a slot with a non-standard port, a test).
 * With neither an identifiable own slot nor an explicit peer, there is NO peer: the panel shows one slot and says so,
 * rather than probing a port that might belong to something else.
 *
 * @param {{ env?: NodeJS.ProcessEnv, port?: number }} [opts]
 * @returns {{ name: string, identified: boolean, port: number | null, peerName: string | null, peerPort: number | null, peerHost: string, source: string }}
 *   `name` is always a display label ('a' / 'b', or 'this' when neither SP_SLOT nor the port identified the process);
 *   `identified` is the one a caller must test before reporting a slot to anyone else — the label 'this' is not a slot.
 */
export function slotFromEnv({ env = process.env, port } = {}) {
  const raw = String(env.SP_SLOT || '').trim().toLowerCase();
  const own = ['a', 'b'].includes(raw) ? raw : null;
  const ownPort = Number.isInteger(port) ? port : (Number(env.PORT) || null);

  // Which slot is this? An explicit SP_SLOT first; else the port, when it is exactly the deployment's own.
  let name = own;
  if (!name && ownPort != null) {
    for (const [slot, p] of Object.entries(SLOT_PORTS)) if (p === ownPort) name = slot;
  }

  const explicitPeer = Number(env.SP_PEER_PORT);
  if (Number.isInteger(explicitPeer) && explicitPeer > 0) {
    // An explicit peer works even when this process cannot identify its own slot (a test, a non-standard layout).
    return {
      name: name || 'this',
      identified: name != null,
      port: ownPort,
      peerName: explicitPeer === SLOT_PORTS.a ? 'a' : explicitPeer === SLOT_PORTS.b ? 'b' : 'peer',
      peerPort: explicitPeer,
      peerHost: String(env.SP_PEER_HOST || '127.0.0.1'),
      source: 'SP_PEER_PORT',
    };
  }
  if (!name) {
    return { name: 'this', identified: false, port: ownPort, peerName: null, peerPort: null, peerHost: '127.0.0.1', source: 'none' };
  }
  const peerName = name === 'a' ? 'b' : 'a';
  return { name, identified: true, port: ownPort, peerName, peerPort: SLOT_PORTS[peerName], peerHost: '127.0.0.1', source: own ? 'SP_SLOT' : 'PORT' };
}

/**
 * The three counters a live slot reports, out of whatever body it answered with. Tolerant on purpose: the peer may be
 * an older build (`build` only), a newer one, or a /healthz answer rather than an overview.
 * @param {any} body
 */
function readCounters(body) {
  if (!body || typeof body !== 'object') return null;
  const version = body.version && typeof body.version === 'object' ? body.version : body;
  return {
    build: typeof version.build === 'string' ? version.build : null,
    app: typeof version.app === 'string' ? version.app : null,
    node: typeof version.node === 'string' ? version.node : null,
    uptimeSec: Number.isFinite(Number(body.uptimeSec)) ? Math.round(Number(body.uptimeSec)) : null,
    sockets: Number.isFinite(Number(body.sockets)) ? Number(body.sockets) : null,
    sessions: Number.isFinite(Number(body.sessions)) ? Number(body.sessions) : null,
    rooms: Number.isFinite(Number(body.rooms)) ? Number(body.rooms) : null,
    matches: Number.isFinite(Number(body.matches)) ? Number(body.matches) : null,
    humans: Number.isFinite(Number(body.humans)) ? Number(body.humans) : null,
    bots: Number.isFinite(Number(body.bots)) ? Number(body.bots) : null,
    spectators: Number.isFinite(Number(body.spectators)) ? Number(body.spectators) : null,
    processRssMb: Number.isFinite(Number(body.system?.processRssMb)) ? Number(body.system.processRssMb) : null,
  };
}

/**
 * One GET to the peer's admin overview, falling back to its public /healthz.
 *
 * WHY /api/admin/overview FIRST, WITH the token when the caller has one. The two slots read the SAME environment file
 * (`EnvironmentFile=-/etc/stronghold.env` in both units), so the peer holds the same ADMIN_SECRET — and the admin
 * overview is the richer document: it carries the process RSS, which is the whole reason this probe exists (a retired
 * slot once sat on 227 MB that nobody could see). The token is passed in by the CALLER (AdminService.getSlots hands
 * over the very secret it already holds) rather than read here, so this module never touches the environment for it.
 *
 * A 401 (the peer runs without the same secret) or a 404 (it runs without any) falls back to the public /healthz,
 * which is uncached (`Cache-Control: no-store`) and carries the counters — just not the memory figure. Both paths are
 * loopback-only: this request never leaves the machine, and it is the same machine's own secret going to the same
 * machine's other process.
 *
 * NOTHING IS TRUSTED FROM THE PEER: the body is parsed defensively, size-capped, and only known numeric/string fields
 * are copied out. The peer is another instance of this same program, but it may be an older or a newer build, and a
 * half-deployed one answering garbage must not break the panel.
 *
 * @param {{ host: string, port: number, timeoutMs?: number, agent?: import('node:http').Agent, token?: string|null }} target
 * @returns {Promise<{ ok: true, via: string, counters: object, slot: string|null } | { ok: false, error: string }>}
 */
export function probePeer({ host, port, timeoutMs = PEER_TIMEOUT_MS, agent, token = null }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; resolve(r); } };
    /** @param {string} path @param {string} via @param {(status: number, body: any) => void} then */
    const get = (path, via, then) => {
      let req;
      const headers = { accept: 'application/json' };
      // The bearer token is only ever added for the admin path by the caller's own choice (see above).
      if (via === 'admin' && typeof token === 'string' && token) headers.authorization = `Bearer ${token}`;
      try {
        req = http.request({ host, port, path, method: 'GET', agent, headers }, (res) => {
          const chunks = [];
          let size = 0;
          res.on('data', (c) => {
            size += c.length;
            if (size > PEER_BODY_MAX) { res.destroy(); finish({ ok: false, error: 'too-large' }); return; }
            chunks.push(c);
          });
          res.on('end', () => {
            let body = null;
            try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* 非 JSON：当作空，交给 then */ }
            then(res.statusCode || 0, body);
          });
          res.on('error', () => finish({ ok: false, error: 'reset' }));
        });
      } catch (e) {
        finish({ ok: false, error: e?.code || 'request-failed' });
        return;
      }
      req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
      req.on('error', (e) => finish({ ok: false, error: e?.code || e?.message || 'error' }));
      req.end();
    };

    get('/api/admin/overview', 'admin', (status, body) => {
      if (status === 200 && body) {
        const counters = readCounters(body);
        if (counters) return finish({ ok: true, via: 'admin', counters, slot: null });
      }
      // 401 (surface enabled, token not sent), 404 (no ADMIN_SECRET), or an unreadable body → the public status.
      get('/healthz', 'healthz', (s2, b2) => {
        const counters = readCounters(b2);
        // `slotName` is what /healthz reports (server/http/routes.js healthReport): 'a' / 'b', or absent when the
        // process could not identify its own slot.
        if (s2 === 200 && counters) return finish({ ok: true, via: 'healthz', counters, slot: typeof b2.slotName === 'string' ? b2.slotName : null });
        finish({ ok: false, error: `http-${s2 || status || 0}` });
      });
    });
  });
}

/**
 * The 蓝绿 slot view of one server: itself (always) and its peer (when one is configured and answers).
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv, port?: number, self: object, now?: () => number,
 *   timeoutMs?: number, cacheMs?: number, fetchImpl?: typeof probePeer,
 * }} opts
 *   self: the counters of THIS process (the same shape probePeer returns), so both slots are read the same way.
 *   fetchImpl: the probe, injectable so a test drives a peer that is up / down / slow without a real socket.
 */
export function createSlotProbe({ env = process.env, port, self, now = Date.now, timeoutMs = PEER_TIMEOUT_MS, cacheMs = PEER_CACHE_MS, fetchImpl = probePeer, token = null } = {}) {
  const cfg = slotFromEnv({ env, port });
  /** @type {{ at: number, value: object } | null} */
  let cache = null;

  /** The peer's last known state, never throwing and never waiting longer than the probe's own timeout. */
  async function peerState() {
    if (cfg.peerPort == null) return { configured: false, up: false, error: null, counters: null, via: null };
    const t = now();
    if (cache && cacheMs > 0 && t - cache.at < cacheMs) return cache.value;
    let value;
    try {
      const r = await fetchImpl({ host: cfg.peerHost, port: cfg.peerPort, timeoutMs, token });
      value = r.ok
        ? { configured: true, up: true, error: null, counters: r.counters, via: r.via }
        : { configured: true, up: false, error: r.error || 'unreachable', counters: null, via: null };
    } catch (e) {
      value = { configured: true, up: false, error: e?.code || e?.message || 'error', counters: null, via: null };
    }
    cache = { at: t, value };
    return value;
  }

  return {
    /** The resolved slot layout (for logs and for the panel's own labels). */
    config: cfg,
    /** Invalidate the cached probe (a test, or a caller that just changed the deployment). */
    reset() { cache = null; },
    /**
     * Both slots, the way the panel shows them.
     * @returns {Promise<{ self: object, peer: object, slots: object[], peerConfigured: boolean, source: string }>}
     */
    async getSlots() {
      const peer = await peerState();
      /** The hostname of the box, so two deployments behind one domain are told apart in a screenshot. */
      let hostname = null;
      try { hostname = os.hostname(); } catch { /* a sandbox without /etc/hostname: the field stays null */ }
      const selfSlot = {
        name: cfg.name,
        active: true,
        reachable: true,
        via: 'self',
        port: cfg.port ?? null,
        counters: self,
        hostname,
      };
      const peerSlot = peer.configured
        ? {
          name: cfg.peerName,
          active: false,           // this process serves the request, so IT is the active one by construction
          reachable: peer.up,
          via: peer.via,
          port: cfg.peerPort,
          error: peer.error,
          counters: peer.counters,
          hostname: null,
        }
        : null;
      return {
        self: selfSlot,
        peer: peerSlot,
        slots: peerSlot ? [selfSlot, peerSlot] : [selfSlot],
        peerConfigured: peer.configured,
        source: cfg.source,
      };
    },
  };
}
