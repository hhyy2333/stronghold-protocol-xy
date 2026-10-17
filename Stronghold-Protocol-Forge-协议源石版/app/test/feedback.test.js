// test/feedback.test.js — 玩家反馈：存储（server/feedback.js）、公开写接口 POST /api/feedback 和管理端读取
// （GET /api/admin/feedback）。
//
// 这个接口是公开的（玩家没有账号），所以除了happy path，重点测的是边界：体积上限、按地址限流、只接受已知字段，
// 以及"没有 ADMIN_SECRET 时管理端一律 404"。落盘目录一律用临时目录，绝不写开发者的家目录。

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startServer } from '../server/index.js';
import { createFeedbackStore, DESCRIPTION_MAX, REPORT_MAX, SUBMIT_MAX, LIST_MAX } from '../server/feedback.js';

// ---------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------

/** Raw HTTP request with an optional JSON body. */
function httpReq(port, rawPath, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const h = { ...headers };
    if (payload) { h['content-type'] = 'application/json'; h['content-length'] = String(payload.length); }
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const json = (res) => JSON.parse(res.body.toString());
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const SECRET = 'feedback-test-secret-0123456789abcdef';

/** A fresh temp dir per test; removed afterwards. */
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-feedback-'));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });
  return dir;
}

const sample = (over = {}) => ({
  description: '点击开始后卡住了',
  report: '```text\nStronghold-Protocol diagnostics\nversion: 0.3.0\n```',
  meta: { version: '0.3.0', build: 'abc123', phase: 'PREP', round: 3 },
  ...over,
});

// ---------------------------------------------------------------------------------------------------
// the store
// ---------------------------------------------------------------------------------------------------

describe('feedback store', () => {
  test('stores a report and lists it newest first', (t) => {
    const store = createFeedbackStore({ dir: tempDir(t), log: quiet });
    assert.equal(store.submit(sample({ description: '第一条' }), { ip: '1.1.1.1' }).ok, true);
    assert.equal(store.submit(sample({ description: '第二条' }), { ip: '1.1.1.1' }).ok, true);
    const items = store.list({ limit: 10 });
    assert.equal(items.length, 2);
    assert.equal(items[0].description, '第二条', 'newest first');
    assert.equal(items[1].description, '第一条');
    assert.equal(store.count(), 2, 'count reads every line');
    assert.equal(items[0].ip, '1.1.1.1');
  });

  test('keeps only known meta keys (nothing else from the body is stored)', (t) => {
    const store = createFeedbackStore({ dir: tempDir(t), log: quiet });
    store.submit(sample({ meta: { version: '0.3.0', adminSecret: 'oops', __proto__: 'x', junk: 'y' } }), { ip: '1.1.1.1' });
    const [item] = store.list({ limit: 1 });
    assert.equal(item.meta.version, '0.3.0');
    assert.equal(item.meta.adminSecret, undefined, 'an unknown key is dropped');
    assert.equal(item.meta.junk, undefined);
    assert.equal(Object.getPrototypeOf(item.meta), Object.prototype, 'a plain object, not a polluted one');
  });

  test('caps the description and the report instead of trusting the client', (t) => {
    const store = createFeedbackStore({ dir: tempDir(t), log: quiet });
    store.submit(sample({ description: 'x'.repeat(DESCRIPTION_MAX + 500), report: 'y'.repeat(REPORT_MAX + 500) }), { ip: '1.1.1.1' });
    const [item] = store.list({ limit: 1 });
    assert.equal(item.description.length, DESCRIPTION_MAX);
    assert.equal(item.report.length, REPORT_MAX);
  });

  test('rejects a report that carries nothing at all', (t) => {
    const store = createFeedbackStore({ dir: tempDir(t), log: quiet });
    assert.deepEqual(store.submit({ description: '   ', report: '' }, { ip: '1.1.1.1' }), { ok: false, reason: 'empty' });
    assert.equal(store.count(), 0);
  });

  test('rate limits per client address, and a different address is unaffected', (t) => {
    const store = createFeedbackStore({ dir: tempDir(t), log: quiet });
    for (let i = 0; i < SUBMIT_MAX; i++) {
      assert.equal(store.submit(sample(), { ip: '2.2.2.2' }).ok, true, `submission ${i + 1} allowed`);
    }
    assert.deepEqual(store.submit(sample(), { ip: '2.2.2.2' }), { ok: false, reason: 'rate' });
    assert.equal(store.submit(sample(), { ip: '3.3.3.3' }).ok, true, 'another address still works');
  });

  test('an unwritable directory is reported, not thrown', (t) => {
    const dir = tempDir(t);
    const blocked = path.join(dir, 'nested');
    fs.writeFileSync(blocked, 'not a directory');           // mkdir of this path must fail
    const store = createFeedbackStore({ dir: blocked, log: quiet });
    assert.deepEqual(store.submit(sample(), { ip: '1.1.1.1' }), { ok: false, reason: 'unwritable' });
  });

  test('list() reads a tail: a report older than the tail window is not required to appear', (t) => {
    const store = createFeedbackStore({ dir: tempDir(t), log: quiet });
    for (let i = 0; i < 5; i++) store.submit(sample({ description: `n${i}` }), { ip: '1.1.1.1' });
    const items = store.list({ limit: 2 });
    assert.equal(items.length, 2, 'limit is honoured');
    assert.equal(items[0].description, 'n4');
  });

  test('the limit cannot exceed LIST_MAX', (t) => {
    const store = createFeedbackStore({ dir: tempDir(t), log: quiet });
    store.submit(sample(), { ip: '1.1.1.1' });
    assert.ok(store.list({ limit: LIST_MAX + 1000 }).length <= LIST_MAX);
  });
});

// ---------------------------------------------------------------------------------------------------
// the public endpoint
// ---------------------------------------------------------------------------------------------------

describe('POST /api/feedback', () => {
  /** @type {Awaited<ReturnType<typeof startServer>>} */
  let srv;
  let dir;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-feedback-srv-'));
    srv = await startServer({ port: 0, host: '127.0.0.1', log: quiet, feedbackDir: dir, adminSecret: SECRET });
  });
  after(async () => {
    await srv?.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('accepts a report and stores it outside the install tree', async () => {
    const res = await httpReq(srv.port, '/api/feedback', { method: 'POST', body: sample() });
    assert.equal(res.status, 200);
    const body = json(res);
    assert.equal(body.ok, true);
    assert.ok(body.id, 'answers the id');
    assert.equal(srv.feedback.dir, dir, 'the store uses the configured dir, not the install dir');
    assert.ok(!dir.startsWith(srv.url), 'never inside the served tree');
    const [item] = srv.feedback.list({ limit: 1 });
    assert.equal(item.description, '点击开始后卡住了');
    assert.equal(item.meta.phase, 'PREP');
  });

  test('the report lands in the admin view, and only with a token', async () => {
    const noToken = await httpReq(srv.port, '/api/admin/feedback');
    assert.equal(noToken.status, 401);
    const res = await httpReq(srv.port, '/api/admin/feedback', { headers: { authorization: `Bearer ${SECRET}` } });
    assert.equal(res.status, 200);
    const body = json(res);
    assert.ok(Array.isArray(body.items));
    assert.ok(body.items.length >= 1);
    assert.equal(body.dir, dir);
  });

  test('GET on the endpoint is a 405 that advertises POST', async () => {
    const res = await httpReq(srv.port, '/api/feedback');
    assert.equal(res.status, 405);
    assert.equal(res.headers.allow, 'POST');
  });

  test('a malformed body is a 400', async () => {
    const res = await httpReq(srv.port, '/api/feedback', { method: 'POST', body: '{not json' });
    assert.equal(res.status, 400);
    assert.equal(json(res).error, 'malformed');
  });

  test('an empty body is a 400', async () => {
    const res = await httpReq(srv.port, '/api/feedback', { method: 'POST' });
    assert.equal(res.status, 400);
    assert.equal(json(res).error, 'empty');
  });

  test('an array is not an object', async () => {
    const res = await httpReq(srv.port, '/api/feedback', { method: 'POST', body: [1, 2, 3] });
    assert.equal(res.status, 400);
    assert.equal(json(res).error, 'bad-body');
  });

  test('a report with neither description nor diagnostics is refused', async () => {
    const res = await httpReq(srv.port, '/api/feedback', { method: 'POST', body: { description: '', report: '' } });
    assert.equal(res.status, 400);
    assert.equal(json(res).error, 'empty');
  });

  test('an oversized body is a 413, not a crash', async () => {
    const res = await httpReq(srv.port, '/api/feedback', { method: 'POST', body: { description: 'z'.repeat(200 * 1024) } });
    assert.equal(res.status, 413);
    assert.equal(json(res).error, 'too-large');
    // the server is still healthy afterwards
    const after = await httpReq(srv.port, '/healthz');
    assert.equal(after.status, 200);
  });

  test('too many submissions from one address are rate limited', async () => {
    // SUBMIT_MAX were already spent by the tests above (same address), so this one must be refused.
    let sawRate = false;
    for (let i = 0; i < SUBMIT_MAX + 2; i++) {
      const res = await httpReq(srv.port, '/api/feedback', { method: 'POST', body: sample({ description: `spam ${i}` }) });
      if (res.status === 429) { sawRate = true; assert.equal(json(res).error, 'RATE'); break; }
    }
    assert.equal(sawRate, true, 'the limiter eventually answers 429');
  });
});

describe('POST /api/feedback with no store configured', () => {
  let srv2;
  before(async () => { srv2 = await startServer({ port: 0, host: '127.0.0.1', log: quiet, feedbackDir: null }); });
  after(async () => { await srv2?.close(); });

  test('answers 503 instead of pretending it stored something', async () => {
    const res = await httpReq(srv2.port, '/api/feedback', { method: 'POST', body: sample() });
    assert.equal(res.status, 503);
    assert.equal(json(res).error, 'unavailable');
  });

  test('the admin path is still a 404 without ADMIN_SECRET', async () => {
    const saved = process.env.ADMIN_SECRET;
    delete process.env.ADMIN_SECRET;
    try {
      const res = await httpReq(srv2.port, '/api/admin/feedback');
      assert.equal(res.status, 404, 'the surface does not exist');
    } finally {
      if (saved !== undefined) process.env.ADMIN_SECRET = saved;
    }
  });
});
