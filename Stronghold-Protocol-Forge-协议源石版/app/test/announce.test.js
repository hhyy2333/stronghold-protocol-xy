// 全体公告 (shared/announce.js) — the server-wide announcement channel, and its PERSISTENCE.
//
// WHAT THIS FILE PINS. The announcement is the ONE thing an operator can change from /admin/, and the owner asked
// (2026-10-11) that it be durable: "恢复公告，并持久化". So the properties below are the feature, not incidental:
//
//   * a publish reaches EVERY connected session (the lobby and a running match alike) — it walks the session registry,
//     never a room, so there is no "client kind" that misses it;
//   * the current line is written to disk and REPLAYED to every session that connects afterwards, so a player who
//     arrives later still sees it — that is the entire point of persisting;
//   * it survives a RESTART (a new server process reads it back), which is what a deploy or a crash looks like;
//   * it stays up until it is REPLACED or WITHDRAWN — there is no timer that makes it disappear on its own;
//   * withdraw takes it down everywhere and does NOT come back after a restart;
//   * the stored file is a TRUST BOUNDARY: a hand-edited / half-written record must be dropped, never rendered;
//   * the text is sanitized and truncated, the endpoint is rate limited, and the mutation is still fenced in exactly as
//     narrowly as before (POST only on the two announce paths; every other /api/admin/ path stays GET/HEAD).
//
// The server-side assertions use a real server + a real WebSocket; the store assertions use a temp dir so nothing ever
// touches the operator's real ~/sp-announce.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { startServer } from '../server/index.js';
import { createAnnounceStore, defaultAnnounceDir, ANNOUNCE_FILE } from '../server/announceStore.js';
import {
  ANNOUNCE_MAX_LEN, ANNOUNCE_HISTORY_MAX, sanitizeAnnounce, normalizeAnnouncement,
} from '../shared/announce.js';
import { ADMIN_ANNOUNCE_MIN_GAP_MS } from '../server/admin.js';
// 协议源石版: PROTOCOL_VERSION is 2 here (1 upstream), and a hello naming the wrong one is refused outright.
import { PROTOCOL_VERSION } from '../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SECRET = 'test-secret-announce';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quietLog = { info() {}, warn() {}, error() {}, debug() {} };

/** A minimal WS client that collects every `announce` frame it is sent. */
function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const announces = [];
  const ready = new Promise((resolve, reject) => {
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name: 'Tester', version: PROTOCOL_VERSION })));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.t === 'welcome') resolve();
      if (m.t === 'announce') announces.push(m);
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('hello timeout')), 8000);
  });
  return { ws, announces, ready, close: () => new Promise((r) => { ws.on('close', r); ws.close(); setTimeout(r, 200); }) };
}

/** POST a JSON body with the admin token. */
async function post(port, urlPath, body) {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, body: json };
}

describe('announce — text sanitizing', () => {
  test('control characters are stripped, whitespace collapses, ends trim, and it truncates at ANNOUNCE_MAX_LEN', () => {
    assert.equal(sanitizeAnnounce('  你好\u0000世界  '), '你好 世界');
    assert.equal(sanitizeAnnounce('a\n\n b\t\tc'), 'a b c');
    assert.equal(sanitizeAnnounce('\u001b[31m红色\u001b[0m'), '[31m红色 [0m');
    const long = '字'.repeat(ANNOUNCE_MAX_LEN + 50);
    assert.equal(sanitizeAnnounce(long).length, ANNOUNCE_MAX_LEN);
  });

  test('anything that is not a string sanitizes to empty (the caller refuses it rather than broadcasting)', () => {
    for (const bad of [null, undefined, 42, {}, [], true, Symbol('x')]) {
      assert.equal(sanitizeAnnounce(bad), '', String(bad));
    }
    assert.equal(sanitizeAnnounce('   '), '');
    assert.equal(sanitizeAnnounce('\u0000\u0001'), '');
  });
});

describe('announce — the stored record is a trust boundary', () => {
  test('a usable record normalizes to { id, text, at, seq }', () => {
    const r = normalizeAnnouncement({ id: 'a1', text: '  公告  ', at: 123, seq: 4 });
    assert.deepEqual(r, { id: 'a1', text: '公告', at: 123, seq: 4 });
  });

  test('a record with no usable text is DROPPED, never guessed at', () => {
    // The client renders `text` as text content on every screen at once, so a non-string must never get through.
    for (const bad of [
      null, undefined, 42, 'text', [], true,
      {}, { text: '' }, { text: '   ' }, { text: 42 }, { text: { evil: true } }, { text: ['a'] }, { text: null },
    ]) {
      assert.equal(normalizeAnnouncement(bad), null, JSON.stringify(bad));
    }
  });

  test('missing / malformed id, at and seq are filled in rather than rejecting an otherwise good line', () => {
    const r = normalizeAnnouncement({ text: '公告' });
    assert.equal(r.text, '公告');
    assert.equal(typeof r.id, 'string');
    assert.ok(r.id.length > 0);
    assert.equal(r.at, 0);
    assert.equal(r.seq, 0);
    assert.deepEqual(normalizeAnnouncement({ text: 'x', at: 'nope', seq: -3 }), { id: 'a0-0', text: 'x', at: 0, seq: 0 });
  });
});

describe('announce — the store on disk', () => {
  test('save → read round-trips, and clear() empties it', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sp-announce-store-'));
    try {
      const store = createAnnounceStore({ dir, log: quietLog });
      assert.equal(store.read(), null, 'nothing stored yet');
      const saved = store.save({ id: 'a1-1', text: '今晚停服', at: 100, seq: 1 });
      assert.deepEqual(saved, { id: 'a1-1', text: '今晚停服', at: 100, seq: 1 });
      assert.deepEqual(store.read(), saved);
      assert.ok(existsSync(path.join(dir, ANNOUNCE_FILE)));
      store.clear();
      assert.equal(store.read(), null);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a corrupt file reads as null instead of throwing (a half-written file must not take the server down)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sp-announce-bad-'));
    try {
      const store = createAnnounceStore({ dir, log: quietLog });
      writeFileSync(path.join(dir, ANNOUNCE_FILE), '{ not json', 'utf8');
      assert.equal(store.read(), null);
      writeFileSync(path.join(dir, ANNOUNCE_FILE), JSON.stringify({ current: { text: { evil: true } } }), 'utf8');
      assert.equal(store.read(), null);
      writeFileSync(path.join(dir, ANNOUNCE_FILE), JSON.stringify({ current: null }), 'utf8');
      assert.equal(store.read(), null);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('an unwritable directory degrades to "no persistence" rather than throwing', () => {
    // A file where the directory should be: mkdir fails, so writes report false and reads answer null.
    const dir = mkdtempSync(path.join(tmpdir(), 'sp-announce-ro-'));
    const blocker = path.join(dir, 'blocker');
    writeFileSync(blocker, 'x', 'utf8');
    try {
      const store = createAnnounceStore({ dir: path.join(blocker, 'nested'), log: quietLog });
      assert.equal(store.read(), null);
      // save() still returns the normalized record (the caller's broadcast is unaffected), it just is not stored.
      assert.deepEqual(store.save({ id: 'a', text: '公告', at: 1, seq: 1 }).text, '公告');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('the default directory is NOT inside the install tree (a blue-green deploy replaces that)', () => {
    const d = defaultAnnounceDir();
    assert.ok(path.isAbsolute(d));
    assert.ok(!d.includes('public'), d);
    assert.ok(!d.includes('node_modules'), d);
  });

  test('readState tells a WITHDRAWAL apart from an UNREADABLE file (the poller must not confuse them)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sp-announce-state-'));
    try {
      const store = createAnnounceStore({ dir, log: quietLog });
      // no file yet: nothing has been published, but that is not "the operator withdrew it"
      assert.deepEqual(store.readState(), { ok: false, record: null });
      store.save({ id: 'a1-1', text: '维护', at: 100, seq: 1 });
      assert.deepEqual(store.readState(), { ok: true, record: { id: 'a1-1', text: '维护', at: 100, seq: 1 } });
      // an explicit `current: null` IS a withdrawal — the poller has to take the banner down for it
      writeFileSync(path.join(dir, ANNOUNCE_FILE), JSON.stringify({ current: null }), 'utf8');
      assert.deepEqual(store.readState(), { ok: true, record: null });
      // a broken file is NOT: nothing may change anywhere because of a torn write
      writeFileSync(path.join(dir, ANNOUNCE_FILE), '{ half', 'utf8');
      assert.deepEqual(store.readState(), { ok: false, record: null });
      writeFileSync(path.join(dir, ANNOUNCE_FILE), JSON.stringify({ current: { text: 42 } }), 'utf8');
      assert.deepEqual(store.readState(), { ok: false, record: null });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('announce — the client banner state machine', () => {
  // The client module holds the banner state. It is plain ESM with no DOM at import time, so it can be driven directly.
  const load = () => import('../public/js/ui/announce.js');

  test('a pushed frame becomes current; a duplicate id is not a second announcement', async () => {
    const m = await load();
    m.resetAnnouncements();
    m.pushAnnouncement({ id: 'a1', text: '第一条', at: 1 });
    assert.deepEqual(m.announceState().current, { id: 'a1', text: '第一条', at: 1 });
    m.pushAnnouncement({ id: 'a1', text: '第一条', at: 1 });
    assert.equal(m.announceState().current.id, 'a1');
    assert.equal(m.announceState().queued.length, 0, 'a re-delivery is not queued');
  });

  test('frames arriving back to back queue (oldest dropped) instead of overwriting', async () => {
    const m = await load();
    m.resetAnnouncements();
    const n = m.ANNOUNCE_QUEUE_MAX + 3;
    for (let i = 0; i < n; i++) m.pushAnnouncement({ id: `a${i}`, text: `第 ${i} 条`, at: i });
    const st = m.announceState();
    assert.equal(st.current.id, 'a0', 'the first one stays on screen');
    assert.equal(st.queued.length, m.ANNOUNCE_QUEUE_MAX, 'the queue is capped');
    assert.equal(st.queued[st.queued.length - 1].id, `a${n - 1}`, 'the newest is kept');
    // The cap drops the OLDEST waiting line, so what plays next is the oldest one that SURVIVED — not a1.
    const firstSurvivor = `a${n - m.ANNOUNCE_QUEUE_MAX}`;
    assert.equal(st.queued[0].id, firstSurvivor, 'the oldest waiting line is the one dropped');
    m.dismissAnnouncement();
    assert.equal(m.announceState().current.id, firstSurvivor, 'dismissing pulls the next surviving one in');
  });

  test('an EMPTY text frame is the operator WITHDRAWING it: the line and the queue go away', async () => {
    const m = await load();
    m.resetAnnouncements();
    m.pushAnnouncement({ id: 'a1', text: '要撤回的', at: 1 });
    m.pushAnnouncement({ id: 'a2', text: '排队的', at: 2 });
    assert.equal(m.announceState().current.id, 'a1');
    m.pushAnnouncement({ id: '', text: '', at: 3 });
    assert.equal(m.announceState().current, null, 'the line on screen is gone');
    assert.equal(m.announceState().queued.length, 0, 'the queue is dropped too');
  });

  test('a frame with no usable text is ignored (a malformed push must not blank the banner)', async () => {
    const m = await load();
    m.resetAnnouncements();
    m.pushAnnouncement({ id: 'a1', text: '正常公告', at: 1 });
    m.pushAnnouncement({ id: 'a2' });                 // no text field at all
    m.pushAnnouncement({ id: 'a3', text: null });     // explicit null
    m.pushAnnouncement({ id: 'a4', text: 42 });       // not a string
    m.pushAnnouncement(null);
    assert.equal(m.announceState().current.text, '正常公告', 'the good line survives every malformed frame');
  });

  // THE BUG THIS PINS (found in a real browser, 2026-10-11): the server replays the standing announcement to a session
  // the moment it says hello, and on a page load that happens BEFORE <App/> mounts — main.js awaits
  // [fonts, connect, lang] and only then renders. The frame was received and stored in `current`, but the component's
  // listener set was still empty, so the emit went nowhere and the strip never appeared after a reload.
  //
  // The component now applies whatever arrived while nobody was listening. That is asserted on the SOURCE because the
  // real proof needs a DOM (Preact render + a live page): `_verify/announce-browser.mjs` reloads a real client and
  // checks the strip comes back. This keeps the invariant from silently disappearing in a refactor.
  test('the banner applies a frame that arrived BEFORE it mounted (the page-load replay)', () => {
    const src = readFileSync(path.join(ROOT, 'public/js/ui/announce.js'), 'utf8');
    // The subscription effect must flush the state it already holds, not just register and wait for the next emit.
    assert.match(src, /listeners\.add\(fn\)[\s\S]{0,220}if \(current\) fn\(\)/,
      'the mount effect must apply an announcement that arrived before the component existed');
    // And it must still unsubscribe on unmount (a remount must not leak listeners).
    assert.match(src, /return \(\) => \{ listeners\.delete\(fn\); \}/, 'the effect must clean up');
  });
});

describe('announce — the live server', () => {
  test('publish reaches every connected session, is persisted, is replayed to later arrivals, survives a restart, and withdraws', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sp-announce-live-'));
    let srv = null;
    const clients = [];
    try {
      srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, adminSecret: SECRET, announceDir: dir, feedbackDir: null });
      const a = connect(srv.port); clients.push(a);
      await a.ready;

      // --- publish ---
      const r1 = await post(srv.port, '/api/admin/announce', { text: '今晚 22:00 停服维护' });
      assert.equal(r1.status, 200);
      assert.equal(r1.body.ok, true);
      assert.equal(r1.body.announcement.text, '今晚 22:00 停服维护');
      assert.ok(r1.body.announcement.delivered >= 1, `delivered=${r1.body.announcement.delivered}`);
      await sleep(250);
      assert.equal(a.announces.length, 1, 'the connected session received it');
      assert.equal(a.announces[0].text, '今晚 22:00 停服维护');

      // --- a LATER connection is replayed the same line (this is what "persistent" means) ---
      const b = connect(srv.port); clients.push(b);
      await b.ready;
      await sleep(350);
      assert.equal(b.announces.length, 1, 'a session that connected afterwards still sees it');
      assert.equal(b.announces[0].id, a.announces[0].id, 'it is the SAME announcement, not a new one');

      // --- the file on disk holds it ---
      const stored = JSON.parse(readFileSync(path.join(dir, ANNOUNCE_FILE), 'utf8'));
      assert.equal(stored.current.text, '今晚 22:00 停服维护');

      // --- RESTART: a brand-new process reads it back ---
      await a.close(); await b.close();
      await srv.close();
      srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, adminSecret: SECRET, announceDir: dir, feedbackDir: null });
      assert.equal(srv.lobby.announcement?.text, '今晚 22:00 停服维护', 'the restart restored it from disk');
      const c = connect(srv.port); clients.push(c);
      await c.ready;
      await sleep(350);
      assert.equal(c.announces.length, 1, 'a session on the restarted server still sees it');

      // --- withdraw: down everywhere, and it stays down ---
      const r2 = await post(srv.port, '/api/admin/announce/withdraw');
      assert.equal(r2.status, 200);
      assert.equal(r2.body.ok, true);
      await sleep(250);
      const last = c.announces[c.announces.length - 1];
      assert.equal(last.text, '', 'the client is told to take it down (an empty text)');
      await c.close();
      await srv.close();
      srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, adminSecret: SECRET, announceDir: dir, feedbackDir: null });
      assert.equal(srv.lobby.announcement, null, 'a withdrawn announcement does not come back');
      const d = connect(srv.port); clients.push(d);
      await d.ready;
      await sleep(250);
      assert.equal(d.announces.length, 0, 'a new session is told nothing');
    } finally {
      for (const c of clients) await c.close().catch(() => {});
      await srv?.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the endpoint refuses an empty announcement, truncates a long one, and rate limits a burst', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sp-announce-limits-'));
    let srv = null;
    try {
      srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, adminSecret: SECRET, announceDir: dir, feedbackDir: null });
      const empty = await post(srv.port, '/api/admin/announce', { text: '   ' });
      assert.equal(empty.status, 400);
      assert.equal(empty.body.error, 'EMPTY', 'a blank banner is refused, never broadcast');

      const long = await post(srv.port, '/api/admin/announce', { text: '字'.repeat(ANNOUNCE_MAX_LEN + 80) });
      assert.equal(long.status, 200);
      assert.equal(long.body.announcement.text.length, ANNOUNCE_MAX_LEN, 'truncated, not rejected');

      const burst = await post(srv.port, '/api/admin/announce', { text: '紧接着再来一条' });
      assert.equal(burst.status, 429, `one announcement per ${ADMIN_ANNOUNCE_MIN_GAP_MS} ms`);
      assert.ok(burst.body.retryAfterMs > 0, 'the refusal names the remaining wait');
    } finally {
      await srv?.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the history ring is the panel\'s own and is capped at ANNOUNCE_HISTORY_MAX', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sp-announce-hist-'));
    let srv = null;
    try {
      // gap 0 so the ring can be filled in one test
      srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, adminSecret: SECRET, announceDir: dir, feedbackDir: null, announceMinGapMs: 0 });
      const n = ANNOUNCE_HISTORY_MAX + 3;
      for (let i = 0; i < n; i++) {
        const r = await post(srv.port, '/api/admin/announce', { text: `第 ${i + 1} 条` });
        assert.equal(r.status, 200, `publish ${i + 1}`);
      }
      const res = await fetch(`http://127.0.0.1:${srv.port}/api/admin/announcements`, { headers: { Authorization: `Bearer ${SECRET}` } });
      assert.equal(res.status, 200);
      const list = await res.json();
      assert.equal(list.length, ANNOUNCE_HISTORY_MAX, 'the ring is capped');
      assert.equal(list[0].text, `第 ${n} 条`, 'newest first');
    } finally {
      await srv?.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the mutation stays fenced in: POST is refused on every other admin path, and an unset token hides the whole surface', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sp-announce-fence-'));
    let srv = null;
    try {
      srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, adminSecret: SECRET, announceDir: dir, feedbackDir: null });
      const base = `http://127.0.0.1:${srv.port}`;
      // Every admin path but the two announce ones stays GET/HEAD only.
      for (const p of ['/api/admin/overview', '/api/admin/rooms', '/api/admin/logs', '/api/admin/announcements']) {
        const res = await fetch(base + p, { method: 'POST', headers: { Authorization: `Bearer ${SECRET}` } });
        assert.equal(res.status, 405, `POST ${p}`);
        assert.equal(res.headers.get('allow'), 'GET, HEAD', `Allow for ${p}`);
      }
      // An announcement with no token is refused (and the body is never parsed).
      const noToken = await fetch(`${base}/api/admin/announce`, { method: 'POST', body: JSON.stringify({ text: 'x' }) });
      assert.equal(noToken.status, 401);
      const wrongToken = await fetch(`${base}/api/admin/announce`, {
        method: 'POST', headers: { Authorization: 'Bearer nope', 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x' }),
      });
      assert.equal(wrongToken.status, 401);
      // PUT is refused on the announce path too, and its Allow advertises POST.
      const put = await fetch(`${base}/api/admin/announce`, { method: 'PUT', headers: { Authorization: `Bearer ${SECRET}` } });
      assert.equal(put.status, 405);
      assert.equal(put.headers.get('allow'), 'GET, HEAD, POST');
    } finally {
      await srv?.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('with no ADMIN_SECRET the whole surface does not exist (404, never 401)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sp-announce-off-'));
    let srv = null;
    try {
      srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, adminSecret: '', announceDir: dir, feedbackDir: null });
      const base = `http://127.0.0.1:${srv.port}`;
      for (const [p, method] of [['/api/admin/announce', 'POST'], ['/api/admin/announcements', 'GET'], ['/api/admin/overview', 'GET']]) {
        const res = await fetch(base + p, { method, body: method === 'POST' ? '{}' : undefined });
        assert.equal(res.status, 404, `${method} ${p}`);
      }
    } finally {
      await srv?.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('announceDir: null keeps the announcement in memory only (it still broadcasts, it just does not survive)', async () => {
    let srv = null;
    try {
      srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, adminSecret: SECRET, announceDir: null, feedbackDir: null });
      assert.equal(srv.announceStore, null);
      const a = connect(srv.port);
      await a.ready;
      const r = await post(srv.port, '/api/admin/announce', { text: '只广播不落盘' });
      assert.equal(r.status, 200);
      await sleep(250);
      assert.equal(a.announces.length, 1, 'the broadcast still happens');
      await a.close();
    } finally {
      await srv?.close().catch(() => {});
    }
  });

  // TEST ISOLATION (found 2026-10-11): a plain `startServer()` used to default to the OPERATOR'S real directory
  // (`~/sp-announce`). Any test that boots a server therefore read whatever announcement the machine happened to hold
  // and got an extra 'announce' frame injected into the exact frame sequences it asserts — measured: lobby.test.js's
  // three reconnect cases failed purely because ~/sp-announce/current.json existed. Only the real process entry
  // (`npm start`) touches that directory now; an imported startServer() does not persist unless it asks to.
  test('an imported startServer() does NOT touch the operator\'s real announce directory', async () => {
    let srv = null;
    try {
      // No announceDir option at all — this is the shape every other test file uses.
      srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, adminSecret: SECRET, feedbackDir: null });
      assert.equal(srv.announceStore, null, 'an imported startServer() must not open the real announce directory');
      assert.equal(srv.lobby.announcement, null, 'and it must not inherit an announcement from the machine');
      const a = connect(srv.port);
      await a.ready;
      await sleep(250);
      assert.equal(a.announces.length, 0, 'a connecting session gets no ambient announcement');
      // The feature still works in memory: publishing broadcasts, it just does not outlive the process.
      const r = await post(srv.port, '/api/admin/announce', { text: '内存里的公告' });
      assert.equal(r.status, 200);
      await sleep(250);
      assert.equal(a.announces.length, 1, 'publishing still broadcasts without a store');
      await a.close();
    } finally {
      await srv?.close().catch(() => {});
    }
  });
});

// A deployment is TWO processes (blue-green) behind one nginx, and only the process that received the POST pushes
// the line to its own sessions (server/lobby.js announce). The standing announcement is written to a shared file, so
// BEFORE this the other slot's players never saw a line published on the other slot — measured 2026-10-13: the
// announcement sent from the :80 panel was invisible to the 14 players still playing on the draining slot, and the
// release script's own "打完这局刷新" notice would have reached exactly half the server. server/index.js now polls
// the file and the peer ADOPTS the record (same id — one line, one identity).
describe('announce — two blue-green slots share ONE standing announcement', () => {
  test('a publish on one slot reaches the other slot\'s players with the same id, and a withdrawal follows', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sp-announce-two-'));
    let slotA = null;
    let slotB = null;
    const clients = [];
    try {
      const common = { host: '127.0.0.1', quiet: true, adminSecret: SECRET, announceDir: dir, feedbackDir: null, announcePollMs: 40 };
      slotA = await startServer({ port: 0, ...common });
      slotB = await startServer({ port: 0, ...common });
      const ca = connect(slotA.port); clients.push(ca); await ca.ready;
      const cb = connect(slotB.port); clients.push(cb); await cb.ready;

      // --- publish on slot A ---
      const r1 = await post(slotA.port, '/api/admin/announce', { text: '打完这局刷新一下' });
      assert.equal(r1.status, 200);
      const publishedId = r1.body.announcement.id;
      await sleep(300);
      assert.equal(ca.announces.length, 1, 'the publishing slot pushed it');
      assert.equal(cb.announces.length, 1, 'the OTHER slot pushed it too, without being told');
      assert.equal(cb.announces[0].id, publishedId, 'one line keeps ONE identity — the peer adopts, it does not re-mint');
      assert.equal(cb.announces[0].text, '打完这局刷新一下');
      assert.equal(slotB.lobby.announcement.id, publishedId);

      // --- a player connecting to the OTHER slot after the publish still sees it ---
      const cc = connect(slotB.port); clients.push(cc); await cc.ready;
      await sleep(200);
      assert.equal(cc.announces.length, 1, 'replayed to a late arrival on the other slot');
      assert.equal(cc.announces[0].id, publishedId);

      // --- withdraw on slot A takes it down on both ---
      const w = await post(slotA.port, '/api/admin/announce/withdraw');
      assert.equal(w.status, 200);
      await sleep(300);
      assert.equal(cb.announces[cb.announces.length - 1].text, '', 'the other slot took the banner down');
      assert.equal(slotB.lobby.announcement, null);

      // --- and it is not one-way: publishing on B reaches A ---
      const r2 = await post(slotB.port, '/api/admin/announce', { text: '反方向也通' });
      assert.equal(r2.status, 200);
      await sleep(300);
      assert.equal(ca.announces[ca.announces.length - 1].text, '反方向也通');
      assert.equal(slotA.lobby.announcement.id, r2.body.announcement.id);
    } finally {
      for (const c of clients) await c.close().catch(() => {});
      await slotA?.close().catch(() => {});
      await slotB?.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an unreadable shared file changes nothing anywhere (a torn write must not clear the banner server-wide)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sp-announce-two-bad-'));
    let srv = null;
    const clients = [];
    try {
      srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, adminSecret: SECRET, announceDir: dir, feedbackDir: null, announcePollMs: 40 });
      const c = connect(srv.port); clients.push(c); await c.ready;
      await post(srv.port, '/api/admin/announce', { text: '还在' });
      await sleep(200);
      assert.equal(srv.lobby.announcement?.text, '还在');
      // A half-written file (the operator's editor, a full disk) is NOT a withdrawal.
      writeFileSync(path.join(dir, ANNOUNCE_FILE), '{ half', 'utf8');
      await sleep(250);
      assert.equal(srv.lobby.announcement?.text, '还在', 'the standing line survives an unreadable file');
      assert.equal(c.announces.length, 1, 'and nothing was pushed to the clients');
    } finally {
      for (const cl of clients) await cl.close().catch(() => {});
      await srv?.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
