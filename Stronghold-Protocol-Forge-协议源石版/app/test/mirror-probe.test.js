// 镜像测速（server/mirrorProbe.js）：容器视角的实测证据 + 缺件表。
//
// 这一层是**证据**，不掌舵：它答「快不快 / 谁缺件」，302 的顺序由 assetJump 的 SP_PROBE_LEADS 决定是否采纳。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMirrorProbe, samplerPool, LARGE_MIN_BYTES } from '../server/mirrorProbe.js';

const quiet = { info() {}, warn() {} };
const sizeOf = (pathname) => (pathname.includes('big') ? 2 * LARGE_MIN_BYTES : 1024);

/** A fetch that answers a deterministic body size and can be told to 404 certain (host, path) pairs. */
function fakeFetch({ missing = new Set(), fail = new Set(), delayMs = 0 } = {}) {
  return async (url) => {
    const u = new URL(url);
    const key = `${u.host}${u.pathname}`;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (fail.has(u.host)) throw new Error('ECONNRESET');
    if (missing.has(key)) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    const n = sizeOf(u.pathname);
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(n) };
  };
}

test('samplerPool: only static art under /assets, deduplicated', () => {
  const pool = samplerPool(['/assets/a.png', '/assets/a.png', '/assets/b.skel', '/fonts/x.woff2', '/assets/x.js', '/data/y.png']);
  assert.deepEqual(pool, ['/assets/a.png', '/assets/b.skel']);
});

test('refresh: every mirror is measured on the same sampled path, sizes decide the pool', async () => {
  const probe = createMirrorProbe({
    sources: [{ id: 'a', base: 'https://a.example' }, { id: 'b', base: 'https://b.example' }],
    paths: ['/assets/small.png', '/assets/big.png'],
    fetchImpl: fakeFetch(), intervalMs: 0, samplesPerRound: 2, rand: () => 0,
  });
  try {
    await probe.refresh();
    const s = probe.state();
    assert.equal(s.round, 1);
    assert.equal(s.pool, 2);
    for (const id of ['a', 'b']) {
      const row = s.sources.find((r) => r.id === id);
      assert.ok(row.smallSamples + row.largeSamples > 0, `${id} measured nothing`);
    }
    assert.ok(s.sources.every((r) => r.smallTtfb != null || r.largeBps != null));
    assert.equal(s.measuredOrder.length, 2);
    // the same file is measured on both mirrors: the sizes agree
    assert.equal(probe.poolSize(), 2);
    assert.equal(probe.ids.join(','), 'a,b');
  } finally { probe.stop(); }
});

test('missing table: a 404 on one mirror is remembered, a path missing everywhere is dropped', async () => {
  const probe = createMirrorProbe({
    sources: [{ id: 'a', base: 'https://a.example' }, { id: 'b', base: 'https://b.example' }],
    paths: ['/assets/small.png', '/assets/gone.png'],
    fetchImpl: fakeFetch({ missing: new Set(['b.example/assets/small.png', 'b.example/assets/gone.png', 'a.example/assets/gone.png']) }),
    log: quiet, intervalMs: 0, samplesPerRound: 2, rand: () => 0,
  });
  try {
    // two rounds: the first learns sizes, the second can pick the large pool / keep the record
    await probe.refresh();
    await probe.refresh();
    const s = probe.state();
    const row = s.missing.find((m) => m.path === '/assets/small.png');
    assert.ok(row, `missing table: ${JSON.stringify(s.missing)}`);
    assert.deepEqual(row.sources, ['b']);
    // missing on every mirror = the path itself is wrong: not a mirror gap, and it is no longer sampled
    assert.equal(s.missing.some((m) => m.path === '/assets/gone.png'), false);
  } finally { probe.stop(); }
});

test('a failing mirror reports the error instead of a number (and does not stop the other one)', async () => {
  const probe = createMirrorProbe({
    sources: [{ id: 'a', base: 'https://a.example' }, { id: 'b', base: 'https://b.example' }],
    paths: ['/assets/small.png'],
    fetchImpl: fakeFetch({ fail: new Set(['a.example']) }), intervalMs: 0, samplesPerRound: 1, rand: () => 0,
  });
  try {
    await probe.refresh();
    const s = probe.state();
    const a = s.sources.find((r) => r.id === 'a');
    const b = s.sources.find((r) => r.id === 'b');
    assert.equal(a.lastOk, false);
    assert.ok(a.error);
    assert.equal(b.lastOk, true);
    assert.ok(b.smallTtfb != null);
  } finally { probe.stop(); }
});

test('stop() releases the interval (the probe timer must not hold a process open)', () => {
  const probe = createMirrorProbe({
    sources: [{ id: 'a', base: 'https://a.example' }], paths: ['/assets/small.png'],
    fetchImpl: fakeFetch(), intervalMs: 0, samplesPerRound: 1,
  });
  probe.stop();
  probe.stop();   // idempotent
});
