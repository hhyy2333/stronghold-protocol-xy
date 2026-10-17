// test/match/simPool.test.js — the worker pool: it runs battles off the main thread, gives the SAME answer, and never
// hangs or changes behaviour when it cannot.
//
// WHY. The pool exists so a second core can run bot rehearsals (measured 58.3 % of all room CPU on the live box, on the
// one JS thread every room shares). It must be invisible when it works and harmless when it fails, so these tests pin:
//   1. a battle through the pool is bit-identical to the same battle run inline;
//   2. the pool reports itself unavailable when disabled, so callers keep the inline path;
//   3. a task always SETTLES — a dead worker or a failed post must not leave a caller hanging (a real bug here);
//   4. a real match with the pool picks the same outcome as the same match without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimPool } from '../../server/match/simPool.js';
import { makeMatch } from './harness.js';
import { PHASE } from '../../shared/constants.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { getData } from '../../server/data.js';

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const clone = (v) => JSON.parse(JSON.stringify(v));

/** Run a spec on this thread; the shape matches what the worker replies with. */
function inlineRun(spec, playerId, cap = 200000) {
  const b = createBattleFromSpec(spec, getData(), { logger: null });
  let ticks = 0;
  while (!b.finished && ticks < cap) { b.step(); ticks++; }
  const r = b.result();
  const pp = r && r.perPlayer ? r.perPlayer[playerId] : null;
  return {
    ticks,
    result: r,
    leaks: pp ? (pp.leaked || []).filter((l) => l && l.counted !== false).length : null,
    killed: pp ? (pp.killed || 0) : null,
  };
}

/** A real normal-field spec from a seeded match, with the enemy-hex flag applied (as production does). */
function realSpec(seed = 909, round = 6) {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1, bots: 3, seed, fake: false }).start();
  const m = h.m;
  h.drive(() => m.phase === PHASE.PREP && m.round >= round, { maxSteps: 3000000 });
  const ps = [...m.players.values()].find((p) => p.botControlled) || [...m.players.values()][0];
  const opts = m.battleOptsWithEnemyHexes({ ...m._normalOpts(ps), data: m.ds, content: m.battleContent, logger: m.log });
  return { spec: buildBattleSpec(clone(opts)), playerId: ps.playerId };
}

test('a disabled pool reports unavailable and runs nothing', () => {
  const pool = new SimPool({ size: 0, log: silent });
  assert.equal(pool.available(), false);
  assert.equal(pool.run({ spec: {}, inline: null }), null);
  assert.equal(pool.liveWorkers(), 0);
});

test('reserve() is all-or-nothing, so a batch is never half-submitted', () => {
  // The defect this pins: `run()` refuses once the queue is full, so a caller submitting a BATCH could have some tasks
  // already running and then be refused. In the rehearsal that is unrecoverable — the pool path builds no `Battle`
  // objects, so the inline fallback has nothing to step and the plan would silently keep the default. Callers therefore
  // ask `reserve(n)` FIRST; only a true answer means the whole batch will be accepted.
  const pool = new SimPool({ size: 1, maxQueue: 4, log: silent });
  pool.start();
  try {
    assert.equal(pool.reserve(0), true, 'a zero-length batch is trivially fine');
    assert.equal(pool.reserve(1), true);
    assert.equal(pool.reserve(4), true, 'exactly the queue limit');
    assert.equal(pool.reserve(5), false, 'more than the queue can hold');
  } finally {
    pool.close();
  }
  const off = new SimPool({ size: 0, log: silent });
  assert.equal(off.reserve(1), false, 'a disabled pool can never take a batch');
  off.close();
});

test('a battle through the pool is bit-identical to the same battle inline', async () => {
  const pool = new SimPool({ size: 2, log: silent });
  pool.start();
  try {
    const { spec, playerId } = realSpec();
    const inline = inlineRun(spec, playerId);
    const off = await pool.run({ spec, cap: 200000, playerId, kind: 'test', inline: null });
    assert.ok(off, 'the pool took the task');
    assert.equal(off.ticks, inline.ticks, 'tick count');
    assert.deepEqual(off.result, inline.result, 'battle result');
    assert.equal(off.leaks, inline.leaks, 'counted leaks');
    assert.equal(off.killed, inline.killed, 'kills');
  } finally {
    await pool.close();
  }
});

test('several tasks run concurrently and all settle', async () => {
  const pool = new SimPool({ size: 2, log: silent });
  pool.start();
  try {
    const { spec, playerId } = realSpec();
    const replies = await Promise.all(Array.from({ length: 4 }, () => pool.run({ spec, cap: 200000, playerId, kind: 'test', inline: null })));
    assert.equal(replies.length, 4);
    for (const r of replies) assert.ok(r && typeof r.ticks === 'number', 'every task settled with a result');
    assert.equal(pool.stats().offloaded, 4);
  } finally {
    await pool.close();
  }
});

test('a task settles even when no worker can take it (never hangs a caller)', async () => {
  // size 1 but the worker is terminated immediately, so the task cannot complete in a worker
  const pool = new SimPool({ size: 1, log: silent });
  pool.start();
  const { spec, playerId } = realSpec();
  // kill the worker, then hand it a task: it must resolve (to null) rather than hang
  for (const s of pool._slots) { try { s.worker.terminate(); } catch { /* ignore */ } }
  const settled = await Promise.race([
    pool.run({ spec, cap: 200000, playerId, kind: 'test', inline: null }).then((r) => ({ ok: true, r })),
    new Promise((res) => setTimeout(() => res({ ok: false }), 8000)),
  ]);
  assert.ok(settled.ok, 'the task settled instead of hanging');
  await pool.close();
});

test('close() settles queued tasks instead of leaving them pending', async () => {
  const pool = new SimPool({ size: 1, log: silent });
  pool.start();
  const { spec, playerId } = realSpec();
  const p = pool.run({ spec, cap: 200000, playerId, kind: 'test', inline: null });
  await pool.close();
  const r = await Promise.race([p.then((v) => ({ settled: true, v })), new Promise((res) => setTimeout(() => res({ settled: false }), 5000))]);
  assert.ok(r.settled, 'a queued task settles on close');
});

test('a real match with the pool reaches the same outcome as without it', async () => {
  const run = async (pool) => {
    const h = makeMatch({
      mode: 'coop', difficulty: 'HARD', humans: 1, bots: 3, seed: 4242, fake: false,
      simPool: pool || undefined, botRehearsal: 3,
    }).start();
    const m = h.m;
    let guard = 0;
    while (!(m.ended || m.phase === PHASE.RESULT) && guard++ < 100000) {
      h.drive(() => m.ended || m.phase === PHASE.RESULT, { maxSteps: 20000 });
      if (pool) await new Promise((r) => setTimeout(r, 0));
    }
    return JSON.stringify([...m.players.values()].map((p) => [p.seat, p.lp, p.alive]).sort());
  };
  const without = await run(null);
  const pool = new SimPool({ size: 2, log: silent });
  pool.start();
  let withPool;
  try { withPool = await run(pool); } finally { await pool.close(); }
  assert.equal(withPool, without, 'the pool must not change a match outcome');
});

test('a VIRTUAL scheduler refuses the pool (its replies are microtasks a synchronous driver never reaches)', () => {
  // Measured 2026-10-13: with a pool under virtual time the match stalled at round 1 (4 tasks queued, 0 offloaded),
  // because runAsync() resolves through promise callbacks while a VirtualScheduler is driven by synchronous runNext()
  // calls. Match therefore ignores a pool when the scheduler is virtual, which also keeps every existing test and the
  // golden corpus on the single inline path they have always used.
  const pool = new SimPool({ size: 1, log: silent });
  pool.start();
  try {
    const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1, bots: 3, seed: 1, fake: false, simPool: pool, botRehearsal: 3 }).start();
    assert.equal(h.m.sched.virtual, true, 'the harness scheduler is virtual');
    assert.equal(h.m.simPool, null, 'a virtual match must not hold the pool');
  } finally {
    // nothing async to await: the pool was never used
    pool.close();
  }
});

test('a REAL scheduler accepts the pool and offloads real rehearsals', async () => {
  // The production shape: RealScheduler + a bot-heavy room. The match advances on real time, so this test waits a few
  // seconds rather than driving virtual time; it asserts the pool actually did work, which is the whole point.
  const { Match } = await import('../../server/match/Match.js');
  const { RealScheduler } = await import('../../server/match/scheduler.js');
  const { getData } = await import('../../server/data.js');
  const data = getData();
  const pool = new SimPool({ size: 1, log: silent });
  pool.start();
  const sched = new RealScheduler({ now: () => Date.now() });
  const seats = [
    { seat: 0, playerId: 'p_h', name: 'h', isBot: false, connected: true },
    { seat: 1, playerId: 'ai_1', name: 'a1', isBot: true, connected: true },
    { seat: 2, playerId: 'ai_2', name: 'a2', isBot: true, connected: true },
    { seat: 3, playerId: 'ai_3', name: 'a3', isBot: true, connected: true },
  ];
  const m = new Match({
    roomCode: 'T', mode: 'coop', difficulty: 'HARD', seats, seed: 99, data, log: silent,
    send: () => true, broadcast: () => {}, onEnd: () => {}, scheduler: sched,
    botRehearsal: 3, clientCombat: true, verify: 'off', simPool: pool,
  });
  assert.equal(m.simPool, pool, 'a real scheduler keeps the pool');
  for (const ps of m.players.values()) if (!ps.isBot) ps.autoplay = true;
  m.start();
  // answer the human's turns and wait for at least one rehearsal to be offloaded
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && pool.stats().offloaded === 0) {
    await new Promise((r) => setTimeout(r, 200));
    for (const ps of m.players.values()) {
      if (ps.isBot || ps.left) continue;
      try {
        if (m.phase === PHASE.INFO_CHECK && !ps.infoReady) m.handle(ps.playerId, { t: 'g.infoReady' });
        else if (m.phase === PHASE.BAND_DRAFT && m.draftTurn() === ps.playerId) m.handle(ps.playerId, { t: 'g.band', id: 'band_bldsk' });
        else if (m.phase === PHASE.PREP && !ps.ready) m.handle(ps.playerId, { t: 'g.ready', ready: true });
      } catch { /* not applicable yet */ }
    }
  }
  const stats = pool.stats();
  try { m.dispose(); } catch { /* ignore */ }
  await pool.close();
  assert.ok(stats.offloaded > 0, `expected the pool to run real rehearsals, got ${JSON.stringify(stats)}`);
});
