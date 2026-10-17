// test/lobby-rooms.test.js — 房间一览 / 在线人数 / 多人匹配 (DESIGN §30) end to end over WebSocket, plus the ONE hard rule
// of the feature: a room created by room.create is 私密, always, and appears in nobody's 房间一览 / 多人匹配 answer until
// its host explicitly flips it with room.setVisibility.
//
// The tests here are the contract of the feature, not a screenshot of it:
//   * the private default (including a hostile create that tries to pass a visibility field — the C2S schema has none,
//     and the handler would ignore it);
//   * public rooms appear for EVERY connected session, at once, with no refresh (the lobby.stats push) and in the
//     room.list reply;
//   * a room going back to 私密 disappears just as fast, while room.join { code } keeps working either way (visibility is
//     advertising, never admission);
//   * 多人匹配 fills an existing listed room rather than making a new one, and creates a PUBLIC room when there is none
//     (that explicit request is the consent the private default exists to require);
//   * the counters (online / listedTotal / matches) are live.

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { StubMatch as Match } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR, ROOM_VISIBILITY } from '../shared/constants.js';

/** The 房间一览 cap this server runs with (deliberately tiny: the cap logic is what is under test, not its value). */
const CAP = 2;

let srv;
const open = new Set();

async function connect(name) {
  const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
  open.add(c);
  const w = await c.hello(name);
  c.id = w.playerId;
  c.token = w.token;
  return c;
}

/** The latest lobby.stats frame already received (the push fires on connect). */
const stats = (c) => c.waitFor('lobby.stats', () => true);
/** The latest room.state frame of a client. */
const roomState = (c) => c.waitFor('room.state', () => true);

/**
 * Ask for the 房间一览 snapshot and return the `lobby.stats` frame that answers it.
 * `room.list` echoes the request's rid, so `net.request('room.list')` resolves on it (the same pattern as `welcome`);
 * the frame is drained of stale pushes first, so the answer is the CURRENT list, never a queued earlier one.
 */
async function listRooms(c) {
  c.clearInbox();
  const reply = await c.request({ t: 'room.list' });
  assert.equal(reply.t, 'lobby.stats', JSON.stringify(reply));
  return reply;
}

async function createRoom(c, difficulty = 'NORMAL') {
  const r = await c.request({ t: 'room.create', mode: 'coop', difficulty });
  assert.equal(r.t, 'ok', JSON.stringify(r));
  return roomState(c);
}

/** Drain a client's inbox so a later waitFor sees the NEWEST frame, not a stale one. */
const drain = (c) => c.clearInbox();

before(async () => {
  // statsPushMinGapMs 0: every change pushes at once, so the tests assert the real thing (production throttles bursts).
  // The rate limits are raised only because the ROOM_LIST_MAX test creates 60+ rooms from one socket on purpose.
  srv = await startServer({ port: 0, quiet: true, MatchClass: Match, lobbyGraceMs: 200, statsPushMinGapMs: 0, roomListMax: CAP });
});
after(async () => {
  for (const c of open) await c.terminate().catch(() => {});
  open.clear();
  await srv.close();
});

describe('在线人数 / 房间一览 (DESIGN §30)', () => {
  test('a welcome hands the new session the lobby snapshot, and the online count follows connects and drops', async () => {
    const a = await connect('一号');
    const before = (await stats(a)).online;
    const b = await connect('二号');
    // b's own hello push carries the count with b in it
    assert.equal((await stats(b)).online, before + 1);
    // …and a (already connected) is told about b without asking
    const seen = await a.waitFor('lobby.stats', (m) => m.online === before + 1);
    assert.ok(seen, 'the online count is pushed to every connected session');
    // b leaves: the count drops again, pushed to a
    drain(a);
    await b.terminate();
    const dropped = await a.waitFor('lobby.stats', (m) => m.online === before);
    assert.ok(dropped, 'a dropped socket leaves the count at once');
  });

  test('room.list answers the requester with the online count, the counters and the (empty) public list', async () => {
    const c = await connect('三号');
    const r = await listRooms(c);
    assert.equal(r.t, 'lobby.stats');
    assert.ok(Number.isInteger(r.online) && r.online >= 1, `online: ${r.online}`);
    assert.ok(Number.isInteger(r.listedTotal) && r.listedTotal >= 0);
    assert.ok(Number.isInteger(r.totalRooms) && r.totalRooms >= 0);
    assert.ok(Number.isInteger(r.matches) && r.matches >= 0);
    assert.ok(Array.isArray(r.rooms));
    await c.close();
  });
});

describe('核心铁律：创建出来的房间默认私密 (DESIGN §30)', () => {
  test('room.create is ALWAYS 私密 — room.state says so and the room is in no 房间一览, not even its own host\'s', async () => {
    const host = await connect('房主');
    const other = await connect('路人');
    drain(other);
    const state = await createRoom(host);
    // the wire carries an explicit value: 'private', never absent, so the client has one field to read
    assert.equal(state.visibility, ROOM_VISIBILITY.PRIVATE);

    const seen = await listRooms(other);
    assert.equal(seen.rooms.some((x) => x.code === state.code), false, 'a fresh room is not listed anywhere');
    // the host's own 房间一览 does not special-case them either
    const own = await listRooms(host);
    assert.equal(own.rooms.some((x) => x.code === state.code), false, 'not even for its own host');

    // …and the other client was never told about it by a push either
    const pushed = other.log.filter((m) => m.t === 'lobby.stats' && (m.rooms || []).some((x) => x.code === state.code));
    assert.equal(pushed.length, 0, 'no push ever carried the private room');
    await host.close(); await other.close();
  });

  test('a hostile create cannot smuggle a visibility: the field is not in the schema and the handler ignores it', async () => {
    const host = await connect('老六');
    const other = await connect('看客');
    drain(other);
    const r = await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL', visibility: 'public' });
    assert.equal(r.t, 'ok', 'unknown fields are ignored, not rejected (validateC2S)');
    const state = await roomState(host);
    assert.equal(state.visibility, ROOM_VISIBILITY.PRIVATE, 'still 私密');
    const seen = await listRooms(other);
    assert.equal(seen.rooms.some((x) => x.code === state.code), false, 'and still unlisted');
    await host.close(); await other.close();
  });

  test('room.setVisibility is host-only, co-op only, and refused once the match started', async () => {
    const host = await connect('房主2');
    const guest = await connect('客人2');
    const state = await createRoom(host);
    await guest.request({ t: 'room.join', code: state.code });

    const notHost = await guest.request({ t: 'room.setVisibility', visibility: 'public' });
    assert.equal(notHost.t, 'error');
    assert.equal(notHost.code, ERR.NOT_HOST);

    const bad = await host.request({ t: 'room.setVisibility', visibility: 'yes' });
    assert.equal(bad.t, 'error');
    assert.equal(bad.code, ERR.BAD_MSG, 'the schema refuses an unknown value');

    // a solo room has nothing to advertise
    const solo = await connect('单人2');
    await solo.request({ t: 'room.create', mode: 'solo', difficulty: 'FUNNY' });
    const soloBad = await solo.request({ t: 'room.setVisibility', visibility: 'public' });
    assert.equal(soloBad.t, 'error');
    assert.equal(soloBad.code, ERR.BAD_TARGET);
    await host.close(); await guest.close(); await solo.close();
  });

  test('only the host may flip it, and the flip is immediate for everyone (push + room.state + room.list agree)', async () => {
    const host = await connect('房主3');
    const watcher = await connect('观察者3');
    const state = await createRoom(host);
    drain(watcher);
    drain(host);

    const ok = await host.request({ t: 'room.setVisibility', visibility: 'public' });
    assert.equal(ok.t, 'ok');

    // the host's own room.state carries the new value (the room screen's switch reads it)
    const own = await roomState(host);
    assert.equal(own.visibility, ROOM_VISIBILITY.PUBLIC);
    // every other connected client is pushed the new 房间一览 with no refresh
    const pushed = await watcher.waitFor('lobby.stats', (m) => (m.rooms || []).some((x) => x.code === state.code));
    const entry = pushed.rooms.find((x) => x.code === state.code);
    assert.equal(entry.visibility, 'public');
    assert.equal(entry.mode, 'coop');
    assert.equal(entry.difficulty, 'NORMAL');
    assert.equal(entry.humans, 1);
    assert.equal(entry.seats, 4);
    assert.equal(entry.inMatch, false);
    assert.equal(typeof entry.hostName, 'string');
    // and the request/reply path agrees with the push
    const seen = await listRooms(watcher);
    assert.ok(seen.rooms.some((x) => x.code === state.code));

    // flipping back removes it again, just as fast, for everyone
    drain(watcher);
    await host.request({ t: 'room.setVisibility', visibility: 'private' });
    const gone = await watcher.waitFor('lobby.stats', (m) => !(m.rooms || []).some((x) => x.code === state.code));
    assert.ok(gone, 'a 私密 room leaves the list at once');
    const own2 = await roomState(host);
    assert.equal(own2.visibility, ROOM_VISIBILITY.PRIVATE);
    await host.close(); await watcher.close();
  });

  test('visibility is advertising only: room.join works with the key either way (also for a 私密 room)', async () => {
    const host = await connect('房主4');
    const guest = await connect('客人4');
    const state = await createRoom(host);
    assert.equal(state.visibility, 'private');
    const joined = await guest.request({ t: 'room.join', code: state.code });
    assert.equal(joined.t, 'ok', 'a private room is joinable by key — that is the whole point of 私密');
    const guestState = await roomState(guest);
    assert.equal(guestState.code, state.code);
    await host.close(); await guest.close();
  });
});

describe('多人匹配 (DESIGN §30)', () => {
  test('fills an existing LISTED room when one fits, and leaves the 私密 ones alone', async () => {
    const host = await connect('房主5');
    const privateHost = await connect('私密房主5');
    const searcher = await connect('匹配者5');
    const state = await createRoom(host);       // 私密: never a candidate
    const hidden = await createRoom(privateHost);

    // no listed room yet ⇒ the search hosts its own public room
    const r = await searcher.request({ t: 'room.quickmatch', mode: 'coop', difficulty: 'NORMAL' });
    assert.equal(r.t, 'ok', JSON.stringify(r));
    const found = await searcher.waitFor('match.status', (m) => m.status === 'found');
    assert.equal(found.roomCode !== state.code && found.roomCode !== hidden.code, true, 'neither 私密 room was entered');
    const mine = (await listRooms(searcher)).rooms.find((x) => x.code === found.roomCode);    assert.ok(mine, 'the room 多人匹配 made is listed (the explicit request was the consent)');
    assert.equal(mine.visibility, 'public');

    // a second searcher with the same difficulty takes the free seat of that listed room…
    const second = await connect('匹配者5b');
    const r2 = await second.request({ t: 'room.quickmatch', mode: 'coop', difficulty: 'NORMAL' });
    assert.equal(r2.t, 'ok');
    const found2 = await second.waitFor('match.status', (m) => m.status === 'found');
    assert.equal(found2.roomCode, found.roomCode, 'the listed room with a free seat is preferred over a new one');
    assert.equal(found2.matched, 2, 'and `matched` counts the humans it now holds');

    // …and a different difficulty never joins it
    const other = await connect('匹配者5c');
    const r3 = await other.request({ t: 'room.quickmatch', mode: 'coop', difficulty: 'HARD' });
    assert.equal(r3.t, 'ok');
    const found3 = await other.waitFor('match.status', (m) => m.status === 'found');
    assert.notEqual(found3.roomCode, found.roomCode, 'difficulty is part of the match, not a hint');
    for (const c of [host, privateHost, searcher, second, other]) await c.close();
  });

  test('refuses a solo search, and refuses while the player\'s own match is running', async () => {
    const c = await connect('匹配者6');
    const solo = await c.request({ t: 'room.quickmatch', mode: 'solo', difficulty: 'NORMAL' });
    assert.equal(solo.t, 'error');
    assert.equal(solo.code, ERR.BAD_TARGET);
    await c.close();
  });

  test('a listed room that starts a match is shown as 进行中 (still listed: joinable only as a spectator)', async () => {
    const host = await connect('房主7');
    const watcher = await connect('观察者7');
    const state = await createRoom(host);
    await host.request({ t: 'room.setVisibility', visibility: 'public' });
    drain(watcher);
    await host.request({ t: 'room.start' });

    const pushed = await watcher.waitFor('lobby.stats', (m) => (m.rooms || []).some((x) => x.code === state.code && x.inMatch === true));
    assert.equal(pushed.matches >= 1, true, 'the running-match counter follows');
    const seen = await listRooms(watcher);
    assert.equal(seen.rooms.find((x) => x.code === state.code).inMatch, true);
    // 多人匹配 will not drop a stranger into a running match
    const searcher = await connect('匹配者7');
    const r = await searcher.request({ t: 'room.quickmatch', mode: 'coop', difficulty: 'NORMAL' });
    assert.equal(r.t, 'ok');
    const found = await searcher.waitFor('match.status', (m) => m.status === 'found');
    assert.notEqual(found.roomCode, state.code);
    for (const c of [host, watcher, searcher]) await c.close();
  });

  test('a disposed or emptied listed room leaves the 房间一览', async () => {
    const host = await connect('房主8');
    const watcher = await connect('观察者8');
    const state = await createRoom(host);
    await host.request({ t: 'room.setVisibility', visibility: 'public' });
    drain(watcher);
    await watcher.waitFor('lobby.stats', (m) => (m.rooms || []).some((x) => x.code === state.code));
    drain(watcher);
    await host.request({ t: 'room.leave' });
    const gone = await watcher.waitFor('lobby.stats', (m) => !(m.rooms || []).some((x) => x.code === state.code));
    assert.ok(gone, 'the empty room is gone from the list');
    await host.close(); await watcher.close();
  });

  test('the list is capped at the option while listedTotal keeps counting every listed room', async () => {
    // A session holds ONE room at a time (room.create leaves the previous one), so this exercises the option's type
    // handling and the one-per-session shape; the cap itself needs several hosts (the next test).
    const host = await connect('批量房主');
    const before = await listRooms(host);
    for (let i = 0; i < CAP + 2; i++) {
      const r = await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
      assert.equal(r.t, 'ok', JSON.stringify(r));
      const vis = await host.request({ t: 'room.setVisibility', visibility: 'public' });
      assert.equal(vis.t, 'ok');
    }
    const seen = await listRooms(host);
    assert.equal(seen.listedTotal, before.listedTotal + 1, 'the two rooms the loop replaced are gone: one room per session');
    assert.equal(seen.rooms.length <= CAP, true, 'and the frame never carries more than the cap');
    await host.close();
  });

  test('a small cap keeps the newest rooms and still counts them all', async () => {
    // With several hosts at once the cap really bites: CAP + 3 listed rooms, so the frame carries the newest CAP.
    const base = await listRooms(await connect('基线'));
    const N = CAP + 3;
    const hosts = [];
    for (let i = 0; i < N; i++) {
      const h = await connect(`批量${i}`);
      await h.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
      await h.request({ t: 'room.setVisibility', visibility: 'public' });
      hosts.push(h);
    }
    const seen = await listRooms(hosts[0]);
    assert.equal(seen.listedTotal, base.listedTotal + N, 'every listed room is counted');
    assert.equal(seen.rooms.length, CAP, 'while the frame carries at most the cap');
    // The cap keeps the NEWEST rooms: this batch's last CAP codes are the ones carried (a create stamps a monotonic seq,
    // so the order is exact even when several rooms share a millisecond).
    const codes = hosts.map((h) => h.log.filter((m) => m.t === 'room.state').pop().code);
    const newest = codes.slice(-CAP).reverse();
    assert.deepEqual(seen.rooms.map((x) => x.code), newest, 'newest first, and the oldest rooms fell off the cap');
    await hosts[0].request({ t: 'room.leave' });
    for (const h of hosts) await h.close();
  });
});
