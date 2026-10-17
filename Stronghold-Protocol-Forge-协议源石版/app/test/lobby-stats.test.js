// test/lobby-stats.test.js — 房间一览 / 在线人数 (DESIGN §30)：`lobby.stats` 的推与 `room.list` 的应答是**同一帧**，
// `online` 数的是已连接会话（有人在看它时不会是 0），新建的房间会带着大厅要渲染的字段出现在列表里，
// 而客户端的 applyLobbyStats 把这一帧折进**唯一**那个 store 切片。
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { validateC2S, C2S } from '../shared/protocol.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

function clientPool(getUrl) {
  const open = new Set();
  return {
    async connect() { const c = await TestClient.connect(getUrl()); open.add(c); return c; },
    async player(name, token) {
      const c = await this.connect();
      const w = await c.hello(name, token);
      c.id = w.playerId; c.token = w.token; c.welcome = w;
      return c;
    },
    async closeAll() { await Promise.all([...open].map((c) => c.terminate().catch(() => {}))); open.clear(); },
  };
}

const quietLog = () => {
  const errors = [];
  return { errors, log: { info() {}, warn() {}, debug() {}, error: (...a) => errors.push(a.map(String).join(' ')) } };
};
const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', `${msg.t}: ${JSON.stringify(r)}`); return r; };

describe('room.list protocol', () => {
  test('the intent is declared (the client gates on HAS("room.list")) and takes no fields', () => {
    assert.ok(C2S['room.list'], 'declared — this is also the capability the lobby screen checks');
    assert.equal(validateC2S({ t: 'room.list' }), null);
  });
});

describe('房间一览 / 在线人数 (lobby, stub match)', () => {
  let srv; let pool;
  const cap = quietLog();

  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', log: cap.log, MatchClass: StubMatch, lobbyGraceMs: 60_000 });
    pool = clientPool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  afterEach(async () => { await pool.closeAll(); });
  after(async () => { await srv?.close(); assert.deepEqual(cap.errors, [], 'no server errors logged'); });

  test('在线人数 ≥ 连接数，且不会是 0（有人正在看它）', async () => {
    const a = await pool.player('DocA');
    const frame = await a.waitFor('lobby.stats');
    assert.ok(Number.isFinite(frame.online), 'online is a number');
    assert.ok(frame.online >= 1, `online=${frame.online}`);
    const b = await pool.player('DocB');
    const frame2 = await b.waitFor('lobby.stats', (m) => m.online >= 2);
    assert.ok(frame2.online >= 2, `online=${frame2.online}`);
  });

  test('新建的房间带着大厅渲染要的字段出现在列表里；room.list 的应答同形', async () => {
    const host = await pool.player('HostDoc');
    const guest = await pool.player('GuestDoc');
    await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    const state = await host.waitFor('room.state', (s) => s.hostId === host.id);
    await ok(guest, { t: 'room.join', code: state.code });

    // 等**那间房**已经有两个人**的那一帧（建房本身也推一帧，但那时客人还没进去）
    const pushed = await host.waitFor('lobby.stats', (m) => ((m.rooms || []).find((r) => r.code === state.code)?.humans ?? 0) >= 2);
    const room = pushed.rooms.find((r) => r.code === state.code);
    assert.ok(room, 'the room is listed');
    assert.equal(room.hostName, 'HostDoc');
    assert.equal(room.humans, 2);
    assert.equal(room.inMatch, false);
    assert.ok(room.maxSeats >= 2, `maxSeats=${room.maxSeats}`);
    assert.equal(room.difficulty, 'NORMAL');
    assert.ok(Number.isFinite(pushed.matchesCount), 'matchesCount');
    assert.ok(Number.isFinite(pushed.totalRooms), 'totalRooms');

    // 应答复用请求的 rid，所以 net.request 直接解析出那一帧（形状与推一致）
    const ans = await host.request({ t: 'room.list' });
    assert.equal(ans.t, 'lobby.stats', JSON.stringify(ans));
    assert.ok(Number.isFinite(ans.online), 'the answer carries online');
    assert.ok(ans.roomsCount >= 1, `roomsCount=${ans.roomsCount}`);
    assert.ok(ans.rooms.some((r) => r.code === state.code), 'the answer lists the room');
  });

  test('客户端的 applyLobbyStats 把帧折进那一个切片（app 侧契约）', async () => {
    const { store, applyLobbyStats, initialState } = await mod('public/js/store.js');
    assert.deepEqual(initialState.lobbyStats.rooms, [], 'the slice starts empty');
    applyLobbyStats({ t: 'lobby.stats', online: 7, roomsCount: 2, matchesCount: 1, totalRooms: 3, rooms: [{ code: 'ABC' }] });
    const s = store.get().lobbyStats;
    assert.equal(s.online, 7);
    assert.equal(s.roomsCount, 2);
    assert.equal(s.matchesCount, 1);
    assert.equal(s.totalRooms, 3);
    assert.equal(s.rooms.length, 1);
    // repo 那套字段名也认（同一个切片，不要求服务端是哪个版本）
    applyLobbyStats({ online: 4, listedTotal: 5, matches: 2, rooms: [] });
    const s2 = store.get().lobbyStats;
    assert.equal(s2.roomsCount, 5);
    assert.equal(s2.matchesCount, 2);
    // 畸形帧不炸（列表回落成空数组，这是设计：`applyLobbyStats` 对形状宽容）
    assert.doesNotThrow(() => { applyLobbyStats(null); applyLobbyStats('x'); applyLobbyStats({ rooms: 'nope' }); });
    assert.deepEqual(store.get().lobbyStats.rooms, []);
  });
});
