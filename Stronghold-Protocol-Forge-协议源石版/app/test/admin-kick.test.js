// test/admin-kick.test.js — 后台踢人（`POST /api/admin/rooms/kick` → server/lobby.js `operatorKick`）。
//
// 业主 2026-10-19：「给服务器后台加个把人踢出房间的功能」。房主本来就有 room.kick（只能备战期、只能踢别人），
// 运维在看着一间房时却没有任何杠杆：能做的只有封 IP（更宽、更持久，等于把人踢出整个服务器）或重启进程（会结束
// 所有对局）。所以这一条做成**与正常离开完全相同**的路径 —— 一次 removeMember、一条 room.closed {kicked}、不封禁，
// 任何时刻都能用，包括对局进行中。
//
// 这个文件钉住的是「它是窄的、它是诚实的」：
//   * 备战期：真人被移出，座位立刻空出来，房间状态广播给其他人，人可以再用房间号加回来（不封禁）；
//   * 对局中：等同中途退出（座位保留为离开态、其余人继续），不是「暂停」也不是「判负」；
//   * 房主被移出：房主身份顺延（与他自己离开同一条 migrateHost）；
//   * 观战席同理（走同一个 removeMember）；
//   * 拒绝都点名：没有这间房、人不在房里、AI 座位、已经离开的座位 —— 并且**一个字节都不改**；
//   * 方法门/鉴权/没口令时 404 这些管理面的既有口径没被这次改动推翻。
//
// Run: node test/admin-kick.test.js

import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { startServer } from '../server/index.js';
import { Lobby } from '../server/lobby.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';

// ---------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------

const SECRET = 'test-admin-secret-0123456789abcdef';
const auth = (token = SECRET) => ({ authorization: `Bearer ${token}` });

/** Raw HTTP request with an optional JSON body (the shape every sibling admin test uses). */
function httpReq(port, rawPath, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (body != null) h['content-type'] = 'application/json';
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

const json = (res) => JSON.parse(res.body.toString());
const quietLog = () => {
  const errors = [];
  return { errors, log: { info() {}, warn() {}, debug() {}, error: (...a) => errors.push(a.map(String).join(' ')) } };
};
const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', `${msg.t}: ${JSON.stringify(r)}`); return r; };
const seatOf = (state, id) => state.seats.find((s) => s && s.playerId === id) || null;

// ---------------------------------------------------------------------------------------------------
// the operator API against a real server (StubMatch: a match that stays open is all these cases need)
// ---------------------------------------------------------------------------------------------------

describe('后台踢人：房间与拒绝（StubMatch）', () => {
  let srv;
  const cap = quietLog();
  /** @type {TestClient[]} */
  const open = [];
  const kick = (body) => httpReq(srv.port, '/api/admin/rooms/kick', { method: 'POST', headers: auth(), body });

  async function connect(name, token) {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    open.push(c);
    const w = await c.hello(name, token);
    c.id = w.playerId;
    c.token = w.token;
    return c;
  }
  async function createRoom(c, mode = 'coop') {
    await ok(c, { t: 'room.create', mode, difficulty: 'NORMAL' });
    return c.waitFor('room.state', (s) => s.hostId === c.id);
  }
  async function joinRoom(c, code) {
    await ok(c, { t: 'room.join', code });
    return c.waitFor('room.state', (s) => s.code === code && !!seatOf(s, c.id));
  }

  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', log: cap.log, adminSecret: SECRET, MatchClass: StubMatch, lobbyGraceMs: 60_000 });
  });
  afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.terminate().catch(() => {})));
  });
  after(async () => {
    await srv?.close();
    assert.deepEqual(cap.errors, [], 'no server errors logged');
  });

  test('备战期：把人移出 → room.closed {kicked}、座位空出来、房间状态广播，人还能加回来（不封禁）', async () => {
    const host = await connect('Host');
    const st = await createRoom(host);
    const guest = await connect('Guest');
    await joinRoom(guest, st.code);
    guest.clearInbox();

    const r = await kick({ code: st.code, playerId: guest.id });
    assert.equal(r.status, 200, r.body.toString());
    const body = json(r);
    assert.equal(body.ok, true);
    assert.equal(body.kick.room, st.code);
    assert.equal(body.kick.playerId, guest.id);
    assert.equal(body.kick.name, 'Guest', '应答点名是谁被移出（面板据此写提示）');
    assert.equal(body.kick.seat, 1);
    assert.equal(body.kick.spectator, false);
    assert.equal(body.kick.inMatch, false);
    assert.equal(body.kick.deferred, false);

    const closed = await guest.waitFor('room.closed');
    assert.equal(closed.reason, 'kicked', '与房主 room.kick、观战者被移除同一个原因码');
    const after = await host.waitFor('room.state', (s) => s.seats[1] === null);
    assert.equal(after.hostId, host.id, '房主没变');
    await guest.expectNone('room.state');
    assert.equal((await guest.request({ t: 'room.ready', ready: true })).code, 'NOT_IN_ROOM');

    // 不封禁：同一个 token 用房间号可以加回来，落在最低的空位。
    const back = await joinRoom(guest, st.code);
    assert.equal(seatOf(back, guest.id).seat, 1);
  });

  test('对局中：等同中途退出 —— 座位保留为离开态、其余人继续、被踢的人不再收到对局帧', async () => {
    const host = await connect('Host');
    const st = await createRoom(host);
    const guest = await connect('Guest');
    await joinRoom(guest, st.code);
    await ok(guest, { t: 'room.ready', ready: true });
    await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.ready);
    await ok(host, { t: 'room.start' });
    const running = await host.waitFor('room.state', (s) => s.inMatch === true);
    assert.equal(running.inMatch, true);
    await guest.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');

    const r = await kick({ code: st.code, playerId: guest.id });
    assert.equal(r.status, 200, r.body.toString());
    const body = json(r);
    assert.equal(body.kick.inMatch, true, '应答如实说这一脚踢在对局里');
    assert.equal((await guest.waitFor('room.closed', () => true, 5000)).reason, 'kicked');

    // 对局没有因此结束：房主仍在局内，被踢的人在对局视图里是 departed（status 'left'），而不是被静默删除。
    const after = await host.waitFor('room.state', (s) => s.inMatch === true);
    assert.equal(after.inMatch, true, '踢一个人不结束整局');
    const pub = await host.waitFor('m.public', (p) => p.players?.some((x) => x.playerId === guest.id && x.status === 'left'));
    assert.equal(pub.phase, 'INFO_CHECK', '其余人还在打');

    // 这对局中的座位**还占着**（直到本局结束），所以面板必须知道它已经是「离开」态 —— 否则会一直画一颗按了只会
    // 得到 BAD_TARGET 的「移出」按钮。`GET /api/admin/rooms` 的座位带 `left`。
    const rooms = json(await httpReq(srv.port, '/api/admin/rooms', { headers: auth() }));
    const live = rooms.find((x) => x.code === st.code);
    const seat = live.seats.find((x) => x.playerId === guest.id);
    assert.ok(seat, 'the departed seat is still listed (the match holds it)');
    assert.equal(seat.left, true, 'and it says it is departed');
    assert.equal(seat.connected, false);

    const mark = guest.log.length;
    await ok(host, { t: 'g.infoReady' });
    await host.waitFor('m.public', (p) => p.phase === 'RESULT' || p.phase === 'PREP', 5000).catch(() => null);
    // 只钉**对局帧**：被移出的人 socket 还开着，`lobby.stats`（大厅在线人数）本来就发给每个连接（约 250–800 ms
    // 一次，取决于限频），把它算进来只会让这条断言变成「这几毫秒里还没来」，而不是「他收不到对局了」。
    const matchFrames = guest.log.slice(mark).map((x) => x.t).filter((t) => t.startsWith('m.') || t.startsWith('b.'));
    assert.deepEqual(matchFrames, [], '被移出的人不再收到任何对局帧');
  });

  test('房主被移出：房主身份顺延给下一位真人（与他自己离开同一条迁移）', async () => {
    const host = await connect('Host');
    const st = await createRoom(host);
    const guest = await connect('Guest');
    await joinRoom(guest, st.code);

    const r = await kick({ code: st.code, playerId: host.id });
    assert.equal(r.status, 200, r.body.toString());
    assert.equal(json(r).kick.name, 'Host');
    assert.equal((await host.waitFor('room.closed')).reason, 'kicked');
    const after = await guest.waitFor('room.state', (s) => s.hostId === guest.id);
    assert.equal(after.hostId, guest.id, '空出来的房主身份顺延，房间没有解散');
    assert.equal(seatOf(after, host.id), null);
  });

  test('观战席：同一个 removeMember，从房间的观战列表里消失', async () => {
    const host = await connect('Host');
    const st = await createRoom(host);
    const spec = await connect('Watcher');
    await ok(spec, { t: 'room.spectate', code: st.code });
    await host.waitFor('room.state', (s) => s.spectators.length === 1);

    const r = await kick({ code: st.code, playerId: spec.id });
    assert.equal(r.status, 200, r.body.toString());
    assert.equal(json(r).kick.spectator, true);
    assert.equal(json(r).kick.seat, null, '观战者没有座次');
    assert.equal((await spec.waitFor('room.closed')).reason, 'kicked');
    const after = await host.waitFor('room.state', (s) => s.spectators.length === 0);
    assert.deepEqual(after.spectators, []);
  });

  test('拒绝都点名，而且一个字节都不改：没有这间房 / 人不在房里 / AI 座位 / 已经离开', async () => {
    const host = await connect('Host');
    const st = await createRoom(host);
    const guest = await connect('Guest');
    await joinRoom(guest, st.code);

    // 没有这间房：404（"没有"与"不能"是两件事，面板据此写不同的话）
    const missing = await kick({ code: 'ZZZZ', playerId: guest.id });
    assert.equal(missing.status, 404);
    assert.equal(json(missing).error, 'ROOM_NOT_FOUND');

    // 人不在房里：409
    const stray = await kick({ code: st.code, playerId: 'p_0000000000' });
    assert.equal(stray.status, 409);
    assert.equal(json(stray).error, 'NOT_IN_ROOM');

    // AI 座位：AI 由房主的 room.addBot / room.removeBot 管，运维这边只认真人
    await ok(host, { t: 'room.addBot' });
    const withBot = await host.waitFor('room.state', (s) => s.seats[2]?.isBot);
    const bot = await kick({ code: st.code, playerId: withBot.seats[2].playerId });
    assert.equal(bot.status, 409);
    assert.equal(json(bot).error, 'BAD_TARGET');
    assert.match(json(bot).message, /AI/, '说清楚为什么不行（不是笼统的"失败"）');

    // 已经不在房里的人：先踢一次，再踢同一个人。备战期座位是被**释放**的（removeMember 把它置 null），
    // 所以第二次是 NOT_IN_ROOM —— 与「从没在这间房里」同一个答案，这正确：座位已经不存在了。
    assert.equal((await kick({ code: st.code, playerId: guest.id })).status, 200);
    const again = await kick({ code: st.code, playerId: guest.id });
    assert.equal(again.status, 409);
    assert.equal(json(again).error, 'NOT_IN_ROOM');

    // 缺字段：400，不是 500，也不会误伤第一个座位
    for (const payload of [{}, { code: st.code }, { playerId: guest.id }, { code: '', playerId: '' }]) {
      const bad = await kick(payload);
      assert.equal(bad.status, 400, JSON.stringify(payload));
      assert.equal(json(bad).error, 'BAD_REQUEST');
    }

    // 房间与座位在以上全部失败里毫发无损：房主还在，AI 还在 —— 直接问管理接口要真相（不被收件箱里旧帧误导）。
    const rooms = json(await httpReq(srv.port, '/api/admin/rooms', { headers: auth() }));
    const live = rooms.find((x) => x.code === st.code);
    assert.ok(live, 'the room is still there');
    assert.ok(live.seats.some((x) => x.playerId === host.id), 'host untouched');
    assert.ok(live.seats.some((x) => x.isBot), 'the AI seat was never a candidate');
  });

  test('房间号大小写不敏感（面板显示的永远是大写，手打 curl 不该踩空）', async () => {
    const host = await connect('Host');
    const st = await createRoom(host);
    const guest = await connect('Guest');
    await joinRoom(guest, st.code);
    const r = await kick({ code: st.code.toLowerCase(), playerId: guest.id });
    assert.equal(r.status, 200, r.body.toString());
    assert.equal((await guest.waitFor('room.closed')).reason, 'kicked');
  });

  test('管理面口径没被推翻：没口令 404、没口令的 POST 也 404、错误 verbs 405 + Allow、无 token 401', async () => {
    // 没有 ADMIN_SECRET：整张管理面不存在（404，不是 401）
    const bare = await startServer({ port: 0, host: '127.0.0.1', quiet: true, adminSecret: '', bansDir: null, banPollMs: 0, feedbackDir: null });
    try {
      assert.equal((await httpReq(bare.port, '/api/admin/rooms/kick', { method: 'POST', body: { code: 'ABCD', playerId: 'p_1' } })).status, 404);
    } finally { await bare.close(); }

    // 有口令：无 token → 401；方法不对 → 405 且广告 POST
    assert.equal((await httpReq(srv.port, '/api/admin/rooms/kick', { method: 'POST', body: { code: 'ABCD', playerId: 'p_1' } })).status, 401);
    const put = await httpReq(srv.port, '/api/admin/rooms/kick', { method: 'PUT', headers: auth() });
    assert.equal(put.status, 405);
    assert.equal(put.headers.allow, 'GET, HEAD, POST');
    // GET 也不是读视图：不在 ADMIN_PATHS 里 → 404（踢人只有一个动词，没有别的入口）
    assert.equal((await httpReq(srv.port, '/api/admin/rooms/kick', { headers: auth() })).status, 404);
    // 超长 body 在解析前就被拒
    const huge = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: srv.port, path: '/api/admin/rooms/kick', method: 'POST', headers: { ...auth(), 'content-type': 'application/json' }, agent: false }, (res) => {
        const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString() }));
      });
      req.on('error', reject);
      req.end(JSON.stringify({ code: 'ABCD', playerId: 'x'.repeat(4000) }));
    });
    assert.equal(huge.status, 413);
  });

  test('踢人的动作进管理后台日志（面板的实时控制台里看得到「谁踢了谁」）', async () => {
    const host = await connect('Host');
    const st = await createRoom(host);
    const guest = await connect('Guest');
    await joinRoom(guest, st.code);
    await kick({ code: st.code, playerId: guest.id });
    const logs = json(await httpReq(srv.port, '/api/admin/logs?since=0', { headers: auth() }));
    const entry = logs.find((e) => e.level === 'warn' && String(e.message).includes('Guest') && String(e.message).includes(st.code));
    assert.ok(entry, `踢人后日志里要能查到（warn）：${JSON.stringify(logs.slice(-5))}`);
  });

  test('最后一名真人被移出：房间回收 —— 被移出的人拿到的是 kicked（不是 empty）', async () => {
    // 这是「任何时刻都能用」里最容易漏的一格：移走最后一个人会触发 reapEmptyRoom → disposeRoom，
    // 而 disposeRoom 对 `left` 的座位**不发** room.closed。这里钉住：被踢的人一定收到 kicked。
    const host = await connect('Host');
    const st = await createRoom(host, 'solo');
    host.clearInbox();
    const r = await kick({ code: st.code, playerId: host.id });
    assert.equal(r.status, 200, r.body.toString());
    assert.equal((await host.waitFor('room.closed', () => true, 5000)).reason, 'kicked', '不是 empty、不是 timeout');
    const rooms = json(await httpReq(srv.port, '/api/admin/rooms', { headers: auth() }));
    assert.equal(rooms.find((x) => x.code === st.code), undefined, '房间已经回收');
  });

  test('掉线（宽限期内）的人：座位立刻释放，人下次回来才看到 kicked —— 不是现在断线', async () => {
    const host = await connect('Host');
    const st = await createRoom(host);
    const guest = await connect('Guest');
    await joinRoom(guest, st.code);
    // 拔线：座位保留，connected=false，宽限期还没到（lobbyGraceMs 60 s）
    await guest.terminate();
    await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.connected === false);

    const r = await kick({ code: st.code, playerId: guest.id });
    assert.equal(r.status, 200, r.body.toString());
    const after = await host.waitFor('room.state', (s) => s.seats[1] === null);
    assert.equal(after.hostId, host.id);

    // 同一个身份回来：先拿到 room.closed {kicked}（在 room.state 之前），座位不在那间房里。
    const again = await connect('Guest', guest.token);
    assert.equal(again.id, guest.id, '身份不变');
    assert.equal((await again.waitFor('room.closed')).reason, 'kicked');
    assert.equal((await again.request({ t: 'room.ready', ready: true })).code, 'NOT_IN_ROOM');
  });
});

// ---------------------------------------------------------------------------------------------------
// 房间队列：`Lobby.operatorKick` 自己的决定（不经过 HTTP，直接钉「什么时候算 deferred」）
// ---------------------------------------------------------------------------------------------------
//
// 为什么单独测：面板的 `deferred` 文案是**如实性**的一部分（「已请求」≠「已移出」），而它取决于房间的队列，不是
// 取决于 HTTP。这里用最小的假 Lobby/假房间走真方法，把两条分支都钉死。

describe('operatorKick 的队列决定（假 lobby）', () => {
  /** A Lobby with just enough of the machinery `operatorKick` touches; `removeMember` is observed, not executed. */
  function fakeLobby({ pending = 0, disposed = false } = {}) {
    const calls = [];
    const sinks = [];
    const lobby = Object.create(Lobby.prototype);
    lobby.registry = { byId: (id) => sinks.find((s) => s.playerId === id) || null };
    lobby.log = { info() {}, warn() {}, error() {}, debug() {} };
    lobby.resyncTimers = new Map();
    const room = {
      code: 'K7Q2', disposed, seats: [], spectators: [], match: null,
      queue: { pending, tail: Promise.resolve() },
      seatOf: (id) => room.seats.find((s) => s && s.playerId === id) || null,
      spectatorOf: (id) => room.spectators.find((s) => s.playerId === id) || null,
    };
    room.seats.push({ seat: 0, playerId: 'p_host', name: 'Host', isBot: false, left: false, connected: true });
    room.seats.push({ seat: 1, playerId: 'p_guest', name: 'Guest', isBot: false, left: false, connected: true });
    room.seats.push({ seat: 2, playerId: 'ai_x', name: 'AI', isBot: true, left: false, connected: true });
    lobby.rooms = new Map([[room.code, room]]);
    lobby.replayFor = () => null;
    lobby.removeMember = (r, id) => { calls.push(id); };
    lobby.serial = Lobby.prototype.serial.bind(lobby);   // the real queue: a pending>0 room defers
    return { lobby, room, calls };
  }

  test('队列空闲：立刻生效，deferred=false（不拿「已请求」骗人）', () => {
    const { lobby, calls } = fakeLobby();
    const r = lobby.operatorKick({ code: 'K7Q2', playerId: 'p_guest' });
    assert.equal(r.ok, true);
    assert.equal(r.deferred, false);
    assert.equal(r.name, 'Guest');
    assert.deepEqual(calls, ['p_guest'], '移出在应答之前就已经发生');
  });

  test('队列里有别的事情：排进去、deferred=true，队列排空后才真正移出', async () => {
    const { lobby, calls } = fakeLobby({ pending: 1 });
    const r = lobby.operatorKick({ code: 'K7Q2', playerId: 'p_guest' });
    assert.equal(r.ok, true);
    assert.equal(r.deferred, true, '这时只能说「已请求」');
    assert.deepEqual(calls, [], '还没发生');
    // 队列排空（serial 的 pending 计数归零后 tail 结算）
    await new Promise((res) => setTimeout(res, 0));
    await lobby.rooms.get('K7Q2').queue.tail;
    assert.deepEqual(calls, ['p_guest']);
  });

  test('排到队尾之后房间已经销毁：不动座位、也不写那条「已移出」的日志', async () => {
    const { lobby, room, calls } = fakeLobby({ pending: 1 });
    const r = lobby.operatorKick({ code: 'K7Q2', playerId: 'p_guest' });
    assert.equal(r.deferred, true);
    room.disposed = true;                       // 队列排到我们之前，房间没了
    await new Promise((res) => setTimeout(res, 0));
    await room.queue.tail;
    assert.deepEqual(calls, [], '死房间里不再执行 removeMember');
  });

  test('拒绝都在队列之外决定：没有房间 / 人不在 / AI 座位 / 已离开', () => {
    const lobby = fakeLobby().lobby;
    assert.equal(lobby.operatorKick({ code: 'ZZZZ', playerId: 'p_guest' }).error, 'ROOM_NOT_FOUND');
    assert.equal(lobby.operatorKick({ code: 'K7Q2', playerId: 'p_nobody' }).error, 'NOT_IN_ROOM');
    const ai = lobby.operatorKick({ code: 'K7Q2', playerId: 'ai_x' });
    assert.equal(ai.error, 'BAD_TARGET');
    assert.match(ai.detail, /AI/);
    lobby.rooms.get('K7Q2').seats[1].left = true;
    const gone = lobby.operatorKick({ code: 'K7Q2', playerId: 'p_guest' });
    assert.equal(gone.error, 'BAD_TARGET');
    assert.match(gone.detail, /left/);
  });
});
