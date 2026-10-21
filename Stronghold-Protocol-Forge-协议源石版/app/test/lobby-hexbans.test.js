// test/lobby-hexbans.test.js — room.hexBans end to end over WebSocket (业主 2026-10-21): the structural check refuses
// malformed lists, the semantic check drops ids this data set does not have (never the whole list), the list is stored
// on the session and the seat, a match takes seats[].hexBans (bots: none), and a running match stores an edit for the
// next one (ROOM_STARTED).
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR } from '../shared/constants.js';

class RecordingStub extends StubMatch {
  static instances = [];
  constructor(opts) { super(opts); this.opts = opts; RecordingStub.instances.push(this); }
}

function clientPool(getUrl) {
  const open = new Set();
  return {
    async player(name, token) {
      const c = await TestClient.connect(getUrl());
      open.add(c);
      const w = await c.hello(name, token);
      c.id = w.playerId;
      c.token = w.token;
      c.welcome = w;
      return c;
    },
    async closeAll() {
      await Promise.all([...open].map((c) => c.terminate().catch(() => {})));
      open.clear();
    },
  };
}
const quietLog = () => {
  const errors = [];
  return { errors, log: { info() {}, warn() {}, debug() {}, error: (...a) => errors.push(a.map(String).join(' ')) } };
};
const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', `${msg.t}: ${JSON.stringify(r)}`); return r; };
const err = async (c, msg, code) => { const r = await c.request(msg); assert.equal(r.t, 'error', JSON.stringify(r)); assert.equal(r.code, code, JSON.stringify(r)); return r; };
async function createRoom(c, mode = 'coop', difficulty = 'NORMAL') {
  await ok(c, { t: 'room.create', mode, difficulty });
  return c.waitFor('room.state', (s) => s.hostId === c.id && s.mode === mode);
}

describe('room.hexBans (lobby, stub match)', () => {
  let srv;
  let pool;
  const cap = quietLog();
  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', log: cap.log, MatchClass: RecordingStub, heavyBurst: 12, heavyPerSec: 4 });
    pool = clientPool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  afterEach(async () => { RecordingStub.instances = []; await pool.closeAll(); });
  after(async () => { await srv?.close(); });

  test('malformed lists are BAD_MSG; unknown ids dropped; stored per session and seat; the next match takes it', async () => {
    const host = await pool.player('Host');
    await err(host, { t: 'room.hexBans', ids: 'nope' }, ERR.BAD_MSG);
    await err(host, { t: 'room.hexBans', ids: ['hex_stipend', 'hex_echo', 'hex_recruit', 'hex_refresh'] }, ERR.BAD_MSG);
    await err(host, { t: 'room.hexBans', ids: ['hex_stipend', 'hex_stipend'] }, ERR.BAD_MSG);
    // outside a room: accepted; the unknown id is dropped and the legal ones kept
    await ok(host, { t: 'room.hexBans', ids: ['hex_stipend', 'hex_echo', 'not_a_card'] });
    const st = await createRoom(host);
    const guest = await pool.player('Guest');
    await ok(guest, { t: 'room.join', code: st.code });
    await guest.waitFor('room.state', (s) => s.seats.some((x) => x && x.playerId === guest.id));
    await ok(guest, { t: 'room.hexBans', ids: ['hex_recruit'] });
    await ok(host, { t: 'room.addBot' });
    await ok(guest, { t: 'room.ready', ready: true });
    await ok(host, { t: 'room.start' });
    await host.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
    const seats = RecordingStub.instances.at(-1).opts.seats;
    const by = (id) => seats.find((s) => s.playerId === id);
    assert.deepEqual([...by(host.id).hexBans], ['hex_stipend', 'hex_echo'], 'the host’s legal bans');
    assert.deepEqual([...by(guest.id).hexBans], ['hex_recruit'], 'the guest’s');
    assert.equal(seats.find((s) => s.isBot).hexBans, null, 'bots ban nothing');
    // during the match: refused for this match (ROOM_STARTED), kept for the next one
    const r = await err(host, { t: 'room.hexBans', ids: ['hex_recruit'] }, ERR.ROOM_STARTED);
    assert.match(r.detail || '', /next match/);
    assert.deepEqual(cap.errors, [], 'no server-side errors');
  });

  test('an explicit null / missing list is malformed (the message names the field)', async () => {
    const c = await pool.player('Solo');
    const r = await c.request({ t: 'room.hexBans' });
    assert.equal(r.t, 'error');
    assert.equal(r.code, ERR.BAD_MSG);
  });
});
