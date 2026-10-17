// test/match/perf.test.js — the per-room wall-clock accounting behind the admin panel's cost column
// (server/match/perf.js, GET /api/admin/rooms → `perf`).
//
// What matters here is not the numbers (they are wall-clock and a CI box is noisy) but the two CONTRACTS the panel
// and the operator rely on:
//
//   1. The buckets PARTITION the total. A cost meter that double counts or drops time is worse than none: every
//      assertion below is about Σ buckets == total, including when frames nest, when the work throws, and when a
//      snapshot is taken mid-frame.
//   2. A fresh match is a NEW counter id. The admin service differences cumulative counters, so a reused room code
//      must be recognisable — otherwise a new match would be reported as a spike in the old one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchPerf, PERF_BUCKETS, measureOn } from '../../server/match/perf.js';
import { AdminService, MIN_PERF_WINDOW_MS } from '../../server/admin.js';
import { getData } from '../../server/data.js';
import { Match } from '../../server/match/Match.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const DATA = getData({ log: quiet });

/** A clock the test drives by hand, so elapsed time is exact instead of flaky. */
function clk() {
  let t = 1_000;
  return { now: () => t, spend: (ms) => { t += ms; }, set: (v) => { t = v; }, get: () => t };
}

const sumBuckets = (snap) => PERF_BUCKETS.reduce((a, k) => a + snap.buckets[k], 0);

test('a fresh counter reports every bucket as 0 and a total that equals their sum', () => {
  const p = new MatchPerf({ now: clk().now });
  const s = p.snapshot();
  assert.deepEqual(Object.keys(s.buckets), [...PERF_BUCKETS], 'every bucket key is present, in a stable order');
  for (const k of PERF_BUCKETS) assert.equal(s.buckets[k], 0, k);
  assert.equal(s.totalMs, 0);
  assert.equal(s.frames, 0);
  assert.equal(s.openFrames, 0);
  assert.equal(s.maxDepth, 0);
});

test('nested frames partition exactly: a child is carved out of its parent, never added twice', () => {
  const c = clk();
  const p = new MatchPerf({ now: c.now });
  // core runs 10 ms; 4 of it is a battle step and 2 of it a bot rehearsal; 4 is core's own
  p.measure('core', () => {
    p.measure('battle', () => c.spend(4));
    p.measure('bots', () => c.spend(2));
    c.spend(4);
  });
  c.spend(3);
  p.measure('views', () => {}); // zero-length region: allowed, charges nothing
  c.spend(3);
  p.measure('views', () => {});

  const s = p.snapshot();
  assert.equal(s.buckets.battle, 4, 'the battle step is its own');
  assert.equal(s.buckets.bots, 2, 'the rehearsal is its own');
  assert.equal(s.buckets.core, 4, 'core keeps only what no child claimed');
  assert.equal(s.buckets.views, 0, 'a region measured with no elapsed time costs 0');
  assert.equal(s.totalMs, 10, 'the top-level frame is the measured total');
  assert.ok(Math.abs(s.totalMs - sumBuckets(s)) < 1e-9, 'partition: Σ buckets == totalMs');
  assert.equal(s.maxDepth, 2, 'core → battle is depth 2');
  assert.equal(s.openFrames, 0);
});

test('a throwing region is still charged, and the counter survives it', () => {
  const c = clk();
  const p = new MatchPerf({ now: c.now });
  assert.throws(() => p.measure('verify', () => { c.spend(7); throw new Error('battle blew up'); }), /blew up/);
  const s = p.snapshot();
  assert.equal(s.buckets.verify, 7, 'the time spent before the throw is the room\'s time regardless');
  assert.equal(s.openFrames, 0, 'the frame was closed by the finally');
  assert.equal(p.depth, 0, 'and the counter is back to its base depth');
  assert.ok(Math.abs(s.totalMs - sumBuckets(s)) < 1e-9);
});

test('a snapshot taken while a frame is open stays self-consistent and reports the open frame', () => {
  const c = clk();
  const p = new MatchPerf({ now: c.now });
  const frame = p.begin('core');
  c.spend(5);
  const s = p.snapshot();
  assert.equal(s.openFrames, 1, 'the panel can see that a poll landed mid-callback');
  assert.equal(s.totalMs, 0, 'an open top-level frame has not been totalled yet');
  assert.ok(Math.abs(s.totalMs - sumBuckets(s)) < 1e-9, 'the reading is still self-consistent');
  p.end(frame);
  assert.equal(p.snapshot().totalMs, 5, 'and the time lands once the frame closes');
});

test('a mismatched end is ignored, never fatal — instrumentation may not take a match down', () => {
  const p = new MatchPerf({ now: clk().now });
  p.end(null);                                   // no frame at all
  p.end({ bucket: 'core', t0: 0, child: 0 });     // a frame this counter never opened
  assert.equal(p.depth, 0);
  const inner = p.begin('core');
  const outer = p.begin('battle');
  p.end(inner);                                   // closing out of order: ignored, outer stays open
  assert.equal(p.depth, 2, 'both frames are still open');
  p.end(outer);
  p.end(inner);
  assert.equal(p.depth, 0);
});

test('a fresh MatchPerf gets a new id — a reused room code must be recognisable', () => {
  const a = new MatchPerf({ now: clk().now });
  const b = new MatchPerf({ now: clk().now });
  assert.notEqual(a.id, b.id, 'the id is what tells the admin service the totals restarted');
  assert.equal(a.id, a.snapshot().id, 'the snapshot carries it');
});

test('measureOn is a no-op without a counter: a Match built by a bare fixture cannot be broken by instrumentation', () => {
  assert.equal(measureOn(null, 'core', () => 41 + 1), 42);
  assert.equal(measureOn({}, 'core', () => 'no perf here'), 'no perf here');
  assert.equal(measureOn({ perf: null }, 'core', () => 'still fine'), 'still fine');
  const p = new MatchPerf({ now: clk().now });
  assert.equal(measureOn({ perf: p }, 'core', () => 'measured'), 'measured');
});

// ---- the match and the admin service ---------------------------------------------------------------------------

/** A Match with every callback the constructor requires and nothing else. */
function bareMatch(o = {}) {
  return new Match({
    roomCode: 'TST1', mode: 'coop', difficulty: 'NORMAL',
    seats: [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true }],
    data: DATA, log: quiet, send: () => true, broadcast: () => {}, onEnd: () => {},
    ...o,
  });
}

test('a real Match carries a counter and the panels\' guard/handle paths move it', () => {
  const m = bareMatch();
  assert.ok(m.perf instanceof MatchPerf, 'every match has one');
  // guard is the scheduler-callback funnel: it must charge something even for trivial work
  m.guard(() => { for (let i = 0; i < 5000; i++) Math.sqrt(i); });
  const afterGuard = m.perf.snapshot();
  assert.ok(afterGuard.frames >= 1, 'guard measured at least one frame');
  assert.ok(afterGuard.totalMs >= 0);
  assert.ok(Math.abs(afterGuard.totalMs - sumBuckets(afterGuard)) < 0.02, 'partition holds after real work');
  m.dispose();
});

test('the admin service turns cumulative counters into a rate, and refuses to invent one from a single reading', () => {
  const c = clk();
  const svc = new AdminService({ secret: 'x'.repeat(32), now: c.now, log: quiet });
  const m = bareMatch();
  svc.lobby = { rooms: new Map([['TST1', { code: 'TST1', seats: [], spectators: [], hostId: null, match: m }]]) };

  // first poll: totals only — a rate from one sample would be a lie (and a wild one)
  const first = svc.getRooms()[0].perf;
  assert.ok(first, 'a room in a match reports perf');
  assert.equal(first.sharePercent, null, 'no rate yet');
  assert.equal(first.windowSec, 0, 'and no window');

  // spend a known 20 ms inside the match, then poll again 300 ms later: 20/300 ≈ 6.7 %
  m.guard(() => { for (let i = 0; i < 20000; i++) Math.sqrt(i); });
  const spent = m.perf.snapshot().totalMs;
  assert.ok(spent > 0, 'the guard did measurable work');
  c.spend(300);
  const second = svc.getRooms()[0].perf;
  assert.ok(second.windowSec > 0, 'the second poll has a window');
  assert.ok(second.sharePercent != null, 'and a rate');
  const want = Math.round((spent / 300) * 1000) / 10;
  assert.equal(second.sharePercent, want, 'the rate is the delta over the wall-clock window');
  assert.ok(Math.abs(second.totalMs - spent) < 0.02, 'totals keep accumulating');
  m.dispose();
});

test('two polls closer together than the minimum window report totals without a rate', () => {
  const c = clk();
  const svc = new AdminService({ secret: 'x'.repeat(32), now: c.now, log: quiet });
  const m = bareMatch();
  svc.lobby = { rooms: new Map([['TST1', { code: 'TST1', seats: [], spectators: [], hostId: null, match: m }]]) };
  svc.getRooms();                       // primes the window
  c.spend(MIN_PERF_WINDOW_MS - 1);      // a second panel tab / a retry: too close to divide by
  const perf = svc.getRooms()[0].perf;
  assert.equal(perf.sharePercent, null, 'dividing a few ms by almost no time would report a wild percentage');
  m.dispose();
});

test('a NEW match in a REUSED room code reports no rate instead of spiking', () => {
  const c = clk();
  const svc = new AdminService({ secret: 'x'.repeat(32), now: c.now, log: quiet });
  const rooms = new Map();
  svc.lobby = { rooms };

  const first = bareMatch();
  rooms.set('TST1', { code: 'TST1', seats: [], spectators: [], hostId: null, match: first });
  svc.getRooms();
  first.guard(() => { for (let i = 0; i < 20000; i++) Math.sqrt(i); });
  c.spend(300);
  assert.ok(svc.getRooms()[0].perf.sharePercent != null, 'the first match reports a rate');
  first.dispose();

  // the same room code, a brand new match: its totals start at 0, which is not a "drop" to difference
  rooms.set('TST1', { code: 'TST1', seats: [], spectators: [], hostId: null, match: bareMatch() });
  const fresh = svc.getRooms()[0].perf;
  assert.equal(fresh.sharePercent, null, 'a restarted counter has no window yet');
  assert.equal(fresh.totalMs, 0, 'and its totals are read from the new match');
  rooms.get('TST1').match.dispose();
});

test('a room with no match, and a match that cannot be read, both leave the panel standing', () => {
  const svc = new AdminService({ secret: 'x'.repeat(32), log: quiet });
  svc.lobby = {
    rooms: new Map([
      ['AAAA', { code: 'AAAA', seats: [], spectators: [], hostId: null }],                                  // in the lobby
      ['BBBB', { code: 'BBBB', seats: [], spectators: [], hostId: null, get match() { throw new Error('disposed'); } }],
    ]),
  };
  const rooms = svc.getRooms();
  assert.equal(rooms.find((r) => r.code === 'AAAA').perf, null, 'no match → no cost, and no crash');
  assert.equal(rooms.find((r) => r.code === 'BBBB').perf, null, 'a half-disposed match degrades to null');
});

test('the overview aggregates every live room, on a window of its own', () => {
  const c = clk();
  const svc = new AdminService({ secret: 'x'.repeat(32), now: c.now, log: quiet });
  const a = bareMatch();
  const b = bareMatch();
  svc.lobby = {
    rooms: new Map([
      ['AAAA', { code: 'AAAA', seats: [], spectators: [], hostId: null, match: a }],
      ['BBBB', { code: 'BBBB', seats: [], spectators: [], hostId: null, match: b }],
    ]),
    stats: () => ({ rooms: 2, matches: 2, humans: 2, bots: 0, spectators: 0 }),
  };
  const first = svc.getOverview().perf;
  assert.equal(first.rooms, 2, 'both matches counted');
  assert.equal(first.sharePercent, null, 'no rate from a single reading');
  assert.deepEqual(Object.keys(first.buckets), [...PERF_BUCKETS]);

  a.guard(() => { for (let i = 0; i < 20000; i++) Math.sqrt(i); });
  b.guard(() => { for (let i = 0; i < 20000; i++) Math.sqrt(i); });
  const total = m0(a) + m0(b);
  c.spend(400);
  const second = svc.getOverview().perf;
  assert.ok(second.sharePercent != null, 'a rate once there is a window');
  assert.equal(second.sharePercent, Math.round((total / 400) * 1000) / 10, 'the aggregate is the sum of the rooms');
  // "Additive" to the PUBLISHED precision (both sides are rounded to 2 dp independently, and two roundings of a sum
  // need not agree in the last ulp — 0.57 vs 0.5700000000000001 is not an aggregation bug).
  assert.ok(Math.abs(second.totalMs - total) < 0.01, `totals are additive (${second.totalMs} vs ${total})`);
  a.dispose();
  b.dispose();

  function m0(x) { return x.perf.snapshot().totalMs; }
});

test('polling /rooms and /overview together does not let either steal the other\'s rate window', () => {
  const c = clk();
  const svc = new AdminService({ secret: 'x'.repeat(32), now: c.now, log: quiet });
  const m = bareMatch();
  svc.lobby = {
    rooms: new Map([['TST1', { code: 'TST1', seats: [], spectators: [], hostId: null, match: m }]]),
    stats: () => ({ rooms: 1, matches: 1, humans: 1, bots: 0, spectators: 0 }),
  };
  // the panel's real poll order: both endpoints, one after the other
  svc.getOverview();
  svc.getRooms();
  m.guard(() => { for (let i = 0; i < 20000; i++) Math.sqrt(i); });
  c.spend(300);
  const ov = svc.getOverview().perf;
  const rm = svc.getRooms()[0].perf;
  assert.ok(ov.sharePercent != null, 'the aggregate kept its own window');
  assert.ok(rm.sharePercent != null, 'and so did the room');
  m.dispose();
});
