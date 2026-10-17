// test/config-caps.test.js — the operator-tunable capacity caps (server/http/config.js).
//
// WHY. Before 2026-10-13 every cap (maxConnections, maxRooms, ...) was a hard-coded module default that only a
// `startServer({ … })` CALLER could override — and the process entry passes no options, so a real deployment could
// not tune them without editing the source. That is the one thing you cannot do during an outage. These tests pin
// the new SP_* variables, the strict parsing (a typo must never widen a cap to NaN), and that an explicit option
// still wins so programmatic callers keep full control.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { netOptionsFrom, lobbyOptionsFrom, parseCount, NET_ENV_CAPS, LOBBY_ENV_CAPS, SOLO_RECONNECT_ENV } from '../server/http/config.js';

/** Run `fn` with `env` set, restoring the previous values afterwards. */
function withEnv(env, fn) {
  const saved = new Map();
  for (const [k, v] of Object.entries(env)) {
    saved.set(k, process.env[k]);
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return fn(); } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test('parseCount: digits only, no sign, no float, blank/absent/invalid → null', () => {
  assert.equal(parseCount('64'), 64);
  assert.equal(parseCount('0'), 0);
  assert.equal(parseCount(' 12 '), 12, 'surrounding space is tolerated');
  assert.equal(parseCount(''), null);
  assert.equal(parseCount(undefined), null);
  assert.equal(parseCount(null), null);
  // the ones that must NOT become a number
  assert.equal(parseCount('abc'), null, 'a typo must not become NaN');
  assert.equal(parseCount('1e3'), null, 'no exponent');
  assert.equal(parseCount('-1'), null, 'no negatives');
  assert.equal(parseCount('1.5'), null, 'no floats');
  assert.equal(parseCount('0x10'), null);
  assert.equal(parseCount('64px'), null);
  assert.equal(parseCount('99999999999999999999999'), null, 'beyond Number.isSafeInteger');
});

test('an unset environment leaves the modules\' own defaults alone', () => {
  const clear = (envs) => Object.fromEntries(envs.map((e) => [e, undefined]));
  withEnv({ ...clear(Object.values(NET_ENV_CAPS)), ...clear(Object.values(LOBBY_ENV_CAPS)), [SOLO_RECONNECT_ENV]: undefined }, () => {
    assert.deepEqual(netOptionsFrom({}), { trustProxy: 'auto' }, 'only trustProxy is filled in');
    assert.deepEqual(lobbyOptionsFrom({}), {}, 'nothing is set without a variable');
  });
});

test('the SP_* caps reach net.js / lobby.js', () => {
  withEnv({ SP_MAX_CONNECTIONS: '300', SP_MAX_CONNECTIONS_PER_ADDR: '20', SP_MAX_ROOMS: '50', SP_MAX_ROOMS_PER_ADDR: '4', SP_MAX_MATCHES_PER_ADDR: '2' }, () => {
    assert.deepEqual(netOptionsFrom({}), { trustProxy: 'auto', maxConnections: 300, maxConnectionsPerAddr: 20 });
    assert.deepEqual(lobbyOptionsFrom({}), { maxRooms: 50, maxRoomsPerAddr: 4, maxMatchesPerAddr: 2 });
  });
});

test('SP_BOT_REHEARSAL turns the AI rehearsal down without touching anything else', () => {
  // The live box's biggest single software lever: an AI-heavy room costs 19x a botless one, and 3 → 0 measured −23 %
  // of CPU per match because a bot rehearses up to three WHOLE battles on the server's one JS thread.
  withEnv({ SP_BOT_REHEARSAL: '0' }, () => {
    assert.deepEqual(lobbyOptionsFrom({}), { botRehearsal: 0 }, '0 = heuristic placement only');
  });
  withEnv({ SP_BOT_REHEARSAL: '1' }, () => {
    assert.equal(lobbyOptionsFrom({}).botRehearsal, 1);
  });
  withEnv({ SP_BOT_REHEARSAL: '99' }, () => {
    assert.equal(lobbyOptionsFrom({}).botRehearsal, 8, 'clamped to the module ceiling');
  });
  withEnv({ SP_BOT_REHEARSAL: 'abc' }, () => {
    assert.ok(!('botRehearsal' in lobbyOptionsFrom({})), 'a typo leaves the default in place');
  });
  withEnv({ SP_BOT_REHEARSAL: '0', SP_BOT_SLICE_MS: '4' }, () => {
    const o = lobbyOptionsFrom({});
    assert.equal(o.botRehearsal, 0);
    assert.equal(o.botSliceMs, 4);
  });
  withEnv({ SP_BOT_SLICE_MS: '0' }, () => {
    assert.ok(!('botSliceMs' in lobbyOptionsFrom({})), 'a zero slice is refused (it must be positive)');
  });
  // an explicit option still wins
  withEnv({ SP_BOT_REHEARSAL: '0' }, () => {
    assert.equal(lobbyOptionsFrom({ botRehearsal: 3 }).botRehearsal, 3);
  });
});

test('an explicit option wins over the environment (programmatic callers keep control)', () => {
  withEnv({ SP_MAX_CONNECTIONS: '300', SP_MAX_ROOMS: '50' }, () => {
    assert.equal(netOptionsFrom({ maxConnections: 7 }).maxConnections, 7);
    assert.equal(lobbyOptionsFrom({ maxRooms: 9 }).maxRooms, 9);
    // 0 means "unlimited" for the per-address caps and must survive as 0, not be treated as unset
    assert.equal(netOptionsFrom({ maxConnectionsPerAddr: 0 }).maxConnectionsPerAddr, 0);
  });
});

test('SP_MAX_BOTS: the server-wide AI cap, 0 = unlimited, a typo leaves the default', () => {
  withEnv({ SP_MAX_BOTS: '5' }, () => assert.equal(lobbyOptionsFrom({}).maxBots, 5));
  withEnv({ SP_MAX_BOTS: '1' }, () => assert.equal(lobbyOptionsFrom({}).maxBots, 1));
  // 0 is a MEANINGFUL value here (unlimited), exactly like the per-address caps — it must reach the lobby as 0
  withEnv({ SP_MAX_BOTS: '0' }, () => assert.equal(lobbyOptionsFrom({}).maxBots, 0, '0 = unlimited survives'));
  withEnv({ SP_MAX_BOTS: 'abc' }, () => assert.ok(!('maxBots' in lobbyOptionsFrom({})), 'a typo never disables the cap'));
  withEnv({ SP_MAX_BOTS: '-2' }, () => assert.ok(!('maxBots' in lobbyOptionsFrom({})), 'a negative is refused'));
  withEnv({ SP_MAX_BOTS: '2' }, () => assert.equal(lobbyOptionsFrom({ maxBots: 9 }).maxBots, 9, 'an explicit option wins'));
});

test('SP_SOLO_RECONNECT_MS: 0 is kept as "use the data", so the official 24 h comes back', () => {
  withEnv({ [SOLO_RECONNECT_ENV]: '3600000' }, () => assert.equal(lobbyOptionsFrom({}).soloReconnectWindowMs, 3600000));
  // 0 must REACH the lobby (it is not "unset"): soloResumeWindowMs() reads a non-positive value as "no override"
  // and falls through to config.constants.singleReconnectTime, which is how the official 24 h is restored.
  withEnv({ [SOLO_RECONNECT_ENV]: '0' }, () => assert.equal(lobbyOptionsFrom({}).soloReconnectWindowMs, 0));
  withEnv({ [SOLO_RECONNECT_ENV]: 'abc' }, () => assert.ok(!('soloReconnectWindowMs' in lobbyOptionsFrom({})), 'a typo leaves the 10-minute default'));
  withEnv({ [SOLO_RECONNECT_ENV]: '0' }, () => assert.equal(lobbyOptionsFrom({ soloReconnectWindowMs: 60000 }).soloReconnectWindowMs, 60000, 'an explicit option wins'));
});

test('a malformed value never widens a cap', () => {
  withEnv({ SP_MAX_CONNECTIONS: 'abc', SP_MAX_ROOMS: '1.5', SP_MAX_MATCHES_PER_ADDR: '-3' }, () => {
    const net = netOptionsFrom({});
    const lobby = lobbyOptionsFrom({});
    assert.ok(!('maxConnections' in net), 'garbage leaves the default in place');
    assert.ok(!('maxRooms' in lobby));
    assert.ok(!('maxMatchesPerAddr' in lobby));
    // the danger this guards: NaN compares false against every limit, so a NaN cap would disable the limit entirely
    assert.notEqual(net.maxConnections, NaN);
  });
});
