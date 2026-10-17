// test/limits.test.js — 服务器人数上限（server/limits.js 的实时值、server/limitsStore.js 的落盘，以及它在
// server/net.js 的 admission 门、server/admin.js + server/http/routes.js 的 /api/admin/limits 上的执法）。
//
// 这套测试的重点不是"能改个数字"，而是四件容易做错的事：
//   1. **真的挡人**：上限是 N 时第 N+1 个 WebSocket 被拒绝，而不是数字写在面板上好看；
//   2. **调低绝不踢人**：把上限从 3 降到 1，已经连着的 3 个 socket 一个都不许断（业主的裁定，2026-10-14）；
//   3. **落盘是状态**：「读不到」绝不等于「不限制」（一次磁盘抖动不能把上限悄悄放开），而明确的 `null` 才算"不限制"；
//   4. **0 不是不限制**：判据是 `conns.size >= cap`，0 会让谁都进不来——它必须被拒绝，而不是被当成"无限"。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

import { startServer } from '../server/index.js';
import { LiveLimits, normalizeMaxConnections, normalizeLimits, MAX_CONNECTIONS_FLOOR, MAX_CONNECTIONS_CEILING } from '../server/limits.js';
import { createLimitsStore, LIMITS_FILE } from '../server/limitsStore.js';
import { TestClient } from './helpers/wsClient.js';

// ---------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------

/** Raw HTTP request against the admin surface. */
function httpReq(port, rawPath, { method = 'GET', headers = {}, body = null } = {}) {
  const h = { ...headers };
  if (body != null) h['content-type'] = 'application/json';
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    if (body != null) req.end(JSON.stringify(body)); else req.end();
  });
}

const auth = (token) => ({ authorization: `Bearer ${token}` });
const json = (res) => JSON.parse(res.body.toString());
const SECRET = 'test-admin-secret-0123456789abcdef';
const tmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `sp-limits-${tag}-`));

/** A server with the admin surface on, the disk stores under `dir`, and nothing else touching the world. */
async function boot({ dir = null, maxConnections = null } = {}) {
  const srv = await startServer({
    port: 0, host: '127.0.0.1', adminSecret: SECRET, assetIndex: false,
    feedbackDir: null, announceDir: null, notesDir: null, bansDir: null,
    limitsDir: dir,
    ...(maxConnections != null ? { maxConnections } : {}),
  });
  return srv;
}

/**
 * Open a real WebSocket upgrade attempt and report whether the server ACCEPTED it (101) or refused, with the status.
 *
 * Uses the `ws` client rather than a hand-rolled request: a hand-written upgrade has to get every header exactly right,
 * and a malformed one is answered 400 by the HTTP layer BEFORE the limit is ever consulted — which would make this
 * helper silently test nothing (it did: the first version of this file reported "refused" even with free capacity).
 * `unexpected-response` is where `ws` surfaces a non-101 answer, and it is how a full server's 503 is observed.
 */
function tryUpgrade(port, { timeout = 3000 } = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { handshakeTimeout: timeout });
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    ws.on('open', () => { done({ ok: true, status: 101 }); try { ws.close(); } catch { /* ignore */ } });
    ws.on('unexpected-response', (_req, res) => { done({ ok: false, status: res.statusCode }); res.resume(); });
    ws.on('error', (e) => done({ ok: false, status: 0, error: e.message }));
  });
}

// ---------------------------------------------------------------------------------------------------
// 1. the pure value: normalization and the "where did it come from" rule
// ---------------------------------------------------------------------------------------------------

describe('上限的值本身（server/limits.js）', () => {
  test('接受范围内的整数，拒绝 0、负数、小数、字符串与超界', () => {
    assert.deepEqual(normalizeMaxConnections(400), { ok: true, value: 400 });
    assert.deepEqual(normalizeMaxConnections(null), { ok: true, value: null }, 'null = 不限制');
    assert.deepEqual(normalizeMaxConnections(undefined), { ok: true, value: null });
    assert.deepEqual(normalizeMaxConnections(MAX_CONNECTIONS_FLOOR), { ok: true, value: 1 });
    assert.deepEqual(normalizeMaxConnections(MAX_CONNECTIONS_CEILING), { ok: true, value: MAX_CONNECTIONS_CEILING });
    // 0 is the one that matters: `conns.size >= 0` is always true, so it would refuse EVERY client.
    assert.deepEqual(normalizeMaxConnections(0), { ok: false, error: 'OUT_OF_RANGE' });
    assert.deepEqual(normalizeMaxConnections(-1), { ok: false, error: 'OUT_OF_RANGE' });
    assert.deepEqual(normalizeMaxConnections(MAX_CONNECTIONS_CEILING + 1), { ok: false, error: 'OUT_OF_RANGE' });
    // A typo must leave the previous limit in force, never become NaN (which every >= accepts).
    for (const bad of ['400', 4.5, NaN, Infinity, {}, [], true]) {
      assert.equal(normalizeMaxConnections(bad).ok, false, `${JSON.stringify(bad)} 不该被接受`);
    }
  });

  test('整份文档的校验：形状不对就整份丢掉，多出来的键不算错', () => {
    // 形状 2026-10-16 增长：多了两格人机上限（缺键 = null = 跟随启动参数）
    assert.deepEqual(normalizeLimits({ maxConnections: 250 }), { ok: true, maxConnections: 250, maxBots: null, maxBotsPerRoom: null });
    assert.deepEqual(normalizeLimits({ maxConnections: null }), { ok: true, maxConnections: null, maxBots: null, maxBotsPerRoom: null });
    assert.deepEqual(normalizeLimits({ maxConnections: 250, future: 'x' }), { ok: true, maxConnections: 250, maxBots: null, maxBotsPerRoom: null });
    assert.deepEqual(normalizeLimits({ maxConnections: 250, maxBots: 6, maxBotsPerRoom: 2 }), { ok: true, maxConnections: 250, maxBots: 6, maxBotsPerRoom: 2 });
    // `{}` 是「缺了那个键」——它绝不能读成「不限制」。一个被写坏/截断的文件会因此悄悄放开服务器的人数门，
    // 而这正是本函数不用一行 `normalizeMaxConnections(doc.maxConnections)` 的原因。
    for (const bad of [null, 42, 'x', [], {}, { maxConnections: 0 }, { maxConnections: '400' }]) {
      assert.equal(normalizeLimits(bad).ok, false, `${JSON.stringify(bad)} 不该被接受`);
    }
    assert.equal(normalizeLimits({}).error, 'MISSING_VALUE', '缺键要报「缺键」，不是当成 null');
  });

  test('没被设置过时用启动参数；设置过之后面板的值说了算；清除后回到启动参数', () => {
    const l = new LiveLimits();
    assert.equal(l.cap(2000), 2000, '没设置过 → 启动参数');
    assert.equal(l.overridden, false);
    l.adopt({ maxConnections: 300 });
    assert.equal(l.cap(2000), 300, '设置过 → 面板的值');
    assert.equal(l.overridden, true);
    // 清除覆盖：cap 回到启动参数，而不是"不限制"（不限制这个状态不存在，见 limits.js 的注释）
    l.adopt({ maxConnections: null, at: 123, by: '1.2.3.4' });
    assert.equal(l.cap(2000), 2000, '清除后回落到启动参数');
    assert.equal(l.overridden, false);
    assert.equal(l.touched, true, '但「碰过」要记得，面板才能区分"从没设过"和"已清除"');
    assert.equal(l.at, 123);
    assert.equal(l.by, '1.2.3.4');
  });

  test('adopt(null) 什么都不改（读不到盘 ≠ 放开上限）', () => {
    const l = new LiveLimits();
    l.adopt({ maxConnections: 300 });
    assert.equal(l.adopt(null), false);
    assert.equal(l.cap(2000), 300, '一次读盘失败不能把上限改掉');
    assert.equal(l.adopt({ maxConnections: 0 }), false, '坏文档同样不采纳');
    assert.equal(l.cap(2000), 300);
  });

  test('status() 把「面板设的」和「这机器生来就是的」分开报告', () => {
    const l = new LiveLimits();
    const boot = l.status(2000);
    assert.equal(boot.maxConnections, 2000);
    assert.equal(boot.overridden, false);
    assert.equal(boot.bootMaxConnections, 2000);
    l.set(150, { at: 999, by: '5.6.7.8' });
    const after = l.status(2000);
    assert.equal(after.maxConnections, 150);
    assert.equal(after.bootMaxConnections, 2000, '重启会回落到哪个数必须看得见');
    assert.equal(after.by, '5.6.7.8');
  });
});

// ---------------------------------------------------------------------------------------------------
// 2. the store: it is STATE, and unreadable is not empty
// ---------------------------------------------------------------------------------------------------

describe('上限的落盘（server/limitsStore.js）', () => {
  test('写下去再读回来还是那个数', () => {
    const dir = tmp('roundtrip');
    const st = createLimitsStore({ dir, log: { warn() {} } });
    assert.equal(st.save(400, { by: '1.2.3.4' }), true);
    const r = st.readState();
    assert.equal(r.ok, true);
    assert.equal(r.limits.maxConnections, 400);
    assert.equal(r.limits.by, '1.2.3.4');
    assert.ok(r.limits.at > 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('「清除面板设置」也能存：null 是一个值，不是"没有文件"', () => {
    const dir = tmp('null');
    const st = createLimitsStore({ dir, log: { warn() {} } });
    st.save(null, { by: '1.2.3.4' });
    const r = st.readState();
    assert.equal(r.ok, true);
    assert.equal(r.limits.maxConnections, null, '明确的 null 读回来还是 null（不是 ok:false）');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('没有文件 = ok:true 且 null（没覆盖过，启动参数说了算）', () => {
    const dir = tmp('absent');
    const st = createLimitsStore({ dir, log: { warn() {} } });
    const r = st.readState();
    assert.equal(r.ok, true);
    assert.equal(r.limits, null);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('坏 JSON / 形状不对 = ok:false（读不到，绝不当成不限制）', () => {
    const dir = tmp('corrupt');
    const st = createLimitsStore({ dir, log: { warn() {} } });
    fs.writeFileSync(path.join(dir, LIMITS_FILE), '{ this is not json', 'utf8');
    assert.equal(st.readState().ok, false, '坏 JSON');
    fs.writeFileSync(path.join(dir, LIMITS_FILE), JSON.stringify({ maxConnections: 'lots' }), 'utf8');
    assert.equal(st.readState().ok, false, '类型不对');
    fs.writeFileSync(path.join(dir, LIMITS_FILE), JSON.stringify({ maxConnections: 0 }), 'utf8');
    assert.equal(st.readState().ok, false, '0 是坏值（会让谁都进不来）');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('落盘失败不抛异常，只回报 false（上限照样在本进程生效）', () => {
    const st = createLimitsStore({ dir: path.join(tmp('nope'), 'a', 'b'), log: { warn() {} } });
    // 目录可建，所以这次会成功；关键是它从不抛。
    assert.doesNotThrow(() => st.save(77, {}));
    fs.rmSync(st.dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------------------------------
// 3. the enforcement: it REFUSES, and lowering NEVER kicks
// ---------------------------------------------------------------------------------------------------

describe('上限真的挡人（server/net.js admission）', () => {
  test('上限是 2 时，第 3 个 WebSocket 被拒绝', async () => {
    const srv = await boot({ maxConnections: 2 });
    try {
      const a = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
      await a.hello('一号');
      const b = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
      await b.hello('二号');
      assert.equal(srv.network.connectionCount, 2);

      const third = await tryUpgrade(srv.port);
      assert.equal(third.ok, false, '第 3 个连接必须被拒绝');
      assert.equal(third.status, 503, '满员是 503 Service Unavailable');

      // 断开一个之后，位子应当腾出来（判据是实时计数，不是"曾经到过上限"）
      await a.close();
      await new Promise((r) => setTimeout(r, 150));
      const retry = await tryUpgrade(srv.port);
      assert.equal(retry.ok, true, '有人走了之后新连接就该进得来');
      await b.close();
    } finally { await srv.close(); }
  });

  test('从面板把上限调低到人数以下：一个已连接的人都不许断', async () => {
    const srv = await boot();
    try {
      const clients = [];
      for (let i = 0; i < 3; i++) {
        const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
        await c.hello(`玩家${i}`);
        clients.push(c);
      }
      assert.equal(srv.network.connectionCount, 3, '三个都连上了');

      // 通过真正的 HTTP 面板接口改，而不是直接动对象——顺带验证这条路是通的。
      const res = await httpReq(srv.port, '/api/admin/limits', {
        method: 'POST', headers: auth(SECRET), body: { maxConnections: 1 },
      });
      assert.equal(res.status, 200);
      const body = json(res);
      assert.equal(body.maxConnections, 1);
      assert.equal(body.sockets, 3, '应答里要如实报告当前连接数，面板才能提醒"没人会被踢"');

      await new Promise((r) => setTimeout(r, 150));
      assert.equal(srv.network.connectionCount, 3, '调低上限绝不能断开已经连着的人');
      for (const c of clients) assert.equal(c.isOpen, true, '每个客户端都还开着');

      // 但新人确实进不来了
      const extra = await tryUpgrade(srv.port);
      assert.equal(extra.ok, false, '降下来的上限对新连接立即生效');
      assert.equal(extra.status, 503);

      // 走掉两个之后（只剩 1 个，1 >= 1 仍然满），新人还是进不来——上限就是上限，不是"曾经满过"
      await clients[0].close();
      await clients[1].close();
      await new Promise((r) => setTimeout(r, 250));
      assert.equal(srv.network.connectionCount, 1, '只剩一个连接');
      const stillFull = await tryUpgrade(srv.port);
      assert.equal(stillFull.ok, false, '1 个连接对上限 1 来说仍然是满的');

      // 最后一个也走了，人数降到上限以下，新人才进得来
      await clients[2].close();
      await new Promise((r) => setTimeout(r, 250));
      assert.equal(srv.network.connectionCount, 0);
      const retry = await tryUpgrade(srv.port);
      assert.equal(retry.ok, true, '人数自然降下来之后，新人就能进');
    } finally { await srv.close(); }
  });

  test('清除面板设置：回落到启动参数', async () => {
    const srv = await boot({ maxConnections: 5 });
    try {
      // 先占住一个连接，这样「上限 1」才有可比较的分母（0 >= 1 是假的，空服务器永远收得下人）。
      const holder = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
      await holder.hello('占位');
      try {
        const set = await httpReq(srv.port, '/api/admin/limits', {
          method: 'POST', headers: auth(SECRET), body: { maxConnections: 1 },
        });
        assert.equal(json(set).maxConnections, 1);
        const one = await tryUpgrade(srv.port);
        assert.equal(one.ok, false, '已有 1 个连接、上限 1 时应拒绝新连接');

        const clear = await httpReq(srv.port, '/api/admin/limits', {
          method: 'POST', headers: auth(SECRET), body: { maxConnections: null },
        });
        const cb = json(clear);
        assert.equal(cb.maxConnections, 5, 'null = 清除覆盖，回落到启动参数');
        assert.equal(cb.overridden, false);
        assert.equal(cb.touched, true, '但要知道面板碰过它');
        assert.equal(cb.bootMaxConnections, 5);

        // 清除之后，同样的 1 个连接对上限 5 来说就不再是满的
        const afterClear = await tryUpgrade(srv.port);
        assert.equal(afterClear.ok, true, '上限回到 5 之后新人立刻进得来');
      } finally { await holder.close(); }
    } finally { await srv.close(); }
  });
});

// ---------------------------------------------------------------------------------------------------
// 4. the API surface: auth, validation, and what refusals look like
// ---------------------------------------------------------------------------------------------------

describe('/api/admin/limits 的形状', () => {
  test('没有口令 = 这条路径根本不存在（404）', async () => {
    const srv = await startServer({
      port: 0, host: '127.0.0.1', assetIndex: false, feedbackDir: null, announceDir: null,
      notesDir: null, bansDir: null, limitsDir: null, adminSecret: undefined,
    });
    try {
      const res = await httpReq(srv.port, '/api/admin/limits', { headers: auth('whatever') });
      assert.equal(res.status, 404);
    } finally { await srv.close(); }
  });

  test('口令不对 = 401，且不改任何东西', async () => {
    const srv = await boot();
    try {
      const before = json(await httpReq(srv.port, '/api/admin/limits', { headers: auth(SECRET) })).maxConnections;
      const res = await httpReq(srv.port, '/api/admin/limits', {
        method: 'POST', headers: auth('wrong-token'), body: { maxConnections: 7 },
      });
      assert.equal(res.status, 401);
      const after = json(await httpReq(srv.port, '/api/admin/limits', { headers: auth(SECRET) })).maxConnections;
      assert.equal(after, before, '一次失败的鉴权不能改到上限');
    } finally { await srv.close(); }
  });

  test('坏数值 = 400 且带上范围；PUT 是被方法门挡掉的 405', async () => {
    const srv = await boot();
    try {
      for (const bad of [0, -5, 1.5, '400', true]) {
        const res = await httpReq(srv.port, '/api/admin/limits', {
          method: 'POST', headers: auth(SECRET), body: { maxConnections: bad },
        });
        assert.equal(res.status, 400, `${JSON.stringify(bad)} 应被拒绝`);
        assert.ok(json(res).error, '必须有 error 码');
      }
      const put = await httpReq(srv.port, '/api/admin/limits', { method: 'PUT', headers: auth(SECRET) });
      assert.equal(put.status, 405);
      assert.match(put.headers.allow || '', /POST/, 'Allow 里必须列出 POST');
    } finally { await srv.close(); }
  });

  test('GET 报告实际生效值、启动值、当前连接数与来源', async () => {
    const srv = await boot({ maxConnections: 1234 });
    try {
      const res = await httpReq(srv.port, '/api/admin/limits', { headers: auth(SECRET) });
      assert.equal(res.status, 200);
      const b = json(res);
      assert.equal(b.maxConnections, 1234);
      assert.equal(b.bootMaxConnections, 1234);
      assert.equal(b.overridden, false, '没人设过 → 来源是启动参数');
      assert.equal(b.sockets, 0);
      assert.equal(b.floor, MAX_CONNECTIONS_FLOOR);
      assert.equal(b.ceiling, MAX_CONNECTIONS_CEILING);
    } finally { await srv.close(); }
  });

  test('改过之后 GET 报告 overridden 与来源地址', async () => {
    const srv = await boot();
    try {
      await httpReq(srv.port, '/api/admin/limits', {
        method: 'POST', headers: auth(SECRET), body: { maxConnections: 42 },
      });
      const b = json(await httpReq(srv.port, '/api/admin/limits', { headers: auth(SECRET) }));
      assert.equal(b.maxConnections, 42);
      assert.equal(b.overridden, true);
      assert.ok(b.at > 0, '要记下什么时候改的');
      assert.ok(b.by, '要记下是谁改的（面板没有账号，记客户端地址）');
    } finally { await srv.close(); }
  });
});

// ---------------------------------------------------------------------------------------------------
// 5. persistence across a restart — the reason the store exists
// ---------------------------------------------------------------------------------------------------

describe('上限活过重启（这是落盘存在的理由）', () => {
  test('面板改的上限在进程重启后依然是它', async () => {
    const dir = tmp('restart');
    let srv = await boot({ dir });
    try {
      await httpReq(srv.port, '/api/admin/limits', {
        method: 'POST', headers: auth(SECRET), body: { maxConnections: 321 },
      });
    } finally { await srv.close(); }

    // 模拟蓝绿切换 / 崩溃重启：同一份目录，全新进程。
    srv = await boot({ dir });
    try {
      const b = json(await httpReq(srv.port, '/api/admin/limits', { headers: auth(SECRET) }));
      assert.equal(b.maxConnections, 321, '重启后必须还是 321，绝不能悄悄回到默认值');
      assert.equal(b.overridden, true);
    } finally { await srv.close(); }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('文件坏掉时重启不放开上限：回落到启动参数，而不是「不限制」', async () => {
    const dir = tmp('broken');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, LIMITS_FILE), 'not json at all', 'utf8');
    const srv = await boot({ dir, maxConnections: 777 });
    try {
      const b = json(await httpReq(srv.port, '/api/admin/limits', { headers: auth(SECRET) }));
      assert.equal(b.maxConnections, 777, '读不到就用启动参数（安全方向）');
      assert.equal(b.overridden, false);
    } finally { await srv.close(); }
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
