// Field-host ownership under cancellation and timeout. Browser tests cover the actual renderer; this fixture runs
// the production orchestration with controlled imports and timers, without a DOM or GPU dependency.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getEventListeners } from 'node:events';
import vm from 'node:vm';

const sourcePath = new URL('../../public/js/ui/fieldHost.js', import.meta.url);
const source = readFileSync(sourcePath, 'utf8')
  .replace(/^import .*;$/gm, '').replace(/^export /gm, '')
  .replace("import('../assets.js')", 'importAssets()')
  .replace("import('../render/app.js')", 'importApp()');
const METHODS = ['setStage', 'setCamera', 'setPrep', 'enterBattle', 'pushSnapshot', 'pushEvents', 'highlightTiles', 'on', 'resize'];
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

function fixture({ resources = 0 } = {}) {
  const timers = new Map(), intervals = new Map(), requests = [], fallbacks = [], warnings = [];
  let timerId = 0, intervalId = 0;
  // A controllable clock. The deadline measures real intervals, which never pass under fake timers; without this the
  // ceiling and the stall windows would be untestable (and any test asserting them would be lying).
  let now = 1_000_000;
  const FakeDate = class extends Date { static now() { return now; } };
  // Resource timeline entries: the deadline reads how RECENTLY the newest one finished, not just how many exist.
  let entries = Array.from({ length: resources }, (_, i) => ({ startTime: now - resources + i, duration: 1 }));
  const unrelated = { name: 'unrelated' };
  const host = {
    children: [unrelated],
    get firstChild() { return this.children[0] || null; },
    appendChild(node) { this.children.push(node); },
    removeChild(node) { const i = this.children.indexOf(node); if (i >= 0) this.children.splice(i, 1); },
  };
  function view(name, valid = true) {
    const node = { name };
    host.appendChild(node);
    return {
      ...(valid ? Object.fromEntries(METHODS.map((k) => [k, () => {}])) : {}),
      node, destroyCalls: 0,
      destroy() { this.destroyCalls++; host.removeChild(node); },
    };
  }
  const context = vm.createContext({
    AbortController, DOMException, URLSearchParams, Promise, Date: FakeDate,
    console: { warn: (...args) => warnings.push(args) },
    audio: {}, data: { get() { return null; } }, settingsStore: { get() { return {}; } },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    // The mount deadline also watches a liveness heartbeat (setInterval) and the page's resource count: the fixture
    // models both so a throttled real load is not mistaken for a dead one (see mountFieldView's withTimeout).
    setInterval(fn) { intervals.set(++intervalId, fn); return intervalId; },
    clearInterval(id) { intervals.delete(id); },
    performance: {
      getEntriesByType: (type) => (type === 'resource' ? entries.slice() : []),
      setResourceTimingBufferSize() {},
      now: () => now,
    },
    importAssets: async () => null,
    importApp: async () => ({
      createFieldView(_host, opts) {
        // Deliberately ignore cancellation: the host must still dispose a factory's late return value.
        return new Promise((resolve, reject) => requests.push({ resolve, reject, signal: opts.signal }));
      },
    }),
    createFallbackView() {
      const fallback = view('fallback');
      fallbacks.push({ view: fallback, rendererAborted: requests.at(-1)?.signal?.aborted });
      return fallback;
    },
  });
  vm.runInContext(source + '\nglobalThis.mount = mountFieldView;', context, { filename: sourcePath.pathname });
  return {
    host, unrelated, timers, intervals, requests, fallbacks, warnings, view,
    mount: (signal) => context.mount(host, { signal }),
    timeout() {
      // Fire the newest PENDING deadline and remove it, like a real timer: an already-fired callback must not be
      // invoked again (that would let a test loop spin on a dead timer and look like the ceiling never fires).
      const entry = [...timers.entries()].at(-1);
      assert.ok(entry, 'initialization has a deadline');
      const [id, fn] = entry;
      timers.delete(id);
      fn();
    },
    /** Is a deadline still armed? */
    hasTimer() { return timers.size > 0; },
    /** The network just delivered a subresource: a fresh entry ending at the current clock. */
    advanceResources(n = 1) {
      for (let i = 0; i < n; i++) entries.push({ startTime: now, duration: 1 });
    },
    /** Advance the fixture's clock (the stall windows and the ceiling are all measured in ms). */
    advanceClock(ms) { now += ms; },
    /** Run the liveness heartbeat, as a real browser would between deadline checks. */
    heartbeat() { for (const fn of intervals.values()) fn(); },
  };
}

function settled(promise) {
  const result = { state: 'pending', value: null, promise };
  promise.then((value) => { result.state = 'fulfilled'; result.value = value; }, (error) => { result.state = 'rejected'; result.value = error; });
  return result;
}

test('successful initialization releases deadlines and cancellation listeners', async () => {
  const f = fixture(), controller = new AbortController();
  const pending = f.mount(controller.signal);
  await flush();
  const raw = f.view('engine');
  f.requests[0].resolve(raw);
  const mounted = await pending;
  assert.equal(mounted.kind, 'engine');
  assert.equal(f.timers.size, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.equal(getEventListeners(f.requests[0].signal, 'abort').length, 0);
  mounted.destroy();
  assert.equal(raw.destroyCalls, 1);
});

test('cancelling a pending mount rejects without fallback and disposes a late result', async () => {
  const f = fixture(), controller = new AbortController();
  const result = settled(f.mount(controller.signal));
  await flush();
  controller.abort();
  await flush();
  assert.equal(result.state, 'rejected');
  assert.equal(result.value.name, 'AbortError');
  assert.equal(f.fallbacks.length, 0);
  assert.equal(f.warnings.length, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  const late = f.view('late');
  f.requests[0].resolve(late);
  await flush();
  assert.equal(late.destroyCalls, 1);
  assert.deepEqual(f.host.children, [f.unrelated]);
});

test('cancellation between factory resolution and mount continuation disposes the resolved view', async () => {
  const f = fixture(), controller = new AbortController();
  const result = settled(f.mount(controller.signal));
  await flush();
  const raw = f.view('settling');
  f.requests[0].resolve(raw);
  await Promise.resolve();
  controller.abort();
  await flush();
  assert.equal(result.state, 'rejected');
  assert.equal(result.value.name, 'AbortError');
  assert.equal(raw.destroyCalls, 1);
  assert.equal(f.fallbacks.length, 0);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.host.children, [f.unrelated]);
});

test('an invalid renderer API is disposed and aborted before fallback mounts', async () => {
  const f = fixture();
  const pending = f.mount();
  await flush();
  const invalid = f.view('invalid', false);
  f.requests[0].resolve(invalid);
  const fallback = await pending;
  assert.equal(fallback.kind, 'fallback');
  assert.equal(invalid.destroyCalls, 1);
  assert.equal(f.fallbacks[0].rendererAborted, true);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.host.children, [f.unrelated, f.fallbacks[0].view.node]);
  fallback.destroy();
});

test('a timed-out factory returning late cannot remove a replacement view or unrelated children', async () => {
  const f = fixture();
  const first = f.mount();
  await flush();
  f.timeout();
  const fallback = await first;
  assert.equal(fallback.kind, 'fallback');
  fallback.destroy();
  const replacementPending = f.mount();
  await flush();
  const replacement = f.view('replacement');
  f.requests[1].resolve(replacement);
  const mounted = await replacementPending;
  const late = f.view('late');
  f.requests[0].resolve(late);
  await flush();
  assert.equal(late.destroyCalls, 1);
  assert.equal(replacement.destroyCalls, 0);
  assert.equal(f.fallbacks[0].rendererAborted, true);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.host.children, [f.unrelated, replacement.node]);
  mounted.destroy();
});

// ---- the 12 s wall clock was the bug, not the fix (see mountFieldView's withTimeout) ---------------------------
// Measured on a cold cache: a 4G visit needs ~23 s and fast 3G ~67 s to mount the real engine, and the long gaps sit
// in the synchronous 3D-board build with NO network activity. A flat deadline killed those loads and degraded a
// perfectly capable GPU to the simplified view ("渲染器暂时未能加载"). The deadline must therefore read liveness.

test('a slow but ALIVE load is not killed: a subresource that just finished restarts the window', async () => {
  const f = fixture({ resources: 0 });
  const result = settled(f.mount());
  await flush();
  // this window expires, but the network delivered a resource moments ago: the window must restart
  f.advanceClock(10000);
  f.advanceResources(1);            // ends at the current clock == "delivered just now"
  f.advanceClock(2000);
  f.timeout();
  await flush();
  assert.equal(result.state, 'pending', 'still waiting on the engine — not degraded');
  assert.equal(f.fallbacks.length, 0, 'no simplified view while the load is making progress');
  assert.ok(f.requests.length >= 1, 'the engine is still being built');
  // and it really does finish
  const raw = f.view('engine');
  f.requests.at(-1).resolve(raw);
  const mounted = await result.promise;
  assert.equal(mounted.kind, 'engine');
  assert.equal(f.intervals.size, 0, 'the heartbeat is cleared on a successful mount');
  mounted.destroy();
});

test('a long SYNCHRONOUS build is alive too: a blocked heartbeat restarts the window', async () => {
  const f = fixture({ resources: 0 });
  const result = settled(f.mount());
  await flush();
  // no network at all (the 3D-board build blocks the main thread), so the heartbeat cannot run: that itself is
  // proof of work, and the window must restart rather than degrade a machine that is busy building.
  f.advanceClock(20000);            // far beyond the window, and no beat happened in it
  f.timeout();
  await flush();
  assert.equal(result.state, 'pending', 'a busy main thread is not a dead load');
  assert.equal(f.fallbacks.length, 0);
  const raw = f.view('engine');
  f.requests.at(-1).resolve(raw);
  (await result.promise).destroy();
});

test('a DEAD load still falls back: nothing delivered and nothing busy', async () => {
  const f = fixture({ resources: 0 });
  const result = settled(f.mount());
  await flush();
  // the heartbeat keeps running (the thread is idle) and no resource ever arrives: a dead link, not a slow one
  for (let i = 0; i < 4; i++) { f.advanceClock(3000); f.heartbeat(); }
  f.timeout();
  const fallback = await result.promise;
  assert.equal(fallback.kind, 'fallback');
  assert.equal(f.warnings.length, 1, 'the reason is logged for the report');
  assert.equal(f.intervals.size, 0, 'the heartbeat does not outlive the attempt');
  fallback.destroy();
});

test('the deadline ends in a bounded spinner: it cannot extend forever', async () => {
  const f = fixture({ resources: 0 });
  const result = settled(f.mount());          // observe ONE object: a fresh settled() would still read 'pending'
  await flush();
  // pretend the page keeps delivering subresources forever — the ceiling must still stop it
  for (let i = 0; i < 400 && result.state === 'pending' && f.hasTimer(); i++) {
    f.advanceClock(5000);           // 5 s per keep-alive window: the 120 s ceiling is crossed after ~24 rounds
    f.advanceResources(1);          // ...and every round looks alive, so only the ceiling can end it
    f.timeout();
    await flush();
  }
  assert.equal(result.state, 'fulfilled', 'the mount resolves (to the fallback) rather than spinning forever');
  assert.equal(result.value.kind, 'fallback');
  assert.equal(f.intervals.size, 0, 'the heartbeat is cleared when the ceiling stops the load');
  assert.equal(f.hasTimer(), false, 'no deadline outlives the attempt');
  result.value.destroy();
});
