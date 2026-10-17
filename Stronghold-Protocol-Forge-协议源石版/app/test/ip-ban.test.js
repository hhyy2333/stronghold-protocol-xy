// test/ip-ban.test.js — 封禁 IP（server/bans.js 的规则与名单、server/banStore.js 的落盘，以及它在
// server/http/routes.js、server/http/websocket.js、server/net.js 三条路上的拦截）。
//
// 这套测试的重点不是"能封人"，而是四件容易做错的事：
//   1. 规则解析（IPv4/IPv6/CIDR、`::ffff:` 映射、过宽的 CIDR 与坏输入）；
//   2. 落盘是**状态**：读回来还在，且"读不到"绝不等于"空名单"（一次磁盘抖动不能把全服解封）；
//   3. 蓝绿两槽共用一个文件：后写的那一方不能把对方刚封的条目覆盖掉；
//   4. 封禁是立刻生效的：HTTP 403、WS 升级 403、已经开着的 socket 被断开，而且**没有**把邻居一起封掉。

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startServer, BanList, createBanStore } from '../server/index.js';
import { parseBanRule, banRuleMatches, normalizeBanEntry, isBroadRule, BAN_LIST_MAX } from '../server/bans.js';
import { ipBytes } from '../server/net.js';
import { TestClient } from './helpers/wsClient.js';

// ---------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------

/** Raw HTTP request; `xff` fakes the address a trusted local reverse proxy (nginx / cloudflared) forwards. */
function httpReq(port, rawPath, { method = 'GET', headers = {}, xff = null, body = null } = {}) {
  const h = { ...headers };
  if (xff) h['x-forwarded-for'] = xff;
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
const tmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `sp-bans-${tag}-`));

// ---------------------------------------------------------------------------------------------------
// rules: parsing and matching
// ---------------------------------------------------------------------------------------------------

describe('封禁规则（server/bans.js）', () => {
  test('解析 IPv4：精确、CIDR、冗余前缀都归一到同一条规则', () => {
    assert.deepEqual(pick(parseBanRule('203.0.113.7')), { rule: '203.0.113.7', ip: '203.0.113.7', family: 4, prefix: 32, exact: true });
    assert.equal(parseBanRule('203.0.113.7/32').rule.rule, '203.0.113.7', 'an exact address never keeps a redundant /32');
    assert.equal(parseBanRule('203.0.113.0/24').rule.rule, '203.0.113.0/24');
    assert.equal(parseBanRule('203.0.113.7/24').rule.rule, '203.0.113.0/24', 'host bits are masked: one rule, not two spellings');
    assert.equal(parseBanRule(' 203.0.113.0 / 24 ').rule.rule, '203.0.113.0/24');
  });

  test('解析 IPv6：大写、方括号、端口、映射地址', () => {
    assert.equal(parseBanRule('2001:DB8::1').rule.rule, '2001:db8::1');
    assert.equal(parseBanRule('[2001:db8::1]:3000').rule.rule, '2001:db8::1');
    assert.equal(parseBanRule('2001:db8::/64').rule.rule, '2001:db8::/64');
    // ::ffff:a.b.c.d IS the IPv4 address (net.js normalizeIp) — a mapped peer must match its IPv4 rule
    assert.equal(parseBanRule('::ffff:203.0.113.7').rule.rule, '203.0.113.7');
  });

  test('坏输入一律拒绝，并且说得出为什么', () => {
    for (const bad of ['', '   ', 'example.com', '999.1.1.1', '203.0.113.7/33', '203.0.113.7/abc', '2001:db8::/129', '1.2.3', null, 42, {}]) {
      const r = parseBanRule(bad);
      assert.equal(r.ok, false, `should refuse ${JSON.stringify(bad)}`);
      assert.ok(['empty', 'not-an-ip', 'bad-prefix'].includes(r.reason));
    }
  });

  test('匹配按前缀逐位比较，且两个地址族不互相匹配', () => {
    assert.equal(banRuleMatches(parseBanRule('203.0.113.0/24').rule, '203.0.113.7'), true);
    assert.equal(banRuleMatches(parseBanRule('203.0.113.0/24').rule, '203.0.114.7'), false);
    assert.equal(banRuleMatches(parseBanRule('203.0.113.0/24').rule, '2001:db8::1'), false, 'v4 rule vs v6 address');
    assert.equal(banRuleMatches(parseBanRule('2001:db8::/64').rule, '2001:db8::1'), true);
    assert.equal(banRuleMatches(parseBanRule('2001:db8::/64').rule, '2001:db9::1'), false);
    assert.equal(banRuleMatches(parseBanRule('2001:db8::1').rule, '203.0.113.7'), false, 'v6 rule vs v4 address');
    assert.equal(banRuleMatches(parseBanRule('203.0.113.7').rule, '::ffff:203.0.113.7'), true, 'mapped form of the banned v4');
    // a non-byte-aligned prefix: /12 of 10.0.0.0 covers 10.0.0.0–10.15.255.255
    assert.equal(banRuleMatches(parseBanRule('10.0.0.0/12').rule, '10.15.3.4'), true);
    assert.equal(banRuleMatches(parseBanRule('10.0.0.0/12').rule, '10.16.0.1'), false);
  });

  test('过宽的 CIDR 被标出来（调用方除非显式 force 否则拒绝）', () => {
    assert.equal(isBroadRule(parseBanRule('0.0.0.0/0').rule), true);
    assert.equal(isBroadRule(parseBanRule('10.0.0.0/7').rule), true);
    assert.equal(isBroadRule(parseBanRule('10.0.0.0/8').rule), false);
    assert.equal(isBroadRule(parseBanRule('::/0').rule), true);
    assert.equal(isBroadRule(parseBanRule('2001:db8::/15').rule), true);
    assert.equal(isBroadRule(parseBanRule('2001:db8::/16').rule), false);
  });

  test('ipBytes：4 / 16 字节，非地址是 null', () => {
    assert.deepEqual([...ipBytes('203.0.113.7')], [203, 0, 113, 7]);
    assert.equal(ipBytes('2001:db8::1').length, 16);
    assert.equal(ipBytes('nope'), null);
  });

  test('normalizeBanEntry：清洗文本、保留语义，过期不会被升级成永久', () => {
    const now = 1_700_000_000_000;
    const e = normalizeBanEntry({ rule: '203.0.113.7', reason: '  刷屏\u0000  \n 广告 ', by: 'op'.repeat(100), at: now - 5, until: now - 1 }, now);
    assert.equal(e.rule, '203.0.113.7');
    assert.equal(e.reason, '刷屏 广告');
    assert.equal(e.by.length, 64);
    assert.equal(e.until, now - 1, 'an entry that already expired keeps its timestamp — it must NOT become permanent');
    assert.equal(normalizeBanEntry({ rule: 'nope' }, now), null);
  });
});

/** The comparable part of a parse result (the byte array is asserted separately). */
function pick(r) {
  const { rule, ip, family, prefix, exact } = r.rule;
  return { rule, ip, family, prefix, exact };
}

// ---------------------------------------------------------------------------------------------------
// the list and its persistence
// ---------------------------------------------------------------------------------------------------

describe('BanList 与落盘（server/banStore.js）', () => {
  test('封 / 查 / 解，并带出真正生效的那一条', () => {
    const bans = new BanList({ now: () => 1000 });
    const r = bans.add({ rule: '203.0.113.0/24', reason: '刷屏', by: '198.51.100.9' });
    assert.equal(r.ok, true);
    assert.equal(r.added, true);
    assert.equal(r.persisted, true, 'no store = nothing to persist, which is not a failure');
    assert.equal(r.evicted, null, 'no change notification is wired here — the caller must ask itself');
    assert.equal(bans.isBanned('203.0.113.7').rule, '203.0.113.0/24');
    assert.equal(bans.isBanned('203.0.114.7'), null);
    assert.equal(bans.size, 1);

    // the same rule again is a replace, not a second entry
    const again = bans.add({ rule: '203.0.113.0/24', reason: '第二次' });
    assert.equal(again.added, false);
    assert.equal(bans.size, 1);
    assert.equal(bans.get('203.0.113.7'), null, '...but `get` is by rule text, not by coverage');
    assert.equal(bans.get('203.0.113.0/24').reason, '第二次');

    assert.deepEqual(bans.remove('203.0.113.7/24'), { ok: true, removed: true, size: 0, persisted: true }, 'a redundant prefix still removes it');
    assert.equal(bans.remove('203.0.113.0/24').removed, false);
    assert.equal(bans.remove('  ').ok, false);
  });

  test('过宽与坏规则被拒绝（force 才放行）', () => {
    const bans = new BanList();
    assert.equal(bans.add({ rule: '0.0.0.0/0' }).error, 'TOO_BROAD');
    assert.equal(bans.add({ rule: '1.2.3.4/99' }).error, 'BAD_RULE');
    assert.equal(bans.add({ rule: '0.0.0.0/0', force: true }).ok, true);
    assert.equal(bans.size, 1);
  });

  test('到期即失效，且不会再被写回盘上', () => {
    let now = 1_000_000;
    const dir = tmp('ttl');
    const store = createBanStore({ dir, log: silent(), now: () => now });
    const bans = new BanList({ store, now: () => now });
    bans.add({ rule: '203.0.113.7', minutes: 10 });
    assert.equal(bans.isBanned('203.0.113.7') !== null, true);
    assert.equal(JSON.parse(fs.readFileSync(store.file, 'utf8')).bans.length, 1);

    now += 10 * 60_000 + 1;
    assert.equal(bans.isBanned('203.0.113.7'), null);
    assert.equal(bans.size, 0);
    bans.add({ rule: '198.51.100.1' });
    assert.deepEqual(JSON.parse(fs.readFileSync(store.file, 'utf8')).bans.map((b) => b.rule), ['198.51.100.1'], 'the expired one is gone from the file too');
  });

  test('落盘 → 重新启动（新的 BanList）仍然封着', () => {
    const dir = tmp('boot');
    const store = createBanStore({ dir, log: silent() });
    const first = new BanList({ store, now: () => 5000 });
    first.add({ rule: '203.0.113.0/24', reason: '广告', by: '198.51.100.9' });
    first.add({ rule: '2001:db8::/64' });

    const state = createBanStore({ dir, log: silent() }).readState();
    assert.equal(state.ok, true);
    const second = new BanList({ now: () => 5000 });
    second.adopt(state.entries, { silent: true });
    assert.equal(second.size, 2);
    assert.equal(second.isBanned('203.0.113.7').reason, '广告');
    assert.equal(second.isBanned('2001:db8:0:0:1:2:3:4').rule, '2001:db8::/64');
  });

  test('文件不存在 = 没有封禁；文件读不动 / 坏 JSON = 什么都不知道（绝不等于空名单）', () => {
    const dir = tmp('state');
    const store = createBanStore({ dir, log: silent() });
    assert.deepEqual(store.readState(), { ok: true, entries: [] }, 'a missing file is a legitimate empty list');

    fs.writeFileSync(store.file, '{ this is not json', 'utf8');
    assert.equal(store.readState().ok, false, 'a broken file must not read as "nobody is banned"');
    const bans = new BanList({ store, now: () => 1000 });
    bans.add({ rule: '203.0.113.7' });
    assert.equal(bans.isBanned('203.0.113.7') !== null, true, 'and adopting that read changes nothing');

    fs.writeFileSync(store.file, JSON.stringify({ version: 1, bans: 'nope' }), 'utf8');
    assert.equal(store.readState().ok, false, 'a wrong shape is also "unknown", not "empty"');
  });

  test('盘上的坏条目被丢掉，好条目照旧生效（盘是信任边界之外）', () => {
    const dir = tmp('dirty');
    const store = createBanStore({ dir, log: silent() });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(store.file, JSON.stringify({
      version: 1,
      bans: [
        { rule: '203.0.113.7', reason: 'ok', by: 'x', at: 1, until: null },
        { rule: 'not-an-ip' },
        { rule: '203.0.113.0/24', until: 'later' },
        null,
      ],
    }), 'utf8');
    const state = store.readState();
    assert.equal(state.ok, true);
    assert.equal(state.entries.length, 2);
    assert.equal(state.entries[1].until, null, 'a non-numeric until is "permanent", the only sane reading');
  });

  test('蓝绿两槽共用一个文件：后写的一方不会把对方刚封的条目覆盖掉', () => {
    const dir = tmp('twoslot');
    const storeA = createBanStore({ dir, log: silent() });
    const storeB = createBanStore({ dir, log: silent() });
    const a = new BanList({ store: storeA, now: () => 1000 });
    const b = new BanList({ store: storeB, now: () => 1000 });

    a.add({ rule: '203.0.113.7' });
    // B never polled the file: it still believes the list is empty, and this is exactly where a naive write loses A's ban
    b.add({ rule: '198.51.100.1' });
    assert.deepEqual(JSON.parse(fs.readFileSync(storeA.file, 'utf8')).bans.map((x) => x.rule).sort(), ['198.51.100.1', '203.0.113.7']);

    // and A adopts B's entry on its next poll
    const state = storeA.readState();
    const adopted = a.adopt(state.entries);
    assert.equal(adopted.changed, true, 'the poll sees the other slot\'s change');
    assert.equal(a.isBanned('198.51.100.1') !== null, true);
    assert.equal(a.adopt(state.entries).changed, false, 'reading the same list again is not a change (and must not re-drop sockets)');
  });

  test('名单有上限，不会无界增长', () => {
    const bans = new BanList({ max: 2, now: () => 1000 });
    assert.equal(bans.add({ rule: '203.0.113.1' }).ok, true);
    assert.equal(bans.add({ rule: '203.0.113.2' }).ok, true);
    assert.equal(bans.add({ rule: '203.0.113.3' }).error, 'FULL');
    assert.ok(BAN_LIST_MAX >= 100, 'the production cap is a memory guard, not a policy');
  });

  test('目录不可写时封禁仍然生效（只是活不过重启）', () => {
    const dir = path.join(tmp('ro'), 'nested-file');
    fs.writeFileSync(dir, 'not a directory', 'utf8');
    const bans = new BanList({ store: createBanStore({ dir, log: silent() }), now: () => 1000 });
    const r = bans.add({ rule: '203.0.113.7' });
    assert.equal(r.ok, true);
    assert.equal(r.persisted, false);
    assert.equal(bans.isBanned('203.0.113.7') !== null, true);
  });
});

/** A logger that swallows the expected warnings of these tests. */
function silent() { return { info() {}, warn() {}, error() {}, debug() {} }; }

// ---------------------------------------------------------------------------------------------------
// enforcement over HTTP and WebSocket
// ---------------------------------------------------------------------------------------------------

describe('封禁的拦截（HTTP 403 / WS 403 / 立刻断线）', () => {
  let srv;
  const OP = '198.51.100.9';     // the operator's address (never banned)
  const BAD = '203.0.113.7';     // the address under test
  const NEIGHBOR = '203.0.113.8'; // one address over: must keep working

  before(async () => {
    // bansDir: null keeps the machine's real ~/sp-bans out of the test; the list still enforces from memory.
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, adminSecret: SECRET, bansDir: null, banPollMs: 0 });
  });
  after(async () => { await srv?.close(); });

  test('封禁后：该地址的每个 HTTP 路径都是 403，邻居一切照旧', async () => {
    assert.equal((await httpReq(srv.port, '/')).status, 200, 'before the ban the address is served normally');

    const add = await httpReq(srv.port, '/api/admin/bans', { method: 'POST', headers: auth(SECRET), xff: OP, body: { rule: BAD, reason: '刷屏' } });
    assert.equal(add.status, 200);
    assert.equal(json(add).ok, true);

    for (const p of ['/', '/healthz', '/data/config.json', '/api/admin/overview', '/api/feedback']) {
      const r = await httpReq(srv.port, p, { xff: BAD, headers: auth(SECRET) });
      assert.equal(r.status, 403, p);
      assert.match(r.body.toString(), /此地址已被服务器封禁/, p);
    }
    // the operator's note is NOT echoed to the banned client (it is written for the panel and can name a person)
    assert.doesNotMatch((await httpReq(srv.port, '/', { xff: BAD })).body.toString(), /刷屏/);

    assert.equal((await httpReq(srv.port, '/', { xff: NEIGHBOR })).status, 200);
    assert.equal((await httpReq(srv.port, '/healthz', { xff: NEIGHBOR })).status, 200);
    assert.equal((await httpReq(srv.port, '/api/admin/overview', { headers: auth(SECRET), xff: NEIGHBOR })).status, 200);
  });

  test('被 ban 的地址连不上 /ws（升级就被 403），邻居连得上', async () => {
    // re-assert the ban so this test does not depend on the previous one having run
    await httpReq(srv.port, '/api/admin/bans', { method: 'POST', headers: auth(SECRET), xff: OP, body: { rule: BAD } });
    const url = `ws://127.0.0.1:${srv.port}/ws`;
    await assert.rejects(
      () => TestClient.connect(url, { wsOptions: { headers: { 'x-forwarded-for': BAD } } }),
      /403/,
      'a banned client must not reach the protocol at all',
    );
    const ok = await TestClient.connect(url, { wsOptions: { headers: { 'x-forwarded-for': NEIGHBOR } } });
    await ok.hello('邻居');
    await ok.close();
  });

  test('封禁当场断掉已经开着的 socket，别人的会话不受影响', async () => {
    const url = `ws://127.0.0.1:${srv.port}/ws`;
    const banned = await TestClient.connect(url, { wsOptions: { headers: { 'x-forwarded-for': '203.0.113.77' } } });
    await banned.hello('要被封的人');
    const bystander = await TestClient.connect(url, { wsOptions: { headers: { 'x-forwarded-for': NEIGHBOR } } });
    await bystander.hello('旁人');

    const add = await httpReq(srv.port, '/api/admin/bans', { method: 'POST', headers: auth(SECRET), xff: OP, body: { rule: '203.0.113.77' } });
    assert.equal(add.status, 200);
    assert.equal(json(add).evicted, 1, 'the response says how many sockets the ban took down');

    const closed = await banned.closed;
    assert.equal(closed.code, 1008, 'a closed-by-policy frame, not a silent TCP reset');
    assert.equal(closed.reason, 'banned');
    assert.equal(bystander.isOpen, true, 'the neighbour keeps its session');
    await bystander.close();
  });
});

// ---------------------------------------------------------------------------------------------------
// the admin API
// ---------------------------------------------------------------------------------------------------

describe('封禁 API（/api/admin/bans）', () => {
  let srv;
  const OP = '198.51.100.9';

  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, adminSecret: SECRET, bansDir: null, banPollMs: 0 });
  });
  after(async () => { await srv?.close(); });

  test('没有口令 = 没有这个接口（404，而不是 401）', async () => {
    const bare = await startServer({ port: 0, host: '127.0.0.1', quiet: true, adminSecret: '', bansDir: null, banPollMs: 0 });
    try {
      assert.equal((await httpReq(bare.port, '/api/admin/bans')).status, 404);
      assert.equal((await httpReq(bare.port, '/api/admin/bans', { method: 'POST', body: { rule: '203.0.113.7' } })).status, 404);
    } finally { await bare.close(); }
  });

  test('读要口令；写只收 POST，其它方法 405', async () => {
    assert.equal((await httpReq(srv.port, '/api/admin/bans')).status, 401);
    assert.equal((await httpReq(srv.port, '/api/admin/bans', { headers: auth('wrong-token-entirely') })).status, 401);
    const put = await httpReq(srv.port, '/api/admin/bans', { method: 'PUT', headers: auth(SECRET), body: { rule: '203.0.113.7' } });
    assert.equal(put.status, 405);
    assert.equal(put.headers.allow, 'GET, HEAD, POST');
  });

  test('封 / 列 / 解 一整圈，并拒绝坏规则与过宽规则', async () => {
    const bad = await httpReq(srv.port, '/api/admin/bans', { method: 'POST', headers: auth(SECRET), xff: OP, body: { rule: 'example.com' } });
    assert.equal(bad.status, 400);
    assert.equal(json(bad).error, 'BAD_RULE');

    const broad = await httpReq(srv.port, '/api/admin/bans', { method: 'POST', headers: auth(SECRET), xff: OP, body: { rule: '0.0.0.0/0' } });
    assert.equal(broad.status, 400);
    assert.equal(json(broad).error, 'TOO_BROAD');

    const added = await httpReq(srv.port, '/api/admin/bans', { method: 'POST', headers: auth(SECRET), xff: OP, body: { rule: '203.0.113.0/24', reason: '广告', minutes: 30 } });
    assert.equal(added.status, 200);
    const entry = json(added).ban;
    assert.equal(entry.rule, '203.0.113.0/24');
    assert.equal(entry.reason, '广告');
    assert.equal(entry.by, OP, 'the entry records who did it (the operator address)');
    assert.ok(entry.until > entry.at, 'minutes becomes an absolute expiry');

    const list = await httpReq(srv.port, '/api/admin/bans', { headers: auth(SECRET) });
    assert.equal(list.status, 200);
    assert.equal(json(list).size, 1);
    assert.equal(json(list).bans[0].rule, '203.0.113.0/24');

    const removed = await httpReq(srv.port, `/api/admin/bans/remove?rule=${encodeURIComponent('203.0.113.0/24')}`, { method: 'POST', headers: auth(SECRET) });
    assert.equal(removed.status, 200);
    assert.equal(json(removed).removed, true);
    assert.equal(json(removed).size, 0);

    const again = await httpReq(srv.port, '/api/admin/bans/remove', { method: 'POST', headers: auth(SECRET), body: { rule: '203.0.113.0/24' } });
    assert.equal(again.status, 200);
    assert.equal(json(again).removed, false, 'removing something that is not there is not an error');
  });

  test('默认不许把自己封在外面（force 才放行）', async () => {
    const self = await httpReq(srv.port, '/api/admin/bans', { method: 'POST', headers: auth(SECRET), xff: OP, body: { rule: OP } });
    assert.equal(self.status, 409);
    assert.equal(json(self).error, 'SELF');

    const covering = await httpReq(srv.port, '/api/admin/bans', { method: 'POST', headers: auth(SECRET), xff: OP, body: { rule: '198.51.100.0/24' } });
    assert.equal(json(covering).error, 'SELF', 'a CIDR covering the caller counts as self too');

    const forced = await httpReq(srv.port, '/api/admin/bans', { method: 'POST', headers: auth(SECRET), xff: OP, body: { rule: OP, force: true } });
    assert.equal(forced.status, 200);
    assert.equal(json(forced).added, true);
    // ...and the operator is now locked out of the very API they used, which is why the guard exists
    assert.equal((await httpReq(srv.port, '/api/admin/bans', { headers: auth(SECRET), xff: OP })).status, 403);
    const undone = await httpReq(srv.port, '/api/admin/bans/remove', { method: 'POST', headers: auth(SECRET), body: { rule: OP } });
    assert.equal(undone.status, 200);
    assert.equal((await httpReq(srv.port, '/api/admin/bans', { headers: auth(SECRET), xff: OP })).status, 200);
  });
});
