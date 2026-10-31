import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { ERR, PHASE } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { createRng, deriveSeed } from '../../server/sim/rng.js';
import { setupMatchWaves } from '../../server/match/waves.js';
import { drawDisabledBonds } from '../../server/match/pool.js';

const snapshot = (m) => ({ stageId: m.stageId, bossId: m.bossId, hiddenBossId: m.hiddenBossId,
  factions: [...m.factions], schedule: m.factions.schedule, bans: [...m.bannedChess], drawn: [...m.disabledBonds] });

test('the host reroll gives everyone a fresh full countdown; the old timeout cannot advance it', (t) => {
  const h = makeMatch({ humans: 2, hostId: 'p_0' }).start();
  t.after(() => h.m.dispose());
  const m = h.m;
  const fullMs = m.scaled(m.gd.timer('infoCheck') * 1000);
  h.sched.advance(fullMs - 1000);
  assert.equal(m.deadline - h.sched.now(), 1000);
  assert.deepEqual(m.requestSetupReroll('p_0', 0), { ok: true });
  const fresh = h.lastBc('m.public');
  assert.equal(fresh.setupRevision, 1);
  assert.equal(fresh.deadline - fresh.serverNow, fullMs);
  assert.ok(fresh.players.every((p) => !p.ready));
  assert.equal(m.deadline, h.sched.now() + fullMs);
  h.sched.advance(fullMs - 1);
  assert.equal(m.phase, PHASE.INFO_CHECK);
  h.sched.advance(1);
  assert.equal(m.phase, PHASE.BAND_DRAFT);
});

test('protocol: the host reroll still carries a setup revision; the vote messages are gone', () => {
  assert.equal(validateC2S({ t: 'room.rerollSetup', setupRevision: 0 }), null);
  assert.equal(validateC2S({ t: 'g.infoReady' }), null);
  assert.equal(validateC2S({ t: 'g.infoReady', setupRevision: 2 }), null);
  for (const msg of [{ t: 'room.rerollSetup' }, { t: 'room.rerollSetup', setupRevision: -1 },
    { t: 'room.rerollSetup', setupRevision: 0.5 }, { t: 'g.infoReady', setupRevision: -1 }]) {
    assert.notEqual(validateC2S(msg), null, JSON.stringify(msg));
  }
  // The consent vote was removed with the behaviour (业主 2026-10-30): an old page's messages are refused by name.
  assert.notEqual(validateC2S({ t: 'room.cancelReroll', voteId: 1 }), null);
  assert.notEqual(validateC2S({ t: 'g.rerollVote', voteId: 1, agree: true }), null);
});

test('the host redraws all four seats at once; seats, settings and the RNG streams stay', (t) => {
  const h = makeMatch({ humans: 4, difficulty: 'HARD', seed: 123, spectators: ['viewer'], hostId: 'p_0' }).start();
  t.after(() => h.m.dispose());
  const m = h.m;
  const before = snapshot(m);
  const pool = m.pool;
  const players = [...m.order];
  const rngs = [m.rngSetup, m.rngShop, m.rngDraft, m.rngWaves, m.rngBots, m.rngMeta].map((r) => [r, r.state()]);
  const p0 = h.ps('p_0');
  assert.equal(p0.setDiy({ chess_char_5_diy1_a: { charId: 'char_017_huang', skillIndex: 0 } }), true);
  p0.initDiyStock(new Set([...m.disabledBonds, ...m.staticInactiveBonds]));
  const settings = [p0.loadout, p0.standIns, p0.diy];
  const stock = p0.diyStock;
  m.handle('p_1', { t: 'g.infoReady' });
  h.sched.advance(500);
  assert.deepEqual(m.requestSetupReroll('p_0', 0), { ok: true });
  assert.equal(m.setupRevision, 1);
  const rng = createRng(deriveSeed(m.seed, 'reroll-setup:1'));
  const setup = setupMatchWaves(m.gd, rng);
  const bans = drawDisabledBonds(m.gd, rng);
  assert.deepEqual(snapshot(m), { stageId: setup.stageId, bossId: setup.bossId, hiddenBossId: setup.hiddenBossId,
    factions: [...setup.factions], schedule: setup.factions.schedule, bans: bans.banned, drawn: bans.drawn });
  assert.notDeepEqual(snapshot(m), before);
  assert.equal(m.stage, m.gd.stage(m.stageId));
  assert.notEqual(m.pool, pool);
  assert.deepEqual(m.order, players);
  assert.deepEqual([p0.loadout, p0.standIns, p0.diy], settings);
  assert.equal(p0.diy, settings[2]);
  assert.notEqual(p0.diyStock, stock);
  const off = new Set([...bans.drawn, ...bans.staticOff]);
  const diy = p0.gd.chess('chess_char_5_diy1_a');
  assert.equal(p0.diyBanned.includes(diy.chessId), diy.bonds.every((b) => off.has(b)));
  assert.equal(p0.diyStock.has(diy.chessId), !p0.diyBanned.includes(diy.chessId));
  for (const [r, state] of rngs) assert.equal(r.state(), state);
  for (const id of m.gd.visibleChess) assert.equal(m.pool.has(id), !bans.banned.includes(id));
  assert.ok(m.order.every((p) => !p.infoReady || p.isBot));
  assert.equal(m.deadline, h.sched.now() + m.scaled(m.gd.timer('infoCheck') * 1000));
  h.invariants();
  // Only the host: the lobby already refuses a guest, and the match re-checks the host it knows.
  assert.equal(m.requestSetupReroll('p_1', 1).error, ERR.NOT_HOST);
  assert.equal(m.requestSetupReroll('ai_0', 1).error, ERR.NOT_IN_ROOM);
  assert.equal(m.requestSetupReroll('stranger', 1).error, ERR.NOT_IN_ROOM);
  for (const p of m.order) assert.deepEqual(m.handle(p.playerId, { t: 'g.infoReady', setupRevision: 1 }), { ok: true });
  h.sched.advance(0);
  assert.equal(m.phase, PHASE.BAND_DRAFT);
  assert.equal(m.requestSetupReroll('p_0', 1).error, ERR.WRONG_PHASE);
});

test('a disconnected or autoplaying human does not block the reroll; reconnect sees the new setup', (t) => {
  const h = makeMatch({ humans: 3, hostId: 'p_0' }).start();
  t.after(() => h.m.dispose());
  const m = h.m;
  m.onDisconnect('p_1');
  assert.deepEqual(m.requestSetupReroll('p_0', 0), { ok: true });
  assert.equal(m.setupRevision, 1);
  assert.equal(h.publicView().setupRevision, 1);
  m.onReconnect('p_1');
  assert.equal(h.lastTo('p_1', 'm.public').setupRevision, 1);
  m.handle('p_2', { t: 'g.autoplay', on: true });
  h.sched.advance(300);
  assert.deepEqual(m.requestSetupReroll('p_0', 1), { ok: true });
  assert.equal(m.setupRevision, 2);
  assert.equal(h.ps('p_2').infoReady, true, 'an autoplay seat is driven like a bot, so it re-readies itself');
});

test('solo and one human with bots refresh immediately without a forced timer; fixed rules remain fixed', (t) => {
  for (const mode of ['solo', 'coop']) {
    const h = makeMatch({ mode, humans: 1, bots: 2, difficulty: 'FUNNY', hostId: 'p_0' }).start();
    t.after(() => h.m.dispose());
    const m = h.m;
    const stage = m.stageId;
    const staticOff = [...m.staticInactiveBonds];
    assert.deepEqual(m.requestSetupReroll('p_0', 0), { ok: true });
    assert.equal(m.stageId, stage);
    assert.deepEqual(m.staticInactiveBonds, staticOff);
    assert.equal(m.deadline, 0);
    assert.equal(m.setupRevision, 1);
    assert.equal(h.ps('p_0').infoReady, false);
    assert.ok(m.order.filter((p) => p.isBot).every((p) => p.infoReady));
    m.handle('p_0', { t: 'g.infoReady', setupRevision: 1 });
    h.sched.advance(0);
    assert.equal(m.phase, PHASE.BAND_DRAFT);
    assert.equal(m.requestSetupReroll('p_0', 1).error, ERR.WRONG_PHASE);
  }
});

test('a queued all-ready transition is cancelled; stale Ready and an old revision cannot affect the new setup', (t) => {
  const h = makeMatch({ humans: 2, hostId: 'p_0' }).start();
  t.after(() => h.m.dispose());
  const m = h.m;
  for (const p of m.order) m.handle(p.playerId, { t: 'g.infoReady' });
  assert.ok(m._infoAdvanceTimer);
  assert.deepEqual(m.requestSetupReroll('p_0', 0), { ok: true });
  assert.equal(m._infoAdvanceTimer, null, 'the transition queued by the old setup is cancelled');
  h.sched.advance(0);
  assert.equal(m.phase, PHASE.INFO_CHECK);
  for (const msg of [{ t: 'g.infoReady' }, { t: 'g.infoReady', setupRevision: 0 }]) {
    assert.equal(m.handle('p_1', msg).error, ERR.BAD_TARGET);
  }
  assert.equal(m.requestSetupReroll('p_0', 0).error, ERR.BAD_TARGET);
  assert.equal(m.requestSetupReroll('p_0', 1).error, ERR.RATE);
  h.sched.advance(300);
  assert.deepEqual(m.requestSetupReroll('p_0', 1), { ok: true });
  assert.equal(m.setupRevision, 2);
});

test('failed DIY stock preparation leaves every opening field and player stock intact', (t) => {
  const h = makeMatch({ humans: 2, difficulty: 'HARD', hostId: 'p_0' }).start();
  t.after(() => h.m.dispose());
  const m = h.m, before = snapshot(m), pool = m.pool, stage = m.stage;
  const stocks = m.order.map((ps) => ps.diyStock), banned = m.order.map((ps) => ps.diyBanned);
  h.sched.advance(1000);
  const remaining = m.deadline - h.sched.now();
  const original = h.ps('p_1').buildDiyStock;
  h.ps('p_1').buildDiyStock = () => { throw Error('stock preparation failed'); };
  assert.equal(m.requestSetupReroll('p_0', 0).error, ERR.INTERNAL);
  h.ps('p_1').buildDiyStock = original;
  assert.deepEqual(snapshot(m), before); assert.equal(m.pool, pool); assert.equal(m.stage, stage);
  for (const [i, ps] of m.order.entries()) { assert.equal(ps.diyStock, stocks[i]); assert.equal(ps.diyBanned, banned[i]); }
  assert.equal(m.setupRevision, 0);
  assert.equal(m.deadline - h.sched.now(), remaining);
  assert.equal(h.logs.error.length, 1, 'failure is reported once');
  // The guard is refreshed by the failed attempt, but the next request after it works.
  h.sched.advance(300);
  assert.deepEqual(m.requestSetupReroll('p_0', 0), { ok: true });
  assert.equal(m.setupRevision, 1);
});

test('a failed reroll keeps the all-ready transition it did not replace', (t) => {
  const h = makeMatch({ humans: 2, hostId: 'p_0' }).start();
  t.after(() => h.m.dispose());
  const m = h.m;
  for (const p of m.order) m.handle(p.playerId, { t: 'g.infoReady' });
  assert.ok(m._infoAdvanceTimer);
  const original = h.ps('p_1').buildDiyStock;
  h.ps('p_1').buildDiyStock = () => { throw Error('stock preparation failed'); };
  assert.equal(m.requestSetupReroll('p_0', 0).error, ERR.INTERNAL);
  h.ps('p_1').buildDiyStock = original;
  assert.ok(m._infoAdvanceTimer, 'the queued transition survives a failed preparation');
  h.sched.advance(0);
  assert.equal(m.phase, PHASE.BAND_DRAFT);
});

test('dispose stops the reroll', () => {
  const h = makeMatch({ humans: 2, hostId: 'p_0' }).start();
  const m = h.m;
  m.dispose();
  assert.equal(m.requestSetupReroll('p_0', 0).error, ERR.WRONG_PHASE);
});
