// test/admin.test.js — the read-only admin API (server/admin.js, routed by server/http/routes.js).
//
// Boots real servers in-process on random ports (startServer({ port: 0 })), like test/lobby.test.js. The two things
// worth more than the happy path are the security ones: with no ADMIN_SECRET the surface must not exist at all (404,
// not 401), and repeated wrong tokens must actually lock a client address out.

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { startServer, AdminService, recordAdminLog } from '../server/index.js';
import { ADMIN_LOG_LIMIT, ADMIN_MAX_FAILURES, ADMIN_LOCKOUT_MS } from '../server/admin.js';
import { TestClient } from './helpers/wsClient.js';

// ---------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------

/** Raw HTTP request (the path is sent verbatim, no normalization). */
function httpReq(port, rawPath, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

const auth = (token) => ({ authorization: `Bearer ${token}` });
const json = (res) => JSON.parse(res.body.toString());

/** Collects log output, so a test can assert on the operator warnings. */
function captureLog() {
  const lines = { info: [], warn: [], error: [] };
  return {
    lines,
    log: {
      info: (...a) => lines.info.push(a.map(String).join(' ')),
      warn: (...a) => lines.warn.push(a.map(String).join(' ')),
      error: (...a) => lines.error.push(a.map(String).join(' ')),
    },
  };
}

const SECRET = 'test-admin-secret-0123456789abcdef';

/** The environment variable is the only default; a test must never inherit the developer's own ADMIN_SECRET. */
function withoutEnvSecret(fn) {
  const saved = process.env.ADMIN_SECRET;
  delete process.env.ADMIN_SECRET;
  return Promise.resolve()
    .then(fn)
    .finally(() => { if (saved === undefined) delete process.env.ADMIN_SECRET; else process.env.ADMIN_SECRET = saved; });
}

// ---------------------------------------------------------------------------------------------------
// disabled: no ADMIN_SECRET → the surface does not exist
// ---------------------------------------------------------------------------------------------------

describe('admin API without ADMIN_SECRET', () => {
  let srv;
  const cap = captureLog();

  before(async () => {
    // No adminSecret option and no environment variable: the stock deployment this feature must never widen.
    await withoutEnvSecret(async () => { srv = await startServer({ port: 0, host: '127.0.0.1', log: cap.log }); });
  });
  after(async () => { await srv?.close(); });

  test('every /api/admin/* path is a plain 404 — not 401, so a scanner learns nothing', async () => {
    for (const path of ['/api/admin/overview', '/api/admin/rooms', '/api/admin/logs', '/api/admin/drain', '/api/admin/']) {
      const r = await httpReq(srv.port, path);
      assert.equal(r.status, 404, path);
      assert.match(r.headers['content-type'], /^text\/html/, path);
    }
  });

  test('the token cannot make it appear, and a mutating method is not routed either', async () => {
    const withToken = await httpReq(srv.port, '/api/admin/overview', { headers: auth(SECRET) });
    assert.equal(withToken.status, 404, 'a token means nothing while the surface is off');
    const post = await httpReq(srv.port, '/api/admin/overview', { method: 'POST' });
    assert.equal(post.status, 404);
  });

  test('the service reports itself disabled and the warning says how to enable it', async () => {
    assert.equal(srv.admin.enabled, false);
    assert.equal(srv.admin.secret, null, 'never a hard-coded fallback token');
    const warned = cap.lines.warn.filter((l) => l.includes('ADMIN_SECRET'));
    assert.equal(warned.length, 1, `exactly one startup warning, got ${JSON.stringify(cap.lines.warn)}`);
    assert.match(warned[0], /404/);
    assert.match(warned[0], /disabled/i);
  });

  test('an empty ADMIN_SECRET counts as unset', async () => {
    const svc = new AdminService({ secret: '', log: { warn() {}, info() {}, error() {} } });
    assert.equal(svc.enabled, false);
    assert.equal(svc.authenticate({ headers: { authorization: 'Bearer ' } }), false);
  });

  test('/healthz and the ordinary static routes are untouched by the new admin branch', async () => {
    const health = await httpReq(srv.port, '/healthz');
    assert.equal(health.status, 200);
    assert.equal(json(health).ok, true);
    assert.equal((await httpReq(srv.port, '/admin/index.html')).status, 200, 'the static panel itself is a normal file');
  });
});

// ---------------------------------------------------------------------------------------------------
// enabled: token, views, lockout
// ---------------------------------------------------------------------------------------------------

describe('admin API with ADMIN_SECRET', () => {
  let srv;
  let client;

  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, adminSecret: SECRET });
    client = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    client.id = (await client.hello('AdminProbe')).playerId;
  });
  after(async () => {
    await client?.terminate().catch(() => {});
    await srv?.close();
  });

  test('no token → 401', async () => {
    const r = await httpReq(srv.port, '/api/admin/overview');
    assert.equal(r.status, 401);
    assert.deepEqual(json(r), { ok: false, error: 'Unauthorized' });
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers['x-content-type-options'], 'nosniff', 'the shared security headers still apply');
  });

  test('wrong token → 401, and a token in the query string is not accepted', async () => {
    assert.equal((await httpReq(srv.port, '/api/admin/overview', { headers: auth('nope') })).status, 401);
    assert.equal((await httpReq(srv.port, `/api/admin/overview?token=${SECRET}`)).status, 401);
    assert.equal((await httpReq(srv.port, '/api/admin/overview', { headers: { authorization: SECRET } })).status, 401,
      'the scheme is required');
  });

  test('correct token → 200 with the overview fields', async () => {
    const r = await httpReq(srv.port, '/api/admin/overview', { headers: auth(SECRET) });
    assert.equal(r.status, 200);
    const o = json(r);
    const C = await import('../shared/constants.js');
    assert.equal(o.version.app, C.APP_VERSION);
    // 协议源石版: 1 upstream, 2 here. Asserting the tree's own constant keeps the check meaningful under either.
    assert.equal(o.version.protocol, C.PROTOCOL_VERSION);
    assert.match(String(o.version.build), /^[0-9a-f]{12}$/, 'the served build tag');
    assert.match(o.version.node, /^v\d+/);
    assert.equal(typeof o.uptimeSec, 'number');
    for (const k of ['cpuPercent', 'cpuCount', 'loadAvg', 'processRssMb', 'heapUsedMb', 'heapTotalMb', 'systemFreeMb', 'systemTotalMb']) {
      assert.ok(k in o.system, `system.${k}`);
    }
    assert.ok(o.system.cpuPercent >= 0 && o.system.cpuPercent <= 100);
    assert.ok(Array.isArray(o.system.loadAvg) && o.system.loadAvg.length === 3);
    for (const k of ['sockets', 'sessions', 'rooms', 'matches', 'humans', 'bots', 'spectators']) {
      assert.equal(typeof o[k], 'number', k);
    }
    assert.ok(o.sockets >= 1, 'the probe socket is connected');
    assert.ok(o.sessions >= 1);
    assert.ok(o.humans >= 0 && o.bots >= 0 && o.spectators >= 0);
  });

  test('HEAD answers 200 with the headers and no body', async () => {
    const r = await httpReq(srv.port, '/api/admin/overview', { method: 'HEAD', headers: auth(SECRET) });
    assert.equal(r.status, 200);
    assert.ok(Number(r.headers['content-length']) > 0);
    assert.equal(r.body.length, 0);
  });

  test('non-GET methods are 405 with Allow, and an unknown admin path is a 404', async () => {
    const post = await httpReq(srv.port, '/api/admin/overview', { method: 'POST', headers: auth(SECRET) });
    assert.equal(post.status, 405);
    assert.equal(post.headers.allow, 'GET, HEAD');
    const del = await httpReq(srv.port, '/api/admin/rooms', { method: 'DELETE', headers: auth(SECRET) });
    assert.equal(del.status, 405);
    // The blanket method gate is unchanged: a mutating verb is refused everywhere, before any path or token is looked at.
    const postUnknown = await httpReq(srv.port, '/api/admin/drain', { method: 'POST', headers: auth(SECRET) });
    assert.equal(postUnknown.status, 405);
    assert.equal(postUnknown.headers.allow, 'GET, HEAD');
    // And the fork's mutating endpoints do not exist as readable paths either.
    assert.equal((await httpReq(srv.port, '/api/admin/drain', { headers: auth(SECRET) })).status, 404,
      'the drain endpoint of the fork is not implemented at all');
    assert.equal((await httpReq(srv.port, '/api/admin/broadcast', { headers: auth(SECRET) })).status, 404);
  });

  test('the 405 gate still covers every non-admin path', async () => {
    const r = await httpReq(srv.port, '/', { method: 'POST' });
    assert.equal(r.status, 405);
    assert.equal(r.headers.allow, 'GET, HEAD');
  });

  test('the 414 / 400 URL semantics are unchanged', async () => {
    const long = await httpReq(srv.port, `/api/admin/${'x'.repeat(4200)}`, { headers: auth(SECRET) });
    assert.equal(long.status, 414, 'length is checked before anything else');
    assert.equal((await httpReq(srv.port, `/${'y'.repeat(4200)}`)).status, 414);
  });

  test('rooms: one entry per room with seats, spectators and a match summary', async () => {
    const created = await client.request({ t: 'room.create', mode: 'coop', difficulty: 'HARD' });
    assert.equal(created.t, 'ok', JSON.stringify(created));
    const state = await client.waitFor('room.state', (s) => s.mode === 'coop');
    const code = state.code;

    const r = await httpReq(srv.port, '/api/admin/rooms', { headers: auth(SECRET) });
    assert.equal(r.status, 200);
    const rooms = json(r);
    assert.ok(Array.isArray(rooms) && rooms.length >= 1);
    const room = rooms.find((x) => x.code === code);
    assert.ok(room, `room ${code} in ${JSON.stringify(rooms)}`);
    assert.equal(room.mode, 'coop');
    assert.equal(room.difficulty, 'HARD');
    assert.equal(room.inMatch, false);
    assert.equal(room.host, client.id);
    assert.equal(room.hostName, 'AdminProbe');
    assert.equal(room.match, null);
    assert.ok(Array.isArray(room.seats) && room.seats.length === 1, 'only the host is seated');
    const seat = room.seats[0];
    // `addr` is this seat's client address (owner's request 2026-10-14: 封禁 needs to know WHAT to ban). It is the
    // same resolution the ban list matches against (net.js clientAddress), so what the panel shows is what a ban hits.
    // This client connects straight to loopback with no forwarding header, so its address IS the loopback address —
    // the normal case for a local/LAN peer (a real internet player behind nginx gets the forwarded one instead).
    assert.deepEqual(seat, {
      seat: 0, playerId: client.id, name: 'AdminProbe', isBot: false, ready: false, connected: true,
      addr: '127.0.0.1',
    });
    assert.deepEqual(room.spectators, []);
    assert.equal(typeof room.createdAt, 'number');
  });

  test('logs: a recorded entry shows up, `since` is an exclusive lower bound', async () => {
    const marker = `admin-test-marker-${Date.now()}`;
    recordAdminLog('warn', marker, { code: 'X1' });
    const all = json(await httpReq(srv.port, '/api/admin/logs', { headers: auth(SECRET) }));
    assert.ok(Array.isArray(all) && all.length > 0, 'the ring is not empty');
    const entry = all.find((e) => e.message === marker);
    assert.ok(entry, `recordAdminLog entry in ${JSON.stringify(all.slice(-3))}`);
    assert.equal(entry.level, 'warn');
    assert.deepEqual(entry.meta, { code: 'X1' });
    assert.equal(typeof entry.at, 'number');

    const future = await httpReq(srv.port, `/api/admin/logs?since=${Date.now() + 60_000}`, { headers: auth(SECRET) });
    assert.deepEqual(json(future), []);
    const garbage = await httpReq(srv.port, '/api/admin/logs?since=abc', { headers: auth(SECRET) });
    assert.equal(garbage.status, 200);
    assert.ok(json(garbage).length > 0, 'an unparseable `since` falls back to the whole ring');
  });

  test('the server logger feeds the ring (startup lines are visible to the panel)', async () => {
    const logs = json(await httpReq(srv.port, '/api/admin/logs', { headers: auth(SECRET) }));
    assert.ok(logs.some((e) => String(e.message).includes('[http]') || String(e.message).includes('[lobby]')),
      "the server's own log lines are recorded");
  });
});

// ---------------------------------------------------------------------------------------------------
// brute-force lockout (its own server: the lockout is per client address and would poison the tests above)
// ---------------------------------------------------------------------------------------------------

describe('admin brute-force lockout', () => {
  let srv;
  before(async () => { srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, adminSecret: SECRET }); });
  after(async () => { await srv?.close(); });

  test(`${ADMIN_MAX_FAILURES} wrong tokens lock the client address out for ${ADMIN_LOCKOUT_MS / 1000} s`, async () => {
    for (let i = 0; i < ADMIN_MAX_FAILURES; i++) {
      const r = await httpReq(srv.port, '/api/admin/overview', { headers: auth(`wrong-${i}`) });
      assert.equal(r.status, 401, `failure ${i + 1}`);
    }
    // Locked out: even the CORRECT token is refused, and the answer is the same flat 401 (never a "you are throttled").
    const locked = await httpReq(srv.port, '/api/admin/overview', { headers: auth(SECRET) });
    assert.equal(locked.status, 401);
    assert.deepEqual(json(locked), { ok: false, error: 'Unauthorized' });
    assert.equal(srv.admin.isLockedOut({ socket: { remoteAddress: '127.0.0.1' }, headers: {} }), true);
  });
});

describe('admin service (unit)', () => {
  const quiet = { warn() {}, info() {}, error() {} };

  test('timingSafeEqual needs equal lengths — a length mismatch is a plain false, never a throw', () => {
    const svc = new AdminService({ secret: SECRET, log: quiet });
    assert.equal(svc.tokenMatches(SECRET), true);
    assert.equal(svc.tokenMatches(SECRET.slice(0, -1)), false);
    assert.equal(svc.tokenMatches(`${SECRET}x`), false);
    assert.equal(svc.tokenMatches(''), false);
    assert.equal(svc.tokenMatches('a'.repeat(SECRET.length)), false, 'same length, different bytes');
  });

  test('the lockout is driven by the injected clock, not by the wall clock', () => {
    let now = 1_000_000;
    const svc = new AdminService({ secret: SECRET, log: quiet, now: () => now, maxFailures: 3, lockoutMs: 5_000 });
    const req = (token) => ({ socket: { remoteAddress: '203.0.113.9' }, headers: { authorization: `Bearer ${token}` } });

    assert.equal(svc.authenticate(req('bad')), false);
    assert.equal(svc.authenticate(req('bad')), false);
    assert.equal(svc.isLockedOut(req('bad')), false, 'below the threshold');
    assert.equal(svc.authenticate(req('bad')), false, 'the third failure trips it');
    assert.equal(svc.isLockedOut(req(SECRET)), true);

    now += 4_999;
    assert.equal(svc.authenticate(req(SECRET)), false, 'still inside the window');
    now += 2;
    assert.equal(svc.authenticate(req(SECRET)), true, 'the window closed');
  });

  test('a good token clears the run of failures', () => {
    const svc = new AdminService({ secret: SECRET, log: quiet, maxFailures: 3, lockoutMs: 5_000 });
    const req = (token) => ({ socket: { remoteAddress: '203.0.113.10' }, headers: { authorization: `Bearer ${token}` } });
    assert.equal(svc.authenticate(req('bad')), false);
    assert.equal(svc.authenticate(req('bad')), false);
    assert.equal(svc.authenticate(req(SECRET)), true);
    assert.equal(svc.authenticate(req('bad')), false);
    assert.equal(svc.isLockedOut(req(SECRET)), false, 'the counter restarted: 1 failure, not 3');
  });

  test('two addresses do not share a counter', () => {
    const svc = new AdminService({ secret: SECRET, log: quiet, maxFailures: 2, lockoutMs: 5_000 });
    const req = (ip, token) => ({ socket: { remoteAddress: ip }, headers: { authorization: `Bearer ${token}` } });
    assert.equal(svc.authenticate(req('198.51.100.1', 'bad')), false);
    assert.equal(svc.authenticate(req('198.51.100.1', 'bad')), false);
    assert.equal(svc.isLockedOut(req('198.51.100.1', SECRET)), true);
    assert.equal(svc.authenticate(req('198.51.100.2', SECRET)), true, 'a different client is unaffected');
  });

  test('the log ring is capped at ADMIN_LOG_LIMIT entries, newest kept', () => {
    for (let i = 0; i < ADMIN_LOG_LIMIT + 25; i++) recordAdminLog('info', `ring-cap-${i}`);
    const logs = new AdminService({ secret: SECRET, log: quiet }).getLogs(0);
    assert.equal(logs.length, ADMIN_LOG_LIMIT);
    assert.equal(logs[logs.length - 1].message, `ring-cap-${ADMIN_LOG_LIMIT + 24}`);
    assert.ok(!logs.some((e) => e.message === 'ring-cap-0'), 'the oldest entries were evicted');
  });

  test('getOverview reads the lobby, the network and the registry without inventing numbers', () => {
    const svc = new AdminService({
      secret: SECRET,
      log: quiet,
      startedAt: Date.now() - 90_000,
      buildTag: () => 'abcdef123456',
      lobby: { stats: () => ({ rooms: 3, matches: 1, humans: 5, bots: 2, spectators: 1 }) },
      network: { connectionCount: 7 },
      registry: { size: 6 },
    });
    const o = svc.getOverview();
    assert.deepEqual(
      { rooms: o.rooms, matches: o.matches, humans: o.humans, bots: o.bots, spectators: o.spectators, sockets: o.sockets, sessions: o.sessions },
      { rooms: 3, matches: 1, humans: 5, bots: 2, spectators: 1, sockets: 7, sessions: 6 },
    );
    assert.equal(o.version.build, 'abcdef123456');
    assert.ok(o.uptimeSec >= 90 && o.uptimeSec <= 92);
    assert.equal(o.system.cpuPercent, 0, 'the first sample has no previous tick counts to compare with');
    const second = svc.getOverview();
    assert.ok(second.system.cpuPercent >= 0 && second.system.cpuPercent <= 100);
    // no lobby at all (a half-built server) → zeros, not a throw
    const bare = new AdminService({ secret: SECRET, log: quiet }).getOverview();
    assert.equal(bare.rooms, 0);
    assert.equal(bare.sockets, 0);
  });

  test('getRooms tolerates a room whose match object cannot be read (it must not take the poll down)', () => {
    const bad = { code: 'BAD1', hostId: 'p1', mode: 'solo', difficulty: 'FUNNY', seats: [], spectators: [], createdAt: 1 };
    // A getter that throws stands in for a half-disposed match: the admin view degrades to "no match", never a 500.
    Object.defineProperty(bad, 'match', { get() { throw new Error('disposed'); } });
    const svc = new AdminService({ secret: SECRET, log: quiet, lobby: { rooms: new Map([['BAD1', bad]]) } });
    const [room] = svc.getRooms();
    assert.equal(room.code, 'BAD1');
    assert.equal(room.inMatch, false);
    assert.equal(room.match, null);
  });

  test('getLogs returns copies — a caller cannot mutate the ring through the response', () => {
    recordAdminLog('info', 'immutable-entry');
    const svc = new AdminService({ secret: SECRET, log: quiet });
    const first = svc.getLogs(0).find((e) => e.message === 'immutable-entry');
    first.message = 'tampered';
    assert.ok(svc.getLogs(0).some((e) => e.message === 'immutable-entry'));
  });
});
