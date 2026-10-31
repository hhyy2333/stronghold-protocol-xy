import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../../server/index.js';
import { TestClient } from '../helpers/wsClient.js';
import { ERR } from '../../shared/constants.js';

const ok = async (c, msg) => {
  const r = await c.request(msg);
  assert.equal(r.t, 'ok', JSON.stringify(r));
};
const err = async (c, msg, code) => {
  const r = await c.request(msg);
  assert.equal(r.t, 'error', JSON.stringify(r));
  assert.equal(r.code, code, JSON.stringify(r));
};
/** Poll a server-side condition (a disconnect / a frame the room has not flushed yet). */
const until = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('condition did not become true');
};
const setupOf = (pub) => ({ stageId: pub.stageId, bossId: pub.bossId, hiddenBossId: pub.hiddenBossId,
  factions: pub.factions, disabledBonds: pub.disabledBonds, bannedChess: pub.bannedChess, setupRevision: pub.setupRevision });

test('real four-player sockets: the host rerolls at once, no vote, no guest consent', { timeout: 15000 }, async (t) => {
  const errors = [];
  const srv = await startServer({ port: 0, host: '127.0.0.1', seedFn: () => 123,
    log: { info() {}, warn() {}, debug() {}, error: (...args) => errors.push(args.map(String).join(' ')) } });
  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map((c) => c.terminate()));
    await srv.close();
    assert.deepEqual(errors, []);
  });
  const player = async (name, token) => {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    clients.push(c);
    const w = await c.hello(name, token);
    c.id = w.playerId;
    c.token = w.token;
    return c;
  };
  const host = await player('Host');
  await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'HARD' });
  const room = await host.waitFor('room.state');
  const guests = [];
  for (let i = 0; i < 3; i++) {
    const c = await player(`Guest${i}`);
    guests.push(c);
    await ok(c, { t: 'room.join', code: room.code });
    await ok(c, { t: 'room.ready', ready: true });
  }
  const spectator = await player('Viewer');
  await ok(spectator, { t: 'room.spectate', code: room.code });
  await ok(host, { t: 'room.start' });
  const initial = await host.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
  const m = srv.lobby.rooms.get(room.code).match;
  await err(guests[0], { t: 'room.rerollSetup', setupRevision: 0 }, ERR.NOT_HOST);
  await err(spectator, { t: 'room.rerollSetup', setupRevision: 0 }, ERR.SPECTATOR);
  await ok(guests[0], { t: 'g.infoReady', setupRevision: 0 });
  await ok(host, { t: 'room.rerollSetup', setupRevision: 0 });
  const all = [host, ...guests, spectator];
  const fresh = await Promise.all(all.map((c) => c.waitFor('m.public', (p) => p.setupRevision === 1)));
  for (const p of fresh) {
    assert.deepEqual(setupOf(p), setupOf(fresh[0]));
    assert.equal(p.deadline, fresh[0].deadline, 'all players share the same new deadline');
    assert.equal(Math.ceil((p.deadline - p.serverNow) / 1000), 25, 'each player sees a fresh 25-second countdown');
    assert.equal(p.rerollVote, undefined, 'the vote payload is gone from the public view');
  }
  // The delta may omit an unchanged row (the guest's Ready delta was throttled before the reroll), so read the room's
  // materialized view for the reset rather than one frame.
  assert.ok(m.publicView().players.every((ps) => !ps.ready));
  const after = setupOf(m.publicView());
  assert.notDeepEqual(after, { ...setupOf(initial), setupRevision: 1 });
  assert.equal(srv.lobby.rooms.get(room.code).match, m, 'room/match instance and sockets retained');
  assert.ok(all.every((c) => c.isOpen));
  await err(guests[0], { t: 'g.infoReady', setupRevision: 0 }, ERR.BAD_TARGET);
  await err(guests[0], { t: 'g.infoReady' }, ERR.BAD_TARGET);
  await err(host, { t: 'room.rerollSetup', setupRevision: 0 }, ERR.BAD_TARGET);
  // Disconnect/reconnect retains this room and returns the current full setup.
  const guest = guests[2];
  await guest.terminate();
  await until(() => m.players.get(guest.id) && !m.players.get(guest.id).connected);
  const resumed = await player('Guest2', guest.token);
  assert.equal(resumed.id, guest.id);
  assert.deepEqual(setupOf(await resumed.waitFor('m.public', (p) => p.setupRevision === 1 && !p.delta)), after);
  const restoredRoom = await resumed.waitFor('room.state');
  assert.equal(restoredRoom.code, room.code);
  for (const c of [host, guests[0], guests[1], resumed]) await ok(c, { t: 'g.infoReady', setupRevision: 1 });
  await host.waitFor('m.public', (p) => p.phase === 'BAND_DRAFT');
  await err(host, { t: 'room.rerollSetup', setupRevision: 1 }, ERR.WRONG_PHASE);
});

test('real sockets: a guest cannot reroll, and a disconnected teammate does not block the host', { timeout: 15000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const clients = [];
  t.after(async () => { await Promise.all(clients.map((c) => c.terminate())); await srv.close(); });
  for (const name of ['Host', 'Guest']) {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    clients.push(c);
    const w = await c.hello(name);
    c.id = w.playerId;
    c.token = w.token;
  }
  const [host, guest] = clients;
  await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  const room = await host.waitFor('room.state');
  await ok(guest, { t: 'room.join', code: room.code });
  await ok(guest, { t: 'room.ready', ready: true });
  await ok(host, { t: 'room.start' });
  const initial = await host.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
  const m = srv.lobby.rooms.get(room.code).match;
  assert.equal(initial.setupRevision, 0);
  await err(guest, { t: 'room.rerollSetup', setupRevision: 0 }, ERR.NOT_HOST);
  // The vote is gone: a guest can no longer reject or cancel a reroll either (the old messages are refused by name).
  await err(guest, { t: 'g.rerollVote', voteId: 1, agree: false }, ERR.BAD_MSG);
  await err(guest, { t: 'room.cancelReroll', voteId: 1 }, ERR.BAD_MSG);
  await guest.terminate();
  await until(() => m.players.get(guest.id) && !m.players.get(guest.id).connected);
  await ok(host, { t: 'room.rerollSetup', setupRevision: 0 });
  const fresh = await host.waitFor('m.public', (p) => p.setupRevision === 1);
  const rerolled = setupOf(m.publicView());
  assert.equal(rerolled.setupRevision, 1);
  assert.notDeepEqual(setupOf(m.publicView()), { ...setupOf(initial), setupRevision: 1 });
  assert.equal(Math.ceil((fresh.deadline - fresh.serverNow) / 1000), 25);
});
