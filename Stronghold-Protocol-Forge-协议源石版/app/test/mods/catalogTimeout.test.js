// 模组目录的加载必须**总能落定**（业主 2026-10-30 线上反馈「有人卡在核对模组，有人没有」）。
//
// 房间屏的对齐闸门先报 `checking`，只有 `loadCatalog()` + `planAlignment()` 这条链落定才解除；
// 而 `loadCatalog` 原来那个 fetch 没有超时、又把 promise 缓存在模块级变量里 —— 蓝绿切流那一刻被掐断的请求
// 就永远 pending，整个页面所有房间面板都停在「正在核对本房间的模组文件…」，除了刷新页面没有出路。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, resetCatalog, CATALOG_TIMEOUT_MS } from '../../public/js/mods/align.js';

const CATALOG = { packs: [{ id: 'p1', files: [] }] };
const okFetch = (calls) => async () => { calls.n++; return { ok: true, json: async () => CATALOG }; };

test('a catalogue that never answers settles as null after the timeout (no stuck 核对 state)', async () => {
  resetCatalog();
  let aborted = false;
  const hang = (_url, opts) => new Promise((_resolve, reject) => {
    // A real fetch rejects when the abort fires; a fetch that ignores the signal must not hold the gate either.
    opts?.signal?.addEventListener?.('abort', () => { aborted = true; reject(new Error('aborted')); });
  });
  const started = Date.now();
  const got = await loadCatalog({ fetch: hang, url: '/mods/catalog.json', timeoutMs: 40 });
  const spent = Date.now() - started;
  assert.equal(got, null, 'a timed-out catalogue is "unknown", never a made-up empty one');
  assert.ok(spent < 2000, `settled promptly (took ${spent} ms)`);
  assert.equal(aborted, true, 'and the socket was actually cancelled');
});

test('a fetch that ignores the abort signal still cannot hold the gate', async () => {
  resetCatalog();
  const forever = () => new Promise(() => {}); // never resolves, never reacts to the signal
  const got = await loadCatalog({ fetch: forever, timeoutMs: 30 });
  assert.equal(got, null);
});

test('a timed-out or failed load is not remembered: the next call retries', async () => {
  resetCatalog();
  const calls = { n: 0 };
  const hang = () => new Promise(() => {});
  assert.equal(await loadCatalog({ fetch: hang, timeoutMs: 20 }), null);
  const good = await loadCatalog({ fetch: okFetch(calls), timeoutMs: 20 });
  assert.deepEqual(good, CATALOG, 'the retry reaches the server instead of the cached failure');
  assert.equal(calls.n, 1);
});

test('a good catalogue is cached per page (one request for many panels)', async () => {
  resetCatalog();
  const calls = { n: 0 };
  const fetch = okFetch(calls);
  assert.deepEqual(await loadCatalog({ fetch }), CATALOG);
  assert.deepEqual(await loadCatalog({ fetch }), CATALOG);
  assert.equal(calls.n, 1, 'the second panel reuses the page-level cache');
  resetCatalog();
  await loadCatalog({ fetch });
  assert.equal(calls.n, 2, 'resetCatalog() forgets it (a fresh connection)');
});

test('a non-OK response and a malformed body both read as "no catalogue", and both retry', async () => {
  resetCatalog();
  assert.equal(await loadCatalog({ fetch: async () => ({ ok: false, json: async () => CATALOG }) }), null);
  assert.equal(await loadCatalog({ fetch: async () => ({ ok: true, json: async () => ({ packs: 'nope' }) }) }), null);
  const calls = { n: 0 };
  assert.deepEqual(await loadCatalog({ fetch: okFetch(calls) }), CATALOG, 'still retries after a bad body');
  assert.equal(calls.n, 1);
});

test('the default timeout is a real bound (8 s), and 0 disables it', () => {
  assert.equal(CATALOG_TIMEOUT_MS, 8000);
  assert.ok(CATALOG_TIMEOUT_MS > 0 && CATALOG_TIMEOUT_MS <= 15000, 'long enough for a slow phone, short enough to matter');
});
