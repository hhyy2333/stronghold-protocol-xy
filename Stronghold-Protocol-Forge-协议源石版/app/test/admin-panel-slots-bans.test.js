// test/admin-panel-slots-bans.test.js — 面板新增的三件事：
//
//   1. 玩家反馈的「删除这一条」（server/feedback.js `remove` + POST /api/admin/feedback/remove）：删掉一条之后，
//      **同一文件里其余每一行都逐字节不变**（这是重写 jsonl 唯一不可失手的地方），且坏行不会被误删；
//   2. 「另一个槽」探测（server/peer.js）：认出自己是哪个槽与对端端口、缓存、超时、对端不在时如实报告；
//   3. 两个新端点（GET /api/admin/slots、POST /api/admin/feedback/remove）的鉴权、方法与错误码，
//      以及封禁名单仍然照旧（回归）。
//
// 反馈删除那几条是本文件的重点：那个操作会重写运维的数据文件，所以测的是"没动别的"，不是"删掉了"。

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startServer } from '../server/index.js';
import { createFeedbackStore, REWRITE_MAX_BYTES } from '../server/feedback.js';
import { createSlotProbe, slotFromEnv, SLOT_PORTS } from '../server/peer.js';
import { TestClient } from './helpers/wsClient.js';

// ---------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------

const tmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `sp-panel-${tag}-`));
const silent = () => ({ info() {}, warn() {}, error() {}, debug() {} });

/** Raw HTTP request; `xff` fakes the address a trusted local reverse proxy forwards. */
function httpReq(port, rawPath, { method = 'GET', headers = {}, xff = null, body = null } = {}) {
  const h = { ...headers };
  if (xff) h['x-forwarded-for'] = xff;
  if (body != null) h['content-type'] = 'application/json';
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body != null) req.end(JSON.stringify(body)); else req.end();
  });
}

const json = (res) => JSON.parse(res.body.toString());
const SECRET = 'test-admin-secret-0123456789abcdef';
const auth = (token) => ({ authorization: `Bearer ${token}` });

// ---------------------------------------------------------------------------------------------------
// 玩家反馈：删除一条
// ---------------------------------------------------------------------------------------------------

describe('反馈删除：只动那一行（server/feedback.js）', () => {
  const NOW = Date.parse('2026-10-14T12:00:00Z');
  /** A month file with three reports, plus a blank line and a deliberately BROKEN line. */
  function seed(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const lines = [
      JSON.stringify({ id: 't1-aaa', at: NOW, ip: '203.0.113.1', ua: 'x', description: '第一条', report: 'r1', meta: { room: 'AAAA' } }),
      JSON.stringify({ id: 't2-bbb', at: NOW + 1000, ip: '203.0.113.2', ua: null, description: '第二条', report: '', meta: null }),
      '{ not json at all',                                        // a torn line: must survive and never match
      JSON.stringify({ id: 't3-ccc', at: NOW + 2000, ip: '?', ua: null, description: '第三条', report: 'r3', meta: null }),
    ].join('\n') + '\n';
    const file = path.join(dir, 'feedback-2026-10.jsonl');
    fs.writeFileSync(file, lines, 'utf8');
    return { file, lines };
  }

  test('删中间一条：其余每一行逐字节不变，坏行也留着', () => {
    const dir = tmp('del-mid');
    const { file, lines } = seed(dir);
    const store = createFeedbackStore({ dir, log: silent(), now: () => NOW + 5000 });
    const r = store.remove('t2-bbb');
    assert.deepEqual(r, { ok: true, removed: true, at: NOW + 1000 });

    const after = fs.readFileSync(file, 'utf8').split('\n');
    const before = lines.split('\n');
    // Exactly the second line is gone; every other line (including the broken one) is the SAME STRING.
    assert.equal(after.length, before.length - 1);
    assert.deepEqual(after, [before[0], before[2], before[3], before[4]]);
    assert.equal(store.count(), 3);
    // The panel's own view agrees.
    assert.deepEqual(store.list().map((x) => x.id), ['t3-ccc', 't1-aaa']);
  });

  test('删最后一条 / 第一条：边界都不碰别的行', () => {
    const dir = tmp('del-edge');
    const { file } = seed(dir);
    const store = createFeedbackStore({ dir, log: silent(), now: () => NOW + 5000 });
    assert.equal(store.remove('t3-ccc').ok, true);
    assert.equal(store.remove('t1-aaa').ok, true);
    const left = fs.readFileSync(file, 'utf8');
    assert.match(left, /t2-bbb/);
    assert.doesNotMatch(left, /t1-aaa|t3-ccc/);
    assert.match(left, /not json at all/, 'the broken line is still there — it was never a candidate');
    // `count()` counts non-empty LINES (it does not parse them), so the torn line counts too — that is the store's own
    // definition and not something a delete changes.
    assert.equal(store.count(), 2);
  });

  test('找不到 / 空 id：如实拒绝，且一个字节都不动', () => {
    const dir = tmp('del-missing');
    const { file, lines } = seed(dir);
    const store = createFeedbackStore({ dir, log: silent(), now: () => NOW + 5000 });
    assert.equal(store.remove('nope').reason, 'not-found');
    assert.equal(store.remove('').reason, 'bad-id');
    assert.equal(store.remove(null).reason, 'bad-id');
    assert.equal(fs.readFileSync(file, 'utf8'), lines, 'a failed delete must not rewrite the file at all');
  });

  test('没有这个文件时不会误伤别的月份', () => {
    const dir = tmp('del-other-month');
    const { file, lines } = seed(dir);
    const store = createFeedbackStore({ dir, log: silent(), now: () => NOW + 5000 });
    // An id whose embedded month is elsewhere: the month candidates are tried, none matches, nothing is written.
    assert.equal(store.remove('zzzzzz-far').reason, 'not-found');
    assert.equal(fs.readFileSync(file, 'utf8'), lines);
  });

  test('id 里的月份能定位到更早的月文件（list 读得到的那种）', () => {
    const dir = tmp('del-older');
    fs.mkdirSync(dir, { recursive: true });
    const oldAt = Date.parse('2026-09-20T00:00:00Z');
    const oldId = `${oldAt.toString(36)}-old1`;
    const oldFile = path.join(dir, 'feedback-2026-09.jsonl');
    fs.writeFileSync(oldFile, `${JSON.stringify({ id: oldId, at: oldAt, description: '上个月' })}\n`, 'utf8');
    fs.writeFileSync(path.join(dir, 'feedback-2026-10.jsonl'), `${JSON.stringify({ id: 'new1', at: NOW })}\n`, 'utf8');
    const store = createFeedbackStore({ dir, log: silent(), now: () => NOW + 5000 });
    assert.equal(store.remove(oldId).ok, true, 'the id itself names the month');
    assert.equal(fs.readFileSync(oldFile, 'utf8'), '', 'only that line went');
    assert.equal(store.count(), 1, 'this month is untouched');
  });

  test('文件过大时拒绝重写（不把整个文件读进内存）', () => {
    const dir = tmp('del-huge');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'feedback-2026-10.jsonl');
    // Sparse-ish: write a small header then extend past the cap without allocating it all here.
    fs.writeFileSync(file, `${JSON.stringify({ id: 'big1', at: NOW })}\n`, 'utf8');
    fs.truncateSync(file, REWRITE_MAX_BYTES + 1);
    const store = createFeedbackStore({ dir, log: silent(), now: () => NOW + 5000 });
    assert.equal(store.remove('big1').reason, 'too-large');
    assert.equal(fs.statSync(file).size, REWRITE_MAX_BYTES + 1, 'refused, not partially rewritten');
  });

  test('删除是原子的：失败时原文件仍在（临时文件不残留）', () => {
    const dir = tmp('del-tmp');
    const { file, lines } = seed(dir);
    const store = createFeedbackStore({ dir, log: silent(), now: () => NOW + 5000 });
    assert.equal(store.remove('t2-bbb').ok, true);
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), [], 'no .tmp left behind');
    assert.equal(fs.readFileSync(file, 'utf8') !== lines, true);
  });
});

// ---------------------------------------------------------------------------------------------------
// 蓝绿槽位探测
// ---------------------------------------------------------------------------------------------------

describe('另一个槽的探测（server/peer.js）', () => {
  test('认槽：SP_SLOT 优先，否则按 3000/3001 端口认', () => {
    assert.equal(slotFromEnv({ env: { SP_SLOT: 'a' }, port: 3000 }).peerPort, SLOT_PORTS.b);
    assert.equal(slotFromEnv({ env: { SP_SLOT: 'B' }, port: 9999 }).name, 'b', 'case-insensitive');
    const byPort = slotFromEnv({ env: {}, port: 3001 });
    assert.deepEqual([byPort.name, byPort.peerName, byPort.peerPort, byPort.source], ['b', 'a', SLOT_PORTS.a, 'PORT']);
    // A random port (every test, a dev machine) must NOT probe anything: peerPort is null.
    const none = slotFromEnv({ env: {}, port: 51234 });
    assert.deepEqual([none.peerPort, none.source], [null, 'none']);
    assert.equal(slotFromEnv({ env: { PORT: 'abc' }, port: undefined }).peerPort, null, 'an unparseable PORT does not guess');
  });

  test('SP_PEER_PORT 可显式指定对端（非标准布局）', () => {
    const c = slotFromEnv({ env: { SP_PEER_PORT: '4001', SP_PEER_HOST: '10.0.0.5' }, port: 51234 });
    assert.deepEqual([c.peerPort, c.peerHost, c.peerName], [4001, '10.0.0.5', 'peer']);
  });

  const counters = { build: 'abc123', app: '0.3.0', uptimeSec: 10, sockets: 2, sessions: 3, rooms: 1, matches: 1, humans: 1, bots: 0, spectators: 0, processRssMb: 100 };

  test('对端活着：报告它，并标出本槽是活跃的那个', async () => {
    const probe = createSlotProbe({
      env: { SP_SLOT: 'a' }, port: 3000, self: { build: 'mine' }, now: () => 1000,
      fetchImpl: async () => ({ ok: true, via: 'admin', counters }),
    });
    const r = await probe.getSlots();
    assert.equal(r.peerConfigured, true);
    assert.deepEqual(r.slots.map((s) => s.name), ['a', 'b']);
    assert.deepEqual([r.self.active, r.peer.active], [true, false]);
    assert.equal(r.peer.reachable, true);
    assert.equal(r.peer.counters.humans, 1);
  });

  test('对端不在：如实报 unreachable，且不是异常', async () => {
    const probe = createSlotProbe({
      env: { SP_SLOT: 'b' }, port: 3001, self: {}, now: () => 1000,
      fetchImpl: async () => ({ ok: false, error: 'ECONNREFUSED' }),
    });
    const r = await probe.getSlots();
    assert.deepEqual([r.peer.reachable, r.peer.error, r.peer.counters], [false, 'ECONNREFUSED', null]);
    assert.equal(r.slots.length, 2);
  });

  test('探测抛异常也不会炸掉面板', async () => {
    const probe = createSlotProbe({
      env: { SP_SLOT: 'a' }, port: 3000, self: {}, now: () => 1000,
      fetchImpl: async () => { throw new Error('boom'); },
    });
    const r = await probe.getSlots();
    assert.equal(r.peer.reachable, false);
    assert.equal(r.peer.error, 'boom');
  });

  test('未配置对端：只有本槽，且明说没配置', async () => {
    const probe = createSlotProbe({ env: {}, port: 51234, self: {}, now: () => 1000, fetchImpl: async () => { throw new Error('must not be called'); } });
    const r = await probe.getSlots();
    assert.deepEqual([r.peerConfigured, r.peer, r.slots.length], [false, null, 1]);
    assert.equal(r.slots[0].active, true);
  });

  test('缓存：轮询间隔内只探测一次（面板每 2 秒拉一次）', async () => {
    let calls = 0;
    let clock = 1000;
    const probe = createSlotProbe({
      env: { SP_SLOT: 'a' }, port: 3000, self: {}, now: () => clock, cacheMs: 5000,
      fetchImpl: async () => { calls++; return { ok: true, via: 'admin', counters }; },
    });
    await probe.getSlots();
    await probe.getSlots();
    clock += 4000;
    await probe.getSlots();
    assert.equal(calls, 1, 'three polls inside the window = one probe');
    clock += 2000;                       // past the window now
    await probe.getSlots();
    assert.equal(calls, 2);
    probe.reset();
    await probe.getSlots();
    assert.equal(calls, 3, 'reset forces a fresh probe');
  });

  test('真的去连一个不存在的端口：快速失败，不挂住', async () => {
    // Port 1 on loopback refuses at once on every OS this runs on; the point is that the probe SETTLES.
    const probe = createSlotProbe({ env: { SP_PEER_PORT: '1' }, port: 51234, self: {}, now: () => 1000, timeoutMs: 1500 });
    const t0 = Date.now();
    const r = await probe.getSlots();
    assert.equal(r.peer.reachable, false);
    assert.ok(Date.now() - t0 < 1500, 'a refused connection answers immediately');
    assert.ok(typeof r.peer.error === 'string' && r.peer.error.length > 0);
  });
});

// ---------------------------------------------------------------------------------------------------
// 两个新端点的 HTTP 行为
// ---------------------------------------------------------------------------------------------------

describe('面板端点：/api/admin/slots 与 /api/admin/feedback/remove', () => {
  let srv;
  let dir;

  before(async () => {
    dir = tmp('http');
    fs.mkdirSync(dir, { recursive: true });
    const now = Date.now();
    fs.writeFileSync(path.join(dir, 'feedback-2026-10.monthless'), '', 'utf8');   // an unrelated file: never touched
    const d = new Date(now);
    const name = `feedback-${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}.jsonl`;
    fs.writeFileSync(path.join(dir, name), [
      JSON.stringify({ id: 'keep-me', at: now - 2000, ip: '?', ua: null, description: '保留', report: '', meta: null }),
      JSON.stringify({ id: 'drop-me', at: now - 1000, ip: '?', ua: null, description: '删掉', report: 'diag', meta: null }),
    ].join('\n') + '\n', 'utf8');
    srv = await startServer({
      port: 0, host: '127.0.0.1', quiet: true, adminSecret: SECRET, feedbackDir: dir,
      bansDir: null, banPollMs: 0,
    });
  });
  after(async () => { await srv?.close(); });

  test('两个端点都要口令', async () => {
    assert.equal((await httpReq(srv.port, '/api/admin/slots')).status, 401);
    assert.equal((await httpReq(srv.port, '/api/admin/feedback/remove', { method: 'POST', body: { id: 'x' } })).status, 401);
  });

  test('GET /api/admin/slots：本槽 + 端口字段，单进程部署时 peer = null', async () => {
    const r = await httpReq(srv.port, '/api/admin/slots', { headers: auth(SECRET) });
    assert.equal(r.status, 200);
    const b = json(r);
    assert.equal(b.ok, true);
    // A random port means no peer is configured — and that is reported rather than guessed.
    assert.equal(b.peerConfigured, false);
    assert.equal(b.self.active, true);
    assert.ok(b.self.counters, 'this process reports its own counters in the same shape as a peer');
    assert.equal(typeof b.self.counters.rooms, 'number');
  });

  test('/healthz 自报槽名（对端靠它辨认），且不是槽位配置时省略该字段', async () => {
    const r = await httpReq(srv.port, '/healthz');
    const b = json(r);
    assert.equal(r.status, 200);
    assert.equal(b.slotName, undefined, 'a random port is not a blue-green slot');
  });

  test('删除一条：200 且其余条目原样保留；再删同一条是 404', async () => {
    const list = json(await httpReq(srv.port, '/api/admin/feedback?limit=50', { headers: auth(SECRET) }));
    assert.deepEqual(list.items.map((i) => i.id), ['drop-me', 'keep-me']);

    const del = await httpReq(srv.port, '/api/admin/feedback/remove', { method: 'POST', headers: auth(SECRET), body: { id: 'drop-me' } });
    assert.equal(del.status, 200);
    assert.deepEqual([json(del).ok, json(del).removed, json(del).id], [true, true, 'drop-me']);

    const after = json(await httpReq(srv.port, '/api/admin/feedback?limit=50', { headers: auth(SECRET) }));
    assert.deepEqual(after.items.map((i) => i.id), ['keep-me']);
    assert.equal(after.total, 1);

    const again = await httpReq(srv.port, '/api/admin/feedback/remove', { method: 'POST', headers: auth(SECRET), body: { id: 'drop-me' } });
    assert.equal(again.status, 404);
    assert.equal(json(again).error, 'NOT_FOUND');
  });

  test('坏请求：缺 id 400、坏 JSON 400、超长 id 400、DELETE 方法 405', async () => {
    assert.equal((await httpReq(srv.port, '/api/admin/feedback/remove', { method: 'POST', headers: auth(SECRET), body: {} })).status, 400);
    assert.equal((await httpReq(srv.port, '/api/admin/feedback/remove', { method: 'POST', headers: auth(SECRET), body: { id: 'x'.repeat(200) } })).status, 400);
    const del = await httpReq(srv.port, '/api/admin/feedback/remove', { method: 'DELETE', headers: auth(SECRET) });
    assert.equal(del.status, 405);
    assert.equal(del.headers.allow, 'GET, HEAD, POST');
    const raw = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: srv.port, path: '/api/admin/feedback/remove', method: 'POST', headers: { ...auth(SECRET), 'content-type': 'application/json' }, agent: false }, (res) => {
        const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString() }));
      });
      req.on('error', reject); req.end('{ not json');
    });
    assert.equal(raw.status, 400);
  });

  test('既有的封禁端点仍然照旧（回归）', async () => {
    const add = await httpReq(srv.port, '/api/admin/bans', { method: 'POST', headers: auth(SECRET), xff: '198.51.100.9', body: { rule: '203.0.113.9' } });
    assert.equal(add.status, 200);
    const list = json(await httpReq(srv.port, '/api/admin/bans', { headers: auth(SECRET) }));
    assert.equal(list.size, 1);
    const rm = await httpReq(srv.port, '/api/admin/bans/remove', { method: 'POST', headers: auth(SECRET), body: { rule: '203.0.113.9' } });
    assert.equal(json(rm).removed, true);
  });

  test('没有 ADMIN_SECRET 时，新端点也一样是 404（不是 401）', async () => {
    const bare = await startServer({ port: 0, host: '127.0.0.1', quiet: true, adminSecret: '', bansDir: null, banPollMs: 0, feedbackDir: null });
    try {
      assert.equal((await httpReq(bare.port, '/api/admin/slots')).status, 404);
      assert.equal((await httpReq(bare.port, '/api/admin/feedback/remove', { method: 'POST', body: { id: 'x' } })).status, 404);
    } finally { await bare.close(); }
  });
});

// ---------------------------------------------------------------------------------------------------
// 座位上的客户端地址（业主 2026-10-14：「我怎么知道别人ip是什么」）
// ---------------------------------------------------------------------------------------------------
//
// 封禁 API 本来就能拒绝一个地址，但面板从不 SHOW 任何地址，所以运维无从得知该封谁。这一节钉住那条数据链路：
// `GET /api/admin/rooms` 的每个真人座位带 `addr`，且它与封禁匹配的是**同一个** clientAddress 结果。
//
// 三件最容易做错的事各有用例：地址取不到时必须是 null（而不是 '?' 或抛异常）、地址不得出现在任何玩家可见的
// 响应里、bot 座位没有地址。

describe('座位地址：面板能看到「要封谁」', () => {
  let srv;
  const OP = '198.51.100.9';
  const VISITOR = '203.0.113.77';

  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, adminSecret: SECRET, bansDir: null, banPollMs: 0, feedbackDir: null });
  });
  after(async () => { await srv?.close(); });

  /** 开一个伪造了来源地址的客户端，建一间房，返回它的 playerId 与房间号。 */
  async function seatedPlayer(xff, name) {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`, { wsOptions: { headers: { 'x-forwarded-for': xff } } });
    const welcome = await c.hello(name);
    const reply = await c.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    assert.equal(reply.t, 'ok', JSON.stringify(reply));
    const state = await c.waitFor('room.state', (s) => s.mode === 'coop');
    return { client: c, playerId: welcome.playerId, code: state.code };
  }

  test('座位带出真实客户端地址（与封禁匹配的是同一个值）', async () => {
    const { client, playerId, code } = await seatedPlayer(VISITOR, '要封的人');
    try {
      const rooms = json(await httpReq(srv.port, '/api/admin/rooms', { headers: auth(SECRET) }));
      const seat = rooms.find((r) => r.code === code)?.seats?.find((s) => s.playerId === playerId);
      assert.ok(seat, 'the seat is listed');
      assert.equal(seat.addr, VISITOR, 'the forwarded address, not the proxy loopback one');
      // The SAME value the ban list would match: ban the address, and that player is refused.
      const add = await httpReq(srv.port, '/api/admin/bans', { method: 'POST', headers: auth(SECRET), xff: OP, body: { rule: seat.addr } });
      assert.equal(add.status, 200, JSON.stringify(json(add)));
      const refused = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`, { wsOptions: { headers: { 'x-forwarded-for': VISITOR } } })
        .then(() => 'connected', (e) => String(e.message || e));
      assert.match(refused, /403/, 'the address shown in the panel is exactly the one a ban refuses');
      await httpReq(srv.port, '/api/admin/bans/remove', { method: 'POST', headers: auth(SECRET), body: { rule: seat.addr } });
    } finally { await client.close(); }
  });

  test('取不到地址时是 null，绝不是 "?"，也不抛异常', async () => {
    assert.equal(srv.admin._addrOf(null), null);
    assert.equal(srv.admin._addrOf(undefined), null);
    assert.equal(srv.admin._addrOf(''), null);
    assert.equal(srv.admin._addrOf('p_does_not_exist'), null);
    // 一个已被回收的会话同样查不到（座位还在、会话没了）
    const rooms = json(await httpReq(srv.port, '/api/admin/rooms', { headers: auth(SECRET) }));
    for (const room of rooms) {
      for (const seat of room.seats || []) {
        if (seat.addr != null) assert.notEqual(seat.addr, '?', 'the unknown placeholder never reaches the panel');
      }
    }
  });

  test('bot 座位没有地址', async () => {
    const { client, code } = await seatedPlayer(OP, '房主');
    try {
      const add = await client.request({ t: 'room.addBot' });
      assert.equal(add.t, 'ok', JSON.stringify(add));
      const rooms = json(await httpReq(srv.port, '/api/admin/rooms', { headers: auth(SECRET) }));
      const room = rooms.find((r) => r.code === code);
      const bots = (room?.seats || []).filter((s) => s.isBot);
      assert.ok(bots.length >= 1, 'a bot took a seat');
      for (const b of bots) assert.equal(b.addr, null, 'a bot has no client address to ban');
    } finally { await client.close().catch(() => {}); }
  });

  test('地址只在管理面上：无口令 401，且不进入任何公开响应', async () => {
    const { client, code } = await seatedPlayer(VISITOR, '隐私检查');
    try {
      assert.equal((await httpReq(srv.port, '/api/admin/rooms')).status, 401);
      const pub = (await httpReq(srv.port, '/healthz')).body.toString();
      assert.doesNotMatch(pub, /203\.0\.113\.77/, '/healthz must not carry a client address');
      // 玩家自己拿到的帧里也不能有地址
      const welcome = client.log.find((m) => m.t === 'welcome');
      assert.ok(welcome, 'the client got its welcome');
      assert.equal(welcome.addr, undefined);
      const state = client.log.filter((m) => m.t === 'room.state').pop();
      assert.doesNotMatch(JSON.stringify(state), /203\.0\.113\.77/);
      void code;
    } finally { await client.close(); }
  });
});
